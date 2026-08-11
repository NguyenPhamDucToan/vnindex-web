"""Sector-adjusted winsorized model price -- the number the Streamlit app shows
in its "Đánh giá tổng hợp" block.

The raw DB fields can't be shown as-is: a bank's DCF is garbage (VCB reads
487,725 VND/share, +715%) and avg_intrinsic_value isn't sector-adjusted. The
app fixes this by computing all 10 implied prices, swapping the industrial
multiples for sector-appropriate ones (P/NII for banks, NAV proxy for real
estate, ...), then taking a winsorized mean that clips outliers. This module
reproduces that exactly by REUSING the sibling project's own valuation code,
so the static site and the Python app can't drift apart.

Run inside ../vnindex-valuation (its package + .env are added to sys.path by
export_data.py before importing this).
"""
from __future__ import annotations

import statistics

from config import MARKET_PE
from valuation.dcf import dcf_valuation
from valuation.graham import graham_number, bvps_from_financials
from valuation.inputs import compute_ttm, compute_fcff_ttm, annual_fcff_growth
from valuation.multiples import (
    pb_implied, ev_ebitda_implied, epv_implied,
    ps_implied, residual_income_implied, pocf_implied,
)
from valuation.wacc import cost_of_equity, DEFAULT_BETA, DEFAULT_COD

_FINANCIAL = {"Ngân hàng", "Chứng khoán", "Bảo hiểm", "Bất động sản"}


def _all_methods(ttm: dict, ticker: str) -> dict:
    """All 10 implied prices, mirroring get_all_valuations() in the app."""
    shares = ttm.get("shares_outstanding") or 0
    equity = ttm.get("equity")
    net_income = ttm.get("net_income")
    debt = ttm.get("debt") or 0.0
    cash = ttm.get("cash") or 0.0
    net_debt = debt - cash

    # DCF (canonical pipeline path so it matches the stored dcf_estimate).
    fcff_base = compute_fcff_ttm(ttm)
    growth = 0.12
    _hg = annual_fcff_growth(ticker)          # takes ticker, not ttm
    if isinstance(_hg, (int, float)):
        growth = max(0.02, min(_hg, 0.35))
    dcf_price = None
    wacc_val = None
    if fcff_base is not None and shares > 0:
        r = dcf_valuation(fcff_base=fcff_base, net_debt_bn=net_debt,
                          shares_millions=shares, fcff_growth_rate=growth,
                          beta=DEFAULT_BETA, cost_of_debt=DEFAULT_COD,
                          debt_bn=debt, equity_bn=(equity or 1.0))
        dcf_price = r.get("price_per_share")
        wacc_val = r.get("wacc")

    fcfe_price = None
    fcf_v = ttm.get("fcf")
    if fcf_v and fcf_v > 0 and shares > 0:
        r = dcf_valuation(fcff_base=fcf_v, net_debt_bn=0, shares_millions=shares,
                          fcff_growth_rate=growth, wacc_override=cost_of_equity(DEFAULT_BETA))
        fcfe_price = r.get("price_per_share")

    graham_price = None
    if equity and shares > 0:
        bvps = bvps_from_financials(equity, shares)
        eps = (net_income * 1_000 / shares) if net_income and net_income > 0 else None
        graham_price = graham_number(eps, bvps) if eps else None

    pe_price = ((net_income * 1_000 / shares) * MARKET_PE) if net_income and net_income > 0 and shares > 0 else None
    pb_price = pb_implied(equity, shares) if equity and shares > 0 else None
    ebitda = ttm.get("ebitda") or (((ttm.get("ebit") or 0) + (ttm.get("depreciation") or 0)) if ttm.get("ebit") else None)
    ev_price = ev_ebitda_implied(ebitda, net_debt, shares) if ebitda and shares > 0 else None
    epv_price = epv_implied(ttm.get("ebit"), net_debt, shares, wacc=wacc_val) if shares > 0 else None
    ps_price = ps_implied(ttm.get("revenue"), shares) if shares > 0 else None
    ri_price = residual_income_implied(equity, shares, net_income, g=growth) if equity and shares > 0 else None
    pocf_price = pocf_implied(ttm.get("operating_cf"), shares) if shares > 0 else None

    return {"dcf": dcf_price, "fcfe": fcfe_price, "graham": graham_price, "pe": pe_price,
            "pb": pb_price, "ev_ebitda": ev_price, "epv": epv_price, "ps": ps_price,
            "ri": ri_price, "pocf": pocf_price}


def _sector_adjust(v: dict, ttm: dict, sector: str) -> dict:
    """Copy of _sector_adjusted_valuations() from the app."""
    v = dict(v)
    shares = ttm.get("shares_outstanding") or 0

    def _ps(val_bn, mult):
        return round(val_bn * 1e9 / (shares * 1e6) * mult) if (val_bn and shares > 0) else None

    if sector == "Ngân hàng":
        v["ev_ebitda"] = _ps(ttm.get("gross_profit"), 8)
        v["epv"] = _ps(ttm.get("ebit"), 6)
        v["ps"] = _ps(ttm.get("revenue"), 5)
    elif sector == "Bất động sản":
        eb = (ttm.get("ebit") or 0) + (ttm.get("depreciation") or 0)
        nd = (ttm.get("debt") or 0) - (ttm.get("cash") or 0)
        if eb > 0 and shares > 0:
            ev = eb * 15 - nd
            v["ev_ebitda"] = round(ev * 1e9 / (shares * 1e6)) if ev > 0 else None
        v["ps"] = _ps(ttm.get("revenue"), 3.5)
        if ttm.get("equity") and shares > 0:
            v["epv"] = round(ttm["equity"] * 1.8 * 1e9 / (shares * 1e6))
    elif sector == "Chứng khoán":
        v["ps"] = _ps(ttm.get("revenue"), 3)
        v["ev_ebitda"] = None
        if ttm.get("equity") and shares > 0:
            v["epv"] = round(ttm["equity"] * 1.2 * 1e9 / (shares * 1e6))
    elif sector == "Bảo hiểm":
        v["ps"] = _ps(ttm.get("revenue"), 2)
        v["ev_ebitda"] = None
        if ttm.get("equity") and shares > 0:
            v["epv"] = round(ttm["equity"] * 2.0 * 1e9 / (shares * 1e6))
    return v


def _winsorized_mean(values):
    if not values:
        return None
    med = statistics.median(values)
    mad = statistics.median([abs(x - med) for x in values])
    if mad > 0:
        lo, hi = med - 1.5 * mad, med + 1.5 * mad
        clipped = [min(max(x, lo), hi) for x in values]
    else:
        clipped = list(values)
    return sum(clipped) / len(clipped)


def model_price(ticker: str, sector: str, price_vnd: float | None):
    """Return (model_price_vnd, upside_fraction) or (None, None)."""
    ttm = compute_ttm(ticker)
    if ttm is None:
        return None, None
    adj = _sector_adjust(_all_methods(ttm, ticker), ttm, sector)
    prices = sorted(x for x in adj.values() if isinstance(x, (int, float)) and x and x > 0)
    m = _winsorized_mean(prices)
    if m is None:
        return None, None
    up = ((m - price_vnd) / price_vnd) if (price_vnd and price_vnd > 0) else None
    return round(m), (round(up, 4) if up is not None else None)

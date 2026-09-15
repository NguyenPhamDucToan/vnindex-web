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


# ── justified P/B for financials ────────────────────────────────────────────
# A bank is valued on what it earns for its shareholders against what they
# require, because its debt is raw material rather than financing. The Gordon
# form of that is
#
#     P/B = (ROE − g) / (Ke − g),     Ke = RF + β × ERP
#
# which is EXACTLY the residual-income formula already in valuation/multiples.py
# once rearranged: BVPS + (ROE−Ke)·BVPS/(Ke−g) = BVPS·(ROE−g)/(Ke−g). What broke
# there was the parameters, not the model -- g defaulted to 0.12 against a
# CoE of 0.13, so the denominator was 0.01 and every excess point of ROE was
# multiplied by a hundred: VCB came out at 141,856 VND against a 58,200 share.
# And it used DEFAULT_BETA, so every bank got the same hurdle.
#
# Measured before this change, each method sat ABOVE the market for banks at the
# median -- pe x2.14, ev_ebitda x2.13, ps x1.72, graham x1.66, epv x1.46,
# pb x1.30, nothing below 1.0 -- because MARKET_PE is 15 and TARGET_PB is 1.5
# while the sector trades at 7.7x earnings and 1.16x book. "A bank is cheap" was
# therefore an assumption inside the multiples, applied equally to all 21, so it
# lifted the whole sector without ranking any of it: 16 of 21 read Mua or Mua
# mạnh on a median upside of +64%, and VCB -- the one bank the market prices at a
# real premium -- was the only Theo dõi.
_G = 0.05            # long-run nominal growth; VN inflation plus a little real
_G_FLOOR = 0.02      # Ke must clear g by this much or the ratio explodes
# 0.5x rather than 0.3x: Gordon puts EVF at 0.175x book on a 6.4% ROE against a
# 13.0% hurdle, which is a ratio of two small differences, not a valuation. VN
# banks bottomed near 0.5x in the 2012-13 bad-debt years and the lowest any of
# the 21 trades at today is 0.76x, so half of book is the floor a lender that
# still earns a profit gets.
_PB_MIN, _PB_MAX = 0.50, 3.00
# Ke is an estimate, and the ratio divides by (Ke - g) ~ 0.06-0.10, so a 1pp
# error in the hurdle moves the answer 15-20%: MBB spans 1.77-2.30x, ACB
# 1.86-2.48x. The panel shows that span so one printed number does not claim
# precision the method does not have.
_KE_SENSITIVITY = 0.01


def _blume(beta):
    """Shrink a measured beta toward 1.0 (Blume): b_adj = 0.33 + 0.67 x b_raw.

    A 252-day beta is an estimate, and the ratio below divides by (Ke - g), so a
    low one runs away with the answer: NAB measured 0.475, which puts a bank's
    cost of equity at 8.8% and its justified multiple past 3x book -- a cap, not
    a valuation. Betas also mean-revert, so shrinking is the standard correction
    rather than a thumb on the scale. It moved the sector's median justified P/B
    from 1.56 to 1.52 and took both tickers off the cap.
    """
    if not isinstance(beta, (int, float)) or beta <= 0:
        return DEFAULT_BETA
    return 0.33 + 0.67 * beta


def _avg_annual_roe(ticker: str, years: int = 3):
    """Mean ROE over the last few annual reports -- the sustainable figure the
    model wants, rather than one TTM window a single trading quarter can swing.

    Three years rather than five: bank ROE has been falling across the sector
    (VCB 20.2% in 2021 to 15.7% in 2025), so a five-year mean prices earning
    power the bank no longer has.
    """
    try:
        from models.database import get_session
        from models.schema import Financial
        from sqlalchemy import select
        with get_session() as session:
            rows = session.execute(
                select(Financial.net_income, Financial.equity)
                .where(Financial.ticker == ticker, Financial.period_type == "Y")
                .order_by(Financial.period.desc()).limit(years)
            ).all()
    except Exception:
        return None
    vals = [ni / eq for ni, eq in rows
            if ni is not None and eq and eq > 0 and ni == ni and eq == eq]
    return sum(vals) / len(vals) if vals else None


def justified_pb_price(ttm: dict, beta: float | None, ticker: str, ke_shift: float = 0.0):
    """BVPS × (ROE − g) / (Ke − g), or None when the inputs do not support it.

    ke_shift moves the hurdle to price the sensitivity band.
    """
    equity = ttm.get("equity")
    shares = ttm.get("shares_outstanding") or 0
    if not equity or equity <= 0 or shares <= 0:
        return None

    roe = _avg_annual_roe(ticker)
    if roe is None:
        ni = ttm.get("net_income")
        roe = (ni / equity) if ni else None
    if roe is None:
        return None

    ke = cost_of_equity(_blume(beta)) + ke_shift
    g = min(_G, ke - _G_FLOOR)
    if ke - g <= 0:
        return None

    pb = (roe - g) / (ke - g)
    # A bank earning less than the growth it is priced for is worth less than its
    # book, but not nothing: the floor keeps a single loss year from erasing the
    # franchise, and the ceiling keeps a low-beta, high-ROE bank from running to
    # 4x+ on a hurdle that is itself only an estimate.
    pb = max(_PB_MIN, min(pb, _PB_MAX))
    bvps = equity * 1_000 / shares
    price = bvps * pb
    return round(price) if price > 0 else None


# ── the two anchors that join the justified P/B ─────────────────────────────
# One method is not a valuation, it is an opinion with a number attached. The
# justified P/B above assumes today's ROE persists for ever, which is why it
# reads 2-3x book for a sector the market pays 1.08x for; on its own it made the
# median bank +36%. These two disagree with it on purpose:
#
#   · RIM with a fade. The same residual-income identity, but excess returns
#     decay instead of lasting forever: ROE walks linearly down to Ke over ten
#     years and the book compounds at g. That is the standard practitioner
#     answer to "how long can a bank out-earn its cost of capital", and it is
#     far more conservative -- median +0% against Gordon's +36%.
#   · The bank's own traded P/B. Five and a half years of daily closes against
#     the book value that was published at the time, median taken. It asks a
#     different question from either model: not "what is this worth" but "what
#     has the market paid for this bank's book, and is today dear or cheap
#     against that". Median -12%.
#
# Winsorized together the median lands at +11%, and the spread between the three
# is itself the reading: VCB's models and its own history agree within 7 points,
# while NAB's Gordon says +167% and its own history says -36%.
_FADE_YEARS = 10
_MIN_PB_OBS = 200          # ~2 years of sessions before a median means anything


def rim_fade_price(ttm: dict, beta: float | None, ticker: str):
    """Residual income with ROE fading to the cost of equity over _FADE_YEARS."""
    equity = ttm.get("equity")
    shares = ttm.get("shares_outstanding") or 0
    if not equity or equity <= 0 or shares <= 0:
        return None
    roe = _avg_annual_roe(ticker)
    if roe is None:
        ni = ttm.get("net_income")
        roe = (ni / equity) if ni else None
    if roe is None:
        return None

    ke = cost_of_equity(_blume(beta))
    g = min(_G, ke - _G_FLOOR)
    total = 0.0
    for t in range(1, _FADE_YEARS + 1):
        roe_t = roe - (roe - ke) * (t / _FADE_YEARS)
        total += (roe_t - ke) * ((1 + g) ** (t - 1)) / ((1 + ke) ** t)
    pb = max(_PB_MIN, min(1.0 + total, _PB_MAX))
    price = equity * 1_000 / shares * pb
    return round(price) if price > 0 else None


def _own_median_pb(ticker: str):
    """Median P/B the market has actually paid for this bank.

    Each close is matched to the newest book value a buyer could have known on
    that date -- the quarter is only usable once it has been filed, so the same
    45-day publish lag the valuation band uses applies here, or the ratio would
    use earnings nobody had yet.
    """
    try:
        from datetime import date, timedelta
        from models.database import get_session
        from models.schema import Financial, Price
        from sqlalchemy import select
        with get_session() as session:
            quarters = session.execute(
                select(Financial.period, Financial.equity, Financial.shares_outstanding)
                .where(Financial.ticker == ticker, Financial.period_type == "Q",
                       Financial.equity.isnot(None))
                .order_by(Financial.period)
            ).all()
            closes = session.execute(
                select(Price.date, Price.close)
                .where(Price.ticker == ticker).order_by(Price.date)
            ).all()
    except Exception:
        return None
    if not quarters or not closes:
        return None

    stamped = []
    for period, equity, shares in quarters:
        try:
            year, qn = int(str(period)[:4]), int(str(period)[6:])
            month, day = _QUARTER_END_MD[qn]
            usable = date(year + (1 if qn == 4 else 0), month, day) + timedelta(days=45)
        except (ValueError, KeyError, IndexError):
            continue
        if equity and shares and float(shares) > 0 and float(equity) > 0:
            stamped.append((usable, float(equity) * 1_000 / float(shares)))
    if not stamped:
        return None
    stamped.sort()

    ratios, i, bvps = [], 0, None
    for when, close in closes:
        while i < len(stamped) and stamped[i][0] <= when:
            bvps = stamped[i][1]
            i += 1
        if bvps and close:
            ratios.append(float(close) * 1_000 / bvps)
    if len(ratios) < _MIN_PB_OBS:
        return None
    return statistics.median(ratios)


_QUARTER_END_MD = {1: (4, 1), 2: (7, 1), 3: (10, 1), 4: (1, 1)}


def own_pb_price(ttm: dict, ticker: str):
    """BVPS x the median P/B this bank has traded at."""
    equity = ttm.get("equity")
    shares = ttm.get("shares_outstanding") or 0
    if not equity or equity <= 0 or shares <= 0:
        return None
    pb = _own_median_pb(ticker)
    if pb is None or pb <= 0:
        return None
    price = equity * 1_000 / shares * pb
    return round(price) if price > 0 else None


def _sector_adjust(v: dict, ttm: dict, sector: str, beta=None,
                   ticker: str = "") -> dict:
    """Copy of _sector_adjusted_valuations() from the app."""
    v = dict(v)
    shares = ttm.get("shares_outstanding") or 0

    def _ps(val_bn, mult):
        return round(val_bn * 1e9 / (shares * 1e6) * mult) if (val_bn and shares > 0) else None

    # A bank, broker or insurer has no free cash flow in the sense these three
    # methods assume: its operating cash flow is deposit, loan and client-money
    # movement, not earnings retained after capex. They produce numbers 6 to 45
    # times the share price -- CTG came out at 1,365,553 VND on DCF, 660,338 on
    # FCFE and 197,677 on P/OCF against a 29,950 VND share -- and the winsorized
    # mean only clips them to a ceiling, so all three still pushed the average
    # up: CTG's model price was 78,677 where the six sound methods say 60,918.
    if sector in ("Ngân hàng", "Chứng khoán", "Bảo hiểm"):
        for k in ("dcf", "fcfe", "pocf"):
            v[k] = None

    if sector == "Ngân hàng":
        # One anchor, and it is the sector's own: see justified_pb_price above for
        # why the six multiples it replaces could only ever conclude "cheap".
        v["pb"] = justified_pb_price(ttm, beta, ticker)
        v["ri"] = rim_fade_price(ttm, beta, ticker)
        v["pb_own"] = own_pb_price(ttm, ticker)
        for k in ("pe", "ps", "ev_ebitda", "graham", "epv"):
            v[k] = None
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
        # 2x revenue for an insurer is 2x gross premium, and a premium buys a
        # future claim as much as a fee -- the sector nets 5-7% of it. That
        # multiple implied a P/E near 40 and measured x3.83 the market price, the
        # widest overshoot of any method in any sector. Book value carries the
        # float, so the sector is judged on equity instead.
        v["ps"] = None
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


def model_price(ticker: str, sector: str, price_vnd: float | None, beta=None):
    """Return (model_price_vnd, upside_fraction, per_method_prices, dcf_params).

    per_method_prices is the sector-adjusted {method_key: price_vnd} dict the
    valuation panel renders as individual cards; dcf_params carries the WACC and
    growth rate behind the DCF figure.
    """
    ttm = compute_ttm(ticker)
    if ttm is None:
        return None, None, {}, {}

    # growth + wacc, recomputed the same way _all_methods does, for display
    params = {}
    try:
        _hg = annual_fcff_growth(ticker)
        growth = max(0.02, min(_hg, 0.35)) if isinstance(_hg, (int, float)) else 0.12
        shares = ttm.get("shares_outstanding") or 0
        fcff_base = compute_fcff_ttm(ttm)
        if fcff_base is not None and shares > 0:
            r = dcf_valuation(fcff_base=fcff_base,
                              net_debt_bn=(ttm.get("debt") or 0) - (ttm.get("cash") or 0),
                              shares_millions=shares, fcff_growth_rate=growth,
                              beta=DEFAULT_BETA, cost_of_debt=DEFAULT_COD,
                              debt_bn=(ttm.get("debt") or 0),
                              equity_bn=(ttm.get("equity") or 1.0))
            params = {"wacc": r.get("wacc"), "growth": growth,
                      "fcff": fcff_base, "shares": shares}
        else:
            params = {"wacc": None, "growth": growth, "fcff": fcff_base, "shares": shares}
    except Exception:
        params = {}

    adj = _sector_adjust(_all_methods(ttm, ticker), ttm, sector, beta, ticker)
    if sector == "Ngân hàng":
        hi = justified_pb_price(ttm, beta, ticker, -_KE_SENSITIVITY)
        lo = justified_pb_price(ttm, beta, ticker, +_KE_SENSITIVITY)
        if lo and hi:
            params["pb_lo"], params["pb_hi"] = lo, hi
    methods = {k: (round(x) if isinstance(x, (int, float)) and x and x > 0 else None)
               for k, x in adj.items()}
    prices = sorted(x for x in adj.values() if isinstance(x, (int, float)) and x and x > 0)
    m = _winsorized_mean(prices)
    if m is None:
        return None, None, methods, params
    up = ((m - price_vnd) / price_vnd) if (price_vnd and price_vnd > 0) else None
    return round(m), (round(up, 4) if up is not None else None), methods, params

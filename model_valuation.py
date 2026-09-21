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


# The four cash-flow methods each capitalise ONE trailing year, and measured
# against the market they were the last systematic bias left after the multiples
# were fixed: dcf x1.64, fcfe x1.61, pocf x1.40, ev_ebitda x1.39 -- and far worse
# where working capital swings. Wholesale read fcfe x10.98 and pocf x6.09,
# construction fcfe x5.17 and dcf x4.56, fisheries fcfe x3.60. A distributor that
# drained inventory for one year shows an enormous operating cash flow, and
# growing that at up to 35% before capitalising it is not a valuation.
#
# So the base is normalised to a cycle average: the mean of the last five annual
# figures. Graham's own prescription for exactly this problem was a seven-to-ten
# year average of earnings, and five is what the database holds.
#
# The mean, not the median, because these series alternate sign rather than
# carry an occasional outlier -- a developer buys land one year and hands over
# the next -- and a median can settle in a trough as easily as on a peak. On 158
# tickers in the six most volatile sectors the two disagreed about the SIGN for
# 23 of them. The mean is also the more conservative of the two, leaving 62 of
# 158 with a positive base against the median's 71 and the latest year's 83; a
# company that burns cash across a whole cycle genuinely has no DCF value, and
# dropping the method for it is the right answer rather than a lost feature.
_NORMALISE_YEARS = 5


def _normalised(ticker: str, column: str, ttm_value, current_revenue=None):
    """A cycle-average MARGIN applied to today's revenue.

    Averaging the level punishes a company that has grown every year: FPT's five
    annual free cash flows rise throughout, so their mean sits near where it was
    three years ago, and the DCF then values a bigger company at a smaller one's
    cash flow. Measured on the 75 analyst-covered names -- which are the large,
    growing ones -- that put fcfe at x0.63 of the market price, pocf at x0.64 and
    dcf at x0.68, while the same methods read x1.23 across the names nobody
    covers.

    Averaging the MARGIN keeps the correction (one freak year cannot set the
    base) without the penalty (today's scale is today's scale). This is the
    ordinary way practitioners normalise: a mid-cycle margin on current revenue.
    Falls back to averaging the level when revenue is missing.
    """
    rows = _annual_rows(ticker, _NORMALISE_YEARS)
    margins, levels = [], []
    for row in rows:
        value, revenue = row.get(column), row.get("revenue")
        if value is None or float(value) != float(value):
            continue
        levels.append(float(value))
        if revenue and float(revenue) > 0:
            margins.append(float(value) / float(revenue))
    if margins and current_revenue and current_revenue > 0 and len(margins) == len(levels):
        return sum(margins) / len(margins) * current_revenue
    if levels:
        return sum(levels) / len(levels)
    return ttm_value


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
    # A single year's FCFF is not a run rate; see _normalised above.
    if fcff_base is not None:
        annual_fcff = _normalised(ticker, "fcf", None, ttm.get("revenue"))
        if isinstance(annual_fcff, (int, float)) and annual_fcff == annual_fcff:
            fcff_base = annual_fcff
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
    fcf_v = _normalised(ticker, "fcf", ttm.get("fcf"), ttm.get("revenue"))
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


# -- what the market has actually paid ---------------------------------------
# MARKET_PE was 15 and TARGET_PB 1.5, against a market whose median trailing P/E
# is 9.6x and median P/B 0.93x. Graham inherited both, since 22.5 is 15 x 1.5.
# The result was not a sector quirk but a constant offset in every sector: the
# model put 320 of 403 tickers (79%) at a positive upside, median +60%, with
# wholesale at +146%, construction +121% and property +90%. `pe` measured above
# the market price in almost every sector -- fisheries x2.02, electrical
# equipment x1.83, utilities x1.77, transport x1.75.
#
# So the multiples now come from what the market has paid, per sector, across
# the 5.5 years of price history in the database rather than from a round
# number. Per sector because a bank at 7.7x earnings and a broker at 16.0x are
# not the same bar; historical rather than today's cross-section because the
# current median would force the median ticker to exactly 0% upside and the
# model could then never say a sector is cheap against its own past.
#
# Each close is matched to the EPS and book value a buyer could have known that
# day -- a quarter becomes usable 45 days after it ends, the same publish lag
# the valuation band uses -- so nothing here values a stock on earnings nobody
# had yet.
_PUBLISH_LAG_DAYS = 45
_MIN_OBS = 200                  # ~2 years of sessions before a median means much
_MIN_SECTOR_TICKERS = 3         # below this, fall back to the market median
_QUARTER_END_MD = {1: (4, 1), 2: (7, 1), 3: (10, 1), 4: (1, 1)}

_HIST = None


def _quarter_usable_from(period):
    """The date a quarter's figures could first have been used."""
    from datetime import date, timedelta
    try:
        year, qn = int(str(period)[:4]), int(str(period)[6:])
        month, day = _QUARTER_END_MD[qn]
        return date(year + (1 if qn == 4 else 0), month, day) + timedelta(days=_PUBLISH_LAG_DAYS)
    except (ValueError, KeyError, TypeError):
        return None


def _build_history():
    """Trailing P/E, P/B and P/S medians per ticker, then per sector."""
    from models.database import get_session
    from models.schema import Company, Financial, Price
    from sqlalchemy import select

    with get_session() as session:
        sectors = dict(session.execute(select(Company.ticker, Company.sector)).all())
        quarters = session.execute(
            select(Financial.ticker, Financial.period, Financial.equity,
                   Financial.shares_outstanding, Financial.net_income, Financial.revenue,
                   Financial.ebit, Financial.depreciation, Financial.operating_cf,
                   Financial.debt, Financial.cash)
            .where(Financial.period_type == "Q").order_by(Financial.ticker, Financial.period)
        ).all()
        closes = session.execute(
            select(Price.ticker, Price.date, Price.close).order_by(Price.ticker, Price.date)
        ).all()
        # Everything the annual helpers need, in one read. Asking per ticker cost
        # four round trips each -- _normalised twice, _avg_annual_roe and
        # _fade_years once apiece -- which is 2,500 queries against a remote
        # Postgres and pushed the export past the workflow's 30-minute timeout.
        annuals = session.execute(
            select(Financial.ticker, Financial.period, Financial.net_income,
                   Financial.equity, Financial.fcf, Financial.operating_cf,
                   Financial.revenue)
            .where(Financial.period_type == "Y")
            .order_by(Financial.ticker, Financial.period.desc())
        ).all()

    rows_by_ticker = {}
    for row in quarters:
        rows_by_ticker.setdefault(row[0], []).append(row)

    marks = {}
    for ticker, rows in rows_by_ticker.items():
        out = []
        for i, row in enumerate(rows):
            _, period, equity, shares, _ni, _rev, _eb, _dep, _ocf, debt, cash = row
            usable = _quarter_usable_from(period)
            if usable is None or not shares or float(shares) <= 0:
                continue
            window = rows[max(0, i - 3):i + 1]
            full = len(window) == 4
            shares_f = float(shares)

            def _sum4(idx):
                vals = [r[idx] for r in window]
                if not full or any(v is None for v in vals):
                    return None
                return sum(float(v) for v in vals)

            bvps = (float(equity) * 1_000 / shares_f) if equity and float(equity) > 0 else None
            ni4, rev4 = _sum4(4), _sum4(5)
            eps = (ni4 * 1_000 / shares_f) if ni4 is not None else None
            sps = (rev4 * 1_000 / shares_f) if rev4 is not None else None

            # EBITDA over the trailing year, from EBIT plus depreciation, and
            # net debt from this quarter's balance sheet.
            eb4, dep4, ocf4 = _sum4(6), _sum4(7), _sum4(8)
            ebitda_ps = (((eb4 or 0) + (dep4 or 0)) * 1_000 / shares_f
                         if eb4 is not None else None)
            ocf_ps = (ocf4 * 1_000 / shares_f) if ocf4 is not None else None
            net_debt_ps = ((float(debt or 0) - float(cash or 0)) * 1_000 / shares_f)
            out.append((usable, bvps, eps, sps, ebitda_ps, ocf_ps, net_debt_ps))
        out.sort()
        if out:
            marks[ticker] = out

    price_rows = {}
    for ticker, when, close in closes:
        price_rows.setdefault(ticker, []).append((when, close))

    per_ticker = {}
    for ticker, rows in price_rows.items():
        mk = marks.get(ticker)
        if not mk:
            continue
        series = {"pe": [], "pb": [], "ps": [], "pocf": [], "ev_ebitda": []}
        i, bvps, eps, sps, ebitda_ps, ocf_ps, net_debt_ps = 0, None, None, None, None, None, None
        for when, close in rows:
            while i < len(mk) and mk[i][0] <= when:
                _, bvps, eps, sps, ebitda_ps, ocf_ps, net_debt_ps = mk[i]
                i += 1
            price = float(close) * 1_000
            if bvps and bvps > 0:
                series["pb"].append(price / bvps)
            if eps and eps > 0:
                series["pe"].append(price / eps)
            if sps and sps > 0:
                series["ps"].append(price / sps)
            if ocf_ps and ocf_ps > 0:
                series["pocf"].append(price / ocf_ps)
            if ebitda_ps and ebitda_ps > 0 and net_debt_ps is not None:
                ev = price + net_debt_ps
                if ev > 0:
                    series["ev_ebitda"].append(ev / ebitda_ps)
        entry = {k: statistics.median(v) for k, v in series.items() if len(v) >= _MIN_OBS}
        if entry:
            per_ticker[ticker] = entry

    market = {}
    for key in _MULT_KEYS:
        pool = [e[key] for e in per_ticker.values() if key in e]
        if pool:
            market[key] = statistics.median(pool)

    # Median of the per-ticker medians, so one ticker with 1,300 sessions cannot
    # outvote its whole sector the way pooling every observation would let it.
    grouped = {}
    for ticker, entry in per_ticker.items():
        grouped.setdefault(sectors.get(ticker) or "", []).append(entry)
    per_sector = {}
    for sector, entries in grouped.items():
        if not sector:
            continue
        out = {}
        for key in _MULT_KEYS:
            vals = [e[key] for e in entries if key in e]
            if len(vals) >= _MIN_SECTOR_TICKERS:
                out[key] = statistics.median(vals)
        if out:
            per_sector[sector] = out
    by_year = {}
    for ticker, period, ni, eq, fcf, ocf, rev in annuals:
        by_year.setdefault(ticker, []).append(
            {"period": period, "net_income": ni, "equity": eq,
             "fcf": fcf, "operating_cf": ocf, "revenue": rev})

    return {"ticker": per_ticker, "sector": per_sector, "market": market,
            "annual": by_year, "sectors": sectors}


def history():
    """Built once per export run; a failure degrades rather than aborts."""
    global _HIST
    if _HIST is None:
        try:
            _HIST = _build_history()
        except Exception as e:
            print(f"    ! historical multiples unavailable: {e}")
            _HIST = {"ticker": {}, "sector": {}, "market": {}, "annual": {},
                     "sectors": {}}
    return _HIST


# A sector whose earnings collapsed shows a P/E that is an artefact of the
# denominator, not a bar anyone would pay: hospitality measures 69.1x because
# the sector earned almost nothing after COVID, and using it would declare those
# stocks worth seven times the market. Clamped to half and two-and-a-half times
# the market's own median, which takes hospitality to 26.6x and leaves every
# ordinary sector alone -- brokers at 16.8x sit inside it.
#
# P/E ONLY. P/S and P/B differ between sectors for real reasons and clamping
# them corrupts the figure: wholesale trades at 0.16x sales because a petrol
# distributor keeps a cent on the dong, and floored to 0.50x it valued PLX at
# +347% of its market price.
_MULT_LO, _MULT_HI = 0.5, 2.5
# Every multiple whose denominator is an earnings or cash-flow figure can go to
# an artefact when that figure approaches zero, so those are clamped; P/S and
# P/B are not, because a sales or book denominator does not collapse and their
# spread between sectors is real.
_CLAMPED_KEYS = ("pe", "pocf", "ev_ebitda")
_MULT_KEYS = ("pe", "pb", "ps", "pocf", "ev_ebitda")


def sector_multiple(sector, key):
    """What this sector has historically traded at, or the market if too few."""
    h = history()
    s = h["sector"].get(sector or "")
    value = s[key] if (s and key in s) else h["market"].get(key)
    if value is None:
        return None
    market = h["market"].get(key)
    if market and key in _CLAMPED_KEYS:
        value = min(max(value, market * _MULT_LO), market * _MULT_HI)
    return value


def _sector_roe(sector):
    """Median trailing ROE of a sector, from the annual cache."""
    h = history()
    annual = h.get("annual") or {}
    sectors = h.get("sectors") or {}
    vals = []
    for ticker, rows in annual.items():
        if sectors.get(ticker) != sector or not rows:
            continue
        roes = []
        for row in rows[:3]:
            ni, eq = row["net_income"], row["equity"]
            if ni is not None and eq and float(eq) > 0:
                roes.append(float(ni) / float(eq))
        if roes:
            vals.append(sum(roes) / len(roes))
    return statistics.median(vals) if len(vals) >= _MIN_SECTOR_TICKERS else None


def justified_sector_pb(ttm, sector, ticker, sec_pb):
    """BVPS x sector P/B, scaled by this company's ROE against its sector's.

    A sector median applied flat says every company in the sector deserves the
    same multiple of book, which marks down exactly the companies that earn
    more on that book -- it read x0.72 of the market price across the 75
    analyst-covered names, the large, high-return ones. P/B and ROE move
    together by construction (P/B = ROE x P/E), so the scaling is the
    relationship itself rather than a fudge: a company earning twice its
    sector's ROE has earned twice its sector's multiple of book.

    Capped at a quarter to four times the sector figure, so a ticker with a
    near-zero or freak ROE cannot run away with it.
    """
    equity = ttm.get("equity")
    shares = ttm.get("shares_outstanding") or 0
    if not equity or equity <= 0 or shares <= 0 or not sec_pb:
        return None
    bvps = equity * 1e9 / (shares * 1e6)
    roe = _avg_annual_roe(ticker)
    sector_roe = _sector_roe(sector)
    scale = 1.0
    if roe and sector_roe and sector_roe > 0 and roe > 0:
        scale = min(max(roe / sector_roe, 0.25), 4.0)
    price = bvps * sec_pb * scale
    return round(price) if price > 0 else None


def _sector_margin(sector, numerator):
    """Median trailing margin of a sector -- net income or OCF over revenue."""
    h = history()
    annual = h.get("annual") or {}
    sectors = h.get("sectors") or {}
    vals = []
    for ticker, rows in annual.items():
        if sectors.get(ticker) != sector or not rows:
            continue
        margins = []
        for row in rows[:3]:
            value, revenue = row.get(numerator), row.get("revenue")
            if value is not None and revenue and float(revenue) > 0:
                margins.append(float(value) / float(revenue))
        if margins:
            vals.append(sum(margins) / len(margins))
    return statistics.median(vals) if len(vals) >= _MIN_SECTOR_TICKERS else None


def _own_margin(ticker, numerator):
    rows = _annual_rows(ticker, 3)
    margins = []
    for row in rows:
        value, revenue = row.get(numerator), row.get("revenue")
        if value is not None and revenue and float(revenue) > 0:
            margins.append(float(value) / float(revenue))
    return sum(margins) / len(margins) if margins else None


def _driver_scale(ticker, sector, numerator):
    """How this company's margin compares with its sector's, clamped.

    A sector median applied flat says every company in the sector deserves the
    same multiple of sales or of cash flow, which marks down precisely the ones
    that convert sales into more profit or more cash. The fix is the same one
    the sector P/B gets from ROE, applied to the fundamental that drives each
    multiple: P/S is P/E times net margin, and P/OCF moves with cash
    conversion, so each is scaled by its own driver rather than by a fudge.

    Measured on the 75 analyst-covered names -- the large, high-margin ones --
    the flat versions read ps x0.74 and pocf x0.64 of the market price.
    """
    own = _own_margin(ticker, numerator)
    sec = _sector_margin(sector, numerator)
    if not own or not sec or sec <= 0 or own <= 0:
        return 1.0
    return min(max(own / sec, 0.25), 4.0)


def own_multiple(ticker, key):
    """What this ticker itself has historically traded at.

    Clamped for the same reason the sector figure is, and against the same
    market yardstick: a company whose earnings are tiny relative to its price
    shows a P/E that measures the denominator, not the market's opinion. VIC's
    own median P/E is 43x, which valued it at 152,022 VND against 22,397 from
    its own median P/B -- a sevenfold spread inside one family of methods.
    """
    value = history()["ticker"].get(ticker, {}).get(key)
    if value is None:
        return None
    market = history()["market"].get(key)
    if market and key in _CLAMPED_KEYS:
        value = min(max(value, market * _MULT_LO), market * _MULT_HI)
    return value


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


def _annual_rows(ticker: str, years: int):
    """The last few annual reports for a ticker, newest first, from the cache."""
    return (history().get("annual") or {}).get(ticker, [])[:years]


def _annual_roes(ticker: str, years: int = 8):
    """ROE for each of the last few annual reports, newest first."""
    out = []
    for row in _annual_rows(ticker, years):
        ni, eq = row["net_income"], row["equity"]
        if ni is not None and eq and float(eq) > 0:
            ni, eq = float(ni), float(eq)
            if ni == ni and eq == eq:
                out.append(ni / eq)
    return out


def _fade_years(ticker: str, ke: float) -> float:
    """How long to let the excess return last, from how long it has lasted."""
    roes = _annual_roes(ticker)
    if len(roes) < 3:
        return _FADE_DEFAULT
    beat = sum(1 for r in roes if r > ke) / len(roes)
    return _FADE_MIN + (_FADE_MAX - _FADE_MIN) * beat


def _avg_annual_roe(ticker: str, years: int = 3):
    """Mean ROE over the last few annual reports -- the sustainable figure the
    model wants, rather than one TTM window a single trading quarter can swing.

    Three years rather than five: bank ROE has been falling across the sector
    (VCB 20.2% in 2021 to 15.7% in 2025), so a five-year mean prices earning
    power the bank no longer has.
    """
    vals = _annual_roes(ticker, years)
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
# A flat ten-year fade said VNM and a steel mill both stop out-earning their
# cost of capital on the same schedule. VNM has beaten its cost of equity in
# every year on file; the steel mill has not. So the horizon is measured: the
# share of the available annual reports in which ROE actually exceeded Ke,
# stretched over a 5-to-20 year range.
#
# Five years at the bottom because even a commodity producer's current returns
# do not vanish overnight, twenty at the top because a franchise that has
# out-earned its capital every year on record has earned the benefit of the
# doubt -- and because beyond twenty years the discounting makes the difference
# immaterial anyway. A company with no annual history keeps the old ten.
_FADE_MIN, _FADE_MAX = 5, 20
_FADE_DEFAULT = 10
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
    horizon = _fade_years(ticker, ke)
    total = 0.0
    for t in range(1, int(round(horizon)) + 1):
        roe_t = roe - (roe - ke) * (t / horizon)
        total += (roe_t - ke) * ((1 + g) ** (t - 1)) / ((1 + ke) ** t)
    pb = max(_PB_MIN, min(1.0 + total, _PB_MAX))
    price = equity * 1_000 / shares * pb
    return round(price) if price > 0 else None


def own_pb_price(ttm: dict, ticker: str):
    """BVPS x the median P/B this ticker has actually traded at."""
    equity = ttm.get("equity")
    shares = ttm.get("shares_outstanding") or 0
    if not equity or equity <= 0 or shares <= 0:
        return None
    pb = own_multiple(ticker, "pb")
    if not pb or pb <= 0:
        return None
    price = equity * 1_000 / shares * pb
    return round(price) if price > 0 else None


def own_pe_price(ttm: dict, ticker: str):
    """EPS (TTM) x the median P/E this ticker has actually traded at."""
    shares = ttm.get("shares_outstanding") or 0
    ni = ttm.get("net_income")
    if shares <= 0 or not ni or ni <= 0:
        return None
    pe = own_multiple(ticker, "pe")
    if not pe or pe <= 0:
        return None
    price = ni * 1_000 / shares * pe
    return round(price) if price > 0 else None


def _sector_adjust(v: dict, ttm: dict, sector: str, beta=None,
                   ticker: str = "") -> dict:
    """Swap the round-number multiples for what this sector has actually traded at.

    Every sector now carries four market-based anchors -- its own sector's
    historical P/E and P/B, and the ticker's own historical P/E and P/B -- on top
    of whatever model-based methods suit the sector. The four answer different
    questions: "what does the market pay for this kind of company", and "is this
    particular company dear against its own past". Their disagreement is the
    reading, which one method could never give.
    """
    v = dict(v)
    shares = ttm.get("shares_outstanding") or 0
    equity = ttm.get("equity")
    net_income = ttm.get("net_income")

    def _per_share(val_bn, mult):
        return round(val_bn * 1e9 / (shares * 1e6) * mult) if (val_bn and shares > 0 and mult) else None

    sec_pe = sector_multiple(sector, "pe")
    sec_pb = sector_multiple(sector, "pb")
    sec_ps = sector_multiple(sector, "ps")
    sec_pocf = sector_multiple(sector, "pocf")
    sec_ev = sector_multiple(sector, "ev_ebitda")

    # The sector's own bar, in place of MARKET_PE = 15 and TARGET_PB = 1.5.
    v["pe"] = _per_share(net_income, sec_pe) if (net_income and net_income > 0) else None
    v["pb"] = justified_sector_pb(ttm, sector, ticker, sec_pb)
    v["ps"] = _per_share(ttm.get("revenue"),
                         sec_ps and sec_ps * _driver_scale(ticker, sector, "net_income"))

    # Graham's 22.5 is 15 x 1.5, the same two numbers -- so it takes the same
    # correction rather than keeping a constant that no longer matches either.
    if (sec_pe and sec_pb and net_income and net_income > 0 and equity
            and equity > 0 and shares > 0):
        eps = net_income * 1e9 / (shares * 1e6)
        bvps = equity * 1e9 / (shares * 1e6)
        v["graham"] = round((sec_pe * sec_pb * eps * bvps) ** 0.5)
    else:
        v["graham"] = None

    # The fixed 10x P/OCF and 8x EV/EBITDA get the same treatment as P/E and
    # P/B: the sector's own measured level instead of a round number.
    #
    # On the TRAILING cash flow, not the normalised one. The multiple was
    # measured against trailing OCF, so pairing it with a five-year mean mixes
    # two bases and understates everything -- it put HPG at -66% of its market
    # price, VHM at -80% and PLX at -76%. Normalising belongs to the DCF and
    # FCFE, which capitalise the figure into perpetuity and so need a run rate;
    # a multiple on a trailing figure is a relative statement and only needs
    # both sides measured the same way.
    ocf = ttm.get("operating_cf")  # trailing, to match how the multiple was measured
    v["pocf"] = _per_share(
        ocf, sec_pocf and sec_pocf * _driver_scale(ticker, sector, "operating_cf")
    ) if (ocf and ocf > 0) else None
    ebitda = ttm.get("ebitda") or (((ttm.get("ebit") or 0) + (ttm.get("depreciation") or 0))
                                   if ttm.get("ebit") else None)
    if ebitda and ebitda > 0 and sec_ev and shares > 0:
        ev_bn = ebitda * sec_ev - ((ttm.get("debt") or 0) - (ttm.get("cash") or 0))
        v["ev_ebitda"] = round(ev_bn * 1e9 / (shares * 1e6)) if ev_bn > 0 else None
    else:
        v["ev_ebitda"] = None

    # What the market has paid for THIS company, not its sector.
    v["pb_own"] = own_pb_price(ttm, ticker)
    v["pe_own"] = own_pe_price(ttm, ticker)

    # residual_income_implied() defaults g to 0.12 against a CoE of 0.13, so its
    # denominator is 0.01 and every excess point of ROE is multiplied by a
    # hundred. Fixing that for banks left it live for the other 380 tickers,
    # where it was the wildest method on the page: VHM read +754% against its
    # market price, MWG +445%, PNJ +350%, HPG +263%. The faded version uses the
    # ticker's own cost of equity and lets the excess return die over ten years,
    # which is the model these numbers were always meant to be.
    v["ri"] = rim_fade_price(ttm, beta, ticker)

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
        # Two model-based anchors join the four market-based ones. The justified
        # P/B assumes today's ROE lasts for ever; the faded RIM lets the excess
        # return die over ten years. EV/EBITDA and EPV go: a bank's interest
        # expense is an operating cost, so an EBITDA for one is not a number, and
        # EPV on pre-provision profit ignores the credit cost that defines the
        # business.
        v["pb"] = justified_pb_price(ttm, beta, ticker)
        v["pb_sector"] = justified_sector_pb(ttm, sector, ticker, sec_pb)
        # A bank's P/E is its P/B divided by its ROE, so a sector P/E adds no
        # information that pb_sector does not already carry -- and applying the
        # sector's 5.3x median to VCB, the one bank the market pays a real
        # premium for, marked it -55% for being better than average.
        for k in ("pe", "ps", "ev_ebitda", "epv", "graham"):
            v[k] = None
    elif sector == "Chứng khoán":
        # Measured, the equity models fail here the mirror image of how the
        # multiples failed for banks: a broker's three-year average ROE (3-14%)
        # sits BELOW its cost of equity (10.5-15.6%), so the justified P/B lands
        # under 1 for 11 of 20 and the floor binds. Gordon would put the sector
        # at -45% and the faded RIM at -29% while the market pays 1.15x book.
        # Broker earnings are cyclical -- 2021 a boom, 2022-23 a bust -- so a
        # trailing mean understates mid-cycle power, and their book is mostly
        # liquid marked-to-market assets, which is why the market will not price
        # it below one. They are judged on what the market pays instead: own and
        # sector P/E and P/B, median +6% each.
        v["ev_ebitda"] = None
        v["epv"] = None
    elif sector == "Bảo hiểm":
        # 2x revenue for an insurer is 2x gross premium, and a premium buys a
        # future claim as much as a fee -- the sector nets 5-7% of it. That
        # multiple implied a P/E near 40 and measured x3.83 the market price, the
        # widest overshoot of any method in any sector. Book value carries the
        # float, so the sector is judged on equity instead.
        v["ps"] = None
        v["ev_ebitda"] = None
        if equity and shares > 0:
            v["epv"] = round(equity * 2.0 * 1e9 / (shares * 1e6))
    elif sector == "Bất động sản":
        # The hand-set 15x EBITDA is gone -- the sector's measured multiple does
        # that job now. Book still stands in for the land bank, which reported
        # revenue (whatever was handed over this year) cannot.
        if equity and shares > 0:
            v["epv"] = round(equity * 1.8 * 1e9 / (shares * 1e6))
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

    # The panel prints the multiple beside each card, so a reader can see that
    # "P/E ngành" means 7.7x for a bank and 16.0x for a broker rather than one
    # hidden constant for everyone.
    for key, name in (("pe", "sec_pe"), ("pb", "sec_pb"), ("ps", "sec_ps"),
                      ("pocf", "sec_pocf"), ("ev_ebitda", "sec_ev")):
        x = sector_multiple(sector, key)
        if x:
            params[name] = round(x, 2)
    for key, name in (("pe", "own_pe"), ("pb", "own_pb")):
        x = own_multiple(ticker, key)
        if x:
            params[name] = round(x, 2)

    adj = _sector_adjust(_all_methods(ttm, ticker), ttm, sector, beta, ticker)
    try:
        params["fade_years"] = round(_fade_years(
            ticker, cost_of_equity(_blume(beta))), 1)
    except Exception:
        pass

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

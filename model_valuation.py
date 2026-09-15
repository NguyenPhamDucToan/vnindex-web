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
                   Financial.shares_outstanding, Financial.net_income, Financial.revenue)
            .where(Financial.period_type == "Q").order_by(Financial.ticker, Financial.period)
        ).all()
        closes = session.execute(
            select(Price.ticker, Price.date, Price.close).order_by(Price.ticker, Price.date)
        ).all()

    rows_by_ticker = {}
    for row in quarters:
        rows_by_ticker.setdefault(row[0], []).append(row)

    marks = {}
    for ticker, rows in rows_by_ticker.items():
        out = []
        for i, row in enumerate(rows):
            _, period, equity, shares, _ni, _rev = row
            usable = _quarter_usable_from(period)
            if usable is None or not shares or float(shares) <= 0:
                continue
            window = rows[max(0, i - 3):i + 1]
            incomes = [r[4] for r in window]
            revenues = [r[5] for r in window]
            full = len(window) == 4
            bvps = (float(equity) * 1_000 / float(shares)) if equity and float(equity) > 0 else None
            eps = (sum(float(x) for x in incomes) * 1_000 / float(shares)
                   if full and all(x is not None for x in incomes) else None)
            sps = (sum(float(x) for x in revenues) * 1_000 / float(shares)
                   if full and all(x is not None for x in revenues) else None)
            out.append((usable, bvps, eps, sps))
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
        pes, pbs, pss = [], [], []
        i, bvps, eps, sps = 0, None, None, None
        for when, close in rows:
            while i < len(mk) and mk[i][0] <= when:
                bvps, eps, sps = mk[i][1], mk[i][2], mk[i][3]
                i += 1
            price = float(close) * 1_000
            if bvps and bvps > 0:
                pbs.append(price / bvps)
            if eps and eps > 0:
                pes.append(price / eps)
            if sps and sps > 0:
                pss.append(price / sps)
        entry = {}
        if len(pbs) >= _MIN_OBS:
            entry["pb"] = statistics.median(pbs)
        if len(pes) >= _MIN_OBS:
            entry["pe"] = statistics.median(pes)
        if len(pss) >= _MIN_OBS:
            entry["ps"] = statistics.median(pss)
        if entry:
            per_ticker[ticker] = entry

    market = {}
    for key in ("pe", "pb", "ps"):
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
        for key in ("pe", "pb", "ps"):
            vals = [e[key] for e in entries if key in e]
            if len(vals) >= _MIN_SECTOR_TICKERS:
                out[key] = statistics.median(vals)
        if out:
            per_sector[sector] = out
    return {"ticker": per_ticker, "sector": per_sector, "market": market}


def history():
    """Built once per export run; a failure degrades rather than aborts."""
    global _HIST
    if _HIST is None:
        try:
            _HIST = _build_history()
        except Exception as e:
            print(f"    ! historical multiples unavailable: {e}")
            _HIST = {"ticker": {}, "sector": {}, "market": {}}
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
_CLAMPED_KEYS = ("pe",)


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


def own_multiple(ticker, key):
    """What this ticker itself has historically traded at."""
    return history()["ticker"].get(ticker, {}).get(key)


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

    # The sector's own bar, in place of MARKET_PE = 15 and TARGET_PB = 1.5.
    v["pe"] = _per_share(net_income, sec_pe) if (net_income and net_income > 0) else None
    v["pb"] = _per_share(equity, sec_pb)
    v["ps"] = _per_share(ttm.get("revenue"), sec_ps)

    # Graham's 22.5 is 15 x 1.5, the same two numbers -- so it takes the same
    # correction rather than keeping a constant that no longer matches either.
    if (sec_pe and sec_pb and net_income and net_income > 0 and equity
            and equity > 0 and shares > 0):
        eps = net_income * 1e9 / (shares * 1e6)
        bvps = equity * 1e9 / (shares * 1e6)
        v["graham"] = round((sec_pe * sec_pb * eps * bvps) ** 0.5)
    else:
        v["graham"] = None

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
        v["pb_sector"] = _per_share(equity, sec_pb)
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
        # A developer's reported revenue is whatever handed over this year, so
        # EBITDA carries a longer multiple and book stands in for the land bank.
        eb = (ttm.get("ebit") or 0) + (ttm.get("depreciation") or 0)
        nd = (ttm.get("debt") or 0) - (ttm.get("cash") or 0)
        if eb > 0 and shares > 0:
            ev = eb * 15 - nd
            v["ev_ebitda"] = round(ev * 1e9 / (shares * 1e6)) if ev > 0 else None
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
    for key, name in (("pe", "sec_pe"), ("pb", "sec_pb"), ("ps", "sec_ps")):
        x = sector_multiple(sector, key)
        if x:
            params[name] = round(x, 2)
    for key, name in (("pe", "own_pe"), ("pb", "own_pb")):
        x = own_multiple(ticker, key)
        if x:
            params[name] = round(x, 2)

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

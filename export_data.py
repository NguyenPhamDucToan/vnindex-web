"""Export the valuation database to static JSON for the raw HTML/JS frontend.

The Python pipeline in ../vnindex-valuation stays the producer: it fetches from
vnstock, computes DCF/multiples/ratios, and writes the `valuations`/`prices`/
`financials` tables (SQLite locally, or Supabase Postgres via DATABASE_URL).
This script is the bridge -- it reads those already-computed rows and dumps
them as flat JSON files the browser can `fetch()` directly. No server, no
cold-boot: the frontend is fully static.

Run it wherever DATABASE_URL points at the live DB (locally, or in the same
GitHub Actions job that runs the daily refresh):

    DATABASE_URL=postgresql://...  python export_data.py

Outputs (all under ./data):
  companies.json          -- {ticker, name, sector, exchange} for the picker
  screener.json           -- latest valuation row per ticker (key fields)
  ticker/<TICKER>.json    -- company + latest valuation (all fields) +
                             quarterly financials + ~2y daily prices +
                             valuation history (dcf/avg over time)
  meta.json               -- {generated_at, n_tickers, price_from}
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

# The sibling Python project owns the valuation logic; add it to the path so
# model_valuation.py can reuse compute_ttm + the multiples to produce the
# sector-adjusted model price (the number the Streamlit app actually shows).
_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))

# Reuse the sibling project's .env if this script is run without DATABASE_URL
# already in the environment -- convenient for local one-off exports.
_DB_URL = os.getenv("DATABASE_URL")
if not _DB_URL:
    _env = Path(__file__).resolve().parent.parent / "vnindex-valuation" / ".env"
    if _env.exists():
        for line in _env.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                _DB_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
if not _DB_URL:
    raise SystemExit("DATABASE_URL not set and no ../vnindex-valuation/.env found")

# Name psycopg2 explicitly. SQLAlchemy 2.1 made psycopg 3 the default for a
# bare postgresql:// URL, and psycopg 3's server-side prepared statements
# collide behind Supabase's transaction pooler ("prepared statement _pg3_0
# already exists").
for _bare in ("postgres://", "postgresql://"):
    if _DB_URL.startswith(_bare):
        _DB_URL = "postgresql+psycopg2://" + _DB_URL[len(_bare):]
        break

# The sibling's config.py reads DATABASE_URL from the environment (not our
# local .env parse), so publish it before importing model_valuation -- otherwise
# compute_ttm falls back to an empty local SQLite and every TTM comes up missing.
os.environ["DATABASE_URL"] = _DB_URL

OUT = Path(__file__).resolve().parent / "data"
(OUT / "ticker").mkdir(parents=True, exist_ok=True)

PRICE_WINDOW_DAYS = 760          # ~2 trading years of daily candles per ticker
_price_from = (date.today() - timedelta(days=PRICE_WINDOW_DAYS)).isoformat()


def _clean(v):
    """JSON-safe scalar: NaN/inf -> None, numpy -> python, dates -> ISO string."""
    if v is None:
        return None
    if isinstance(v, float):
        return None if (math.isnan(v) or math.isinf(v)) else round(v, 6)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if hasattr(v, "item"):            # numpy scalar
        return _clean(v.item())
    return v


def _records(df: pd.DataFrame) -> list[dict]:
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict("records")]


# fetch_foreign runs once per ticker inside the export loop. If VNDirect stops
# answering, 641 tickers at a 12s timeout is over two hours -- past the job's
# limit, so the site would not deploy at all. After this many failures in a
# row the rest of the run skips the call and keeps each ticker's committed
# foreign block; a success resets the count.
_FOREIGN_MAX_FAILS = 8
_foreign_fails = 0
_prop_fails = 0                 # same breaker, separate count, for fetch_prop


_prop_asof = None


def prop_asof() -> "str | None":
    """Newest session in VNDirect's proprietary feed, any ticker. The feed lags
    the price data by a day (2026-11-13 prices, 11-12 desks), so a session
    after this date is "not published yet", not "no trading"."""
    global _prop_asof
    if _prop_asof is None:
        import requests
        try:
            r = requests.get("https://api-finfo.vndirect.com.vn/v4/proprietary_trading?size=1&sort=date:desc",
                             timeout=12, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json",
                                                  "Referer": "https://dstock.vndirect.com.vn/"})
            _prop_asof = str(r.json()["data"][0]["date"])[:10]
        except Exception:
            _prop_asof = ""
    return _prop_asof or None


def fetch_prop(code: str, sessions: int = 30) -> "list[dict] | None":
    """Brokers' proprietary-desk ("tự doanh") trading for the last N sessions,
    from VNDirect finfo -- the same host as the foreign flow.

    A row exists only for a session the desks traded the ticker: the large
    caps have one every day, a small cap a handful a month (ACG, DPR none since
    September), so a missing date means no proprietary trading, not missing
    data. None = the call failed; [] = no rows.
    """
    global _prop_fails
    import requests
    from datetime import timedelta
    if _prop_fails >= _FOREIGN_MAX_FAILS:
        return None
    try:
        start = (date.today() - timedelta(days=sessions * 3 + 20)).strftime("%Y-%m-%d")
        r = requests.get("https://api-finfo.vndirect.com.vn/v4/proprietary_trading"
                         f"?q=code:{code}~date:gte:{start}&size=200&sort=date:asc",
                         timeout=12, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json",
                                              "Referer": "https://dstock.vndirect.com.vn/"})
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")
        rows = [{
            "date": str(d.get("date")),
            "buy_vol": _clean(float(d.get("buyingVol") or 0)),
            "sell_vol": _clean(float(d.get("sellingVol") or 0)),
            "net_vol": _clean(float(d.get("netVol") or 0)),
            "buy_val": _clean(float(d.get("buyingVal") or 0)),
            "sell_val": _clean(float(d.get("sellingVal") or 0)),
            "net_val": _clean(float(d.get("netVal") or 0)),
            # share of the session's matched value, as fractions
            "buy_pct": _clean(float(d.get("buyingValPct") or 0)),
            "sell_pct": _clean(float(d.get("sellingValPct") or 0)),
        } for d in r.json().get("data", [])]
        _prop_fails = 0
        return rows[-sessions:]
    except Exception as e:
        _prop_fails += 1
        if _prop_fails == _FOREIGN_MAX_FAILS:
            print(f"  ! VNDirect proprietary flow failed {_FOREIGN_MAX_FAILS} times in a row "
                  f"(last: {e}); keeping committed data for the rest of the run", flush=True)
        return None


def _db_retry(fn, waits=(5, 15)):
    """Run fn, retrying when the database connection drops mid-export.

    model_price queries Supabase per ticker, and one dropped connection --
    "connection timed out" to the pooler, seen 2026-11-02 -- otherwise
    publishes that ticker with no model price until the next day's export.
    Only connection-level errors are retried; anything else is a real bug
    and is raised at once.
    """
    from sqlalchemy.exc import InterfaceError, OperationalError
    for wait in (*waits, None):
        try:
            return fn()
        except (OperationalError, InterfaceError) as e:
            if wait is None:
                raise
            print(f"    ~ database connection dropped ({type(e).__name__}); "
                  f"retrying in {wait}s", flush=True)
            time.sleep(wait)


def fetch_foreign(code: str, sessions: int = 30) -> "list[dict] | None":
    """Foreign net trading (VND) for the last N sessions, from VNDirect finfo.

    None means the call failed (or was skipped after repeated failures), as
    opposed to [] for a ticker VNDirect has no rows for.
    """
    global _foreign_fails
    import requests
    from datetime import timedelta
    if _foreign_fails >= _FOREIGN_MAX_FAILS:
        return None
    try:
        start = (date.today() - timedelta(days=sessions * 3 + 20)).strftime("%Y-%m-%d")
        url = ("https://api-finfo.vndirect.com.vn/v4/foreigns"
               f"?q=code:{code}~tradingDate:gte:{start}&size=200&sort=tradingDate:asc")
        r = requests.get(url, timeout=12, headers={
            "User-Agent": "Mozilla/5.0", "Accept": "application/json",
            "Referer": "https://dstock.vndirect.com.vn/"})
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")
        rows = []
        for d in r.json().get("data", [])[-sessions:]:
            rows.append({
                "date": str(d.get("tradingDate")),
                "net_val": _clean(float(d.get("netVal") or 0)),
                "buy_val": _clean(float(d.get("buyVal") or 0)),
                "sell_val": _clean(float(d.get("sellVal") or 0)),
                "buy_vol": _clean(float(d.get("buyVol") or 0)),
                "sell_vol": _clean(float(d.get("sellVol") or 0)),
                "net_vol": _clean(float(d.get("netVol") or 0)),
            })
        _foreign_fails = 0
        return rows
    except Exception as e:
        _foreign_fails += 1
        if _foreign_fails == _FOREIGN_MAX_FAILS:
            print(f"  ! VNDirect foreign flow failed {_FOREIGN_MAX_FAILS} times in a row "
                  f"(last: {e}); keeping committed foreign data for the rest of the run",
                  flush=True)
        return None


def load_vnindex() -> "pd.Series | None":
    """VNINDEX daily closes, fetched once and reused as the market series.

    valuation.wacc.compute_beta() re-fetches VNINDEX per ticker, which would
    mean 400+ rate-limited calls here; the maths is identical if we pull the
    index once and align each ticker's own price history against it.

    VNDirect first, then VCI/SSI through vndata. (VNDirect led because vnstock
    5 rounded the index to two decimals after dividing it by 1000; vndata
    returns the index in points, but the order has a long track record.)
    """
    s = _load_vnindex_vndirect()
    if s is not None:
        return s
    try:
        from vndata import Quote
        raw = Quote(symbol="VNINDEX").history(
            start=(date.today() - timedelta(days=520)).isoformat(),
            end=date.today().isoformat(), interval="1D")
        if raw is None or len(raw) < 60:
            return None
        s = raw[["time", "close"]].copy()
        s["time"] = pd.to_datetime(s["time"]).dt.date
        return s.set_index("time")["close"]
    except Exception:
        return None


def _load_vnindex_vndirect() -> "pd.Series | None":
    """VNINDEX closes from VNDirect's chart feed, for when vnstock refuses.

    vnstock 5 counts every GitHub runner as a new device, and once the free
    tier's device limit is reached every call fails. Without this the index
    series came back empty: market.json shipped no VNINDEX points, and every
    ticker's beta fell back to 1.2, which gave all 21 banks the same cost of
    equity (VCB measures ~0.73).
    """
    import requests
    from datetime import datetime, timezone
    try:
        now = int(datetime.now(timezone.utc).timestamp())
        r = requests.get(
            "https://dchart-api.vndirect.com.vn/dchart/history",
            params={"resolution": "D", "symbol": "VNINDEX",
                    "from": now - 520 * 86400, "to": now},
            timeout=20, headers={"User-Agent": "Mozilla/5.0",
                                 "Referer": "https://dchart.vndirect.com.vn/"})
        j = r.json() if r.status_code == 200 else {}
        t, c = j.get("t") or [], j.get("c") or []
        if j.get("s") != "ok" or len(t) < 60 or len(t) != len(c):
            return None
        idx = [datetime.fromtimestamp(x, timezone.utc).date() for x in t]
        return pd.Series([float(x) for x in c], index=idx, name="close")
    except Exception:
        return None


# HOSE caps an ordinary session at +-7%, so a close that moves further than
# that against the previous one is not a market move -- it is a split or a
# bonus issue that the price feed never adjusted for. collectors/prices.py sets
# adjusted_close = close because vnstock's VCI source offers no adjusted
# series, so the raw jumps reach every chart: TRA fell 80.10 -> 38.17 on
# 2026-07-17, VHM 148.00 -> 76.45, PHR 61.40 -> 32.78. 28 of 403 tickers carry
# one inside the one-year window the performance chart and the risk metrics
# use, and it inflated annualised volatility by up to 2x (AAN 60.2% against a
# true 30.1%). Back-adjusting here rather than in the database keeps the raw
# series intact -- a bad detection is undone by re-exporting.
#
# The rules live in corp_actions.py (exchange ex-dates and ratios) with
# backtest_engine.adjust_prices as the fallback for tickers without them.


def issuance_dates(ticker: str) -> set:
    """Ex-entitlement dates for a ticker, from its stored corporate events.

    The price series alone cannot tell a split from a crash. NTC fell 15.1%,
    14.4% and 14.1% on three sessions of the April 2025 selloff, two of them
    gapping at the open, and no test on prices separated that from a bonus
    issue. The exchange's own event list does: every genuine action in the data
    has a "Phát hành cổ phiếu" (ISS) event within one to four days of the gap,
    while NTC's nearest entitlement is 133 days away.
    """
    f = OUT / "ticker" / f"{ticker}.json"
    if not f.exists():
        return set()
    try:
        obj = json.loads(f.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return set()
    out = set()
    for e in ((obj.get("news_events") or {}).get("events") or []):
        if e.get("code") != "ISS":
            continue
        d = str(e.get("date") or "")[:10]
        try:
            out.add(date.fromisoformat(d))
        except ValueError:
            continue
    return out


def compute_beta_from(prices_df, vni: "pd.Series | None", days: int = 252) -> float:
    """β = Cov(stock, market) / Var(market) on daily returns — same as wacc.compute_beta."""
    DEFAULT_BETA = 1.2
    if vni is None or prices_df is None or len(prices_df) < 60:
        return DEFAULT_BETA
    try:
        s = prices_df.tail(days + 10)[["date", "close"]].copy()
        s["date"] = pd.to_datetime(s["date"]).dt.date
        m = vni.rename("mkt")
        j = s.set_index("date").join(m, how="inner").dropna()
        if len(j) < 60:
            return DEFAULT_BETA
        rs = j["close"].pct_change().dropna()
        rm = j["mkt"].pct_change().dropna()
        n = min(len(rs), len(rm))
        if n < 60:
            return DEFAULT_BETA
        rs, rm = rs.iloc[-n:], rm.iloc[-n:]
        var = float(rm.var())
        if not var:
            return DEFAULT_BETA
        beta = float(rs.cov(rm)) / var
        # wacc.compute_beta clamps to [0.2, 3.0] rather than falling back.
        return round(min(max(beta, 0.2), 3.0), 4)
    except Exception:
        return DEFAULT_BETA


def fetch_analyst(ticker: str) -> dict | None:
    """Current analyst target/rating from VCI via vndata (name omitted on purpose)."""
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from vndata import Company
            ov = Company(symbol=ticker, source="VCI").overview()
        if ov is None or ov.empty:
            return None
        row = ov.iloc[0]
        tp = float(row.get("target_price") or 0)
        if not tp:
            return None
        return {"target_price": _clean(tp), "rating": str(row.get("rating") or "")}
    except (Exception, SystemExit):
        return None


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")


def main() -> None:
    # Imported here so sys.path (set at module load) already includes the
    # sibling valuation package.
    from model_valuation import model_price
    from export_actions import insider_net
    from valuation.scores import compute_scores
    from valuation.wacc import wacc as _wacc_calc, DEFAULT_COD

    engine = create_engine(_DB_URL, pool_pre_ping=True)
    print(f"Connected: {engine.dialect.name}")
    vni = load_vnindex()
    print(f"  VNINDEX series: {'ok' if vni is not None else 'unavailable (beta falls back)'}")

    with engine.connect() as conn:
        companies = pd.read_sql(
            text("SELECT ticker, name, sector, industry, exchange, "
                 "shares_outstanding_current, shares_updated_at "
                 "FROM companies WHERE is_active = TRUE ORDER BY ticker"),
            conn)
        print(f"  companies: {len(companies)}")

        # Latest valuation per ticker -- one row each, newest calc_date wins.
        valuations = pd.read_sql(text("""
            SELECT v.* FROM valuations v
            JOIN (SELECT ticker, MAX(calc_date) AS d FROM valuations GROUP BY ticker) m
              ON v.ticker = m.ticker AND v.calc_date = m.d
        """), conn)
        print(f"  latest valuations: {len(valuations)}")

        # Full valuation history (small: ~17k rows) for the price-vs-value chart.
        val_hist = pd.read_sql(text(
            "SELECT ticker, calc_date, dcf_estimate, avg_intrinsic_value, upside_pct "
            "FROM valuations ORDER BY ticker, calc_date"), conn)

        financials = pd.read_sql(text(
            "SELECT * FROM financials ORDER BY ticker, period_type, period"), conn)
        print(f"  financials: {len(financials)}")

        prices = pd.read_sql(text(
            "SELECT ticker, date, open, high, low, close, volume "
            "FROM prices WHERE date >= :d ORDER BY ticker, date"),
            conn, params={"d": _price_from})
        print(f"  prices (>= {_price_from}): {len(prices)}")

    # ---- companies.json + screener.json --------------------------------
    _write(OUT / "companies.json", _records(companies))

    sec_by_ticker = dict(zip(companies.ticker, companies.sector))
    name_by_ticker = dict(zip(companies.ticker, companies.name))
    screen_cols = ["ticker", "pe", "pb", "roe", "net_margin", "avg_intrinsic_value",
                   "dcf_estimate", "fcfe_estimate", "graham_number", "upside_pct",
                   "debt_to_equity", "current_ratio", "profit_quality", "fcf_margin"]
    screener = valuations[[c for c in screen_cols if c in valuations.columns]].copy()
    screener["name"] = screener.ticker.map(name_by_ticker)
    screener["sector"] = screener.ticker.map(sec_by_ticker)
    # screener.json is written after the per-ticker loop below, once the
    # sector-adjusted model price/upside has been computed for each ticker.

    # ---- per-ticker files ----------------------------------------------
    val_by_ticker = {t: g for t, g in valuations.groupby("ticker")}
    fin_by_ticker = {t: g for t, g in financials.groupby("ticker")}

    # A bonus issue after the last balance-sheet date leaves the reported share
    # count stale, so market cap comes out too low and every per-share figure
    # too high -- TRA showed 41.5m shares against 82.9m actually in issue. The
    # valuation layer already prefers the live count (valuation/inputs.py);
    # apply the same substitution to the newest quarterly row so the figures the
    # front end derives for itself -- market cap, cash flow per share, the
    # comparison table -- rest on the same base.
    _live_shares = {r.ticker: float(r.shares_outstanding_current)
                    for r in companies.itertuples()
                    if getattr(r, "shares_outstanding_current", None)}
    _sh_fixed = 0
    for _t, _g in fin_by_ticker.items():
        _live = _live_shares.get(_t)
        if not _live:
            continue
        _q = _g.index[_g["period_type"] == "Q"]
        if not len(_q):
            continue
        _last = _q[-1]
        _rep = _g.at[_last, "shares_outstanding"]
        if _rep and abs(float(_live) / float(_rep) - 1.0) > 0.01:
            _g = _g.copy()
            _g.at[_last, "shares_outstanding"] = _live
            fin_by_ticker[_t] = _g
            _sh_fixed += 1
            print(f"    shares {_t}: {float(_rep):,.1f}m reported -> {_live:,.1f}m in issue")
    print(f"  share count restated for {_sh_fixed} tickers")
    px_by_ticker = {t: g for t, g in prices.groupby("ticker")}
    # Only real companies: covered warrants have no price band, so their genuine
    # swings would be "corrected" into nonsense.
    _real = set(financials["ticker"].unique())
    # Stored prices are VCI's adjusted history. corp_actions.py is a safety net
    # for a seam the collector failed to reload (an isolated gap beyond 15%).
    import corp_actions
    _ca_total = 0
    for _t in list(px_by_ticker):
        if _t not in _real:
            continue
        _adj, _ev = corp_actions.adjust(px_by_ticker[_t])
        if _ev:
            px_by_ticker[_t] = _adj
            _ca_total += len(_ev)
            print(f"    price seam {_t}: " + ", ".join(f"{d} x{r}" for d, r in _ev))
    print(f"  removed {_ca_total} price seams")
    hist_by_ticker = {t: g for t, g in val_hist.groupby("ticker")}

    # The market's newest session: a ticker whose own last close is older than
    # this has stopped trading, and every price-derived figure it carries is as
    # old as that close.
    market_last_date = pd.to_datetime(prices["date"]).max() if len(prices) else None

    n = 0
    _loop_t0 = time.monotonic()
    model_out = {}          # ticker -> {"price": .., "upside": ..} for screener
    change_out = {}         # ticker -> {"chg": .., "close": .., "vol": ..}
    scores_out = {}         # ticker -> valuation/scores.py output
    ins_out = {}            # ticker -> insider net buying, fraction of shares, 12 months
    for _, co in companies.iterrows():
        t = co.ticker
        vg = val_by_ticker.get(t)
        px = px_by_ticker.get(t)
        last_close = float(px["close"].iloc[-1]) if px is not None and len(px) else None
        price_vnd = last_close * 1000 if last_close is not None else None

        model = {"price": None, "upside": None, "methods": {}, "params": {}}
        if vg is not None and len(vg):     # only tickers we actually value
            try:
                # Beta first: the bank valuation needs the ticker's own cost of
                # equity, so it can no longer be computed after the fact.
                _beta = compute_beta_from(px, vni)
                mp, mu, meth, prm = _db_retry(
                    lambda: model_price(t, sec_by_ticker.get(t) or "", price_vnd, _beta))
                prm = dict(prm or {})
                # Ticker-specific beta + WACC, which is what the ROE-vs-cost-of-
                # equity verdict compares against (the DCF uses DEFAULT_BETA).
                _lq = vg.iloc[0] if vg is not None and len(vg) else None
                _fin_q = fin_by_ticker.get(t)
                _dbt = _eqt = None
                if _fin_q is not None and len(_fin_q):
                    _lastq = _fin_q[_fin_q["period_type"] == "Q"].tail(1)
                    if len(_lastq):
                        # NaN is truthy, so `float(x or 0)` returns NaN and
                        # poisons the WACC. All five insurers file no debt line,
                        # their debt came through as NaN, and wacc_ticker landed
                        # as None -- which hid the whole ROIC vs WACC block for
                        # the sector.
                        def _num0(x, dflt):
                            try:
                                f = float(x)
                                return dflt if math.isnan(f) else f
                            except (TypeError, ValueError):
                                return dflt
                        _dbt = _num0(_lastq["debt"].iloc[0], 0.0)
                        _eqt = _num0(_lastq["equity"].iloc[0], 1.0) or 1.0
                prm["beta"] = _clean(_beta)
                prm["wacc_ticker"] = _clean(
                    _wacc_calc(_beta, DEFAULT_COD, _dbt or 0.0, _eqt or 1.0))
                model = {"price": _clean(mp), "upside": _clean(mu),
                         "methods": {k: _clean(x) for k, x in (meth or {}).items()},
                         "params": {k: _clean(x) for k, x in prm.items()}}
            except Exception as e:         # never let one ticker abort the export
                print(f"    ! model {t}: {e}")
        model_out[t] = model

        # Latest daily % change + volume, for the market-overview movers. A
        # suspended ticker has two consecutive rows months apart, and dividing
        # them produced a "daily change" that put it at the top of the movers
        # table and painted its heat-map box: BCG last traded 2025-10-08, 338
        # sessions before the market's newest close. A change between two prices
        # that are not consecutive sessions is not a daily change.
        chg = None
        px_age = None
        if px is not None and len(px) >= 2:
            d_last = pd.to_datetime(px["date"].iloc[-1])
            d_prev = pd.to_datetime(px["date"].iloc[-2])
            px_age = (market_last_date - d_last).days if market_last_date is not None else None
            prev = float(px["close"].iloc[-2])
            if prev and (d_last - d_prev).days <= 10 and (px_age is None or px_age <= 10):
                chg = (last_close - prev) / prev
        change_out[t] = {"chg": _clean(chg), "close": _clean(last_close),
                         "vol": _clean(float(px["volume"].iloc[-1]) if px is not None and len(px) else None),
                         "px_date": _clean(px["date"].iloc[-1]) if px is not None and len(px) else None,
                         "px_age": _clean(px_age),
                         # Mean traded value over the last 20 rows, VND billions
                         # (close is in thousands): the screener's liquidity floor.
                         "adv20": _clean(round(float((px["close"].tail(20) * px["volume"].tail(20)).mean()) / 1e6, 3))
                                  if px is not None and len(px) else None}

        # Fast VNDirect foreign flow inline. Analyst rec is a rate-limited VCI
        # call (~20/min Guest cap, with 57s penalties) so it can't run in this
        # synchronous loop -- export_analyst.py patches it in separately.
        foreign = fetch_foreign(t) if (vg is not None and len(vg)) else []
        prop = fetch_prop(t) if (vg is not None and len(vg)) else []

        # Carry forward whatever export_analyst.py already fetched. Without
        # this, every re-export silently wipes the analyst column and the ~22
        # minute throttled fetch has to be repeated from scratch.
        # Everything the throttled side-loaders produce lives only in these
        # files, so a re-export must carry it forward or it is destroyed:
        # analyst (~22 min), detail + news_events (~80 min) and holders
        # (~40 min). This has bitten once already, on analyst alone.
        carried = {"analyst": None, "detail": None, "news_events": None, "holders": None,
                   "actions": None, "insiders": None, "earnings": None, "foreign": [],
                   "prop": []}
        _prev = OUT / "ticker" / f"{t}.json"
        if _prev.exists():
            try:
                _old = json.loads(_prev.read_text(encoding="utf-8"))
                for k in carried:
                    carried[k] = _old.get(k, carried[k])
            except (ValueError, OSError):
                pass
        if foreign is None:                    # VNDirect failed: keep the last good flow
            foreign = carried["foreign"] or []
        if prop is None:
            prop = carried["prop"] or []

        fin_rows = _records(fin_by_ticker[t]) if t in fin_by_ticker else []
        # Piotroski, Altman Z'', net debt/EBITDA, interest cover, PEG and
        # dividend yield -- formulas live in the sibling's valuation/scores.py.
        scores = {}
        try:
            _val0 = _records(vg)[0] if vg is not None and len(vg) else {}
            scores = compute_scores(
                fin_rows, sec_by_ticker.get(t), price_vnd, pe=_val0.get("pe"),
                dividends=(carried["detail"] or {}).get("dividends"),
                today_year=date.today().year)
        except Exception as e:
            print(f"    ! scores {t}: {e}")
        scores_out[t] = scores
        _q = [r for r in fin_rows if r.get("period_type") == "Q" and r.get("shares_outstanding")]
        ins_out[t] = insider_net(carried["insiders"], float(_q[-1]["shares_outstanding"]) if _q else None,
                                 date.today())

        obj = {
            "company": {k: _clean(co[k]) for k in
                        ("ticker", "name", "sector", "industry", "exchange")},
            "valuation": (_records(vg)[0] if vg is not None and len(vg) else None),
            "model": model,
            "scores": scores,
            "analyst": carried["analyst"],
            "detail": carried["detail"],
            "news_events": carried["news_events"],
            "holders": carried["holders"],
            "actions": carried["actions"],
            "insiders": carried["insiders"],
            "earnings": carried["earnings"],
            "foreign": foreign,
            "prop": prop,
            "prop_asof": prop_asof(),
            "financials": fin_rows,
            "prices": _records(px_by_ticker[t][["date", "open", "high", "low",
                                                "close", "volume"]])
                      if t in px_by_ticker else [],
            "valuation_history": _records(hist_by_ticker[t]) if t in hist_by_ticker else [],
        }
        _write(OUT / "ticker" / f"{t}.json", obj)
        n += 1
        if n % 50 == 0:
            print(f"    …{n} ({time.monotonic() - _loop_t0:.0f}s)", flush=True)
    print(f"  wrote {n} per-ticker files")

    # screener.json with the sector-adjusted model price/upside + day change.
    screener["model_price"] = screener.ticker.map(lambda t: model_out.get(t, {}).get("price"))
    screener["model_upside"] = screener.ticker.map(lambda t: model_out.get(t, {}).get("upside"))
    screener["chg"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("chg"))
    # How stale each row is, so the views can mark it instead of ranking it
    # alongside live ones: BCG published a P/B of 0.10 -- the cheapest on the
    # board -- from a year-old price over two-year-old book value.
    screener["px_age"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("px_age"))
    screener["px_date"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("px_date"))
    screener["last_q"] = screener.ticker.map(
        lambda t: (str(fin_by_ticker[t][fin_by_ticker[t]["period_type"] == "Q"]["period"].iloc[-1])
                   if t in fin_by_ticker and
                   len(fin_by_ticker[t][fin_by_ticker[t]["period_type"] == "Q"]) else None))
    # Latest close, so the screener can show "Giá (VND)" like the original.
    screener["close"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("close"))
    screener["vol"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("vol"))
    screener["adv20"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("adv20"))
    for _k in ("piotroski", "altman_z", "net_debt_ebitda", "peg", "div_yield"):
        screener[_k] = screener.ticker.map(lambda t, k=_k: scores_out.get(t, {}).get(k))
    # Executed insider buys minus sells, last 12 months, fraction of shares (export_actions.py).
    screener["ins_net12"] = screener.ticker.map(lambda t: ins_out.get(t))
    _write(OUT / "screener.json", _records(screener))
    print(f"  wrote screener.json ({len(screener)} rows)")

    # ---- market.json (index series + market-wide foreign flow) ---------
    # The VNINDEX series is already in hand from the beta calculation; the
    # market view needs it as a chart, and "VNINDEX" is also a valid code for
    # the VNDirect foreign endpoint (whole-HOSE net flow).
    market = {"vnindex": [], "foreign": fetch_foreign("VNINDEX", sessions=30) or []}
    if vni is not None:
        market["vnindex"] = [{"date": str(d), "close": _clean(float(v))}
                             for d, v in vni.items() if v == v]
    _write(OUT / "market.json", market)
    print(f"  wrote market.json (index {len(market['vnindex'])} pts, "
          f"foreign {len(market['foreign'])} sessions)")

    # ---- macro.json (curated headline indicators) ----------------------
    # Every indicator the nine macro groups reference. Kept as one flat export;
    # the front-end slices it into the same groups the original tabs use.
    _MACRO_KEYS = [
        # Tổng quan kinh tế
        "gdp_growth", "cpi_yoy", "cpi_mom", "trade_balance", "retail_sales_growth", "fdi",
        # Tăng trưởng kinh tế
        "gdp_sector_agri", "gdp_sector_industry", "gdp_sector_services",
        "wb_gdp_usd", "wb_gdp_per_capita", "wb_gdp_growth", "investment_growth",
        "gdp_nominal_usd", "gdp_per_capita_usd",
        # Giá cả & Lạm phát
        "core_inflation_yoy", "cpi_food", "cpi_transport", "ppi_yoy",
        # Đầu tư & Tiết kiệm
        "wb_capital_formation", "wb_gross_savings", "wb_fdi", "fdi_cumulative",
        # Xuất nhập khẩu
        "exports", "imports", "wb_current_account_gdp", "wb_trade_pct_gdp",
        # Lao động & Việc làm
        "unemployment_rate", "underemployment_rate", "avg_income", "labor_force",
        "wb_labor_participation", "wb_employment_ratio",
        # Tiền tệ & Tỷ giá
        "exchange_rate", "credit_growth_total", "credit_growth_industry",
        "credit_growth_construction", "credit_growth_commerce",
        "credit_growth_agri", "credit_growth_transport", "wb_broad_money_growth",
        # Tiêu dùng
        "wb_consumption_growth", "wb_consumption_gdp",
        # Lãi suất
        "lending_rate", "deposit_rate", "wb_real_interest_rate",
        # ~28 banks' counter savings rates (CafeF), daily from 2026-11-14
        "deposit_12m_avg", "deposit_12m_max", "deposit_12m_min",
        "deposit_6m_avg", "deposit_6m_max", "deposit_6m_min",
        # SJC gold bar board (million VND / lượng), daily from 2026-11-14
        "sjc_gold_buy", "sjc_gold_sell",
    ]
    with engine.connect() as conn:
        macro = pd.read_sql(text(
            "SELECT indicator, period, value FROM macro_indicators "
            "WHERE indicator = ANY(:keys) ORDER BY indicator, period"),
            conn, params={"keys": _MACRO_KEYS})
    macro_out = {}
    for ind, g in macro.groupby("indicator"):
        macro_out[ind] = [{"period": _clean(r["period"]), "value": _clean(r["value"])}
                          for _, r in g.iterrows()]
    _write(OUT / "macro.json", macro_out)
    print(f"  wrote macro.json ({len(macro_out)} indicators)")

    # Today's bank-by-bank savings rates for the macro page's table. The daily
    # summary (average / highest / lowest) is in macro.json via the sibling's
    # NSO job; this is the full board. A failed fetch keeps the last file.
    try:
        from collectors.macro_collector import fetch_cafef_rates, CAFEF_RATES_URL
        banks = fetch_cafef_rates()
        if banks:
            _write(OUT / "bank_rates.json", {"asof": date.today().isoformat(),
                                             "source": CAFEF_RATES_URL, "banks": banks})
            print(f"  wrote bank_rates.json ({len(banks)} banks)")
    except Exception as e:
        print(f"  ! bank rates skipped: {e}")

    # ---- quality.json (latest data quality audit) ----------------------
    # quality/audit.py in the sibling repo appends to data_quality_log after
    # every price refresh; the sidebar badge reads the latest run from here.
    # Missing table or no run yet: skip, and the badge stays hidden.
    try:
        with engine.connect() as conn:
            dq = pd.read_sql(text(
                "SELECT run_at, rule, severity, ticker, detail FROM data_quality_log "
                "WHERE run_at = (SELECT max(run_at) FROM data_quality_log) "
                "ORDER BY severity, rule, ticker"), conn)
        if len(dq):
            # The run's marker row (rule audit_run, severity info) only says the
            # audit ran; the findings are everything else.
            run_at = str(dq["run_at"].iloc[0])
            dq = dq[dq["severity"] != "info"]
            _write(OUT / "quality.json", {
                "run_at": run_at,
                "errors": int((dq["severity"] == "error").sum()),
                "warnings": int((dq["severity"] == "warn").sum()),
                "by_rule": {k: int(v) for k, v in dq.groupby("rule").size().items()},
                "items": [{k: _clean(r[k]) for k in ("rule", "severity", "ticker", "detail")}
                          for _, r in dq.head(300).iterrows()],
            })
            print(f"  wrote quality.json ({len(dq)} findings from {run_at})")
    except Exception as e:
        print(f"  quality.json skipped: {type(e).__name__}")

    _write(OUT / "meta.json", {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "n_tickers": int(len(companies)),
        "price_from": _price_from,
    })
    print("Done.")


if __name__ == "__main__":
    main()

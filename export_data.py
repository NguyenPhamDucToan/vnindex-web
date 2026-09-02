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

# SQLAlchemy needs the psycopg2 dialect spelled out for bare postgres:// URLs.
if _DB_URL.startswith("postgres://"):
    _DB_URL = _DB_URL.replace("postgres://", "postgresql://", 1)

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


def fetch_foreign(code: str, sessions: int = 30) -> list[dict]:
    """Foreign net trading (VND) for the last N sessions, from VNDirect finfo."""
    import requests
    from datetime import timedelta
    try:
        start = (date.today() - timedelta(days=sessions * 3 + 20)).strftime("%Y-%m-%d")
        url = ("https://api-finfo.vndirect.com.vn/v4/foreigns"
               f"?q=code:{code}~tradingDate:gte:{start}&size=200&sort=tradingDate:asc")
        r = requests.get(url, timeout=12, headers={
            "User-Agent": "Mozilla/5.0", "Accept": "application/json",
            "Referer": "https://dstock.vndirect.com.vn/"})
        if r.status_code != 200:
            return []
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
        return rows
    except Exception:
        return []


def load_vnindex() -> "pd.Series | None":
    """VNINDEX daily closes, fetched once and reused as the market series.

    valuation.wacc.compute_beta() re-fetches VNINDEX per ticker, which would
    mean 400+ rate-limited calls here; the maths is identical if we pull the
    index once and align each ticker's own price history against it.
    """
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from vnstock import Quote
            raw = Quote(symbol="VNINDEX", source="VCI").history(
                start=(date.today() - timedelta(days=520)).isoformat(),
                end=date.today().isoformat(), interval="1D")
        if raw is None or len(raw) < 60:
            return None
        s = raw[["time", "close"]].copy()
        s["time"] = pd.to_datetime(s["time"]).dt.date
        return s.set_index("time")["close"]
    except (Exception, SystemExit):
        return None


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
    """Current analyst target/rating from VCI via vnstock (name omitted on purpose)."""
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from vnstock import Company
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
    from valuation.wacc import wacc as _wacc_calc, DEFAULT_COD

    engine = create_engine(_DB_URL, pool_pre_ping=True)
    print(f"Connected: {engine.dialect.name}")
    vni = load_vnindex()
    print(f"  VNINDEX series: {'ok' if vni is not None else 'unavailable (beta falls back)'}")

    with engine.connect() as conn:
        companies = pd.read_sql(
            text("SELECT ticker, name, sector, industry, exchange "
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
                   "dcf_estimate", "upside_pct", "debt_to_equity", "current_ratio",
                   "profit_quality", "fcf_margin"]
    screener = valuations[[c for c in screen_cols if c in valuations.columns]].copy()
    screener["name"] = screener.ticker.map(name_by_ticker)
    screener["sector"] = screener.ticker.map(sec_by_ticker)
    # screener.json is written after the per-ticker loop below, once the
    # sector-adjusted model price/upside has been computed for each ticker.

    # ---- per-ticker files ----------------------------------------------
    val_by_ticker = {t: g for t, g in valuations.groupby("ticker")}
    fin_by_ticker = {t: g for t, g in financials.groupby("ticker")}
    px_by_ticker = {t: g for t, g in prices.groupby("ticker")}
    hist_by_ticker = {t: g for t, g in val_hist.groupby("ticker")}

    n = 0
    model_out = {}          # ticker -> {"price": .., "upside": ..} for screener
    change_out = {}         # ticker -> {"chg": .., "close": .., "vol": ..}
    for _, co in companies.iterrows():
        t = co.ticker
        vg = val_by_ticker.get(t)
        px = px_by_ticker.get(t)
        last_close = float(px["close"].iloc[-1]) if px is not None and len(px) else None
        price_vnd = last_close * 1000 if last_close is not None else None

        model = {"price": None, "upside": None, "methods": {}, "params": {}}
        if vg is not None and len(vg):     # only tickers we actually value
            try:
                mp, mu, meth, prm = model_price(t, sec_by_ticker.get(t) or "", price_vnd)
                prm = dict(prm or {})
                # Ticker-specific beta + WACC, which is what the ROIC-vs-WACC
                # verdict compares against (the DCF above uses DEFAULT_BETA).
                _lq = vg.iloc[0] if vg is not None and len(vg) else None
                _beta = compute_beta_from(px, vni)
                _fin_q = fin_by_ticker.get(t)
                _dbt = _eqt = None
                if _fin_q is not None and len(_fin_q):
                    _lastq = _fin_q[_fin_q["period_type"] == "Q"].tail(1)
                    if len(_lastq):
                        _dbt = float(_lastq["debt"].iloc[0] or 0)
                        _eqt = float(_lastq["equity"].iloc[0] or 1)
                prm["beta"] = _clean(_beta)
                prm["wacc_ticker"] = _clean(
                    _wacc_calc(_beta, DEFAULT_COD, _dbt or 0.0, _eqt or 1.0))
                model = {"price": _clean(mp), "upside": _clean(mu),
                         "methods": {k: _clean(x) for k, x in (meth or {}).items()},
                         "params": {k: _clean(x) for k, x in prm.items()}}
            except Exception as e:         # never let one ticker abort the export
                print(f"    ! model {t}: {e}")
        model_out[t] = model

        # Latest daily % change + volume, for the market-overview movers.
        chg = None
        if px is not None and len(px) >= 2:
            prev = float(px["close"].iloc[-2])
            if prev:
                chg = (last_close - prev) / prev
        change_out[t] = {"chg": _clean(chg), "close": _clean(last_close),
                         "vol": _clean(float(px["volume"].iloc[-1]) if px is not None and len(px) else None)}

        # Fast VNDirect foreign flow inline. Analyst rec is a rate-limited VCI
        # call (~20/min Guest cap, with 57s penalties) so it can't run in this
        # synchronous loop -- export_analyst.py patches it in separately.
        foreign = fetch_foreign(t) if (vg is not None and len(vg)) else []

        # Carry forward whatever export_analyst.py already fetched. Without
        # this, every re-export silently wipes the analyst column and the ~22
        # minute throttled fetch has to be repeated from scratch.
        analyst = None
        _prev = OUT / "ticker" / f"{t}.json"
        if _prev.exists():
            try:
                analyst = json.loads(_prev.read_text(encoding="utf-8")).get("analyst")
            except (ValueError, OSError):
                analyst = None

        obj = {
            "company": {k: _clean(co[k]) for k in
                        ("ticker", "name", "sector", "industry", "exchange")},
            "valuation": (_records(vg)[0] if vg is not None and len(vg) else None),
            "model": model,
            "analyst": analyst,
            "foreign": foreign,
            "financials": _records(fin_by_ticker[t]) if t in fin_by_ticker else [],
            "prices": _records(px_by_ticker[t][["date", "open", "high", "low",
                                                "close", "volume"]])
                      if t in px_by_ticker else [],
            "valuation_history": _records(hist_by_ticker[t]) if t in hist_by_ticker else [],
        }
        _write(OUT / "ticker" / f"{t}.json", obj)
        n += 1
        if n % 50 == 0:
            print(f"    …{n}")
    print(f"  wrote {n} per-ticker files")

    # screener.json with the sector-adjusted model price/upside + day change.
    screener["model_price"] = screener.ticker.map(lambda t: model_out.get(t, {}).get("price"))
    screener["model_upside"] = screener.ticker.map(lambda t: model_out.get(t, {}).get("upside"))
    screener["chg"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("chg"))
    screener["vol"] = screener.ticker.map(lambda t: change_out.get(t, {}).get("vol"))
    _write(OUT / "screener.json", _records(screener))
    print(f"  wrote screener.json ({len(screener)} rows)")

    # ---- market.json (index series + market-wide foreign flow) ---------
    # The VNINDEX series is already in hand from the beta calculation; the
    # market view needs it as a chart, and "VNINDEX" is also a valid code for
    # the VNDirect foreign endpoint (whole-HOSE net flow).
    market = {"vnindex": [], "foreign": fetch_foreign("VNINDEX", sessions=30)}
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
        "wb_capital_formation", "wb_gross_savings", "wb_fdi",
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

    _write(OUT / "meta.json", {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "n_tickers": int(len(companies)),
        "price_from": _price_from,
    })
    print("Done.")


if __name__ == "__main__":
    main()

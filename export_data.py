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


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")


def main() -> None:
    # Imported here so sys.path (set at module load) already includes the
    # sibling valuation package.
    from model_valuation import model_price

    engine = create_engine(_DB_URL, pool_pre_ping=True)
    print(f"Connected: {engine.dialect.name}")

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

        model = {"price": None, "upside": None}
        if vg is not None and len(vg):     # only tickers we actually value
            try:
                mp, mu = model_price(t, sec_by_ticker.get(t) or "", price_vnd)
                model = {"price": _clean(mp), "upside": _clean(mu)}
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

        obj = {
            "company": {k: _clean(co[k]) for k in
                        ("ticker", "name", "sector", "industry", "exchange")},
            "valuation": (_records(vg)[0] if vg is not None and len(vg) else None),
            "model": model,
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

    # ---- macro.json (curated headline indicators) ----------------------
    _MACRO_KEYS = ["gdp_growth", "cpi_yoy", "credit_growth_total", "exchange_rate",
                   "lending_rate", "deposit_rate", "trade_balance", "fdi",
                   "retail_sales_growth", "unemployment_rate"]
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

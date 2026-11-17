"""Standalone builder for the market-wide P/E & P/B history.

Reimplements dashboard.app.load_market_valuation_history() against the same
tables. Kept out of export_data.py's per-ticker loop because it is a single
whole-market aggregation, and out of an `import dashboard.app` because that
module boots the Streamlit app (and its macro scheduler thread) on import.

Writes data/market_history.json: [{quarter, pe, pb, n_pe, n_pb}, ...]
and data/sector_history.json: the same medians per sector, plus a "now" point
(latest close over the latest reported TTM earnings / book) for the market and
each sector, so the sector view can say whether a sector is cheap or dear
against its own past.
"""
import datetime
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_data as E  # noqa: E402  (reuses its DB URL + _write/_clean)

QEND = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
YEARS = 7
MIN_SAMPLE = 30          # quarters with thinner coverage are dropped, not shown
MIN_SECTOR = 4           # same for a sector: fewer tickers than this is not a median


def main() -> None:
    cutoff = (datetime.date.today() - datetime.timedelta(days=365 * YEARS)).isoformat()
    engine = create_engine(E._DB_URL, pool_pre_ping=True)

    with engine.connect() as c:
        fin = pd.read_sql(text(
            "SELECT ticker, period, net_income, equity, shares_outstanding AS shares "
            "FROM financials WHERE period_type = 'Q' ORDER BY ticker, period"), c)
        sectors = dict(c.execute(text(
            "SELECT ticker, sector FROM companies WHERE is_active AND sector IS NOT NULL")).all())
        last_px = pd.read_sql(text("""
            SELECT p.ticker, p.close FROM prices p
            JOIN (SELECT ticker, MAX(date) AS d FROM prices WHERE date >= :recent GROUP BY ticker) m
              ON p.ticker = m.ticker AND p.date = m.d"""),
            c, params={"recent": (datetime.date.today() - datetime.timedelta(days=30)).isoformat()})
        qpx = pd.read_sql(text("""
            WITH qmax AS (
                SELECT ticker,
                       EXTRACT(YEAR FROM date)::INT AS yr,
                       CASE WHEN EXTRACT(MONTH FROM date) <= 3 THEN 1
                            WHEN EXTRACT(MONTH FROM date) <= 6 THEN 2
                            WHEN EXTRACT(MONTH FROM date) <= 9 THEN 3
                            ELSE 4 END AS qnum,
                       MAX(date) AS last_date
                FROM prices WHERE date >= :cutoff
                GROUP BY ticker, yr, qnum
            )
            SELECT p.ticker, qm.yr, qm.qnum, p.close
            FROM qmax qm JOIN prices p
              ON p.ticker = qm.ticker AND p.date = qm.last_date
        """), c, params={"cutoff": cutoff})

    if fin.empty or qpx.empty:
        print("no data")
        return

    fin["year"] = fin["period"].str[:4].astype(int)
    fin["qnum"] = fin["period"].str[6].astype(int)
    fin = fin.sort_values(["ticker", "year", "qnum"])
    fin["ttm_ni"] = fin.groupby("ticker")["net_income"].transform(
        lambda s: s.rolling(4, min_periods=4).sum())
    fin["ttm_eps"] = np.where(
        (fin["shares"] > 0) & fin["ttm_ni"].notna() & (fin["ttm_ni"] != 0),
        fin["ttm_ni"] * 1000 / fin["shares"], np.nan)
    fin["bvps"] = np.where(
        (fin["shares"] > 0) & fin["equity"].notna() & (fin["equity"] > 0),
        fin["equity"] * 1000 / fin["shares"], np.nan)

    # "Now": each listed ticker's latest close over its latest reported TTM
    # EPS and book value -- the point the history is judged against.
    latest = fin.dropna(subset=["shares"]).groupby("ticker").tail(1).copy()
    lp = dict(zip(last_px.ticker, last_px.close * 1000))
    latest["price"] = latest["ticker"].map(lp)
    latest = latest.dropna(subset=["price"])
    latest = latest[latest["ticker"].isin(sectors)]
    latest["pe"] = np.where(latest["ttm_eps"] > 0, latest["price"] / latest["ttm_eps"], np.nan)
    latest["pb"] = np.where(latest["bvps"] > 0, latest["price"] / latest["bvps"], np.nan)
    latest.loc[(latest["pe"] <= 0) | (latest["pe"] > 200), "pe"] = np.nan
    latest.loc[(latest["pb"] <= 0) | (latest["pb"] > 30), "pb"] = np.nan
    latest["sector"] = latest["ticker"].map(sectors)

    # Quarter-end close, in raw VND, keyed the same way as the fundamentals.
    px = {(r.ticker, r.yr, r.qnum): r.close * 1000 for r in qpx.itertuples()}
    fin["price"] = [px.get((t, y, q)) for t, y, q in
                    zip(fin["ticker"], fin["year"], fin["qnum"])]

    fin = fin.dropna(subset=["price"])
    fin["pe"] = np.where(fin["ttm_eps"] > 0, fin["price"] / fin["ttm_eps"], np.nan)
    fin["pb"] = np.where(fin["bvps"] > 0, fin["price"] / fin["bvps"], np.nan)

    # Drop absurd multiples before taking the median so one broken filing can't
    # drag a whole quarter (same intent as the app's sanity bounds).
    fin.loc[(fin["pe"] <= 0) | (fin["pe"] > 200), "pe"] = np.nan
    fin.loc[(fin["pb"] <= 0) | (fin["pb"] > 30), "pb"] = np.nan

    agg = fin.groupby(["year", "qnum"]).agg(
        pe=("pe", "median"), pb=("pb", "median"),
        n_pe=("pe", "count"), n_pb=("pb", "count")).reset_index()

    # A quarter with only a handful of reporting tickers is noise, not signal.
    agg.loc[agg["n_pe"] < MIN_SAMPLE, "pe"] = np.nan
    agg.loc[agg["n_pb"] < MIN_SAMPLE, "pb"] = np.nan
    agg = agg.dropna(subset=["pe", "pb"], how="all")

    cutoff_year = datetime.date.today().year - YEARS
    agg = agg[agg["year"] >= cutoff_year].sort_values(["year", "qnum"])

    out = [{"quarter": f"Q{int(r.qnum)}/{int(r.year)}",
            "pe": E._clean(r.pe), "pb": E._clean(r.pb),
            "n_pe": int(r.n_pe), "n_pb": int(r.n_pb)} for r in agg.itertuples()]
    E._write(E.OUT / "market_history.json", out)

    # ---- per sector ---------------------------------------------------
    fin["sector"] = fin["ticker"].map(sectors)
    sfin = fin.dropna(subset=["sector"])
    sagg = sfin.groupby(["sector", "year", "qnum"]).agg(
        pe=("pe", "median"), pb=("pb", "median"),
        n_pe=("pe", "count"), n_pb=("pb", "count")).reset_index()
    sagg.loc[sagg["n_pe"] < MIN_SECTOR, "pe"] = np.nan
    sagg.loc[sagg["n_pb"] < MIN_SECTOR, "pb"] = np.nan
    sagg = sagg[sagg["year"] >= cutoff_year].dropna(subset=["pe", "pb"], how="all")

    def now_point(df):
        return {"pe": E._clean(df["pe"].median()), "pb": E._clean(df["pb"].median()),
                "n_pe": int(df["pe"].count()), "n_pb": int(df["pb"].count())}

    sec_out = {}
    for sec, g in sagg.sort_values(["year", "qnum"]).groupby("sector"):
        cur = latest[latest["sector"] == sec]
        now = now_point(cur)
        if now["n_pe"] < MIN_SECTOR:
            now["pe"] = None
        if now["n_pb"] < MIN_SECTOR:
            now["pb"] = None
        sec_out[sec] = {"hist": [{"quarter": f"Q{int(r.qnum)}/{int(r.year)}", "pe": E._clean(r.pe), "pb": E._clean(r.pb),
                                  "n_pe": int(r.n_pe), "n_pb": int(r.n_pb)} for r in g.itertuples()],
                        "now": now}
    E._write(E.OUT / "sector_history.json", {
        "asof": datetime.date.today().isoformat(), "years": YEARS,
        "market": {"now": now_point(latest)}, "sectors": sec_out})
    print(f"wrote sector_history.json ({len(sec_out)} sectors)")
    print(f"wrote market_history.json ({len(out)} quarters, "
          f"{out[0]['quarter'] if out else '-'} → {out[-1]['quarter'] if out else '-'})")


if __name__ == "__main__":
    main()

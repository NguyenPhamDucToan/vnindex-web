"""Does the model's "cheap" actually outperform? A private scorecard.

    python model_track.py snapshot   # store today's site model price/upside per ticker (deploy, daily)
    python model_track.py eval       # score the stored history -> data/model_eval.json + a printed report

Two histories are scored:

* "web": the sector-adjusted model price the site shows, snapshotted from
  data/screener.json into the `model_snapshots` table by `snapshot`. It only
  exists from the day this started (2026-11), so it needs months to say much.
* "dcf": the sibling's raw DCF upside (`valuations.upside_pct`), stored daily
  since 2026-05-26. Not the number the site shows, but it is point-in-time and
  already six months deep, so it gives an early read.

Method: on the first stored date of each month, take the liquid tickers that
have a signal, split them into five groups by upside (Q1 = most expensive,
Q5 = cheapest), and measure each group's return over the next 21 and 63
sessions against the average of all of them (and VN-Index). Entry is the next
session's close, so the signal never trades on the price it was computed from.
A model worth trusting has Q5 above Q1 on most dates (hit rate) and a positive
rank correlation between upside and forward return (IC).

Private like the strategy backtest: data/model_eval.json is removed before
the site is uploaded (deploy.yml).
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, inspect, text

import export_data as ex  # DATABASE_URL handling, sibling path

OUT = Path(__file__).resolve().parent / "data"
HORIZONS = {"1 tháng": 21, "3 tháng": 63}
LIQUID_TOP = 300          # by 20-day traded value: keeps the scorecard on stocks one can trade

DDL = """CREATE TABLE IF NOT EXISTS model_snapshots (
    snap_date DATE NOT NULL, ticker VARCHAR(10) NOT NULL,
    close DOUBLE PRECISION, model_price DOUBLE PRECISION, model_upside DOUBLE PRECISION,
    sector VARCHAR(80), mcap DOUBLE PRECISION, adv20 DOUBLE PRECISION,
    PRIMARY KEY (snap_date, ticker))"""


def _engine():
    return create_engine(ex._DB_URL, pool_pre_ping=True)


def snapshot() -> int:
    rows = json.loads((OUT / "screener.json").read_text(encoding="utf-8"))
    # the price date the screener's numbers belong to (latest across tickers)
    snap = max((r.get("px_date") or "" for r in rows), default="")[:10] or date.today().isoformat()
    keep = [{"snap_date": snap, "ticker": r["ticker"], "close": r.get("close"),
             "model_price": r.get("model_price"), "model_upside": r.get("model_upside"),
             "sector": r.get("sector"), "mcap": r.get("mcap"), "adv20": r.get("adv20")}
            for r in rows if r.get("model_upside") is not None]
    with _engine().begin() as c:
        c.execute(text(DDL))
        c.execute(text("DELETE FROM model_snapshots WHERE snap_date = :d"), {"d": snap})
        if keep:
            c.execute(text("INSERT INTO model_snapshots VALUES (:snap_date, :ticker, :close, :model_price, "
                           ":model_upside, :sector, :mcap, :adv20)"), keep)
    print(f"model snapshot {snap}: {len(keep)} tickers")
    return len(keep)


def _monthly_dates(dates: pd.Series) -> list[pd.Timestamp]:
    d = pd.Series(sorted(pd.to_datetime(dates.unique())))
    return list(d.groupby(d.dt.to_period("M")).min())


def _score(signal: pd.DataFrame, px: pd.DataFrame, vni: pd.Series | None) -> dict:
    """signal: date, ticker, upside. px: wide adjusted closes (index = session dates)."""
    sessions = px.index
    out = {"dates": [], "horizons": {}}
    value = None
    for h_name, h in HORIZONS.items():
        per_date = []
        for d in _monthly_dates(signal["date"]):
            # entry = first session strictly after the signal date
            i = sessions.searchsorted(d, side="right")
            if i + h >= len(sessions):
                continue                                   # forward window not complete yet
            s = signal[signal["date"] == d].set_index("ticker")["upside"].dropna()
            s = s[s.index.isin(px.columns)]
            if value is None:
                value = px.attrs.get("value")
            if value is not None:                           # liquidity: top N by 20-day traded value
                v = value.iloc[max(0, i - 20):i].mean()
                s = s[s.index.isin(v.nlargest(LIQUID_TOP).index)]
            p0, p1 = px.iloc[i][s.index], px.iloc[i + h][s.index]
            ret = (p1 / p0 - 1).dropna()
            s = s[ret.index]
            if len(s) < 50:
                continue
            q = pd.qcut(s.rank(method="first"), 5, labels=[1, 2, 3, 4, 5])
            excess = ret - ret.mean()
            qm = excess.groupby(q, observed=True).mean()
            row = {"date": d.date().isoformat(), "n": int(len(s)),
                   "q": {int(k): round(float(v) * 100, 2) for k, v in qm.items()},
                   "spread": round(float(qm.get(5, 0) - qm.get(1, 0)) * 100, 2),
                   "ic": round(float(s.rank().corr(ret.rank())), 3),
                   "universe": round(float(ret.mean()) * 100, 2)}
            if vni is not None:
                a, b = vni.asof(sessions[i]), vni.asof(sessions[i + h])
                if a and b:
                    row["vnindex"] = round((b / a - 1) * 100, 2)
            per_date.append(row)
        if not per_date:
            out["horizons"][h_name] = {"periods": 0}
            continue
        df = pd.DataFrame(per_date)
        qavg = {k: round(float(pd.Series([r["q"].get(k) for r in per_date]).mean()), 2) for k in range(1, 6)}
        out["horizons"][h_name] = {
            "periods": len(per_date),
            "q_avg_excess": qavg,                          # % vs the universe average, per group
            "spread_avg": round(float(df["spread"].mean()), 2),
            "hit_rate": round(float((df["spread"] > 0).mean()), 2),
            "ic_avg": round(float(df["ic"].mean()), 3),
            "detail": per_date,
        }
    return out


def evaluate() -> dict:
    eng = _engine()
    with eng.connect() as c:
        dcf = pd.read_sql(text("SELECT calc_date AS date, ticker, upside_pct AS upside FROM valuations "
                               "WHERE upside_pct IS NOT NULL"), c)
        # Before the first snapshot the table doesn't exist; a failed SELECT would
        # abort the transaction for the price query that follows.
        if inspect(eng).has_table("model_snapshots"):
            web = pd.read_sql(text("SELECT snap_date AS date, ticker, model_upside AS upside FROM model_snapshots"), c)
        else:
            web = pd.DataFrame(columns=["date", "ticker", "upside"])
        start = min([d for d in (dcf["date"].min(), web["date"].min() if len(web) else None) if d is not None])
        px = pd.read_sql(text("SELECT ticker, date, adjusted_close, close, volume FROM prices WHERE date >= :d"),
                         c, params={"d": start})
    px["date"] = pd.to_datetime(px["date"])
    px["p"] = px["adjusted_close"].fillna(px["close"])
    wide = px.pivot_table(index="date", columns="ticker", values="p").sort_index()
    wide.attrs["value"] = (px.assign(v=px["close"] * px["volume"])
                           .pivot_table(index="date", columns="ticker", values="v").reindex(wide.index))
    for sig in (dcf, web):
        sig["date"] = pd.to_datetime(sig["date"])
    m = json.loads((OUT / "market.json").read_text(encoding="utf-8")) if (OUT / "market.json").exists() else {}
    vni = (pd.Series({pd.Timestamp(r["date"]): r["close"] for r in m.get("vnindex", [])}).sort_index()
           if m.get("vnindex") else None)
    res = {"asof": date.today().isoformat(),
           "sources": {
               "dcf": {"label": "DCF thô (DB, từ " + str(dcf["date"].min().date()) + ")", **_score(dcf, wide, vni)},
               "web": {"label": "Giá mô hình trên web (ảnh chụp hằng ngày)",
                       "first": str(web["date"].min().date()) if len(web) else None,
                       **(_score(web, wide, vni) if len(web) else {"horizons": {}})},
           }}
    (OUT / "model_eval.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def report(res: dict) -> None:
    for key, src in res["sources"].items():
        print(f"\n== {src['label']} ==")
        if not src.get("horizons"):
            print("  chưa có dữ liệu")
            continue
        for h, r in src["horizons"].items():
            if not r.get("periods"):
                print(f"  {h}: chưa đủ thời gian để chấm")
                continue
            qs = "  ".join(f"Q{k}:{v:+.2f}%" for k, v in r["q_avg_excess"].items())
            print(f"  {h}: {r['periods']} kỳ | {qs} | Q5-Q1 {r['spread_avg']:+.2f}% | "
                  f"Q5>Q1 ở {r['hit_rate']:.0%} số kỳ | IC {r['ic_avg']:+.3f}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "eval"
    if cmd == "snapshot":
        snapshot()
    else:
        report(evaluate())

"""Phase 10 backtest -> data/backtest.json (plan Days 72-89).

Reads prices, statements and sectors from the database (read only), adjusts
prices for bonus issues (backtest_engine.adjust_prices), builds point-in-time
factors (backtest_factors.py) at each quarterly rebalance, and simulates
equal-weight long-only portfolios with costs, sale tax, board lots and a
liquidity floor, against VNINDEX and an equal-weight market.

    python export_backtest.py [--top 20] [--out data/backtest.json]

Run weekly by refresh-slow.yml (results move slowly; one run is ~2 minutes).
"""
from __future__ import annotations

import argparse
import json
import math
import time
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

import export_data as ed                       # sys.path to the sibling + DATABASE_URL
import backtest_engine as be
import backtest_factors as bf
from valuation.scores import piotroski_f
from valuation.signals import compute_quality_score

RF = 0.045            # 12-month deposit rate at the big four banks, roughly; Sharpe's hurdle
IS_END = "2023-12-31"  # in-sample to here, out-of-sample after (plan Day 86)
TOP_GRID = (10, 20, 30, 50)
QUINTILES = 5


def _clean(x):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        return None if (math.isnan(x) or math.isinf(x)) else round(float(x), 5)
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


def load(engine):
    with engine.connect() as c:
        prices = pd.read_sql(text("SELECT ticker, date, open, close, volume FROM prices "
                                  "WHERE length(ticker) = 3 ORDER BY ticker, date"), c)
        fin = pd.read_sql(text("SELECT * FROM financials ORDER BY ticker, period_type, period"), c)
        cos = pd.read_sql(text("SELECT ticker, sector FROM companies"), c)
    return prices, fin, dict(zip(cos.ticker, cos.sector))


def vnindex_history(start="2020-06-01") -> pd.Series | None:
    import requests
    try:
        r = requests.get("https://dchart-api.vndirect.com.vn/dchart/history",
                         params={"resolution": "D", "symbol": "VNINDEX",
                                 "from": int(pd.Timestamp(start).timestamp()),
                                 "to": int(time.time())},
                         timeout=30, headers={"User-Agent": "Mozilla/5.0",
                                              "Referer": "https://dchart.vndirect.com.vn/"})
        j = r.json() if r.status_code == 200 else {}
        if j.get("s") == "ok" and len(j.get("t") or []) > 250:
            idx = pd.to_datetime([datetime.fromtimestamp(x, timezone.utc).date() for x in j["t"]])
            return pd.Series([float(x) for x in j["c"]], index=idx).sort_index()
    except Exception as e:
        print(f"  VNDirect VNINDEX failed: {e}")
    try:
        from vndata import Quote
        raw = Quote(symbol="VNINDEX").history(start=start, end=date.today().isoformat(), interval="1D")
        if raw is not None and len(raw) > 250:
            return pd.Series(raw["close"].astype(float).to_numpy(),
                             index=pd.to_datetime(raw["time"])).sort_index()
    except Exception as e:
        print(f"  vndata VNINDEX failed: {e}")
    return None


def weekly(nav: pd.Series) -> list:
    w = nav.resample("W-FRI").last().dropna()
    base = float(nav.iloc[0])
    return [[d.date().isoformat(), round(float(v) / base * 100, 2)] for d, v in w.items()]


def summarise(nav: pd.Series, bench: pd.Series | None) -> dict:
    out = {"full": be.metrics(nav, RF, bench)}
    is_ = nav[nav.index <= IS_END]
    oos = nav[nav.index > IS_END]
    out["is"] = be.metrics(is_, RF, bench) if len(is_) > 60 else {}
    out["oos"] = be.metrics(oos, RF, bench) if len(oos) > 60 else {}
    out["years"] = be.calendar_returns(nav)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--out", default=str(ed.OUT / "backtest.json"))
    args = ap.parse_args()
    t0 = time.monotonic()

    engine = create_engine(ed._DB_URL, pool_pre_ping=True)
    prices, fin, sectors = load(engine)
    print(f"prices {len(prices):,} rows / {prices.ticker.nunique()} tickers; financials {len(fin):,}")

    fin_by = {t: g.to_dict("records") for t, g in fin.groupby("ticker")}
    frames, n_ev = {}, 0
    for t, g in prices.groupby("ticker"):
        adj, ev = be.adjust_prices(g.reset_index(drop=True), ed.issuance_dates(t),
                                   be.share_steps(fin_by.get(t, [])))
        n_ev += len(ev)
        frames[t] = adj
    print(f"adjusted {n_ev} entitlement gaps")
    raw = be.to_panel(frames, "close")
    adj = be.to_panel(frames, "adj")
    vol = be.to_panel(frames, "volume")
    value_bn = raw * vol / 1e6                   # thousands VND x shares -> VND billions

    hist = {t: bf.FinancialHistory(rows) for t, rows in fin_by.items()}
    vni = vnindex_history()
    print(f"VNINDEX: {'%d points' % len(vni) if vni is not None else 'unavailable'}")

    # Common start: the first rebalance where momentum (252 sessions) exists for
    # enough of the market, so every strategy is measured over the same window.
    sessions = adj.index
    tables, universe = {}, {}
    for d in be.rebalance_dates(sessions):
        if d == sessions[-1]:
            continue
        elig = bf.eligible(d, raw, value_bn)
        if len(elig) < 50:
            continue
        ft = bf.factor_table(d, elig, hist, raw, adj, sectors, compute_quality_score, piotroski_f)
        if ft["mom"].notna().sum() < 100:
            continue
        tables[d] = ft
        universe[d] = len(elig)
    dates = sorted(tables)
    print(f"{len(dates)} rebalances {dates[0].date()} .. {dates[-1].date()}, "
          f"universe {min(universe.values())}-{max(universe.values())} names")

    costs = be.Costs()
    ew = be.simulate({d: list(tables[d].index) for d in dates}, adj, raw, costs=costs)
    bench_vni = None
    if vni is not None:
        bench_vni = vni[vni.index >= ew.nav.index[0]]
        bench_vni = bench_vni / bench_vni.iloc[0] * ew.nav.iloc[0]
    bench = bench_vni if bench_vni is not None else ew.nav

    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "start": ew.nav.index[0].date().isoformat(), "end": ew.nav.index[-1].date().isoformat(),
           "is_end": IS_END, "rebalances": len(dates), "top": args.top,
           "params": {"rf": RF, "commission": costs.commission, "slippage": costs.slippage,
                      "sell_tax": costs.sell_tax, "capital_vnd": 1e9, "lot": 100,
                      "min_adv_bn": bf.MIN_ADV_BN, "publish_lag_days": 45,
                      "annual_lag_days": bf.ANNUAL_LAG_DAYS,
                      "universe_min": min(universe.values()), "universe_max": max(universe.values())},
           "benchmarks": {}, "strategies": []}
    if bench_vni is not None:
        out["benchmarks"]["vnindex"] = {"name": "VNINDEX", "nav": weekly(bench_vni),
                                        **summarise(bench_vni, None)}
    out["benchmarks"]["ew"] = {"name": "Chia đều cả thị trường", "nav": weekly(ew.nav),
                               "turnover": ew.turnover, **summarise(ew.nav, bench_vni)}

    for key, (name, desc) in bf.FACTORS.items():
        sel = {d: be.top_n(tables[d][key], args.top) for d in dates}
        r = be.simulate(sel, adj, raw, costs=costs)
        if r.nav.empty:
            continue
        # Quintile portfolios (plan Day 78): does the factor sort the market?
        quint = []
        for k in range(1, QUINTILES + 1):
            qsel = {d: be.quantile_buckets(tables[d][key], QUINTILES).get(k, []) for d in dates}
            qr = be.simulate(qsel, adj, raw, costs=costs)
            m = be.metrics(qr.nav, RF) if not qr.nav.empty else {}
            quint.append(m.get("cagr"))
        grid = {}
        for n in TOP_GRID:
            gr = be.simulate({d: be.top_n(tables[d][key], n) for d in dates}, adj, raw, costs=costs)
            grid[str(n)] = be.metrics(gr.nav, RF, bench).get("cagr") if not gr.nav.empty else None
        latest = r.holdings[-1] if r.holdings else (None, [])
        s = {"key": key, "name": name, "desc": desc, "nav": weekly(r.nav),
             "turnover": r.turnover, "cost_per_year": r.cost_paid, "cash_share": r.cash_share,
             "quintiles": quint, "top_grid": grid, "latest": {"date": latest[0], "tickers": latest[1]},
             **summarise(r.nav, bench)}
        out["strategies"].append(s)
        f = s["full"]
        print(f"  {key:14} CAGR {f.get('cagr', 0):6.1%}  vs bench {f.get('excess_cagr') or 0:+6.1%}  "
              f"MaxDD {f.get('max_dd', 0):6.1%}  Q1..Q5 " +
              " ".join(f"{q:5.1%}" if q is not None else "  -  " for q in quint))

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(_clean(out), fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {args.out} in {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()

"""Earnings releases and the price reaction around them (plan Days 107-108)
-> the `earnings` block of data/ticker/<T>.json.

Release dates. VCI's statement feed stamps each quarter with `createDate`,
the moment the report first reached its database. Against the quarter end
that lands 18-35 days later for nearly every quarter, which is when listed
companies must publish (20 days separate, 30-45 days consolidated). A few
quarters carry a much later stamp (a reload, 116-470 days); those are dropped
rather than guessed. A stamp at or after 15:00 can only be traded the next
session, so the event day moves forward one session.

Reaction. Market-adjusted buy-and-hold returns against VNINDEX: the stock's
return over a window minus the index's over the same sessions (beta taken
as 1 -- simple, and it can't be fitted badly on 25 events). Windows, in
sessions around the event day 0: [-5,-1] (run-up), [0,+1], [0,+5], [0,+20].
Each event is tagged with the quarter's net-income growth on a year ago, so
good- and bad-news quarters can be told apart.

Like `actions`, this is a slow block: export_data.py carries it forward and
it persists once committed (refresh-slow.yml runs it weekly).

    python export_earnings.py [--missing] [--tickers FPT SHB]
"""
from __future__ import annotations

import json
import statistics
import sys
import time
import warnings
from datetime import date, datetime, timedelta

import pandas as pd
from sqlalchemy import create_engine, text

import export_data as ed                       # sys.path to the sibling + DATABASE_URL
from export_backtest import vnindex_history

TICKER_DIR = ed.OUT / "ticker"
THROTTLE_S = 4.0
LAG_MIN, LAG_MAX = 10, 75                      # days after quarter end a real release falls in
WINDOWS = {"pre": (-5, -1), "d1": (0, 1), "d5": (0, 5), "d20": (0, 20)}
CLOSE_HOUR = 15                                # HOSE closes 14:45; a 15:00+ stamp trades next session


def quarter_end(year: int, q: int) -> date:
    m = q * 3
    nxt = date(year + (m == 12), 1 if m == 12 else m + 1, 1)
    return nxt - timedelta(days=1)


def parse_releases(rows: list[dict]) -> list[dict]:
    """VCI quarter rows -> [{q: "2026Q3", at: "2026-10-29T17:57", lag: 29}], oldest first.
    Rows whose stamp is not 10-75 days after the quarter end are reloads, not releases."""
    out = []
    for r in rows:
        try:
            y, q = int(r["yearReport"]), int(r["lengthReport"])
            at = datetime.fromisoformat(str(r["createDate"])[:19])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= q <= 4:
            continue
        lag = (at.date() - quarter_end(y, q)).days
        if LAG_MIN <= lag <= LAG_MAX:
            out.append({"q": f"{y}Q{q}", "at": at.isoformat(timespec="minutes"), "lag": lag})
    out.sort(key=lambda d: d["q"])
    return out


def fetch_releases(ticker: str) -> list[dict] | None:
    """None on a failed call (keep the old block). VCI refuses after a burst,
    so a failure backs off and retries, as export_actions does."""
    for wait in (0, 30, 130):
        if wait:
            time.sleep(wait)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                from vndata.finance import Finance
                df = Finance(ticker)._raw("income_statement", "quarter")
        except (Exception, SystemExit):
            continue
        cols = [c for c in ("yearReport", "lengthReport", "createDate") if c in df.columns]
        return parse_releases(df[cols].to_dict("records")) if len(cols) == 3 else []
    return None


def event_index(at: str, sessions: pd.DatetimeIndex) -> int | None:
    """Position in `sessions` of the first session the news could be traded in."""
    ts = datetime.fromisoformat(at)
    day = pd.Timestamp(ts.date())
    i = int(sessions.searchsorted(day))
    if i < len(sessions) and sessions[i] == day and ts.hour >= CLOSE_HOUR:
        i += 1
    return i if i < len(sessions) else None


def _bhar(px, vni, i0: int, a: int, b: int) -> float | None:
    lo, hi = i0 + a - 1, i0 + b
    if lo < 0 or hi >= len(px):
        return None
    p0, p1, v0, v1 = px[lo], px[hi], vni[lo], vni[hi]
    if not (p0 and p1 and v0 and v1) or any(map(pd.isna, (p0, p1, v0, v1))):
        return None
    return round((p1 / p0 - 1) - (v1 / v0 - 1), 5)


def ni_growth(net_income: dict[str, float], q: str) -> float | None:
    """Net income vs the same quarter a year earlier; None when the base is not positive."""
    y, n = int(q[:4]), q[4:]
    now, base = net_income.get(q), net_income.get(f"{y - 1}{n}")
    if now is None or base is None or base <= 0:
        return None
    return round(now / base - 1, 4)


def study(releases: list[dict], closes: pd.Series, vni: pd.Series,
          net_income: dict[str, float]) -> list[dict]:
    """One record per release with the window returns (None where prices run out)."""
    sessions = vni.index
    px = closes.reindex(sessions).ffill(limit=5).to_numpy()
    vx = vni.to_numpy()
    first = closes.first_valid_index()
    events = []
    for r in releases:
        i0 = event_index(r["at"], sessions)
        if i0 is None or first is None or sessions[i0] <= first:
            continue
        ev = {"q": r["q"], "date": sessions[i0].date().isoformat(), "lag": r["lag"],
              "ni": net_income.get(r["q"]), "growth": ni_growth(net_income, r["q"])}
        for k, (a, b) in WINDOWS.items():
            ev[k] = _bhar(px, vx, i0, a, b)
        events.append(ev)
    return events


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 5) if xs else None


def summarize(events: list[dict], releases: list[dict], today: date) -> dict:
    d1 = [e["d1"] for e in events if e["d1"] is not None]
    up = [e for e in events if e["growth"] is not None and e["growth"] > 0]
    down = [e for e in events if e["growth"] is not None and e["growth"] <= 0]
    out = {
        "n": len(d1),
        "d1_mean": _mean(d1),
        "d1_abs": _mean([abs(x) for x in d1]),
        "d1_pos": round(sum(x > 0 for x in d1) / len(d1), 3) if d1 else None,
        "d5_mean": _mean([e["d5"] for e in events]),
        "d20_mean": _mean([e["d20"] for e in events]),
        "pre_mean": _mean([e["pre"] for e in events]),
        "up": {"n": len(up), "d5": _mean([e["d5"] for e in up]), "d20": _mean([e["d20"] for e in up])},
        "down": {"n": len(down), "d5": _mean([e["d5"] for e in down]), "d20": _mean([e["d20"] for e in down])},
    }
    out["next"] = next_release(releases, today)
    return out


def next_release(releases: list[dict], today: date) -> dict | None:
    """Expected date of the next quarter's report: its quarter end plus the
    median lag this company has shown for that quarter of the year."""
    if not releases:
        return None
    y, q = int(releases[-1]["q"][:4]), int(releases[-1]["q"][5])
    y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    same = [r["lag"] for r in releases if int(r["q"][5]) == q]
    lags = same if len(same) >= 2 else [r["lag"] for r in releases]
    lag = int(statistics.median(lags))
    exp = quarter_end(y, q) + timedelta(days=lag)
    if exp < today - timedelta(days=3):         # overdue: say so rather than show a past date
        return {"q": f"{y}Q{q}", "date": exp.isoformat(), "lag": lag, "overdue": True}
    return {"q": f"{y}Q{q}", "date": exp.isoformat(), "lag": lag}


def _load(engine):
    with engine.connect() as c:
        prices = pd.read_sql(text("SELECT ticker, date, close FROM prices WHERE length(ticker) = 3 "
                                  "ORDER BY ticker, date"), c)
        fin = pd.read_sql(text("SELECT ticker, period, net_income FROM financials "
                               "WHERE period_type = 'Q' AND length(ticker) = 3"), c)
    prices["date"] = pd.to_datetime(prices["date"])
    closes = {t: g.set_index("date")["close"].astype(float) for t, g in prices.groupby("ticker")}
    ni: dict[str, dict[str, float]] = {}
    for t, p, v in fin.itertuples(index=False):
        if v is not None and not pd.isna(v) and isinstance(p, str) and "-Q" in p:
            ni.setdefault(t, {})[p.replace("-", "")] = float(v)   # "2026-Q3" -> "2026Q3"
    return closes, ni


def main() -> None:
    args = sys.argv[1:]
    missing_only = "--missing" in args
    only = set(args[args.index("--tickers") + 1:]) if "--tickers" in args else None
    engine = create_engine(ed._DB_URL, pool_pre_ping=True)
    closes, ni = _load(engine)
    vni = vnindex_history(start="2019-06-01")
    if vni is None:
        raise SystemExit("VNINDEX history unavailable -- nothing to measure against")
    vni = vni[~vni.index.duplicated()].sort_index()
    print(f"prices for {len(closes)} tickers, VNINDEX {len(vni)} sessions")
    today = date.today()
    fetched = kept = failed = 0
    t0 = time.monotonic()
    for f in sorted(TICKER_DIR.glob("*.json")):
        t = f.stem
        if len(t) != 3 or (only is not None and t not in only):
            continue
        obj = json.loads(f.read_text(encoding="utf-8"))
        old = (obj.get("earnings") or {}).get("releases")
        if missing_only and old is not None:
            releases = old
            kept += 1
        else:
            releases = fetch_releases(t)
            time.sleep(THROTTLE_S)
            if releases is None:
                failed += 1
                releases = old
            else:
                fetched += 1
        if releases is None:
            continue
        events = study(releases, closes[t], vni, ni.get(t, {})) if t in closes else []
        obj["earnings"] = {"releases": releases, "events": events,
                           "summary": summarize(events, releases, today)}
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(f)
        if (fetched + failed) and (fetched + failed) % 25 == 0:
            print(f"  {fetched} fetched, {failed} failed -- at {t} ({time.monotonic() - t0:.0f}s)", flush=True)
    print(f"Done: {fetched} fetched, {kept} kept, {failed} failed.")


if __name__ == "__main__":
    main()

"""Price momentum columns for screener.json and market breadth for the market view.

From the per-ticker price files already on disk (VCI's adjusted closes) and the
VN-Index series in market.json. Deploy runs this after add_growth.py.

    python add_momentum.py

screener.json columns (fractions):
    hi52     close / highest close of the last 252 sessions - 1  (0 = at the high)
    brk      True when the last 5 sessions made a new 252-session closing high
    r3m, r6m       return over 63 / 126 sessions
    rs3m, rs6m     the same minus VN-Index over the same dates

data/breadth.json: {"dates": [...], "ma50": [...], "ma200": [...], "n": [...], "vni": [...]}
    share of listed shares closing above their 50- / 200-session average, per
    session, counting only shares with that much history on the day.
"""
from __future__ import annotations

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
COLS = ("hi52", "brk", "r3m", "r6m", "rs3m", "rs6m")
YEAR, Q1, Q2, BRK = 252, 63, 126, 5
BREADTH_DAYS = 260          # about a year of breadth on the chart


def _closes(prices) -> list[tuple[str, float]]:
    return [(p["date"], float(p["close"])) for p in (prices or [])
            if isinstance(p.get("close"), (int, float)) and p["close"] > 0 and p.get("date")]


def momentum(px: list[tuple[str, float]], vni: dict[str, float]) -> dict:
    if len(px) < Q1 + 1:
        return {}
    closes = [c for _, c in px]
    last = closes[-1]
    out = {}
    if len(closes) >= YEAR:
        hi = max(closes[-YEAR:])
        out["hi52"] = round(last / hi - 1, 4)
        before = closes[-YEAR - BRK:-BRK] if len(closes) >= YEAR + BRK else closes[:-BRK]
        out["brk"] = bool(before) and max(closes[-BRK:]) > max(before)

    def ret(n):
        if len(px) <= n:
            return None, None
        d0, c0 = px[-1 - n]
        r = last / c0 - 1
        v0, v1 = vni.get(d0), vni.get(px[-1][0])
        return round(r, 4), (round(r - (v1 / v0 - 1), 4) if v0 and v1 else None)
    out["r3m"], out["rs3m"] = ret(Q1)
    out["r6m"], out["rs6m"] = ret(Q2)
    return out


def breadth(series: dict[str, list[tuple[str, float]]], vni: dict[str, float]) -> dict:
    """% of tickers above their 50/200-session moving average, per session."""
    dates = sorted({d for px in series.values() for d, _ in px})[-BREADTH_DAYS:]
    want = set(dates)
    above = {d: [0, 0, 0, 0] for d in dates}     # ma50 above, ma50 count, ma200 above, ma200 count
    for px in series.values():
        closes = [c for _, c in px]
        s = 0.0
        pref = [0.0]
        for c in closes:
            s += c
            pref.append(s)
        for i, (d, c) in enumerate(px):
            if d not in want:
                continue
            a = above[d]
            if i + 1 >= 50:
                a[1] += 1
                a[0] += c > (pref[i + 1] - pref[i + 1 - 50]) / 50
            if i + 1 >= 200:
                a[3] += 1
                a[2] += c > (pref[i + 1] - pref[i + 1 - 200]) / 200
    # A session only a handful of tickers traded on (a holiday stub) says nothing.
    full = max((a[1] for a in above.values()), default=0)
    keep = [d for d in dates if above[d][1] >= 0.8 * full]
    pct = lambda x, n: round(x / n, 4) if n else None
    return {"dates": keep,
            "ma50": [pct(above[d][0], above[d][1]) for d in keep],
            "ma200": [pct(above[d][2], above[d][3]) for d in keep],
            "n": [above[d][1] for d in keep],
            "vni": [vni.get(d) for d in keep]}


def main() -> None:
    screener = json.loads((DATA / "screener.json").read_text(encoding="utf-8"))
    try:
        market = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
    except (ValueError, OSError):
        market = {}
    vni = {p["date"]: float(p["close"]) for p in (market.get("vnindex") or [])
           if isinstance(p.get("close"), (int, float))}
    series, filled = {}, 0
    for row in screener:
        for k in COLS:
            row.pop(k, None)
        f = DATA / "ticker" / f"{row['ticker']}.json"
        try:
            px = _closes(json.loads(f.read_text(encoding="utf-8")).get("prices"))
        except (ValueError, OSError):
            continue
        series[row["ticker"]] = px
        m = momentum(px, vni)
        row.update(m)
        filled += bool(m)
    (DATA / "screener.json").write_text(
        json.dumps(screener, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    b = breadth(series, vni)
    (DATA / "breadth.json").write_text(json.dumps(b, separators=(",", ":")), encoding="utf-8")
    print(f"momentum set on {filled} of {len(screener)} rows; breadth over {len(b['dates'])} sessions")


if __name__ == "__main__":
    main()

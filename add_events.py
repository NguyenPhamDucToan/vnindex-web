"""Market-wide calendar of rights and dividends, and recent insider deals.

The stock page shows these per ticker (the `actions` and `insiders` blocks,
export_actions.py); the market view's "Sự kiện" tab lists them across the
market. The browser cannot open 400 ticker files, so this gathers the slice it
needs into data/events.json. Deploy runs it after add_momentum.py.

    python add_events.py

events.json:
    asof
    actions   ex-dates from 7 days back to 120 days ahead, with the cash yield
              against the latest close where the action is a cash dividend
    insiders  deals registered or reported in the last 2 years (the tab shows
              12 months, both years once a ticker is searched), with the
              quantity as a fraction of shares outstanding and an approximate
              value at the latest close (VND billions)
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
BACK_DAYS, AHEAD_DAYS, INSIDER_DAYS = 7, 120, 730


def _num(v):
    return v if isinstance(v, (int, float)) and v == v else None


def main(today: date | None = None) -> None:
    today = today or date.today()
    lo, hi = (today - timedelta(days=BACK_DAYS)).isoformat(), (today + timedelta(days=AHEAD_DAYS)).isoformat()
    ins_from = (today - timedelta(days=INSIDER_DAYS)).isoformat()
    screener = json.loads((DATA / "screener.json").read_text(encoding="utf-8"))
    actions, insiders = [], []
    for row in screener:
        t = row["ticker"]
        try:
            obj = json.loads((DATA / "ticker" / f"{t}.json").read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        px = obj.get("prices") or []
        close = _num(px[-1].get("close")) if px else None            # thousands VND
        qs = [r for r in (obj.get("financials") or [])
              if r.get("period_type") == "Q" and _num(r.get("shares_outstanding"))]
        shares = qs[-1]["shares_outstanding"] * 1e6 if qs else None
        base = {"ticker": t, "co": row.get("name"), "sector": row.get("sector")}

        for a in obj.get("actions") or []:
            ex = a.get("ex") or ""
            if not (lo <= ex <= hi):
                continue
            cash = _num(a.get("cash"))
            actions.append({**base, "kind": a.get("kind"), "ex": ex, "record": a.get("record"),
                            "pay": a.get("pay"), "ratio": _num(a.get("ratio")), "cash": cash,
                            "yield": round(cash / (close * 1000), 4) if (cash and close) else None})

        for d in obj.get("insiders") or []:
            qty = _num(d.get("qty"))
            # the latest filing (registration or result report), not the
            # trading window, which for a registration lies in the future
            last = max(d.get("pub") or "", d.get("result_pub") or "")
            if not qty or last < ins_from:
                continue
            insiders.append({**base, "name": d.get("name"), "who": d.get("who"), "side": d.get("side"),
                             "qty": qty, "start": d.get("start"), "end": d.get("end"), "pub": d.get("pub"),
                             "result_pub": d.get("result_pub"), "status": d.get("status"), "date": last,
                             "pct": round(qty / shares, 6) if shares else None,
                             "value": round(qty * close * 1000 / 1e9, 2) if close else None})

    actions.sort(key=lambda a: (a["ex"], a["ticker"]))
    insiders.sort(key=lambda d: (d["date"], d["ticker"]), reverse=True)
    (DATA / "events.json").write_text(json.dumps(
        {"asof": today.isoformat(), "actions": actions, "insiders": insiders},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"events: {len(actions)} actions, {len(insiders)} insider deals")


if __name__ == "__main__":
    main()

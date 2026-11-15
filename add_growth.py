"""Add latest-quarter growth columns to screener.json from the per-ticker files.

For each ticker's newest quarter, compares revenue and net income with the
same quarter a year earlier (YoY, so seasonality cancels) and the year to date
with the same months a year earlier. The screener filters on these, and the
market view lists the quarter's standouts against their sector's median.

Like add_mcap.py, everything needed is already on disk; deploy runs this right
after the export (or after restoring a cached one).

    python add_growth.py

Columns (money in VND billions, growth as a fraction):
    g_q          quarter the figures are for, e.g. "2026-Q3"
    rev_q, ni_q  that quarter's revenue / net income
    rev_p, ni_p  the same quarter a year earlier
    rev_yoy      rev_q / rev_p - 1; None when rev_p <= 0
    ni_yoy       ni_q / ni_p - 1;   None when ni_p <= 0 (a loss base has no
                 meaningful ratio -- ni_p < 0 < ni_q is a turnaround instead)
    rev_ytd_yoy, ni_ytd_yoy   same for Q1..Qn summed, only when all 2n quarters exist
    er_date, er_d1, er_d5     release date of g_q and the price reaction over
                 [0,+1] / [0,+5] sessions minus VN-Index, from the `earnings` block
"""
from __future__ import annotations

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
COLS = ("g_q", "rev_q", "ni_q", "rev_p", "ni_p", "rev_yoy", "ni_yoy", "rev_ytd_yoy", "ni_ytd_yoy",
        "er_date", "er_d1", "er_d5")


def _num(v):
    return v if isinstance(v, (int, float)) and v == v else None


def _ratio(cur, base):
    if cur is None or base is None or base <= 0:
        return None
    return round(cur / base - 1, 4)


def growth(financials: list[dict]) -> dict:
    """Growth columns for the newest quarter in `financials` (export rows)."""
    q = {r["period"]: r for r in financials
         if r.get("period_type") == "Q" and isinstance(r.get("period"), str) and "-Q" in r["period"]}
    if not q:
        return {}
    last = max(q)
    year, n = last.split("-Q")
    year, n = int(year), int(n)
    prev = q.get(f"{year - 1}-Q{n}")
    cur = q[last]
    out = {"g_q": last,
           "rev_q": _num(cur.get("revenue")), "ni_q": _num(cur.get("net_income")),
           "rev_p": _num(prev.get("revenue")) if prev else None,
           "ni_p": _num(prev.get("net_income")) if prev else None}
    out["rev_yoy"] = _ratio(out["rev_q"], out["rev_p"])
    out["ni_yoy"] = _ratio(out["ni_q"], out["ni_p"])

    def ytd(y, key):
        vals = [_num((q.get(f"{y}-Q{i}") or {}).get(key)) for i in range(1, n + 1)]
        return None if any(v is None for v in vals) else sum(vals)
    out["rev_ytd_yoy"] = _ratio(ytd(year, "revenue"), ytd(year - 1, "revenue")) if n > 1 else None
    out["ni_ytd_yoy"] = _ratio(ytd(year, "net_income"), ytd(year - 1, "net_income")) if n > 1 else None
    for k in ("rev_q", "ni_q", "rev_p", "ni_p"):
        if out[k] is not None:
            out[k] = round(out[k], 1)
    return out


def reaction(earnings, quarter: str) -> dict:
    """Release date and market-adjusted reaction for `quarter` ("2026-Q3")."""
    key = quarter.replace("-", "")
    for ev in ((earnings or {}).get("events") or []):
        if ev.get("q") == key:
            return {"er_date": ev.get("date"), "er_d1": _num(ev.get("d1")), "er_d5": _num(ev.get("d5"))}
    return {}


def main() -> None:
    screener = json.loads((DATA / "screener.json").read_text(encoding="utf-8"))
    filled = 0
    for row in screener:
        for k in COLS:
            row.pop(k, None)
        f = DATA / "ticker" / f"{row['ticker']}.json"
        try:
            obj = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        g = growth(obj.get("financials") or [])
        if g.get("g_q"):
            g.update(reaction(obj.get("earnings"), g["g_q"]))
        row.update(g)
        filled += g.get("rev_yoy") is not None or g.get("ni_yoy") is not None
    (DATA / "screener.json").write_text(
        json.dumps(screener, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"growth set on {filled} of {len(screener)} rows")


if __name__ == "__main__":
    main()

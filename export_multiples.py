"""Each ticker's own historical valuation multiples, from VCI -> data/own_multiples.json.

model_valuation used to measure "what has this stock traded at" itself: every
daily close over the trailing per-share figures. That needs the price and the
share count on the same basis, and they aren't. The stored prices are VCI's
adjusted history (cash dividends, bonus and stock issues, rights all priced
back into the past), while each quarter's EPS and book are per share of that
quarter's own count. Checked against VCI's own quarterly ratios on 40 names
(2026-11-13) the result read low -- P/E -12%, P/B -14% at the median, with
TCB at 5.0x earnings against 8.1x, VHM 3.4x against 8.3x, GMD 9.0x against
16.5x -- and wildly high where rights issues dominate (ORS 33.8x vs 13.8x).

VCI's statistics-financial feed gives P/E, P/B, P/S, P/OCF and EV/EBITDA at
each quarter end on the price and share count of that day. The medians of the
last WINDOW quarters replace the self-measured ones in model_valuation (both
the ticker's own multiples and, through them, the sector medians).

Weekly in refresh-slow.yml; a ticker whose call fails keeps last week's figure.

    python export_multiples.py [--tickers FPT SHB]
"""
from __future__ import annotations

import json
import statistics
import sys
import time
import warnings
from datetime import date
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "own_multiples.json"
WINDOW = 20                      # quarters: the five-year average analysts quote
MIN_QUARTERS = 8                 # fewer than two years of quarter ends is not a history
THROTTLE_S = 2.0
# feed field -> model key, with the range a quarter-end reading must fall in to
# count (a P/E of 500 is a near-zero denominator, not a price anyone paid).
FIELDS = {"pe": ("pe", 0, 200), "pb": ("pb", 0, 50), "ps": ("ps", 0, 100),
          "priceToCashFlow": ("pocf", 0, 200), "evToEbitda": ("ev_ebitda", 0, 200)}


def summarize(rows: list[dict], window: int = WINDOW) -> dict | None:
    """Median of each multiple over the newest `window` quarter ends."""
    rows = sorted((r for r in rows if r.get("yearReport") and r.get("quarter")),
                  key=lambda r: (int(r["yearReport"]), int(r["quarter"])))[-window:]
    if len(rows) < MIN_QUARTERS:
        return None
    out = {}
    for field, (key, lo, hi) in FIELDS.items():
        vals = [float(r[field]) for r in rows
                if isinstance(r.get(field), (int, float)) and lo < float(r[field]) < hi]
        if len(vals) >= MIN_QUARTERS:
            out[key] = round(statistics.median(vals), 4)
    if not out:
        return None
    out["n"] = len(rows)
    out["from"] = f"{rows[0]['yearReport']}Q{rows[0]['quarter']}"
    out["to"] = f"{rows[-1]['yearReport']}Q{rows[-1]['quarter']}"
    return out


def fetch(ticker: str) -> list[dict] | None:
    """VCI's quarterly ratio rows; None on a failed call (keep last week's)."""
    for wait in (0, 30, 130):          # vndata opens its breaker for 120 s
        if wait:
            time.sleep(wait)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                from vndata._http import get_json
                from vndata.company import IQ
                data = (get_json(f"{IQ}/v1/company/{ticker}/statistics-financial", {}) or {}).get("data")
        except (Exception, SystemExit):
            continue
        return [r for r in (data or []) if r.get("ratioType", "RATIO_TTM") == "RATIO_TTM"]
    return None


def main() -> None:
    args = sys.argv[1:]
    only = set(args[args.index("--tickers") + 1:]) if "--tickers" in args else None
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    have = dict(old.get("tickers") or {})
    tickers = sorted(json.loads((HERE / "data" / "screener.json").read_text(encoding="utf-8")),
                     key=lambda r: r["ticker"])
    done = failed = 0
    t0 = time.monotonic()
    for row in tickers:
        t = row["ticker"]
        if only is not None and t not in only:
            continue
        rows = fetch(t)
        time.sleep(THROTTLE_S)
        if rows is None:
            failed += 1
            continue
        s = summarize(rows)
        if s:
            have[t] = s
        else:
            have.pop(t, None)              # too short a history now: don't keep a stale one
        done += 1
        if (done + failed) % 50 == 0:
            print(f"  {done} fetched, {failed} failed ({time.monotonic() - t0:.0f}s)", flush=True)
    obj = {"generated": date.today().isoformat(), "window_quarters": WINDOW,
           "source": "VCI statistics-financial (quarter-end TTM ratios)", "tickers": have}
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    tmp.replace(OUT)
    print(f"Done: {done} fetched, {failed} failed, {len(have)} tickers with a history.")


if __name__ == "__main__":
    main()

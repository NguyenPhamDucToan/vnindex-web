"""Patch analyst target/rating into the per-ticker JSON files, slowly.

Separate from export_data.py because the VCI analyst endpoint (via vnstock) is
rate-limited to ~20 requests/minute on the Guest tier and hands out 57-second
penalties past that -- fetching 400+ tickers inline would stall the whole
export for an hour. This runs on its own throttle (~3.2s between calls ≈ 18/min,
safely under the cap) and rewrites each ticker/<T>.json in place, so it can grind
in the background without blocking anything. Re-runnable and idempotent.

    DATABASE_URL=...  python export_analyst.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import warnings
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))

TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"
THROTTLE_S = 3.2         # ~18 requests/minute, under the ~20/min Guest cap


def fetch_analyst(ticker: str):
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
        return {"target_price": round(tp), "rating": str(row.get("rating") or "")}
    except (Exception, SystemExit):
        return None


def main() -> None:
    # Only tickers that actually have a valuation (the ones the UI values).
    # --all refetches everything; default only fills tickers that don't have an
    # analyst record yet, so a re-run after a partial failure costs minutes
    # rather than the full ~22.
    refetch_all = "--all" in sys.argv
    files = sorted(TICKER_DIR.glob("*.json"))
    done = skipped = 0
    for i, f in enumerate(files, 1):
        obj = json.loads(f.read_text(encoding="utf-8"))
        if obj.get("valuation") is None:      # not a valued ticker -> skip
            skipped += 1
            continue
        if not refetch_all and obj.get("analyst") is not None:
            skipped += 1
            continue
        a = fetch_analyst(f.stem)
        obj["analyst"] = a
        f.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
        done += 1
        if done % 20 == 0:
            print(f"  {done} fetched ({i}/{len(files)} files)…", flush=True)
        time.sleep(THROTTLE_S)
    print(f"Done: {done} analyst records written, {skipped} non-valued skipped.")


if __name__ == "__main__":
    main()

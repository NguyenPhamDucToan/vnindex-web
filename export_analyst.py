"""Patch analyst target/rating into the per-ticker JSON files.

Separate from export_data.py because, under vnstock, the VCI analyst endpoint
was rate-limited to ~20 requests/minute on the Guest tier with 57-second
penalties past that -- fetching 400+ tickers inline would stall the whole
export for an hour. It now goes through vndata, which calls VCI directly, but
VCI's company endpoint has its own bot filter: at 0.5s between calls it
answered HTTP 418 after ~90 tickers (2026-11-02). So the pause stays at 3s
and a --all sweep of the ~400 valued tickers takes about 25 minutes.
refresh-slow.yml runs it every Sunday; before, the block was only ever filled
for tickers that lacked one, so targets went stale (TCB still showed 42,600
against a current 26,800 after its bonus issue).

Each record carries `as_of` -- the date VCI gives for the recommendation
itself -- and `fetched`, the day this script read it; the stock page shows the
first, or the second when VCI gives none. A call that fails keeps the
committed record; a ticker VCI no longer has a target for is cleared.
Rewrites each ticker/<T>.json in place. Re-runnable and idempotent.

    python export_analyst.py [--all]
"""
from __future__ import annotations

import json
import sys
import time
import warnings
from datetime import date, datetime
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))

TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"
THROTTLE_S = 3.0


def _as_of(raw) -> str | None:
    """VCI writes the recommendation date as '11-Sep-26'; store it as ISO."""
    text = str(raw or "").strip()
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:11], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fetch_analyst(ticker: str) -> dict | None:
    """The current VCI target, or None when VCI publishes none for the ticker.

    Raises when the call itself fails, so the caller can keep the old record.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from vndata import Company
        ov = Company(symbol=ticker, source="VCI").overview()
    if ov is None or ov.empty:
        return None
    row = ov.iloc[0]
    tp = float(row.get("target_price") or 0)
    if not tp:
        return None
    return {"target_price": round(tp), "rating": str(row.get("rating") or ""),
            "as_of": _as_of(row.get("rating_as_of")), "fetched": date.today().isoformat()}


def main() -> None:
    # Only tickers that actually have a valuation (the ones the UI values).
    # --all refetches everything; default only fills tickers that don't have an
    # analyst record yet.
    refetch_all = "--all" in sys.argv
    files = sorted(TICKER_DIR.glob("*.json"))
    done = skipped = failed = 0
    for i, f in enumerate(files, 1):
        obj = json.loads(f.read_text(encoding="utf-8"))
        if obj.get("valuation") is None:      # not a valued ticker -> skip
            skipped += 1
            continue
        if not refetch_all and obj.get("analyst") is not None:
            skipped += 1
            continue
        try:
            obj["analyst"] = fetch_analyst(f.stem)
        except (Exception, SystemExit) as e:
            failed += 1
            print(f"  ! {f.stem}: {e} -- keeping the committed record", flush=True)
            time.sleep(THROTTLE_S)
            continue
        f.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
        done += 1
        if done % 50 == 0:
            print(f"  {done} fetched ({i}/{len(files)} files)…", flush=True)
        time.sleep(THROTTLE_S)
    print(f"Done: {done} analyst records written, {failed} failed (kept), "
          f"{skipped} skipped.")


if __name__ == "__main__":
    main()

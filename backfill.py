"""Run export_detailed.py to completion, restarting it if it dies.

The universe takes ~80 minutes to sweep and the VCI Guest tier throttles with
SystemExit, so a long run can end early for reasons that a retry fixes. This
drives it with --missing, which only fetches tickers that still lack the field,
so each restart picks up where the last one stopped instead of starting over.

    python backfill.py payables        # or any detail field name
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

FIELD = sys.argv[1] if len(sys.argv) > 1 else "payables"
MAX_ROUNDS = 30
TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"


def remaining() -> int:
    n = 0
    for f in TICKER_DIR.glob("*.json"):
        try:
            o = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if o.get("valuation") is None:
            continue
        # Must match export_detailed.py --missing, which also accepts a
        # top-level block like `holders`. Without that this counted every
        # ticker as missing forever, reported "no progress" on the second
        # round and stopped -- after the first round had in fact fetched
        # all of them.
        det = o.get("detail") or {}
        top = o.get(FIELD)
        has_top = bool(top) if isinstance(top, (dict, list)) else top is not None
        if (not has_top
                and (det.get("balance") or {}).get(FIELD) is None
                and (det.get("income") or {}).get(FIELD) is None):
            n += 1
    return n


def main() -> None:
    last = None
    for rnd in range(1, MAX_ROUNDS + 1):
        left = remaining()
        print(f"[round {rnd}] {left} tickers still missing '{FIELD}'", flush=True)
        if left == 0:
            print("Done: nothing left.", flush=True)
            return
        # No forward progress twice running means the remainder is genuinely
        # unavailable from the source, not a transient throttle -- stop rather
        # than spin.
        if left == last:
            print(f"No progress last round; {left} tickers have no data for "
                  f"'{FIELD}' at the source. Stopping.", flush=True)
            return
        last = left
        r = subprocess.run([sys.executable, "-u", "export_detailed.py", "--missing", FIELD],
                           cwd=str(Path(__file__).resolve().parent))
        print(f"[round {rnd}] exit {r.returncode}", flush=True)
        time.sleep(30)                      # let any rate-limit penalty lapse
    print("Hit the round cap.", flush=True)


if __name__ == "__main__":
    main()

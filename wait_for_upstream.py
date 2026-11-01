"""Wait until today's run of a sibling-repo workflow has finished.

deploy.yml exports from the database that the sibling's refresh.yml writes,
and refresh-slow.yml reads the quarters its financials_refresh.yml stores.
Spacing the crons a few hours apart was not enough: GitHub starts scheduled
runs up to five hours late, and on 2026-10-27 the deploy began exporting at
15:56 UTC while the price refresh was still writing (15:17-16:12). So the
downstream job asks the Actions API instead of trusting the clock.

    python wait_for_upstream.py refresh.yml [--max-wait-min 80]

Returns once today's (ICT) run of the workflow has completed, whatever its
conclusion -- a failed refresh still leaves yesterday's data intact, which is
worth publishing. If none has completed within --max-wait-min it gives up with
a warning and lets the job continue rather than skipping the day. Never exits
non-zero: waiting is an optimisation, not a gate.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = "NguyenPhamDucToan/vnindex_valuation"
POLL_S = 120
_ICT = timezone(timedelta(hours=7))


def _runs(workflow: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/workflows/{workflow}/runs?per_page=10",
        headers={"Accept": "application/vnd.github+json"})
    token = os.getenv("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("workflow_runs", [])


def _ict_day(stamp: str):
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(_ICT).date()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow")
    ap.add_argument("--max-wait-min", type=float, default=80)
    args = ap.parse_args()

    today = datetime.now(_ICT).date()
    deadline = time.monotonic() + args.max_wait_min * 60
    while True:
        try:
            todays = [r for r in _runs(args.workflow) if _ict_day(r["created_at"]) == today]
        except Exception as e:                       # API hiccup: try again next poll
            print(f"could not read {args.workflow} runs: {e}")
            todays = None
        if todays is not None:
            active = [r for r in todays if r["status"] != "completed"]
            done = [r for r in todays if r["status"] == "completed"]
            if done and not active:
                r = done[0]
                print(f"{args.workflow}: today's run {r['id']} finished ({r['conclusion']}) "
                      f"at {r['updated_at']}")
                if r["conclusion"] != "success":
                    print(f"::warning::{REPO} {args.workflow} ended {r['conclusion']}; "
                          "exporting the data it left")
                return
            state = f"{len(active)} running/queued" if active else "not started yet"
            print(f"{args.workflow}: today's run {state}")
        if time.monotonic() >= deadline:
            print(f"::warning::{REPO} {args.workflow} had no finished run today after "
                  f"{args.max_wait_min:.0f} min; continuing with what the database holds")
            return
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()

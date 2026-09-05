"""Add a market-cap column to screener.json from the per-ticker files.

The sector heat map sizes each ticker by market cap, and screener.json carries
price but not share count. Everything needed is already on disk, so this reads
the local files rather than going back to the DB or the API.

    python add_mcap.py
"""
from __future__ import annotations

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"


def main() -> None:
    screener = json.loads((DATA / "screener.json").read_text(encoding="utf-8"))
    filled = missing = 0
    for row in screener:
        f = DATA / "ticker" / f"{row['ticker']}.json"
        if not f.exists():
            missing += 1
            continue
        try:
            obj = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            missing += 1
            continue
        qs = [r for r in (obj.get("financials") or []) if r.get("period_type") == "Q"]
        shares = None
        for r in reversed(qs):                       # newest quarter that has it
            if isinstance(r.get("shares_outstanding"), (int, float)):
                shares = r["shares_outstanding"]
                break
        px = obj.get("prices") or []
        close = px[-1].get("close") if px else None
        # close is thousands VND and shares are millions, so the product is
        # VND billions -- the unit the rest of the app reports market cap in.
        row["mcap"] = round(close * shares, 1) if (shares and close) else None
        if row["mcap"] is not None:
            filled += 1
        else:
            missing += 1

    (DATA / "screener.json").write_text(
        json.dumps(screener, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"mcap set on {filled} rows, {missing} without ({len(screener)} total)")


if __name__ == "__main__":
    main()

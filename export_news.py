"""Fast news/events-only backfill.

export_detailed.py fetches three financial reports plus news and events per
ticker (~5 calls), so a full sweep takes the better part of an hour. When only
the news section is missing, this pass costs two calls per ticker instead --
roughly two and a half times faster -- and walks the universe most-traded first
so the tickers people actually open fill in early.

    DATABASE_URL=...  python export_news.py [--all]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_detailed import fetch_news_events  # noqa: E402

TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"
THROTTLE_S = 4.5          # 2 calls + inline sleep => ~19 requests/minute


def main() -> None:
    refetch_all = "--all" in sys.argv
    order = {}
    try:
        for r in json.loads((TICKER_DIR.parent / "screener.json").read_text(encoding="utf-8")):
            order[r["ticker"]] = -(r.get("vol") or 0)
    except Exception:
        pass
    files = sorted(TICKER_DIR.glob("*.json"), key=lambda f: (order.get(f.stem, 1), f.stem))

    done = skipped = 0
    for f in files:
        obj = json.loads(f.read_text(encoding="utf-8"))
        if obj.get("valuation") is None:
            skipped += 1
            continue
        ne = obj.get("news_events") or {}
        if not refetch_all and (ne.get("news") or ne.get("events")):
            skipped += 1
            continue
        obj["news_events"] = fetch_news_events(f.stem)
        f.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        done += 1
        if done % 20 == 0:
            print(f"  {done} fetched — at {f.stem}", flush=True)
        time.sleep(THROTTLE_S)
    print(f"Done: {done} written, {skipped} skipped.")


if __name__ == "__main__":
    main()

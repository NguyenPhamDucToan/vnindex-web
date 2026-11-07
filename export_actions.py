"""Corporate actions feed (plan Day 98) -> the `actions` block of data/ticker/<T>.json.

One VCI call per ticker returns ten years of cash dividends and share issues
with the exchange's own ex-rights date, ratio and cash amount -- the facts the
price adjustment in export_data.py needs, instead of guessing them from gaps.
Like `news_events`, this is a slow block: export_data.py carries it forward,
and it only persists once committed (refresh-slow.yml runs this weekly).

    python export_actions.py [--all] [--tickers FPT SHB]
"""
from __future__ import annotations

import json
import re
import sys
import time
import warnings
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))          # vndata lives in the sibling repo

TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"
THROTTLE_S = 4.0

# Title fragment -> kind. Order matters: the first match wins.
_KINDS = (
    ("Cổ tức bằng Cổ phiếu", "stock"),
    ("Cổ phiếu thưởng", "bonus"),
    ("Quyền mua", "rights"),
    ("CBCNV", "esop"),
    ("riêng lẻ", "private"),
    ("trái phiếu chuyển đổi", "convert"),
    ("đấu giá", "public"),
    ("sáp nhập", "merger"),
)


def _d(x) -> str | None:
    s = str(x or "")[:10]
    return s if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else None


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def kind_of(code: str, title: str) -> str:
    if code == "DIV":
        return "cash"
    t = title.lower()
    for frag, k in _KINDS:
        if frag.lower() in t:
            return k
    return "other"


def parse(rows: list[dict]) -> list[dict]:
    """VCI event rows -> compact records, oldest first, de-duplicated."""
    out, seen = [], set()
    for r in rows:
        code = str(r.get("event_code") or "")
        if code not in ("DIV", "ISS"):
            continue
        title = str(r.get("event_title_vi") or "")
        rec = {
            "kind": kind_of(code, title),
            "ex": _d(r.get("exright_date")),
            "record": _d(r.get("record_date")),
            "pay": _d(r.get("payout_date")),
            "date": _d(r.get("display_date1")) or _d(r.get("public_date")),
            "ratio": _f(r.get("exercise_ratio")),
            "cash": _f(r.get("value_per_share")),          # VND per share
            "title": title[:200],
        }
        key = (rec["kind"], rec["ex"] or rec["date"], rec["ratio"], rec["cash"])
        if key in seen:
            continue
        seen.add(key)
        out.append(rec)
    out.sort(key=lambda e: e["ex"] or e["date"] or "")
    return out


def fetch_actions(ticker: str) -> list[dict] | None:
    """None on a failed call (keep the old block); [] when there are none.
    VCI starts refusing after a burst, so a failure backs off and retries."""
    for wait in (0, 30, 130):          # vndata opens its breaker for 120 s
        if wait:
            time.sleep(wait)
        out = _fetch_once(ticker)
        if out is not None:
            return out
    return None


def _fetch_once(ticker: str) -> list[dict] | None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from vndata import Company
            df = Company(symbol=ticker, source="VCI").events(event_codes="DIV,ISS", size=200)
    except (Exception, SystemExit):
        return None
    if df is None:
        return None
    return parse(df.to_dict("records")) if len(df) else []


def main() -> None:
    args = sys.argv[1:]
    refetch_all = "--all" in args
    only = set(args[args.index("--tickers") + 1:]) if "--tickers" in args else None
    files = sorted(TICKER_DIR.glob("*.json"))
    done = skipped = failed = 0
    t0 = time.monotonic()
    for f in files:
        if only is not None and f.stem not in only:
            continue
        if len(f.stem) != 3:                   # covered warrants: no dividends, no issues
            continue
        obj = json.loads(f.read_text(encoding="utf-8"))
        if only is None and not refetch_all and obj.get("actions") is not None:
            skipped += 1
            continue
        acts = fetch_actions(f.stem)
        if acts is None:
            failed += 1
        else:
            obj["actions"] = acts
            tmp = f.with_suffix(".tmp")         # an interrupted run never leaves half a file
            tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            tmp.replace(f)
            done += 1
        if (done + failed) % 25 == 0:
            print(f"  {done} written, {failed} failed — at {f.stem} ({time.monotonic() - t0:.0f}s)", flush=True)
        time.sleep(THROTTLE_S)
    print(f"Done: {done} written, {skipped} skipped, {failed} failed.")


if __name__ == "__main__":
    main()

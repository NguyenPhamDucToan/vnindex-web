"""Corporate actions and insider deals (plan Days 98, 102) -> the `actions`
and `insiders` blocks of data/ticker/<T>.json.

One VCI call per ticker returns ten years of cash dividends and share issues
(with the exchange's ex-rights date, ratio and cash amount) and of insider /
major-holder deals: individuals (DDIND), organisations (DDINS) and related
persons (DDRP). Like `news_events`, these are slow blocks: export_data.py
carries them forward, and they only persist once committed (refresh-slow.yml
runs this weekly).

Insider rows are filings, not executed volumes. A filing published after its
trading window closed is the result report of an earlier registration; the
two are merged into one deal so it is counted once.

    python export_actions.py [--all] [--tickers FPT SHB]   # fills tickers missing either block
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


_INSIDER_WHO = {"DDIND": "ind", "DDINS": "org", "DDRP": "rel"}
_DEAL = re.compile(r"^(.*?)\s*-\s*Đăng\s*k[ií]\s*(Mua|Bán)\s*([\d.,]+)", re.IGNORECASE)


def parse_insiders(rows: list[dict]) -> list[dict]:
    """Insider filings -> one record per deal, oldest first.

    status: "done"   registration followed by its result report;
            "result" a result report whose registration is not in the feed;
            "reg"    registration with no result report (yet).
    """
    recs, seen = [], set()
    for r in rows:
        code = str(r.get("event_code") or "")
        if code not in _INSIDER_WHO:
            continue
        m = _DEAL.match(str(r.get("event_title_vi") or ""))
        if not m:
            continue
        side = "buy" if m.group(2).lower() == "mua" else "sell"
        try:
            qty = int(re.sub(r"[.,]", "", m.group(3)))
        except ValueError:
            continue
        rec = {"name": m.group(1).strip()[:120], "who": _INSIDER_WHO[code], "side": side, "qty": qty,
               "start": _d(r.get("start_date")), "end": _d(r.get("end_date")),
               "pub": _d(r.get("public_date")) or _d(r.get("display_date2"))}
        rec["status"] = "result" if (rec["pub"] and rec["end"] and rec["pub"] > rec["end"]) else "reg"
        key = (rec["name"], side, qty, rec["start"], rec["status"])
        if key in seen:
            continue
        seen.add(key)
        recs.append(rec)
    recs.sort(key=lambda e: (e["start"] or e["pub"] or "", e["status"] == "result"))
    out = []
    for rec in recs:
        if rec["status"] == "result":
            match = next((o for o in reversed(out) if o["status"] == "reg" and o["name"] == rec["name"]
                          and o["side"] == rec["side"] and o["qty"] == rec["qty"]
                          and (o["start"] or "") <= (rec["end"] or "9") and (rec["start"] or "") <= (o["end"] or "9")),
                         None)
            if match:
                match["status"] = "done"
                match["result_pub"] = rec["pub"]
                continue
        out.append(rec)
    return out


def insider_net(insiders: list[dict] | None, shares_mn: float | None, today, days: int = 365) -> float | None:
    """Insider buys minus sells over the last `days`, as a fraction of shares
    outstanding (millions). Registrations without a result are left out: many
    are never carried through.

    The quantity on a filing is the REGISTERED one, result reports included,
    and a holder who doesn't finish re-registers the rest: FSN Asia filed five
    ADG sales of 6.17m, 6.17m, 5.17m, 4.15m and 4.17m while actually selling
    about 2m, and summing them gave -111% of the company. So each person counts
    once per side, at their largest filing -- an upper bound, not a sum.
    None when the block or the share count is missing; 0.0 when no deals."""
    if insiders is None or not shares_mn or shares_mn <= 0:
        return None
    from datetime import timedelta
    t0 = (today - timedelta(days=days)).isoformat()
    t1 = today.isoformat()
    most: dict[tuple, int] = {}
    for d in insiders:
        when = d.get("start") or d.get("pub") or ""
        if d.get("status") in ("result", "done") and t0 < when <= t1:
            k = (d.get("name"), d.get("side"))
            most[k] = max(most.get(k, 0), d["qty"])
    net = sum(q if side == "buy" else -q for (_n, side), q in most.items())
    return round(net / 1e6 / shares_mn, 6)


def fetch_actions(ticker: str) -> tuple[list[dict], list[dict]] | None:
    """(actions, insiders); None on a failed call (keep the old blocks).
    VCI starts refusing after a burst, so a failure backs off and retries."""
    for wait in (0, 30, 130):          # vndata opens its breaker for 120 s
        if wait:
            time.sleep(wait)
        out = _fetch_once(ticker)
        if out is not None:
            return out
    return None


def _fetch_once(ticker: str) -> tuple[list[dict], list[dict]] | None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from vndata import Company
            df = Company(symbol=ticker, source="VCI").events(
                event_codes="DIV,ISS," + ",".join(_INSIDER_WHO), size=400)
    except (Exception, SystemExit):
        return None
    if df is None:
        return None
    rows = df.to_dict("records") if len(df) else []
    return parse(rows), parse_insiders(rows)


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
        if (only is None and not refetch_all and obj.get("actions") is not None
                and obj.get("insiders") is not None):
            skipped += 1
            continue
        got = fetch_actions(f.stem)
        if got is None:
            failed += 1
        else:
            obj["actions"], obj["insiders"] = got
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

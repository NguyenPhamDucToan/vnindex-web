"""Export the detailed VCI income statement / balance sheet / annual cash flow.

The stock tab's deeper chart rows (financial income & expense, provision
build-up, receivables and inventory breakdowns, short vs long-term borrowings,
dividends) are drawn in the Streamlit app from `load_detailed_financials()` and
`load_annual_cf()` -- live VCI calls that return far more line items than the
`Financial` table stores. The static site can't make those calls, so they are
fetched once here and folded into each ticker's JSON as a `detail` block.

Like export_analyst.py this is a SEPARATE, throttled job: VCI's Guest tier caps
at ~20 requests/minute and each ticker costs three reports, so the whole
universe takes roughly an hour. Re-runnable and idempotent -- by default it only
fetches tickers that don't have a `detail` block yet; pass --all to refetch.

    DATABASE_URL=...  python export_detailed.py [--all]
"""
from __future__ import annotations

import json
import sys
import time
import warnings
from pathlib import Path

_SIBLING = Path(__file__).resolve().parent.parent / "vnindex-valuation"
if _SIBLING.exists():
    sys.path.insert(0, str(_SIBLING))

TICKER_DIR = Path(__file__).resolve().parent / "data" / "ticker"
THROTTLE_S = 9.5          # 3 reports per ticker => ~19 requests/minute

# Only the line items the charts actually plot, so the JSON stays small. Keys
# are our own names; values are the VCI item_ids to try in order (the API's
# naming drifts between company types).
INCOME_ITEMS = {
    "revenue":            ["revenue", "net_revenue", "sales"],
    "gross_profit":       ["gross_profit"],
    "financial_income":   ["revenue_from_financial_activities", "financial_income"],
    "financial_expense":  ["expense_from_financial_activities", "financial_expenses"],
    "interest_expense":   ["interest_expenses", "interests_expenses"],
    "selling_expense":    ["selling_expenses", "selling_cost"],
    "ga_expense":         ["general_and_admin_expenses", "ga_expense"],
    "operating_profit":   ["operating_profit_loss"],
    "other_profit":        ["net_other_income_expenses", "other_profit"],
    "pre_tax_profit":      ["net_accounting_profit_loss_before_tax"],
    "tax_expense":         ["corporate_income_tax_expenses"],
    "net_income":          ["net_profit_loss_after_tax", "attributable_to_parent_company"],
}
BALANCE_ITEMS = {
    "cash":               ["cash_and_cash_equivalents", "cash_and_precious_metals"],
    "receivables":        ["short_term_receivables", "receivables"],
    "receivables_trade":  ["accounts_receivable", "trade_receivables"],
    "receivables_lt":     ["long_term_receivables"],
    "prov_doubtful":      ["provision_for_doubtful_debts", "provision_for_short_term_receivables"],
    "inventory_gross":    ["inventories_gross", "inventories"],
    "inventory_net":      ["inventories_net"],
    "prov_inventory":     ["provision_for_decline_in_inventories"],
    "current_assets":     ["current_assets"],
    "total_assets":       ["total_assets"],
    "st_borrowings":      ["short_term_borrowings"],
    "lt_borrowings":      ["long_term_borrowings"],
    "payables":           ["short_term_trade_payables", "payables"],
    "current_liabilities": ["current_liabilities"],
    "equity":             ["owners_equity", "equity"],
}


def _client(ticker: str):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from vnstock.explorer.vci import Finance
        return Finance(symbol=ticker, period="quarter", get_all=False, show_log=False)


def _series(df, ids, periods, scale=1e9):
    """Pull one line item across the given period columns, in VND billions."""
    if df is None or getattr(df, "empty", True) or "item_id" not in df.columns:
        return None
    for iid in ids:
        m = df["item_id"] == iid
        if not m.any():
            continue
        row, out, seen = df.loc[m].iloc[0], [], False
        for p in periods:
            v = None
            if p in df.columns:
                try:
                    raw = float(row[p])
                    v = None if raw != raw else round(raw / scale, 4)   # NaN check
                except (TypeError, ValueError):
                    v = None
            out.append(v)
            seen = seen or v is not None
        if seen:
            return out
    return None


def _period_cols(df, limit=12):
    """Quarter columns like '2026-Q1', newest last."""
    if df is None or getattr(df, "empty", True):
        return []
    cols = [c for c in df.columns if isinstance(c, str) and len(c) == 7 and c[4] == "-" and c[5] == "Q"]
    return sorted(cols)[-limit:]


def fetch_detail(ticker: str) -> dict | None:
    try:
        fin = _client(ticker)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            inc = fin._get_report("income_statement", period="quarter", lang="en", show_log=False, limit=50)
            time.sleep(2.0)
            bal = fin._get_report("balance_sheet", period="quarter", lang="en", show_log=False, limit=50)
            time.sleep(2.0)
            cfy = fin._get_report("cash_flow", period="year", lang="en", show_log=False, limit=20)
    except (Exception, SystemExit):
        return None

    periods = _period_cols(inc) or _period_cols(bal)
    if not periods:
        return None

    out = {"periods": periods, "income": {}, "balance": {}, "dividends": []}
    for name, ids in INCOME_ITEMS.items():
        s = _series(inc, ids, periods)
        if s: out["income"][name] = s
    for name, ids in BALANCE_ITEMS.items():
        s = _series(bal, ids, periods)
        if s: out["balance"][name] = s

    # Annual cash dividends paid, for the dividend chart.
    try:
        ycols = sorted([c for c in cfy.columns if isinstance(c, str) and c.isdigit()])[-8:]
        div = _series(cfy, ["dividends_paid", "dividend_paid", "payments_of_dividends"], ycols)
        if div:
            out["dividends"] = [{"year": y, "value": (abs(v) if v is not None else None)}
                                for y, v in zip(ycols, div)]
    except Exception:
        pass
    return out


def main() -> None:
    refetch_all = "--all" in sys.argv
    # Fetch the most-traded names first. Alphabetical order buries the tickers
    # people actually open (VCB, VNM, ...) at the end of an hour-long run, so
    # the charts appear last exactly where they are looked at first.
    import json as _json
    order = {}
    try:
        for r in _json.loads((TICKER_DIR.parent / "screener.json").read_text(encoding="utf-8")):
            order[r["ticker"]] = -(r.get("vol") or 0)
    except Exception:
        pass
    files = sorted(TICKER_DIR.glob("*.json"), key=lambda f: (order.get(f.stem, 1), f.stem))
    done = skipped = failed = 0
    for i, f in enumerate(files, 1):
        obj = json.loads(f.read_text(encoding="utf-8"))
        if obj.get("valuation") is None:
            skipped += 1
            continue
        if not refetch_all and obj.get("detail"):
            skipped += 1
            continue
        d = fetch_detail(f.stem)
        obj["detail"] = d
        f.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        done += 1
        if d is None:
            failed += 1
        if done % 10 == 0:
            print(f"  {done} fetched ({failed} empty) — at {f.stem}, file {i}/{len(files)}", flush=True)
        time.sleep(THROTTLE_S)
    print(f"Done: {done} written ({failed} empty), {skipped} skipped.")


if __name__ == "__main__":
    main()

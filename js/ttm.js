// Trailing-twelve-month snapshot from the exported quarterly financials,
// mirroring valuation/inputs.py::compute_ttm: FLOW items are summed over the
// last 4 quarters, STOCK (balance-sheet) items are taken from the most recent
// quarter only. Needed for the bank/securities metric rows, which aren't stored
// as ready-made ratio columns.

const FLOW = ["revenue", "cogs", "gross_profit", "selling_expense", "ga_expense",
  "ebit", "ebitda", "depreciation", "interest_expense", "tax_expense",
  "net_income", "operating_cf", "capex", "fcf", "investing_cf", "financing_cf"];
const STOCK = ["total_assets", "current_assets", "current_liabilities", "inventory",
  "receivables", "payables", "equity", "debt", "cash", "retained_earnings",
  "shares_outstanding"];

export function quarters(financials) {
  return (financials || []).filter((f) => f.period_type === "Q");
}

export function computeTTM(financials) {
  const qs = quarters(financials);
  if (qs.length < 1) return null;
  const last4 = qs.slice(-4);
  const latest = qs[qs.length - 1];
  const out = {};
  for (const k of FLOW) {
    let sum = 0, any = false;
    for (const q of last4) if (typeof q[k] === "number") { sum += q[k]; any = true; }
    out[k] = any ? sum : null;
  }
  for (const k of STOCK) out[k] = latest[k] ?? null;
  return out;
}

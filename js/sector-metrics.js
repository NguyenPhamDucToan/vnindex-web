// Sector-characteristic radar axes.
//
// The original compares every company on the same five generic axes (ROE, net
// margin, FCF margin, quality, upside). That flattens exactly the differences
// that matter: a bank has no gross margin and no inventory, an insurer's whole
// business is its combined ratio, a broker's is its trading book. Each sector
// family below gets the axes its own analysts use, and the generic five remain
// the fallback for mixed selections and unclassified names.
//
// Every axis is normalised to 0-100 against `max`, so the radar stays
// comparable; `lowerBetter` inverts that (a 60% loss ratio should plot as
// strong, not weak). `fmt` renders the real number for the hover.
import * as F from "./format.js";

const num = (v) => (F.isNum(v) ? v : null);
const div = (a, b) => (F.isNum(a) && F.isNum(b) && b !== 0 ? a / b : null);
const abs = (v) => (F.isNum(v) ? Math.abs(v) : null);
// Detail series are per-quarter arrays; TTM sums the last four.
const dSum4 = (d, group, key) => {
  const a = ((d.detail || {})[group] || {})[key];
  if (!Array.isArray(a)) return null;
  const t = a.slice(-4).filter(F.isNum);
  return t.length ? t.reduce((x, y) => x + y, 0) : null;
};
const dLast = (d, group, key) => {
  const a = ((d.detail || {})[group] || {})[key];
  if (!Array.isArray(a)) return null;
  for (let i = a.length - 1; i >= 0; i--) if (F.isNum(a[i])) return a[i];
  return null;
};

const PCT = (v) => (F.isNum(v) ? `${(v * 100).toFixed(1)}%` : "—");
const NUM = (v) => (F.isNum(v) ? `${v.toFixed(2)}×` : "—");
const DAYS = (v) => (F.isNum(v) ? `${v.toFixed(0)} ngày` : "—");
const SCORE = (v) => (F.isNum(v) ? `${v.toFixed(0)}/100` : "—");

// ── shared axis builders ─────────────────────────────────────────
const A = {
  roe: { label: "ROE", max: 0.30, fmt: PCT, calc: (c) => num(c.v.roe) },
  netMargin: { label: "Biên lợi nhuận ròng", max: 0.25, fmt: PCT, calc: (c) => num(c.v.net_margin) },
  fcfMargin: { label: "Biên FCF", max: 0.20, fmt: PCT, calc: (c) => num(c.v.fcf_margin) },
  quality: { label: "Chất lượng", max: 100, fmt: SCORE, calc: (c) => num(c.q) },
  upside: { label: "Upside", max: 1.0, fmt: PCT, calc: (c) => num(c.upFrac) },
  grossMargin: { label: "Biên gộp", max: 0.40, fmt: PCT,
    calc: (c) => div(c.ttm.gross_profit, c.ttm.revenue) },
  ebitdaMargin: { label: "Biên EBITDA", max: 0.35, fmt: PCT,
    calc: (c) => div(c.ttm.ebitda ?? ((c.ttm.ebit || 0) + (c.ttm.depreciation || 0)), c.ttm.revenue) },
  de: { label: "D/E", max: 2.0, fmt: NUM, lowerBetter: true, calc: (c) => num(c.v.debt_to_equity) },
  assetTurn: { label: "Vòng quay tài sản", max: 2.0, fmt: NUM,
    calc: (c) => div(c.ttm.revenue, c.ttm.total_assets) },
  invTurn: { label: "Vòng quay tồn kho", max: 8.0, fmt: NUM,
    calc: (c) => div(abs(c.ttm.cogs), c.ttm.inventory) },
  dso: { label: "Số ngày phải thu", max: 120, fmt: DAYS, lowerBetter: true,
    calc: (c) => { const r = div(c.ttm.receivables, c.ttm.revenue); return r === null ? null : r * 365; } },
  ccc: { label: "CCC", max: 180, fmt: DAYS, lowerBetter: true,
    calc: (c) => {
      const dio = div(c.ttm.inventory, abs(c.ttm.cogs));
      const dso = div(c.ttm.receivables, c.ttm.revenue);
      const dpo = div(dLast(c.d, "balance", "payables"), abs(c.ttm.cogs));
      if (dio === null || dso === null) return null;
      return (dio + dso - (dpo ?? 0)) * 365;
    } },
  ocfToNi: { label: "Dòng tiền kinh doanh / Lợi nhuận sau thuế", max: 2.0, fmt: NUM,
    calc: (c) => div(c.ttm.operating_cf, c.ttm.net_income) },
  invToAssets: { label: "Hàng tồn kho / Tổng tài sản", max: 0.60, fmt: PCT, lowerBetter: true,
    calc: (c) => div(c.ttm.inventory, c.ttm.total_assets) },
  capexToRev: { label: "CAPEX/Doanh thu", max: 0.30, fmt: PCT, lowerBetter: true,
    calc: (c) => div(abs(c.ttm.capex), c.ttm.revenue) },
  depToRev: { label: "Khấu hao/Doanh thu", max: 0.25, fmt: PCT,
    calc: (c) => div(abs(c.ttm.depreciation), c.ttm.revenue) },
  revGrowth: { label: "Tăng trưởng DT", max: 0.40, fmt: PCT,
    calc: (c) => {
      const qs = (c.d.financials || []).filter((f) => f.period_type === "Q")
        .sort((a, b) => String(a.period).localeCompare(String(b.period)));
      if (qs.length < 8) return null;
      const sum = (a) => a.map((r) => r.revenue).filter(F.isNum).reduce((x, y) => x + y, 0);
      const now = sum(qs.slice(-4)), prev = sum(qs.slice(-8, -4));
      return prev > 0 ? now / prev - 1 : null;
    } },
  profitQuality: { label: "Chất lượng lợi nhuận", max: 2.0, fmt: NUM,
    calc: (c) => num(c.v.profit_quality) },
  leverage: { label: "Đòn bẩy", max: 5.0, fmt: NUM, lowerBetter: true,
    calc: (c) => div(c.ttm.total_assets, c.ttm.equity) },
};

// ── bank ─────────────────────────────────────────────────────────
// Banks map net interest income onto gross_profit and provisions onto cogs;
// customer deposits sit in payables and net loans in receivables.
const BANK = [
  { label: "NIM", max: 0.05, fmt: PCT, calc: (c) => div(c.ttm.gross_profit, c.ttm.total_assets) },
  { label: "CIR", max: 0.60, fmt: PCT, lowerBetter: true,
    calc: (c) => div(abs(c.ttm.selling_expense || 0) + abs(c.ttm.ga_expense || 0), c.ttm.revenue) },
  { label: "Chi phí tín dụng", max: 0.03, fmt: PCT, lowerBetter: true,
    calc: (c) => div(abs(c.ttm.cogs), c.ttm.receivables) },
  { label: "LDR", max: 1.2, fmt: NUM, calc: (c) => div(c.ttm.receivables, c.ttm.payables) },
  A.roe,
  { label: "Vốn chủ sở hữu / Tổng tài sản", max: 0.15, fmt: PCT, calc: (c) => div(c.ttm.equity, c.ttm.total_assets) },
];

// ── securities ───────────────────────────────────────────────────
const SECURITIES = [
  { label: "Tài sản tài chính / Tổng tài sản", max: 0.80, fmt: PCT,
    calc: (c) => div(dLast(c.d, "balance", "fvtpl"), c.ttm.total_assets) },
  { label: "Dư nợ margin / Vốn chủ sở hữu", max: 2.0, fmt: NUM,
    // The margin book is the `loans` line, not trade receivables: SSI carries
    // 40,473bn of margin lending against 1,132bn of receivables, so the old
    // fallback understated this by a factor of 36. Regulation caps it at 2x
    // equity, which is why `max` is 2.0 -- a broker near the top of this axis
    // has no room left to grow the book and takes the full hit of a selloff.
    // Lower is safer, not worse: this is leverage against client positions, and
    // the table was starring the broker closest to the cap as the leader while
    // the scorecard painted the same 2.02x red.
    lowerBetter: true,
    calc: (c) => div(dLast(c.d, "balance", "sec_loans"), c.ttm.equity) },
  A.leverage,
  A.netMargin, A.roe, A.upside,
];

// ── insurance ────────────────────────────────────────────────────
// The six the user approved, in that order. The three insurance-only ratios
// below them are marked `extra`: they are the sector's real headline numbers
// but a six-spoke radar is already at its readable limit, so they appear in
// the bar grid and the per-ticker table instead.
const INSURANCE = [
  { label: "Đầu tư / Tổng tài sản", max: 1.0, fmt: PCT,
    calc: (c) => div((dLast(c.d, "balance", "ins_st_invest") || 0)
                   + (dLast(c.d, "balance", "ins_lt_invest") || 0), c.ttm.total_assets) },
  A.netMargin, A.roe, A.leverage, A.profitQuality, A.upside,
  { label: "Combined ratio", max: 1.2, fmt: PCT, lowerBetter: true, extra: true,
    calc: (c) => {
      const p = dSum4(c.d, "income", "ins_net_premium");
      const claims = abs(dSum4(c.d, "income", "ins_claims"));
      const exp = abs(c.ttm.selling_expense || 0) + abs(c.ttm.ga_expense || 0);
      return div((claims ?? 0) + exp, p);
    } },
  { label: "Tỷ lệ bồi thường", max: 1.0, fmt: PCT, lowerBetter: true, extra: true,
    calc: (c) => div(abs(dSum4(c.d, "income", "ins_claims")), dSum4(c.d, "income", "ins_net_premium")) },
  { label: "Tỷ lệ giữ lại", max: 1.0, fmt: PCT, extra: true,
    calc: (c) => div(dSum4(c.d, "income", "ins_net_premium"), dSum4(c.d, "income", "ins_gross_premium")) },
];

const GENERIC = [A.roe, A.netMargin, A.fcfMargin, A.quality, A.upside];

const REAL_ESTATE = [A.grossMargin, A.invToAssets, A.de, A.ocfToNi, A.roe, A.upside];
const CONSTRUCTION = [A.grossMargin, A.dso, A.de, A.ocfToNi, A.roe, A.upside];
const TRADE = [A.grossMargin, A.invTurn, A.assetTurn, A.netMargin, A.ccc, A.roe];
const FOOD = [A.grossMargin, A.invTurn, A.dso, A.netMargin, A.roe, A.upside];
const MANUFACTURING = [A.grossMargin, A.ebitdaMargin, A.invTurn, A.ccc, A.de, A.roe];
const UTILITIES = [A.ebitdaMargin, A.depToRev, A.de, A.fcfMargin, A.roe, A.upside];
const TRANSPORT = [A.ebitdaMargin, A.assetTurn, A.de, A.fcfMargin, A.roe, A.upside];
const MINING = [A.ebitdaMargin, A.capexToRev, A.de, A.fcfMargin, A.roe, A.upside];
const TECH = [A.revGrowth, A.grossMargin, A.netMargin, A.fcfMargin, A.roe, A.upside];
const HEALTH = [A.grossMargin, A.netMargin, A.profitQuality, A.de, A.roe, A.upside];
const HOSPITALITY = [A.ebitdaMargin, A.assetTurn, A.de, A.fcfMargin, A.roe, A.upside];

export const SECTOR_AXES = {
  "Ngân hàng": BANK,
  "Chứng khoán": SECURITIES,
  "Bảo hiểm": INSURANCE,
  "Bất động sản": REAL_ESTATE,
  "Xây dựng": CONSTRUCTION,
  "Bán lẻ": TRADE,
  "Bán buôn": TRADE,
  "Thực phẩm - Đồ uống": FOOD,
  "Chế biến Thủy sản": FOOD,
  "Nông - Lâm - Ngư": FOOD,
  "SX Nhựa - Hóa chất": MANUFACTURING,
  "SX Phụ trợ": MANUFACTURING,
  "SX Hàng gia dụng": MANUFACTURING,
  "Vật liệu xây dựng": MANUFACTURING,
  "Thiết bị điện": MANUFACTURING,
  "SX Thiết bị, máy móc": MANUFACTURING,
  "Sản phẩm cao su": MANUFACTURING,
  "Tiện ích": UTILITIES,
  "Vận tải - kho bãi": TRANSPORT,
  "Khai khoáng": MINING,
  "Công nghệ và thông tin": TECH,
  "Chăm sóc sức khỏe": HEALTH,
  "Dịch vụ lưu trú, ăn uống, giải trí": HOSPITALITY,
};

/** Axes for a set of companies: sector-specific when they all share one. */
// A spoke is useless when the sector's own median sits past the end of it:
// every company pegs at the rim and the axis stops separating anyone. Measured
// on 20 tickers per sector, nine spokes were in that state -- retail turns its
// inventory 8.7 times against a scale ending at 8, construction collects in 122
// days on a 120-day scale, brokers earn a 29% net margin on a 25% scale. The
// scale is stretched for those sectors only: raising the shared value instead
// would push every manufacturer toward the centre, since their medians are half
// as large.
//
// Upside is deliberately left at 1.0. Beyond +100% the distinction stops
// meaning much, and stretching the axis to the +250% that real estate shows
// would flatten every ordinary +20% case into the middle.
const AXIS_MAX_OVERRIDE = {
  "Bất động sản":                      { "Biên gộp": 0.60 },
  "Dịch vụ lưu trú, ăn uống, giải trí": { "Biên EBITDA": 0.70, "Biên FCF": 0.40 },
  "Nông - Lâm - Ngư":                  { "Vòng quay tồn kho": 20 },
  "Bán lẻ":                            { "Vòng quay tồn kho": 16, "Vòng quay tài sản": 3.5 },
  "Bán buôn":                          { "Vòng quay tồn kho": 16, "Vòng quay tài sản": 3.0 },
  "Xây dựng":                          { "Số ngày phải thu": 200 },
  "Chứng khoán":                       { "Biên lợi nhuận ròng": 0.40 },
  "Công nghệ và thông tin":            { "Tăng trưởng DT": 1.0 },
};

export function axesFor(sectors) {
  const uniq = [...new Set(sectors.filter(Boolean))];
  if (uniq.length === 1 && SECTOR_AXES[uniq[0]]) {
    const over = AXIS_MAX_OVERRIDE[uniq[0]] || {};
    // Radar spokes only: `extra` metrics belong to the bars and the table.
    return SECTOR_AXES[uniq[0]].filter((a) => !a.extra)
      .map((a) => (over[a.label] ? { ...a, max: over[a.label] } : a));
  }
  return GENERIC;
}

/** Every axis for a sector, scale overrides applied -- bars and table use this. */
export function allAxesFor(sector) {
  const axes = SECTOR_AXES[sector];
  if (!axes) return null;
  const over = AXIS_MAX_OVERRIDE[sector] || {};
  return axes.map((a) => (over[a.label] ? { ...a, max: over[a.label] } : a));
}

/** 0-100 position of `raw` on `axis`, with lowerBetter inverted. */
export function normalise(axis, raw) {
  if (!F.isNum(raw)) return 0;
  const pos = Math.max(0, Math.min(100, (raw / axis.max) * 100));
  return axis.lowerBetter ? 100 - pos : pos;
}

export { GENERIC };

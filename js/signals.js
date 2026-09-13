// Ported 1:1 from ../vnindex-valuation/valuation/signals.py so the static site
// classifies a stock exactly as the Python screener/backtest does.

export const SIGNAL_ORDER = [
  "Strong Buy", "Buy", "Watch", "Neutral", "Reduce", "Sell", "Strong Sell",
];

// Vietnamese labels for the UI (the engine keeps the canonical English keys).
export const SIGNAL_VI = {
  "Strong Buy": "Mua mạnh",
  "Buy": "Mua",
  "Watch": "Theo dõi",
  "Neutral": "Trung lập",
  "Reduce": "Giảm",
  "Sell": "Bán",
  "Strong Sell": "Bán mạnh",
};

const clamp10 = (x) => Math.max(0, Math.min(10, x));

// Banks, brokers and insurers do not report the line items three of these six
// thresholds are calibrated against, so those sub-scores stop measuring
// anything for them -- 19 of 21 banks scored a perfect 10/10 on net margin
// (their "revenue" is total operating income, median margin 37% against a 20%
// bar) and 18 of 21 on FCF margin. See FINANCIAL_SECTORS in signals.py for the
// measurements behind each substitution; this mirrors it exactly.
export const FINANCIAL_SECTORS = new Set(["Ngân hàng", "Chứng khoán", "Bảo hiểm"]);

// Composite 0-100 quality score from up to 6 stored ratios. Same thresholds as
// compute_quality_score() in signals.py. Omitting `sector` keeps the original
// industrial bars, as it does in Python.
export function computeQualityScore(roe, netMargin, profitQuality, fcfMargin,
                                    currentRatio, debtToEquity, sector) {
  const s = [];
  const fin = FINANCIAL_SECTORS.has(sector);
  const has = (v) => typeof v === "number" && isFinite(v);
  if (has(roe))           s.push(clamp10(Math.max(roe, 0) / 0.25 * 10));
  if (has(netMargin))     s.push(clamp10(Math.max(netMargin, 0) / (fin ? 0.40 : 0.20) * 10));
  if (has(profitQuality) && !fin) s.push(clamp10(Math.max(profitQuality, 0) / 1.5 * 10));
  if (has(fcfMargin) && !fin)     s.push(clamp10(Math.max(fcfMargin, 0) / 0.15 * 10));
  if (has(currentRatio))  s.push(clamp10((currentRatio - 0.5) / 2.0 * 10));
  if (has(debtToEquity)) {
    const bar = fin ? 4.0 : 3.0;
    s.push(clamp10((bar - Math.min(debtToEquity, bar)) / bar * 10));
  }
  if (!s.length) return 0;
  return Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10 * 10) / 10;
}

// avgUpside is a FRACTION (0.20 = +20%); note upside_pct in the DB is stored
// as a percent number, so callers divide it by 100 before passing it here.
export function classifySignal(avgUpside, qualityScore) {
  const u = avgUpside, q = qualityScore;
  if (u >= 0.20 && q >= 60) return "Strong Buy";
  if (u >= 0.10 && q >= 45) return "Buy";
  if (u >= 0.00)            return "Watch";
  if (u >= -0.10)           return "Neutral";
  if (u >= -0.30)           return "Reduce";
  if (u >= -0.50)           return "Sell";
  return "Strong Sell";
}

export const SIGNAL_COLOR = {
  "Strong Buy": "#15803d", "Buy": "#16a34a", "Watch": "#65a30d",
  "Neutral": "#6b7280", "Reduce": "#d97706", "Sell": "#dc2626",
  "Strong Sell": "#b91c1c",
};

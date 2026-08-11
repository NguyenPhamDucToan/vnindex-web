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

// Composite 0-100 quality score from 6 stored ratios. Same thresholds as
// compute_quality_score() in signals.py.
export function computeQualityScore(roe, netMargin, profitQuality, fcfMargin,
                                    currentRatio, debtToEquity) {
  const s = [];
  const has = (v) => typeof v === "number" && isFinite(v);
  if (has(roe))           s.push(clamp10(Math.max(roe, 0) / 0.25 * 10));
  if (has(netMargin))     s.push(clamp10(Math.max(netMargin, 0) / 0.20 * 10));
  if (has(profitQuality)) s.push(clamp10(Math.max(profitQuality, 0) / 1.5 * 10));
  if (has(fcfMargin))     s.push(clamp10(Math.max(fcfMargin, 0) / 0.15 * 10));
  if (has(currentRatio))  s.push(clamp10((currentRatio - 0.5) / 2.0 * 10));
  if (has(debtToEquity))  s.push(clamp10((3.0 - Math.min(debtToEquity, 3.0)) / 3.0 * 10));
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

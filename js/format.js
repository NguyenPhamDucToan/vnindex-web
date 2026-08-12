// Number/price/percent formatters, matching the Streamlit app's conventions.
// Prices in the DB are in THOUSANDS of VND (59.8 = 59,800 VND); intrinsic
// values (dcf_estimate, avg_intrinsic_value) are raw VND.

export const isNum = (v) => typeof v === "number" && isFinite(v);

// A stored close of 59.8 -> "59,800" (raw VND for display).
export function priceVND(thousands) {
  if (!isNum(thousands)) return "—";
  return Math.round(thousands * 1000).toLocaleString("en-US");
}

// Raw VND -> "64,082"
export function rawVND(v) {
  if (!isNum(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

// 0.153 -> "15.3%"  (fraction in, percent out)
export function pct(frac, digits = 1) {
  if (!isNum(frac)) return "—";
  return (frac * 100).toFixed(digits) + "%";
}

// already-percent number: 7.16 -> "+7.2%"
export function pctSigned(p, digits = 1) {
  if (!isNum(p)) return "—";
  return (p >= 0 ? "+" : "") + p.toFixed(digits) + "%";
}

// 2.42 -> "2.42x"
export function mult(v, digits = 2) {
  if (!isNum(v)) return "—";
  return v.toFixed(digits) + "x";
}

// 1234.5 -> "1,234.5" ; used for billions-VND figures
export function num(v, digits = 1) {
  if (!isNum(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function days(v) {
  if (!isNum(v)) return "—";
  return Math.round(v).toLocaleString("en-US") + " ngày";
}

// raw VND -> adaptive "1.2 tỷ" / "340 triệu" / "12,000 ₫"
export function moneyVND(vnd) {
  if (!isNum(vnd)) return "—";
  const a = Math.abs(vnd);
  if (a >= 1e9) return (vnd / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " tỷ";
  if (a >= 1e6) return (vnd / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " triệu";
  return Math.round(vnd).toLocaleString("en-US") + " ₫";
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

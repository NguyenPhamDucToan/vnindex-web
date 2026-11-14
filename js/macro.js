// Macro sub-tab of the market view, matching the original's nine indicator
// groups. Everything comes from the flat data/macro.json the export writes; the
// grouping lives here so adding an indicator is a one-line change.
import { loadMacro, loadBankRates, loadCommodities } from "./data.js";
import * as F from "./format.js";
import { NUM_LOCALE } from "./i18n.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const FONT = { family: "Fira Code, monospace", size: 9, color: "#0a121d" };
const BLUE = "#2563eb", ORANGE = "#ea580c", GREEN = "#15803d", PURPLE = "#7c3aed",
      TEAL = "#0e7490", RED = "#b91c1c";

// [group] -> charts. Each chart is {title, series: [[label, key, colour]], kind}.
// kind "bar" for headline single series, "line" for trends and multi-series.
const GROUPS = {
  "Tổng quan kinh tế": [
    { title: "Tăng trưởng GDP (so với cùng kỳ năm trước)", kind: "bar", unit: "%", series: [["GDP", "gdp_growth", BLUE]] },
    { title: "Lạm phát (so với cùng kỳ năm trước)", kind: "bar", unit: "%", series: [["CPI YoY", "cpi_yoy", ORANGE]] },
    { title: "Lạm phát (so với tháng trước)", kind: "bar", unit: "%", series: [["CPI MoM", "cpi_mom", ORANGE]] },
    { title: "Cán cân thương mại", kind: "bar", unit: "tỷ USD", series: [["Cán cân", "trade_balance", GREEN]] },
    { title: "Bán lẻ theo tháng (so với cùng kỳ năm trước)", kind: "bar", unit: "%", series: [["Bán lẻ", "retail_yoy", PURPLE]] },
    { title: "Vốn đầu tư nước ngoài (FDI đăng ký, theo quý)", kind: "bar", unit: "tỷ USD", series: [["FDI", "fdi", TEAL]] },
  ],
  "Tăng trưởng kinh tế": [
    { title: "Tăng trưởng GDP theo khu vực (so với cùng kỳ)", kind: "line", unit: "%", series: [
      ["Nông, lâm, thủy sản", "gdp_sector_agri", GREEN],
      ["Công nghiệp & Xây dựng", "gdp_sector_industry", BLUE],
      ["Dịch vụ", "gdp_sector_services", ORANGE]] },
    { title: "Quy mô GDP (World Bank, theo năm)", kind: "line", unit: "USD", series: [["Quy mô GDP", "wb_gdp_usd", BLUE]] },
    { title: "GDP bình quân đầu người (World Bank, theo năm)", kind: "line", unit: "USD", series: [["GDP/người", "wb_gdp_per_capita", TEAL]] },
    { title: "Tăng trưởng vốn đầu tư toàn xã hội (so với cùng kỳ)", kind: "line", unit: "%", series: [["Vốn đầu tư", "investment_growth", PURPLE]] },
    { title: "Tăng trưởng GDP dài hạn (World Bank, 1985–nay)", kind: "line", unit: "%", series: [["Tăng trưởng GDP (World Bank)", "wb_gdp_growth", BLUE]] },
  ],
  "Giá cả & Lạm phát": [
    { title: "Lạm phát (so với cùng kỳ năm trước)", kind: "line", unit: "%", series: [
      ["CPI YoY", "cpi_yoy", ORANGE], ["Lạm phát cơ bản", "core_inflation_yoy", BLUE]] },
    { title: "Tỷ lệ lạm phát (so với tháng trước)", kind: "line", unit: "%", series: [["CPI MoM", "cpi_mom", ORANGE]] },
    { title: "Lạm phát lương thực (so với tháng trước)", kind: "line", unit: "%", series: [["Lương thực", "cpi_food", GREEN]] },
    { title: "CPI nhóm giao thông (so với tháng trước)", kind: "line", unit: "%", series: [["Giao thông", "cpi_transport", TEAL]] },
    { title: "Chỉ số giá sản xuất công nghiệp (so với cùng kỳ)", kind: "line", unit: "%", series: [["PPI", "ppi_yoy", PURPLE]] },
  ],
  "Đầu tư & Tiết kiệm": [
    { title: "Tăng trưởng vốn đầu tư toàn xã hội", kind: "line", unit: "%", series: [["Vốn đầu tư", "investment_growth", BLUE]] },
    { title: "Vốn đầu tư nước ngoài (FDI đăng ký)", kind: "line", unit: "tỷ USD", series: [
      ["FDI theo quý", "fdi", TEAL], ["FDI lũy kế", "fdi_cumulative", BLUE]] },
    { title: "Tổng vốn hình thành gộp (% GDP, World Bank)", kind: "line", unit: "%", series: [["Vốn hình thành", "wb_capital_formation", ORANGE]] },
    { title: "Tổng tiết kiệm (% GDP, World Bank)", kind: "line", unit: "%", series: [["Tiết kiệm", "wb_gross_savings", GREEN]] },
  ],
  "Sản xuất & Doanh nghiệp": [
    { title: "Chỉ số sản xuất công nghiệp IIP (theo tháng, so với cùng kỳ)", kind: "bar", unit: "%", series: [["IIP", "iip_yoy", BLUE]] },
    { title: "Doanh nghiệp thành lập mới (theo tháng)", kind: "bar", unit: "nghìn DN", series: [["DN mới", "new_firms", TEAL]] },
  ],
  "Ngân sách & Đầu tư công": [
    { title: "Thu & chi ngân sách nhà nước (theo tháng)", kind: "line", unit: "nghìn tỷ ₫", series: [
      ["Thu", "budget_revenue", GREEN], ["Chi", "budget_spending", RED]] },
    { title: "Giải ngân vốn đầu tư từ ngân sách (theo tháng)", kind: "bar", unit: "nghìn tỷ ₫", series: [["Đầu tư công", "public_investment", ORANGE]] },
  ],
  "Xuất nhập khẩu": [
    { title: "Xuất khẩu & Nhập khẩu (theo tháng)", kind: "line", unit: "tỷ USD", series: [
      ["Xuất khẩu", "exports", GREEN], ["Nhập khẩu", "imports", RED]] },
    { title: "Cán cân thương mại (theo tháng)", kind: "bar", unit: "tỷ USD", series: [["Cán cân", "trade_balance", BLUE]] },
    { title: "Cán cân vãng lai (% GDP, World Bank)", kind: "line", unit: "%", series: [["Vãng lai", "wb_current_account_gdp", PURPLE]] },
    { title: "Độ mở thương mại (% GDP, World Bank)", kind: "line", unit: "%", series: [["Thương mại/GDP", "wb_trade_pct_gdp", TEAL]] },
  ],
  "Lao động & Việc làm": [
    { title: "Tỷ lệ thất nghiệp", kind: "line", unit: "%", series: [["Thất nghiệp", "unemployment_rate", RED]] },
    { title: "Tỷ lệ thiếu việc làm", kind: "line", unit: "%", series: [["Thiếu việc làm", "underemployment_rate", ORANGE]] },
    { title: "Thu nhập bình quân người lao động (theo quý)", kind: "line", unit: "nghìn ₫", series: [["Thu nhập", "avg_income", GREEN]] },
    { title: "Lực lượng lao động", kind: "line", unit: "triệu người", series: [["LLLĐ", "labor_force", BLUE]] },
    { title: "Tỷ lệ tham gia LLLĐ (World Bank)", kind: "line", unit: "%", series: [["Tham gia LLLĐ", "wb_labor_participation", TEAL]] },
    { title: "Tỷ lệ có việc làm / dân số (World Bank)", kind: "line", unit: "%", series: [["Có việc làm", "wb_employment_ratio", PURPLE]] },
  ],
  "Tiền tệ & Tỷ giá": [
    { title: "Tỷ giá USD/VND", kind: "line", unit: "₫", series: [["USD/VND", "exchange_rate", BLUE]] },
    { title: "Giá vàng miếng SJC (triệu đồng/lượng)", kind: "line", unit: "tr", series: [
      ["Bán ra", "sjc_gold_sell", ORANGE], ["Mua vào", "sjc_gold_buy", BLUE]] },
    { title: "Tăng trưởng tín dụng theo ngành (% so đầu năm)", kind: "line", unit: "%", series: [
      ["Tổng tín dụng", "credit_growth_total", BLUE],
      ["Công nghiệp", "credit_growth_industry", ORANGE],
      ["Xây dựng", "credit_growth_construction", GREEN],
      ["Thương mại", "credit_growth_commerce", PURPLE],
      ["Nông, lâm, thủy sản", "credit_growth_agri", TEAL],
      ["Vận tải & Viễn thông", "credit_growth_transport", RED]] },
    { title: "Tăng trưởng cung tiền M2 (World Bank)", kind: "line", unit: "%", series: [["M2", "wb_broad_money_growth", GREEN]] },
  ],
  "Tiêu dùng": [
    { title: "Bán lẻ hàng hóa & dịch vụ theo tháng (so với cùng kỳ)", kind: "bar", unit: "%", series: [["Bán lẻ tháng", "retail_yoy", PURPLE]] },
    { title: "Tổng mức bán lẻ hàng hóa & dịch vụ (theo tháng)", kind: "line", unit: "nghìn tỷ ₫", series: [["Bán lẻ", "retail_month", BLUE]] },
    { title: "Khách quốc tế đến Việt Nam (theo tháng)", kind: "bar", unit: "triệu lượt", series: [["Khách quốc tế", "intl_visitors", ORANGE]] },
    { title: "Tăng trưởng tiêu dùng (World Bank)", kind: "line", unit: "%", series: [["Tiêu dùng", "wb_consumption_growth", GREEN]] },
    { title: "Tiêu dùng / GDP (World Bank)", kind: "line", unit: "%", series: [["Tiêu dùng/GDP", "wb_consumption_gdp", ORANGE]] },
  ],
  "Lãi suất": [
    { title: "Lãi suất tiết kiệm 12 tháng — 28 ngân hàng (CafeF, hằng ngày)", kind: "line", unit: "%/năm", series: [
      ["Cao nhất", "deposit_12m_max", GREEN], ["Trung bình", "deposit_12m_avg", BLUE], ["Thấp nhất", "deposit_12m_min", RED]] },
    { title: "Lãi suất cho vay & tiền gửi (SBV)", kind: "line", unit: "%/năm", series: [
      ["Cho vay", "lending_rate", RED], ["Tiền gửi 6-12T", "deposit_rate", BLUE]] },
    { title: "Lãi suất thực (World Bank)", kind: "line", unit: "%", series: [["Lãi suất thực", "wb_real_interest_rate", PURPLE]] },
  ],
};

// Annual-only series (every point lands on December) render as one bar/point
// per year; on a date axis two sparse points would stretch into huge blocks.
function isAnnual(points) {
  return points.length > 1 && points.every((p) => String(p.period).slice(5, 7) === "12");
}

// The opening card: is each part of the economy getting better or worse?
// [key, label, unit, how the trend is read, rising is good?, decimals, note]
//   "m3": monthly, mean of the last 3 readings vs the 3 before
//   "y3": seasonal monthly levels, last 3 readings vs the same months a year earlier, in %
//   "q":  last reading vs the one before
//   "d63": daily, last vs ~3 months (63 sessions) earlier, in %
const PULSE = [
  ["gdp_growth", "Tăng trưởng GDP", "%", "q", true, 2, "theo quý, so với cùng kỳ"],
  ["iip_yoy", "Sản xuất công nghiệp (IIP)", "%", "m3", true, 1, "so với cùng kỳ"],
  ["retail_yoy", "Bán lẻ hàng hóa & dịch vụ", "%", "m3", true, 1, "so với cùng kỳ"],
  ["exports", "Xuất khẩu", " tỷ USD", "y3", true, 2, "tháng"],
  ["trade_balance", "Cán cân thương mại", " tỷ USD", "y3", true, 2, "tháng"],
  ["cpi_yoy", "Lạm phát (CPI)", "%", "m3", false, 2, "so với cùng kỳ"],
  ["exchange_rate", "Tỷ giá USD/VND", " ₫", "d63", false, 0, "VND mất giá = xấu"],
  ["deposit_12m_avg", "Lãi suất tiết kiệm 12T (TB)", "%", "d63", false, 2, "lãi tăng = tiền đắt hơn"],
  ["public_investment", "Giải ngân đầu tư công", " nghìn tỷ", "y3", true, 1, "tháng"],
  ["new_firms", "Doanh nghiệp mới", " nghìn", "y3", true, 1, "tháng"],
  ["intl_visitors", "Khách quốc tế", " tr lượt", "y3", true, 2, "tháng"],
  ["unemployment_rate", "Thất nghiệp", "%", "q", false, 2, "theo quý"],
];

// key -> {label, unit, how, dp}: the pulse rows plus series the sector card uses.
export const SERIES_INFO = Object.fromEntries([
  ...PULSE.map(([k, label, unit, how, , dp]) => [k, { label, unit, how, dp }]),
  ["credit_growth_total", { label: "Tăng trưởng tín dụng (so đầu năm)", unit: "%", how: "q", dp: 2 }],
  ["credit_growth_construction", { label: "Tín dụng ngành xây dựng (so đầu năm)", unit: "%", how: "q", dp: 2 }],
  ["cpi_food", { label: "Giá lương thực (so tháng trước)", unit: "%", how: "m3", dp: 2 }],
  ["cpi_transport", { label: "CPI giao thông (so tháng trước)", unit: "%", how: "m3", dp: 2 }],
  ["ppi_yoy", { label: "Giá sản xuất công nghiệp PPI", unit: "%", how: "q", dp: 2 }],
  ["imports", { label: "Nhập khẩu", unit: " tỷ USD", how: "y3", dp: 2 }],
  ["gdp_sector_agri", { label: "GDP nông, lâm, thủy sản", unit: "%", how: "q", dp: 2 }],
]);

export function pulseTrend(pts, how) {
  const v = pts.map((p) => p.value);
  if (how === "q") return v.length > 1 ? { d: v[v.length - 1] - v[v.length - 2], ref: "kỳ trước" } : null;
  if (how === "m3") {
    if (v.length < 6) return null;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { d: avg(v.slice(-3)) - avg(v.slice(-6, -3)), ref: "TB 3 kỳ trước" };
  }
  if (how === "y3") {
    const by = new Map(pts.map((p) => [String(p.period).slice(0, 7), p.value]));
    let a = 0, b = 0, n = 0;
    for (const p of pts.slice(-3)) {
      const y = String(Number(String(p.period).slice(0, 4)) - 1) + String(p.period).slice(4, 7);
      if (by.has(y)) { a += p.value; b += by.get(y); n++; }
    }
    // a balance can be negative: report the change in level, not a ratio
    if (!n || b === 0) return null;
    return pts.some((p) => p.value < 0) ? { d: (a - b) / n, ref: "cùng kỳ năm trước" }
      : { d: (a / b - 1) * 100, pct: true, ref: "cùng kỳ năm trước" };
  }
  // daily: compare with the reading ~3 months back (or the oldest one we have)
  if (v.length < 2) return null;
  const last = pts[pts.length - 1];
  const cut = new Date(last.period); cut.setMonth(cut.getMonth() - 3);
  const base = pts.find((p) => new Date(p.period) >= cut) || pts[0];
  if (base === last) return null;
  return { d: (last.value / base.value - 1) * 100, pct: true, ref: `${String(base.period).slice(0, 10)}` };
}

function macroPulse(macro, box, sum) {
  let up = 0, down = 0;
  for (const [key, label, unit, how, risingGood, dp, note] of PULSE) {
    const pts = (macro[key] || []).filter((x) => F.isNum(x.value));
    if (!pts.length) continue;
    const cur = pts[pts.length - 1];
    const t = pulseTrend(pts, how);
    // a move smaller than this is "flat" (noise)
    const eps = t && (t.pct ? 0.3 : Math.max(0.05, Math.abs(cur.value) * 0.01));
    let cls = "flat", arrow = "→", txt = "chưa đủ dữ liệu để xem xu hướng";
    if (t) {
      const better = Math.abs(t.d) < eps ? null : (t.d > 0) === risingGood;
      cls = better === null ? "flat" : better ? "gain" : "loss";
      arrow = Math.abs(t.d) < eps ? "→" : t.d > 0 ? "▲" : "▼";
      if (better === true) up++; else if (better === false) down++;
      txt = `${t.d >= 0 ? "+" : ""}${t.d.toFixed(t.pct ? 1 : Math.max(dp, 1))}${t.pct ? "%" : unit.trim() === "%" ? " điểm %" : unit} so với ${t.ref}`;
    }
    const per = how === "d63" ? String(cur.period).slice(0, 10) : String(cur.period).slice(0, 7);
    const val = cur.value.toLocaleString(NUM_LOCALE, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    box.appendChild(el(`<div class="mp-tile ${cls}">
      <div class="mp-k">${label}</div>
      <div class="mp-v">${val}${unit} <span class="mp-a ${cls}">${arrow}</span></div>
      <div class="mp-s">${per} · ${note}</div>
      <div class="mp-t ${cls}">${txt}</div>
    </div>`));
  }
  const tone = up > down + 1 ? "gain" : down > up + 1 ? "loss" : "flat";
  const word = tone === "gain" ? "đang tốt lên" : tone === "loss" ? "đang xấu đi" : "lẫn lộn";
  sum.innerHTML = `Nhìn chung <b class="${tone}">${word}</b>: <b class="gain">${up}</b> chỉ báo tốt lên,
    <b class="loss">${down}</b> xấu đi, còn lại đi ngang hoặc chưa đủ dữ liệu.`;
}

// When each source publishes, and when the next figure is due. NSO holds its
// monthly press release on the 6th of the following month (the quarterly one
// is the same day for the quarter's last month), so the next date follows from
// the latest period we hold. A due date more than 3 days past with no new
// figure is flagged: the daily NSO job should have picked it up by then.
const CAL = [
  // [label, key that marks the latest period, cadence, what it brings]
  ["Báo cáo tháng của NSO", "cpi_yoy", "m",
   "CPI, lạm phát cơ bản, IIP, bán lẻ, xuất nhập khẩu, ngân sách, đầu tư công, doanh nghiệp mới, khách quốc tế"],
  ["Báo cáo quý của NSO", "gdp_growth", "q", "GDP theo khu vực, thất nghiệp, lực lượng lao động, thu nhập, PPI"],
  ["Lãi suất tiết kiệm (CafeF)", "deposit_12m_avg", "d", "Bảng 28 ngân hàng, trung bình / cao nhất / thấp nhất"],
  ["Giá vàng SJC", "sjc_gold_sell", "d", "Mua vào / bán ra vàng miếng"],
  ["Tỷ giá USD/VND (VNDirect)", "exchange_rate", "d", "Tỷ giá đóng cửa"],
  ["Tín dụng theo ngành (NHNN)", "credit_growth_total", "x", "Không theo lịch cố định, NHNN công bố khi họp báo"],
  ["World Bank", "wb_gdp_growth", "y", "Số năm (GDP USD, tiết kiệm, M2…), thường cập nhật khoảng tháng 7"],
];

function releaseCalendar(macro, box, headNext) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fmt = (d) => d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const lastOf = (key) => { const p = macro[key] || []; return p.length ? String(p[p.length - 1].period).slice(0, 10) : null; };
  let soonest = null;
  const rows = CAL.map(([label, key, cad, what]) => {
    const last = lastOf(key);
    let next = "—", cls = "";
    if (last && (cad === "m" || cad === "q")) {
      const [y, m] = last.split("-").map(Number);
      const step = cad === "m" ? 1 : 3;
      // period month m+step is reported on the 6th of the month after it
      const due = new Date(y, m - 1 + step + 1, 6);
      next = `${cad === "m" ? "Tháng" : "Quý"} ${cad === "m" ? ((m - 1 + step) % 12) + 1 : Math.ceil((((m - 1 + step) % 12) + 1) / 3)}`
        + ` · khoảng ${fmt(due)}`;
      if ((today - due) / 86400000 > 3) { cls = "mc-late"; next += " · đang trễ"; }
      if (!soonest || due < soonest.due) soonest = { due, label };
    } else if (cad === "d") {
      next = "Mỗi ngày làm việc";
      if (last && (today - new Date(last)) / 86400000 > 4) { cls = "mc-late"; next += " · số cuối đã cũ"; }
    } else if (cad === "y") next = "Hằng năm";
    else next = "Không định kỳ";
    const lastTxt = !last ? "—" : cad === "d" ? fmt(new Date(last)) : cad === "y" ? last.slice(0, 4)
      : cad === "q" ? `Quý ${Math.ceil(Number(last.slice(5, 7)) / 3)}/${last.slice(0, 4)}` : `${last.slice(5, 7)}/${last.slice(0, 4)}`;
    return `<tr class="${cls}"><td><b>${label}</b><div class="mc-what">${what}</div></td><td>${lastTxt}</td><td>${next}</td></tr>`;
  });
  box.innerHTML = `<table class="screen mc-tab"><thead><tr><th>Nguồn</th><th>Số mới nhất</th><th>Lần tới</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table>
    <div class="vb-note">Ngày dự kiến theo lịch họp báo của NSO (ngày 6 tháng sau). Dữ liệu được lấy tự động mỗi ngày làm việc,
      thường có trên trang trong ngày công bố hoặc ngày kế tiếp.</div>`;
  if (soonest) headNext.textContent = `· số NSO tiếp theo khoảng ${fmt(soonest.due)}`;
}

export async function renderMacro(root) {
  root.innerHTML = `<div class="loading">Đang tải dữ liệu vĩ mô…</div>`;
  const macro = await loadMacro();
  root.innerHTML = "";

  const names = Object.keys(GROUPS);
  let active = names[0];

  const shell = el(`<div>
    <h2 class="view-title">Kinh tế vĩ mô</h2>
    <div class="vb-note">Nguồn: Tổng cục Thống kê (nso.gov.vn)</div>
    <div class="card"><h2 class="sec-h">Bức tranh vĩ mô hiện nay</h2>
      <div class="mp-sum" id="macro-sum"></div>
      <div class="mp-grid" id="macro-kpi"></div>
      <div class="vb-note">Mỗi ô: số mới nhất, kỳ của số đó, và xu hướng gần đây. Số theo tháng so trung bình
        3 kỳ gần nhất với 3 kỳ trước đó (bớt nhiễu), riêng số có tính mùa vụ (xuất khẩu, cán cân, đầu tư công,
        doanh nghiệp mới, khách quốc tế) so 3 tháng gần nhất với cùng kỳ năm trước; số theo quý so với quý trước; tỷ giá so với 3 tháng trước.
        <span class="gain">Xanh</span> = đang tốt lên cho nền kinh tế / thị trường, <span class="loss">đỏ</span> = xấu đi.</div>
    </div>
    <div class="range-row macro-tabs"></div>
    <div class="card"><div id="macro-grid"></div></div>
    <details class="card mc-cal"><summary class="sec-h">🗓 Lịch cập nhật số liệu <span class="mc-next"></span></summary>
      <div id="macro-cal"></div></details>
    <div class="vb-note">Nguồn: Tổng cục Thống kê (nso.gov.vn), Ngân hàng Nhà nước, World Bank.</div>
  </div>`);
  root.appendChild(shell);
  const tabs = shell.querySelector(".macro-tabs");
  const grid = shell.querySelector("#macro-grid");

  macroPulse(macro, shell.querySelector("#macro-kpi"), shell.querySelector("#macro-sum"));
  releaseCalendar(macro, shell.querySelector("#macro-cal"), shell.querySelector(".mc-next"));

  // Groups whose first chart is the theme's headline series and runs the full
  // width in the original. The overview is the exception: six equal charts.
  const LEAD = {
    "Tổng quan kinh tế": 0, "Tăng trưởng kinh tế": 1, "Giá cả & Lạm phát": 1,
    "Đầu tư & Tiết kiệm": 1, "Xuất nhập khẩu": 1, "Lao động & Việc làm": 1,
    "Tiền tệ & Tỷ giá": 1, "Tiêu dùng": 1, "Lãi suất": 1, "Sản xuất & Doanh nghiệp": 0, "Ngân sách & Đầu tư công": 0,
  };

  const draw = () => {
    grid.innerHTML = "";
    const pending = [];
    const drawn = [];
    for (const spec of GROUPS[active]) {
      // Only plot series that actually have data, so an empty indicator shows
      // as a missing line rather than an empty chart frame.
      let series = spec.series
        .map(([label, key, colour]) => [label, (macro[key] || []).filter((p) => F.isNum(p.value)), colour])
        .filter(([, pts]) => pts.length > 1);
      if (!series.length) continue;
      // Series on one chart rarely start on the same date -- core inflation
      // begins years after headline CPI, for instance. Left alone, the shorter
      // line appears to start in mid-air and the overlap that is worth
      // comparing gets squeezed to the right. Trim every series to the latest
      // start they share, as the original does.
      if (series.length > 1) {
        const start = series.reduce(
          (a, [, pts]) => (String(pts[0].period) > a ? String(pts[0].period) : a), "");
        series = series
          .map(([label, pts, colour]) => [label, pts.filter((q) => String(q.period) >= start), colour])
          .filter(([, pts]) => pts.length > 1);
        if (!series.length) continue;
      }

      const annual = series.every(([, pts]) => isAnnual(pts));
      // Say so when the newest point is old (World Bank's M2 stops at 2022,
      // SBV's rate bulletin at May 2026) -- otherwise it reads as current.
      // Annual series are allowed ~2 years (a year's figure arrives late).
      const newest = series.reduce((a, [, pts]) => (String(pts.at(-1).period) > a ? String(pts.at(-1).period) : a), "");
      const ageDays = (Date.now() - Date.parse(newest)) / 86400000;
      // World Bank years are stored as YYYY-01-01.
      const yearly = annual || series.every(([, pts]) => pts.every((q) => String(q.period).slice(5, 10) === "01-01"));
      const stale = ageDays > (yearly ? 800 : 120)
        ? `<div class="qstale">Số mới nhất: ${yearly ? "năm " + newest.slice(0, 4) : `T${+newest.slice(5, 7)}/${newest.slice(0, 4)}`}
            — chưa có số mới hơn</div>` : "";
      const box = el(`<div class="qchart"><div class="qtitle">${spec.title}</div>${stale}<div></div></div>`);
      drawn.push(box);
      const canvas = box.lastElementChild;
      const traces = series.map(([label, pts, colour]) => ({
        type: spec.kind === "bar" ? "bar" : "scatter",
        mode: spec.kind === "bar" ? undefined : "lines+markers",
        name: label,
        x: pts.map((p) => (annual ? String(p.period).slice(0, 4) : String(p.period).slice(0, 10))),
        y: pts.map((p) => p.value),
        // Bars are coloured by sign in the original -- a contraction reads red
        // whatever the indicator's own series colour is.
        marker: spec.kind === "bar"
          ? { color: pts.map((q) => (q.value >= 0 ? "#22c55e" : "#ef4444")) }
          : { color: colour, size: 4 },
        line: { color: colour, width: 1.6 },
        hovertemplate: `${label} %{x}: %{y:,.2f} ${spec.unit}<extra></extra>`,
      }));
      pending.push(() => window.Plotly.react(canvas, traces, {
        height: 240, dragmode: false, margin: { l: 54, r: 12, t: 22, b: 30 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
        showlegend: series.length > 1,
        legend: { orientation: "h", y: 1.16, x: 0, font: { size: 9 } },
        xaxis: { type: annual ? "category" : "date", showgrid: false, tickfont: { size: 8 }, nticks: 6 },
        yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 8 },
                 ticksuffix: spec.unit === "%" ? "%" : "", zeroline: true },
        hovermode: "x unified",
      }, { displayModeBar: false, responsive: true }));
    }
    // Place the boxes now that the count is known. Charts with no data drop
    // out above, so sizing the row off the spec list would leave gaps.
    const lead = Math.min(LEAD[active] ?? 1, drawn.length);
    for (let i = 0; i < lead; i++) {
      const wrap = el(`<div class="mc-row mc-1"></div>`);
      wrap.appendChild(drawn[i]);
      grid.appendChild(wrap);
    }
    const rest = drawn.slice(lead);
    if (rest.length) {
      // Pick the column count that divides evenly, so no row is left with a
      // single stranded chart.
      const cols = rest.length % 3 === 0 ? 3
        : rest.length % 2 === 0 ? 2
        : rest.length > 3 ? 3 : rest.length;
      // Chunk first, then size each row by what actually landed in it. A five
      // chart group splits 3 + 2, and that trailing pair stretches to fill
      // rather than sitting in two of three columns with the third empty.
      for (let i = 0; i < rest.length; i += cols) {
        const chunk = rest.slice(i, i + cols);
        const row = el(`<div class="mc-row mc-${chunk.length}"></div>`);
        for (const box of chunk) row.appendChild(box);
        grid.appendChild(row);
      }
    }
    // Checked on `drawn`, not on grid.children: the boxes are appended just
    // above, so testing the grid before placement always reported empty.
    if (!drawn.length && active !== "Lãi suất") grid.innerHTML = `<div class="loading">Chưa có dữ liệu cho nhóm này.</div>`;
    pending.forEach((fn) => fn());
    if (active === "Tiền tệ & Tỷ giá") {
      commodities = commodities || loadCommodities();
      commodities.then((c) => { if (active === "Tiền tệ & Tỷ giá") { const g = goldGap(macro, c); if (g) grid.prepend(g); } });
    }
    if (active === "Lãi suất") {
      bankRates = bankRates || loadBankRates();
      bankRates.then((br) => { if (active === "Lãi suất") { const t = bankRateTable(br); if (t) grid.prepend(t); } });
    }
  };
  let bankRates = null, commodities = null;

  for (const n of names) {
    const b = el(`<button class="range-btn ${n === active ? "active" : ""}">${n}</button>`);
    b.onclick = () => {
      active = n;
      tabs.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      draw();
    };
    tabs.appendChild(b);
  }
  draw();
}

// Today's savings rates bank by bank (data/bank_rates.json), highest of each
// tenor in green and lowest in red, average underneath. Sorted by the 12-month
// rate, the tenor most people compare.
const TENORS = [["1m", "1 tháng"], ["3m", "3 tháng"], ["6m", "6 tháng"], ["9m", "9 tháng"],
  ["12m", "12 tháng"], ["18m", "18 tháng"], ["24m", "24 tháng"]];
function bankRateTable(br) {
  const banks = (br && br.banks) || [];
  if (banks.length < 5) return null;
  const stat = {};
  for (const [k] of TENORS) {
    const v = banks.map((b) => b.rates[k]).filter(F.isNum);
    if (v.length) stat[k] = { max: Math.max(...v), min: Math.min(...v), avg: v.reduce((a, x) => a + x, 0) / v.length };
  }
  const who = (k, side) => banks.filter((b) => b.rates[k] === stat[k][side]).map((b) => b.bank).join(", ");
  const rows = banks.slice().sort((a, b) => (b.rates["12m"] ?? -1) - (a.rates["12m"] ?? -1));
  const cell = (b, k) => {
    const v = b.rates[k];
    if (!F.isNum(v)) return `<td class="num muted">—</td>`;
    const s = stat[k];
    const cls = s && v === s.max ? "br-hi" : s && v === s.min ? "br-lo" : "";
    return `<td class="num ${cls}">${v.toFixed(2)}%</td>`;
  };
  const s12 = stat["12m"];
  const box = el(`<div class="br">
    <div class="qtitle">Lãi suất tiết kiệm tại quầy — ${banks.length} ngân hàng · ${F.dateVN(br.asof)}</div>
    ${s12 ? `<div class="br-sum">Kỳ hạn 12 tháng: trung bình <b>${s12.avg.toFixed(2)}%</b>
      · cao nhất <b class="br-hi">${s12.max.toFixed(2)}%</b> (${who("12m", "max")})
      · thấp nhất <b class="br-lo">${s12.min.toFixed(2)}%</b> (${who("12m", "min")})</div>` : ""}
    <div class="br-tw"><table class="br-t">
      <thead><tr><th>Ngân hàng</th>${TENORS.map(([, h]) => `<th class="num">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((b) => `<tr><td>${F.escapeHtml(b.bank)}</td>${TENORS.map(([k]) => cell(b, k)).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Trung bình</td>${TENORS.map(([k]) => `<td class="num">${stat[k] ? stat[k].avg.toFixed(2) + "%" : "—"}</td>`).join("")}</tr></tfoot>
    </table></div>
    <div class="vb-note">%/năm, gửi tại quầy, lĩnh lãi cuối kỳ, chưa gồm ưu đãi hay gửi trực tuyến. Xanh = cao nhất, đỏ = thấp nhất
      ở mỗi kỳ hạn. Nguồn: CafeF, cập nhật mỗi ngày làm việc.</div>
  </div>`);
  return box;
}

// Domestic SJC bar price against the world price converted at the USD/VND
// rate: a lượng is 37.5 g = 1.20565 troy ounces. The gap is how far the
// domestic market trades above the world (import quotas keep it positive).
const OZ_PER_LUONG = 1.20565;
function goldGap(macro, comm) {
  const last = (k) => (macro[k] || []).filter((p) => F.isNum(p.value)).at(-1);
  const sell = last("sjc_gold_sell"), buy = last("sjc_gold_buy"), fx = last("exchange_rate");
  if (!sell || !buy) return null;
  // commodities.json's series are rebased to 100; `last` holds the real close.
  const gc = comm && comm.last && comm.last["GC=F"];
  let world = null, worldDate = null;
  if (gc && F.isNum(gc.close) && fx) {
    world = gc.close * fx.value * OZ_PER_LUONG / 1e6;
    worldDate = gc.date;
  }
  const gap = world ? sell.value - world : null;
  return el(`<div class="gold">
    <div class="qtitle">Giá vàng miếng SJC · ${F.dateVN(String(sell.period).slice(0, 10))}</div>
    <div class="gold-row">
      <div><div class="gk">Mua vào</div><div class="gv">${buy.value.toFixed(2)}</div><div class="gs">triệu đồng/lượng</div></div>
      <div><div class="gk">Bán ra</div><div class="gv">${sell.value.toFixed(2)}</div><div class="gs">triệu đồng/lượng</div></div>
      ${world ? `<div><div class="gk">Thế giới quy đổi</div><div class="gv">${world.toFixed(2)}</div>
        <div class="gs">giá ${F.dateVN(worldDate)} × tỷ giá ${Math.round(fx.value).toLocaleString("en-US")}</div></div>
      <div><div class="gk">SJC cao hơn thế giới</div><div class="gv ${gap > 0 ? "loss" : "gain"}">${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(2)}</div>
        <div class="gs">triệu/lượng (${(gap / world * 100).toFixed(1)}%)</div></div>` : ""}
    </div>
    <div class="vb-note">Nguồn: SJC (bảng giá TP.HCM, cập nhật mỗi ngày làm việc); giá thế giới là hợp đồng vàng tương lai (Yahoo, cập nhật mỗi ngày).
      Chênh lệch dương = vàng trong nước đắt hơn thế giới.</div>
  </div>`);
}

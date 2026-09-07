// Macro sub-tab of the market view, matching the original's nine indicator
// groups. Everything comes from the flat data/macro.json the export writes; the
// grouping lives here so adding an indicator is a one-line change.
import { loadMacro } from "./data.js";
import * as F from "./format.js";

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
    { title: "Cán cân thương mại", kind: "bar", unit: "tr USD", series: [["Cán cân", "trade_balance", GREEN]] },
    { title: "Tăng trưởng bán lẻ (so với cùng kỳ năm trước)", kind: "bar", unit: "%", series: [["Bán lẻ", "retail_sales_growth", PURPLE]] },
    { title: "Vốn đầu tư nước ngoài (FDI đăng ký, theo quý)", kind: "bar", unit: "tr USD", series: [["FDI", "fdi", TEAL]] },
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
    { title: "Vốn đầu tư nước ngoài (FDI đăng ký)", kind: "line", unit: "tr USD", series: [
      ["FDI theo quý", "fdi", TEAL], ["FDI lũy kế", "fdi_cumulative", BLUE]] },
    { title: "Tổng vốn hình thành gộp (% GDP, World Bank)", kind: "line", unit: "%", series: [["Vốn hình thành", "wb_capital_formation", ORANGE]] },
    { title: "Tổng tiết kiệm (% GDP, World Bank)", kind: "line", unit: "%", series: [["Tiết kiệm", "wb_gross_savings", GREEN]] },
  ],
  "Xuất nhập khẩu": [
    { title: "Xuất khẩu & Nhập khẩu (theo tháng)", kind: "line", unit: "tr USD", series: [
      ["Xuất khẩu", "exports", GREEN], ["Nhập khẩu", "imports", RED]] },
    { title: "Cán cân thương mại (theo tháng)", kind: "bar", unit: "tr USD", series: [["Cán cân", "trade_balance", BLUE]] },
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
    { title: "Tăng trưởng bán lẻ hàng hóa & dịch vụ", kind: "line", unit: "%", series: [["Bán lẻ", "retail_sales_growth", BLUE]] },
    { title: "Tăng trưởng tiêu dùng (World Bank)", kind: "line", unit: "%", series: [["Tiêu dùng", "wb_consumption_growth", GREEN]] },
    { title: "Tiêu dùng / GDP (World Bank)", kind: "line", unit: "%", series: [["Tiêu dùng/GDP", "wb_consumption_gdp", ORANGE]] },
  ],
  "Lãi suất": [
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

export async function renderMacro(root) {
  root.innerHTML = `<div class="loading">Đang tải dữ liệu vĩ mô…</div>`;
  const macro = await loadMacro();
  root.innerHTML = "";

  const names = Object.keys(GROUPS);
  let active = names[0];

  const shell = el(`<div>
    <h2 class="view-title">Kinh tế vĩ mô</h2>
    <div class="vb-note">Nguồn: Tổng cục Thống kê (nso.gov.vn)</div>
    <div class="card"><h2 class="sec-h">Các chỉ số quan trọng nhất hiện nay</h2>
      <div class="metrics metrics-4" id="macro-kpi"></div>
      <div class="vb-note">💡 Lạm phát = giá cả tăng nhanh bao nhiêu so với năm trước, cao quá thì
        tiền mất giá nhanh. GDP = quy mô sản xuất của cả nước, tăng = kinh tế đang phát triển.
        Cán cân thương mại dương = xuất khẩu nhiều hơn nhập khẩu (có lợi cho VND).</div>
    </div>
    <div class="range-row macro-tabs"></div>
    <div class="card"><div id="macro-grid"></div></div>
    <div class="vb-note">Nguồn: Tổng cục Thống kê (nso.gov.vn), Ngân hàng Nhà nước, World Bank.</div>
  </div>`);
  root.appendChild(shell);
  const tabs = shell.querySelector(".macro-tabs");
  const grid = shell.querySelector("#macro-grid");

  // The four headline readings, as the original opens the tab with. Delta is
  // against the previous reading; for inflation and unemployment a rise is the
  // bad direction, so those two are coloured the other way round.
  const KPI = [
    ["cpi_yoy", "Lạm phát (so với năm trước)", "%", true],
    ["gdp_growth", "Tăng trưởng kinh tế (GDP)", "%", false],
    ["unemployment_rate", "Tỷ lệ thất nghiệp", "%", true],
    ["trade_balance", "Cán cân thương mại", " tỷ USD", false],
  ];
  const kpiBox = shell.querySelector("#macro-kpi");
  for (const [key, label, unit, invert] of KPI) {
    const pts = (macro[key] || []).filter((x) => F.isNum(x.value));
    if (!pts.length) {
      kpiBox.appendChild(el(`<div class="metric"><div class="mk">${label}</div><div class="mv">—</div></div>`));
      continue;
    }
    const cur = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const d = prev ? cur.value - prev.value : null;
    const good = d === null ? null : (invert ? d < 0 : d > 0);
    const cls = good === null ? "" : good ? "gain" : "loss";
    kpiBox.appendChild(el(`<div class="metric">
      <div class="mk">${label}</div>
      <div class="mv">${cur.value.toFixed(2)}${unit}</div>
      <div class="ms ${cls}">${d === null ? String(cur.period).slice(0, 7)
        : `${d >= 0 ? "+" : ""}${d.toFixed(2)}${unit} · ${String(cur.period).slice(0, 7)}`}</div>
    </div>`));
  }

  // Groups whose first chart is the theme's headline series and runs the full
  // width in the original. The overview is the exception: six equal charts.
  const LEAD = {
    "Tổng quan kinh tế": 0, "Tăng trưởng kinh tế": 1, "Giá cả & Lạm phát": 1,
    "Đầu tư & Tiết kiệm": 1, "Xuất nhập khẩu": 1, "Lao động & Việc làm": 1,
    "Tiền tệ & Tỷ giá": 1, "Tiêu dùng": 1, "Lãi suất": 1,
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

      const box = el(`<div class="qchart"><div class="qtitle">${spec.title}</div><div></div></div>`);
      drawn.push(box);
      const canvas = box.lastElementChild;
      const annual = series.every(([, pts]) => isAnnual(pts));
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
    if (!drawn.length) grid.innerHTML = `<div class="loading">Chưa có dữ liệu cho nhóm này.</div>`;
    pending.forEach((fn) => fn());
  };

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

// Quarterly analysis charts built from the exported per-quarter financials.
// Sector-aware labels: for banks the fields are remapped (revenue=total
// operating income, gross_profit=net interest income, cogs=provisions,
// ebit=pre-provision profit) so the same series mean different things.
import { quarters } from "./ttm.js";

const INK = "#0a121d", MUTED = "#5b6675", RULE = "rgba(148,163,184,0.22)";
const BLUE = "#2563eb", LBLUE = "#7da7f5", ORANGE = "#ea580c", GREEN = "#15803d",
      RED = "#b91c1c", GREY = "#94a3b8";
const FONT = { family: "'Fira Code', ui-monospace, monospace", size: 10, color: INK };

const isN = (v) => typeof v === "number" && isFinite(v);
const label = (p) => String(p).replace(/^(\d{4})Q(\d)$/, "Q$2/$1").replace(/^(\d{2})(\d{2})$/, "$2");

function base(height = 260) {
  return {
    dragmode: false, height, margin: { l: 46, r: 40, t: 26, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
    barmode: "group", bargap: 0.25,
    legend: { orientation: "h", y: 1.14, x: 0, font: { ...FONT, size: 9 } },
    xaxis: { type: "category", tickfont: { ...FONT, size: 9 }, showgrid: false },
    yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: RULE },
    hovermode: "x unified",
  };
}
function pctAxis(layout) {
  layout.yaxis2 = { overlaying: "y", side: "right", tickformat: ".0%", tickfont: { ...FONT, size: 9 }, showgrid: false, zeroline: false };
  return layout;
}

function chartBox(title) {
  const box = document.createElement("div");
  box.className = "qchart";
  const h = document.createElement("div");
  h.className = "qtitle";
  h.textContent = title;
  const c = document.createElement("div");
  box.appendChild(h); box.appendChild(c);
  return { box, canvas: c };
}

// Appends the card to `parent` FIRST, then renders -- Plotly throws
// (namespaceURI of null) if asked to draw into a detached node.
export function quarterlyCharts(parent, co, financials) {
  const qs = quarters(financials).slice(-12);
  if (qs.length < 2) return null;
  const isBank = co.sector === "Ngân hàng";
  const x = qs.map((q) => label(q.period));
  const col = (k) => qs.map((q) => (isN(q[k]) ? q[k] : null));
  const ratio = (a, b) => qs.map((q) => (isN(q[a]) && q[b] ? q[a] / q[b] : null));

  const card = el(`<div class="card"><h2 class="sec-h">Phân tích theo quý</h2><div class="qgrid"></div></div>`);
  const grid = card.querySelector(".qgrid");
  parent.appendChild(card);        // attach before drawing (see note above)
  const pending = [];
  const add = (title, traces, layout) => {
    const { box, canvas } = chartBox(title);
    grid.appendChild(box);
    pending.push(() => window.Plotly.react(canvas, traces, layout, { displayModeBar: false, responsive: true }));
  };

  // 1. Revenue / TOI + Net income (bars) with net-margin line.
  add(isBank ? "Tổng thu nhập & Lãi ròng" : "Doanh thu & Lãi ròng", [
    { type: "bar", name: isBank ? "Tổng TN hoạt động" : "Doanh thu", x, y: col("revenue"), marker: { color: BLUE } },
    { type: "bar", name: "Lãi ròng", x, y: col("net_income"), marker: { color: LBLUE } },
    { type: "scatter", mode: "lines+markers", name: "Biên LN ròng", x, y: ratio("net_income", "revenue"), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  // 2. Profitability margins (lines).
  add("Biên lợi nhuận", [
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên NII" : "Biên gộp", x, y: ratio("gross_profit", "revenue"), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên trước DP" : "Biên hoạt động", x, y: ratio("ebit", "revenue"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: "Biên ròng", x, y: ratio("net_income", "revenue"), line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
  ], Object.assign(base(), { yaxis: { tickformat: ".0%", gridcolor: RULE, tickfont: { ...FONT, size: 9 } } }));

  // 3. Capital structure: equity vs debt (stacked) + D/E line.
  add("Cơ cấu vốn", [
    { type: "bar", name: "Vốn chủ", x, y: col("equity"), marker: { color: BLUE } },
    { type: "bar", name: isBank ? "Vay liên NH" : "Nợ vay", x, y: col("debt"), marker: { color: GREY } },
    { type: "scatter", mode: "lines+markers", name: "D/E", x, y: ratio("debt", "equity"), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
  ], Object.assign(pctAxis(base()), { barmode: "stack", yaxis2: { overlaying: "y", side: "right", tickformat: ".2f", tickfont: { ...FONT, size: 9 }, showgrid: false } }));

  // 4. Cash flow: OCF / ICF / FCF bars.
  add("Dòng tiền", [
    { type: "bar", name: "HĐ Kinh doanh", x, y: col("operating_cf"), marker: { color: GREEN } },
    { type: "bar", name: "HĐ Đầu tư", x, y: col("investing_cf"), marker: { color: ORANGE } },
    { type: "bar", name: "Dòng tiền tự do", x, y: col("fcf"), marker: { color: BLUE } },
  ], base());

  // 5. Non-banks: cost structure (COGS / selling / G&A stacked).
  if (!isBank) {
    add("Cơ cấu chi phí", [
      { type: "bar", name: "Giá vốn", x, y: col("cogs"), marker: { color: GREY } },
      { type: "bar", name: "Chi phí bán hàng", x, y: col("selling_expense"), marker: { color: ORANGE } },
      { type: "bar", name: "Chi phí QLDN", x, y: col("ga_expense"), marker: { color: LBLUE } },
    ], Object.assign(base(), { barmode: "stack" }));
  } else {
    // Banks: income mix -- net interest income vs the rest of TOI.
    const nonNii = qs.map((q) => (isN(q.revenue) && isN(q.gross_profit) ? q.revenue - q.gross_profit : null));
    add("Cơ cấu thu nhập", [
      { type: "bar", name: "Thu nhập lãi thuần", x, y: col("gross_profit"), marker: { color: BLUE } },
      { type: "bar", name: "Thu ngoài lãi", x, y: nonNii, marker: { color: LBLUE } },
      { type: "bar", name: "Chi phí dự phòng", x, y: col("cogs"), marker: { color: RED } },
    ], Object.assign(base(), { barmode: "stack" }));
  }

  // 6. Assets & profitability trend: total assets bars + ROE line (quarterly).
  add("Tài sản & ROE (quý)", [
    { type: "bar", name: "Tổng tài sản", x, y: col("total_assets"), marker: { color: LBLUE } },
    { type: "scatter", mode: "lines+markers", name: "ROE quý", x, y: ratio("net_income", "equity"), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  pending.forEach((fn) => fn());   // all boxes now in the DOM -> safe to render
  return card;
}

// Business projection + foreign flow, appended as their own card row.
export function extraCharts(parent, co, financials, foreign) {
  const annual = (financials || []).filter((f) => f.period_type === "Y")
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const hasProj = annual.length >= 3;
  const hasForeign = (foreign || []).length >= 2;
  if (!hasProj && !hasForeign) return;

  const card = el(`<div class="card"><h2 class="sec-h">Dự phóng & Dòng tiền khối ngoại</h2><div class="qgrid"></div></div>`);
  const grid = card.querySelector(".qgrid");
  parent.appendChild(card);
  const pending = [];
  const add = (title, traces, layout) => {
    const { box, canvas } = chartBox(title);
    grid.appendChild(box);
    pending.push(() => window.Plotly.react(canvas, traces, layout, { displayModeBar: false, responsive: true }));
  };

  if (hasProj) {
    const yrs = annual.slice(-6);
    const years = yrs.map((r) => String(r.period).slice(0, 4));
    const rev = yrs.map((r) => (isN(r.revenue) ? r.revenue : null));
    const ni = yrs.map((r) => (isN(r.net_income) ? r.net_income : null));
    // CAGR from the last 3 actual years, projected 3 years forward.
    const cagr = (arr) => {
      const v = arr.filter(isN);
      if (v.length < 2) return 0;
      const a = v[Math.max(0, v.length - 3)], b = v[v.length - 1], n = Math.min(3, v.length) - 1;
      return (a > 0 && b > 0 && n > 0) ? Math.pow(b / a, 1 / n) - 1 : 0;
    };
    const gR = cagr(rev), gN = cagr(ni);
    const projYears = [], projRev = [], projNi = [];
    let lr = rev.filter(isN).slice(-1)[0] ?? 0, ln = ni.filter(isN).slice(-1)[0] ?? 0;
    const lastY = parseInt(years[years.length - 1]) || new Date().getFullYear();
    for (let i = 1; i <= 3; i++) { lr *= 1 + gR; ln *= 1 + gN; projYears.push(String(lastY + i)); projRev.push(lr); projNi.push(ln); }
    const allY = [...years, ...projYears];
    const pad = (a, before) => before ? [...a, ...new Array(3).fill(null)] : [...new Array(years.length).fill(null), ...a];
    add(`Dự phóng KQKD (CAGR ${(gR * 100).toFixed(0)}%)`, [
      { type: "bar", name: "Doanh thu", x: allY, y: pad(rev, true), marker: { color: BLUE } },
      { type: "bar", name: "Lãi ròng", x: allY, y: pad(ni, true), marker: { color: LBLUE } },
      { type: "bar", name: "DT dự phóng", x: allY, y: pad(projRev, false), marker: { color: BLUE, pattern: { shape: "/" } } },
      { type: "bar", name: "LN dự phóng", x: allY, y: pad(projNi, false), marker: { color: LBLUE, pattern: { shape: "/" } } },
    ], Object.assign(base(), { barmode: "group" }));
  }

  if (hasForeign) {
    const fx = foreign.slice(-20);
    const x = fx.map((d) => String(d.date).slice(5, 10));
    const y = fx.map((d) => (isN(d.net_val) ? d.net_val / 1e9 : null));   // -> tỷ VND
    add("Khối ngoại mua/bán ròng (tỷ ₫)", [
      { type: "bar", x, y, marker: { color: y.map((v) => (v >= 0 ? GREEN : RED)) },
        hovertemplate: "%{x}: %{y:.1f} tỷ<extra></extra>" },
    ], Object.assign(base(), { yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: MUTED } }));
  }

  pending.forEach((fn) => fn());
}

// tiny local el() so this module doesn't depend on app.js
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

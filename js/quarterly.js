// Quarterly analysis charts, matching the Streamlit app's Rows 1-7 chart set
// title-for-title. Sector-aware: for banks the stored fields are remapped
// (revenue = total operating income, gross_profit = net interest income,
// cogs = provisions, ebit = pre-provision profit, receivables = loan book,
// payables = customer deposits), so the same column means a different thing and
// gets a different chart.
//
// Charts that need line items the `Financial` table doesn't carry (financial
// income/expense, provision build-up, receivable and inventory breakdowns,
// short vs long-term borrowings, dividends) read the `detail` block that
// export_detailed.py folds into each ticker file; they are skipped when it is
// absent rather than drawn half-empty.
import { quarters } from "./ttm.js";

const INK = "#0a121d", MUTED = "#5b6675", RULE = "rgba(148,163,184,0.22)";
const BLUE = "#2563eb", LBLUE = "#7da7f5", ORANGE = "#ea580c", GREEN = "#15803d",
      RED = "#b91c1c", GREY = "#94a3b8", PURPLE = "#7c3aed", TEAL = "#0e7490";
// Bright pair for marks that encode up/down, matching the original.
const MARK_UP = "#22c55e", MARK_DOWN = "#ef4444";
const FONT = { family: "'Fira Code', ui-monospace, monospace", size: 10, color: INK };

const isN = (v) => typeof v === "number" && isFinite(v);
const label = (p) => String(p).replace(/^(\d{4})-Q(\d)$/, "Q$2/$1");

function base(height = 260) {
  return {
    dragmode: false, height, margin: { l: 46, r: 44, t: 26, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
    barmode: "group", bargap: 0.25,
    legend: { orientation: "h", y: 1.14, x: 0, font: { ...FONT, size: 9 } },
    xaxis: { type: "category", tickfont: { ...FONT, size: 9 }, showgrid: false },
    yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: RULE },
    hovermode: "x unified",
  };
}
const pctAxis = (l) => Object.assign(l, {
  yaxis2: { overlaying: "y", side: "right", tickformat: ".0%", tickfont: { ...FONT, size: 9 }, showgrid: false, zeroline: false } });
const numAxis = (l, fmt = ".2f") => Object.assign(l, {
  yaxis2: { overlaying: "y", side: "right", tickformat: fmt, tickfont: { ...FONT, size: 9 }, showgrid: false, zeroline: false } });
const pctY = (l) => Object.assign(l, {
  yaxis: { tickformat: ".0%", gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: RULE } });

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

// Year-on-year growth: this quarter vs the same quarter last year (lag 4).
function yoy(vals) {
  return vals.map((v, i) => {
    const prev = vals[i - 4];
    return (isN(v) && isN(prev) && prev !== 0) ? (v - prev) / Math.abs(prev) : null;
  });
}

// Appends the card to `parent` FIRST, then renders -- Plotly throws
// (namespaceURI of null) if asked to draw into a detached node.
export function quarterlyCharts(parent, co, financials, detail, prices) {
  const all = quarters(financials);
  const qs = all.slice(-12);
  if (qs.length < 2) return null;
  const isBank = co.sector === "Ngân hàng";
  const x = qs.map((q) => label(q.period));
  const col = (k) => qs.map((q) => (isN(q[k]) ? q[k] : null));
  const ratio = (a, b) => qs.map((q) => (isN(q[a]) && q[b] ? q[a] / q[b] : null));
  const derived = (fn) => qs.map((q) => { const v = fn(q); return isN(v) ? Math.max(0, v) : null; });

  // The original groups these rows behind a three-way selector rather than
  // stacking them; same names, same membership, same default.
  const TABS = ["Kết quả KD", "Cân đối KT", "Dòng tiền & Tỷ số"];
  const card = el(`<div class="card"><h2 class="sec-h">Báo cáo tài chính</h2>
    <div class="range-row fin-tabs"></div>
    <div class="qgrid fin-grid"></div></div>`);
  const tabRow = card.querySelector(".fin-tabs");
  const grid = card.querySelector(".fin-grid");
  parent.appendChild(card);

  // Charts register which tab they belong to; only the active tab is drawn.
  const registry = { "Kết quả KD": [], "Cân đối KT": [], "Dòng tiền & Tỷ số": [] };
  let bucket = TABS[0];
  const tab = (name) => { bucket = name; };
  const add = (title, traces, layout) => registry[bucket].push({ title, traces, layout });

  let active = TABS[0];
  const draw = () => {
    grid.innerHTML = "";
    const pend = [];
    for (const c of registry[active]) {
      const { box, canvas } = chartBox(c.title);
      grid.appendChild(box);
      pend.push(() => window.Plotly.react(canvas, c.traces, c.layout, { displayModeBar: false, responsive: true }));
    }
    if (!grid.children.length) grid.innerHTML = `<div class="loading">Chưa có dữ liệu cho nhóm này.</div>`;
    pend.forEach((fn) => fn());
  };
  for (const t of TABS) {
    const btn = el(`<button class="range-btn ${t === active ? "active" : ""}">${t}</button>`);
    btn.onclick = () => {
      active = t;
      tabRow.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      draw();
    };
    tabRow.appendChild(btn);
  }

  // `detail` is keyed by its own period list; align it to the quarters shown.
  const dIdx = detail && detail.periods
    ? qs.map((q) => detail.periods.indexOf(q.period)) : null;
  const dSeries = (group, key) => {
    if (!dIdx || !detail[group] || !detail[group][key]) return null;
    const src = detail[group][key];
    const out = dIdx.map((i) => (i >= 0 && isN(src[i]) ? src[i] : null));
    return out.some(isN) ? out : null;
  };

  // ── Row 1 — revenue, profit, margins ────────────────────────────
  add(isBank ? "Tổng thu nhập hoạt động" : "Doanh thu", [
    { type: "bar", name: isBank ? "Tổng TN hoạt động" : "Doanh thu", x, y: col("revenue"), marker: { color: BLUE } },
    { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoy(col("revenue")),
      yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  add("Lợi nhuận sau thuế", [
    { type: "bar", name: "Lợi nhuận sau thuế", x, y: col("net_income"), marker: { color: LBLUE } },
    { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoy(col("net_income")),
      yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  add("Biên lợi nhuận (%)", [
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên NII" : "Biên gộp", x, y: ratio("gross_profit", "revenue"), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên trước DP" : "Biên hoạt động", x, y: ratio("ebit", "revenue"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: "Biên ròng", x, y: ratio("net_income", "revenue"), line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
  ], pctY(base()));

  // ── Row 2 — cost & profit structure ─────────────────────────────
  const opProfit = dSeries("income", "operating_profit");
  const finInc = dSeries("income", "financial_income");
  const finExp = dSeries("income", "financial_expense");
  const otherP = dSeries("income", "other_profit");
  const preTax = dSeries("income", "pre_tax_profit");
  if (preTax) {
    add("Cấu trúc lợi nhuận trước thuế", [
      { type: "bar", name: "LN hoạt động", x, y: opProfit, marker: { color: BLUE } },
      { type: "bar", name: "LN khác", x, y: otherP, marker: { color: GREY } },
      { type: "scatter", mode: "lines+markers", name: "LN trước thuế", x, y: preTax,
        line: { color: RED, width: 1.6 }, marker: { size: 4 } },
    ], Object.assign(base(), { barmode: "relative" }));
  }

  add(isBank ? "Chi phí hoạt động & PPOP" : "Chi phí bán hàng & QLDN",
    isBank ? [
      { type: "bar", name: "Chi phí hoạt động", x, y: qs.map((q) => (isN(q.ga_expense) ? Math.abs(q.ga_expense) : null)), marker: { color: ORANGE } },
      { type: "bar", name: "PPOP", x, y: col("ebit"), marker: { color: BLUE } },
      { type: "scatter", mode: "lines+markers", name: "CIR", x, y: qs.map((q) => (isN(q.ga_expense) && q.revenue ? Math.abs(q.ga_expense) / q.revenue : null)), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Chi phí bán hàng", x, y: qs.map((q) => (isN(q.selling_expense) ? Math.abs(q.selling_expense) : null)), marker: { color: ORANGE } },
      { type: "bar", name: "Chi phí QLDN", x, y: qs.map((q) => (isN(q.ga_expense) ? Math.abs(q.ga_expense) : null)), marker: { color: LBLUE } },
      { type: "scatter", mode: "lines+markers", name: "% Doanh thu", x, y: qs.map((q) => (q.revenue ? ((Math.abs(q.selling_expense || 0) + Math.abs(q.ga_expense || 0)) / q.revenue) : null)), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

  add("CAPEX & Khấu hao", [
    { type: "bar", name: "CAPEX", x, y: qs.map((q) => (isN(q.capex) ? Math.abs(q.capex) : null)), marker: { color: ORANGE } },
    { type: "bar", name: "Khấu hao", x, y: qs.map((q) => (isN(q.depreciation) ? Math.abs(q.depreciation) : null)), marker: { color: LBLUE } },
  ], base());

  // ── Row 3 — financial income / expense / provisions ─────────────
  if (finInc) {
    add("Doanh thu tài chính", [
      { type: "bar", name: "Doanh thu tài chính", x, y: finInc, marker: { color: GREEN } },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoy(finInc), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));
  }
  if (finExp) {
    const absExp = finExp.map((v) => (isN(v) ? Math.abs(v) : null));
    const intExp = dSeries("income", "interest_expense");
    add("Chi phí tài chính", [
      { type: "bar", name: "Chi phí tài chính", x, y: absExp, marker: { color: RED } },
      ...(intExp ? [{ type: "bar", name: "Trong đó: lãi vay", x, y: intExp.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: ORANGE } }] : []),
    ], base());
  }

  if (isBank) {
    add("Chi phí tín dụng & dự phòng", [
      { type: "bar", name: "Chi phí dự phòng", x, y: qs.map((q) => (isN(q.cogs) ? Math.abs(q.cogs) : null)), marker: { color: RED } },
      { type: "scatter", mode: "lines+markers", name: "Chi phí tín dụng (năm hóa)", x,
        y: qs.map((q) => (isN(q.cogs) && q.receivables ? Math.abs(q.cogs) * 4 / q.receivables : null)),
        yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));
  } else {
    const provInv = dSeries("balance", "prov_inventory");
    const provDbt = dSeries("balance", "prov_doubtful");
    if (provInv || provDbt) {
      add("Trích lập dự phòng", [
        ...(provInv ? [{ type: "bar", name: "DP giảm giá tồn kho", x, y: provInv.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: ORANGE } }] : []),
        ...(provDbt ? [{ type: "bar", name: "DP phải thu khó đòi", x, y: provDbt.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: RED } }] : []),
      ], Object.assign(base(), { barmode: "stack" }));
    }
  }

  // ── Cân đối KT ───────────────────────────────────────────────
  tab("Cân đối KT");
  if (isBank) {
    // Income-side bank charts belong to Kết quả KD in the original.
    tab("Kết quả KD");
    add("Thu nhập & chi phí lãi", [
      // Interest income isn't stored on its own; NII + interest expense recovers it.
      { type: "bar", name: "Thu nhập lãi", x, y: qs.map((q) => (isN(q.gross_profit) && isN(q.interest_expense) ? q.gross_profit + Math.abs(q.interest_expense) : null)), marker: { color: BLUE } },
      { type: "bar", name: "Chi phí lãi", x, y: qs.map((q) => (isN(q.interest_expense) ? Math.abs(q.interest_expense) : null)), marker: { color: ORANGE } },
      { type: "scatter", mode: "lines+markers", name: "Thu nhập lãi thuần", x, y: col("gross_profit"), line: { color: GREEN, width: 1.6 }, marker: { size: 4 } },
    ], base());

    add("Tiền gửi khách hàng", [
      { type: "bar", name: "Tiền gửi khách hàng", x, y: col("payables"), marker: { color: GREEN } },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoy(col("payables")), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

    add("Cấu trúc nguồn huy động", [
      { type: "bar", name: "Tiền gửi khách hàng", x, y: col("payables"), marker: { color: BLUE } },
      { type: "bar", name: "Vay liên NH & NHNN", x, y: col("debt"), marker: { color: ORANGE } },
      { type: "bar", name: "Vốn chủ sở hữu", x, y: col("equity"), marker: { color: GREEN } },
    ], Object.assign(base(), { barmode: "stack" }));

    add("Cơ cấu thu nhập", [
      { type: "bar", name: "Thu nhập lãi thuần", x, y: col("gross_profit"), marker: { color: BLUE } },
      { type: "bar", name: "Thu ngoài lãi", x, y: qs.map((q) => (isN(q.revenue) && isN(q.gross_profit) ? q.revenue - q.gross_profit : null)), marker: { color: LBLUE } },
      { type: "scatter", mode: "lines+markers", name: "Tỷ trọng NII", x, y: ratio("gross_profit", "revenue"), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "stack" })));

    add("Các chỉ số sinh lời", [
      { type: "scatter", mode: "lines+markers", name: "ROA (quý)", x, y: ratio("net_income", "total_assets"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "ROE (quý)", x, y: ratio("net_income", "equity"), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "NIM (quý)", x, y: ratio("gross_profit", "total_assets"), line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctY(base()));

    tab("Cân đối KT");
    add("Cấu trúc tài sản", [
      { type: "bar", name: "Tiền & TĐ tiền", x, y: col("cash"), marker: { color: GREEN } },
      { type: "bar", name: "Cho vay khách hàng", x, y: col("receivables"), marker: { color: BLUE } },
      { type: "bar", name: "Tài sản khác", x, y: derived((q) => q.total_assets - (q.cash || 0) - (q.receivables || 0)), marker: { color: GREY } },
    ], Object.assign(base(), { barmode: "stack" }));

    add("Dư nợ cho vay", [
      { type: "bar", name: "Dư nợ cho vay", x, y: col("receivables"), marker: { color: BLUE } },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoy(col("receivables")), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

    add("Hệ số thanh khoản", [
      { type: "scatter", mode: "lines+markers", name: "Cho vay / Tiền gửi", x, y: ratio("receivables", "payables"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "Cho vay / Tổng TS", x, y: ratio("receivables", "total_assets"), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "Tiền / Tiền gửi", x, y: ratio("cash", "payables"), line: { color: TEAL, width: 1.5 }, marker: { size: 4 } },
    ], pctY(base()));

    add("Chỉ số vốn", [
      { type: "scatter", mode: "lines+markers", name: "Vốn chủ / Tổng TS", x, y: ratio("equity", "total_assets"), line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "Đòn bẩy (TS/VCSH)", x, y: ratio("total_assets", "equity"), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
    ], numAxis(pctY(base())));

  } else {
    add("Cơ cấu tài sản", [
      { type: "bar", name: "Tiền", x, y: col("cash"), marker: { color: GREEN } },
      { type: "bar", name: "Phải thu", x, y: col("receivables"), marker: { color: BLUE } },
      { type: "bar", name: "Tồn kho", x, y: col("inventory"), marker: { color: ORANGE } },
      { type: "bar", name: "TS ngắn hạn khác", x, y: derived((q) => q.current_assets - (q.cash || 0) - (q.receivables || 0) - (q.inventory || 0)), marker: { color: LBLUE } },
      { type: "bar", name: "TS dài hạn", x, y: derived((q) => q.total_assets - q.current_assets), marker: { color: GREY } },
    ], Object.assign(base(), { barmode: "stack" }));

    const stB = dSeries("balance", "st_borrowings"), ltB = dSeries("balance", "lt_borrowings");
    add("Cơ cấu nguồn vốn", stB || ltB ? [
      { type: "bar", name: "Vay ngắn hạn", x, y: stB, marker: { color: RED } },
      { type: "bar", name: "Vay dài hạn", x, y: ltB, marker: { color: ORANGE } },
      { type: "bar", name: "Phải trả & nợ khác", x, y: derived((q) => q.total_assets - q.equity - (q.debt || 0)), marker: { color: GREY } },
      { type: "bar", name: "Vốn chủ", x, y: col("equity"), marker: { color: BLUE } },
    ] : [
      { type: "bar", name: "Nợ vay", x, y: col("debt"), marker: { color: RED } },
      { type: "bar", name: "Nợ khác", x, y: derived((q) => q.total_assets - q.equity - (q.debt || 0)), marker: { color: ORANGE } },
      { type: "bar", name: "Vốn chủ", x, y: col("equity"), marker: { color: BLUE } },
    ], Object.assign(base(), { barmode: "stack" }));

    add("Chỉ số thanh khoản", [
      { type: "scatter", mode: "lines+markers", name: "Current ratio", x, y: ratio("current_assets", "current_liabilities"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "Quick ratio", x, y: qs.map((q) => (isN(q.current_assets) && q.current_liabilities ? (q.current_assets - (q.inventory || 0)) / q.current_liabilities : null)), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
    ], Object.assign(base(), { yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, tickformat: ".1f" } }));

    // ── Row 5 — receivables, inventory, leverage ──────────────────
    const recTrade = dSeries("balance", "receivables_trade");
    const recLt = dSeries("balance", "receivables_lt");
    const provDbt = dSeries("balance", "prov_doubtful");
    add("Các khoản phải thu", recTrade ? [
      { type: "bar", name: "Phải thu khách hàng", x, y: recTrade, marker: { color: BLUE } },
      ...(recLt ? [{ type: "bar", name: "Phải thu dài hạn", x, y: recLt, marker: { color: LBLUE } }] : []),
      ...(provDbt ? [{ type: "bar", name: "Dự phòng khó đòi", x, y: provDbt.map((v) => (isN(v) ? -Math.abs(v) : null)), marker: { color: RED } }] : []),
      { type: "scatter", mode: "lines+markers", name: "% Tổng TS", x, y: ratio("receivables", "total_assets"), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Phải thu", x, y: col("receivables"), marker: { color: BLUE } },
      { type: "scatter", mode: "lines+markers", name: "% Tổng TS", x, y: ratio("receivables", "total_assets"), yaxis: "y2", line: { color: ORANGE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "relative" })));

    const invGross = dSeries("balance", "inventory_gross"), provInv = dSeries("balance", "prov_inventory");
    add("Hàng tồn kho", invGross ? [
      { type: "bar", name: "Tồn kho (gộp)", x, y: invGross, marker: { color: ORANGE } },
      ...(provInv ? [{ type: "bar", name: "Dự phòng giảm giá", x, y: provInv.map((v) => (isN(v) ? -Math.abs(v) : null)), marker: { color: RED } }] : []),
      { type: "scatter", mode: "lines+markers", name: "% Tổng TS", x, y: ratio("inventory", "total_assets"), yaxis: "y2", line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Tồn kho", x, y: col("inventory"), marker: { color: ORANGE } },
      { type: "scatter", mode: "lines+markers", name: "% Tổng TS", x, y: ratio("inventory", "total_assets"), yaxis: "y2", line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "relative" })));

    add("Đòn bẩy tài chính", [
      { type: "bar", name: "Nợ vay", x, y: col("debt"), marker: { color: GREY } },
      { type: "bar", name: "Vốn chủ", x, y: col("equity"), marker: { color: BLUE } },
      { type: "scatter", mode: "lines+markers", name: "D/E", x, y: ratio("debt", "equity"), yaxis: "y2", line: { color: RED, width: 1.5 }, marker: { size: 4 } },
    ], numAxis(Object.assign(base(), { barmode: "stack" })));
  }

  // ── Dòng tiền & Tỷ số ────────────────────────────────────────
  tab("Dòng tiền & Tỷ số");
  add("Dòng tiền", [
    { type: "bar", name: "HĐ Kinh doanh", x, y: col("operating_cf"), marker: { color: GREEN } },
    { type: "bar", name: "HĐ Đầu tư", x, y: col("investing_cf"), marker: { color: ORANGE } },
    { type: "bar", name: "HĐ Tài chính", x, y: col("financing_cf"), marker: { color: GREY } },
    { type: "scatter", mode: "lines+markers", name: "Dòng tiền tự do", x, y: col("fcf"), line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
  ], base());

  if (detail && (detail.dividends || []).length > 1) {
    const dv = detail.dividends.filter((d) => isN(d.value));
    if (dv.length > 1) {
      add("Cổ tức (hàng năm)", [
        { type: "bar", name: "Cổ tức đã trả", x: dv.map((d) => d.year), y: dv.map((d) => d.value), marker: { color: TEAL },
          hovertemplate: "%{x}: %{y:,.0f} tỷ<extra></extra>" },
      ], Object.assign(base(), { xaxis: { type: "category", tickfont: { ...FONT, size: 9 }, showgrid: false } }));
    }
  }

  // Quarterly P/E and P/B from the quarter-end close against the TTM
  // fundamentals known at that point.
  if ((prices || []).length) {
    const pxByQ = new Map();
    for (const p of prices) {
      const d = new Date(p.date + "T00:00:00Z");
      const key = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
      pxByQ.set(key, p.close);          // later dates overwrite -> quarter-end close
    }
    const idxAll = all.map((q, i) => i);
    const pe = [], pb = [];
    for (const q of qs) {
      const i = all.findIndex((r) => r.period === q.period);
      const w = all.slice(Math.max(0, i - 3), i + 1);
      const ni = w.map((r) => r.net_income).filter(isN);
      const shares = q.shares_outstanding || 0;
      const close = pxByQ.get(q.period);
      const price = isN(close) ? close * 1000 : null;
      const eps = (ni.length === 4 && shares > 0) ? ni.reduce((a, b) => a + b, 0) * 1000 / shares : null;
      const bvps = (isN(q.equity) && shares > 0) ? q.equity * 1000 / shares : null;
      pe.push(price && eps && eps > 0 ? price / eps : null);
      pb.push(price && bvps && bvps > 0 ? price / bvps : null);
    }
    if (pe.some(isN) || pb.some(isN)) {
      add("Định giá (P/E & P/B)", [
        { type: "scatter", mode: "lines+markers", name: "P/E", x, y: pe, line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
        { type: "scatter", mode: "lines+markers", name: "P/B", x, y: pb, yaxis: "y2", line: { color: ORANGE, width: 1.6 }, marker: { size: 4 } },
      ], numAxis(base()));
    }
  }

  draw();
  return card;
}

// Business projection, as its own card (the original's Row 7).
export function extraCharts(parent, co, financials) {
  const annual = (financials || []).filter((f) => f.period_type === "Y")
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  if (annual.length < 3) return;

  const card = el(`<div class="card"><h2 class="sec-h">Dự báo kinh doanh</h2><div class="qgrid ff-grid"></div></div>`);
  const grid = card.querySelector(".qgrid");
  parent.appendChild(card);

  const yrs = annual.slice(-6);
  const years = yrs.map((r) => String(r.period).slice(0, 4));
  const rev = yrs.map((r) => (isN(r.revenue) ? r.revenue : null));
  const ni = yrs.map((r) => (isN(r.net_income) ? r.net_income : null));
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

  const { box, canvas } = chartBox(`Doanh thu & Lợi nhuận · dự phóng 3 năm (CAGR ${(gR * 100).toFixed(0)}%)`);
  grid.appendChild(box);
  window.Plotly.react(canvas, [
    { type: "bar", name: "Doanh thu", x: allY, y: pad(rev, true), marker: { color: BLUE } },
    { type: "bar", name: "Lãi ròng", x: allY, y: pad(ni, true), marker: { color: LBLUE } },
    { type: "bar", name: "DT dự phóng", x: allY, y: pad(projRev, false), marker: { color: BLUE, pattern: { shape: "/" } } },
    { type: "bar", name: "LN dự phóng", x: allY, y: pad(projNi, false), marker: { color: LBLUE, pattern: { shape: "/" } } },
  ], Object.assign(base(300), { barmode: "group" }), { displayModeBar: false, responsive: true });
}

// Foreign net trading as its own section under the price chart -- the original
// renders it inside col_chart as "Giao dịch Nước ngoài & Tự doanh". The
// proprietary ("Tự doanh") half is a placeholder in the original too: its data
// source does not expose it.
export function foreignSection(parent, foreign) {
  if ((foreign || []).length < 2) return null;
  const card = el(`<div class="card"><h2 class="sec-h">Giao dịch Nước ngoài <span class="ta-sub">· 20 phiên gần nhất</span></h2><div class="qgrid ff-grid"></div></div>`);
  const grid = card.querySelector(".qgrid");
  parent.appendChild(card);
  const pending = [];
  const add = (title, traces, layout) => {
    const { box, canvas } = chartBox(title);
    grid.appendChild(box);
    pending.push(() => window.Plotly.react(canvas, traces, layout, { displayModeBar: false, responsive: true }));
  };

  const fx = foreign.slice(-20);
  const x = fx.map((d) => String(d.date).slice(5, 10).split("-").reverse().join("/"));
  const y = fx.map((d) => (isN(d.net_val) ? d.net_val / 1e9 : null));
  add("Khối ngoại mua/bán ròng (tỷ ₫) · 20 phiên", [
    { type: "bar", x, y, marker: { color: y.map((v) => (v >= 0 ? MARK_UP : MARK_DOWN)) },
      hovertemplate: "%{x}: %{y:.2f} tỷ<extra></extra>" },
  ], Object.assign(base(), { yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: MUTED } }));

  const L = fx[fx.length - 1] || {};
  const n0 = (v) => (isN(v) ? Math.round(v).toLocaleString("en-US") : "—");
  const nS = (v) => (isN(v) ? (v >= 0 ? "+" : "") + Math.round(v).toLocaleString("en-US") : "—");
  const bn = (v) => (isN(v) ? (v / 1e9).toFixed(2) : "—");
  const bnS = (v) => (isN(v) ? (v >= 0 ? "+" : "") + (v / 1e9).toFixed(2) : "—");
  const stats = [
    ["KL Mua", n0(L.buy_vol), ""], ["KL Bán", n0(L.sell_vol), ""],
    ["KL Mua-Bán", nS(L.net_vol), (L.net_vol ?? 0) >= 0 ? "gain" : "loss"],
    ["GT Mua (tỷ)", bn(L.buy_val), ""], ["GT Bán (tỷ)", bn(L.sell_val), ""],
    ["GT Mua-Bán (tỷ)", bnS(L.net_val), (L.net_val ?? 0) >= 0 ? "gain" : "loss"],
  ];
  grid.appendChild(el(`<div class="ff-stats">${stats.map(([k, v, c]) =>
    `<div class="ff-cell"><div class="ff-k">${k}</div><div class="ff-v ${c}">${v}</div></div>`).join("")}</div>`));
  pending.forEach((fn) => fn());
  return card;
}

// tiny local el() so this module doesn't depend on app.js
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

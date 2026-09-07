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
const BLUE = "#5b9bd5",      // main bar (revenue, loans, NII, PPOP)
      LBLUE = "#aec7e8",     // secondary bar (net income)
      DBLUE = "#4472c4",     // darker bar (EBIT, other financial expense)
      NAVY = "#1e40af",      // interbank funding
      SKY = "#60a5fa",       // customer deposits
      CYAN = "#5bc0de",      // cash, dividends
      GOLD = "#f5c518",      // growth / ratio overlay -- the original's signature
      AMBER = "#ffc000",     // depreciation, interest cost
      ORANGE = "#f0ad4e",    // inventory
      DRED = "#c00000",      // secondary ratio overlay, intrinsic value
      RED = "#ef4444",       // provisions, operating cost
      BRICK = "#d9534f",     // inventory write-down
      GREEN = "#70ad47",     // capex, non-interest income
      GREEN2 = "#22c55e",    // equity, provision release
      PURPLE = "#7030a0",    // G&A expense
      LPURPLE = "#b4a0e0",   // selling expense
      VIOLET = "#9467bd",    // securities & other assets
      GREY = "#475569",      // other liabilities
      PINK = "#ffb3b3",      // total financial expense
      MARGIN = "#f59e0b",    // margin line in the projection chart
      PE_GREEN = "#2ca02c",  // P/E line
      PB_ORANGE = "#ff7f0e", // P/B line
      PRICE_BLUE = "#1f77b4",// market price
      FIN_BLUE = "#0d6efd",  // financial income
      TEAL = "#0e7490";
// Bright pair for marks that encode up/down, matching the original.
const MARK_UP = "#22c55e", MARK_DOWN = "#ef4444";
const FONT = { family: "'Fira Code', ui-monospace, monospace", size: 10, color: INK };

const isN = (v) => typeof v === "number" && isFinite(v);
const label = (p) => String(p).replace(/^(\d{4})-Q(\d)$/, "Q$2/$1");

function base(height = 300) {
  return {
    dragmode: false, height, margin: { l: 46, r: 44, t: 36, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
    barmode: "group", bargap: 0.25,
    // The original puts the legend under the plot (y=-0.25, size 11); at the
    // top it wraps onto two lines and eats the plot area.
    legend: { orientation: "h", y: -0.25, x: 0, yanchor: "top", font: { ...FONT, size: 11 } },
    xaxis: { type: "category", tickfont: { ...FONT, size: 9 }, showgrid: false },
    yaxis: {
      gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: true, zerolinecolor: RULE,
      // The unit goes on every tick rather than in an axis title, so a number
      // is never read without it. automargin because the widest label decides
      // the gutter: VCB's deposits reach 2,000,000 tỷ and were clipping.
      tickformat: ",.0f", hoverformat: ",.0f", ticksuffix: " tỷ", automargin: true,
    },
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
export function quarterlyCharts(parent, co, financials, detail, prices, valHistory, model, lastClose, commodities) {
  const all = quarters(financials);
  const qs = all.slice(-12);
  if (qs.length < 2) return null;
  const isBank = co.sector === "Ngân hàng";
  const isSec = co.sector === "Chứng khoán";
  const x = qs.map((q) => label(q.period));
  const col = (k) => qs.map((q) => (isN(q[k]) ? q[k] : null));
  const ratio = (a, b) => qs.map((q) => (isN(q[a]) && q[b] ? q[a] / q[b] : null));
  const derived = (fn) => qs.map((q) => { const v = fn(q); return isN(v) ? Math.max(0, v) : null; });
  // YoY needs four quarters of lead-in: computing it on the trimmed window
  // leaves the first four points null and the line visibly starts mid-chart.
  // Compute across the full history first, then trim to the same window.
  const yoyOf = (k) => yoy(all.map((q) => (isN(q[k]) ? q[k] : null))).slice(-qs.length);

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
  const add = (title, traces, layout) => {
    // A series that draws nothing still claims a legend entry, so drop it; if
    // nothing survives, skip the chart entirely. dSeries() returns null when
    // the source has no such line item -- VIB has no operating_profit -- and
    // the old test read a null y as "not an array, leave it alone", which is
    // how a bank ended up with three legend entries over two visible series.
    // A trace with no y at all is a different shape (pie, polar) and is kept.
    const live = traces.filter((tr) => !("y" in tr)
      || (Array.isArray(tr.y) && tr.y.some(isN)));
    if (!live.length) return;

    // Trim leading positions where EVERY series is empty -- otherwise a source
    // that starts one quarter later than the price history leaves a blank
    // column at the left edge. Positions where only SOME series are null are
    // kept, so the projection chart's deliberate actual/forecast split stands.
    const len = Math.max(...live.map((tr) => (Array.isArray(tr.y) ? tr.y.length : 0)));
    let lead = 0;
    while (lead < len && live.every((tr) => !Array.isArray(tr.y) || !isN(tr.y[lead]))) lead++;
    if (lead > 0 && lead < len) {
      for (const tr of live) {
        if (Array.isArray(tr.y)) tr.y = tr.y.slice(lead);
        if (Array.isArray(tr.x)) tr.x = tr.x.slice(lead);
      }
    }
    registry[bucket].push({ title, traces: live, layout });
  };

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
  const dYoY = (group, key) => {
    if (!detail || !detail[group] || !detail[group][key] || !detail.periods) return null;
    const full = yoy(detail[group][key]);
    const out = qs.map((q) => {
      const i = detail.periods.indexOf(q.period);
      return i >= 0 && isN(full[i]) ? full[i] : null;
    });
    return out.some(isN) ? out : null;
  };
  const dSeries = (group, key) => {
    if (!dIdx || !detail[group] || !detail[group][key]) return null;
    const src = detail[group][key];
    const out = dIdx.map((i) => (i >= 0 && isN(src[i]) ? src[i] : null));
    return out.some(isN) ? out : null;
  };

  // ── Row 1 — revenue, profit, margins ────────────────────────────
  add(isBank ? "Tổng thu nhập hoạt động" : "Doanh thu", [
    { type: "bar", name: isBank ? "Tổng thu nhập hoạt động" : "Doanh thu", x, y: col("revenue"), marker: { color: BLUE } },
    { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoyOf("revenue"),
      yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  add("Lợi nhuận sau thuế", [
    { type: "bar", name: "Lợi nhuận sau thuế", x, y: col("net_income"), marker: { color: LBLUE} },
    { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoyOf("net_income"),
      yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
  ], pctAxis(base()));

  add("Biên lợi nhuận (%)", [
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên NII" : "Biên gộp", x, y: ratio("gross_profit", "revenue"), line: { color: GREEN, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: isBank ? "Biên trước DP" : "Biên hoạt động", x, y: ratio("ebit", "revenue"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
    { type: "scatter", mode: "lines+markers", name: "Biên lợi nhuận ròng", x, y: ratio("net_income", "revenue"), line: { color: MARGIN, width: 1.5 }, marker: { size: 4 } },
  ], pctY(base()));

  // ── Row 2 — cost & profit structure ─────────────────────────────
  const opProfit = dSeries("income", "operating_profit");
  const finInc = dSeries("income", "financial_income");
  const finExp = dSeries("income", "financial_expense");
  const otherP = dSeries("income", "other_profit");
  const preTax = dSeries("income", "pre_tax_profit");
  if (preTax) {
    add("Cấu trúc lợi nhuận trước thuế", [
      { type: "bar", name: "Lợi nhuận hoạt động", x, y: opProfit, marker: { color: DBLUE} },
      { type: "bar", name: "Lợi nhuận khác", x, y: otherP, marker: { color: GREY} },
      { type: "scatter", mode: "lines+markers", name: "Lợi nhuận trước thuế", x, y: preTax,
        line: { color: DRED, width: 1.6 }, marker: { size: 4 } },
    ], Object.assign(base(), { barmode: "relative" }));
  }

  add(isBank ? "Chi phí hoạt động & PPOP" : "Chi phí bán hàng & QLDN",
    isBank ? [
      { type: "bar", name: "Chi phí hoạt động", x, y: qs.map((q) => (isN(q.ga_expense) ? Math.abs(q.ga_expense) : null)), marker: { color: RED} },
      { type: "bar", name: "PPOP", x, y: col("ebit"), marker: { color: BLUE} },
      { type: "scatter", mode: "lines+markers", name: "CIR", x, y: qs.map((q) => (isN(q.ga_expense) && q.revenue ? Math.abs(q.ga_expense) / q.revenue : null)), yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Chi phí bán hàng", x, y: qs.map((q) => (isN(q.selling_expense) ? Math.abs(q.selling_expense) : null)), marker: { color: LPURPLE} },
      { type: "bar", name: "Chi phí quản lý doanh nghiệp", x, y: qs.map((q) => (isN(q.ga_expense) ? Math.abs(q.ga_expense) : null)), marker: { color: PURPLE} },
      { type: "scatter", mode: "lines+markers", name: "% Doanh thu", x, y: qs.map((q) => (q.revenue ? ((Math.abs(q.selling_expense || 0) + Math.abs(q.ga_expense || 0)) / q.revenue) : null)), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

  add("CAPEX & Khấu hao", [
    { type: "bar", name: "CAPEX", x, y: qs.map((q) => (isN(q.capex) ? Math.abs(q.capex) : null)), marker: { color: GREEN} },
    { type: "bar", name: "Khấu hao", x, y: qs.map((q) => (isN(q.depreciation) ? Math.abs(q.depreciation) : null)), marker: { color: AMBER} },
  ], base());

  // ── Row 3 — provisions / financial income / financial expense ───
  if (isBank) {
    add("Chi phí tín dụng & dự phòng", [
      { type: "bar", name: "Chi phí dự phòng", x, y: qs.map((q) => (isN(q.cogs) ? Math.abs(q.cogs) : null)), marker: { color: RED} },
      { type: "scatter", mode: "lines+markers", name: "Chi phí tín dụng (năm hóa)", x,
        y: qs.map((q) => (isN(q.cogs) && q.receivables ? Math.abs(q.cogs) * 4 / q.receivables : null)),
        yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));
  } else {
    const provInv = dSeries("balance", "prov_inventory");
    const provDbt = dSeries("balance", "prov_doubtful");
    if (provInv || provDbt) {
      add("Trích lập dự phòng", [
        ...(provInv ? [{ type: "bar", name: "Dự phòng giảm giá hàng tồn kho", x, y: provInv.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: ORANGE} }] : []),
        ...(provDbt ? [{ type: "bar", name: "Dự phòng phải thu khó đòi", x, y: provDbt.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: RED} }] : []),
      ], Object.assign(base(), { barmode: "stack" }));
    }
  }

  if (finInc) {
    add("Doanh thu tài chính", [
      { type: "bar", name: "Doanh thu tài chính", x, y: finInc, marker: { color: FIN_BLUE} },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: dYoY("income", "financial_income"), yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));
  }
  if (finExp) {
    const absExp = finExp.map((v) => (isN(v) ? Math.abs(v) : null));
    const intExp = dSeries("income", "interest_expense");
    add("Chi phí tài chính", [
      { type: "bar", name: "Chi phí tài chính", x, y: absExp, marker: { color: DRED} },
      ...(intExp ? [{ type: "bar", name: "Trong đó: lãi vay", x, y: intExp.map((v) => (isN(v) ? Math.abs(v) : null)), marker: { color: AMBER} }] : []),
    ], base());
  }

  // ── Cân đối KT ───────────────────────────────────────────────
  tab("Cân đối KT");
  if (isBank) {
    // Income-side bank charts belong to Kết quả KD in the original.
    tab("Kết quả KD");
    add("Thu nhập & chi phí lãi", [
      // Interest income isn't stored on its own; NII + interest expense recovers it.
      { type: "bar", name: "Thu nhập lãi", x, y: qs.map((q) => (isN(q.gross_profit) && isN(q.interest_expense) ? q.gross_profit + Math.abs(q.interest_expense) : null)), marker: { color: BLUE} },
      { type: "bar", name: "Chi phí lãi", x, y: qs.map((q) => (isN(q.interest_expense) ? Math.abs(q.interest_expense) : null)), marker: { color: AMBER} },
      { type: "scatter", mode: "lines+markers", name: "Thu nhập lãi thuần", x, y: col("gross_profit"), line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
    ], base());

    add("Tiền gửi khách hàng", [
      { type: "bar", name: "Tiền gửi khách hàng", x, y: col("payables"), marker: { color: SKY} },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoyOf("payables"), yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

    // Share of total funding, not absolute -- matches the original's fig_b3.
    const fundTot = qs.map((q) => (q.payables || 0) + (q.debt || 0));
    const fundPct = (k) => qs.map((q, i) => (fundTot[i] ? (q[k] || 0) / fundTot[i] * 100 : null));
    // Share of funding, so both bars sum to 100. Equity used to sit here too,
    // still in billions -- a 49,144 bar on a 0-100 axis flattened the two
    // percentage bars into a hairline and the chart read as one colour. Equity
    // belongs on "Cơ cấu nguồn vốn", which is in absolute terms.
    add("Cấu trúc nguồn huy động", [
      { type: "bar", name: "Tiền gửi khách hàng", x, y: fundPct("payables"), marker: { color: SKY},
        hovertemplate: "%{y:.1f}%<extra></extra>" },
      { type: "bar", name: "Liên ngân hàng & NHNN", x, y: fundPct("debt"), marker: { color: "#1e3a5f" },
        hovertemplate: "%{y:.1f}%<extra></extra>" },
    ], Object.assign(base(), { barmode: "stack",
      yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, ticksuffix: "%", range: [0, 100] } }));

    add("Cơ cấu thu nhập", [
      { type: "bar", name: "Thu nhập lãi thuần", x, y: col("gross_profit"), marker: { color: BLUE} },
      { type: "bar", name: "Thu ngoài lãi", x, y: qs.map((q) => (isN(q.revenue) && isN(q.gross_profit) ? q.revenue - q.gross_profit : null)), marker: { color: GREEN} },
      { type: "scatter", mode: "lines+markers", name: "Tỷ trọng NII", x, y: ratio("gross_profit", "revenue"), yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "stack" })));

    add("Các chỉ số sinh lời", [
      { type: "scatter", mode: "lines+markers", name: "ROA (quý)", x, y: ratio("net_income", "total_assets"), line: { color: BLUE, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "ROE (quý)", x, y: ratio("net_income", "equity"), line: { color: GREEN2, width: 1.5 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "NIM (quý)", x, y: ratio("gross_profit", "total_assets"), line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctY(base()));

    tab("Cân đối KT");
    add("Cơ cấu tài sản", [
      { type: "bar", name: "Tiền mặt & NHNN", x, y: col("cash"), marker: { color: CYAN} },
      { type: "bar", name: "Dư nợ cho vay", x, y: col("receivables"), marker: { color: BLUE} },
      { type: "bar", name: "Chứng khoán & Khác", x, y: derived((q) => Math.max(0, q.total_assets - (q.cash || 0) - (q.receivables || 0))), marker: { color: VIOLET} },
    ], Object.assign(base(), { barmode: "stack" }));

    // Funding structure in absolute terms (the original's fig11b) -- a separate
    // chart from the share-of-funding one that sits in the income tab.
    add("Cơ cấu nguồn vốn", [
      { type: "bar", name: "Tiền gửi khách hàng", x, y: col("payables"), marker: { color: SKY} },
      { type: "bar", name: "Liên ngân hàng & NHNN", x, y: col("debt"), marker: { color: NAVY} },
      { type: "bar", name: "Vốn chủ sở hữu", x, y: col("equity"), marker: { color: GREEN2} },
      { type: "bar", name: "Nợ phải trả khác", x, y: derived((q) => Math.max(0, q.total_assets - (q.payables || 0) - (q.debt || 0) - (q.equity || 0))), marker: { color: GREY} },
    ], Object.assign(base(), { barmode: "stack" }));

    add("Dư nợ cho vay", [
      { type: "bar", name: "Dư nợ cho vay", x, y: col("receivables"), marker: { color: BLUE } },
      { type: "scatter", mode: "lines+markers", name: "Tăng trưởng YoY", x, y: yoyOf("receivables"), yaxis: "y2", line: { color: GOLD, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(base()));

    add("Chỉ số thanh khoản", [
      { type: "scatter", mode: "lines+markers", name: "LDR % (Vay/Huy động)", x, y: ratio("receivables", "payables"), line: { color: MARGIN, width: 2 }, marker: { size: 5 } },
      { type: "scatter", mode: "lines+markers", name: "Dư nợ cho vay / Tổng tài sản %", x, y: ratio("receivables", "total_assets"), line: { color: SKY, width: 2 }, marker: { size: 5 } },
      { type: "scatter", mode: "lines+markers", name: "Tiền mặt/Huy động %", x, y: ratio("cash", "payables"), line: { color: GREEN2, width: 2 }, marker: { size: 5 } },
    ], pctY(base()));

    // Provision charge vs release. The original flags releases (negative
    // provisions) with a star above the bar and colours them green.
    const provB = qs.map((q) => (isN(q.cogs) ? q.cogs : null));
    if (provB.some(isN)) {
      add("Trích lập & hoàn nhập dự phòng", [
        { type: "bar", name: "Chi phí dự phòng", x, y: provB,
          marker: { color: provB.map((v) => ((v || 0) < 0 ? GREEN2 : RED)) },
          text: provB.map((v) => ((v || 0) < 0 ? "★ HOÀN NHẬP" : "")),
          textposition: "outside", textfont: { ...FONT, size: 10, color: GREEN2 } },
        { type: "scatter", mode: "lines+markers", name: "Chi phí tín dụng % (năm hóa)", x,
          y: qs.map((q) => (isN(q.cogs) && q.receivables ? q.cogs * 4 / q.receivables * 100 : null)),
          yaxis: "y2", line: { color: GOLD, width: 2 }, marker: { size: 5 } },
      ], Object.assign(pctAxis(base()), {
        shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
                   line: { color: "#64748b", width: 1, dash: "dot" }, opacity: 0.5 }],
        annotations: [{ text: "Xanh = Hoàn nhập | Đỏ = Trích lập mới", x: 0, xref: "paper",
                        y: -0.28, yref: "paper", xanchor: "left", showarrow: false,
                        font: { ...FONT, size: 10, color: GREY } }],
      }));
    }

    add("Chỉ số vốn", [
      { type: "scatter", mode: "lines+markers", name: "Vốn chủ sở hữu / Tổng tài sản", x, y: ratio("equity", "total_assets"), line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
      { type: "scatter", mode: "lines+markers", name: "Đòn bẩy (Tài sản / Vốn chủ sở hữu)", x, y: ratio("total_assets", "equity"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ], numAxis(Object.assign(pctY(base()), {
      // The band here is a couple of points wide; ".0%" printed "9%" twice.
      yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, tickformat: ".1%",
               zeroline: false, title: { text: "%", font: { ...FONT, size: 10 } } },
    })));

  } else {
    add("Cấu trúc tài sản", [
      { type: "bar", name: "Tiền & tương đương", x, y: col("cash"), marker: { color: CYAN} },
      { type: "bar", name: "Phải thu", x, y: col("receivables"), marker: { color: ORANGE} },
      { type: "bar", name: "Hàng tồn kho", x, y: col("inventory"), marker: { color: "#5cb85c" } },
      { type: "bar", name: "Tài sản ngắn hạn khác", x, y: derived((q) => Math.max(0, q.current_assets - (q.cash || 0) - (q.receivables || 0) - (q.inventory || 0))), marker: { color: "#9b59b6" } },
      { type: "bar", name: "Tài sản dài hạn", x, y: derived((q) => Math.max(0, q.total_assets - q.current_assets)), marker: { color: "#e74c3c" } },
    ], Object.assign(base(), { barmode: "stack" }));

    const stB = dSeries("balance", "st_borrowings"), ltB = dSeries("balance", "lt_borrowings");
    const payT = dSeries("balance", "payables");
    const otherLiab = qs.map((q, i) => {
      const known = ((stB && stB[i]) || 0) + ((ltB && ltB[i]) || 0) + ((payT && payT[i]) || 0);
      return isN(q.total_assets) && isN(q.equity)
        ? Math.max(0, q.total_assets - q.equity - known) : null;
    });
    add("Cấu trúc nguồn vốn", stB || ltB ? [
      { type: "bar", name: "Vốn chủ sở hữu", x, y: col("equity"), marker: { color: PE_GREEN} },
      { type: "bar", name: "Vay dài hạn", x, y: ltB, marker: { color: "#d62728" } },
      { type: "bar", name: "Vay ngắn hạn", x, y: stB, marker: { color: PB_ORANGE} },
      ...(payT ? [{ type: "bar", name: "Phải trả người bán", x, y: payT, marker: { color: PRICE_BLUE} }] : []),
      { type: "bar", name: "Nợ phải trả khác", x, y: otherLiab, marker: { color: VIOLET} },
    ] : [
      { type: "bar", name: "Nợ vay", x, y: col("debt"), marker: { color: DRED} },
      { type: "bar", name: "Nợ khác", x, y: derived((q) => q.total_assets - q.equity - (q.debt || 0)), marker: { color: AMBER} },
      { type: "bar", name: "Vốn chủ sở hữu", x, y: col("equity"), marker: { color: BLUE} },
    ], Object.assign(base(), { barmode: "stack" }));

    add("Hệ số thanh khoản", [
      { type: "scatter", mode: "lines+markers", name: "Current ratio", x, y: ratio("current_assets", "current_liabilities"), line: { color: GREEN2, width: 2 }, marker: { size: 5 } },
      { type: "scatter", mode: "lines+markers", name: "Quick ratio", x, y: qs.map((q) => (isN(q.current_assets) && q.current_liabilities ? (q.current_assets - (q.inventory || 0)) / q.current_liabilities : null)), line: { color: MARGIN, width: 2 }, marker: { size: 5 } },
      { type: "scatter", mode: "lines+markers", name: "Cash ratio", x, y: ratio("cash", "current_liabilities"), line: { color: SKY, width: 2 }, marker: { size: 5 } },
    ], Object.assign(base(), {
      yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, tickformat: ".1f", title: { text: "lần (x)", font: { ...FONT, size: 10 } } },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: "#64748b", width: 1, dash: "dot" }, opacity: 0.5 }],
    }));

    // ── Row 5 — receivables, inventory, leverage ──────────────────
    const recTrade = dSeries("balance", "receivables_trade");
    const recLt = dSeries("balance", "receivables_lt");
    const provDbt = dSeries("balance", "prov_doubtful");
    add("Các khoản phải thu", recTrade ? [
      { type: "bar", name: "Phải thu khách hàng", x, y: recTrade, marker: { color: SKY} },
      ...(recLt ? [{ type: "bar", name: "Phải thu dài hạn", x, y: recLt, marker: { color: LBLUE} }] : []),
      ...(provDbt ? [{ type: "bar", name: "Dự phòng khó đòi", x, y: provDbt.map((v) => (isN(v) ? -Math.abs(v) : null)), marker: { color: BRICK} }] : []),
      { type: "scatter", mode: "lines+markers", name: "% Tổng tài sản", x, y: ratio("receivables", "total_assets"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Phải thu", x, y: col("receivables"), marker: { color: SKY} },
      { type: "scatter", mode: "lines+markers", name: "% Tổng tài sản", x, y: ratio("receivables", "total_assets"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "relative" })));

    const fvtpl = dSeries("balance", "fvtpl");
    if (isSec && fvtpl) {
      // QoQ, not YoY -- a trading book turns over far faster than inventory.
      const qoq = fvtpl.map((v, i) => (i && isN(v) && fvtpl[i - 1] ? (v / fvtpl[i - 1] - 1) * 100 : null));
      add("Danh mục tài sản tài chính", [
        { type: "bar", name: "Tài sản tài chính (FVTPL/AFS)", x, y: fvtpl, marker: { color: BLUE} },
        { type: "scatter", mode: "lines+markers", name: "Tăng trưởng QoQ %", x, y: qoq,
          yaxis: "y2", line: { color: GOLD, width: 2 }, marker: { size: 5 } },
      ], pctAxis(base()));
    }

    const invGross = dSeries("balance", "inventory_gross"), provInv = dSeries("balance", "prov_inventory");
    add("Hàng tồn kho", invGross ? [
      { type: "bar", name: "Tồn kho (gộp)", x, y: invGross, marker: { color: ORANGE} },
      ...(provInv ? [{ type: "bar", name: "Dự phòng giảm giá", x, y: provInv.map((v) => (isN(v) ? -Math.abs(v) : null)), marker: { color: BRICK} }] : []),
      { type: "scatter", mode: "lines+markers", name: "% Tổng tài sản", x, y: ratio("inventory", "total_assets"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ] : [
      { type: "bar", name: "Tồn kho", x, y: col("inventory"), marker: { color: ORANGE} },
      { type: "scatter", mode: "lines+markers", name: "% Tổng tài sản", x, y: ratio("inventory", "total_assets"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "relative" })));

    add("Đòn bẩy tài chính", [
      { type: "bar", name: "Nợ vay", x, y: col("debt"), marker: { color: DRED} },
      { type: "bar", name: "Vốn chủ sở hữu", x, y: col("equity"), marker: { color: BLUE} },
      { type: "scatter", mode: "lines+markers", name: "D/E", x, y: ratio("debt", "equity"), yaxis: "y2", line: { color: DRED, width: 1.5 }, marker: { size: 4 } },
    ], numAxis(Object.assign(base(), { barmode: "stack" })));
  }

  // ── Dòng tiền & Tỷ số ────────────────────────────────────────
  tab("Dòng tiền & Tỷ số");
  add("Dòng tiền", [
    { type: "bar", name: "HĐ Kinh doanh", x, y: col("operating_cf"), marker: { color: GREEN} },
    { type: "bar", name: "HĐ Đầu tư", x, y: col("investing_cf"), marker: { color: AMBER} },
    { type: "bar", name: "HĐ Tài chính", x, y: col("financing_cf"), marker: { color: GREY} },
    { type: "scatter", mode: "lines+markers", name: "Dòng tiền tự do", x, y: col("fcf"), line: { color: BLUE, width: 1.6 }, marker: { size: 4 } },
  ], base());

  if (detail && (detail.dividends || []).length > 1) {
    const dv = detail.dividends.filter((d) => isN(d.value));
    if (dv.length > 1) {
      add("Cổ tức (hàng năm)", [
        { type: "bar", name: "Cổ tức đã trả", x: dv.map((d) => d.year), y: dv.map((d) => d.value), marker: { color: CYAN},
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
    // The exported price history is ~2 years, so older quarters have no
    // quarter-end close and would render as a line starting mid-chart. Trim the
    // window to the quarters that actually have a multiple.
    const firstOk = pe.findIndex((v, i) => isN(v) || isN(pb[i]));
    if (firstOk >= 0) {
      add("Định giá (P/E & P/B)", [
        { type: "scatter", mode: "lines+markers", name: "P/E", x: x.slice(firstOk), y: pe.slice(firstOk), line: { color: PE_GREEN, width: 1.6 }, marker: { size: 4 } },
        { type: "scatter", mode: "lines+markers", name: "P/B", x: x.slice(firstOk), y: pb.slice(firstOk), yaxis: "y2", line: { color: PB_ORANGE, width: 1.6 }, marker: { size: 4 } },
      ], numAxis(Object.assign(base(), {
        yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 }, zeroline: false,
                 tickformat: ".1f", hoverformat: ".2f",
                 title: { text: "P/E (lần)", font: { ...FONT, size: 10 } } },
      })));
    }
  }

  // The original's third tab also carries the projection and the price-vs-
  // intrinsic-value chart; they are not separate cards at the end of the page.
  const annual = (financials || []).filter((f) => f.period_type === "Y")
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  if (annual.length >= 3) {
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
    const pYears = [], pRev = [], pNi = [];
    let lr = rev.filter(isN).slice(-1)[0] ?? 0, ln = ni.filter(isN).slice(-1)[0] ?? 0;
    const lastY = parseInt(years[years.length - 1]) || new Date().getFullYear();
    for (let i = 1; i <= 3; i++) { lr *= 1 + gR; ln *= 1 + gN; pYears.push(`${lastY + i}F`); pRev.push(lr); pNi.push(ln); }
    const allY = [...years, ...pYears];
    const pad = (a, before) => before ? [...a, ...new Array(3).fill(null)]
                                      : [...new Array(years.length).fill(null), ...a];
    // CAGR belongs in the hover, not the title -- the original titles this
    // chart plainly and reports both growth rates on the projected bars.
    const cr = (gR * 100).toFixed(1), cn = (gN * 100).toFixed(1);
    add("Dự báo kinh doanh", [
      { type: "bar", name: "Doanh thu", x: allY, y: pad(rev, true), marker: { color: PRICE_BLUE },
        hovertemplate: "%{x}: %{y:,.0f} tỷ<extra></extra>" },
      { type: "bar", name: "Lợi nhuận sau thuế", x: allY, y: pad(ni, true), marker: { color: LBLUE },
        hovertemplate: "%{x}: %{y:,.0f} tỷ<extra></extra>" },
      { type: "bar", name: "Doanh thu (dự báo)", x: allY, y: pad(pRev, false), showlegend: false,
        marker: { color: PRICE_BLUE, opacity: 0.7, pattern: { shape: "/", size: 6, solidity: 0.4 } },
        hovertemplate: `%{x}: %{y:,.0f} tỷ (CAGR ${cr}%)<extra></extra>` },
      { type: "bar", name: "Lợi nhuận sau thuế (dự báo)", x: allY, y: pad(pNi, false), showlegend: false,
        marker: { color: LBLUE, opacity: 0.7, pattern: { shape: "/", size: 6, solidity: 0.4 } },
        hovertemplate: `%{x}: %{y:,.0f} tỷ (CAGR ${cn}%)<extra></extra>` },
      { type: "scatter", mode: "lines+markers", name: "Biên lợi nhuận thuần %", x: allY,
        y: [...years.map((_, k) => (isN(rev[k]) && rev[k] && isN(ni[k]) ? ni[k] / rev[k] : null)), null, null, null],
        yaxis: "y2", line: { color: MARGIN, width: 1.6 }, marker: { size: 4 } },
      // Repeat the last actual margin at index years.length-1 so the dashed
      // forecast joins the solid line instead of starting in mid-air.
      { type: "scatter", mode: "lines+markers", name: "Biên lợi nhuận thuần % (dự báo)", x: allY,
        y: [...new Array(years.length - 1).fill(null),
            (isN(rev[years.length - 1]) && rev[years.length - 1] && isN(ni[years.length - 1]))
              ? ni[years.length - 1] / rev[years.length - 1] : null,
            ...pRev.map((r, k) => (r ? pNi[k] / r : null))],
        yaxis: "y2", line: { color: MARGIN, width: 1.6, dash: "dot" }, marker: { size: 4 } },
    ], pctAxis(Object.assign(base(), { barmode: "group", xaxis: { type: "category", tickfont: { ...FONT, size: 9 }, showgrid: false } })));
  }

  if ((valHistory || []).length && (prices || []).length) {
    const px = prices.slice(-500);
    // The estimate is recomputed only now and then, so it covers a fraction of
    // the price window. The original pads it to both ends of that window and
    // interpolates, giving one continuous line instead of a stub; do the same.
    const pts = valHistory
      .map((r) => [r.calc_date || r.date, r.avg_intrinsic_value ?? r.avg])
      .filter(([d, v]) => d && isN(v))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (pts.length) {
      const dates = px.map((r) => r.date);
      const iv = dates.map((d) => {
        let lo = null, hi = null;
        for (const [pd, pv] of pts) {
          if (pd <= d) lo = [pd, pv];
          if (pd >= d && !hi) hi = [pd, pv];
        }
        if (lo && hi && lo[0] !== hi[0]) {
          const t0 = Date.parse(lo[0]), t1 = Date.parse(hi[0]), t = Date.parse(d);
          return lo[1] + (hi[1] - lo[1]) * ((t - t0) / (t1 - t0));
        }
        return (lo || hi)[1];               // flat before the first / after the last
      });
      add("Giá so với giá trị nội tại", [
        { type: "scatter", mode: "lines", name: "Giá thị trường",
          x: dates, y: px.map((r) => r.close * 1000),
          line: { color: PRICE_BLUE, width: 1.5 }, fill: "tozeroy", fillcolor: "rgba(37,99,235,0.06)",
          hovertemplate: "%{y:,.0f} VND<extra></extra>" },
        { type: "scatter", mode: "lines", name: "Giá trị nội tại TB",
          x: dates, y: iv, line: { color: DRED, width: 2, dash: "dash" },
          hovertemplate: "%{y:,.0f} VND<extra></extra>" },
      ], Object.assign(base(), {
        xaxis: { tickfont: { ...FONT, size: 9 }, showgrid: false },
        yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 },
                 tickformat: ",.0f", hoverformat: ",.0f",
                 title: { text: "Giá (VND)", font: { ...FONT, size: 10 } } },
      }));
    }
  }

  // The original's chart 21: every valuation method as a bar against the
  // market price and the average estimate. (Its other branch, a commodity
  // price index for ten input/output-driven sectors, needs a live feed.)
  const VM_LABELS = [
    ["dcf", "DCF / FCFF"], ["fcfe", "Cash Flow to Equity"], ["graham", "Graham Number"],
    ["pe", "P/E Implied"], ["pb", "P/B Implied"], ["ev_ebitda", "EV/EBITDA"],
    ["epv", "Earnings Power Value"], ["ps", "P/Sales"], ["ri", "Residual Income"],
    ["pocf", "Price/OCF"],
  ];
  const commDef = commodities && commodities.sectors && commodities.sectors[co.sector];
  const commSeries = (commodities && commodities.series) || {};
  const commRows = commDef
    ? [...commDef.input.map((t) => [...t, true]), ...commDef.output.map((t) => [...t, false])]
        .filter(([sym]) => commSeries[sym])
    : [];

  const vmM = (model && model.methods) || {};
  const vmPairs = VM_LABELS.filter(([k]) => isN(vmM[k]) && vmM[k] > 0);
  if (commRows.length) {
    // Each series is rebased to 100 at the start of the window, so the lines
    // compare rate of change rather than absolute price. Inputs are dashed.
    add(commDef.title, commRows.map(([sym, name, color, isInput]) => ({
      type: "scatter", mode: "lines", name,
      // Futures and the steel ETF keep different holiday calendars, so the
      // union date index leaves the odd hole; bridge it rather than snapping
      // the line, the hole is a calendar artefact and not missing signal.
      x: commodities.dates, y: commSeries[sym], connectgaps: true,
      line: { color, width: 2, dash: isInput ? "dash" : "solid" },
      hovertemplate: `${name}: %{y:.1f}<extra></extra>`,
    })), Object.assign(base(), {
      xaxis: { type: "category", tickangle: -45, nticks: 8, tickfont: { ...FONT, size: 9 } },
      yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 },
               title: { text: "Chỉ số (gốc=100)", font: { ...FONT, size: 10 } } },
    }));
  } else if (vmPairs.length) {
    const names = vmPairs.map(([, lab]) => lab);
    const vals = vmPairs.map(([k]) => vmM[k]);
    // Closes are stored in thousands VND; the methods return raw VND.
    const px = isN(lastClose) ? lastClose * 1000 : null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pct = (v) => (px ? `${v > px ? "+" : ""}${((v - px) / px * 100).toFixed(1)}%` : "");
    const rule = (y, color, dash, label) => ({
      type: "scatter", mode: "lines", x: names, y: names.map(() => y),
      line: { color, width: 2, dash }, name: label,
      hovertemplate: `${label}<extra></extra>`,
    });
    add("Các phương pháp định giá so với thị giá", [
      { type: "bar", x: names, y: vals, name: "Định giá",
        marker: { color: vals.map((v) => (px && v > px ? GREEN2 : RED)) },
        text: vals.map(pct), textposition: "outside", textfont: { ...FONT, size: 11 },
        hovertemplate: "%{x}: %{y:,.0f} VND<extra></extra>" },
      ...(px ? [rule(px, MARGIN, "dash", `Thị giá ${Math.round(px).toLocaleString("en-US")}`)] : []),
      rule(avg, "#f87171", "dot", `TB ước tính ${Math.round(avg).toLocaleString("en-US")}`),
    ], Object.assign(base(), {
      showlegend: false,
      // Rotated method names ("Cash Flow to Equity") need far more room than
      // base()'s 30px bottom margin; automargin lets Plotly claim what the
      // labels actually measure instead of clipping them.
      margin: { l: 58, r: 14, t: 26, b: 96 },
      xaxis: { tickangle: -30, tickfont: { ...FONT, size: 9 }, automargin: true },
      yaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 },
               tickformat: ",.0f", hoverformat: ",.0f",
               title: { text: "VND", font: { ...FONT, size: 10 } } },
    }));
  }

  draw();
  return card;
}

// Business projection, as its own card (the original's Row 7).

// Foreign net trading as its own section under the price chart -- the original
// renders it inside col_chart as "Giao dịch Nước ngoài & Tự doanh". The
// proprietary ("Tự doanh") half is a placeholder in the original too: its data
// source does not expose it.
export function foreignSection(parent, foreign, prices) {
  if ((foreign || []).length < 2) return null;
  const card = el(`<div class="card">
    <h2 class="sec-h">Giao dịch Nước ngoài &amp; Tự doanh <span class="ta-sub">· 20 phiên gần nhất</span></h2>
    <div class="range-row ff-tabs"></div>
    <div class="ff-body"></div>
  </div>`);
  parent.appendChild(card);
  const body = card.querySelector(".ff-body");
  const tabRow = card.querySelector(".ff-tabs");

  const fx = foreign.slice(-20);
  const x = fx.map((d) => String(d.date).slice(5, 10).split("-").reverse().join("/"));
  const y = fx.map((d) => (isN(d.net_val) ? d.net_val / 1e9 : null));

  // The price line shares the bars' category axis, so it can only carry the
  // sessions the flow data has -- look each one up rather than slicing.
  const closeBy = new Map((prices || []).map((r) => [String(r.date), r.close]));
  const closes = fx.map((d) => {
    const v = closeBy.get(String(d.date));
    return isN(v) ? v : null;
  });

  const L = fx[fx.length - 1] || {};
  const n0 = (v) => (isN(v) ? Math.round(v).toLocaleString("en-US") : "—");
  const nS = (v) => (isN(v) ? (v >= 0 ? "+" : "−") + Math.abs(Math.round(v)).toLocaleString("en-US") : "—");
  const bn = (v) => (isN(v) ? (v / 1e9).toFixed(2) : "—");
  const bnS = (v) => (isN(v) ? (v >= 0 ? "+" : "−") + Math.abs(v / 1e9).toFixed(2) : "—");
  const sign = (v) => ((v ?? 0) >= 0 ? "gain" : "loss");

  function renderForeign() {
    body.innerHTML = "";
    // Two rows of three, above the chart, as st.columns(3) twice.
    const rows = [
      [["KL Mua", n0(L.buy_vol), ""], ["KL Bán", n0(L.sell_vol), ""],
       ["KL Mua-Bán", nS(L.net_vol), sign(L.net_vol)]],
      [["GT Mua (tỷ)", bn(L.buy_val), ""], ["GT Bán (tỷ)", bn(L.sell_val), ""],
       ["GT Mua-Bán (tỷ)", bnS(L.net_val), sign(L.net_val)]],
    ];
    for (const r of rows) {
      body.appendChild(el(`<div class="ff-stats">${r.map(([k, v, c]) =>
        `<div class="ff-cell"><div class="ff-k">${k}</div><div class="ff-v ${c}">${v}</div></div>`).join("")}</div>`));
    }
    const canvas = el(`<div class="ff-plot"></div>`);
    body.appendChild(canvas);
    body.appendChild(el(`<div class="vb-note">GTNN = giá trị giao dịch ròng của nhà đầu tư nước ngoài.</div>`));

    const traces = [
      { type: "bar", x, y, name: "GTNN mua ròng (tỷ)",
        marker: { color: y.map((v) => ((v ?? 0) >= 0 ? MARK_UP : MARK_DOWN)) },
        customdata: fx.map((d) => [(d.buy_val || 0) / 1e9, (d.sell_val || 0) / 1e9]),
        hovertemplate: "Net: %{y:,.2f} tỷ · Buy: %{customdata[0]:,.2f} tỷ · "
                     + "Sell: %{customdata[1]:,.2f} tỷ<extra>GTNN ròng</extra>" },
    ];
    if (closes.some(isN)) {
      traces.push({ type: "scatter", mode: "lines", x, y: closes, yaxis: "y2",
        name: "Giá đóng cửa", connectgaps: true,
        line: { color: SKY, width: 2 },
        hovertemplate: "%{y:,.1f}<extra>Giá đóng cửa</extra>" });
    }
    window.Plotly.react(canvas, traces, {
      height: 280, dragmode: false, margin: { l: 52, r: 52, t: 28, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
      hovermode: "x unified",
      legend: { orientation: "h", y: 1.1, x: 0, font: { ...FONT, size: 11 } },
      xaxis: { type: "category", showgrid: false, tickfont: { ...FONT, size: 10 } },
      yaxis: { title: { text: "GTNN ròng (tỷ)", font: { ...FONT, size: 10 } },
               gridcolor: RULE, zeroline: false },
      yaxis2: { title: { text: "Giá (nghìn VND)", font: { ...FONT, size: 10 } },
                overlaying: "y", side: "right", showgrid: false },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
                 line: { color: "#cbd5e1", width: 1 } }],
    }, { displayModeBar: false, responsive: true });
  }

  function renderProp() {
    body.innerHTML = "";
    // The original shows the same notice: proprietary flow isn't in the feed.
    body.appendChild(el(`<div class="vb-note">Dữ liệu giao dịch tự doanh chưa có sẵn từ nguồn dữ liệu hiện tại.</div>`));
  }

  for (const name of ["Nước ngoài", "Tự doanh"]) {
    const btn = el(`<button class="range-btn ${name === "Nước ngoài" ? "active" : ""}">${name}</button>`);
    btn.addEventListener("click", () => {
      tabRow.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      (name === "Nước ngoài" ? renderForeign : renderProp)();
    });
    tabRow.appendChild(btn);
  }
  renderForeign();
  return card;
}

// tiny local el() so this module doesn't depend on app.js
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

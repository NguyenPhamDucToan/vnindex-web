import { loadCompanies, loadScreener, loadTicker, loadMeta, loadMacro } from "./data.js";
import { priceChart, priceVsValueChart } from "./charts.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR, SIGNAL_ORDER } from "./signals.js";
import { ratingColor } from "./ratings.js";
import { computeTTM } from "./ttm.js";
import { quarterlyCharts, extraCharts, foreignSection } from "./quarterly.js";
import { valuationPanel, technicalPanel } from "./valuation-panel.js";
import { dupontSection, roicSection, peerSection, valuationBandSection } from "./sections.js";
import * as F from "./format.js";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const FINANCIAL_SECTORS = new Set(["Ngân hàng", "Chứng khoán", "Bảo hiểm"]);
let COMPANIES = [];
let currentTicker = null;
let currentRange = 365;

// ── boot ────────────────────────────────────────────────────────────
async function boot() {
  COMPANIES = await loadCompanies();
  buildPicker();
  buildNav();
  const meta = await loadMeta().catch(() => null);
  if (meta) $("#meta").textContent =
    `${meta.n_tickers} mã · cập nhật ${meta.generated_at.slice(0, 10)}`;

  const initial = new URLSearchParams(location.search).get("ticker")
    || (COMPANIES.find((c) => c.ticker === "VCB") ? "VCB" : COMPANIES[0].ticker);
  selectTicker(initial);
}

function buildNav() {
  const nav = $("#nav");
  const views = [["stock", "Phân tích cổ phiếu"], ["screen", "Sàng lọc"], ["sector", "Phân tích ngành"],
    ["market", "Tổng quan thị trường"], ["macro", "Vĩ mô"], ["portfolio", "Danh mục"]];
  for (const [id, label] of views) {
    const a = el(`<button class="nav-item" data-view="${id}">${label}</button>`);
    a.onclick = () => showView(id);
    nav.appendChild(a);
  }
  showView("stock");
}

function showView(id) {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === id));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${id}`));
  if (id === "screen") renderScreener();
  if (id === "sector") renderSector();
  if (id === "portfolio") renderPortfolio();
  if (id === "market") renderMarket();
  if (id === "macro") renderMacro();
}

// ── ticker picker ───────────────────────────────────────────────────
function buildPicker() {
  const input = $("#picker");
  const list = $("#picker-list");
  const render = (q) => {
    const term = q.trim().toUpperCase();
    const matches = COMPANIES.filter((c) =>
      c.ticker.includes(term) || (c.name || "").toUpperCase().includes(term)).slice(0, 40);
    list.innerHTML = "";
    for (const c of matches) {
      const item = el(`<div class="pick"><b>${c.ticker}</b><span>${F.escapeHtml(c.name || "")}</span></div>`);
      item.onmousedown = () => { selectTicker(c.ticker); input.value = c.ticker; list.classList.add("hidden"); };
      list.appendChild(item);
    }
    list.classList.toggle("hidden", !matches.length);
  };
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 150));
}

function selectTicker(t) {
  currentTicker = t;
  history.replaceState(null, "", `?ticker=${t}`);
  showView("stock");
  renderStock(t);
}

// ── stock analysis view ─────────────────────────────────────────────
function latestQ(financials) {
  const qs = financials.filter((f) => f.period_type === "Q");
  return qs.length ? qs[qs.length - 1] : null;
}

async function renderStock(t) {
  const root = $("#view-stock");
  root.innerHTML = `<div class="loading">Đang tải ${t}…</div>`;
  let d;
  try { d = await loadTicker(t); }
  catch { root.innerHTML = `<div class="loading">Không có dữ liệu cho ${t}.</div>`; return; }

  const co = d.company, v = d.valuation || {}, prices = d.prices || [];
  const q = latestQ(d.financials || []);
  const last = prices[prices.length - 1] || {};
  const prev = prices[prices.length - 2] || {};
  const chg = (F.isNum(last.close) && F.isNum(prev.close)) ? last.close - prev.close : null;
  const chgPct = (chg != null && prev.close) ? chg / prev.close : null;
  const shares = q ? q.shares_outstanding : null;      // millions
  const mcap = (F.isNum(last.close) && F.isNum(shares)) ? last.close * shares : null; // billions VND
  const vol15 = prices.slice(-15).reduce((a, r) => a + (r.volume || 0), 0) / Math.min(15, prices.length);

  root.innerHTML = "";
  root.appendChild(header(co, last, prev, chg, chgPct));
  root.appendChild(metricsGrid(co, v, q, mcap, shares, vol15));

  // Two-column split matching the original: price chart on the left, the
  // valuation-estimates + technical panel down the right.
  const split = el(`<div class="card split">
    <div class="split-l"><div class="range-row" id="range-row"></div><div id="price-chart"></div></div>
    <div class="split-r"></div></div>`);
  root.appendChild(split);
  buildRangeButtons($("#range-row", split), prices);
  priceChart($("#price-chart", split), prices, currentRange);

  const right = $(".split-r", split);
  const vp = valuationPanel(co, d.model || {}, F.isNum(last.close) ? last.close * 1000 : null);
  if (vp) right.appendChild(vp);
  const tp = technicalPanel(prices);
  if (tp) right.appendChild(tp);

  // These three live inside the left column in the original (col_chart), under
  // the price chart -- putting them full-width below the split left a tall gap
  // beside the valuation panel.
  const left = $(".split-l", split);
  const peers = await loadScreener().catch(() => null);
  const pc = peerSection(co, v, peers, (d.model || {}).upside);
  if (pc) left.appendChild(pc);
  foreignSection(left, d.foreign || []);
  valuationBandSection(left, d.financials || [], prices);

  // Full width from the TTM scorecard down, as in the original.
  const ttm = computeTTM(d.financials || []);
  root.appendChild(scorecard(co, v, ttm));

  const dp = dupontSection(v);
  if (dp) root.appendChild(dp);
  const rw = roicSection(d.financials || [], d.model || {});
  if (rw) root.appendChild(rw);

  root.appendChild(valuationSummary(co, v, d.model || {}, d.analyst, last));

  // Quarterly analysis charts (the "meat" rows) from the exported financials.
  // Appends itself to root, then renders (Plotly needs an attached node).
  quarterlyCharts(root, co, d.financials || []);
  extraCharts(root, co, d.financials || [], d.foreign || []);

  if ((d.valuation_history || []).length > 2) {
    const pv = el(`<div class="card"><h2 class="sec-h">Giá thị trường vs Định giá</h2><div id="pv-chart"></div></div>`);
    root.appendChild(pv);
    priceVsValueChart($("#pv-chart", pv), prices, d.valuation_history);
  }
}

function header(co, last, prev, chg, chgPct) {
  const up = chg == null ? 0 : chg;
  const cls = up > 0 ? "gain" : up < 0 ? "loss" : "flat";
  const rangePos = (F.isNum(last.low) && F.isNum(last.high) && last.high > last.low)
    ? ((last.close - last.low) / (last.high - last.low)) * 100 : 50;
  return el(`
    <div class="stock-head">
      <div class="sh-left">
        <div class="sh-tick">${co.ticker} <span class="badge">${co.exchange || "HOSE"}</span></div>
        <div class="sh-name">${F.escapeHtml(co.name || "")}</div>
        <div class="sh-sector">${F.escapeHtml(co.sector || "")}</div>
      </div>
      <div class="sh-right">
        <div class="sh-price ${cls}">${F.priceVND(last.close)}</div>
        <div class="sh-chg ${cls}">${chg == null ? "" : (chg >= 0 ? "▲" : "▼") + " " + F.priceVND(Math.abs(chg)) + " (" + F.pct(chgPct) + ")"}</div>
        <div class="sh-range">
          <span>${F.priceVND(last.low)}</span>
          <div class="bar"><div class="fill ${cls}" style="width:${rangePos}%"></div><div class="dot" style="left:${rangePos}%"></div></div>
          <span>${F.priceVND(last.high)}</span>
        </div>
      </div>
    </div>`);
}

function metricsGrid(co, v, q, mcap, shares, vol15) {
  // Same nine cells, same order, same accent on P/E + P/B as the original
  // header's 3x3 grid.
  const cells = [
    ["Market Cap (bn)", F.num(mcap, 0), false],
    ["Book Value (bn)", F.num(q ? q.equity : null, 0), false],
    ["P/E", F.mult(v.pe, 1), true],
    ["Avg Vol 15D (K)", F.num(vol15 / 1000, 0), false],
    ["EPS (VND)", q && F.isNum(q.eps) ? F.rawVND(q.eps) : "—", false],
    ["P/B", F.mult(v.pb, 1), true],
    ["Shares (M)", F.num(shares, 0), false],
    ["EV/EBITDA", F.mult(v.ev_ebitda, 1), false],
    ["Ngành", F.escapeHtml(co.sector || "—"), false],
  ];
  const grid = el(`<div class="metrics"></div>`);
  for (const [k, val, accent] of cells)
    grid.appendChild(el(`<div class="metric"><div class="mk">${k}</div><div class="mv${accent ? " accent" : ""}">${val}</div></div>`));
  return grid;
}

// ── TTM ratio scorecard (from stored ratios) ────────────────────────
function scoreRow(title, cells) {
  const row = el(`<div class="sc-block"><div class="sc-title">${title}</div><div class="sc-cells"></div></div>`);
  const wrap = $(".sc-cells", row);
  cells.forEach((c, i) => {
    const sep = i < cells.length - 1 ? "border-right:1px solid rgba(148,163,184,0.25);" : "";
    wrap.appendChild(el(`<div class="sc-cell" style="${sep}">
      <div class="sc-k">${c.label}</div>
      <div class="sc-v" style="color:${c.color}">${c.value}</div></div>`));
  });
  return row;
}

function scorecard(co, v, ttm) {
  const isFin = FINANCIAL_SECTORS.has(co.sector);
  const isBank = co.sector === "Ngân hàng";
  const isSec = co.sector === "Chứng khoán";
  const isRE = co.sector === "Bất động sản";
  const card = el(`<div class="card"><h2 class="sec-h">Chỉ số tài chính chủ chốt (TTM)</h2></div>`);
  const R = ratingColor;
  const div = (a, b) => (F.isNum(a) && b) ? a / b : null;

  card.appendChild(scoreRow("SINH LỜI", [
    { label: isBank ? "Thu nhập lãi / Tổng TN" : "Biên LN gộp", value: F.pct(v.gross_margin), color: R(v.gross_margin, 0.25, 0.15) },
    { label: isBank ? "Biên trước dự phòng" : "Biên hoạt động", value: F.pct(v.operating_margin), color: R(v.operating_margin, 0.15, 0.05) },
    { label: "Biên LN ròng", value: F.pct(v.net_margin), color: R(v.net_margin, 0.10, 0.05) },
    { label: "ROE", value: F.pct(v.roe), color: R(v.roe, 0.15, 0.10) },
    // Banks earn 1-2% on a deposit-funded asset base by design; scoring against
    // the 8%/5% industrial band would paint every bank red.
    { label: "ROA", value: F.pct(v.roa), color: isBank ? R(v.roa, 0.015, 0.010) : R(v.roa, 0.08, 0.05) },
  ]));

  if (isBank && ttm) {
    // Banks fail the generic liquidity row (no current/non-current split), so
    // it's swapped for the metrics the sector is actually judged on -- all from
    // the bank field remap (revenue=TOI, gross_profit=NII, cogs=provisions,
    // receivables=loan book, payables=customer deposits).
    const nim = div(ttm.gross_profit, ttm.total_assets);
    const cir = div(ttm.ga_expense != null ? Math.abs(ttm.ga_expense) : null, ttm.revenue);
    const ldr = div(ttm.receivables, ttm.payables);
    const cc = div(ttm.cogs != null ? Math.abs(ttm.cogs) : null, ttm.receivables);
    const ea = div(ttm.equity, ttm.total_assets);
    card.appendChild(scoreRow("HIỆU QUẢ & AN TOÀN NGÂN HÀNG", [
      { label: "Biên lãi thuần (NIM)", value: F.pct(nim), color: R(nim, 0.030, 0.020) },
      { label: "Chi phí / Thu nhập (CIR)", value: F.pct(cir), color: R(cir, 0.35, 0.50, false) },
      { label: "Cho vay / Tiền gửi", value: F.pct(ldr), color: R(ldr, 1.00, 1.20, false) },
      { label: "Chi phí tín dụng", value: F.pct(cc), color: R(cc, 0.010, 0.020, false) },
      { label: "Vốn chủ / Tổng tài sản", value: F.pct(ea), color: R(ea, 0.09, 0.06) },
    ]));
    const lev = div(ttm.total_assets, ttm.equity);
    const dep = div(ttm.payables, ttm.total_assets);
    card.appendChild(scoreRow("CƠ CẤU VỐN & NGUỒN VỐN", [
      { label: "Đòn bẩy (TS / VCSH)", value: F.mult(lev), color: R(lev, 12, 15, false) },
      { label: "Tiền gửi KH / Tổng TS", value: F.pct(dep), color: R(dep, 0.60, 0.45) },
      { label: "Vay liên NH / Vốn chủ", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 2, 4, false) },
    ]));
  } else if (isSec && ttm) {
    // Brokers keep D/E (leverage is real risk) but drop FCF/profit-quality --
    // they run structurally negative OCF from growing the margin book.
    const ea = div(ttm.equity, ttm.total_assets);
    card.appendChild(scoreRow("THANH KHOẢN", [
      { label: "Current ratio", value: F.mult(v.current_ratio), color: R(v.current_ratio, 2, 1) },
      { label: "Quick ratio", value: F.mult(v.quick_ratio), color: R(v.quick_ratio, 1, 0.5) },
      { label: "OCF / Nợ ngắn hạn", value: F.mult(v.ocf_to_current_liab), color: R(v.ocf_to_current_liab, 0.4, 0.2) },
    ]));
    card.appendChild(scoreRow("ĐÒN BẨY & AN TOÀN VỐN", [
      { label: "Nợ / Vốn chủ (D/E)", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 1, 2, false) },
      { label: "Nợ / Tổng tài sản", value: F.pct(v.debt_to_assets), color: R(v.debt_to_assets, 0.30, 0.60, false) },
      { label: "Vốn chủ / Tổng tài sản", value: F.pct(ea), color: R(ea, 0.40, 0.25) },
    ]));
  } else {
    card.appendChild(scoreRow("THANH KHOẢN", [
      { label: "Current ratio", value: F.mult(v.current_ratio), color: R(v.current_ratio, 2, 1) },
      { label: "Quick ratio", value: F.mult(v.quick_ratio), color: R(v.quick_ratio, 1, 0.5) },
      { label: "OCF / Nợ ngắn hạn", value: F.mult(v.ocf_to_current_liab), color: R(v.ocf_to_current_liab, 0.4, 0.2) },
      { label: "Đòn bẩy (TS/VCSH)", value: F.mult(v.financial_leverage), color: R(v.financial_leverage, 2.5, 4, false) },
    ]));
    card.appendChild(scoreRow("ĐÒN BẨY & DÒNG TIỀN", [
      { label: "Nợ / Vốn chủ (D/E)", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 1, 2, false) },
      { label: "Nợ / Tổng tài sản", value: F.pct(v.debt_to_assets), color: R(v.debt_to_assets, 0.30, 0.60, false) },
      { label: "Biên FCF", value: F.pct(v.fcf_margin), color: R(v.fcf_margin, 0.10, 0.0) },
      { label: "Chất lượng LN", value: F.mult(v.profit_quality), color: R(v.profit_quality, 1, 0.8) },
    ]));
    // Property developers hold years of project inventory by design, so the
    // DIO/CCC bands widen for them.
    const dioGood = isRE ? 1095 : 50, dioWarn = isRE ? 1825 : 100;
    const cccGood = isRE ? 1095 : 50, cccWarn = isRE ? 1825 : 90;
    const cic = v.cash_interest_coverage;
    card.appendChild(scoreRow("VÒNG QUAY VỐN & AN TOÀN NỢ", [
      { label: "Chu kỳ tiền mặt (CCC)", value: F.days(v.ccc), color: R(v.ccc, cccGood, cccWarn, false) },
      { label: "Ngày thu tiền (DSO)", value: F.days(v.dso), color: R(v.dso, 30, 60, false) },
      { label: "Ngày tồn kho (DIO)", value: F.days(v.dio), color: R(v.dio, dioGood, dioWarn, false) },
      { label: "Tiền mặt trả lãi vay", value: F.isNum(cic) && cic > 100 ? "Không vay nợ" : F.mult(cic), color: F.isNum(cic) && cic > 100 ? "#16a34a" : R(cic, 5, 3) },
    ]));
  }

  const legend = el(`<div class="legend">
    <span><i style="background:#16a34a"></i>Tốt</span>
    <span><i style="background:#d97706"></i>Cảnh báo</span>
    <span><i style="background:#dc2626"></i>Nguy hiểm</span></div>`);
  card.appendChild(legend);
  return card;
}

// ── valuation summary (model + analyst + quality/signal) ────────────
function valuationSummary(co, v, model, analyst, last) {
  const priceRaw = F.isNum(last.close) ? last.close * 1000 : null;
  // model.upside is a FRACTION (0.15 = +15%), already sector-adjusted and
  // winsorized by model_valuation.py -- unlike the raw dcf_estimate, which is
  // garbage for banks (VCB reads +715%).
  const upFrac = F.isNum(model.upside) ? model.upside : null;
  const q = computeQualityScore(v.roe, v.net_margin, v.profit_quality, v.fcf_margin, v.current_ratio, v.debt_to_equity);
  const sig = (upFrac != null) ? classifySignal(upFrac, q) : null;

  const mColor = upFrac == null ? "#5b6675" : upFrac >= 0 ? "#15803d" : "#b91c1c";
  const qColor = q >= 70 ? "#15803d" : q >= 50 ? "#b45309" : "#b91c1c";
  const hasAnalyst = analyst && F.isNum(analyst.target_price) && analyst.target_price > 0;

  const card = el(`<div class="card"><h2 class="sec-h">Đánh giá tổng hợp</h2><div class="ev-cards"></div>
    <div class="ev-note"></div></div>`);
  const wrap = $(".ev-cards", card);

  wrap.appendChild(el(`<div class="ev-card">
    <div class="ev-t">Mô hình định giá</div>
    <div class="ev-m" style="color:${mColor}">${F.rawVND(model.price)}</div>
    <div class="ev-s">${upFrac == null ? "Thiếu dữ liệu" : F.pctSigned(upFrac * 100) + " so với thị giá " + F.rawVND(priceRaw)}</div></div>`));

  if (hasAnalyst) {
    // Analyst target from VCI; the individual analyst's name is deliberately
    // omitted -- the useful part is the house's call, not who wrote it.
    const aUp = priceRaw ? (analyst.target_price - priceRaw) / priceRaw : null;
    const aColor = aUp == null ? "#5b6675" : aUp >= 0 ? "#15803d" : "#b91c1c";
    const rating = (analyst.rating || "").toUpperCase() || "—";
    wrap.appendChild(el(`<div class="ev-card">
      <div class="ev-t">Chuyên viên phân tích</div>
      <div class="ev-m" style="color:${aColor}">${F.rawVND(analyst.target_price)}</div>
      <div class="ev-s">${aUp == null ? "" : F.pctSigned(aUp * 100) + " · Khuyến nghị <b>" + rating + "</b>"}</div>
      <div class="ev-src">Nguồn: VCI</div></div>`));
  }

  wrap.appendChild(el(`<div class="ev-card">
    <div class="ev-t">Điểm chất lượng</div>
    <div class="ev-m" style="color:${qColor}">${q.toFixed(0)}<span class="ev-u">/100</span></div>
    <div class="ev-s">${sig ? "Tín hiệu: <b style='color:" + (SIGNAL_COLOR[sig]) + "'>" + SIGNAL_VI[sig] + "</b>" : "—"}</div></div>`));

  const nViews = 1 + (hasAnalyst ? 1 : 0) + 1;
  const nWord = { 2: "Hai", 3: "Ba" }[nViews] || nViews;
  $(".ev-note", card).innerHTML = hasAnalyst
    ? `${nWord} góc nhìn độc lập: mô hình từ báo cáo tài chính, khuyến nghị của chuyên viên phân tích bên ngoài, và điểm chất lượng nội bộ. Khi chúng <b>mâu thuẫn nhau</b> là lúc đáng xem kỹ lại giả định.`
    : `Mô hình định giá (trung bình các phương pháp, kẹp ngoại lai, điều chỉnh theo ngành) và điểm chất lượng nội bộ. Mã này chưa có chuyên viên phân tích nào công bố giá mục tiêu.`;
  return card;
}

function buildRangeButtons(row, prices) {
  const opts = [["3M", 63], ["6M", 126], ["1Y", 365], ["2Y", 760]];
  row.innerHTML = "";
  for (const [label, days] of opts) {
    const b = el(`<button class="range-btn ${days === currentRange ? "active" : ""}">${label}</button>`);
    b.onclick = () => {
      currentRange = days;
      row.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      priceChart(document.getElementById("price-chart"), prices, days);
    };
    row.appendChild(b);
  }
}

// Model upside past ~±300% carries no real information (thin-float small caps
// where a multiple blows up) -- show it capped so one garbage row can't
// dominate the eye, while the exact figure still lives in the stock view.
function fmtUpside(frac) {
  if (!F.isNum(frac)) return "—";
  if (frac > 3) return "> +300%";
  if (frac < -0.95) return "< −95%";
  return F.pctSigned(frac * 100);
}

// ── screener view ───────────────────────────────────────────────────
let SCREEN_ROWS = null;      // enriched, sorted, cached across filter changes

async function enrichScreener() {
  if (SCREEN_ROWS) return SCREEN_ROWS;
  const rows = await loadScreener();
  SCREEN_ROWS = rows.map((r) => {
    const q = computeQualityScore(r.roe, r.net_margin, r.profit_quality, r.fcf_margin, r.current_ratio, r.debt_to_equity);
    const upFrac = F.isNum(r.model_upside) ? r.model_upside : null;   // sector-adjusted fraction
    const sig = upFrac != null ? classifySignal(upFrac, q) : null;
    return { ...r, q, sig, upFrac };
  }).sort((a, b) => {
    // Rank by signal first (it already folds in quality, so a small illiquid
    // name with a garbage +9000% model upside but weak quality lands as
    // "Watch", not at the very top), then quality, then upside.
    const ra = a.sig ? SIGNAL_ORDER.indexOf(a.sig) : 99;
    const rb = b.sig ? SIGNAL_ORDER.indexOf(b.sig) : 99;
    if (ra !== rb) return ra - rb;
    if (b.q !== a.q) return b.q - a.q;
    return (b.upFrac ?? -1e9) - (a.upFrac ?? -1e9);
  });
  return SCREEN_ROWS;
}

let screenerBuilt = false;
async function renderScreener() {
  if (screenerBuilt) return;
  screenerBuilt = true;
  const root = $("#view-screen");
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const rows = await enrichScreener();
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();

  root.innerHTML = "";
  // Filter set mirrors the original's sidebar sliders (Avg Upside, Max P/E,
  // Max P/B, ROE, Net margin, Quality, D/E) plus sector and signal.
  const card = el(`<div class="card"><h2 class="sec-h">Sàng lọc cổ phiếu</h2>
    <div class="sig-counts" id="sig-counts"></div>
    <div class="filters">
      <label>Ngành <select id="f-sector"><option value="">Tất cả</option>${sectors.map((s) => `<option>${F.escapeHtml(s)}</option>`).join("")}</select></label>
      <label>Tín hiệu <select id="f-signal"><option value="">Tất cả</option>${SIGNAL_ORDER.map((s) => `<option value="${s}">${SIGNAL_VI[s]}</option>`).join("")}</select></label>
      <label>Avg Upside ≥ <input id="f-up" type="number" step="5" placeholder="%" /></label>
      <label>Max P/E <input id="f-pe" type="number" step="1" placeholder="×" /></label>
      <label>Max P/B <input id="f-pb" type="number" step="0.5" placeholder="×" /></label>
      <label>ROE ≥ <input id="f-roe" type="number" step="1" placeholder="%" /></label>
      <label>Biên LN ròng ≥ <input id="f-nm" type="number" step="1" placeholder="%" /></label>
      <label>Quality ≥ <input id="f-qs" type="number" step="5" placeholder="0-100" /></label>
      <label>D/E ≤ <input id="f-de" type="number" step="0.5" placeholder="×" /></label>
      <button id="f-reset" class="range-btn">Xóa lọc</button>
      <span id="f-count" class="fcount"></span>
    </div>
    <table class="screen"><thead><tr>
      <th>Mã</th><th>Ngành</th><th>P/E</th><th>P/B</th><th>ROE</th>
      <th>Upside</th><th>Chất lượng</th><th>Tín hiệu</th></tr></thead><tbody></tbody></table></div>`);
  root.appendChild(card);
  const tb = $("tbody", card);

  // Signal-count row; clicking one filters to that signal (as in the original).
  const counts = $("#sig-counts", card);
  for (const s of SIGNAL_ORDER) {
    const n = rows.filter((r) => r.sig === s).length;
    const b = el(`<button class="sig-c" data-sig="${s}" style="border-top-color:${SIGNAL_COLOR[s]}">
      <div class="sig-n">${n}</div><div class="sig-l">${SIGNAL_VI[s]}</div></button>`);
    b.onclick = () => {
      const sel = $("#f-signal", card);
      sel.value = sel.value === s ? "" : s;
      apply();
    };
    counts.appendChild(b);
  }

  const apply = () => {
    const num = (id) => parseFloat($(id, card).value);
    const sec = $("#f-sector", card).value;
    const sig = $("#f-signal", card).value;
    const maxPe = num("#f-pe"), maxPb = num("#f-pb"), minRoe = num("#f-roe");
    const minNm = num("#f-nm"), minQs = num("#f-qs"), maxDe = num("#f-de"), minUp = num("#f-up");
    const out = rows.filter((r) =>
      (!sec || r.sector === sec) &&
      (!sig || r.sig === sig) &&
      (isNaN(maxPe) || (F.isNum(r.pe) && r.pe <= maxPe)) &&
      (isNaN(maxPb) || (F.isNum(r.pb) && r.pb <= maxPb)) &&
      (isNaN(minRoe) || (F.isNum(r.roe) && r.roe * 100 >= minRoe)) &&
      (isNaN(minNm) || (F.isNum(r.net_margin) && r.net_margin * 100 >= minNm)) &&
      (isNaN(minQs) || r.q >= minQs) &&
      (isNaN(maxDe) || (F.isNum(r.debt_to_equity) && r.debt_to_equity <= maxDe)) &&
      (isNaN(minUp) || (F.isNum(r.upFrac) && r.upFrac * 100 >= minUp)));
    tb.innerHTML = "";
    for (const r of out) {
      const tr = el(`<tr>
        <td><b>${r.ticker}</b></td>
        <td class="dim">${F.escapeHtml(r.sector || "")}</td>
        <td>${F.mult(r.pe)}</td><td>${F.mult(r.pb)}</td><td>${F.pct(r.roe)}</td>
        <td style="color:${(r.upFrac ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(r.upFrac)}</td>
        <td>${r.q.toFixed(0)}</td>
        <td>${r.sig ? `<span style="color:${SIGNAL_COLOR[r.sig]}">${SIGNAL_VI[r.sig]}</span>` : "—"}</td></tr>`);
      tr.onclick = () => selectTicker(r.ticker);
      tb.appendChild(tr);
    }
    $("#f-count", card).textContent = `${out.length} / ${rows.length} mã`;
  };
  card.querySelectorAll("select, input").forEach((c) => c.addEventListener("input", apply));
  $("#f-reset", card).onclick = () => {
    card.querySelectorAll("select").forEach((s) => (s.value = ""));
    card.querySelectorAll("input").forEach((i) => (i.value = ""));
    apply();
  };
  apply();
}

// ── sector view ─────────────────────────────────────────────────────
function median(arr) {
  const a = arr.filter((x) => F.isNum(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

let sectorBuilt = false;
async function renderSector() {
  if (sectorBuilt) return;
  sectorBuilt = true;
  const root = $("#view-sector");
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const rows = await enrichScreener();

  const bySec = {};
  for (const r of rows) {
    if (!r.sector) continue;
    (bySec[r.sector] ||= []).push(r);
  }
  // Every column is a MEDIAN across the sector's tickers, as in the original —
  // a mean would let one outlier define a whole sector.
  const agg = Object.entries(bySec).map(([sector, rs]) => ({
    sector, n: rs.length,
    pe: median(rs.map((r) => r.pe)),
    pb: median(rs.map((r) => r.pb)),
    roe: median(rs.map((r) => r.roe)),
    nm: median(rs.map((r) => r.net_margin)),
    fcf: median(rs.map((r) => r.fcf_margin)),
    de: median(rs.map((r) => r.debt_to_equity)),
    cr: median(rs.map((r) => r.current_ratio)),
    up: median(rs.map((r) => r.upFrac)),
    q: median(rs.map((r) => r.q)),
  }));

  root.innerHTML = "";

  // ── 1. Heatmap with the original's metric selector ────────────────
  const METRICS = {
    "Định giá vs Thị trường": { key: "up", label: "Upside %", pct: true, asc: false, lo: -0.8, hi: 1.5 },
    "P/E (thấp hơn = rẻ hơn)": { key: "pe", label: "P/E", pct: false, asc: true, lo: 0, hi: 50 },
    "P/B (thấp hơn = rẻ hơn)": { key: "pb", label: "P/B", pct: false, asc: true, lo: 0, hi: 5 },
    "ROE (cao hơn = tốt hơn)": { key: "roe", label: "ROE %", pct: true, asc: false, lo: -0.2, hi: 0.4 },
  };
  let metricName = "Định giá vs Thị trường";

  const heat = el(`<div class="card">
    <h2 class="sec-h">Bản đồ nhiệt theo Ngành</h2>
    <div class="range-row" id="sec-metric"></div>
    <div class="vb-note" id="sec-cap"></div>
    <div id="sec-tree"></div></div>`);
  root.appendChild(heat);

  const drawTree = () => {
    const m = METRICS[metricName];
    const data = agg.filter((s) => F.isNum(s[m.key]));
    // Green = favourable for the chosen metric, so a "lower is better" metric
    // (P/E, P/B) has its scale flipped rather than showing cheap sectors red.
    const norm = (v) => {
      const t = Math.max(0, Math.min(1, (v - m.lo) / (m.hi - m.lo)));
      return m.asc ? 1 - t : t;
    };
    const fmtV = (v) => m.pct ? F.pctSigned(v * 100) : v.toFixed(2) + "×";
    window.Plotly.react($("#sec-tree", heat), [{
      type: "treemap",
      labels: data.map((s) => s.sector),
      parents: data.map(() => ""),
      values: data.map((s) => s.n),
      text: data.map((s) => fmtV(s[m.key])),
      texttemplate: "%{label}<br>%{value} mã · %{text}",
      hovertemplate: "%{label}<br>%{value} mã · " + m.label + " %{text}<extra></extra>",
      marker: {
        colors: data.map((s) => norm(s[m.key])),
        colorscale: [[0, "#b91c1c"], [0.5, "#f1f5f9"], [1, "#15803d"]],
        cmin: 0, cmax: 1, line: { width: 1, color: "#fff" },
      },
      tiling: { pad: 2 },
    }], {
      height: 430, margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      font: { family: "'Fira Code', monospace", size: 11, color: "#0a121d" },
    }, { displayModeBar: false, responsive: true });
    $("#sec-cap", heat).textContent =
      `${agg.length} ngành · Chỉ số là trung vị giữa các mã · ${rows.length} mã có dữ liệu định giá · ` +
      `Ô lớn = nhiều mã; xanh = tốt hơn theo "${m.label}".`;
  };

  const mrow = $("#sec-metric", heat);
  for (const name of Object.keys(METRICS)) {
    const b = el(`<button class="range-btn ${name === metricName ? "active" : ""}">${name}</button>`);
    b.onclick = () => {
      metricName = name;
      mrow.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      drawTree();
    };
    mrow.appendChild(b);
  }
  drawTree();

  // ── 2. Valuation multiples by sector — four ranked bar charts ─────
  const multi = el(`<div class="card"><h2 class="sec-h">Hệ số Định giá theo Ngành</h2><div class="qgrid"></div></div>`);
  root.appendChild(multi);
  const mgrid = multi.querySelector(".qgrid");
  const barSpecs = [
    ["P/E trung vị theo Ngành", "pe", false, true],
    ["P/B trung vị theo Ngành", "pb", false, true],
    ["ROE trung vị theo Ngành", "roe", true, false],
    ["Biên LN ròng trung vị theo Ngành", "nm", true, false],
  ];
  const pending = [];
  for (const [title, key, isPct, lowerBetter] of barSpecs) {
    const data = agg.filter((s) => F.isNum(s[key])).sort((a, b) => a[key] - b[key]);
    const box = el(`<div class="qchart"><div class="qtitle">${title}</div><div></div></div>`);
    mgrid.appendChild(box);
    const canvas = box.lastElementChild;
    pending.push(() => window.Plotly.react(canvas, [{
      type: "bar", orientation: "h",
      x: data.map((s) => (isPct ? s[key] * 100 : s[key])),
      y: data.map((s) => s.sector),
      marker: { color: data.map((s) => {
        const vals = data.map((d) => d[key]);
        const med = vals[Math.floor(vals.length / 2)];
        const good = lowerBetter ? s[key] <= med : s[key] >= med;
        return good ? "#15803d" : "#b91c1c";
      }) },
      hovertemplate: "%{y}: %{x:.2f}" + (isPct ? "%" : "×") + "<extra></extra>",
    }], {
      height: Math.max(280, data.length * 17), dragmode: false,
      margin: { l: 145, r: 16, t: 6, b: 26 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "'Fira Code', monospace", size: 9, color: "#0a121d" },
      xaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, ticksuffix: isPct ? "%" : "×" },
      yaxis: { tickfont: { size: 8.5 }, automargin: true },
    }, { displayModeBar: false, responsive: true }));
  }
  pending.forEach((fn) => fn());

  // ── 3. Sector summary table — same columns as the original ───────
  const tbl = el(`<div class="card"><h2 class="sec-h">Bảng tổng hợp theo Ngành</h2>
    <table class="screen"><thead><tr>
      <th>Ngành</th><th>Số mã</th><th>Upside</th><th>P/E</th><th>P/B</th><th>ROE</th>
      <th>Biên LN ròng</th><th>FCF Margin</th><th>D/E</th><th>Curr Ratio</th><th>Quality</th>
    </tr></thead><tbody></tbody></table></div>`);
  const tb = $("tbody", tbl);
  for (const s of [...agg].sort((a, b) => (b.up ?? -1e9) - (a.up ?? -1e9))) {
    tb.appendChild(el(`<tr>
      <td class="dim">${F.escapeHtml(s.sector)}</td>
      <td>${s.n}</td>
      <td style="color:${(s.up ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(s.up)}</td>
      <td>${F.mult(s.pe, 1)}</td><td>${F.mult(s.pb)}</td><td>${F.pct(s.roe)}</td>
      <td>${F.pct(s.nm)}</td><td>${F.pct(s.fcf)}</td>
      <td>${F.mult(s.de)}</td><td>${F.mult(s.cr)}</td>
      <td>${F.isNum(s.q) ? s.q.toFixed(0) : "—"}</td></tr>`));
  }
  root.appendChild(tbl);
}

// ── portfolio tracker (localStorage) ────────────────────────────────
const PF_KEY = "vnindex_portfolio";
const pfLoad = () => { try { return JSON.parse(localStorage.getItem(PF_KEY)) || []; } catch { return []; } };
const pfSave = (h) => localStorage.setItem(PF_KEY, JSON.stringify(h));

async function renderPortfolio() {
  const root = $("#view-portfolio");
  const holdings = pfLoad();

  root.innerHTML = "";
  const card = el(`<div class="card"><h2 class="sec-h">Danh mục đầu tư</h2>
    <div class="pf-add">
      <input id="pf-t" placeholder="Mã" style="width:80px;text-transform:uppercase" />
      <input id="pf-s" type="number" placeholder="Số CP" style="width:100px" />
      <input id="pf-e" type="number" step="0.1" placeholder="Giá mua (nghìn₫)" style="width:130px" />
      <button id="pf-add" class="range-btn active">Thêm</button>
      <span class="dim" style="font-size:11px">Lưu trên máy bạn (localStorage)</span>
    </div>
    <div id="pf-kpi" class="metrics" style="margin:14px 0"></div>
    <table class="screen"><thead><tr>
      <th>Mã</th><th>Số CP</th><th>Giá mua</th><th>Giá hiện tại</th><th>Giá trị</th>
      <th>Lãi/Lỗ</th><th>Định giá</th><th>Tín hiệu</th><th></th></tr></thead><tbody></tbody></table>
    <div id="pf-empty" class="dim" style="padding:16px;font-size:13px;${holdings.length ? "display:none" : ""}">Chưa có mã nào. Thêm cổ phiếu để theo dõi lãi/lỗ và định giá.</div></div>`);
  root.appendChild(card);

  const add = () => {
    const t = $("#pf-t", card).value.trim().toUpperCase();
    const s = parseFloat($("#pf-s", card).value);
    const e = parseFloat($("#pf-e", card).value);
    if (!t || !(s > 0) || !(e > 0)) return;
    const h = pfLoad(); h.push({ ticker: t, shares: s, entry: e }); pfSave(h);
    renderPortfolio();
  };
  $("#pf-add", card).onclick = add;
  card.querySelectorAll(".pf-add input").forEach((i) =>
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") add(); }));

  const tb = $("tbody", card);
  let totCost = 0, totVal = 0, wUp = 0, wUpBase = 0;
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    let d = null;
    try { d = await loadTicker(h.ticker); } catch { /* unknown ticker */ }
    const last = d && d.prices && d.prices.length ? d.prices[d.prices.length - 1].close : null;
    const up = d && d.model ? d.model.upside : null;
    const v = d && d.valuation || {};
    const q = d ? computeQualityScore(v.roe, v.net_margin, v.profit_quality, v.fcf_margin, v.current_ratio, v.debt_to_equity) : null;
    const sig = (F.isNum(up) && q != null) ? classifySignal(up, q) : null;
    const cost = h.shares * h.entry * 1000;
    const val = F.isNum(last) ? h.shares * last * 1000 : null;
    const pl = (val != null) ? val - cost : null;
    const plPct = (pl != null && cost) ? pl / cost : null;
    totCost += cost; if (val != null) { totVal += val; if (F.isNum(up)) { wUp += up * val; wUpBase += val; } }

    const tr = el(`<tr>
      <td><b>${h.ticker}</b></td>
      <td>${F.num(h.shares, 0)}</td>
      <td>${F.priceVND(h.entry)}</td>
      <td>${F.priceVND(last)}</td>
      <td>${F.moneyVND(val)}</td>
      <td style="color:${(pl ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${pl == null ? "—" : F.pctSigned((plPct || 0) * 100)}</td>
      <td style="color:${(up ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(up)}</td>
      <td>${sig ? `<span style="color:${SIGNAL_COLOR[sig]}">${SIGNAL_VI[sig]}</span>` : "—"}</td>
      <td><button class="pf-del" data-i="${i}" title="Xóa">✕</button></td></tr>`);
    tr.querySelector("td b").onclick = () => selectTicker(h.ticker);
    tr.querySelector(".pf-del").onclick = () => { const hh = pfLoad(); hh.splice(i, 1); pfSave(hh); renderPortfolio(); };
    tb.appendChild(tr);
  }

  const totPl = totVal - totCost;
  const kpi = $("#pf-kpi", card);
  if (holdings.length) {
    const cells = [
      ["Giá trị thị trường", F.moneyVND(totVal)],
      ["Vốn gốc", F.moneyVND(totCost)],
      ["Lãi/Lỗ", (totCost ? F.pctSigned(totPl / totCost * 100) : "—")],
      ["Upside bình quân", (wUpBase ? F.pctSigned(wUp / wUpBase * 100) : "—")],
    ];
    kpi.innerHTML = cells.map(([k, val], idx) =>
      `<div class="metric"><div class="mk">${k}</div><div class="mv" style="color:${idx === 2 && totPl < 0 ? "#b91c1c" : idx === 2 ? "#15803d" : "var(--ink)"}">${val}</div></div>`).join("");
  } else kpi.style.display = "none";
}

// ── market overview ─────────────────────────────────────────────────
let marketBuilt = false;
async function renderMarket() {
  if (marketBuilt) return;
  marketBuilt = true;
  const root = $("#view-market");
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const [rows, market] = await Promise.all([
    loadScreener(),
    fetch("data/market.json").then((r) => r.json()).catch(() => ({ vnindex: [], foreign: [] })),
  ]);
  const withChg = rows.filter((r) => F.isNum(r.chg));

  const up = withChg.filter((r) => r.chg > 0).length;
  const down = withChg.filter((r) => r.chg < 0).length;
  const flat = withChg.length - up - down;
  const total = withChg.length || 1;

  root.innerHTML = "";

  // ── 1. VN-Index chart + advance/decline panel (3:1, as in the original) ──
  const top = el(`<div class="card split-31">
    <div><h2 class="sec-h">VN-Index (1 năm)</h2><div id="vni-chart"></div></div>
    <div><h2 class="sec-h">Tăng / Giảm</h2><div id="ad-panel"></div></div>
  </div>`);
  root.appendChild(top);

  const idx = (market.vnindex || []).slice(-252);
  if (idx.length) {
    const closes = idx.map((d) => d.close);
    const rising = closes[closes.length - 1] >= closes[0];
    window.Plotly.react($("#vni-chart", top), [{
      type: "scatter", mode: "lines", x: idx.map((d) => d.date), y: closes,
      line: { color: rising ? "#15803d" : "#b91c1c", width: 1.6 },
      fill: "tozeroy", fillcolor: rising ? "rgba(21,128,61,0.07)" : "rgba(185,28,28,0.07)",
      hovertemplate: "%{x}: %{y:,.2f}<extra></extra>",
    }], {
      height: 300, dragmode: false, margin: { l: 54, r: 12, t: 8, b: 28 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
      xaxis: { showgrid: false, tickfont: { size: 9 }, nticks: 8 },
      // Ranged around the actual band, not from zero -- an index that moves 10%
      // would otherwise render as a flat line against a 0-baseline axis.
      yaxis: {
        gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 },
        range: [Math.min(...closes) * 0.985, Math.max(...closes) * 1.015],
      },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });
  }

  const ratio = up / Math.max(down, 1);
  const rc = ratio >= 1.5 ? "var(--gain)" : ratio >= 0.8 ? "#b45309" : "var(--loss)";
  $("#ad-panel", top).innerHTML = `
    <div class="ad-ratio" style="color:${rc}">${ratio.toFixed(2)}
      <span class="ad-ratio-l">&nbsp;Tỷ lệ Tăng/Giảm</span></div>
    <div class="ad-bar">
      <div style="width:${up / total * 100}%;background:#15803d"></div>
      <div style="width:${flat / total * 100}%;background:#b45309"></div>
      <div style="width:${down / total * 100}%;background:#b91c1c"></div>
    </div>
    <div class="ad-legend">
      <span><b class="gain">▲ ${up}</b><span class="dimtxt"> Tăng</span></span>
      <span><b style="color:#b45309">— ${flat}</b><span class="dimtxt"> Đứng</span></span>
      <span><b class="loss">▼ ${down}</b><span class="dimtxt"> Giảm</span></span>
    </div>
    <div class="ad-total">trong ${withChg.length} mã</div>`;

  // ── 2. Market P/E & P/B vs its own history ───────────────────────
  const hist = await fetch("data/market_history.json").then((r) => r.json()).catch(() => []);
  if (hist.length > 3) {
    const c = el(`<div class="card"><h2 class="sec-h">Định giá Thị trường (P/E &amp; P/B) so với Lịch sử</h2>
      <div id="mkt-hist"></div>
      <div class="vb-note" id="mkt-hist-note"></div></div>`);
    root.appendChild(c);
    const x = hist.map((d) => d.quarter);
    window.Plotly.react($("#mkt-hist", c), [
      { type: "scatter", mode: "lines+markers", name: "P/E", x, y: hist.map((d) => d.pe),
        line: { color: "#2563eb", width: 1.8 }, marker: { size: 5 },
        hovertemplate: "%{x}: P/E %{y:.1f}×<extra></extra>" },
      { type: "scatter", mode: "lines+markers", name: "P/B", x, y: hist.map((d) => d.pb),
        yaxis: "y2", line: { color: "#ea580c", width: 1.8 }, marker: { size: 5 },
        hovertemplate: "%{x}: P/B %{y:.2f}×<extra></extra>" },
    ], {
      height: 320, dragmode: false, margin: { l: 52, r: 52, t: 26, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
      legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10 } },
      xaxis: { type: "category", showgrid: false, tickfont: { size: 9 }, tickangle: -45 },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 },
               title: { text: "P/E (×)", font: { size: 10 } } },
      // P/B lives on a different scale entirely; sharing one axis would flatten it.
      yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: { size: 9 },
                title: { text: "P/B (×)", font: { size: 10 } } },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });

    const pes = hist.map((d) => d.pe).filter((v) => F.isNum(v)).sort((a, b) => a - b);
    const curPe = hist[hist.length - 1].pe, medPe = pes[Math.floor(pes.length / 2)];
    if (F.isNum(curPe) && F.isNum(medPe)) {
      const rel = (curPe - medPe) / medPe * 100;
      $("#mkt-hist-note", c).innerHTML =
        `P/E thị trường hiện <b>${curPe.toFixed(1)}×</b> so với trung vị ${pes.length} quý là ` +
        `<b>${medPe.toFixed(1)}×</b> (${rel >= 0 ? "+" : ""}${rel.toFixed(0)}%). ` +
        (rel > 10 ? "Thị trường đang đắt hơn mặt bằng lịch sử."
          : rel < -10 ? "Thị trường đang rẻ hơn mặt bằng lịch sử."
          : "Thị trường ở vùng định giá quen thuộc.") +
        ` Trung vị giữa các mã, mỗi quý cần tối thiểu 30 mã có số liệu.`;
    }
  }

  // ── 3. Market-wide foreign net trading ───────────────────────────
  const ff = market.foreign || [];
  if (ff.length > 2) {
    const c = el(`<div class="card"><h2 class="sec-h">Giá trị Giao dịch ròng Nước ngoài</h2>
      <div id="ff-mkt"></div>
      <div class="vb-note">GTNN = giá trị giao dịch ròng của nhà đầu tư nước ngoài trên toàn thị trường.</div></div>`);
    root.appendChild(c);
    const y = ff.map((d) => d.net_val / 1e9);
    window.Plotly.react($("#ff-mkt", c), [{
      type: "bar",
      x: ff.map((d) => String(d.date).slice(5).split("-").reverse().join("/")), y,
      marker: { color: y.map((v) => (v >= 0 ? "#15803d" : "#b91c1c")) },
      hovertemplate: "%{x}: %{y:,.0f} tỷ<extra></extra>",
    }], {
      height: 300, dragmode: false, margin: { l: 60, r: 12, t: 8, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
      xaxis: { type: "category", showgrid: false, tickfont: { size: 9 } },
      yaxis: {
        gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, zeroline: true,
        title: { text: "Giá trị ròng (tỷ VND)", font: { size: 10 } },
      },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });
  }

  // ── 4. Movers. "Thanh khoản tốt" = drawn from the 20 most-traded names, as
  //       in the original, so a 7% jump on a barely-traded ticker can't top it.
  const liquid = [...withChg].filter((r) => F.isNum(r.vol)).sort((a, b) => b.vol - a.vol).slice(0, 20);
  const moversCard = (title, list, valFn) => {
    const c = el(`<div class="card mv-card"><h2 class="sec-h">${title}</h2>
      <table class="screen"><tbody></tbody></table></div>`);
    const tb = $("tbody", c);
    for (const r of list) {
      const v = valFn(r);
      const tr = el(`<tr><td><b>${r.ticker}</b></td>
        <td class="dim">${F.escapeHtml(r.sector || "")}</td>
        <td style="color:${v.c}">${v.t}</td>
        <td>${F.isNum(r.vol) ? (r.vol / 1e6).toFixed(2) + "M" : "—"}</td></tr>`);
      tr.onclick = () => selectTicker(r.ticker);
      tb.appendChild(tr);
    }
    return c;
  };
  const wrap = el(`<div class="mv-row"></div>`);
  wrap.appendChild(moversCard("Top 10 Tăng giá (thanh khoản tốt)",
    [...liquid].sort((a, b) => b.chg - a.chg).slice(0, 10),
    (r) => ({ t: F.pctSigned(r.chg * 100), c: "#15803d" })));
  wrap.appendChild(moversCard("Top 10 Giảm giá (thanh khoản tốt)",
    [...liquid].sort((a, b) => a.chg - b.chg).slice(0, 10),
    (r) => ({ t: F.pctSigned(r.chg * 100), c: "#b91c1c" })));
  wrap.appendChild(moversCard("Top 10 Khối lượng",
    [...withChg].filter((r) => F.isNum(r.vol)).sort((a, b) => b.vol - a.vol).slice(0, 10),
    (r) => ({ t: F.pctSigned(r.chg * 100), c: r.chg >= 0 ? "#15803d" : "#b91c1c" })));
  root.appendChild(wrap);

  // ── 5. Sector performance today ──────────────────────────────────
  const bySec = {};
  for (const r of withChg) { if (r.sector) (bySec[r.sector] ||= []).push(r.chg); }
  const perf = Object.entries(bySec)
    .map(([s, cs]) => [s, cs.reduce((a, b) => a + b, 0) / cs.length])
    .sort((a, b) => b[1] - a[1]);
  const perfCard = el(`<div class="card"><h2 class="sec-h">Hiệu suất theo Ngành</h2><div id="perf-chart"></div></div>`);
  root.appendChild(perfCard);
  window.Plotly.react($("#perf-chart", perfCard), [{
    type: "bar", orientation: "h",
    x: perf.map((p) => p[1]).reverse(), y: perf.map((p) => p[0]).reverse(),
    marker: { color: perf.map((p) => (p[1] >= 0 ? "#15803d" : "#b91c1c")).reverse() },
    hovertemplate: "%{y}: %{x:.2%}<extra></extra>",
  }], {
    height: Math.max(320, perf.length * 20), dragmode: false,
    margin: { l: 150, r: 20, t: 8, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
    xaxis: {
      tickformat: ".1%", gridcolor: "rgba(148,163,184,0.22)", zeroline: true,
      title: { text: "Thay đổi TB %", font: { size: 10 } },
    },
    yaxis: { tickfont: { size: 9 }, automargin: true },
  }, { displayModeBar: false, responsive: true });

  // ── 6. Today's market heatmap ────────────────────────────────────
  const heatRows = withChg.filter((r) => F.isNum(r.vol) && r.vol > 0);
  if (heatRows.length) {
    const hc = el(`<div class="card"><h2 class="sec-h">Bản đồ nhiệt Thị trường Hôm nay</h2>
      <div class="vb-note">Kích thước ô = khối lượng giao dịch; màu = thay đổi giá hôm nay.</div>
      <div id="mkt-heat"></div></div>`);
    root.appendChild(hc);
    const top120 = [...heatRows].sort((a, b) => b.vol - a.vol).slice(0, 120);
    const sectors = [...new Set(top120.map((r) => r.sector).filter(Boolean))];
    window.Plotly.react($("#mkt-heat", hc), [{
      type: "treemap",
      labels: [...sectors, ...top120.map((r) => r.ticker)],
      parents: [...sectors.map(() => ""), ...top120.map((r) => r.sector || "")],
      values: [...sectors.map(() => 0), ...top120.map((r) => r.vol)],
      text: [...sectors.map(() => ""), ...top120.map((r) => F.pctSigned(r.chg * 100))],
      texttemplate: "%{label}<br>%{text}",
      hovertemplate: "%{label} %{text}<extra></extra>",
      branchvalues: "remainder",
      marker: {
        colors: [...sectors.map(() => 0), ...top120.map((r) => Math.max(-0.07, Math.min(0.07, r.chg)))],
        colorscale: [[0, "#b91c1c"], [0.5, "#f1f5f9"], [1, "#15803d"]],
        cmin: -0.07, cmax: 0.07, line: { width: 1, color: "#fff" },
      },
      tiling: { pad: 2 },
    }], {
      height: 540, margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
    }, { displayModeBar: false, responsive: true });
  }
}

// ── macro view ──────────────────────────────────────────────────────
const MACRO_LABELS = {
  gdp_growth: "Tăng trưởng GDP (%)", cpi_yoy: "Lạm phát CPI (% YoY)",
  credit_growth_total: "Tăng trưởng tín dụng (%)", exchange_rate: "Tỷ giá USD/VND",
  lending_rate: "Lãi suất cho vay (%)", deposit_rate: "Lãi suất tiền gửi (%)",
  trade_balance: "Cán cân thương mại (tr USD)", fdi: "FDI (tr USD)",
  retail_sales_growth: "Tăng trưởng bán lẻ (%)", unemployment_rate: "Thất nghiệp (%)",
};
let macroBuilt = false;
async function renderMacro() {
  if (macroBuilt) return;
  macroBuilt = true;
  const root = $("#view-macro");
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const macro = await loadMacro();
  root.innerHTML = "";
  const card = el(`<div class="card"><h2 class="sec-h">Kinh tế vĩ mô</h2><div class="qgrid"></div></div>`);
  const grid = $(".qgrid", card);
  root.appendChild(card);
  const pending = [];
  for (const key of Object.keys(MACRO_LABELS)) {
    const series = (macro[key] || []).filter((d) => F.isNum(d.value));
    if (series.length < 2) continue;
    const box = el(`<div class="qchart"><div class="qtitle">${MACRO_LABELS[key]}</div><div></div></div>`);
    grid.appendChild(box);
    const canvas = box.lastElementChild;
    const x = series.map((d) => String(d.period).slice(0, 10));
    const y = series.map((d) => d.value);
    pending.push(() => window.Plotly.react(canvas, [{
      type: "scatter", mode: "lines", x, y, line: { color: "#2563eb", width: 1.5 },
      fill: "tozeroy", fillcolor: "rgba(37,99,235,0.06)",
      hovertemplate: "%{x}: %{y:,.2f}<extra></extra>",
    }], {
      height: 200, margin: { l: 48, r: 12, t: 8, b: 26 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "'Fira Code', monospace", size: 9, color: "#0a121d" },
      xaxis: { tickfont: { size: 8 }, nticks: 5, showgrid: false },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 8 } }, dragmode: false,
    }, { displayModeBar: false, responsive: true }));
  }
  pending.forEach((fn) => fn());
}

boot();

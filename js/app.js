import { loadCompanies, loadScreener, loadTicker, loadMeta } from "./data.js";
import { priceChart, priceVsValueChart } from "./charts.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR, SIGNAL_ORDER } from "./signals.js";
import { ratingColor } from "./ratings.js";
import { computeTTM } from "./ttm.js";
import { quarterlyCharts } from "./quarterly.js";
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
  const views = [["stock", "Phân tích cổ phiếu"], ["screen", "Sàng lọc"], ["sector", "Phân tích ngành"]];
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

  const chartWrap = el(`<div class="card"><div class="range-row" id="range-row"></div><div id="price-chart"></div></div>`);
  root.appendChild(chartWrap);
  buildRangeButtons($("#range-row", chartWrap), prices);
  priceChart($("#price-chart", chartWrap), prices, currentRange);

  const ttm = computeTTM(d.financials || []);
  root.appendChild(scorecard(co, v, ttm));
  root.appendChild(valuationSummary(co, v, d.model || {}, last));

  // Quarterly analysis charts (the "meat" rows) from the exported financials.
  // Appends itself to root, then renders (Plotly needs an attached node).
  quarterlyCharts(root, co, d.financials || []);

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
  const cells = [
    ["Vốn hóa (tỷ)", F.num(mcap, 0)],
    ["Vốn chủ (tỷ)", F.num(q ? q.equity : null, 0)],
    ["P/E", F.mult(v.pe)],
    ["EPS (VND)", q && F.isNum(q.eps) ? F.rawVND(q.eps) : "—"],
    ["P/B", F.mult(v.pb)],
    ["EV/EBITDA", F.mult(v.ev_ebitda)],
    ["KLTB 15D", F.num(vol15, 0)],
    ["Số CP (triệu)", F.num(shares, 0)],
  ];
  const grid = el(`<div class="metrics"></div>`);
  for (const [k, val] of cells)
    grid.appendChild(el(`<div class="metric"><div class="mk">${k}</div><div class="mv">${val}</div></div>`));
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

// ── valuation summary (sector-adjusted model + quality/signal) ──────
function valuationSummary(co, v, model, last) {
  const priceRaw = F.isNum(last.close) ? last.close * 1000 : null;
  // model.upside is a FRACTION (0.15 = +15%), already sector-adjusted and
  // winsorized by model_valuation.py -- unlike the raw dcf_estimate, which is
  // garbage for banks (VCB reads +715%).
  const upFrac = F.isNum(model.upside) ? model.upside : null;
  const q = computeQualityScore(v.roe, v.net_margin, v.profit_quality, v.fcf_margin, v.current_ratio, v.debt_to_equity);
  const sig = (upFrac != null) ? classifySignal(upFrac, q) : null;

  const mColor = upFrac == null ? "#5b6675" : upFrac >= 0 ? "#15803d" : "#b91c1c";
  const qColor = q >= 70 ? "#15803d" : q >= 50 ? "#b45309" : "#b91c1c";

  const card = el(`<div class="card"><h2 class="sec-h">Đánh giá tổng hợp</h2><div class="ev-cards"></div>
    <div class="ev-note">Mô hình định giá lấy trung bình các phương pháp (đã kẹp ngoại lai, điều chỉnh theo ngành) và điểm chất lượng nội bộ (ROE · biên LN · chất lượng LN · FCF · thanh khoản · nợ). Khi hai góc nhìn <b>mâu thuẫn nhau</b> là lúc đáng xem kỹ lại giả định.</div></div>`);
  const wrap = $(".ev-cards", card);
  wrap.appendChild(el(`<div class="ev-card">
    <div class="ev-t">Mô hình định giá</div>
    <div class="ev-m" style="color:${mColor}">${F.rawVND(model.price)}</div>
    <div class="ev-s">${upFrac == null ? "Thiếu dữ liệu" : F.pctSigned(upFrac * 100) + " so với thị giá " + F.rawVND(priceRaw)}</div></div>`));
  wrap.appendChild(el(`<div class="ev-card">
    <div class="ev-t">Điểm chất lượng</div>
    <div class="ev-m" style="color:${qColor}">${q.toFixed(0)}<span class="ev-u">/100</span></div>
    <div class="ev-s">${sig ? "Tín hiệu: <b style='color:" + (SIGNAL_COLOR[sig]) + "'>" + SIGNAL_VI[sig] + "</b>" : "—"}</div></div>`));
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
      priceChart(row.parentElement.querySelector("#price-chart"), prices, days);
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
  const card = el(`<div class="card"><h2 class="sec-h">Sàng lọc cổ phiếu</h2>
    <div class="filters">
      <label>Ngành <select id="f-sector"><option value="">Tất cả</option>${sectors.map((s) => `<option>${F.escapeHtml(s)}</option>`).join("")}</select></label>
      <label>Tín hiệu <select id="f-signal"><option value="">Tất cả</option>${SIGNAL_ORDER.map((s) => `<option value="${s}">${SIGNAL_VI[s]}</option>`).join("")}</select></label>
      <label>P/E ≤ <input id="f-pe" type="number" step="1" placeholder="—" /></label>
      <label>ROE ≥ <input id="f-roe" type="number" step="1" placeholder="%" /></label>
      <label>Upside ≥ <input id="f-up" type="number" step="5" placeholder="%" /></label>
      <button id="f-reset" class="range-btn">Xóa lọc</button>
      <span id="f-count" class="fcount"></span>
    </div>
    <table class="screen"><thead><tr>
      <th>Mã</th><th>Ngành</th><th>P/E</th><th>P/B</th><th>ROE</th>
      <th>Upside</th><th>Chất lượng</th><th>Tín hiệu</th></tr></thead><tbody></tbody></table></div>`);
  root.appendChild(card);
  const tb = $("tbody", card);

  const apply = () => {
    const sec = $("#f-sector", card).value;
    const sig = $("#f-signal", card).value;
    const maxPe = parseFloat($("#f-pe", card).value);
    const minRoe = parseFloat($("#f-roe", card).value);
    const minUp = parseFloat($("#f-up", card).value);
    const out = rows.filter((r) =>
      (!sec || r.sector === sec) &&
      (!sig || r.sig === sig) &&
      (isNaN(maxPe) || (F.isNum(r.pe) && r.pe <= maxPe)) &&
      (isNaN(minRoe) || (F.isNum(r.roe) && r.roe * 100 >= minRoe)) &&
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
  const agg = Object.entries(bySec).map(([sector, rs]) => ({
    sector, n: rs.length,
    pe: median(rs.map((r) => r.pe)),
    pb: median(rs.map((r) => r.pb)),
    roe: median(rs.map((r) => r.roe)),
    up: median(rs.map((r) => r.upFrac)),
    q: median(rs.map((r) => r.q)),
  })).sort((a, b) => (b.up ?? -1e9) - (a.up ?? -1e9));

  root.innerHTML = "";
  const treeCard = el(`<div class="card"><h2 class="sec-h">Phân tích ngành</h2>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Ô lớn = nhiều mã; màu xanh = định giá còn rẻ (upside trung vị dương), đỏ = đắt.</div>
    <div id="sec-tree"></div></div>`);
  root.appendChild(treeCard);
  window.Plotly.react($("#sec-tree", treeCard), [{
    type: "treemap",
    labels: agg.map((s) => s.sector),
    parents: agg.map(() => ""),
    values: agg.map((s) => s.n),
    text: agg.map((s) => (F.isNum(s.up) ? F.pctSigned(s.up * 100) : "—")),
    texttemplate: "%{label}<br>%{value} mã · %{text}",
    hovertemplate: "%{label}<br>%{value} mã<extra></extra>",
    marker: {
      colors: agg.map((s) => (F.isNum(s.up) ? Math.max(-0.5, Math.min(0.5, s.up)) : 0)),
      colorscale: [[0, "#b91c1c"], [0.5, "#f5f5f5"], [1, "#15803d"]], cmid: 0,
      line: { width: 1, color: "#fff" },
    },
    tiling: { pad: 2 },
  }], {
    height: 420, margin: { l: 0, r: 0, t: 0, b: 0 },
    paper_bgcolor: "rgba(0,0,0,0)",
    font: { family: "'Fira Code', monospace", size: 11, color: "#0a121d" },
  }, { displayModeBar: false, responsive: true });

  const tbl = el(`<div class="card"><h2 class="sec-h">Chỉ số trung vị theo ngành</h2>
    <table class="screen"><thead><tr>
      <th>Ngành</th><th>Số mã</th><th>P/E</th><th>P/B</th><th>ROE</th><th>Upside</th><th>Chất lượng</th>
    </tr></thead><tbody></tbody></table></div>`);
  const tb = $("tbody", tbl);
  for (const s of agg) {
    tb.appendChild(el(`<tr>
      <td class="dim">${F.escapeHtml(s.sector)}</td>
      <td>${s.n}</td><td>${F.mult(s.pe)}</td><td>${F.mult(s.pb)}</td><td>${F.pct(s.roe)}</td>
      <td style="color:${(s.up ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(s.up)}</td>
      <td>${F.isNum(s.q) ? s.q.toFixed(0) : "—"}</td></tr>`));
  }
  root.appendChild(tbl);
}

boot();

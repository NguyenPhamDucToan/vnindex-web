import { loadCompanies, loadScreener, loadTicker, loadMeta, loadCommodities } from "./data.js";
import { priceChart } from "./charts.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR, SIGNAL_ORDER } from "./signals.js";
import { ratingColor } from "./ratings.js";
import { computeTTM } from "./ttm.js";
import { quarterlyCharts, foreignSection } from "./quarterly.js";
import { valuationPanel, technicalPanel } from "./valuation-panel.js";
import { dupontSection, roicSection, peerSection, valuationBandSection } from "./sections.js";
import { renderCompare } from "./compare.js";
import { renderMacro } from "./macro.js";
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
  // The original ships five views; "Vĩ mô" is a sub-tab of Tổng quan Thị
  // trường there, not a top-level entry. "Danh mục" was our own addition and
  // the user asked for it to be hidden -- the view and its route still work
  // (#portfolio), it just isn't advertised in the nav.
  const views = [["stock", "Phân tích cổ phiếu"], ["screen", "Sàng lọc"],
    ["compare", "So sánh cổ phiếu"], ["sector", "Phân tích ngành"],
    ["market", "Tổng quan thị trường"]];
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
  // The screener's filters live in the sidebar, as they do in the original;
  // they only make sense while that view is on screen.
  const sf = $("#side-filters");
  if (sf) sf.classList.toggle("hidden", id !== "screen");
  if (id === "screen") renderScreener();
  if (id === "sector") renderSector();
  if (id === "portfolio") renderPortfolio();
  if (id === "market") renderMarket();
  if (id === "compare") renderCompareView();
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
  // Optional dataset: the commodity chart is skipped, not fatal, when absent.
  const commodities = await loadCommodities();

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
  // Identity, price and the metric grid share one row in the original; the
  // port had the price pushed to the far edge with the grid on a line below.
  const headRow = el(`<div class="head-row"></div>`);
  headRow.appendChild(header(co, last, prev, chg, chgPct));
  headRow.appendChild(metricsGrid(co, v, q, mcap, shares, vol15));
  root.appendChild(headRow);

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
  if (tp) { right.appendChild(tp); if (tp.renderGauge) tp.renderGauge(); }

  // These three live inside the left column in the original (col_chart), under
  // the price chart -- putting them full-width below the split left a tall gap
  // beside the valuation panel.
  const left = $(".split-l", split);
  const peers = await loadScreener().catch(() => null);
  const pc = peerSection(co, v, peers, (d.model || {}).upside);
  if (pc) { left.appendChild(pc); pc.renderChart(); }
  foreignSection(left, d.foreign || [], prices);
  valuationBandSection(left, d.financials || [], prices);

  // Order matches the original: the financial-report tabs come BEFORE the TTM
  // scorecard, and the projection / price-vs-value charts live inside the
  // report's third tab rather than as separate cards at the end.
  quarterlyCharts(root, co, d.financials || [], d.detail, prices, d.valuation_history,
                  d.model, (prices && prices.length) ? prices[prices.length - 1].close : null,
                  commodities);

  const ttm = computeTTM(d.financials || []);
  root.appendChild(scorecard(co, v, ttm));

  const dp = dupontSection(v);
  if (dp) root.appendChild(dp);
  const rw = roicSection(d.financials || [], d.model || {});
  if (rw) root.appendChild(rw);

  root.appendChild(valuationSummary(co, v, d.model || {}, d.analyst, last));
  newsEventsSection(root, d.news_events);
}

// "Tin tức & Sự kiện" — the original's last section on this view. Both the
// category badges and the left-border colours are the original's: a news item is
// classified by keywords in its title, an event by its VCI category code, and
// the border encodes recency so today's filings stand out from last month's.
const NEWS_CATS = [
  [["CỔ TỨC", "DIVIDEND", "CHI TRẢ", "CHỐT DANH SÁCH"], "Cổ tức", "#065f46", "#6ee7b7"],
  [["ĐHCĐ", "ĐẠI HỘI", "HỌP", "NGHỊ QUYẾT", "BIÊN BẢN"], "ĐHCĐ", "#4c1d95", "#c4b5fd"],
  [["GIAO DỊCH", "ĐĂNG KÝ MUA", "ĐĂNG KÝ BÁN", "NỘI BỘ", "CỔ ĐÔNG LỚN"], "Giao dịch", "#1e3a5f", "#60a5fa"],
  [["BÁO CÁO", "BCTC", "TÀI CHÍNH", "KIỂM TOÁN", "KẾT QUẢ KD", "DOANH THU", "LỢI NHUẬN"], "BCTC", "#422006", "#fcd34d"],
  [["PHÁT HÀNH", "TĂNG VỐN", "CHÀO BÁN", "ESOP"], "Phát hành", "#4a1942", "#f0abfc"],
  [["THÔNG BÁO", "ĐIỀU LỆ", "ĐĂNG KÝ KINH DOANH", "THAY ĐỔI"], "Thông báo", "#1c2f3c", "#94a3b8"],
];
const EVENT_CATS = {
  DIVIDEND:                  ["Cổ tức", "#fef3c7", "#92400e", "#f59e0b"],
  MAJOR_SHAREHOLDER_TRADING: ["Giao dịch NB", "#dbeafe", "#1d4ed8", "#3b82f6"],
  STOCK_ISSUANCE:            ["Phát hành", "#f5f3ff", "#6d28d9", "#a78bfa"],
  BONUS_SHARE:               ["Thưởng CP", "#fff7ed", "#c2410c", "#fb923c"],
  STOCK_LISTING:             ["Niêm yết", "#ecfdf5", "#065f46", "#10b981"],
  SHAREHOLDER_MEETING:       ["Họp ĐHCĐ", "#eef2ff", "#4338ca", "#818cf8"],
};

function newsBadge(title) {
  const t = (title || "").toUpperCase();
  for (const [keys, label, bg, fg] of NEWS_CATS) {
    if (keys.some((k) => t.includes(k))) return { label, bg, fg, border: fg };
  }
  return { label: null, bg: "#374151", fg: "#94a3b8", border: "#374151" };
}

function eventBadge(ev) {
  const byCode = EVENT_CATS[(ev.code || "").toUpperCase()];
  const cfg = byCode || (() => {
    // Older exports carry no code; fall back to the Vietnamese event name.
    const n = ((ev.name || "") + " " + (ev.title || "")).toUpperCase();
    const HINT = { DIVIDEND: "CỔ TỨC", MAJOR_SHAREHOLDER_TRADING: "GIAO DỊCH",
                   STOCK_ISSUANCE: "PHÁT HÀNH", BONUS_SHARE: "THƯỞNG",
                   STOCK_LISTING: "NIÊM YẾT", SHAREHOLDER_MEETING: "ĐẠI HỘI" };
    for (const [code, c] of Object.entries(EVENT_CATS)) {
      if (n.includes(HINT[code])) return c;
    }
    return ["Sự kiện", "#f1f5f9", "#475569", "#94a3b8"];
  })();
  return { label: cfg[0], bg: cfg[1], fg: cfg[2], border: cfg[3] };
}

// Recency wins over category for the border: today red, this week orange/blue,
// anything older keeps its category hue.
function recencyBorder(iso, fallback) {
  const d = new Date(String(iso).slice(0, 10));
  if (isNaN(d)) return fallback;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "#ef4444";
  if (days <= 3) return "#f97316";
  if (days <= 7) return "#3b82f6";
  return fallback;
}

function newsEventsSection(parent, ne) {
  const news = (ne && ne.news) || [], events = (ne && ne.events) || [];

  const relDate = (iso) => {
    const d = new Date(String(iso).slice(0, 10));
    if (isNaN(d)) return String(iso).slice(0, 10);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const stamp = String(iso).slice(8, 10) + "/" + String(iso).slice(5, 7) + "/" + String(iso).slice(0, 4);
    if (days <= 0) return `Hôm nay · ${stamp}`;
    if (days === 1) return `Hôm qua · ${stamp}`;
    if (days <= 7) return `${days} ngày trước · ${stamp}`;
    return stamp;
  };

  const card = el(`<div class="card"><h2 class="sec-h">Tin tức &amp; Sự kiện</h2>
    <div class="range-row ne-tabs"></div><div class="ne-list"></div></div>`);
  parent.appendChild(card);
  const list = card.querySelector(".ne-list");
  const tabs = card.querySelector(".ne-tabs");
  let active = (!news.length && events.length) ? "events" : "news";

  const draw = () => {
    list.innerHTML = "";
    const items = active === "news" ? news : events;
    if (!items.length) {
      list.innerHTML = `<div class="vb-note">${active === "news" ? "Không có tin tức gần đây." : "Không có sự kiện gần đây."}</div>`;
      return;
    }
    for (const it of items) {
      const b = active === "news" ? newsBadge(it.title) : eventBadge(it);
      const border = recencyBorder(it.date, b.border);
      const title = F.escapeHtml(it.title || it.name || "");
      const body = it.link
        ? `<a href="${F.escapeHtml(it.link)}" target="_blank" rel="noopener">${title}</a>` : title;
      const badge = b.label
        ? `<span class="ne-badge" style="background:${b.bg};color:${b.fg}">${b.label}</span>` : "";
      const meta = active === "news"
        ? [relDate(it.date), F.escapeHtml(it.source || "")].filter(Boolean).join(" · ")
        : [relDate(it.date), F.escapeHtml(it.name || "")].filter(Boolean).join(" · ");
      list.appendChild(el(`<div class="ne-item" style="border-left-color:${border}">
        <div class="ne-t">${badge}${body}</div><div class="ne-d">${meta}</div></div>`));
    }
  };
  for (const [key, label] of [["news", "📰 Tin tức"], ["events", "📅 Sự kiện công ty"]]) {
    const btn = el(`<button class="range-btn ${key === active ? "active" : ""}">${label}</button>`);
    btn.onclick = () => {
      active = key;
      tabs.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      draw();
    };
    tabs.appendChild(btn);
  }
  draw();
  return card;
}

// Price-header colour has FIVE states in the original, not three: a ceiling
// (tăng trần) and floor (sàn) print get their own hue, because on HOSE hitting
// the band is a materially different event from an ordinary up/down day. The
// band width is exchange-specific: HOSE 7%, HNX 10%, UPCOM 15%.
const PRICE_STATES = {
  ceiling: { c: "#7c3aed", bg: "#ede9fe", arrow: "▲" },
  up:      { c: "#16a34a", bg: "#dcfce7", arrow: "▲" },
  flat:    { c: "#b45309", bg: "#fef3c7", arrow: "—" },
  floor:   { c: "#0e7490", bg: "#ecfeff", arrow: "▼" },
  down:    { c: "#dc2626", bg: "#fee2e2", arrow: "▼" },
};

function priceState(exchange, close, prevClose) {
  if (!F.isNum(close) || !F.isNum(prevClose) || !prevClose) return PRICE_STATES.flat;
  const ex = String(exchange || "").toUpperCase();
  const band = ex.includes("HNX") ? 0.10 : (ex.includes("UPCOM") || ex.includes("UPC")) ? 0.15 : 0.07;
  const chg = close - prevClose;
  if (close >= prevClose * (1 + band) * 0.9995) return PRICE_STATES.ceiling;
  if (chg > 0) return PRICE_STATES.up;
  if (chg === 0) return PRICE_STATES.flat;
  if (close <= prevClose * (1 - band) * 1.0005) return PRICE_STATES.floor;
  return PRICE_STATES.down;
}

function header(co, last, prev, chg, chgPct) {
  const st = priceState(co.exchange, last.close, prev.close);
  const cls = (chg ?? 0) > 0 ? "gain" : (chg ?? 0) < 0 ? "loss" : "flat";
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
        <div class="sh-price" style="color:${st.c}">${F.priceVND(last.close)}</div>
        <div class="sh-chg">${chg == null ? "" :
          `<span class="sh-chgbadge" style="color:${st.c};background:${st.bg}">` +
          `${st.arrow} ${F.priceVND(Math.abs(chg))} (${F.pct(chgPct)})</span>`}</div>
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
// Each cell carries the original's hover card: the formula, one line on what
// the number means, and the three thresholds it is graded against. Without it
// the scorecard is a wall of figures with no way to ask "good or bad?".
function tipHtml(t) {
  if (!t || !t.f) return "";
  const e = (x) => F.escapeHtml(x || "");
  return `<div class="ttm-tooltip">
    <div class="tt-f">${e(t.f)}</div>
    <div class="tt-d">${e(t.d)}</div>
    <div class="tt-bands">
      <span><i style="background:#16a34a"></i>Tốt: ${e(t.g)}</span>
      <span><i style="background:#d97706"></i>Cảnh báo: ${e(t.w)}</span>
      <span><i style="background:#dc2626"></i>Nguy hiểm: ${e(t.b)}</span>
    </div><div class="ttm-tt-arrow"></div></div>`;
}

function scoreRow(title, cells) {
  const row = el(`<div class="sc-block"><div class="sc-title">${title}</div><div class="sc-cells"></div></div>`);
  const wrap = $(".sc-cells", row);
  cells.forEach((c, i) => {
    const sep = i < cells.length - 1 ? "border-right:1px solid rgba(148,163,184,0.25);" : "";
    wrap.appendChild(el(`<div class="sc-cell ttm-cell" style="${sep}">
      ${tipHtml(c.tip)}
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
    { label: isBank ? "Thu nhập lãi / Tổng TN" : "Biên LN gộp", value: F.pct(v.gross_margin), color: R(v.gross_margin, 0.25, 0.15),
      tip: { f: isBank ? "Thu nhập lãi thuần / Tổng thu nhập hoạt động" : "Lợi nhuận gộp / Doanh thu",
             d: isBank ? "Bao nhiêu phần thu nhập đến từ cho vay. Thấp hơn nghĩa là nguồn thu đa dạng hơn (phí, ngoại hối, đầu tư)"
                       : "Đo hiệu quả sản xuất cốt lõi trước chi phí vận hành",
             g: "≥ 25%", w: "15 – 25%", b: "< 15%" } },
    { label: isBank ? "Biên trước dự phòng" : "Biên hoạt động", value: F.pct(v.operating_margin), color: R(v.operating_margin, 0.15, 0.05),
      tip: { f: isBank ? "Lợi nhuận trước dự phòng (PPOP) / Tổng thu nhập hoạt động" : "EBIT / Doanh thu",
             d: isBank ? "Lãi còn lại sau chi phí vận hành nhưng trước khi trích lập dự phòng nợ xấu"
                       : "Lợi nhuận sau chi phí bán hàng & quản lý, trước lãi vay và thuế",
             g: "≥ 15%", w: "5 – 15%", b: "< 5%" } },
    { label: "Biên LN ròng", value: F.pct(v.net_margin), color: R(v.net_margin, 0.10, 0.05) , tip: { f: "Lợi nhuận sau thuế / Doanh thu", d: "Tỷ suất sinh lời thực tế cuối cùng giữ lại cho cổ đông", g: "≥ 10%", w: "5 – 10%", b: "< 5%" } },
    { label: "ROE", value: F.pct(v.roe), color: R(v.roe, 0.15, 0.10) , tip: { f: "Lợi nhuận ròng / Vốn chủ sở hữu", d: "Đo mức sinh lời trên đồng vốn cổ đông bỏ ra", g: "≥ 15%", w: "10 – 15%", b: "< 10%" } },
    // Banks earn 1-2% on a deposit-funded asset base by design; scoring against
    // the 8%/5% industrial band would paint every bank red.
    { label: "ROA", value: F.pct(v.roa), color: isBank ? R(v.roa, 0.015, 0.010) : R(v.roa, 0.08, 0.05) , tip: { f: "Lợi nhuận ròng / Tổng tài sản", d: "Đo hiệu quả sử dụng toàn bộ tài sản", g: "≥ 8%", w: "5 – 8%", b: "< 5%" } },
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
      { label: "Biên lãi thuần (NIM)", value: F.pct(nim), color: R(nim, 0.030, 0.020) , tip: { f: "Thu nhập lãi thuần / Tổng tài sản", d: "Chênh lệch lãi cho vay và lãi huy động, tính trên toàn bộ tài sản. Đây là nguồn sống chính của ngân hàng", g: "≥ 3%", w: "2 – 3%", b: "< 2%" } },
      { label: "Chi phí / Thu nhập (CIR)", value: F.pct(cir), color: R(cir, 0.35, 0.50, false) , tip: { f: "Chi phí hoạt động / Tổng thu nhập hoạt động", d: "Tốn bao nhiêu đồng chi phí để tạo ra 100 đồng thu nhập. Càng thấp càng vận hành hiệu quả", g: "≤ 35%", w: "35 – 50%", b: "> 50%" } },
      { label: "Cho vay / Tiền gửi", value: F.pct(ldr), color: R(ldr, 1.00, 1.20, false) , tip: { f: "Dư nợ cho vay khách hàng / Tiền gửi khách hàng", d: "Cho vay ra bao nhiêu so với tiền huy động được. Lưu ý: đây không phải LDR theo quy định của NHNN", g: "≤ 100%", w: "100 – 120%", b: "> 120%" } },
      { label: "Chi phí tín dụng", value: F.pct(cc), color: R(cc, 0.010, 0.020, false) , tip: { f: "Chi phí dự phòng rủi ro / Dư nợ cho vay", d: "Mỗi năm phải trích lập dự phòng bao nhiêu phần trăm dư nợ. Tăng lên là dấu hiệu chất lượng tài sản đi xuống", g: "≤ 1%", w: "1 – 2%", b: "> 2%" } },
      { label: "Vốn chủ / Tổng tài sản", value: F.pct(ea), color: R(ea, 0.09, 0.06) , tip: { f: "Vốn chủ sở hữu / Tổng tài sản", d: "Đệm vốn tự có chống đỡ rủi ro. Mỏng thì chịu lỗ kém hơn khi nợ xấu tăng", g: "≥ 9%", w: "6 – 9%", b: "< 6%" } },
    ]));
    const lev = div(ttm.total_assets, ttm.equity);
    const dep = div(ttm.payables, ttm.total_assets);
    card.appendChild(scoreRow("CƠ CẤU VỐN & NGUỒN VỐN", [
      { label: "Đòn bẩy (TS / VCSH)", value: F.mult(lev), color: R(lev, 12, 15, false) , tip: { f: "Tổng tài sản / Vốn chủ sở hữu", d: "Đòn bẩy thật của ngân hàng. Đây mới là con số phản ánh rủi ro, không phải D/E", g: "≤ 12x", w: "12 – 15x", b: "> 15x" } },
      { label: "Tiền gửi KH / Tổng TS", value: F.pct(dep), color: R(dep, 0.60, 0.45) , tip: { f: "Tiền gửi khách hàng / Tổng tài sản", d: "Bao nhiêu phần nguồn vốn đến từ tiền gửi. Cao thì nguồn vốn ổn định và rẻ", g: "≥ 60%", w: "45 – 60%", b: "< 45%" } },
      { label: "Vay liên NH / Vốn chủ", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 2, 4, false) , tip: { f: "Vay liên ngân hàng & NHNN / Vốn chủ sở hữu", d: "Mức phụ thuộc nguồn vốn bán buôn ngoài tiền gửi. Nguồn này rút nhanh hơn tiền gửi", g: "≤ 2x", w: "2 – 4x", b: "> 4x" } },
    ]));
  } else if (isSec && ttm) {
    // Brokers keep D/E (leverage is real risk) but drop FCF/profit-quality --
    // they run structurally negative OCF from growing the margin book.
    const ea = div(ttm.equity, ttm.total_assets);
    card.appendChild(scoreRow("THANH KHOẢN", [
      { label: "Current ratio", value: F.mult(v.current_ratio), color: R(v.current_ratio, 2, 1) , tip: { f: "Tài sản ngắn hạn / Nợ ngắn hạn", d: "Khả năng trả nợ ngắn hạn bằng tài sản lưu động", g: "≥ 2x", w: "1 – 2x", b: "< 1x" } },
      { label: "Quick ratio", value: F.mult(v.quick_ratio), color: R(v.quick_ratio, 1, 0.5) , tip: { f: "(Tài sản ngắn hạn − Hàng tồn kho) / Nợ ngắn hạn", d: "Loại trừ hàng tồn kho để đo thanh khoản thực tế hơn", g: "≥ 1x", w: "0.5 – 1x", b: "< 0.5x" } },
      { label: "OCF / Nợ ngắn hạn", value: F.mult(v.ocf_to_current_liab), color: R(v.ocf_to_current_liab, 0.4, 0.2) , tip: { f: "Dòng tiền hoạt động / Nợ ngắn hạn", d: "Khả năng trả nợ từ tiền kinh doanh tạo ra", g: "≥ 0.4x", w: "0.2 – 0.4x", b: "< 0.2x" } },
    ]));
    card.appendChild(scoreRow("ĐÒN BẨY & AN TOÀN VỐN", [
      { label: "Nợ / Vốn chủ (D/E)", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 1, 2, false) , tip: { f: "Tổng nợ vay / Vốn chủ sở hữu", d: "Mức độ đòn bẩy tài chính", g: "≤ 1x", w: "1 – 2x", b: "> 2x" } },
      { label: "Nợ / Tổng tài sản", value: F.pct(v.debt_to_assets), color: R(v.debt_to_assets, 0.30, 0.60, false) , tip: { f: "Tổng nợ vay / Tổng tài sản", d: "Tỷ trọng nợ trong cơ cấu vốn", g: "≤ 30%", w: "30 – 60%", b: "> 60%" } },
      { label: "Vốn chủ / Tổng tài sản", value: F.pct(ea), color: R(ea, 0.40, 0.25) , tip: { f: "Vốn chủ sở hữu / Tổng tài sản", d: "Đệm vốn tự có chống đỡ rủi ro. Mỏng thì chịu lỗ kém hơn khi nợ xấu tăng", g: "≥ 9%", w: "6 – 9%", b: "< 6%" } },
    ]));
  } else {
    card.appendChild(scoreRow("THANH KHOẢN", [
      { label: "Current ratio", value: F.mult(v.current_ratio), color: R(v.current_ratio, 2, 1) , tip: { f: "Tài sản ngắn hạn / Nợ ngắn hạn", d: "Khả năng trả nợ ngắn hạn bằng tài sản lưu động", g: "≥ 2x", w: "1 – 2x", b: "< 1x" } },
      { label: "Quick ratio", value: F.mult(v.quick_ratio), color: R(v.quick_ratio, 1, 0.5) , tip: { f: "(Tài sản ngắn hạn − Hàng tồn kho) / Nợ ngắn hạn", d: "Loại trừ hàng tồn kho để đo thanh khoản thực tế hơn", g: "≥ 1x", w: "0.5 – 1x", b: "< 0.5x" } },
      { label: "OCF / Nợ ngắn hạn", value: F.mult(v.ocf_to_current_liab), color: R(v.ocf_to_current_liab, 0.4, 0.2) , tip: { f: "Dòng tiền hoạt động / Nợ ngắn hạn", d: "Khả năng trả nợ từ tiền kinh doanh tạo ra", g: "≥ 0.4x", w: "0.2 – 0.4x", b: "< 0.2x" } },
      { label: "Đòn bẩy (TS/VCSH)", value: F.mult(v.financial_leverage), color: R(v.financial_leverage, 2.5, 4, false) , tip: { f: "Tổng tài sản / Vốn chủ sở hữu", d: "Mỗi đồng vốn chủ đang gánh bao nhiêu đồng tài sản", g: "≤ 2.5x", w: "2.5 – 4x", b: "> 4x" } },
    ]));
    card.appendChild(scoreRow("ĐÒN BẨY & DÒNG TIỀN", [
      { label: "Nợ / Vốn chủ (D/E)", value: F.mult(v.debt_to_equity), color: R(v.debt_to_equity, 1, 2, false) , tip: { f: "Tổng nợ vay / Vốn chủ sở hữu", d: "Mức độ đòn bẩy tài chính", g: "≤ 1x", w: "1 – 2x", b: "> 2x" } },
      { label: "Nợ / Tổng tài sản", value: F.pct(v.debt_to_assets), color: R(v.debt_to_assets, 0.30, 0.60, false) , tip: { f: "Tổng nợ vay / Tổng tài sản", d: "Tỷ trọng nợ trong cơ cấu vốn", g: "≤ 30%", w: "30 – 60%", b: "> 60%" } },
      { label: "Biên FCF", value: F.pct(v.fcf_margin), color: R(v.fcf_margin, 0.10, 0.0) , tip: { f: "Dòng tiền tự do (FCF) / Doanh thu", d: "Khả năng tạo tiền thực sau đầu tư CAPEX", g: "≥ 10%", w: "0 – 10%", b: "< 0%" } },
      { label: "Chất lượng LN", value: F.mult(v.profit_quality), color: R(v.profit_quality, 1, 0.8) , tip: { f: "Dòng tiền hoạt động / Lợi nhuận ròng", d: "> 1x: lợi nhuận được bảo chứng bằng tiền mặt thực", g: "≥ 1x", w: "0.8 – 1x", b: "< 0.8x" } },
    ]));
    // Property developers hold years of project inventory by design, so the
    // DIO/CCC bands widen for them.
    const dioGood = isRE ? 1095 : 50, dioWarn = isRE ? 1825 : 100;
    const cccGood = isRE ? 1095 : 50, cccWarn = isRE ? 1825 : 90;
    const cic = v.cash_interest_coverage;
    card.appendChild(scoreRow("VÒNG QUAY VỐN & AN TOÀN NỢ", [
      { label: "Chu kỳ tiền mặt (CCC)", value: F.days(v.ccc), color: R(v.ccc, cccGood, cccWarn, false) , tip: { f: "Số ngày thu tiền + tồn kho − số ngày trả người bán", d: "Tiền bị kẹt trong vòng quay kinh doanh bao lâu trước khi quay về. Càng ngắn càng tốt", g: "≤ 50 ngày", w: "50 – 90 ngày", b: "> 90 ngày" } },
      { label: "Ngày thu tiền (DSO)", value: F.days(v.dso), color: R(v.dso, 30, 60, false) , tip: { f: "Phải thu × 365 / Doanh thu", d: "Bán xong bao lâu mới thu được tiền. Tăng dần qua các quý = khách hàng trả chậm hơn", g: "≤ 30 ngày", w: "30 – 60 ngày", b: "> 60 ngày" } },
      { label: "Ngày tồn kho (DIO)", value: F.days(v.dio), color: R(v.dio, dioGood, dioWarn, false) , tip: { f: "Hàng tồn kho × 365 / Giá vốn", d: "Hàng nằm kho bao lâu mới bán được. Phình lên = hàng khó tiêu thụ", g: "≤ 50 ngày", w: "50 – 100 ngày", b: "> 100 ngày" } },
      { label: "Tiền mặt trả lãi vay", value: F.isNum(cic) && cic > 100 ? "Không vay nợ" : F.mult(cic), color: F.isNum(cic) && cic > 100 ? "#16a34a" : R(cic, 5, 3) , tip: { f: "Dòng tiền hoạt động / Chi phí lãi vay", d: "Tiền thật kiếm được gấp bao nhiêu lần tiền lãi phải trả. Trên 100x nghĩa là gần như không vay", g: "≥ 5x", w: "3 – 5x", b: "< 3x" } },
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
const WL_KEY = "vnindex.watchlist";
const loadWL = () => {
  // A private window or cleared site data makes this throw; an empty
  // watchlist is the right answer there, not a broken view.
  try { return new Set(JSON.parse(localStorage.getItem(WL_KEY) || "[]")); }
  catch { return new Set(); }
};
const saveWL = (set) => {
  try { localStorage.setItem(WL_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
};

// Sliders, ranges and steps copied from the original's sidebar.
const SCREEN_FILTERS = [
  ["f-roe", "ROE tối thiểu (%)", -50, 50, 5, -50],
  ["f-nm", "Biên LN ròng tối thiểu (%)", -50, 50, 1, -50],
  ["f-pb", "Max P/B (×)", 0, 10, 0.1, 10],
  ["f-qs", "Quality tối thiểu", 0, 100, 5, 0],
  ["f-de", "D/E tối đa (x)", 0, 30, 0.5, 30],
  ["f-pe", "Max P/E (×)", 0, 100, 1, 100],
  ["f-up", "Avg Upside tối thiểu (%)", -1000, 200, 50, -1000],
];

const SORT_OPTIONS = [
  ["Tín hiệu (Strong Buy trước)", (a, b) => SIGNAL_ORDER.indexOf(a.sig) - SIGNAL_ORDER.indexOf(b.sig) || b.q - a.q],
  ["Tín hiệu (Strong Sell trước)", (a, b) => SIGNAL_ORDER.indexOf(b.sig) - SIGNAL_ORDER.indexOf(a.sig) || b.q - a.q],
  ["Upside (tốt nhất trước)", (a, b) => (b.upFrac ?? -9e9) - (a.upFrac ?? -9e9)],
  ["Quality (tốt nhất trước)", (a, b) => b.q - a.q],
  ["ROE (tốt nhất trước)", (a, b) => (b.roe ?? -9e9) - (a.roe ?? -9e9)],
  ["Biên LN ròng (tốt nhất trước)", (a, b) => (b.net_margin ?? -9e9) - (a.net_margin ?? -9e9)],
  ["Mã (A-Z)", (a, b) => a.ticker.localeCompare(b.ticker)],
];

async function renderScreener() {
  if (screenerBuilt) return;
  screenerBuilt = true;
  const root = $("#view-screen");
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const rows = await enrichScreener();
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const wl = loadWL();

  // ── sidebar filter panel (the original keeps these in the sidebar) ──
  let side = $("#side-filters");
  if (!side) {
    side = el(`<div id="side-filters" class="side-filters"></div>`);
    $("#nav").after(side);
  }
  side.innerHTML = `
    <div class="sf-h">Filters</div>
    <label class="sf-l">Ngành
      <select id="f-sector" multiple size="6">${sectors.map((x) =>
        `<option>${F.escapeHtml(x)}</option>`).join("")}</select></label>
    <label class="sf-l">Lọc theo Tín hiệu
      <select id="f-signal" multiple size="7">${SIGNAL_ORDER.map((x) =>
        `<option value="${x}">${SIGNAL_VI[x]}</option>`).join("")}</select></label>
    ${SCREEN_FILTERS.map(([id, label, lo, hi, step, def]) => `
      <label class="sf-l">${label} <span class="sf-v" id="${id}-v">${def}</span>
        <input id="${id}" type="range" min="${lo}" max="${hi}" step="${step}" value="${def}" /></label>`).join("")}
    <label class="sf-c"><input id="f-pinned" type="checkbox" /> Chỉ Theo dõi</label>
    <label class="sf-l">Sắp xếp theo
      <select id="f-sort">${SORT_OPTIONS.map(([n], i) =>
        `<option value="${i}">${n}</option>`).join("")}</select></label>
    <button id="f-reset" class="range-btn sf-reset">Xóa lọc</button>`;

  root.innerHTML = "";
  // On a phone the sidebar stacks above the content, so nine filters push the
  // table off the first two screens. Collapse them behind a toggle there; on
  // desktop the button is hidden and the panel is always open.
  const filtToggle = el(`<button class="range-btn sf-toggle">Bộ lọc ▾</button>`);
  filtToggle.onclick = () => {
    const open = side.classList.toggle("sf-open");
    filtToggle.textContent = open ? "Bộ lọc ▴" : "Bộ lọc ▾";
  };
  root.appendChild(filtToggle);
  root.appendChild(el(`<div class="range-row sc-tabs"></div>`));
  root.appendChild(el(`<h2 class="view-title" id="sc-title">Lọc cổ phiếu</h2>`));

  const card = el(`<div class="card">
    <div class="sig-counts" id="sig-counts"></div>
    <div class="sc-bar"><span id="f-count" class="fcount"></span></div>
    <div class="ta-scroll"><table class="screen screen-wide"><thead><tr>
      <th>★</th><th>Mã</th><th>Tín hiệu</th><th>Ngành</th><th>Giá (VND)</th><th>Avg Estimate</th>
      <th>Avg Upside</th><th>DCF Estimate</th><th>FCFE Estimate</th><th>Upside</th>
      <th>Quality</th><th>Graham Number</th><th>P/E</th><th>P/B</th><th>Biên LN ròng</th>
    </tr></thead><tbody></tbody></table></div></div>`);
  root.appendChild(card);
  const tb = $("tbody", card);

  const counts = $("#sig-counts", card);
  for (const sg of SIGNAL_ORDER) {
    const n = rows.filter((r) => r.sig === sg).length;
    const b = el(`<button class="sig-c" data-sig="${sg}" style="border-top-color:${SIGNAL_COLOR[sg]}">
      <div class="sig-n">${n}</div><div class="sig-l">${SIGNAL_VI[sg]}</div></button>`);
    b.onclick = () => {
      const sel = $("#f-signal");
      const on = [...sel.options].filter((o) => o.selected).map((o) => o.value);
      const only = on.length === 1 && on[0] === sg;
      for (const o of sel.options) o.selected = !only && o.value === sg;
      apply();
    };
    counts.appendChild(b);
  }

  const multi = (id) => [...$(id).options].filter((o) => o.selected).map((o) => o.value);
  const slider = (id) => parseFloat($(id).value);

  function apply() {
    for (const [id] of SCREEN_FILTERS) $(`#${id}-v`).textContent = $(`#${id}`).value;
    const secs = multi("#f-sector"), sigs = multi("#f-signal");
    const minRoe = slider("#f-roe"), minNm = slider("#f-nm"), maxPb = slider("#f-pb");
    const minQs = slider("#f-qs"), maxDe = slider("#f-de"), maxPe = slider("#f-pe");
    const minUp = slider("#f-up"), pinned = $("#f-pinned").checked;
    const watchOnly = pinned || currentScTab === "Theo dõi";

    let out = rows.filter((r) =>
      (!secs.length || secs.includes(r.sector)) &&
      (!sigs.length || sigs.includes(r.sig)) &&
      (!watchOnly || wl.has(r.ticker)) &&
      (F.isNum(r.roe) ? r.roe * 100 >= minRoe : minRoe <= -50) &&
      (F.isNum(r.net_margin) ? r.net_margin * 100 >= minNm : minNm <= -50) &&
      (F.isNum(r.pb) ? r.pb <= maxPb : maxPb >= 10) &&
      (F.isNum(r.q) ? r.q >= minQs : minQs <= 0) &&
      (F.isNum(r.debt_to_equity) ? r.debt_to_equity <= maxDe : maxDe >= 30) &&
      (F.isNum(r.pe) ? r.pe <= maxPe : maxPe >= 100) &&
      (F.isNum(r.upFrac) ? r.upFrac * 100 >= minUp : minUp <= -1000));
    out = out.slice().sort(SORT_OPTIONS[parseInt($("#f-sort").value, 10)][1]);

    tb.innerHTML = "";
    for (const r of out) {
      const tr = el(`<tr>
        <td class="wl-cell"><button class="wl-star ${wl.has(r.ticker) ? "on" : ""}" title="Theo dõi">${wl.has(r.ticker) ? "★" : "☆"}</button></td>
        <td><b>${r.ticker}</b></td>
        <td>${r.sig ? `<span style="color:${SIGNAL_COLOR[r.sig]}">${SIGNAL_VI[r.sig]}</span>` : "—"}</td>
        <td class="dim">${F.escapeHtml(r.sector || "")}</td>
        <td>${F.priceVND(r.close)}</td>
        <td>${F.rawVND(r.avg_intrinsic_value)}</td>
        <td style="color:${(r.upFrac ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(r.upFrac)}</td>
        <td>${F.rawVND(r.dcf_estimate)}</td>
        <td>${F.rawVND(r.fcfe_estimate)}</td>
        <td style="color:${(r.upside_pct ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(r.upside_pct)}</td>
        <td>${r.q.toFixed(0)}</td>
        <td>${F.rawVND(r.graham_number)}</td>
        <td>${F.mult(r.pe)}</td><td>${F.mult(r.pb)}</td>
        <td>${F.pct(r.net_margin)}</td></tr>`);
      tr.querySelector(".wl-star").onclick = (ev) => {
        ev.stopPropagation();
        if (wl.has(r.ticker)) wl.delete(r.ticker); else wl.add(r.ticker);
        saveWL(wl);
        apply();
      };
      tr.onclick = () => selectTicker(r.ticker);
      tb.appendChild(tr);
    }
    $("#f-count", card).textContent = `${out.length} / ${rows.length} mã`;
  }

  // ── the original's two tabs ────────────────────────────────────
  let currentScTab = "Lọc cổ phiếu";
  const tabRow = $(".sc-tabs", root);
  for (const name of ["Lọc cổ phiếu", "Theo dõi"]) {
    const btn = el(`<button class="range-btn ${name === currentScTab ? "active" : ""}">${name}</button>`);
    btn.onclick = () => {
      currentScTab = name;
      tabRow.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("#sc-title", root).textContent = name === "Theo dõi" ? "Lọc & Theo dõi" : "Lọc cổ phiếu";
      apply();
    };
    tabRow.appendChild(btn);
  }

  side.querySelectorAll("select, input").forEach((c) => c.addEventListener("input", apply));
  $("#f-reset").onclick = () => {
    for (const sel of ["#f-sector", "#f-signal"])
      for (const o of $(sel).options) o.selected = false;
    for (const [id, , , , , def] of SCREEN_FILTERS) $(`#${id}`).value = def;
    $("#f-pinned").checked = false;
    $("#f-sort").value = "0";
    apply();
  };
  apply();

  screenerAnalytics(root, rows);
}

// Analytics that sit under the screener table in the original: signal
// distribution, opportunities by sector, quality-vs-upside scatter, the upside
// histogram, and the historical signal backtest.
function screenerAnalytics(root, rows) {
  const P = { family: "Fira Code, monospace", size: 10, color: "#0a121d" };
  const GRID = "rgba(148,163,184,0.22)";
  const pend = [];
  const card = (title, id, note = "") => {
    const c = el(`<div class="card"><h2 class="sec-h">${title}</h2>${note}<div id="${id}"></div></div>`);
    root.appendChild(c);
    return c;
  };

  // ── signal distribution donut ───────────────────────────────────
  const counts = SIGNAL_ORDER.map((s) => rows.filter((r) => r.sig === s).length);
  const dc = card("Phân bố Tín hiệu", "sc-donut");
  pend.push(() => window.Plotly.react(dc.querySelector("#sc-donut"), [{
    type: "pie", hole: 0.55, labels: SIGNAL_ORDER.map((s) => SIGNAL_VI[s]), values: counts,
    marker: { colors: SIGNAL_ORDER.map((s) => SIGNAL_COLOR[s]) },
    textinfo: "label+percent", textposition: "outside",
    hovertemplate: "%{label}: %{value} mã (%{percent})<extra></extra>",
  }], {
    height: 380, margin: { l: 20, r: 20, t: 20, b: 20 }, showlegend: false,
    paper_bgcolor: "rgba(0,0,0,0)", font: P,
  }, { displayModeBar: false, responsive: true }));

  // ── buy opportunities by sector ─────────────────────────────────
  const BUYS = ["Strong Buy", "Buy"];
  const bySec = {};
  for (const r of rows) {
    if (!r.sector || !BUYS.includes(r.sig)) continue;
    (bySec[r.sector] ||= { "Strong Buy": 0, "Buy": 0 })[r.sig]++;
  }
  const secs = Object.entries(bySec)
    .sort((a, b) => (b[1]["Strong Buy"] + b[1]["Buy"]) - (a[1]["Strong Buy"] + a[1]["Buy"]))
    .slice(0, 18);
  if (secs.length) {
    const oc = card("Cơ hội theo Ngành", "sc-opps",
      `<div class="vb-note">Số mã đang ở tín hiệu Mua / Mua mạnh trong mỗi ngành.</div>`);
    pend.push(() => window.Plotly.react(oc.querySelector("#sc-opps"), BUYS.map((s) => ({
      type: "bar", orientation: "h", name: SIGNAL_VI[s],
      y: secs.map((x) => x[0]).reverse(), x: secs.map((x) => x[1][s]).reverse(),
      marker: { color: SIGNAL_COLOR[s] },
      hovertemplate: "%{y} · " + SIGNAL_VI[s] + ": %{x} mã<extra></extra>",
    })), {
      height: Math.max(320, secs.length * 24), barmode: "stack", dragmode: false,
      margin: { l: 150, r: 20, t: 30, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
      legend: { orientation: "h", y: 1.06, x: 0, font: { size: 10 } },
      xaxis: { gridcolor: GRID, tickfont: { size: 9 } },
      yaxis: { tickfont: { size: 9 }, automargin: true },
    }, { displayModeBar: false, responsive: true }));
  }

  // ── quality vs upside, coloured by signal ───────────────────────
  const qc = card("Quality vs Avg Upside (tất cả mã đã lọc)", "sc-scatter",
    `<div class="vb-note">Góc trên-phải = chất lượng cao và còn rẻ. Đường kẻ chia tại upside 0% và quality 50.</div>`);
  const traces = SIGNAL_ORDER.map((s) => {
    const pts = rows.filter((r) => r.sig === s && F.isNum(r.upFrac) && F.isNum(r.q));
    return {
      type: "scatter", mode: "markers", name: SIGNAL_VI[s],
      x: pts.map((r) => Math.max(-100, Math.min(300, r.upFrac * 100))),
      y: pts.map((r) => r.q), text: pts.map((r) => r.ticker),
      marker: { size: 8, color: SIGNAL_COLOR[s], opacity: 0.75 },
      hovertemplate: "%{text}<br>Upside %{x:.0f}% · Quality %{y:.0f}<extra></extra>",
    };
  }).filter((t) => t.x.length);
  pend.push(() => window.Plotly.react(qc.querySelector("#sc-scatter"), traces, {
    height: 460, dragmode: false, margin: { l: 54, r: 14, t: 10, b: 40 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
    legend: { font: { size: 9 } },
    xaxis: { title: { text: "Avg Upside %", font: { size: 10 } }, gridcolor: GRID, zeroline: true, ticksuffix: "%" },
    yaxis: { title: { text: "Quality Score", font: { size: 10 } }, gridcolor: GRID, range: [0, 100] },
    shapes: [
      { type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1, line: { color: "#cbd5e1", width: 1, dash: "dot" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: 50, y1: 50, line: { color: "#cbd5e1", width: 1, dash: "dot" } },
    ],
  }, { displayModeBar: false, responsive: true }));

  // ── upside distribution ─────────────────────────────────────────
  const ups = rows.map((r) => r.upFrac).filter(F.isNum).map((v) => Math.max(-100, Math.min(300, v * 100)));
  if (ups.length > 10) {
    const hc = card("Phân bố Avg Upside", "sc-hist");
    pend.push(() => window.Plotly.react(hc.querySelector("#sc-hist"), [{
      type: "histogram", x: ups, nbinsx: 40, marker: { color: "#5b9bd5" },
      hovertemplate: "%{x}%: %{y} mã<extra></extra>",
    }], {
      height: 320, dragmode: false, margin: { l: 50, r: 14, t: 12, b: 36 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
      xaxis: { title: { text: "Avg Upside %", font: { size: 10 } }, gridcolor: GRID, ticksuffix: "%" },
      yaxis: { title: { text: "Số mã", font: { size: 10 } }, gridcolor: GRID },
      shapes: [{ type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1, line: { color: "#b91c1c", width: 1.5, dash: "dot" } }],
    }, { displayModeBar: false, responsive: true }));
  }

  // ── historical signal performance (backtest) ────────────────────
  fetch("data/backtest.json").then((r) => r.json()).then((bt) => {
    if (!Array.isArray(bt) || !bt.length) return;
    const bc = card("Hiệu quả tín hiệu lịch sử (Backtest 2020–2025)", "sc-bt",
      `<div class="vb-note">Lợi nhuận trung bình sau 1 năm kể từ khi tín hiệu xuất hiện, tính trên toàn bộ lịch sử — kiểm chứng xem thang tín hiệu có thực sự phân biệt được hay không.</div>`);
    const order = bt.slice().sort((a, b) => SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal));
    window.Plotly.react(bc.querySelector("#sc-bt"), [
      { type: "bar", name: "LN TB 1 năm", x: order.map((r) => SIGNAL_VI[r.signal] || r.signal),
        y: order.map((r) => r.mean_return),
        marker: { color: order.map((r) => (r.mean_return >= 0 ? "#22c55e" : "#ef4444")) },
        hovertemplate: "%{x}: %{y:.1f}%<extra></extra>" },
      { type: "scatter", mode: "lines+markers", name: "Tỷ lệ thắng", yaxis: "y2",
        x: order.map((r) => SIGNAL_VI[r.signal] || r.signal), y: order.map((r) => r.win_rate),
        line: { color: "#2563eb", width: 1.8 }, marker: { size: 6 },
        hovertemplate: "%{x}: thắng %{y:.1f}%<extra></extra>" },
    ], {
      height: 360, dragmode: false, margin: { l: 52, r: 52, t: 30, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
      legend: { orientation: "h", y: 1.1, x: 0, font: { size: 10 } },
      xaxis: { type: "category", tickfont: { size: 10 } },
      yaxis: { title: { text: "LN TB 1 năm (%)", font: { size: 10 } }, gridcolor: GRID, zeroline: true, ticksuffix: "%" },
      yaxis2: { title: { text: "Tỷ lệ thắng (%)", font: { size: 10 } }, overlaying: "y", side: "right", showgrid: false, ticksuffix: "%" },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });

    const tb = el(`<table class="screen"><thead><tr>
      <th>Tín hiệu</th><th>Số lần</th><th>LN TB 1 năm</th><th>LN trung vị</th><th>Tỷ lệ thắng</th>
    </tr></thead><tbody></tbody></table>`);
    for (const r of order) {
      tb.querySelector("tbody").appendChild(el(`<tr>
        <td><span style="color:${SIGNAL_COLOR[r.signal] || "var(--ink)"}">${SIGNAL_VI[r.signal] || r.signal}</span></td>
        <td>${r.count.toLocaleString("en-US")}</td>
        <td style="color:${r.mean_return >= 0 ? "#15803d" : "#b91c1c"}">${r.mean_return.toFixed(1)}%</td>
        <td>${r.median_return.toFixed(1)}%</td>
        <td>${r.win_rate.toFixed(1)}%</td></tr>`));
    }
    bc.appendChild(tb);
  }).catch(() => {});

  pend.forEach((fn) => fn());
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
    dcfUp: median(rs.map((r) => r.upside_pct)),
    q: median(rs.map((r) => r.q)),
  }));

  root.innerHTML = "";
  root.appendChild(el(`<h2 class="view-title">Phân tích Ngành</h2>`));

  // ── 1. Heatmap with the original's metric selector ────────────────
  const METRICS = {
    "Avg Estimate vs Thị trường": { key: "up", label: "Avg Est Upside %", pct: true, asc: false, lo: -0.8, hi: 1.5 },
    "DCF vs Thị trường": { key: "dcfUp", label: "DCF Upside %", pct: true, asc: false, lo: -0.8, hi: 1.5 },
    "P/E (thấp hơn = rẻ hơn)": { key: "pe", label: "P/E", pct: false, asc: true, lo: 0, hi: 50 },
    "P/B (thấp hơn = rẻ hơn)": { key: "pb", label: "P/B", pct: false, asc: true, lo: 0, hi: 5 },
    "ROE (cao hơn = tốt hơn)": { key: "roe", label: "ROE %", pct: true, asc: false, lo: -0.2, hi: 0.4 },
  };
  let metricName = "Avg Estimate vs Thị trường";

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
        return good ? "#70ad47" : "#c00000";
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

  // ── 3. Quality vs a selectable metric, one bubble per sector ─────
  // The original plots sectors here (bubble size = how many tickers), not
  // every ticker on a fixed axis; the per-ticker view lives on the screener.
  const SC_METRICS = {
    "DCF Upside %": { key: "dcfUp", label: "Median DCF Upside (%)", pct: true },
    "P/E (median)": { key: "pe", label: "Median P/E (×)", pct: false },
    "P/B (median)": { key: "pb", label: "Median P/B (×)", pct: false },
    "ROE %": { key: "roe", label: "Median ROE (%)", pct: true },
    "Net Margin %": { key: "nm", label: "Median Net Margin (%)", pct: true },
  };
  let scName = "DCF Upside %";

  const scat = el(`<div class="card">
    <h2 class="sec-h" id="sec-sc-h">Quality Score vs ${scName}</h2>
    <div class="range-row" id="sec-sc-metric"></div>
    <div class="vb-note">Mỗi bong bóng là một ngành; kích thước theo số mã, màu theo ROE trung vị.</div>
    <div id="sec-scatter"></div></div>`);
  root.appendChild(scat);

  const drawScatter = () => {
    const m = SC_METRICS[scName];
    const pts = agg.filter((x) => F.isNum(x[m.key]) && F.isNum(x.q));
    const xs = pts.map((x) => (m.pct ? x[m.key] * 100 : x[m.key]));
    $("#sec-sc-h", scat).textContent = `Quality Score vs ${scName}`;
    window.Plotly.react($("#sec-scatter", scat), [{
      type: "scatter", mode: "markers+text",
      x: xs, y: pts.map((x) => x.q), text: pts.map((x) => x.sector),
      textposition: "top center", textfont: { family: "Fira Code, monospace", size: 9, color: "#6b7280" },
      marker: {
        size: pts.map((x) => x.n), sizemode: "area",
        sizeref: 2 * Math.max(...pts.map((x) => x.n), 1) / (38 ** 2), sizemin: 6,
        color: pts.map((x) => (F.isNum(x.roe) ? x.roe * 100 : 0)),
        colorscale: "RdYlGn", showscale: true,
        colorbar: { title: { text: "ROE %", font: { size: 10 } }, thickness: 10, len: 0.7 },
        line: { width: 0.5, color: "#1f2937" },
      },
      customdata: pts.map((x) => [x.n, F.isNum(x.roe) ? x.roe * 100 : null]),
      hovertemplate: "%{text}<br>" + m.label + ": %{x:.1f}<br>"
                   + "Quality %{y:.0f} · %{customdata[0]} mã<extra></extra>",
    }], {
      height: 480, dragmode: false, margin: { l: 54, r: 14, t: 10, b: 46 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
      xaxis: { title: { text: m.label, font: { size: 10 } },
               gridcolor: "rgba(148,163,184,0.22)", zeroline: true, zerolinecolor: "#94a3b8" },
      yaxis: { title: { text: "Quality Score", font: { size: 10 } },
               gridcolor: "rgba(148,163,184,0.22)", range: [0, 100] },
    }, { displayModeBar: false, responsive: true });
  };

  const scRow = $("#sec-sc-metric", scat);
  for (const name of Object.keys(SC_METRICS)) {
    const b = el(`<button class="range-btn ${name === scName ? "active" : ""}">${name}</button>`);
    b.onclick = () => {
      scName = name;
      scRow.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      drawScatter();
    };
    scRow.appendChild(b);
  }
  drawScatter();

  // ── 4. Top 5 per sector by model upside ──────────────────────────
  const top5 = el(`<div class="card"><h2 class="sec-h">Top 5 mỗi Ngành — theo Avg Est Upside</h2>
    <div class="top5-grid"></div></div>`);
  const t5grid = top5.querySelector(".top5-grid");
  for (const s of [...agg].sort((a, b) => (b.up ?? -1e9) - (a.up ?? -1e9))) {
    const best = rows.filter((r) => r.sector === s.sector && F.isNum(r.upFrac))
      .sort((a, b) => b.upFrac - a.upFrac).slice(0, 5);
    if (!best.length) continue;
    const box = el(`<div class="t5-box"><div class="t5-h">${F.escapeHtml(s.sector)}</div></div>`);
    for (const r of best) {
      const row = el(`<div class="t5-row"><b>${r.ticker}</b>
        <span style="color:${r.upFrac >= 0 ? "#15803d" : "#b91c1c"}">${fmtUpside(r.upFrac)}</span></div>`);
      row.onclick = () => selectTicker(r.ticker);
      box.appendChild(row);
    }
    t5grid.appendChild(box);
  }
  root.appendChild(top5);

  // ── 3. Sector summary table — same columns as the original ───────
  const tbl = el(`<div class="card"><h2 class="sec-h">Bảng tổng hợp theo Ngành</h2>
    <table class="screen"><thead><tr>
      <th>Ngành</th><th>Số mã</th><th>DCF Upside</th><th>P/E</th><th>P/B</th><th>ROE</th>
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
  const view = $("#view-market");
  view.innerHTML = `<div class="loading">Đang tải…</div>`;
  const [rows, market] = await Promise.all([
    loadScreener(),
    fetch("data/market.json").then((r) => r.json()).catch(() => ({ vnindex: [], foreign: [] })),
  ]);
  const withChg = rows.filter((r) => F.isNum(r.chg));

  const up = withChg.filter((r) => r.chg > 0).length;
  const down = withChg.filter((r) => r.chg < 0).length;
  const flat = withChg.length - up - down;
  const total = withChg.length || 1;

  view.innerHTML = "";
  view.appendChild(el(`<h2 class="view-title">Tổng quan Thị trường</h2>`));

  // The original splits this view into "Thị trường" and "Vĩ mô" sub-tabs.
  const subtabs = el(`<div class="range-row mo-tabs">
    <button class="range-btn active" data-sub="market">📊 Thị trường</button>
    <button class="range-btn" data-sub="macro">📈 Vĩ mô</button></div>`);
  view.appendChild(subtabs);
  const mktPane = el(`<div id="mo-market"></div>`);
  const macroPane = el(`<div id="mo-macro" class="hidden"></div>`);
  view.appendChild(mktPane); view.appendChild(macroPane);
  let macroLoaded = false;
  subtabs.querySelectorAll(".range-btn").forEach((b) => {
    b.onclick = async () => {
      subtabs.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const isMacro = b.dataset.sub === "macro";
      mktPane.classList.toggle("hidden", isMacro);
      macroPane.classList.toggle("hidden", !isMacro);
      // Lazy: the macro pane builds ~30 charts, so only on first open.
      if (isMacro && !macroLoaded) { macroLoaded = true; await renderMacro(macroPane); }
    };
  });
  // Market sections render into the first pane; `view` stays the shell.
  const root = mktPane;

  // ── 1. VN-Index chart + advance/decline panel (3:1, as in the original) ──
  const idxAll = market.vnindex || [];
  const iLast = idxAll.length ? idxAll[idxAll.length - 1].close : null;
  const iPrev = idxAll.length > 1 ? idxAll[idxAll.length - 2].close : null;
  const iYear = idxAll.length ? idxAll[Math.max(0, idxAll.length - 252)].close : null;
  const iDay = (F.isNum(iLast) && F.isNum(iPrev) && iPrev) ? (iLast - iPrev) / iPrev * 100 : null;
  const iYr = (F.isNum(iLast) && F.isNum(iYear) && iYear) ? (iLast - iYear) / iYear * 100 : null;
  const idxSub = F.isNum(iLast)
    ? `${iLast.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
      `${iDay == null ? "" : ` (${F.pctSigned(iDay, 2)})`}` +
      `${iYr == null ? "" : ` · ${F.pctSigned(iYr)} trong 1 năm`}`
    : "";
  const top = el(`<div class="card split-31">
    <div><h2 class="sec-h">VN-Index (1 năm)</h2>
      <div class="chart-sub">${idxSub}</div><div id="vni-chart"></div></div>
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

  // ── 2. Market P/E and P/B, each against its own history ──────────
  // Two charts, as the original has them: a single dual-axis line can show the
  // two series but not where either sits in its own range, which is the whole
  // question this section answers.
  const hist = await fetch("data/market_history.json").then((r) => r.json()).catch(() => []);
  if (hist.length > 3) {
    const wrap = el(`<div class="card">
      <h2 class="sec-h">Định giá Thị trường so với Lịch sử</h2>
      <div class="mkt-pair"><div id="mkt-pe"></div><div id="mkt-pb"></div></div>
      <div class="vb-note" id="mkt-hist-note"></div></div>`);
    root.appendChild(wrap);

    const multipleChart = (node, key, label, digits) => {
      const pts = hist.filter((d) => F.isNum(d[key]));
      if (pts.length < 4) return null;
      const x = pts.map((d) => d.quarter);
      const v = pts.map((d) => d[key]);
      const cur = v[v.length - 1];
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      // Sample standard deviation, matching the original's ddof=1.
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / (v.length - 1));
      const lo = avg - sd, hi = avg + sd;
      // Plain language, not "±1σ": what a reader needs is "above this is
      // unusually expensive", not the name of the statistic.
      const [verdict, clr] =
        cur > hi ? ["Đắt hơn mức thường thấy", "#b91c1c"]
        : cur < lo ? ["Rẻ hơn mức thường thấy", "#15803d"]
        : cur > avg ? ["Nhỉnh trên trung bình", "#b45309"]
        : ["Quanh/dưới trung bình", "#15803d"];
      const diff = avg ? (cur / avg - 1) * 100 : 0;
      const f = (n) => n.toFixed(digits);
      const ymin = Math.min(Math.min(...v), lo) * 0.96;
      const ymax = Math.max(Math.max(...v), hi) * 1.04;

      window.Plotly.react(node, [
        { type: "scatter", mode: "lines", name: label, x, y: v,
          line: { color: "#00347b", width: 2.2 },
          hovertemplate: `%{x}<br>${label}: <b>%{y:.${digits}f}x</b><extra></extra>` },
        { type: "scatter", mode: "markers", name: "Hiện tại", x: [x[x.length - 1]], y: [cur],
          marker: { color: "#00347b", size: 11, line: { color: "#ffffff", width: 2 } },
          hoverinfo: "skip", showlegend: false },
      ], {
        height: 320, dragmode: false, margin: { l: 46, r: 116, t: 56, b: 34 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(255,255,255,0)",
        font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" },
        showlegend: false, hovermode: "x unified",
        title: { text: `<b style="font-size:19px;color:#0a121d">${f(cur)}x</b>`
                     + `<span style="font-size:12px;color:#666f7c"> ${label} hiện tại · `
                     + `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}% so TB</span><br>`
                     + `<span style="font-size:12.5px;color:${clr}"><b>${verdict}</b></span>`,
                 font: { size: 13 } },
        xaxis: { type: "category", nticks: 8, showgrid: false, tickfont: { size: 11 }, tickangle: -45 },
        yaxis: { title: { text: `${label} (lần)`, font: { size: 10 } },
                 gridcolor: "#e2e8f0", zeroline: false, range: [ymin, ymax], tickfont: { size: 11 } },
        shapes: [
          { type: "rect", xref: "paper", x0: 0, x1: 1, y0: lo, y1: hi,
            fillcolor: "#00347b", opacity: 0.09, line: { width: 0 }, layer: "below" },
          ...[hi, lo].map((y) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
                                    line: { color: "#afb8c4", width: 1, dash: "dot" } })),
          { type: "line", xref: "paper", x0: 0, x1: 1, y0: avg, y1: avg,
            line: { color: "#64748b", width: 1.2, dash: "dash" } },
        ],
        annotations: [
          { x: 1, xref: "paper", y: hi, yanchor: "bottom", xanchor: "right", showarrow: false,
            text: `Ngưỡng đắt ${f(hi)}`, font: { size: 10, color: "#666f7c" } },
          { x: 1, xref: "paper", y: lo, yanchor: "top", xanchor: "right", showarrow: false,
            text: `Ngưỡng rẻ ${f(lo)}`, font: { size: 10, color: "#666f7c" } },
          { x: 1, xref: "paper", y: avg, yanchor: "bottom", xanchor: "right", showarrow: false,
            text: `Trung bình ${f(avg)}`, font: { size: 11, color: "#47515e" } },
        ],
      }, { displayModeBar: false, responsive: true });
      return { cur, avg, n: v.length };
    };

    const pe = multipleChart($("#mkt-pe", wrap), "pe", "P/E", 1);
    multipleChart($("#mkt-pb", wrap), "pb", "P/B", 2);
    if (pe) {
      const rel = (pe.cur / pe.avg - 1) * 100;
      $("#mkt-hist-note", wrap).innerHTML =
        `P/E thị trường hiện <b>${pe.cur.toFixed(1)}×</b> so với trung bình ${pe.n} quý là `
        + `<b>${pe.avg.toFixed(1)}×</b> (${rel >= 0 ? "+" : ""}${rel.toFixed(0)}%). `
        + (rel > 10 ? "Thị trường đang đắt hơn mặt bằng lịch sử."
           : rel < -10 ? "Thị trường đang rẻ hơn mặt bằng lịch sử."
           : "Thị trường ở vùng định giá quen thuộc.")
        + " Dải nhạt là vùng trung bình ± 1 độ lệch chuẩn.";
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
      marker: { color: y.map((v) => (v >= 0 ? "#22c55e" : "#ef4444")) },
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
      <table class="screen"><thead><tr><th>Mã</th><th>Công ty</th><th>Giá</th><th>Thay đổi</th><th>Khối lượng</th></tr></thead>
      <tbody></tbody></table></div>`);
    const tb = $("tbody", c);
    for (const r of list) {
      const v = valFn(r);
      const tr = el(`<tr><td><b>${r.ticker}</b></td>
        <td class="dim">${F.escapeHtml((r.name || r.sector || "").slice(0, 26))}</td>
        <td>${F.priceVND(r.close)}</td>
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
    marker: { color: perf.map((p) => (p[1] >= 0 ? "#22c55e" : "#ef4444")).reverse() },
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
        colorscale: [[0, "#ef4444"], [0.5, "#f1f5f9"], [1, "#22c55e"]],
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

// ── stock comparison view ───────────────────────────────────────────
let compareBuilt = false;
async function renderCompareView() {
  if (compareBuilt) return;
  compareBuilt = true;
  await renderCompare($("#view-compare"), selectTicker);
}





boot();

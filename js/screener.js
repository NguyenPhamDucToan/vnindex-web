// Stock screener: presets, explicit min/max filters, a sortable table built
// only from figures that agree with the stock page (the sector-adjusted model
// price, never the raw DB estimates), liquidity floor, within-sector rank,
// filters kept in the URL hash, CSV export.
//
// Plan items: Day 16 (screen), 61 (leverage screen), 76 (liquidity filter),
// 83 (sector-neutral rank), 119 (CSV export), 122 (shareable filters).
import * as F from "./format.js";
import { SIGNAL_VI, SIGNAL_COLOR, SIGNAL_ORDER, FINANCIAL_SECTORS } from "./signals.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => F.escapeHtml(s).replaceAll('"', "&quot;");

// Liquidity: 20-session mean traded value when the export carries it; a
// single session's value otherwise (older exports).
const liq = (r) => F.isNum(r.adv20) ? r.adv20
  : (F.isNum(r.close) && F.isNum(r.vol) ? r.close * r.vol / 1e6 : null);

// [id, label, unit, "min"|"max", value(row), step, placeholder, hint]
// Values are in display units (percent as 15, not 0.15). An empty box is no
// filter; a set box excludes rows that have no value for it -- except net
// debt/EBITDA, which banks, brokers and insurers never have and should not be
// thrown out for.
const FILTERS = [
  ["liq", "Thanh khoản tối thiểu", "tỷ/phiên", "min", liq, 0.5, "1", "Giá trị khớp lệnh bình quân 20 phiên gần nhất"],
  ["mcap", "Vốn hoá tối thiểu", "tỷ", "min", (r) => r.mcap, 500, "1000", "Giá × số cổ phiếu lưu hành"],
  ["up", "Upside tối thiểu", "%", "min", (r) => F.isNum(r.upFrac) ? r.upFrac * 100 : null, 5, "20", "Giá mô hình so với thị giá, đã điều chỉnh theo ngành"],
  ["q", "Chất lượng tối thiểu", "/100", "min", (r) => r.q, 5, "60", "Điểm chất lượng nội bộ: ROE, biên lãi, dòng tiền, thanh khoản, nợ"],
  ["pe", "P/E tối đa", "x", "max", (r) => (F.isNum(r.pe) && r.pe > 0 ? r.pe : null), 1, "15", "Bỏ qua mã lỗ (P/E âm)"],
  ["pb", "P/B tối đa", "x", "max", (r) => (F.isNum(r.pb) && r.pb > 0 ? r.pb : null), 0.1, "2", ""],
  ["roe", "ROE tối thiểu", "%", "min", (r) => F.isNum(r.roe) ? r.roe * 100 : null, 1, "15", "Lợi nhuận 4 quý / vốn chủ"],
  ["pio", "Piotroski tối thiểu", "/9", "min", (r) => r.piotroski, 1, "7", "Không tính cho ngân hàng, chứng khoán, bảo hiểm"],
  ["peg", "PEG tối đa", "", "max", (r) => r.peg, 0.1, "1", "P/E ÷ tăng trưởng lợi nhuận 3 năm; chỉ có khi lợi nhuận tăng"],
  ["dy", "Cổ tức tối thiểu", "%", "min", (r) => F.isNum(r.div_yield) ? r.div_yield * 100 : null, 0.5, "5", "Cổ tức tiền mặt năm gần nhất / vốn hoá"],
  ["nd", "Nợ ròng/EBITDA tối đa", "x", "max", (r) => r.net_debt_ebitda, 0.5, "2", "Âm = tiền mặt nhiều hơn nợ. Ngành tài chính luôn đạt"],
  ["z", "Altman Z'' tối thiểu", "", "min", (r) => r.altman_z, 0.1, "2.6", "≥ 2.6 là vùng an toàn. Không tính cho ngành tài chính"],
  ["ins", "Nội bộ mua ròng tối thiểu", "% CP", "min", (r) => F.isNum(r.ins_net12) ? r.ins_net12 * 100 : null, 0.05, "0.1",
    "Mua trừ bán đã thực hiện (có báo cáo kết quả) của lãnh đạo, người liên quan và tổ chức trong 12 tháng, theo % cổ phần"],
];
const FBY = Object.fromEntries(FILTERS.map((f) => [f[0], f]));

const DEFAULT = { liq: "1" };
const PRESETS = [
  ["all", "Tất cả", "Chỉ bỏ mã quá ít giao dịch", { liq: "1" }],
  ["value", "Giá trị", "Rẻ so với mô hình, chất lượng không tệ, P/E thấp", { liq: "1", up: "20", q: "50", pe: "15" }],
  ["quality", "Chất lượng", "Sinh lời cao và cải thiện qua năm", { liq: "1", q: "65", roe: "15", pio: "7" }],
  ["dividend", "Cổ tức", "Tỷ suất cổ tức cao, nợ vừa phải", { liq: "1", dy: "5", nd: "2" }],
  ["garp", "Tăng trưởng giá hợp lý", "PEG ≤ 1: trả ít hơn tốc độ tăng lợi nhuận", { liq: "1", peg: "1", roe: "12" }],
  ["safe", "An toàn tài chính", "Xa vùng kiệt quệ, nợ thấp", { liq: "1", z: "2.6", nd: "2" }],
];

// [key, header, sort value, cell html, default direction, title]
// Direction: -1 = biggest first.
const COLS = [
  ["ticker", "Mã", (r) => r.ticker, (r, ctx) =>
    `<div class="sx-tk"><b>${r.ticker}</b>${ctx.stale(r) ? `<span class="stale-tag" title="Giá gần nhất ${esc(r.px_date || "?")} · Báo cáo gần nhất ${esc(r.last_q || "?")}">cũ</span>` : ""}</div>
     <div class="sx-nm" title="${esc(r.name || "")}">${F.escapeHtml(r.name || "")}</div>`, 1, ""],
  ["sig", "Tín hiệu", (r) => (r.sig ? SIGNAL_ORDER.indexOf(r.sig) : 99), (r) => r.sig
    ? `<span class="sx-pill" style="--c:${SIGNAL_COLOR[r.sig]}">${SIGNAL_VI[r.sig]}</span>` : `<span class="sx-na">—</span>`, 1,
    "Kết hợp upside và điểm chất lượng"],
  ["sector", "Ngành", (r) => r.sector || "", (r) => `<span class="sx-sec">${F.escapeHtml(r.sector || "")}</span>`, 1, ""],
  ["close", "Giá", (r) => r.close, (r) => F.priceVND(r.close), -1, "VND"],
  ["model", "Giá mô hình", (r) => r.model_price, (r) => F.rawVND(r.model_price), -1,
    "Trung bình ba nhóm phương pháp, đã điều chỉnh theo ngành — cùng số với trang cổ phiếu"],
  ["up", "Upside", (r) => r.upFrac, (r) => {
    if (!F.isNum(r.upFrac)) return `<span class="sx-na">—</span>`;
    const u = r.upFrac * 100;
    return `<span class="${u >= 0 ? "sx-g" : "sx-r"}">${u > 500 ? ">+500%" : F.pctSigned(u, 0)}</span>`;
  }, -1, "Giá mô hình so với thị giá"],
  ["rank", "Hạng ngành", (r) => r.secPct, (r) => F.isNum(r.secRank)
    ? `<span class="sx-rank" title="Xếp hạng trong ngành theo upside và chất lượng">${r.secRank}<i>/${r.secN}</i></span>` : `<span class="sx-na">—</span>`, -1,
    "Thứ hạng trong cùng ngành, trung bình phân vị upside và chất lượng"],
  ["q", "Chất lượng", (r) => r.q, (r) => F.isNum(r.q)
    ? `<span class="sx-bar"><span style="width:${Math.max(4, Math.min(100, r.q))}%;background:${r.q >= 70 ? "#16a34a" : r.q >= 50 ? "#d97706" : "#dc2626"}"></span></span><span class="sx-qn">${r.q.toFixed(0)}</span>` : "—", -1, "Điểm 0–100"],
  ["pe", "P/E", (r) => (F.isNum(r.pe) && r.pe > 0 ? r.pe : null), (r) => (F.isNum(r.pe) && r.pe > 0 ? r.pe.toFixed(1) : `<span class="sx-na">${F.isNum(r.pe) ? "lỗ" : "—"}</span>`), 1, ""],
  ["pb", "P/B", (r) => (F.isNum(r.pb) && r.pb > 0 ? r.pb : null), (r) => (F.isNum(r.pb) ? r.pb.toFixed(2) : "—"), 1, ""],
  ["roe", "ROE", (r) => r.roe, (r) => (F.isNum(r.roe) ? `<span class="${r.roe >= 0.15 ? "sx-g" : r.roe < 0 ? "sx-r" : ""}">${F.pct(r.roe, 1)}</span>` : "—"), -1, ""],
  ["peg", "PEG", (r) => r.peg, (r) => (F.isNum(r.peg) ? `<span class="${r.peg <= 1 ? "sx-g" : r.peg > 2 ? "sx-r" : ""}">${r.peg.toFixed(2)}</span>` : `<span class="sx-na">—</span>`), 1,
    "P/E ÷ tăng trưởng lợi nhuận 3 năm (%)"],
  ["pio", "Piotroski", (r) => r.piotroski, (r) => (F.isNum(r.piotroski)
    ? `<span class="sx-dots" title="${r.piotroski}/9 phép thử đạt">${"<i class=on></i>".repeat(r.piotroski)}${"<i></i>".repeat(Math.max(0, 9 - r.piotroski))}</span><span class="sx-qn">${r.piotroski}</span>`
    : `<span class="sx-na">—</span>`), -1, "9 phép thử sức khoẻ tài chính"],
  ["dy", "Cổ tức", (r) => r.div_yield, (r) => (F.isNum(r.div_yield) && r.div_yield > 0 ? `<span class="${r.div_yield >= 0.05 ? "sx-g" : ""}">${F.pct(r.div_yield, 1)}</span>` : `<span class="sx-na">—</span>`), -1,
    "Tỷ suất cổ tức tiền mặt"],
  ["ins", "Nội bộ 12T", (r) => r.ins_net12, (r) => (F.isNum(r.ins_net12) && r.ins_net12 !== 0
    ? `<span class="${r.ins_net12 > 0 ? "sx-g" : "sx-r"}">${r.ins_net12 > 0 ? "+" : ""}${(r.ins_net12 * 100).toFixed(2)}%</span>`
    : `<span class="sx-na">—</span>`), -1,
    "Lãnh đạo, người liên quan và tổ chức mua trừ bán đã thực hiện trong 12 tháng, % cổ phần"],
  ["nd", "Nợ ròng/ EBITDA", (r) => r.net_debt_ebitda, (r) => (F.isNum(r.net_debt_ebitda)
    ? (r.net_debt_ebitda < 0 ? `<span class="sx-g">tiền ròng</span>` : `<span class="${r.net_debt_ebitda > 4 ? "sx-r" : ""}">${r.net_debt_ebitda.toFixed(1)}x</span>`)
    : `<span class="sx-na">—</span>`), 1, ""],
  ["mcap", "Vốn hoá", (r) => r.mcap, (r) => (F.isNum(r.mcap) ? fmtBn(r.mcap) : "—"), -1, "Tỷ đồng"],
  ["liq", "Thanh khoản", liq, (r) => (F.isNum(liq(r)) ? fmtBn(liq(r)) : "—"), -1, "Tỷ đồng/phiên, bình quân 20 phiên"],
];
const CBY = Object.fromEntries(COLS.map((c) => [c[0], c]));

function fmtBn(v) {
  if (v >= 1000) return `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  if (v >= 10) return Math.round(v).toLocaleString("en-US");
  return v.toFixed(1);
}

// Within-sector rank: mean of the upside and quality percentiles among the
// sector's valued names, so a bank is ranked against banks.
function addSectorRank(rows) {
  const by = {};
  for (const r of rows) if (r.sector && F.isNum(r.upFrac) && F.isNum(r.q)) (by[r.sector] ||= []).push(r);
  for (const list of Object.values(by)) {
    const n = list.length;
    const pctOf = (key) => {
      const s = list.slice().sort((a, b) => a[key] - b[key]);
      const m = new Map();
      s.forEach((r, i) => m.set(r, n > 1 ? i / (n - 1) : 1));
      return m;
    };
    const pu = pctOf("upFrac"), pq = pctOf("q");
    for (const r of list) r.secPct = (pu.get(r) + pq.get(r)) / 2;
    list.sort((a, b) => b.secPct - a.secPct).forEach((r, i) => { r.secRank = i + 1; r.secN = n; });
  }
}

// ── URL hash state: #screen?p=value&up=20&sec=A|B&sig=Buy&s=up&d=-1&wl=1&t=search ──
function readHash() {
  const h = location.hash || "";
  if (!h.startsWith("#screen")) return null;
  const q = new URLSearchParams(h.split("?")[1] || "");
  if (![...q.keys()].length) return null;      // bare #screen: defaults
  const st = { preset: q.get("p") || "custom", f: {}, sec: [], sig: [], sort: q.get("s") || "sig",
               dir: parseInt(q.get("d") || "0", 10) || 0, wl: q.get("wl") === "1", q: q.get("t") || "" };
  for (const [id] of FILTERS) if (q.has(id)) st.f[id] = q.get(id);
  if (q.get("sec")) st.sec = q.get("sec").split("|");
  if (q.get("sig")) st.sig = q.get("sig").split("|");
  return st;
}
function writeHash(st) {
  const q = new URLSearchParams();
  if (st.preset && st.preset !== "custom") q.set("p", st.preset);
  for (const [k, v] of Object.entries(st.f)) if (v !== "" && v != null) q.set(k, v);
  if (st.sec.length) q.set("sec", st.sec.join("|"));
  if (st.sig.length) q.set("sig", st.sig.join("|"));
  if (st.sort && st.sort !== "sig") q.set("s", st.sort);
  if (st.dir) q.set("d", String(st.dir));
  if (st.wl) q.set("wl", "1");
  if (st.q) q.set("t", st.q);   // "q" is the quality filter
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${location.search}#screen${s ? "?" + s : ""}`);
}

export function isScreenerHash() { return (location.hash || "").startsWith("#screen"); }

export function buildScreener(root, rows, { selectTicker, loadWL, saveWL, onFiltered }) {
  addSectorRank(rows);
  const marketQ = (() => {
    const c = {};
    for (const r of rows) if (r.last_q) c[r.last_q] = (c[r.last_q] || 0) + 1;
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
  })();
  const ctx = { stale: (r) => (r.px_age ?? 0) > 10 || (r.last_q && marketQ && r.last_q < marketQ) };
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const wl = loadWL();
  const st = readHash() || { preset: "all", f: { ...DEFAULT }, sec: [], sig: [], sort: "sig", dir: 0, wl: false, q: "" };

  root.innerHTML = "";
  root.appendChild(el(`<div class="sx-head">
      <div><h2 class="view-title sx-title">Sàng lọc cổ phiếu</h2>
        <div class="sx-sub">Chọn một bộ lọc mẫu hoặc tự đặt ngưỡng. Mọi giá trị đều cùng số với trang cổ phiếu.</div></div>
      <div class="sx-actions">
        <button class="sx-btn" id="sx-link" title="Sao chép đường dẫn kèm bộ lọc hiện tại">🔗 Sao chép liên kết</button>
        <button class="sx-btn" id="sx-csv" title="Tải bảng đang lọc về máy">⬇ Xuất CSV</button>
      </div></div>`));

  // Presets
  const presetRow = el(`<div class="sx-presets" role="tablist"></div>`);
  for (const [id, label, hint] of PRESETS) {
    presetRow.appendChild(el(`<button class="sx-preset" data-p="${id}" title="${esc(hint)}">${label}</button>`));
  }
  presetRow.appendChild(el(`<button class="sx-preset sx-wl" data-p="__wl" title="Chỉ các mã bạn đã gắn sao ☆ trong bảng">★ Đã gắn sao <span id="sx-wl-n"></span></button>`));
  root.appendChild(presetRow);
  const presetNote = el(`<div class="sx-pnote"></div>`);
  root.appendChild(presetNote);

  // Filters
  const ftoggle = el(`<button class="sx-btn sx-ftoggle">Bộ lọc ▾ <span id="sx-fon"></span></button>`);
  root.appendChild(ftoggle);
  // Four fixed groups, each a vertical list, so the panel lines up at any
  // width instead of an auto-fill grid leaving one or two orphans on a row.
  const GROUPS = [
    ["Quy mô & thanh khoản", ["liq", "mcap"]],
    ["Định giá", ["up", "pe", "pb", "peg"]],
    ["Chất lượng & nội bộ", ["q", "roe", "pio", "ins"]],
    ["Cổ tức & an toàn", ["dy", "nd", "z"]],
  ];
  const fInput = (id) => {
    const [, label, unit, kind, , step, ph, hint] = FBY[id];
    return `<label class="sx-f" title="${esc(hint + (hint ? ". " : "") + "Ví dụ: " + ph)}">
      <span class="sx-fk">${label.replace(/ (tối thiểu|tối đa)$/, "")}<i>${kind === "min" ? "≥" : "≤"}</i></span>
      <span class="sx-in"><input type="number" inputmode="decimal" id="sx-f-${id}" step="${step}" placeholder="—" />${unit ? `<em>${unit}</em>` : ""}</span></label>`;
  };
  const fcard = el(`<div class="card sx-filters">
    <div class="sx-groups">
      ${GROUPS.map(([title, ids], gi) => `<div class="sx-group">
        <div class="sx-gh">${title}</div>
        ${gi === 0 ? `<div class="sx-f sx-f-sec"><span class="sx-fk">Ngành</span><div class="sf-tags" id="sx-sector"></div></div>` : ""}
        ${ids.map(fInput).join("")}</div>`).join("")}
    </div>
    <div class="sx-fnote">Ô để trống là không lọc. Đặt một ngưỡng thì mã không có số liệu cho chỉ số đó bị loại (riêng nợ ròng/EBITDA: ngành tài chính luôn đạt).</div>
  </div>`);
  root.appendChild(fcard);

  // Signal tiles + toolbar + table
  const tcard = el(`<div class="card sx-table-card">
    <div class="sig-counts" id="sx-sig"></div>
    <div class="sx-bar-row">
      <input id="sx-q" class="sx-search" placeholder="Tìm mã hoặc tên công ty…" autocomplete="off" spellcheck="false" />
      <span class="sx-count" id="sx-count"></span>
      <button class="sx-btn sx-ghost" id="sx-reset">Xoá lọc</button>
    </div>
    <div class="ta-scroll sx-scroll"><table class="screen sx-table"><thead><tr><th class="sx-star"></th>
      ${COLS.map(([k, h, , , , t]) => `<th data-k="${k}" title="${esc(t)}">${h}<span class="sx-arrow"></span></th>`).join("")}
    </tr></thead><tbody></tbody></table></div>
    <div class="sx-empty hidden">Không có mã nào thoả mọi điều kiện. Thử nới một ngưỡng hoặc chọn "Tất cả".</div>
  </div>`);
  root.appendChild(tcard);
  const tb = tcard.querySelector("tbody");
  ftoggle.onclick = () => {
    const open = fcard.classList.toggle("sx-open");
    ftoggle.firstChild.textContent = open ? "Bộ lọc ▴ " : "Bộ lọc ▾ ";
  };

  const secPick = tagPicker(fcard.querySelector("#sx-sector"), sectors, "Tất cả ngành", (v) => { st.sec = v; markCustom(); apply(); });
  for (const s of st.sec) secPick.add(s);

  const sigHost = tcard.querySelector("#sx-sig");
  for (const sg of SIGNAL_ORDER) {
    const b = el(`<button class="sig-c" data-sig="${sg}"><div class="sig-n">0</div><div class="sig-l">${SIGNAL_VI[sg]}</div></button>`);
    b.onclick = () => {
      st.sig = st.sig.includes(sg) ? st.sig.filter((x) => x !== sg) : [...st.sig, sg];
      apply();
    };
    sigHost.appendChild(b);
  }

  // Inputs <- state
  const putInputs = () => {
    for (const [id] of FILTERS) fcard.querySelector(`#sx-f-${id}`).value = st.f[id] ?? "";
    tcard.querySelector("#sx-q").value = st.q || "";
  };
  putInputs();
  if (readHash()) markCustom();

  function markCustom() {
    const match = PRESETS.find(([, , , vals]) => {
      const keys = new Set([...Object.keys(vals), ...Object.keys(st.f).filter((k) => st.f[k] !== "")]);
      return [...keys].every((k) => String(vals[k] ?? "") === String(st.f[k] ?? ""));
    });
    st.preset = match && !st.sec.length ? match[0] : "custom";
  }

  for (const [id] of FILTERS) {
    fcard.querySelector(`#sx-f-${id}`).addEventListener("input", (e) => {
      st.f[id] = e.target.value; markCustom(); apply();
    });
  }
  tcard.querySelector("#sx-q").addEventListener("input", (e) => { st.q = e.target.value.trim(); apply(); });

  presetRow.addEventListener("click", (e) => {
    const b = e.target.closest(".sx-preset");
    if (!b) return;
    if (b.dataset.p === "__wl") { st.wl = !st.wl; apply(); return; }
    const p = PRESETS.find((x) => x[0] === b.dataset.p);
    st.preset = p[0]; st.f = { ...p[3] }; st.sec = []; secPick.reset();
    putInputs(); apply();
  });

  tcard.querySelector("#sx-reset").onclick = () => {
    st.preset = "all"; st.f = { ...DEFAULT }; st.sec = []; st.sig = []; st.wl = false; st.q = "";
    st.sort = "sig"; st.dir = 0; secPick.reset(); putInputs(); apply();
  };

  tcard.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k, def = CBY[k][4];
    if (st.sort === k) st.dir = -(st.dir || def);
    else { st.sort = k; st.dir = def; }
    apply();
  });

  tb.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-t]");
    if (!tr) return;
    const t = tr.dataset.t;
    if (e.target.closest(".wl-star")) {
      e.stopPropagation();
      if (wl.has(t)) wl.delete(t); else wl.add(t);
      saveWL(wl); apply(); return;
    }
    selectTicker(t);
  });

  let current = [];
  root.querySelector("#sx-csv").onclick = () => downloadCSV(current);
  root.querySelector("#sx-link").onclick = async (e) => {
    writeHash(st);
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = "✓ Đã sao chép"; }
    catch { e.target.textContent = "Liên kết đã nằm trên thanh địa chỉ"; }
    setTimeout(() => { e.target.textContent = "🔗 Sao chép liên kết"; }, 1800);
  };

  function passes(r, skipSig = false) {
    if (st.sec.length && !st.sec.includes(r.sector)) return false;
    if (!skipSig && st.sig.length && !st.sig.includes(r.sig)) return false;
    if (st.wl && !wl.has(r.ticker)) return false;
    if (st.q) {
      const q = st.q.toUpperCase();
      if (!r.ticker.includes(q) && !String(r.name || "").toUpperCase().includes(q)) return false;
    }
    for (const [id, , , kind, get] of FILTERS) {
      const raw = st.f[id];
      if (raw === "" || raw == null) continue;
      const lim = parseFloat(raw);
      if (!isFinite(lim)) continue;
      const v = get(r);
      if (!F.isNum(v)) {
        if (id === "nd" && FINANCIAL_SECTORS.has(r.sector)) continue;
        return false;
      }
      if (kind === "min" ? v < lim : v > lim) return false;
    }
    return true;
  }

  function apply() {
    // Signal counts reflect every other filter, so a tile says how many it would show.
    const base = rows.filter((r) => passes(r, true));
    for (const b of sigHost.querySelectorAll(".sig-c")) {
      const sg = b.dataset.sig, on = st.sig.includes(sg);
      b.querySelector(".sig-n").textContent = base.filter((r) => r.sig === sg).length;
      b.classList.toggle("on", on);
      b.style.setProperty("--c", SIGNAL_COLOR[sg]);
    }
    for (const b of presetRow.querySelectorAll(".sx-preset")) {
      b.classList.toggle("active", b.dataset.p === "__wl" ? st.wl : b.dataset.p === st.preset);
    }
    presetRow.querySelector("#sx-wl-n").textContent = wl.size ? `(${wl.size})` : "";
    const nOn = Object.values(st.f).filter((v) => v !== "" && v != null).length + (st.sec.length ? 1 : 0);
    ftoggle.querySelector("#sx-fon").textContent = nOn ? `· ${nOn} đang bật` : "";
    const p = PRESETS.find((x) => x[0] === st.preset);
    presetNote.textContent = p ? p[2] : "Bộ lọc tuỳ chỉnh";

    let out = base.filter((r) => !st.sig.length || st.sig.includes(r.sig));
    const col = CBY[st.sort] || CBY.sig;
    const dir = st.dir || col[4];
    const key = col[2];
    out = out.slice().sort((a, b) => {
      const va = key(a), vb = key(b);
      const na = va == null || (typeof va === "number" && !isFinite(va));
      const nb = vb == null || (typeof vb === "number" && !isFinite(vb));
      if (na !== nb) return na ? 1 : -1;               // missing values last, either direction
      if (na) return 0;
      const c = typeof va === "string" ? va.localeCompare(vb, "vi") : va - vb;
      return c * dir || (b.q ?? 0) - (a.q ?? 0);
    });
    current = out;

    for (const th of tcard.querySelectorAll("th[data-k]")) {
      const on = th.dataset.k === col[0];
      th.classList.toggle("sorted", on);
      th.querySelector(".sx-arrow").textContent = on ? (dir > 0 ? " ▲" : " ▼") : "";
    }
    tb.innerHTML = out.map((r) => `<tr data-t="${r.ticker}">
      <td class="sx-star"><button class="wl-star ${wl.has(r.ticker) ? "on" : ""}" title="Theo dõi">${wl.has(r.ticker) ? "★" : "☆"}</button></td>
      ${COLS.map(([k, , , cell]) => `<td class="c-${k}">${cell(r, ctx)}</td>`).join("")}</tr>`).join("");
    tcard.querySelector(".sx-empty").classList.toggle("hidden", out.length > 0);
    tcard.querySelector("#sx-count").innerHTML = `<b>${out.length}</b> / ${rows.length} mã`;
    writeHash(st);
    if (onFiltered) onFiltered(out);
  }

  apply();
}

function downloadCSV(rows) {
  const head = ["Mã", "Tên", "Ngành", "Tín hiệu", "Giá (VND)", "Giá mô hình (VND)", "Upside (%)",
    "Hạng ngành", "Chất lượng", "P/E", "P/B", "ROE (%)", "PEG", "Piotroski", "Cổ tức (%)",
    "Nợ ròng/EBITDA", "Altman Z''", "Vốn hoá (tỷ)", "Thanh khoản 20 phiên (tỷ)", "Nội bộ mua ròng 12T (% CP)"];
  const n = (v, d = 2) => (F.isNum(v) ? v.toFixed(d) : "");
  const lines = rows.map((r) => [
    r.ticker, r.name || "", r.sector || "", r.sig ? SIGNAL_VI[r.sig] : "",
    F.isNum(r.close) ? Math.round(r.close * 1000) : "", F.isNum(r.model_price) ? Math.round(r.model_price) : "",
    F.isNum(r.upFrac) ? n(r.upFrac * 100, 1) : "", F.isNum(r.secRank) ? `${r.secRank}/${r.secN}` : "",
    n(r.q, 0), n(r.pe, 1), n(r.pb), F.isNum(r.roe) ? n(r.roe * 100, 1) : "", n(r.peg),
    F.isNum(r.piotroski) ? r.piotroski : "", F.isNum(r.div_yield) ? n(r.div_yield * 100, 1) : "",
    n(r.net_debt_ebitda, 1), n(r.altman_z), n(r.mcap, 0), n(liq(r), 2),
    F.isNum(r.ins_net12) ? n(r.ins_net12 * 100, 3) : "",
  ]);
  const csv = [head, ...lines].map((row) => row.map((x) => {
    const s = String(x);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(",")).join("\r\n");
  // BOM so Excel reads the Vietnamese as UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sang-loc-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Compact multi-select: chosen values as removable chips, typing filters an
// overlay list.
function tagPicker(host, options, placeholder, onChange) {
  const chosen = new Set();
  host.innerHTML = `<div class="tp-box"><span class="tp-chips"></span>
    <input class="tp-in" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
    </div><div class="tp-list hidden"></div>`;
  const chips = host.querySelector(".tp-chips");
  const input = host.querySelector(".tp-in");
  const list = host.querySelector(".tp-list");
  const draw = () => {
    chips.innerHTML = "";
    for (const v of chosen) {
      const c = el(`<span class="tp-chip">${F.escapeHtml(v)}<button title="Bỏ">✕</button></span>`);
      c.querySelector("button").onclick = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        chosen.delete(v); draw(); onChange([...chosen]);
      };
      chips.appendChild(c);
    }
    input.placeholder = chosen.size ? "" : placeholder;
  };
  const openList = () => {
    const term = input.value.trim().toUpperCase();
    const hits = options.filter((o) => !chosen.has(o) && o.toUpperCase().includes(term));
    list.innerHTML = "";
    for (const o of hits.slice(0, 40)) {
      const it = el(`<div class="tp-opt">${F.escapeHtml(o)}</div>`);
      it.onmousedown = (ev) => {
        ev.preventDefault();
        chosen.add(o); input.value = ""; draw(); openList(); onChange([...chosen]);
      };
      list.appendChild(it);
    }
    list.classList.toggle("hidden", !hits.length);
  };
  input.addEventListener("focus", openList);
  input.addEventListener("input", openList);
  input.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 150));
  host.reset = () => { chosen.clear(); draw(); };
  host.add = (v) => { if (options.includes(v)) { chosen.add(v); draw(); } };
  draw();
  return host;
}

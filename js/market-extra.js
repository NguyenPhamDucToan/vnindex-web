// Two market-view additions:
//  - breadthCard: share of listed stocks above their 50/200-session averages
//    (data/breadth.json, add_momentum.py) with VN-Index alongside, so a rally
//    carried by a handful of large caps shows as an index rising on thin breadth.
//  - renderEvents: the "Sự kiện" tab -- upcoming rights and dividends and recent
//    insider deals across the market (data/events.json, add_events.py). The
//    stock page shows the same blocks per ticker.
import * as F from "./format.js";
import { KIND_VI } from "./corp-actions.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => F.escapeHtml(s ?? "");
const getJSON = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export async function breadthCard(root) {
  const b = await getJSON("data/breadth.json");
  if (!b || !Array.isArray(b.dates) || b.dates.length < 20) return;
  const last = b.dates.length - 1;
  const p50 = b.ma50[last], p200 = b.ma200[last];
  const read = (p) => (p >= 0.6 ? "rộng, đa số cổ phiếu đang khỏe" : p <= 0.35 ? "hẹp, đa số cổ phiếu đang yếu" : "trung tính");
  const card = el(`<div class="card mk-breadth">
    <h2 class="sec-h">Độ rộng thị trường</h2>
    <div class="chart-sub"><span>Tỷ lệ cổ phiếu có giá trên đường trung bình 50 và 200 phiên.</span>
      <span>Hiện ${F.isNum(p50) ? Math.round(p50 * 100) : "—"}% trên MA50, ${F.isNum(p200) ? Math.round(p200 * 100) : "—"}% trên MA200:</span>
      <b>${F.isNum(p50) ? read(p50) : ""}</b>.</div>
    <div id="breadth-chart"></div>
    <div class="vb-note">Chỉ số tăng mà độ rộng giảm nghĩa là vài mã vốn hoá lớn đang kéo chỉ số, phần lớn thị trường không đi theo.</div></div>`);
  root.appendChild(card);
  const pct = (xs) => xs.map((v) => (F.isNum(v) ? v * 100 : null));
  window.Plotly.react(card.querySelector("#breadth-chart"), [
    // VN-Index first so it sits behind: a faint reference, not a third series to read.
    { type: "scatter", mode: "lines", name: "VN-Index", x: b.dates, y: b.vni, yaxis: "y2",
      line: { color: "rgba(100,116,139,0.45)", width: 1.4 }, connectgaps: true,
      hovertemplate: "%{y:,.0f}<extra>VN-Index</extra>" },
    { type: "scatter", mode: "lines", name: "% trên MA50", x: b.dates, y: pct(b.ma50),
      line: { color: "#2563eb", width: 2.4 }, hovertemplate: "%{y:.0f}%<extra>% trên MA50</extra>" },
    { type: "scatter", mode: "lines", name: "% trên MA200", x: b.dates, y: pct(b.ma200),
      line: { color: "#d97706", width: 2.4 }, hovertemplate: "%{y:.0f}%<extra>% trên MA200</extra>" },
  ], {
    height: 320, dragmode: false, margin: { l: 48, r: 58, t: 12, b: 32 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Fira Code, monospace", size: 11, color: "#0a121d" },
    legend: { orientation: "h", y: 1.1, x: 0, font: { size: 11 } }, hovermode: "x unified",
    xaxis: { showgrid: false, tickfont: { size: 11 }, hoverformat: "%d/%m/%Y" },
    yaxis: { range: [0, 100], ticksuffix: "%", gridcolor: "rgba(148,163,184,0.18)", tickfont: { size: 11 }, dtick: 25 },
    yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: { size: 10, color: "#94a3b8" }, tickformat: ",.0f" },
    // Zones: above 70% most stocks are in uptrends, below 30% most are not.
    shapes: [
      { type: "rect", xref: "paper", x0: 0, x1: 1, y0: 70, y1: 100, fillcolor: "rgba(22,163,74,0.07)", line: { width: 0 }, layer: "below" },
      { type: "rect", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 30, fillcolor: "rgba(220,38,38,0.06)", line: { width: 0 }, layer: "below" },
    ],
    annotations: [
      { xref: "paper", x: 0.005, y: 97, xanchor: "left", yanchor: "top", showarrow: false, text: "vùng mạnh", font: { size: 10, color: "#15803d" } },
      { xref: "paper", x: 0.005, y: 3, xanchor: "left", yanchor: "bottom", showarrow: false, text: "vùng yếu", font: { size: 10, color: "#b91c1c" } },
    ],
  }, { displayModeBar: false, responsive: true });
  return { card, p50, p200 };
}

// ── "Sự kiện" tab ────────────────────────────────────────────────────
const WHO_VI = { ind: "Cá nhân nội bộ", rel: "Người liên quan", org: "Tổ chức" };
const WHO_HUE = { ind: "#2563eb", rel: "#7c3aed", org: "#0f766e" };
const KIND_HUE = { cash: "#0f766e", stock: "#7c3aed", issue: "#b45309" };
const KIND_GROUP = { cash: "cash", stock: "stock", bonus: "stock", rights: "issue", esop: "issue", private: "issue",
                     public: "issue", convert: "issue", merger: "issue", other: "issue" };
const ratio = (r) => (r * 100).toLocaleString("en-US", { maximumFractionDigits: r < 0.01 ? 2 : 1 }) + "%";
const pctSh = (f) => {
  if (!F.isNum(f)) return "—";
  const p = f * 100;
  return p < 0.001 ? "<0.001%" : p.toFixed(p < 0.01 ? 3 : 2) + "%";
};
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const SUB12 = "Lãnh đạo, người liên quan và tổ chức đăng ký hoặc báo cáo giao dịch trong 12 tháng qua.";
const SUB24 = "Giao dịch của mã đang tìm trong 2 năm qua.";
const qty = (q) => (q >= 1e6 ? (q / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " tr" : q.toLocaleString("en-US"));

function sortable(tw, cols, rows, rowHtml, state, onRow) {
  const draw = () => {
    const c = cols.find((x) => x[0] === state.key);
    const list = c ? rows.slice().sort((a, b) => {
      const x = c[2](a), y = c[2](b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "vi") : x - y) * state.dir;
    }) : rows;
    tw.innerHTML = list.length ? `<table class="screen ev-table"><thead><tr>${cols.map(([k, h]) =>
      `<th data-k="${k}"><span>${h}</span>${state.key === k ? `<span class="eb-arrow">${state.dir < 0 ? "▼" : "▲"}</span>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${list.map(rowHtml).join("")}</tbody></table>`
      : `<div class="dim eb-empty">Không có sự kiện nào trong nhóm này.</div>`;
    tw.querySelectorAll("tbody tr").forEach((tr) => { tr.onclick = () => onRow(tr.dataset.t); });
    tw.querySelectorAll("th[data-k]").forEach((th) => {
      th.onclick = () => {
        if (state.key === th.dataset.k) state.dir = -state.dir; else { state.key = th.dataset.k; state.dir = 1; }
        draw();
      };
    });
  };
  draw();
}

function chips(host, opts, active, onPick) {
  host.innerHTML = opts.map(([k, l, n]) =>
    `<button class="range-btn${k === active ? " active" : ""}" data-k="${k}">${l}${n == null ? "" : ` <span class="eb-n">${n}</span>`}</button>`).join("");
  host.querySelectorAll(".range-btn").forEach((b) => { b.onclick = () => onPick(b.dataset.k); });
}

export async function renderEvents(root, selectTicker) {
  const ev = await getJSON("data/events.json");
  if (!ev) { root.innerHTML = `<div class="card dim">Chưa có dữ liệu sự kiện.</div>`; return; }
  const today = new Date().toISOString().slice(0, 10);

  // Search: one box filters both tables by ticker or company name.
  const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
  let q = "";
  const hit = (r) => !q || r.ticker.toLowerCase().startsWith(q) || norm(r.co).includes(q);
  const sCard = el(`<div class="card ev-search">
    <input type="search" class="ev-q" placeholder="Tìm mã hoặc tên công ty… (vd: HPG)" autocomplete="off" />
    <span class="ev-q-out dim"></span></div>`);
  root.appendChild(sCard);

  // Rights and dividends
  const actsAll = (ev.actions || []).filter((a) => a.ex >= today);
  let acts = actsAll;
  const aCard = el(`<div class="card"><h2 class="sec-h">Quyền & cổ tức sắp tới</h2>
    <div class="chart-sub">Ngày giao dịch không hưởng quyền (GDKHQ) trong 120 ngày tới. Mua trước ngày GDKHQ mới được nhận quyền.</div>
    <div class="range-row eb-tabs"></div><div class="ev-tw"></div></div>`);
  root.appendChild(aCard);
  const aCols = [
    ["ex", "Ngày GDKHQ", (a) => a.ex], ["tk", "Mã", (a) => a.ticker], ["kind", "Loại", (a) => KIND_VI[a.kind] || a.kind],
    ["amt", "Tỷ lệ / tiền", (a) => (a.kind === "cash" ? a.cash : a.ratio)], ["y", "Tỷ suất", (a) => a.yield],
    ["rec", "Ngày chốt", (a) => a.record || ""], ["pay", "Ngày trả", (a) => a.pay || ""],
  ];
  const aRow = (a) => {
    const c = KIND_HUE[KIND_GROUP[a.kind] || "issue"];
    const days = Math.round((Date.parse(a.ex) - Date.parse(today)) / 86400000);
    const soon = days <= 0 ? "hôm nay" : days === 1 ? "ngày mai" : `còn ${days} ngày`;
    const yc = !F.isNum(a.yield) ? "" : a.yield >= 0.05 ? "ev-y3" : a.yield >= 0.03 ? "ev-y2" : "ev-y1";
    return `<tr data-t="${esc(a.ticker)}" class="ev-r" style="--c:${c}">
    <td>${F.dateVN(a.ex)}<div><span class="ev-soon${days <= 3 ? " ev-hot" : ""}">${soon}</span></div></td>
    <td><b>${esc(a.ticker)}</b><div class="eb-nm" title="${esc(a.co)}">${esc(a.co)}</div></td>
    <td><span class="ev-pill" style="--c:${c}">${esc(KIND_VI[a.kind] || a.kind)}</span></td>
    <td>${a.kind === "cash" ? (F.isNum(a.cash) ? `${F.rawVND(a.cash)}đ/cp` : "—") : (F.isNum(a.ratio) && a.ratio > 0 ? ratio(a.ratio) : "—")}</td>
    <td>${F.isNum(a.yield) ? `<span class="ev-y ${yc}">${F.pct(a.yield, 1)}</span>` : `<span class="dim">—</span>`}</td>
    <td>${a.record ? F.dateVN(a.record) : "—"}</td><td>${a.pay ? F.dateVN(a.pay) : "—"}</td></tr>`;
  };
  const aState = { key: "ex", dir: 1 };
  const aGroups = [["all", "Tất cả"], ["cash", "Cổ tức tiền"], ["stock", "Cổ tức cổ phiếu & thưởng"], ["issue", "Quyền mua & phát hành"]];
  const aPick = (g) => {
    const rows = g === "all" ? acts : acts.filter((a) => KIND_GROUP[a.kind] === g);
    chips(aCard.querySelector(".eb-tabs"), aGroups.map(([k, l]) =>
      [k, l, k === "all" ? acts.length : acts.filter((a) => KIND_GROUP[a.kind] === k).length]), g, aPick);
    sortable(aCard.querySelector(".ev-tw"), aCols, rows, aRow, aState, selectTicker);
  };
  let aG = "all";
  const aPick0 = aPick;
  aPick("all");

  // Insider deals
  // events.json carries 2 years: the table shows 12 months, a search both years.
  const dealsYear = ev.insiders || [];
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const dealsAll = dealsYear.filter((d) => d.date >= since);
  let deals = dealsAll;
  const iCard = el(`<div class="card"><h2 class="sec-h">Giao dịch nội bộ gần đây</h2>
    <div class="chart-sub"><span class="ev-ins-sub">${SUB12}</span>
      <span>Đăng ký là ý định, chưa chắc đã thực hiện; đã thực hiện là có báo cáo kết quả.</span></div>
    <div class="ev-toolbar"><div class="range-row eb-tabs"></div>
    <div class="ev-legend"> <span><span class="ev-pill ev-done" style="--c:#0f766e">Đã thực hiện</span> <span>có báo cáo kết quả</span></span> <span><span class="ev-pill ev-reg" style="--c:#d97706">Đăng ký</span> <span>còn trong thời hạn giao dịch</span></span> <span><span class="ev-pill ev-reg" style="--c:#64748b">Đăng ký</span> <span>hết hạn, chưa có báo cáo kết quả</span></span> </div></div><div class="ev-tw"></div></div>`);
  root.appendChild(iCard);
  const done = (d) => d.status === "result" || d.status === "done";
  const iCols = [
    ["d", "Ngày công bố", (d) => d.date], ["tk", "Mã", (d) => d.ticker], ["who", "Người / tổ chức", (d) => d.name || ""],
    ["side", "Mua / bán", (d) => d.side], ["q", "Khối lượng", (d) => d.qty], ["p", "% cổ phần", (d) => d.pct],
    ["v", "Giá trị (tỷ)", (d) => d.value], ["st", "Trạng thái", (d) => (done(d) ? 1 : 0)],
  ];
  const iRow = (d) => {
    const buy = d.side === "buy", c = buy ? "#15803d" : "#b91c1c";
    return `<tr data-t="${esc(d.ticker)}" class="ev-r" style="--c:${c}">
    <td>${F.dateVN(d.date)}</td>
    <td><b>${esc(d.ticker)}</b><div class="eb-nm" title="${esc(d.co)}">${esc(d.co)}</div></td>
    <td class="ev-who"><div class="ev-nm" title="${esc(d.name)}">${esc(d.name)}</div><span class="ev-tag" style="--c:${WHO_HUE[d.who] || "#64748b"}">${esc(WHO_VI[d.who] || "")}</span></td>
    <td><span class="ev-side ${buy ? "ev-buy" : "ev-sell"}"><span>${buy ? "▲" : "▼"}</span> <span>${buy ? "Mua" : "Bán"}</span></span></td>
    <td>${qty(d.qty)}</td><td>${pctSh(d.pct)}</td>
    <td>${F.isNum(d.value) ? `<span class="${d.value >= 10 ? "ev-big" : ""}">${d.value.toLocaleString("en-US", { maximumFractionDigits: d.value < 10 ? 1 : 0 })}</span>` : "—"}</td>
    <td class="ev-st">${done(d) ? `<span class="ev-pill ev-done" style="--c:#0f766e">Đã thực hiện</span>`
      : `<span class="ev-pill ev-reg" style="--c:${d.end && d.end < today ? "#64748b" : "#d97706"}" title="${d.end && d.end < today ? "Đã hết thời hạn đăng ký, chưa có báo cáo kết quả" : "Đang trong thời gian giao dịch đã đăng ký"}">Đăng ký</span>${d.start ? `<div class="eb-nm" title="${F.dateVN(d.start)} – ${d.end ? F.dateVN(d.end) : "?"}">${dm(d.start)}–${d.end ? dm(d.end) : "?"}</div>` : ""}`}</td></tr>`;
  };
  const iState = { key: "d", dir: -1 };
  const iGroups = [["all", "Tất cả"], ["buy", "Mua"], ["sell", "Bán"], ["done", "Đã thực hiện"]];
  const iFilter = (g) => (g === "all" ? deals : g === "done" ? deals.filter(done) : deals.filter((d) => d.side === g));
  const iPick = (g) => {
    chips(iCard.querySelector(".eb-tabs"), iGroups.map(([k, l]) => [k, l, iFilter(k).length]), g, iPick);
    sortable(iCard.querySelector(".ev-tw"), iCols, iFilter(g), iRow, iState, selectTicker);
  };
  let iG = "all";
  iPick("all");

  const out = sCard.querySelector(".ev-q-out");
  out.textContent = `${actsAll.length} sự kiện quyền sắp tới · ${dealsAll.length} giao dịch nội bộ trong 12 tháng`;
  sCard.querySelector(".ev-q").addEventListener("input", (e) => {
    q = norm(e.target.value.trim());
    acts = actsAll.filter(hit);
    deals = q ? dealsYear.filter(hit) : dealsAll;
    iCard.querySelector(".ev-ins-sub").textContent = q ? SUB24 : SUB12;
    aG = aCard.querySelector(".eb-tabs .active")?.dataset.k || "all";
    iG = iCard.querySelector(".eb-tabs .active")?.dataset.k || "all";
    aPick0(aG);
    iPick(iG);
    out.textContent = q ? `${acts.length} sự kiện quyền sắp tới · ${deals.length} giao dịch nội bộ trong 2 năm`
      : `${actsAll.length} sự kiện quyền sắp tới · ${dealsAll.length} giao dịch nội bộ trong 12 tháng`;
  });
}

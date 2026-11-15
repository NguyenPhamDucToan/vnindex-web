// "Kết quả kinh doanh quý": the quarter's standouts on the market view.
//
// Growth is the latest quarter against the same quarter a year earlier
// (add_growth.py), so seasonality cancels. Each name is set against its
// sector's median, because +40% means little in a sector where everyone grew
// 40%. The reaction column is the earnings block's [0,+5] return minus
// VN-Index. A fourth tab lists figures companies restated after first
// publishing them (data/revisions.json, from the sibling's financial_revisions).
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => F.escapeHtml(s ?? "");

// A year-earlier profit under 5bn VND makes any ratio a small-base artefact.
const MIN_BASE = 5;
const RULES = {
  spike: { label: "Tăng đột biến", hint: "Doanh thu +30% và lợi nhuận +50% so với cùng quý năm trước",
           test: (r) => r.rev_yoy >= 0.3 && r.ni_yoy >= 0.5 && r.ni_p >= MIN_BASE, sort: (a, b) => b.ni_yoy - a.ni_yoy },
  turn: { label: "Lãi trở lại", hint: "Cùng quý năm trước lỗ, quý này lãi từ 5 tỷ",
          test: (r) => F.isNum(r.ni_p) && r.ni_p <= 0 && r.ni_q >= MIN_BASE, sort: (a, b) => b.ni_q - a.ni_q },
  drop: { label: "Giảm mạnh", hint: "Lợi nhuận giảm từ 50% so với cùng quý năm trước, hoặc chuyển sang lỗ",
          test: (r) => r.ni_p >= MIN_BASE && F.isNum(r.ni_q) && r.ni_q <= r.ni_p * 0.5, sort: (a, b) => (a.ni_q / a.ni_p) - (b.ni_q / b.ni_p) },
};
const FIELD_VI = { revenue: "Doanh thu", net_income: "Lợi nhuận sau thuế", equity: "Vốn chủ sở hữu",
                   total_assets: "Tổng tài sản", operating_cf: "Dòng tiền kinh doanh" };

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const qLabel = (q) => { const [y, n] = String(q).split("-Q"); return `quý ${n}/${y}`; };
const bn = (v) => (F.isNum(v) ? Math.round(v).toLocaleString("en-US") : "—");
const pctCell = (g, good = 0.3) => {
  if (!F.isNum(g)) return `<span class="dim">—</span>`;
  const v = g * 100;
  return `<span class="${g >= good ? "gain" : g <= -good ? "loss" : ""}">${v > 999 ? ">+999%" : F.pctSigned(v, 0)}</span>`;
};
const niCell = (r) => {
  if (F.isNum(r.ni_yoy)) return pctCell(r.ni_yoy, 0.3);
  if (F.isNum(r.ni_p) && r.ni_p <= 0 && F.isNum(r.ni_q))
    return r.ni_q > 0 ? `<span class="gain">lãi trở lại</span>` : `<span class="dim">vẫn lỗ</span>`;
  return `<span class="dim">—</span>`;
};

export function renderEarningsBoard(root, rows, revisions, selectTicker, openScreen) {
  // The quarter most of the market has reported.
  const cnt = {};
  for (const r of rows) if (r.g_q) cnt[r.g_q] = (cnt[r.g_q] || 0) + 1;
  const q = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || b.localeCompare(a))[0];
  if (!q) return;
  const cur = rows.filter((r) => r.g_q === q);

  const secMed = {};
  const bySec = {};
  for (const r of cur) if (r.sector && F.isNum(r.ni_yoy) && r.ni_p >= MIN_BASE) (bySec[r.sector] ||= []).push(r.ni_yoy);
  for (const [s, xs] of Object.entries(bySec)) if (xs.length >= 3) secMed[s] = median(xs);

  const lists = Object.fromEntries(Object.entries(RULES).map(([k, R]) =>
    [k, cur.filter((r) => { try { return R.test(r); } catch { return false; } }).sort(R.sort)]));
  const revItems = (revisions?.items || []);
  const byTk = Object.fromEntries(rows.map((r) => [r.ticker, r]));

  const card = el(`<div class="card eb-card">
    <h2 class="sec-h">Kết quả kinh doanh ${qLabel(q)}: nổi bật</h2>
    <div class="chart-sub"><span>${cur.length}/${rows.length} mã đã có báo cáo ${qLabel(q)}.</span> <span>So với cùng quý năm trước; lợi nhuận là lợi nhuận sau thuế.</span></div>
    <div class="range-row eb-tabs"></div>
    <div class="eb-hint vb-note"></div>
    <div class="eb-tw"></div></div>`);
  const tabs = card.querySelector(".eb-tabs");
  const tw = card.querySelector(".eb-tw");
  const hint = card.querySelector(".eb-hint");

  const keys = [...Object.keys(RULES), ...(revisions ? ["rev"] : [])];
  for (const k of keys) {
    const n = k === "rev" ? revItems.length : lists[k].length;
    const label = k === "rev" ? "Sửa số liệu" : RULES[k].label;
    const b = el(`<button class="range-btn" data-k="${k}">${label} <span class="eb-n">${n}</span></button>`);
    b.onclick = () => show(k);
    tabs.appendChild(b);
  }

  let sortKey = null, sortDir = -1;
  const COLS = [
    ["tk", "Mã", (r) => r.ticker],
    ["sec", "Ngành", (r) => r.sector || ""],
    ["rev", "DT quý (tỷ)", (r) => r.rev_q],
    ["rg", "DT YoY", (r) => r.rev_yoy],
    ["ni", "LN quý (tỷ)", (r) => r.ni_q],
    ["ng", "LN YoY", (r) => r.ni_yoy],
    ["med", "LN YoY ngành", (r) => secMed[r.sector]],
    ["ytd", "LN lũy kế YoY", (r) => r.ni_ytd_yoy],
    ["d5", "Giá 5 phiên sau BCTC", (r) => r.er_d5],
  ];
  const TITLES = {
    med: "Trung vị tăng trưởng lợi nhuận cùng quý của các mã cùng ngành (cần ít nhất 3 mã)",
    ytd: "Lợi nhuận cộng dồn từ đầu năm so với cùng kỳ năm trước",
    d5: "Biến động giá từ ngày ra báo cáo đến 5 phiên sau, trừ đi VN-Index",
  };

  function table(list) {
    if (!list.length) return `<div class="dim eb-empty">Chưa có mã nào trong nhóm này.</div>`;
    let sorted = list;
    if (sortKey) {
      const f = COLS.find((c) => c[0] === sortKey)[2];
      sorted = list.slice().sort((a, b) => {
        const x = f(a), y = f(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y, "vi") : x - y) * sortDir;
      });
    }
    return `<table class="screen eb-table"><thead><tr>${COLS.map(([k, h]) =>
      `<th data-k="${k}" title="${esc(TITLES[k] || "")}"><span>${h}</span>${sortKey === k ? `<span class="eb-arrow">${sortDir < 0 ? "▼" : "▲"}</span>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r) => {
        const m = secMed[r.sector];
        const vs = F.isNum(m) && F.isNum(r.ni_yoy) ? r.ni_yoy - m : null;
        return `<tr data-t="${esc(r.ticker)}">
          <td><b>${esc(r.ticker)}</b><div class="eb-nm" title="${esc(r.name)}">${esc(r.name)}</div></td>
          <td class="dim">${esc(r.sector)}</td>
          <td>${bn(r.rev_q)}</td><td>${pctCell(r.rev_yoy)}</td>
          <td>${bn(r.ni_q)}</td><td>${niCell(r)}</td>
          <td>${F.isNum(m) ? `${pctCell(m)}${vs == null ? "" : `<div class="eb-vs ${vs >= 0 ? "gain" : "loss"}">${Math.abs(vs * 100) > 999 ? (vs > 0 ? ">+999" : "<−999") : `${vs >= 0 ? "+" : "−"}${Math.abs(vs * 100).toFixed(0)}`} điểm</div>`}` : `<span class="dim">—</span>`}</td>
          <td>${pctCell(r.ni_ytd_yoy)}</td>
          <td>${F.isNum(r.er_d5) ? `<span class="${r.er_d5 >= 0 ? "gain" : "loss"}">${F.pctSigned(r.er_d5 * 100, 1)}</span>` : `<span class="dim">—</span>`}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  function revTable() {
    if (!revItems.length)
      return `<div class="dim eb-empty">Chưa phát hiện công ty nào sửa số liệu đã công bố. Mỗi lần tải lại báo cáo, số mới được so với số đã lưu; chênh lệch từ 1% (và từ 1 tỷ) được ghi lại ở đây.</div>`;
    return `<table class="screen eb-table"><thead><tr><th>Mã</th><th>Kỳ</th><th>Phát hiện</th><th>Chỉ tiêu: số cũ → số mới (tỷ)</th></tr></thead>
      <tbody>${revItems.map((it) => {
        const nm = byTk[it.ticker]?.name || "";
        const per = it.type === "Y" ? `năm ${it.period}` : qLabel(it.period);
        const fs = Object.entries(it.fields).map(([f, [a, b]]) => {
          const d = F.isNum(a) && F.isNum(b) && a !== 0 ? (b - a) / Math.abs(a) : null;
          return `<div><span>${FIELD_VI[f] || esc(f)}</span>: ${bn(a)} → <b>${bn(b)}</b>${d == null ? "" : ` <span class="${d >= 0 ? "gain" : "loss"}">(${F.pctSigned(d * 100, 1)})</span>`}</div>`;
        }).join("");
        return `<tr data-t="${esc(it.ticker)}"><td><b>${esc(it.ticker)}</b><div class="eb-nm" title="${esc(nm)}">${esc(nm)}</div></td>
          <td>${per}</td><td>${F.dateVN(it.date)}</td><td class="eb-fs">${fs}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  let active = null;
  function show(k) {
    active = k;
    tabs.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b.dataset.k === k));
    hint.innerHTML = k === "rev" ? "Số liệu kỳ trước bị công ty điều chỉnh sau khi đã công bố (soát xét, kiểm toán, hợp nhất lại)."
      : `<span>${RULES[k].hint}.</span> <span>Bấm tiêu đề cột để sắp xếp.</span>${k === "spike" ? ` <a href="#screen?p=spike" class="eb-open">Mở trong Sàng lọc</a>` : ""}`;
    const open = hint.querySelector(".eb-open");
    if (open) open.onclick = (e) => { e.preventDefault(); openScreen("#screen?p=spike&liq=1&rg=30&ng=50"); };
    tw.innerHTML = k === "rev" ? revTable() : table(lists[k]);
    tw.querySelectorAll("tbody tr").forEach((tr) => { tr.onclick = () => selectTicker(tr.dataset.t); });
    tw.querySelectorAll("th[data-k]").forEach((th) => {
      th.onclick = () => {
        if (sortKey === th.dataset.k) sortDir = -sortDir;
        else { sortKey = th.dataset.k; sortDir = ["tk", "sec"].includes(sortKey) ? 1 : -1; }
        show(active);
      };
    });
  }
  show("spike");
  root.appendChild(card);
}

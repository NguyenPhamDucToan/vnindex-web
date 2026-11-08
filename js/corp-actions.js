// Corporate actions on the stock page (plan Days 98-99): the exchange's list of
// cash dividends and share issues (`actions`, export_actions.py).
//
// The stored prices are VCI's adjusted history -- already adjusted for cash
// dividends, bonus shares, stock dividends and rights (corp_actions.py) -- so
// the chart needs no mode switch; this module marks the ex-dates on it and
// renders the "Quyền & cổ tức" card. Historical closes are adjusted prices, so
// a per-event yield computed from them would be overstated; only the trailing
// 12-month yield against today's (unadjusted) price is shown.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export const KIND_VI = {
  cash: "Cổ tức tiền", stock: "Cổ tức cổ phiếu", bonus: "Cổ phiếu thưởng",
  rights: "Quyền mua", esop: "Phát hành ESOP", private: "Phát hành riêng lẻ",
  convert: "Chuyển đổi trái phiếu", public: "Phát hành ra công chúng", merger: "Phát hành sáp nhập",
  other: "Phát hành khác",
};
// Kinds that change the reference price on the ex-date; the rest only add shares.
const PRICED = new Set(["cash", "stock", "bonus", "rights"]);
const DILUTING = new Set(["stock", "bonus", "rights", "esop", "private", "public", "convert", "merger"]);
export const KIND_COLOR = { cash: "#0f766e", stock: "#7c3aed", bonus: "#7c3aed", rights: "#b45309" };

const ratioText = (r) => (r * 100).toLocaleString("en-US", { maximumFractionDigits: r < 0.01 ? 2 : 1 }) + "%";

export function describe(a) {
  const name = KIND_VI[a.kind] || a.kind;
  if (a.kind === "cash") return `${name} ${F.rawVND(a.cash)}đ/cp`;
  return F.isNum(a.ratio) && a.ratio > 0 ? `${name} ${ratioText(a.ratio)}` : name;
}

// Chart markers: actions that moved the reference price, on their ex-date
// session (or the next one), within the bars given.
export function markers(actions, bars) {
  const dates = bars.map((r) => String(r.date).slice(0, 10));
  if (!dates.length) return [];
  const by = new Map();
  for (const a of actions || []) {
    if (!PRICED.has(a.kind) || !a.ex || a.ex < dates[0] || a.ex > dates[dates.length - 1]) continue;
    const i = dates.findIndex((d) => d >= a.ex);
    if (i < 0) continue;
    if (!by.has(i)) by.set(i, []);
    by.get(i).push(a);
  }
  return [...by.entries()].map(([i, acts]) => {
    const share = acts.find((a) => a.kind !== "cash");
    return { date: bars[i].date, low: bars[i].low, kind: share ? share.kind : "cash",
             text: acts.map(describe).join(" · ") };
  });
}

// "Quyền & cổ tức": upcoming first, then history newest first.
export function actionsSection(actions, prices) {
  const acts = (actions || []).filter((a) => a.kind !== "other" || a.ratio);
  if (!acts.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const key = (a) => a.ex || a.date || "";
  const upcoming = acts.filter((a) => key(a) > today).sort((a, b) => key(a).localeCompare(key(b)));
  const past = acts.filter((a) => key(a) <= today).sort((a, b) => key(b).localeCompare(key(a)));
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const lastClose = prices.length && F.isNum(prices[prices.length - 1].close) ? prices[prices.length - 1].close * 1000 : null;
  const cash12 = past.filter((a) => a.kind === "cash" && key(a) > ago(365) && F.isNum(a.cash))
    .reduce((s, a) => s + a.cash, 0);
  const share12 = past.filter((a) => (a.kind === "stock" || a.kind === "bonus") && key(a) > ago(365) && F.isNum(a.ratio));
  const dil5 = past.filter((a) => DILUTING.has(a.kind) && key(a) > ago(5 * 365) && F.isNum(a.ratio))
    .reduce((p, a) => p * (1 + a.ratio), 1) - 1;

  const row = (a, up) => {
    const amount = a.kind === "cash" ? (F.isNum(a.cash) ? F.rawVND(a.cash) + "đ" : "—")
                                     : (F.isNum(a.ratio) && a.ratio > 0 ? ratioText(a.ratio) : "—");
    const cls = [up ? "ca-up" : "", PRICED.has(a.kind) ? "" : "ca-minor"].join(" ").trim();
    return `<tr class="${cls}">
      <td>${F.dateVN(key(a))}${a.ex ? "" : "<span class='ca-nd' title='Nguồn không ghi ngày giao dịch không hưởng quyền; đây là ngày công bố'>*</span>"}</td>
      <td><span class="ca-dot" style="background:${KIND_COLOR[a.kind] || "#94a3b8"}"></span>${KIND_VI[a.kind] || a.kind}</td>
      <td class="num">${amount}</td>
      <td>${F.dateVN(a.pay) || "—"}</td></tr>`;
  };
  const LIMIT = 12;
  const card = el(`<details class="card ca">
    <summary class="sec-h">📅 Quyền &amp; cổ tức</summary>
    <div class="ca-kpis">
      <div><div class="ca-k">Cổ tức tiền 12 tháng</div><div class="ca-v">${cash12 ? F.rawVND(cash12) + "đ" : "—"}</div>
        <div class="ca-s">${cash12 && lastClose ? "lợi suất " + F.pct(cash12 / lastClose, 1) + " theo giá hiện tại" : "chưa trả trong 12 tháng"}</div></div>
      <div><div class="ca-k">Chia cổ phiếu 12 tháng</div><div class="ca-v">${share12.length ? share12.map((a) => ratioText(a.ratio)).join(" + ") : "—"}</div>
        <div class="ca-s">thưởng / cổ tức bằng cổ phiếu</div></div>
      <div><div class="ca-k">Pha loãng 5 năm</div><div class="ca-v">${dil5 > 0.0005 ? "+" + F.pct(dil5, 0) : "—"}</div>
        <div class="ca-s">số cổ phiếu tăng qua mọi đợt phát hành</div></div>
    </div>
    ${upcoming.length ? `<div class="ca-next">Sắp tới: ${upcoming.map((a) => `<b>${describe(a)}</b> — GDKHQ ${F.dateVN(key(a))}`).join(" · ")}</div>` : ""}
    <div class="ca-tw"><table class="ca-t">
      <thead><tr><th>Ngày GDKHQ</th><th>Loại</th><th class="num">Tỷ lệ / tiền</th><th>Ngày trả</th></tr></thead>
      <tbody>${upcoming.map((a) => row(a, true)).join("")}${past.slice(0, LIMIT).map((a) => row(a, false)).join("")}</tbody>
    </table></div>
    ${past.length > LIMIT ? `<button class="ca-more">Xem thêm ${past.length - LIMIT} sự kiện cũ hơn</button>` : ""}
    <div class="vb-note">Nguồn: lịch sự kiện quyền của sở giao dịch (qua VCI). Biểu đồ giá là giá đã điều chỉnh cho cổ tức và phát hành —
      tam giác ▲ đánh dấu ngày giao dịch không hưởng quyền. Tỷ lệ là số cổ phiếu mới trên mỗi cổ phiếu cũ.</div>
  </details>`);
  const more = card.querySelector(".ca-more");
  if (more) more.onclick = () => {
    card.querySelector("tbody").insertAdjacentHTML("beforeend", past.slice(LIMIT).map((a) => row(a, false)).join(""));
    more.remove();
  };
  if (upcoming.length) card.open = true;
  return card;
}

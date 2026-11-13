// Insider and major-holder deals on the stock page (plan Day 102), from the
// `insiders` block (export_actions.py): filings by individuals (board,
// management), related persons and organisations.
//
// "Đã thực hiện" = a result report exists (the feed keeps mostly those for
// older history; a registration followed by its report is one deal). Only
// these count toward the net figures -- many registrations are never carried
// through. Transfers inside one family show as a sale and a purchase and net
// out; the per-person table keeps them visible.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const WHO_VI = { ind: "Cá nhân nội bộ", rel: "Người liên quan", org: "Tổ chức" };
const BUY = "#16a34a", SELL = "#dc2626";
const PF = { family: "'Fira Code', monospace", size: 10, color: "#0a121d" };

const executed = (d) => d.status === "result" || d.status === "done";
const when = (d) => d.start || d.pub || "";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const qtyText = (q) => (q >= 1e6 ? (q / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " tr"
  : q.toLocaleString("en-US"));

function latestShares(financials) {
  const q = (financials || []).filter((r) => r.period_type === "Q" && F.isNum(r.shares_outstanding));
  return q.length ? q[q.length - 1].shares_outstanding * 1e6 : null;     // stored in millions
}

// Filings carry the REGISTERED quantity, and a holder who doesn't finish
// re-registers the rest (FSN Asia: five ADG sales of 6.2m..4.2m for ~2m
// actually sold). So each person counts once per side, at their largest
// filing in the window -- the same rule as export_actions.insider_net.
function net(deals, since) {
  const most = new Map();
  for (const d of deals) {
    if (!executed(d) || when(d) <= since) continue;
    const k = d.side + "|" + d.name;
    most.set(k, Math.max(most.get(k) || 0, d.qty));
  }
  let buy = 0, sell = 0, nBuyers = 0, nSellers = 0;
  for (const [k, q] of most) {
    if (k.startsWith("buy|")) { buy += q; nBuyers++; } else { sell += q; nSellers++; }
  }
  return { buy, sell, net: buy - sell, nBuyers, nSellers };
}

export function insidersSection(insiders, financials) {
  const deals = (insiders || []).filter((d) => F.isNum(d.qty) && d.qty > 0);
  if (!deals.length) return null;
  const shares = latestShares(financials);
  const today = new Date().toISOString().slice(0, 10);
  const pctOf = (q) => (shares ? q / shares : null);
  // A family member's 350,000 shares of HPG is 0.004% -- two decimals would print it as 0.00%.
  const fmtPct = (f, signed) => {
    if (!F.isNum(f)) return "—";
    const p = Math.abs(f * 100);
    const body = p === 0 ? "0" : p < 0.001 ? "<0.001" : p.toFixed(p < 0.01 ? 3 : 2);
    return (f < 0 ? "−" : signed && f > 0 ? "+" : "") + body + "%";
  };

  const kpi = (label, days) => {
    const s = net(deals, ago(days));
    const cls = s.net > 0 ? "gain" : s.net < 0 ? "loss" : "flat";
    const main = shares ? fmtPct(pctOf(s.net), true) : (s.net ? (s.net > 0 ? "+" : "−") + qtyText(Math.abs(s.net)) : "0");
    return `<div><div class="ca-k">Ròng ${label}</div><div class="ca-v ${cls}">${s.buy || s.sell ? main : "—"}</div>
      <div class="ca-s">${s.buy || s.sell ? `${s.nBuyers} người mua ${qtyText(s.buy)} · ${s.nSellers} người bán ${qtyText(s.sell)} cp` : "không có giao dịch"}</div></div>`;
  };
  const s12 = net(deals, ago(365));
  let mood = "";
  if (s12.buy || s12.sell) {
    const f = pctOf(s12.net);
    const big = F.isNum(f) ? Math.abs(f) >= 0.002 : Math.abs(s12.net) > 0;
    mood = s12.net > 0 && big ? `<span class="ins-mood gain">Nội bộ đang mua ròng</span>`
      : s12.net < 0 && big ? `<span class="ins-mood loss">Nội bộ đang bán ròng</span>`
      : `<span class="ins-mood flat">Mua bán cân bằng</span>`;
  }
  const open = deals.filter((d) => d.status === "reg" && (d.end || d.start || "") >= today)
    .sort((a, b) => when(a).localeCompare(when(b)));
  const hist = deals.slice().sort((a, b) => when(b).localeCompare(when(a)));

  const row = (d) => `<tr class="${d.status === "reg" ? "ins-reg" : ""}">
    <td>${F.dateVN(when(d))}</td>
    <td class="ins-nm" title="${F.escapeHtml(d.name)}">${F.escapeHtml(d.name)}</td>
    <td>${WHO_VI[d.who] || ""}</td>
    <td><span class="ins-side ${d.side}">${d.side === "buy" ? "Mua" : "Bán"}</span></td>
    <td class="num">${d.qty.toLocaleString("en-US")}</td>
    <td class="num">${shares ? fmtPct(pctOf(d.qty)) : "—"}</td>
    <td>${executed(d) ? "Đã thực hiện" : (d.end || "") >= today ? "Đang đăng ký" : "Đăng ký, chưa báo cáo"}</td></tr>`;
  const LIMIT = 12;
  const card = el(`<details class="card ca">
    <summary class="sec-h">👥 Giao dịch nội bộ &amp; cổ đông lớn ${mood}</summary>
    <div class="ca-kpis">${kpi("3 tháng", 91)}${kpi("6 tháng", 182)}${kpi("12 tháng", 365)}</div>
    ${open.length ? `<div class="ca-next">Đang đăng ký: ${open.map((d) =>
      `<b>${F.escapeHtml(d.name)}</b> ${d.side === "buy" ? "mua" : "bán"} ${qtyText(d.qty)} cp (${F.dateVN(d.start)}–${F.dateVN(d.end)})`).join(" · ")}</div>` : ""}
    <div class="ins-chart"></div>
    <div class="ca-tw"><table class="ca-t">
      <thead><tr><th>Ngày</th><th>Người / tổ chức</th><th>Nhóm</th><th>Lệnh</th><th class="num">Khối lượng</th><th class="num">% cổ phần</th><th>Trạng thái</th></tr></thead>
      <tbody>${hist.slice(0, LIMIT).map(row).join("")}</tbody>
    </table></div>
    ${hist.length > LIMIT ? `<button class="ca-more">Xem thêm ${hist.length - LIMIT} giao dịch cũ hơn</button>` : ""}
    <div class="vb-note">Nguồn: công bố giao dịch của người nội bộ, người liên quan và cổ đông lớn (qua VCI). Số ròng chỉ tính giao dịch
      đã có báo cáo kết quả. Khối lượng trên công bố là khối lượng <b>đăng ký</b>, và người chưa bán/mua hết thường đăng ký lại phần còn lại,
      nên mỗi người chỉ được tính một lần theo lần đăng ký lớn nhất — đây là mức tối đa, không phải khối lượng khớp thật. Chuyển nhượng trong cùng gia đình hiện thành một lệnh bán và một lệnh mua.
      % cổ phần tính trên số cổ phiếu lưu hành hiện tại.</div>
  </details>`);
  const more = card.querySelector(".ca-more");
  if (more) more.onclick = () => {
    card.querySelector("tbody").insertAdjacentHTML("beforeend", hist.slice(LIMIT).map(row).join(""));
    more.remove();
  };

  // Monthly executed buys (up) and sells (down), last 24 months.
  let drawn = false;
  const draw = () => {
    if (drawn) return;
    drawn = true;
    const months = [];
    const d0 = new Date(); d0.setDate(1);
    for (let k = 23; k >= 0; k--) {
      const d = new Date(d0.getFullYear(), d0.getMonth() - k, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const buy = Object.fromEntries(months.map((m) => [m, 0])), sell = { ...buy };
    for (const d of deals) {
      if (!executed(d)) continue;
      const m = when(d).slice(0, 7);
      if (!(m in buy)) continue;
      if (d.side === "buy") buy[m] += d.qty; else sell[m] += d.qty;
    }
    if (!months.some((m) => buy[m] || sell[m])) { card.querySelector(".ins-chart").remove(); return; }
    const scale = shares ? (q) => (q / shares) * 100 : (q) => q / 1e6;
    const unit = shares ? "% cổ phần" : "triệu cp";
    const lbl = months.map((m) => `${m.slice(5)}/${m.slice(2, 4)}`);
    window.Plotly.react(card.querySelector(".ins-chart"), [
      { type: "bar", x: lbl, y: months.map((m) => scale(buy[m])), name: "Mua", marker: { color: BUY },
        hovertemplate: `Mua %{y:.3f} ${unit}<extra></extra>` },
      { type: "bar", x: lbl, y: months.map((m) => -scale(sell[m])), name: "Bán", marker: { color: SELL },
        hovertemplate: `Bán %{customdata:.3f} ${unit}<extra></extra>`, customdata: months.map((m) => scale(sell[m])) },
    ], {
      barmode: "relative", height: 210, margin: { l: 48, r: 8, t: 8, b: 36 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: PF,
      xaxis: { type: "category", tickfont: { ...PF, size: 9 }, nticks: 12, fixedrange: true },
      yaxis: { title: { text: unit, font: { ...PF, size: 9 } }, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8", fixedrange: true },
      legend: { orientation: "h", y: -0.22, x: 0, font: { ...PF, size: 10 } }, hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });
  };
  card.addEventListener("toggle", () => { if (card.open) draw(); });
  if (open.length) card.open = true;          // its toggle handler draws once visible
  return card;
}

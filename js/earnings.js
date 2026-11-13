// Price reaction around quarterly earnings releases on the stock page (plan
// Days 107-108), from the `earnings` block (export_earnings.py).
//
// Returns are market-adjusted: the stock's move minus VNINDEX's over the same
// sessions. Session 0 is the first one the report could be traded in (a
// release stamped after the close counts from the next session). "Lãi tăng"
// = net income above the same quarter a year earlier.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const UP = "#16a34a", DOWN = "#dc2626", NA = "#94a3b8";
const PF = { family: "'Fira Code', monospace", size: 10, color: "#0a121d" };

const sp = (f, d = 1) => (F.isNum(f) ? (f > 0 ? "+" : f < 0 ? "−" : "") + Math.abs(f * 100).toFixed(d) + "%" : "—");
const cls = (f) => (!F.isNum(f) ? "" : f > 0 ? "gain" : f < 0 ? "loss" : "flat");
const qVN = (q) => `Q${q.slice(5)}/${q.slice(0, 4)}`;
const growthText = (g) => (!F.isNum(g) ? "—" : sp(g, 0));

export function earningsSection(earnings) {
  const ev = (earnings?.events || []).filter((e) => F.isNum(e.d1) || F.isNum(e.d5));
  const s = earnings?.summary;
  if (ev.length < 4 || !s) return null;                 // too few releases to say anything

  const nx = s.next;
  const nextKpi = nx ? `<div><div class="ca-k">Báo cáo kỳ tới (${qVN(nx.q)})</div>
      <div class="ca-v">${nx.overdue ? "Đã quá hạn" : "~" + F.dateVN(nx.date)}</div>
      <div class="ca-s">${nx.overdue ? `dự kiến ${F.dateVN(nx.date)}, chưa thấy công bố` : `thường ${nx.lag} ngày sau khi hết quý`}</div></div>` : "";
  const splitKpi = (s.up.n || s.down.n) ? `<div><div class="ca-k">5 phiên sau, theo lợi nhuận</div>
      <div class="ca-v"><span class="${cls(s.up.d5)}">${sp(s.up.d5)}</span> / <span class="${cls(s.down.d5)}">${sp(s.down.d5)}</span></div>
      <div class="ca-s">lãi tăng (${s.up.n} kỳ) / lãi giảm (${s.down.n} kỳ)</div></div>` : "";
  const hist = ev.slice().reverse();
  const row = (e) => `<tr>
    <td>${qVN(e.q)}</td><td>${F.dateVN(e.date)}</td>
    <td class="num ${cls(e.growth)}">${growthText(e.growth)}</td>
    <td class="num ${cls(e.pre)}">${sp(e.pre)}</td>
    <td class="num ${cls(e.d1)}"><b>${sp(e.d1)}</b></td>
    <td class="num ${cls(e.d5)}">${F.isNum(e.d5) ? sp(e.d5) : "<span class='muted'>chưa đủ</span>"}</td>
    <td class="num ${cls(e.d20)}">${F.isNum(e.d20) ? sp(e.d20) : "<span class='muted'>chưa đủ</span>"}</td></tr>`;
  const LIMIT = 8;
  const card = el(`<details class="card ca">
    <summary class="sec-h">📅 Giá phản ứng khi ra báo cáo quý</summary>
    <div class="ca-kpis">
      <div><div class="ca-k">Biến động 2 phiên đầu</div><div class="ca-v">±${(s.d1_abs * 100).toFixed(1)}%</div>
        <div class="ca-s">trung bình độ lớn, ${s.n} kỳ báo cáo</div></div>
      <div><div class="ca-k">Số kỳ giá vượt VNINDEX</div><div class="ca-v">${Math.round(s.d1_pos * 100)}%</div>
        <div class="ca-s">2 phiên đầu, trung bình <span class="${cls(s.d1_mean)}">${sp(s.d1_mean)}</span></div></div>
      ${splitKpi}${nextKpi}
    </div>
    <div class="ern-chart"></div>
    <div class="ca-tw"><table class="ca-t">
      <thead><tr><th>Quý</th><th>Phiên phản ứng</th><th class="num">LNST so cùng kỳ</th><th class="num">5 phiên trước</th>
        <th class="num">2 phiên đầu</th><th class="num">5 phiên</th><th class="num">20 phiên</th></tr></thead>
      <tbody>${hist.slice(0, LIMIT).map(row).join("")}</tbody>
    </table></div>
    ${hist.length > LIMIT ? `<button class="ca-more">Xem thêm ${hist.length - LIMIT} kỳ cũ hơn</button>` : ""}
    <div class="vb-note">Lợi nhuận vượt thị trường = giá cổ phiếu thay đổi trừ VNINDEX thay đổi trong cùng các phiên.
      Phiên phản ứng là phiên đầu tiên giao dịch được sau khi báo cáo lên hệ thống (báo cáo ra sau 15h tính từ phiên hôm sau);
      ngày lấy theo thời điểm báo cáo xuất hiện trên VCI, có thể muộn hơn công bố trên sở vài giờ.
      "5 phiên trước" cho thấy giá đã chạy trước tin hay chưa. Quá khứ không bảo đảm phản ứng lần sau.</div>
  </details>`);
  const more = card.querySelector(".ca-more");
  if (more) more.onclick = () => {
    card.querySelector("tbody").insertAdjacentHTML("beforeend", hist.slice(LIMIT).map(row).join(""));
    more.remove();
  };

  let drawn = false;
  const draw = () => {
    if (drawn) return;
    drawn = true;
    const xs = ev.map((e) => qVN(e.q));
    const y = ev.map((e) => (F.isNum(e.d5) ? e.d5 * 100 : null));
    const color = ev.map((e) => (!F.isNum(e.growth) ? NA : e.growth > 0 ? UP : DOWN));
    const tip = ev.map((e) => `${qVN(e.q)} · ${F.dateVN(e.date)}<br>LNST so cùng kỳ: ${growthText(e.growth)}`
      + `<br>2 phiên: ${sp(e.d1)} · 5 phiên: ${sp(e.d5)} · 20 phiên: ${sp(e.d20)}`);
    window.Plotly.react(card.querySelector(".ern-chart"), [{
      type: "bar", x: xs, y, marker: { color }, customdata: tip, hovertemplate: "%{customdata}<extra></extra>",
    }], {
      height: 236, margin: { l: 44, r: 8, t: 24, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: PF, showlegend: false,
      xaxis: { type: "category", tickfont: { ...PF, size: 9 }, nticks: 12, fixedrange: true },
      yaxis: { title: { text: "5 phiên so VNINDEX (%)", font: { ...PF, size: 9 } }, ticksuffix: "%",
        gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8", fixedrange: true },
      annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false,
        text: `<span style="color:${UP}">■</span> lãi tăng  <span style="color:${DOWN}">■</span> lãi giảm  <span style="color:${NA}">■</span> không so được`,
        font: { ...PF, size: 9 } }],
    }, { displayModeBar: false, responsive: true });
  };
  card.addEventListener("toggle", () => { if (card.open) draw(); });
  return card;
}

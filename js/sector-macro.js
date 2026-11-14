// "Vĩ mô tác động tới ngành": for one sector, the macro series that drive it,
// each as a small chart with its latest reading and whether the recent trend
// is good or bad for that sector (a stronger dollar hurts importers, helps
// seafood exporters). The trend rule is the one the macro page's pulse card uses.
import { loadMacro } from "./data.js";
import { pulseTrend, SERIES_INFO } from "./macro.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };

// sector -> [[macro key, +1 if a rise helps the sector / -1 if it hurts, why]]
const DRIVERS = {
  "Ngân hàng": [
    ["credit_growth_total", 1, "Tín dụng tăng nhanh = cho vay nhiều hơn, thu nhập lãi tăng."],
    ["deposit_12m_avg", -1, "Lãi huy động tăng = chi phí vốn tăng, biên lãi (NIM) dễ co lại."],
    ["gdp_growth", 1, "Kinh tế tốt = nợ xấu thấp, nhu cầu vay cao."]],
  "Chứng khoán": [
    ["deposit_12m_avg", -1, "Lãi tiết kiệm thấp đẩy tiền sang chứng khoán; tăng thì ngược lại."],
    ["credit_growth_total", 1, "Tín dụng nới = thanh khoản thị trường và cho vay margin tăng."],
    ["exchange_rate", -1, "Tỷ giá căng thường đi kèm khối ngoại bán ròng."]],
  "Bất động sản": [
    ["deposit_12m_avg", -1, "Lãi suất tăng = vay mua nhà đắt hơn, chủ đầu tư trả lãi nhiều hơn."],
    ["credit_growth_total", 1, "Tín dụng nới = người mua và chủ đầu tư dễ vay."],
    ["public_investment", 1, "Hạ tầng (đường, cầu) làm tăng giá trị quỹ đất."]],
  "Xây dựng": [
    ["public_investment", 1, "Giải ngân đầu tư công = đơn hàng trực tiếp của nhà thầu."],
    ["credit_growth_construction", 1, "Tín dụng cho ngành xây dựng."],
    ["deposit_12m_avg", -1, "Lãi suất tăng = chi phí vay vốn lưu động tăng."]],
  "Vật liệu xây dựng": [
    ["public_investment", 1, "Đầu tư công kéo nhu cầu thép, xi măng, đá."],
    ["iip_yoy", 1, "Sản xuất công nghiệp chung."],
    ["exports", 1, "Thép, xi măng xuất khẩu một phần đáng kể."]],
  "Bán lẻ": [
    ["retail_yoy", 1, "Sức mua của người dân, trực tiếp là doanh thu ngành."],
    ["cpi_yoy", -1, "Lạm phát cao bào mòn sức mua."],
    ["intl_visitors", 1, "Khách quốc tế tăng chi tiêu bán lẻ."]],
  "Thực phẩm - Đồ uống": [
    ["retail_yoy", 1, "Sức mua tiêu dùng."],
    ["cpi_food", -1, "Giá lương thực tăng = giá nguyên liệu đầu vào tăng."],
    ["intl_visitors", 1, "Khách quốc tế tăng tiêu dùng đồ uống, ăn uống."]],
  "SX Hàng gia dụng": [
    ["retail_yoy", 1, "Sức mua trong nước."],
    ["exports", 1, "Đồ gỗ, dệt may, gia dụng xuất khẩu."],
    ["exchange_rate", 1, "USD tăng giá = doanh thu xuất khẩu quy ra VND cao hơn."]],
  "Vận tải - kho bãi": [
    ["exports", 1, "Hàng xuất nhập khẩu qua cảng, logistics."],
    ["intl_visitors", 1, "Hàng không, vận tải hành khách."],
    ["cpi_transport", -1, "Giá xăng dầu (nhóm giao thông) là chi phí chính."]],
  "Dịch vụ lưu trú, ăn uống, giải trí": [
    ["intl_visitors", 1, "Khách quốc tế = khách sạn, nhà hàng, giải trí."],
    ["retail_yoy", 1, "Chi tiêu dịch vụ của người dân."]],
  "Chế biến Thủy sản": [
    ["exports", 1, "Doanh thu chủ yếu từ xuất khẩu."],
    ["exchange_rate", 1, "USD tăng giá = lợi cho nhà xuất khẩu."]],
  "SX Nhựa - Hóa chất": [
    ["iip_yoy", 1, "Nhu cầu từ sản xuất công nghiệp."],
    ["exports", 1, "Phân bón, hóa chất, nhựa xuất khẩu."],
    ["ppi_yoy", 1, "Giá bán đầu ra công nghiệp."]],
  "SX Phụ trợ": [
    ["iip_yoy", 1, "Đơn hàng theo chu kỳ sản xuất công nghiệp."],
    ["exports", 1, "Linh kiện, bao bì đi theo hàng xuất khẩu."]],
  "Thiết bị điện": [
    ["iip_yoy", 1, "Nhu cầu điện và thiết bị theo sản xuất công nghiệp."],
    ["public_investment", 1, "Lưới điện, hạ tầng."]],
  "Tiện ích": [
    ["iip_yoy", 1, "Sản xuất công nghiệp kéo tiêu thụ điện, nước, khí."],
    ["gdp_growth", 1, "Tăng trưởng chung."]],
  "Khai khoáng": [
    ["iip_yoy", 1, "Sản xuất công nghiệp (bao gồm khai khoáng)."],
    ["ppi_yoy", 1, "Giá đầu ra công nghiệp."],
    ["public_investment", 1, "Đá, cát cho công trình hạ tầng."]],
  "Bán buôn": [
    ["retail_yoy", 1, "Tiêu dùng cuối cùng."],
    ["imports", 1, "Hàng nhập khẩu phân phối lại."],
    ["exchange_rate", -1, "USD tăng giá = hàng nhập đắt hơn."]],
  "Công nghệ và thông tin": [
    ["exports", 1, "Phần mềm, dịch vụ CNTT xuất khẩu."],
    ["exchange_rate", 1, "Doanh thu bằng USD/JPY quy đổi."],
    ["gdp_growth", 1, "Chi tiêu chuyển đổi số trong nước."]],
  "Bảo hiểm": [
    ["deposit_12m_avg", 1, "Lãi suất cao = thu nhập đầu tư (tiền gửi, trái phiếu) tăng."],
    ["gdp_growth", 1, "Thu nhập tăng = mua bảo hiểm nhiều hơn."]],
  "Nông - Lâm - Ngư": [
    ["gdp_sector_agri", 1, "Tăng trưởng khu vực nông, lâm, thủy sản."],
    ["exports", 1, "Nông sản xuất khẩu."],
    ["cpi_food", 1, "Giá lương thực tăng = giá bán cao hơn."]],
  "Sản phẩm cao su": [
    ["exports", 1, "Cao su, săm lốp xuất khẩu."],
    ["exchange_rate", 1, "USD tăng giá lợi cho xuất khẩu."]],
  "Chăm sóc sức khỏe": [
    ["retail_yoy", 1, "Chi tiêu của người dân (thuốc OTC, dịch vụ)."],
    ["exchange_rate", -1, "Nguyên liệu thuốc phần lớn nhập khẩu."]],
};

// One driver's reading: the latest value and whether its recent trend helps
// (+1) or hurts (-1) the sector; cls "flat" when it is flat or too new to say.
function readDriver(macro, key, dir) {
  const info = SERIES_INFO[key];
  const pts = (macro[key] || []).filter((p) => p.value !== null && Number.isFinite(p.value));
  if (!info || !pts.length) return null;
  const t = pulseTrend(pts, info.how);
  const last = pts[pts.length - 1];
  let cls = "flat", word = "đi ngang / chưa đủ dữ liệu";
  if (t) {
    const eps = t.pct ? 0.3 : Math.max(0.05, Math.abs(last.value) * 0.01);
    if (Math.abs(t.d) >= eps) {
      const good = (t.d > 0) === (dir > 0);
      cls = good ? "gain" : "loss";
      word = `${t.d > 0 ? "▲ tăng" : "▼ giảm"} (${t.d >= 0 ? "+" : ""}${t.d.toFixed(1)}${t.pct ? "%" : ""} so với ${t.ref})
        → ${good ? "có lợi" : "bất lợi"} cho ngành`;
    }
  }
  return { info, pts, last, cls, word };
}

// "2/3 chỉ báo có lợi, 1 bất lợi" for a sector, or null if it has no drivers.
function tally(macro, sec) {
  const rs = (DRIVERS[sec] || []).map(([k, dir]) => readDriver(macro, k, dir)).filter(Boolean);
  if (!rs.length) return null;
  const up = rs.filter((r) => r.cls === "gain").length, down = rs.filter((r) => r.cls === "loss").length;
  return { n: rs.length, up, down, tone: up > down ? "gain" : down > up ? "loss" : "flat" };
}

function tallyText(t) {
  return `<b class="${t.tone}">${t.up}/${t.n}</b> chỉ báo vĩ mô đang có lợi cho ngành`
    + (t.down ? `, <b class="loss">${t.down}</b> bất lợi` : "");
}

function drawTiles(grid, macro, sec) {
  grid.innerHTML = "";
  for (const [key, dir, why] of DRIVERS[sec] || []) {
    const r = readDriver(macro, key, dir);
    if (!r) continue;
    const { info, pts, last, cls, word } = r;
    const per = info.how === "d63" ? String(last.period).slice(0, 10) : String(last.period).slice(0, 7);
    const box = el(`<div class="sm-tile ${cls}">
      <div class="sm-h">${info.label} <span class="sm-dir">${dir > 0 ? "tăng = tốt cho ngành" : "tăng = xấu cho ngành"}</span></div>
      <div class="sm-v">${last.value.toLocaleString("vi-VN", { maximumFractionDigits: info.dp })}${info.unit}
        <span class="sm-p">${per}</span></div>
      <div class="sm-t ${cls}">${word}</div>
      <div class="sm-c"></div>
      <div class="sm-w">${why}</div></div>`);
    grid.appendChild(box);
    // One reading so far (a daily series that has just started): a placeholder
    // the chart's height, so the tile lines up with its neighbours.
    if (pts.length < 2) {
      const since = String(pts[0].period).slice(0, 10).split("-").reverse().join("/");
      box.querySelector(".sm-c").outerHTML = `<div class="sm-ph"><div>📈 Biểu đồ đang được dựng</div>
        <div>Số liệu thu thập hằng ngày từ ${since}, biểu đồ hiện khi có từ 2 ngày trở lên.</div></div>`;
      continue;
    }
    const cut = new Date(last.period); cut.setFullYear(cut.getFullYear() - 3);
    const pp = pts.filter((p) => new Date(p.period) >= cut);
    const bar = info.how !== "d63" && pp.length < 60;
    window.Plotly.react(box.querySelector(".sm-c"), [{
      x: pp.map((p) => p.period), y: pp.map((p) => p.value), type: bar ? "bar" : "scatter",
      mode: bar ? undefined : "lines", marker: { color: "#2563eb" }, line: { color: "#2563eb", width: 1.5 },
      hovertemplate: `%{x|%m/%Y}: %{y:,.2f}${info.unit}<extra></extra>`,
    }], {
      height: 150, margin: { l: 40, r: 6, t: 4, b: 22 }, dragmode: false, showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Fira Code, monospace", size: 9, color: "#0a121d" },
      xaxis: { showgrid: false, tickfont: { size: 8 } },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 8 }, zerolinecolor: "#cbd5e1" },
    }, { displayModeBar: false, responsive: true });
  }
}

const NOTE = `<span class="gain">Xanh</span> = xu hướng gần đây có lợi cho ngành, <span class="loss">đỏ</span> = bất lợi
  (đã tính chiều: ví dụ USD tăng giá có lợi cho thủy sản nhưng bất lợi cho bán buôn hàng nhập).
  Cách tính xu hướng như thẻ "Bức tranh vĩ mô" ở trang Vĩ mô.`;

// The sector page's card, kept so the stock page can open it on one sector.
let sectorCard = null;

export async function sectorMacroCard(sectors) {
  const macro = await loadMacro();
  const names = sectors.filter((s) => DRIVERS[s]);
  if (!names.length) return null;
  const card = el(`<div class="card" id="sector-macro">
    <h2 class="sec-h">Vĩ mô tác động tới ngành</h2>
    <div class="sel-lab">Chọn ngành:</div>
    <select class="sm-sel">${names.map((s) => `<option>${s}</option>`).join("")}</select>
    <div class="sm-sum"></div>
    <div class="sm-grid"></div>
    <div class="vb-note">Mỗi biểu đồ là một chỉ báo vĩ mô ảnh hưởng tới ngành, 3 năm gần nhất. ${NOTE}</div></div>`);
  const sel = card.querySelector(".sm-sel");
  const draw = (sec) => {
    const t = tally(macro, sec);
    card.querySelector(".sm-sum").innerHTML = t ? tallyText(t) : "";
    drawTiles(card.querySelector(".sm-grid"), macro, sec);
  };
  sel.addEventListener("change", () => draw(sel.value));
  // Drawn once the card is in the page, so Plotly can measure its width.
  card.drawFirst = () => draw(pendingSector && names.includes(pendingSector) ? (sel.value = pendingSector) : names[0]);
  card.focus = (sec) => { if (names.includes(sec)) { sel.value = sec; draw(sec); } };
  sectorCard = card;
  return card;
}

// Called from the stock page's link: select the sector once the sector page
// exists (or as soon as it is built) and scroll to the card.
let pendingSector = null;
export function focusSector(sec) {
  pendingSector = sec;
  if (sectorCard) { sectorCard.focus(sec); sectorCard.scrollIntoView({ behavior: "smooth" }); return; }
  const wait = setInterval(() => {
    if (!sectorCard) return;
    clearInterval(wait);
    sectorCard.scrollIntoView({ behavior: "smooth" });
  }, 200);
  setTimeout(() => clearInterval(wait), 15000);
}

// Stock page: a <details> section for the tabbed card ("Vĩ mô ngành"), drawn
// on toggle like the other sections. `onOpenSector` jumps to the sector page.
export async function sectorMacroSection(sector, onOpenSector) {
  if (!DRIVERS[sector]) return null;
  const macro = await loadMacro().catch(() => null);
  if (!macro) return null;
  const t = tally(macro, sector);
  if (!t) return null;
  const d = el(`<details class="card sm-sec">
    <summary class="sec-h">🌐 Vĩ mô tác động tới ngành ${sector}</summary>
    <div class="sm-sum">${tallyText(t)}. <a href="#" class="sm-link">Xem mọi ngành →</a></div>
    <div class="sm-grid"></div>
    <div class="vb-note">${NOTE}</div></details>`);
  let drawn = false;
  d.addEventListener("toggle", () => {
    if (d.open && !drawn) { drawn = true; drawTiles(d.querySelector(".sm-grid"), macro, sector); }
  });
  d.querySelector(".sm-link").addEventListener("click", (e) => { e.preventDefault(); onOpenSector(sector); });
  return d;
}

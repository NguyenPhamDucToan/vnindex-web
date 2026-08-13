// Right-hand valuation panel — the "Ước tính Định giá" column from the
// Streamlit app: a two-across grid of per-method cards, then a highlighted
// winsorized-average card, then the DCF parameters behind the DCF figure.
//
// Method labels are sector-aware because the underlying multiple is swapped for
// financials and property (a bank's "EV/EBITDA" slot actually holds P/NII), so
// the label has to say what was really computed.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const MARKET_PE = 15;

function methodLabels(sector) {
  const bank = sector === "Ngân hàng", re = sector === "Bất động sản",
        sec = sector === "Chứng khoán", ins = sector === "Bảo hiểm";
  return [
    ["dcf", "DCF / FCFF", "DCF dựa trên NOPAT, chiết khấu ở WACC"],
    ["fcfe", "FCFE / Dòng tiền vốn chủ", "OCF−CapEx chiết khấu ở chi phí vốn chủ"],
    ["graham", "Graham Number", "√(22.5 × EPS × BVPS)"],
    ["pe", `P/E Implied (×${MARKET_PE})`, `EPS (TTM) × ${MARKET_PE}×`],
    ["pb", "P/B Implied (×1.5)", "BVPS × 1.5× (trung bình thị trường VN)"],
    ["ev_ebitda",
      bank ? "P/NII (×8)" : re ? "EV/EBITDA (×15)" : "EV/EBITDA (×8)",
      bank ? "Thu nhập lãi thuần/CP × 8×" : re ? "EBITDA × 15× − nợ ròng" : "EBITDA × 8× − nợ ròng"],
    ["epv",
      bank ? "P/PPOP (×6)" : re ? "NAV Proxy (Book×1.8)" : sec ? "Book Value (×1.2)" : ins ? "Embedded Value (×2.0)" : "Earnings Power Value",
      bank ? "LN trước dự phòng/CP × 6×" : re ? "Vốn chủ × 1.8 (quỹ đất)" : sec ? "Vốn chủ × 1.2" : ins ? "Vốn chủ × 2.0" : "NOPAT ÷ WACC, tăng trưởng 0"],
    ["ps",
      bank ? "P/TOI (×5)" : re ? "P/Revenue (×3.5)" : sec ? "P/Revenue (×3)" : ins ? "P/Revenue (×2)" : "P/Sales (×1.2)",
      bank ? "Tổng thu nhập/CP × 5×" : "Doanh thu/CP × bội số ngành"],
    ["ri", "Residual Income", "BVPS + phần ROE vượt trội"],
    ["pocf", "Price/OCF (×10)", "Dòng tiền HĐKD/CP × 10×"],
  ];
}

export function valuationPanel(co, model, priceRaw) {
  const methods = (model && model.methods) || {};
  const valid = methodLabels(co.sector).filter(([k]) => F.isNum(methods[k]) && methods[k] > 0);
  if (!valid.length) return null;

  const panel = el(`<div class="vpanel"><h2 class="sec-h vp-h">Ước tính Định giá</h2></div>`);
  if (F.isNum(priceRaw)) {
    panel.appendChild(el(`<div class="vp-mkt">Giá thị trường hiện tại: <b>${F.rawVND(priceRaw)} ₫</b></div>`));
  }

  const grid = el(`<div class="vp-grid"></div>`);
  for (const [key, label, hint] of valid) {
    const price = methods[key];
    const u = priceRaw ? (price - priceRaw) / priceRaw * 100 : null;
    const cls = (u ?? 0) >= 0 ? "gain" : "loss";
    const arrow = (u ?? 0) >= 0 ? "▲" : "▼";
    grid.appendChild(el(`<div class="vp-card" title="${F.escapeHtml(hint)}">
      <div class="vp-k">${F.escapeHtml(label)}</div>
      <div class="vp-v">${F.rawVND(price)} <span class="vp-cur">₫</span></div>
      <div class="vp-u ${cls}">${u == null ? "" : arrow + " " + F.pctSigned(u) + " <span class='vp-vs'>so với thị trường</span>"}</div>
    </div>`));
  }
  panel.appendChild(grid);

  // Highlighted summary — the same winsorized mean the evaluation block shows,
  // alongside the plain median so an outlier-heavy spread is visible.
  if (F.isNum(model.price)) {
    const prices = valid.map(([k]) => methods[k]).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    const uAvg = priceRaw ? (model.price - priceRaw) / priceRaw * 100 : null;
    const uMed = priceRaw ? (median - priceRaw) / priceRaw * 100 : null;
    panel.appendChild(el(`<div class="vp-avg">
      <div class="vp-avg-row">
        <div>
          <div class="vp-avg-k">TRUNG BÌNH ${valid.length} PHƯƠNG PHÁP</div>
          <div class="vp-avg-v">${F.rawVND(model.price)} <span class="vp-cur">₫</span></div>
        </div>
        <div class="vp-avg-right ${(uAvg ?? 0) >= 0 ? "gain" : "loss"}">
          ${uAvg == null ? "" : ((uAvg >= 0 ? "▲" : "▼") + " " + F.pctSigned(uAvg))}
          <div class="vp-avg-med">Trung vị ${F.rawVND(median)} · ${uMed == null ? "" : F.pctSigned(uMed)}</div>
        </div>
      </div>
      <div class="vp-avg-note">Đã kẹp ngoại lai (median ± 1.5×MAD), điều chỉnh theo ngành</div>
    </div>`));
  }

  // DCF parameters behind the DCF card.
  const p = (model && model.params) || {};
  if (F.isNum(p.wacc) || F.isNum(p.growth)) {
    panel.appendChild(el(`<div class="vp-params">
      <div class="vp-params-h">Tham số DCF</div>
      <div class="vp-prow"><span>WACC</span><b>${F.isNum(p.wacc) ? F.pct(p.wacc) : "—"}</b></div>
      <div class="vp-prow"><span>Tăng trưởng FCFF</span><b>${F.isNum(p.growth) ? F.pct(p.growth) : "—"}</b></div>
      <div class="vp-prow"><span>FCFF (tỷ ₫)</span><b>${F.num(p.fcff, 0)}</b></div>
      <div class="vp-prow"><span>Số CP (triệu)</span><b>${F.num(p.shares, 0)}</b></div>
    </div>`));
  }
  return panel;
}

// ── technical analysis (computed in the browser from the OHLC we already ship)
const last = (a) => a.length ? a[a.length - 1] : null;

function sma(v, n) { const o = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
function ema(v, n) { const k = 2 / (n + 1); const o = []; let e = null; for (let i = 0; i < v.length; i++) { e = e == null ? v[i] : v[i] * k + e * (1 - k); o.push(e); } return o; }

function rsi14(close) {
  // Wilder smoothing, matching the Streamlit implementation.
  let ag = 0, al = 0;
  for (let i = 1; i <= 14 && i < close.length; i++) {
    const d = close[i] - close[i - 1];
    ag += Math.max(d, 0); al += Math.max(-d, 0);
  }
  ag /= 14; al /= 14;
  for (let i = 15; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    ag = (ag * 13 + Math.max(d, 0)) / 14;
    al = (al * 13 + Math.max(-d, 0)) / 14;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export function technicalPanel(prices) {
  const p = (prices || []).slice(-260);
  if (p.length < 100) return null;
  const close = p.map((r) => r.close), high = p.map((r) => r.high), low = p.map((r) => r.low);
  const cur = last(close);

  const r = rsi14(close);
  const hh = Math.max(...high.slice(-14)), ll = Math.min(...low.slice(-14));
  const stoch = hh === ll ? 50 : (cur - ll) / (hh - ll) * 100;
  const wr = hh === ll ? -50 : (hh - cur) / (hh - ll) * -100;
  const macd = last(ema(close, 12)) - last(ema(close, 26));
  const tp = p.map((q) => (q.high + q.low + q.close) / 3);
  const tp20 = tp.slice(-20), tpm = tp20.reduce((a, b) => a + b, 0) / 20;
  const md = tp20.reduce((a, b) => a + Math.abs(b - tpm), 0) / 20;
  const cci = md === 0 ? 0 : (last(tp) - tpm) / (0.015 * md);
  const mid = p.map((q) => (q.high + q.low) / 2);
  const ao = last(sma(mid, 5)) - last(sma(mid, 34));

  const sig = (v, buy, sell, invert = false) => {
    const b = invert ? v < buy : v > buy, s = invert ? v > sell : v < sell;
    return b ? ["Mua", "gain"] : s ? ["Bán", "loss"] : ["Trung lập", "flat"];
  };
  const rows = [
    ["RSI (14)", r.toFixed(1), r > 70 ? ["Quá mua", "loss"] : r < 30 ? ["Quá bán", "gain"] : sig(r, 55, 45)],
    ["Stochastic (14)", stoch.toFixed(1), stoch > 80 ? ["Quá mua", "loss"] : stoch < 20 ? ["Quá bán", "gain"] : sig(stoch, 55, 45)],
    ["MACD (12,26)", macd.toFixed(2), sig(macd, 0, 0)],
    ["Williams %R", wr.toFixed(1), wr > -20 ? ["Quá mua", "loss"] : wr < -80 ? ["Quá bán", "gain"] : sig(wr, -50, -50)],
    ["CCI (20)", cci.toFixed(1), cci > 100 ? ["Quá mua", "loss"] : cci < -100 ? ["Quá bán", "gain"] : sig(cci, 0, 0)],
    ["Awesome Osc.", ao.toFixed(2), sig(ao, 0, 0)],
  ];

  const maRows = [5, 10, 20, 50, 100].map((n) => {
    const s = last(sma(close, n)), e = last(ema(close, n));
    return [`MA${n}`, s, e];
  });

  let buys = 0, sells = 0;
  for (const [, , [txt]] of rows) { if (txt === "Mua") buys++; else if (txt === "Bán") sells++; }
  for (const [, s, e] of maRows) { for (const m of [s, e]) { if (F.isNum(m)) (cur > m ? buys++ : sells++); } }
  const total = buys + sells;
  const score = total ? (buys - sells) / total : 0;
  const verdict = score > 0.4 ? ["MUA MẠNH", "gain"] : score > 0.1 ? ["MUA", "gain"]
    : score < -0.4 ? ["BÁN MẠNH", "loss"] : score < -0.1 ? ["BÁN", "loss"] : ["TRUNG LẬP", "flat"];

  const card = el(`<div class="vpanel ta">
    <h2 class="sec-h vp-h">Phân tích kỹ thuật <span class="ta-sub">· 1 ngày</span></h2>
    <div class="ta-verdict ${verdict[1]}">
      <div class="ta-verdict-v">${verdict[0]}</div>
      <div class="ta-verdict-s">${buys} mua · ${sells} bán trên ${total} tín hiệu</div>
    </div>
    <table class="ta-table"><tbody></tbody></table>
    <div class="ta-mah">Đường trung bình</div>
    <table class="ta-table ta-ma"><tbody></tbody></table>
  </div>`);
  const tb = card.querySelector(".ta-table tbody");
  for (const [name, val, [txt, cls]] of rows) {
    tb.appendChild(el(`<tr><td>${name}</td><td class="num">${val}</td><td class="${cls} sig">${txt}</td></tr>`));
  }
  const mb = card.querySelector(".ta-ma tbody");
  for (const [name, s, e] of maRows) {
    const c = (m) => !F.isNum(m) ? ["—", "flat"] : (cur > m ? ["Mua", "gain"] : ["Bán", "loss"]);
    const [st, sc] = c(s), [et, ec] = c(e);
    mb.appendChild(el(`<tr><td>${name}</td><td class="num">${F.isNum(s) ? F.priceVND(s) : "—"}</td>
      <td class="${sc} sig">${st}</td><td class="${ec} sig">${et}</td></tr>`));
  }
  return card;
}

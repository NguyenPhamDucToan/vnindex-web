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
  const p = (prices || []).slice(-320);
  if (p.length < 100) return null;
  const close = p.map((r) => r.close), high = p.map((r) => r.high), low = p.map((r) => r.low);
  const cur = last(close);

  // ── indicators (same set and periods as the original) ─────────────
  const r = rsi14(close);
  const hh = Math.max(...high.slice(-14)), ll = Math.min(...low.slice(-14));
  const stoch = hh === ll ? 50 : (cur - ll) / (hh - ll) * 100;
  const wr = hh === ll ? -50 : (hh - cur) / (hh - ll) * -100;
  const macd = last(ema(close, 12)) - last(ema(close, 26));
  const tp = p.map((q) => (q.high + q.low + q.close) / 3);
  const tp20 = tp.slice(-14), tpm = tp20.reduce((a, b) => a + b, 0) / tp20.length;
  const md = tp20.reduce((a, b) => a + Math.abs(b - tpm), 0) / tp20.length;
  const cci = md === 0 ? 0 : (last(tp) - tpm) / (0.015 * md);
  const mid = p.map((q) => (q.high + q.low) / 2);
  const ao = last(sma(mid, 5)) - last(sma(mid, 34));
  // Stochastic RSI: where today's RSI sits in its own 14-day range.
  const rsiSeries = [];
  for (let i = 20; i <= close.length; i++) rsiSeries.push(rsi14(close.slice(0, i)));
  const rWin = rsiSeries.slice(-14);
  const rMin = Math.min(...rWin), rMax = Math.max(...rWin);
  const stochRsi = rMax === rMin ? 50 : (last(rWin) - rMin) / (rMax - rMin) * 100;

  const band = (v, hi, lo) => v > hi ? ["Quá mua", "loss"] : v < lo ? ["Quá bán", "gain"] : null;
  const dir = (v, up, dn) => v > up ? ["Mua", "gain"] : v < dn ? ["Bán", "loss"] : ["Trung lập", "flat"];
  const IND = [
    ["RSI(14)", r, band(r, 70, 30) || dir(r, 55, 45)],
    ["Stochastic(14,3)", stoch, band(stoch, 80, 20) || dir(stoch, 55, 45)],
    ["Stochastic RSI(14)", stochRsi, band(stochRsi, 80, 20) || dir(stochRsi, 55, 45)],
    ["MACD(12,26)", macd, dir(macd, 0, 0)],
    ["WilliamR(14)", wr, band(wr, -20, -80) || dir(wr, -50, -50)],
    ["CCI(14)", cci, band(cci, 100, -100) || dir(cci, 0, 0)],
    ["Awesome Oscillator(5,34)", ao, dir(ao, 0, 0)],
  ];

  // ── moving averages, Simple and Exponential, MA5..MA200 ───────────
  const MA_N = [5, 10, 20, 50, 100, 150, 200];
  const maRows = MA_N.map((n) => [n, last(sma(close, n)), last(ema(close, n))]);

  // ── signal tally, split the way the original reports it ───────────
  let maBuy = 0, maSell = 0;
  for (const [, s, e] of maRows) for (const m of [s, e]) if (F.isNum(m)) (cur > m ? maBuy++ : maSell++);
  let indBuy = 0, indSell = 0;
  for (const [, , [txt]] of IND) {
    if (txt === "Mua" || txt === "Quá bán") indBuy++;
    else if (txt === "Bán" || txt === "Quá mua") indSell++;
  }
  const verdictOf = (b, s) => {
    const t = b + s; if (!t) return ["TRUNG LẬP", "flat"];
    const sc = (b - s) / t;
    return sc > 0.4 ? ["MUA MẠNH", "gain"] : sc > 0.1 ? ["MUA", "gain"]
      : sc < -0.4 ? ["BÁN MẠNH", "loss"] : sc < -0.1 ? ["BÁN", "loss"] : ["TRUNG LẬP", "flat"];
  };
  const maV = verdictOf(maBuy, maSell), indV = verdictOf(indBuy, indSell);
  const buys = maBuy + indBuy, sells = maSell + indSell;
  const score = (buys + sells) ? (buys - sells) / (buys + sells) : 0;
  const overall = verdictOf(buys, sells);

  // ── pivot points from the previous session (5 methods) ────────────
  const prev = p[p.length - 2] || p[p.length - 1];
  const H = prev.high, L = prev.low, C = prev.close, O = prev.open;
  const R = H - L;
  const Pc = (H + L + C) / 3;
  const Pw = (H + L + 2 * C) / 4;
  const X = C < O ? H + 2 * L + C : C > O ? 2 * H + L + C : H + L + 2 * C;
  const Pd = X / 4;
  const PIVOTS = [
    ["Classic", L - 2 * (H - Pc), Pc - R, 2 * Pc - H, Pc, 2 * Pc - L, Pc + R, H + 2 * (Pc - L)],
    ["Fibonacci", Pc - R, Pc - 0.618 * R, Pc - 0.382 * R, Pc, Pc + 0.382 * R, Pc + 0.618 * R, Pc + R],
    ["Camarilla", C - R * 1.1 / 4, C - R * 1.1 / 6, C - R * 1.1 / 12, Pc, C + R * 1.1 / 12, C + R * 1.1 / 6, C + R * 1.1 / 4],
    ["Woodie", L - 2 * (H - Pw), Pw - R, 2 * Pw - H, Pw, 2 * Pw - L, Pw + R, H + 2 * (Pw - L)],
    ["DeMark", (X / 2 - H) - R, Pd - ((X / 2 - L) - (X / 2 - H)), X / 2 - H, Pd, X / 2 - L, Pd + ((X / 2 - L) - (X / 2 - H)), (X / 2 - L) + R],
  ];

  const card = el(`<div class="vpanel ta">
    <h2 class="sec-h vp-h">Phân tích kỹ thuật <span class="ta-sub">· 1 ngày</span></h2>
    <div class="ta-head ${overall[1]}">TỔNG HỢP: ${overall[0]}</div>
    <div class="ta-top">
      <table class="ta-table ta-count"><thead><tr><th></th><th></th><th>Mua</th><th>Bán</th></tr></thead><tbody>
        <tr><td>Đường trung bình</td><td class="${maV[1]} sig">${maV[0]}</td><td class="num">${maBuy}</td><td class="num">${maSell}</td></tr>
        <tr><td>Chỉ số kỹ thuật</td><td class="${indV[1]} sig">${indV[0]}</td><td class="num">${indBuy}</td><td class="num">${indSell}</td></tr>
      </tbody></table>
      <div id="ta-gauge"></div>
    </div>
    <div class="ta-note">💡 TỔNG HỢP = tổng hợp tất cả tín hiệu Mua/Bán từ 7 chỉ số kỹ thuật và các đường trung bình (Simple &amp; Exponential) bên dưới.</div>
    <div class="ta-note">📊 Điểm gauge chạy từ -1 (Bán mạnh) đến +1 (Mua mạnh) = (Số tín hiệu Mua − Số tín hiệu Bán) / Tổng số tín hiệu. 0 = cân bằng giữa Mua và Bán.</div>

    <div class="ta-h2">Điểm Pivot</div>
    <div class="ta-scroll"><table class="ta-table ta-pivot"><thead><tr>
      <th></th><th>S3</th><th>S2</th><th>S1</th><th>Points</th><th>R1</th><th>R2</th><th>R3</th>
    </tr></thead><tbody></tbody></table></div>
    <div class="ta-note">S = Hỗ trợ (xanh) · R = Kháng cự (đỏ) · Points = Điểm xoay (vàng)</div>

    <div class="ta-h2">Chỉ số kỹ thuật</div>
    <table class="ta-table ta-ind"><thead><tr><th>Tên</th><th>Giá trị</th><th>Tín hiệu</th></tr></thead><tbody></tbody></table>

    <div class="ta-h2">Đường trung bình</div>
    <table class="ta-table ta-ma"><thead><tr><th>Tên</th><th>Simple</th><th>Exponential</th></tr></thead><tbody></tbody></table>
  </div>`);

  const pb = card.querySelector(".ta-pivot tbody");
  for (const [name, s3, s2, s1, pt, r1, r2, r3] of PIVOTS) {
    const f = (v) => (F.isNum(v) ? (v * 1000).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—");
    pb.appendChild(el(`<tr><td>${name}</td>
      <td class="num sup">${f(s3)}</td><td class="num sup">${f(s2)}</td><td class="num sup">${f(s1)}</td>
      <td class="num piv">${f(pt)}</td>
      <td class="num res">${f(r1)}</td><td class="num res">${f(r2)}</td><td class="num res">${f(r3)}</td></tr>`));
  }

  const ib = card.querySelector(".ta-ind tbody");
  for (const [name, val, [txt, cls]] of IND) {
    ib.appendChild(el(`<tr><td>${name}</td><td class="num">${val.toFixed(2)}</td><td class="${cls} sig">${txt}</td></tr>`));
  }

  const mb = card.querySelector(".ta-ma tbody");
  for (const [n, s, e] of maRows) {
    const cell = (m) => !F.isNum(m) ? "—"
      : `${m.toFixed(2)} <span class="${cur > m ? "gain" : "loss"}">(${cur > m ? "Mua" : "Bán"})</span>`;
    mb.appendChild(el(`<tr><td>MA${n}</td><td class="num">${cell(s)}</td><td class="num">${cell(e)}</td></tr>`));
  }

  // Half-gauge summarising the signal balance, same bands and colours as the
  // original's go.Indicator: -1 strong sell .. +1 strong buy.
  card.renderGauge = () => {
    window.Plotly.react(card.querySelector("#ta-gauge"), [{
      type: "indicator", mode: "gauge+number", value: score,
      // 20px overflowed the gauge box once the right column narrowed below
      // ~1300px, pushing the whole panel wider than its column.
      number: { valueformat: ".2f", font: { size: 17 } },
      gauge: {
        axis: { range: [-1, 1], visible: false },
        bar: { color: "rgba(0,0,0,0)" },
        bgcolor: "rgba(0,0,0,0)",
        steps: [
          { range: [-1, -0.6], color: "#dc2626" },
          { range: [-0.6, -0.2], color: "#f97316" },
          { range: [-0.2, 0.2], color: "#eab308" },
          { range: [0.2, 0.6], color: "#84cc16" },
          { range: [0.6, 1], color: "#22c55e" },
        ],
        threshold: { line: { color: "white", width: 4 }, thickness: 0.85, value: score },
      },
    }], {
      height: 150, margin: { l: 10, r: 10, t: 10, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#0f172a", family: "Source Sans 3, sans-serif" },
    }, { displayModeBar: false, responsive: true });
    // Plotly measures the container at draw time, and the grid around this
    // panel has not settled then -- the gauge keeps a stale (much wider) size
    // and spills out of the column. A single rAF re-measure fixed one layout
    // but not others, so watch the box instead: any later change to the
    // column's width re-measures too.
    const node = card.querySelector("#ta-gauge");
    const remeasure = () => {
      if (node && node.isConnected && window.Plotly && window.Plotly.Plots) {
        window.Plotly.Plots.resize(node);
      }
    };
    requestAnimationFrame(remeasure);
    if (window.ResizeObserver && node && node.parentElement) {
      let w = 0;
      new ResizeObserver((entries) => {
        const nw = Math.round(entries[0].contentRect.width);
        if (nw && nw !== w) { w = nw; remeasure(); }
      }).observe(node.parentElement);
    }
  };
  return card;
}
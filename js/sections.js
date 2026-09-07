// Sections the Streamlit stock tab has that the first port pass missed:
// DuPont, ROIC vs WACC, and the peer comparison card. Logic is ported 1:1 from
// valuation/ratios.py (dupont_analysis, roic) and the app's ROIC block so the
// two builds reach the same verdicts, not merely similar-looking ones.
import { ratingColor } from "./ratings.js";
import * as F from "./format.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const TAX_RATE = 0.20;

// ── DuPont ──────────────────────────────────────────────────────────
function dupontAnalysis(margin, turnover, leverage) {
  const roe = margin * turnover * leverage;
  const mL = margin >= 0.10 ? "cao" : margin >= 0.05 ? "trung bình" : "thấp";
  const tL = turnover >= 1.0 ? "cao" : turnover >= 0.5 ? "trung bình" : "thấp";
  const lL = leverage >= 3.0 ? "cao" : leverage >= 2.0 ? "trung bình" : "thấp";
  const rL = roe >= 0.15 ? "cao" : roe >= 0.10 ? "trung bình" : "thấp";

  const drivers = [];
  if (mL === "cao") drivers.push("biên lợi nhuận tốt");
  if (tL === "cao") drivers.push("quay vòng tài sản hiệu quả");
  if (lL === "cao") drivers.push("sử dụng nhiều vay nợ (đòn bẩy tài chính)");
  const weak = [];
  if (mL === "thấp") weak.push("biên lợi nhuận thấp");
  if (tL === "thấp") weak.push("hiệu suất sử dụng tài sản thấp");
  if (lL === "thấp") weak.push("ít dùng vay nợ nên đòn bẩy không hỗ trợ thêm cho ROE");

  let comment;
  if (rL === "cao") {
    comment = drivers.length
      ? `ROE cao chủ yếu được thúc đẩy bởi: ${drivers.join(", ")}.`
      : "ROE cao nhưng không có yếu tố nào nổi bật rõ ràng.";
    if (lL === "cao" && mL !== "cao") {
      comment += " ⚠️ Lưu ý: ROE cao phần lớn đến từ vay nợ chứ không phải lợi nhuận kinh doanh — đây là tín hiệu kém bền vững hơn, vì rủi ro tăng khi lãi suất tăng hoặc kinh doanh sa sút.";
    } else if (mL === "cao" && lL !== "cao") {
      comment += " ✅ Đây là dạng ROE cao bền vững — đến từ hiệu quả kinh doanh thực sự, không phải vay nợ nhiều.";
    }
  } else if (rL === "thấp") {
    comment = weak.length
      ? `ROE thấp, chủ yếu do: ${weak.join(", ")}.`
      : "ROE thấp dù không có yếu tố thành phần nào yếu rõ ràng — có thể do biến động bất thường trong kỳ.";
  } else {
    comment = "ROE ở mức trung bình, không có yếu tố nào nổi bật rõ theo hướng tốt hay xấu.";
  }
  return { roe, mL, tL, lL, rL, comment };
}

export function dupontSection(v) {
  const m = v.net_margin, t = v.asset_turnover, l = v.financial_leverage;
  if (!F.isNum(m) || !F.isNum(t) || !F.isNum(l)) return null;
  const d = dupontAnalysis(m, t, l);
  const card = (label, value, color, hint) =>
    `<div class="dp-card"><div class="dp-k">${label}</div>
     <div class="dp-v" style="color:${color}">${value}</div>
     <div class="dp-h">${hint}</div></div>`;
  const op = (s) => `<div class="dp-op">${s}</div>`;

  const lvlBadge = (txt, color) =>
    `<span class="dp-badge" style="background:${color}18;border-color:${color}55;color:${color}">${txt}</span>`;
  const lvlColor = (lv, invert = false) =>
    lv === "cao" ? (invert ? "#b91c1c" : "#15803d") : lv === "thấp" ? (invert ? "#15803d" : "#b91c1c") : "#b45309";
  const lvlText = { "cao": "Tốt", "trung bình": "Trung bình", "thấp": "Yếu" };
  const levText = { "cao": "Cao — rủi ro", "trung bình": "Trung bình", "thấp": "Thấp — an toàn" };

  return el(`<div class="card">
    <h2 class="sec-h">DuPont</h2>
    <div class="dp-row">
      ${card("Biên lợi nhuận ròng", F.pct(m), ratingColor(m, 0.10, 0.05), "LN ròng / Doanh thu")}
      ${op("×")}
      ${card("Hiệu suất tài sản", F.mult(t), ratingColor(t, 1.0, 0.5), "Doanh thu / Tổng TS")}
      ${op("×")}
      ${card("Đòn bẩy tài chính", F.mult(l), ratingColor(l, 2.0, 3.0, false), "Tổng TS / Vốn CSH")}
      ${op("=")}
      ${card("ROE", F.pct(d.roe), ratingColor(d.roe, 0.15, 0.10), "LN ròng / Vốn CSH")}
    </div>
    <div class="dp-badges">
      ${lvlBadge("Biên LN: " + lvlText[d.mL], lvlColor(d.mL))}
      ${lvlBadge("Hiệu suất TS: " + lvlText[d.tL], lvlColor(d.tL))}
      ${lvlBadge("Đòn bẩy: " + levText[d.lL], lvlColor(d.lL, true))}
      ${lvlBadge("ROE: " + lvlText[d.rL], lvlColor(d.rL))}
    </div>
    <div class="dp-comment">${d.comment}</div>
  </div>`);
}

// ── ROIC vs WACC ────────────────────────────────────────────────────
// ROIC = NOPAT / (debt + equity − cash), averaged over the last 5 annual
// reports, versus the ticker's own beta-derived WACC.
export function roicSection(financials, model) {
  const annual = (financials || []).filter((f) => f.period_type === "Y")
    .sort((a, b) => String(a.period).localeCompare(String(b.period))).slice(-5);
  const perYear = [];
  for (const r of annual) {
    const ic = (r.debt || 0) + (r.equity || 0) - (r.cash || 0);
    if (!F.isNum(r.ebit) || ic <= 0) continue;
    perYear.push([String(r.period).slice(0, 4), r.ebit * (1 - TAX_RATE) / ic * 100]);
  }
  const wacc = (model && model.params) ? model.params.wacc_ticker : null;
  if (!perYear.length || !F.isNum(wacc)) return null;

  const avgRoic = perYear.reduce((a, [, x]) => a + x, 0) / perYear.length;
  const gapPP = avgRoic - wacc * 100;
  const roicC = ratingColor(gapPP / 100, 0.005, -0.005);
  const waccC = ratingColor(wacc, 0.12, 0.15, false);
  const n = perYear.length;

  let verdict;
  if (gapPP > 0.5) {
    verdict = `✅ <b>ROIC trung bình ${n} năm cao hơn WACC ${gapPP >= 0 ? "+" : ""}${gapPP.toFixed(1)} điểm %</b> — công ty liên tục tạo ra giá trị thực: sinh lời ${avgRoic.toFixed(1)}%/năm trên vốn đầu tư, cao hơn chi phí vốn phải trả.`;
  } else if (gapPP < -0.5) {
    verdict = `⚠️ <b>ROIC trung bình ${n} năm thấp hơn WACC ${gapPP.toFixed(1)} điểm %</b> — mỗi đồng vốn bỏ ra đang sinh lời ít hơn chi phí huy động, tức là bào mòn giá trị cổ đông nếu kéo dài.`;
  } else {
    verdict = `ROIC trung bình ${n} năm xấp xỉ WACC (chênh ${gapPP >= 0 ? "+" : ""}${gapPP.toFixed(1)} điểm %) — công ty hòa vốn về mặt tạo giá trị.`;
  }

  const years = perYear.map(([y, r]) =>
    `<div class="rw-yr"><span>${y}</span><b style="color:${ratingColor(r / 100 - wacc, 0.005, -0.005)}">${r.toFixed(1)}%</b></div>`).join("");

  return el(`<div class="card">
    <h2 class="sec-h">ROIC vs WACC</h2>
    <div class="rw-row">
      <div class="rw-card"><div class="rw-k">ROIC trung bình ${n} năm</div>
        <div class="rw-v" style="color:${roicC}">${avgRoic.toFixed(1)}%</div></div>
      <div class="rw-card"><div class="rw-k">WACC (β=${F.isNum(model.params.beta) ? model.params.beta.toFixed(2) : "—"})</div>
        <div class="rw-v" style="color:${waccC}">${F.pct(wacc)}</div></div>
      <div class="rw-card"><div class="rw-k">Chênh lệch</div>
        <div class="rw-v" style="color:${roicC}">${gapPP >= 0 ? "+" : ""}${gapPP.toFixed(1)} pp</div></div>
    </div>
    <div class="rw-years">${years}</div>
    <div class="dp-comment">${verdict}</div>
  </div>`);
}

// ── self-relative valuation band ────────────────────────────────────
// "Is 12x cheap?" answered against the stock's OWN history. Ported from
// load_valuation_bands(): each TTM snapshot only takes effect PUBLISH_LAG days
// after its quarter ends, so the band never uses earnings nobody could have
// known on that date (look-ahead bias right around results).
const PUBLISH_LAG_DAYS = 45;

function quarterEndPlusLag(period) {
  const yr = parseInt(period.slice(0, 4), 10);
  const qn = parseInt(period.slice(6), 10);   // "2026-Q1" -> 1
  if (!yr || !qn) return null;
  const d = new Date(Date.UTC(yr, qn * 3, 0));       // last day of quarter
  d.setUTCDate(d.getUTCDate() + PUBLISH_LAG_DAYS);
  return d;
}

export function valuationBandSection(parent, financials, prices) {
  const qs = (financials || []).filter((f) => f.period_type === "Q")
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  if (qs.length < 4 || !(prices || []).length) return null;

  const snaps = [];
  for (let i = 3; i < qs.length; i++) {
    const w = qs.slice(i - 3, i + 1), lastQ = w[3];
    const shares = lastQ.shares_outstanding || 0;
    if (shares <= 0) continue;
    const ni = w.map((r) => r.net_income).filter((x) => F.isNum(x));
    const ttmNi = ni.length === 4 ? ni.reduce((a, b) => a + b, 0) : null;
    const eps = (ttmNi && ttmNi > 0) ? ttmNi * 1000 / shares : null;
    const bvps = (lastQ.equity && lastQ.equity > 0) ? lastQ.equity * 1000 / shares : null;
    if (eps == null && bvps == null) continue;
    const from = quarterEndPlusLag(lastQ.period);
    if (from) snaps.push({ from, eps, bvps });
  }
  if (!snaps.length) return null;

  const series = [];
  let si = 0;
  for (const p of prices) {
    const d = new Date(p.date + "T00:00:00Z");
    while (si + 1 < snaps.length && snaps[si + 1].from <= d) si++;
    const s = snaps[si];
    if (!s || s.from > d) continue;              // before the first known TTM
    const px = p.close * 1000;
    series.push({
      date: p.date,
      pe: s.eps ? px / s.eps : null,
      pb: s.bvps ? px / s.bvps : null,
    });
  }
  if (series.length < 30) return null;

  const card = el(`<div class="card">
    <h2 class="sec-h">So với lịch sử chính nó</h2>
    <div class="range-row vb-row"></div>
    <div id="vb-chart"></div>
    <div class="vb-note"></div></div>`);
  parent.appendChild(card);

  const draw = (metric) => {
    const pts = series.filter((s) => F.isNum(s[metric]) && s[metric] > 0);
    if (!pts.length) return;
    const vals = pts.map((s) => s[metric]);
    const sorted = [...vals].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const p25 = q(0.25), p50 = q(0.50), p75 = q(0.75);
    const cur = vals[vals.length - 1];
    const pctRank = sorted.filter((x) => x <= cur).length / sorted.length * 100;

    const x = pts.map((s) => s.date);
    window.Plotly.react(card.querySelector("#vb-chart"), [
      { type: "scatter", mode: "lines", x, y: vals, name: metric.toUpperCase(),
        line: { color: "#2563eb", width: 1.5 }, hovertemplate: "%{x}: %{y:.2f}x<extra></extra>" },
    ], {
      height: 260, dragmode: false, margin: { l: 46, r: 16, t: 14, b: 28 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "'Fira Code', monospace", size: 10, color: "#0a121d" },
      xaxis: { showgrid: false, tickfont: { size: 9 }, nticks: 8 },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, title: { text: `${metric.toUpperCase()} (lần)`, font: { size: 10 } } },
      shapes: [
        { type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: p25, y1: p75,
          fillcolor: "rgba(37,99,235,0.08)", line: { width: 0 }, layer: "below" },
        { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: p50, y1: p50,
          line: { color: "#64748b", width: 1, dash: "dash" } },
      ],
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true });

    const cheap = pctRank <= 35, rich = pctRank >= 65;
    card.querySelector(".vb-note").innerHTML =
      `Hiện tại <b>${cur.toFixed(2)}x</b> — nằm ở <b>phân vị ${pctRank.toFixed(0)}</b> của chính mã này ` +
      `(trung vị ${p50.toFixed(2)}x, vùng 25–75% là ${p25.toFixed(2)}–${p75.toFixed(2)}x). ` +
      (cheap ? "Đang rẻ so với lịch sử của chính nó."
        : rich ? "Đang đắt so với lịch sử của chính nó."
        : "Đang ở vùng định giá quen thuộc của chính nó.");
  };

  const row = card.querySelector(".vb-row");
  let active = "pe";
  for (const m of ["pe", "pb"]) {
    const b = el(`<button class="range-btn ${m === active ? "active" : ""}">${m.toUpperCase()}</button>`);
    b.onclick = () => {
      active = m;
      row.querySelectorAll(".range-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      draw(m);
    };
    row.appendChild(b);
  }
  draw("pe");
  return card;
}

// ── peer comparison ─────────────────────────────────────────────────
// Compares the ticker against the median of its own sector, from the screener
// snapshot that is already loaded for the other views.
export function peerSection(co, v, screenerRows, modelUpside) {
  if (!screenerRows || !co.sector) return null;
  const peers = screenerRows.filter((r) => r.sector === co.sector);
  if (peers.length < 3) return null;

  const med = (key) => {
    const a = peers.map((r) => r[key]).filter((x) => F.isNum(x)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  const rows = [
    ["P/E", v.pe, med("pe"), (x) => F.mult(x), false],
    ["P/B", v.pb, med("pb"), (x) => F.mult(x), false],
    ["ROE", v.roe, med("roe"), (x) => F.pct(x), true],
    ["Upside", modelUpside, med("model_upside"), (x) => F.pctSigned(x * 100), true],
  ];

  const cards = rows.map(([label, mine, m, fmt, higherBetter]) => {
    if (!F.isNum(mine) || !F.isNum(m)) {
      return `<div class="pr-card"><div class="pr-k">${label}</div><div class="pr-v">—</div></div>`;
    }
    const d = mine - m;
    // Colour by whether the gap is favourable for that metric, not by its sign.
    const good = higherBetter ? d >= 0 : d <= 0;
    return `<div class="pr-card">
      <div class="pr-k">${label}</div>
      <div class="pr-v">${fmt(mine)}</div>
      <div class="pr-d ${good ? "gain" : "loss"}">${d >= 0 ? "+" : ""}${fmt(d)} vs trung vị</div></div>`;
  }).join("");

  const card = el(`<div class="card">
    <h2 class="sec-h">So sánh cùng ngành <span class="ta-sub">· ${F.escapeHtml(co.sector)}</span></h2>
    <div class="pr-row">${cards}</div>
    <div id="pr-scatter"></div>
    <div class="vb-note">★ ${F.escapeHtml(co.ticker)} · Góc trên-trái = rẻ &amp; sinh lời tốt (P/E thấp, ROE cao)</div>
  </div>`);

  // Plotly throws on a detached node, so the caller runs this after appending.
  // sections.js has no shared font constant; match the valuation band beside it.
  const PFONT = { family: "'Fira Code', monospace", size: 10, color: "#0a121d" };
  card.renderChart = () => {
    const pts = peers.filter((r) => F.isNum(r.pe) && F.isNum(r.roe));
    if (pts.length < 3) return;
    const self = pts.filter((r) => r.ticker === co.ticker);
    const others = pts.filter((r) => r.ticker !== co.ticker);
    // roe is stored as a fraction; the original's axis is in percent.
    const roePct = (r) => r.roe * 100;
    const traces = [{
      type: "scatter", mode: "markers+text", name: "Đối thủ",
      x: others.map((r) => r.pe), y: others.map(roePct), text: others.map((r) => r.ticker),
      textposition: "top center", textfont: { family: PFONT.family, size: 10, color: "#6b7280" },
      marker: { size: 15, color: "#5b9bd5", opacity: 0.7, line: { width: 0.5, color: "#1f2937" } },
      hovertemplate: "%{text}<br>P/E %{x:.1f}× · ROE %{y:.1f}%<extra></extra>",
    }];
    if (self.length) {
      traces.push({
        type: "scatter", mode: "markers+text", name: co.ticker,
        x: self.map((r) => r.pe), y: self.map(roePct), text: self.map((r) => r.ticker),
        textposition: "top center", textfont: { family: PFONT.family, size: 14, color: "#f59e0b" },
        marker: { size: 28, color: "#f59e0b", symbol: "star", line: { width: 1.5, color: "#fff" } },
        hovertemplate: "<b>%{text}</b><br>P/E %{x:.1f}× · ROE %{y:.1f}%<extra></extra>",
      });
    }
    window.Plotly.react(card.querySelector("#pr-scatter"), traces, {
      height: 340, dragmode: false, margin: { l: 52, r: 16, t: 10, b: 42 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: PFONT, showlegend: false, hovermode: "closest",
      xaxis: { title: { text: "P/E (×)", font: { ...PFONT, size: 10 } },
               gridcolor: "rgba(148,163,184,0.22)", tickfont: { ...PFONT, size: 9 } },
      yaxis: { title: { text: "ROE (%)", font: { ...PFONT, size: 10 } },
               gridcolor: "rgba(148,163,184,0.22)", tickfont: { ...PFONT, size: 9 } },
    }, { displayModeBar: false, responsive: true });
  };
  return card;
}


// ── Cổ đông lớn & Ban lãnh đạo ────────────────────────────────────
// Classification copied from the original: it decides the bar colours and the
// donut's slices, so the two must agree.
const OWNER_COLORS = {
  "Nhà nước": "#60a5fa",
  "Nước ngoài": "#34d399",
  "Tổ chức trong nước": "#fb923c",
  "Cá nhân": "#c084fc",
  "Khác (nhỏ lẻ)": "#475569",
};

function ownerType(name) {
  const n = (name || "").toUpperCase();
  const has = (list) => list.some((k) => n.includes(k));
  if (has(["NHÀ NƯỚC", "SCIC", "TỔNG CÔNG TY ĐẦU TƯ VÀ KINH DOANH VỐN", "UBND", "BỘ TÀI CHÍNH"]))
    return "Nhà nước";
  if (has(["ETF", "FUND", "TRUST", "LIMITED", "PTE", "LTD", "INTERNATIONAL", "GLOBAL",
           "VANGUARD", "FIDELITY", "MATTHEWS", "NORGES", "DEUTSCHE", "BARCLAYS",
           "MERCER", "BROWN", "PZENA", "FUBON", "CITIGROUP"]))
    return "Nước ngoài";
  if (has(["QUỸ", "CÔNG TY TNHH", "CÔNG TY CỔ PHẦN", "NGÂN HÀNG"]))
    return "Tổ chức trong nước";
  return "Cá nhân";
}

export function holdersSection(holders) {
  const sh = ((holders || {}).shareholders || []).filter((r) => F.isNum(r.pct) && r.pct > 0);
  const off = ((holders || {}).officers || []).filter((r) => F.isNum(r.pct) && r.pct > 0);
  if (!sh.length && !off.length) return null;

  const card = el(`<details class="card holders">
    <summary class="sec-h hd-sum">🏛 Cổ đông lớn &amp; Ban lãnh đạo</summary>
    <div class="hd-body">
      <div class="hd-split">
        <div><div class="vb-note">Top 12 cổ đông lớn nhất · màu theo nhóm sở hữu</div>
             <div id="hd-bar"></div></div>
        <div><div class="vb-note">Cơ cấu theo nhóm</div><div id="hd-pie"></div></div>
      </div>
      <div id="hd-off"></div>
    </div>
  </details>`);

  const PF = { family: "'Fira Code', monospace", size: 10, color: "#0a121d" };
  let drawn = false;
  const draw = () => {
    if (drawn || !sh.length) return;
    drawn = true;
    // Ascending, so the largest holder ends up at the top of a horizontal bar.
    const top = sh.slice().sort((a, b) => b.pct - a.pct).slice(0, 12).reverse();
    const short = (n) => (n.length <= 42 ? n : n.slice(0, 40) + "…");
    window.Plotly.react(card.querySelector("#hd-bar"), [{
      type: "bar", orientation: "h",
      x: top.map((r) => r.pct * 100), y: top.map((r) => short(r.name)),
      marker: { color: top.map((r) => OWNER_COLORS[ownerType(r.name)] || "#94a3b8") },
      text: top.map((r) => `${(r.pct * 100).toFixed(2)}%`),
      textposition: "outside", cliponaxis: false,
      customdata: top.map((r) => [r.name, ownerType(r.name)]),
      hovertemplate: "%{customdata[0]}<br>%{customdata[1]} · %{x:.2f}%<extra></extra>",
    }], {
      height: Math.max(320, top.length * 30), dragmode: false,
      // Holder names are long; on a phone a 300px label gutter leaves no plot,
      // so give the labels less room and let automargin take what it needs.
      margin: { l: window.innerWidth < 700 ? 110 : 300, r: 60, t: 8, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: PF,
      xaxis: { gridcolor: "rgba(148,163,184,0.22)", ticksuffix: "%", tickfont: { size: 9 } },
      yaxis: { tickfont: { size: 9 }, automargin: true },
    }, { displayModeBar: false, responsive: true });

    // Group the disclosed holders, then let the unlisted float be its own
    // slice -- without it the donut implies the disclosed names are the whole
    // register, which for most tickers they are not.
    const byType = {};
    for (const r of sh) byType[ownerType(r.name)] = (byType[ownerType(r.name)] || 0) + r.pct * 100;
    const disclosed = Object.values(byType).reduce((a, b) => a + b, 0);
    if (disclosed < 99.5) byType["Khác (nhỏ lẻ)"] = 100 - disclosed;
    const labels = Object.keys(byType);
    window.Plotly.react(card.querySelector("#hd-pie"), [{
      type: "pie", hole: 0.5, labels, values: labels.map((k) => byType[k]),
      marker: { colors: labels.map((k) => OWNER_COLORS[k] || "#94a3b8") },
      textinfo: "label+percent", textposition: "outside",
      hovertemplate: "%{label}: %{value:.2f}%<extra></extra>",
    }], {
      height: 400, margin: { l: 20, r: 20, t: 20, b: 20 }, showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)", font: PF,
    }, { displayModeBar: false, responsive: true });
  };

  if (off.length) {
    const rows = off.slice().sort((a, b) => b.pct - a.pct);
    card.querySelector("#hd-off").appendChild(el(`<div>
      <div class="vb-note">Ban lãnh đạo có cổ phần</div>
      <div class="ta-scroll"><table class="screen"><thead><tr><th>Họ tên</th><th>Chức vụ</th><th>Sở hữu (%)</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${F.escapeHtml(r.name)}</td>
        <td class="dim">${F.escapeHtml(r.position || "")}</td>
        <td class="num">${(r.pct * 100).toFixed(4)}%</td></tr>`).join("")}</tbody></table></div></div>`));
  }

  // Plotly cannot measure a node inside a closed <details>, so draw on open.
  card.addEventListener("toggle", () => { if (card.open) draw(); });
  return card;
}

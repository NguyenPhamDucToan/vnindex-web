// "So sánh Cổ phiếu" — the multi-ticker comparison view.
//
// Mirrors the original's five sections: a ticker multi-select, normalised price
// performance, an overall radar profile, a financial-metric comparison, five
// years of revenue/net income, and a detail table. Everything is derived from
// the exported per-ticker files plus the screener snapshot, so no new data.
import { loadTicker, loadScreener } from "./data.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR } from "./signals.js";
import * as F from "./format.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const FONT = { family: "Fira Code, monospace", size: 10, color: "#0a121d" };
// Palette for the per-ticker series; distinct hues rather than a gradient so
// six overlapping lines stay tellable apart.
const SERIES = ["#2563eb", "#ea580c", "#15803d", "#7c3aed", "#0e7490", "#b91c1c"];

const RADAR = [
  { label: "ROE", key: "roe", max: 0.30, pct: true },
  { label: "Biên LN ròng", key: "net_margin", max: 0.25, pct: true },
  { label: "Biên FCF", key: "fcf_margin", max: 0.20, pct: true },
  { label: "Chất lượng", key: "q", max: 100, pct: false },
  { label: "Upside", key: "upFrac", max: 1.0, pct: true },
];

export async function renderCompare(root, onPick) {
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const screen = await loadScreener();
  const byTicker = new Map(screen.map((r) => [r.ticker, r]));

  // Default set: a few liquid, well-covered names so the view isn't empty.
  const preferred = ["VCB", "FPT", "VNM", "HPG"].filter((t) => byTicker.has(t));
  let picked = preferred.length >= 2 ? preferred
    : screen.slice().sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 4).map((r) => r.ticker);

  root.innerHTML = "";
  const shell = el(`<div>
    <div class="card">
      <h2 class="sec-h">So sánh Cổ phiếu</h2>
      <div class="cmp-pick">
        <input id="cmp-input" placeholder="Thêm mã… (tối đa 6)" autocomplete="off" spellcheck="false" />
        <div id="cmp-sugg" class="hidden"></div>
        <div id="cmp-chips" class="cmp-chips"></div>
      </div>
    </div>
    <div id="cmp-body"></div>
  </div>`);
  root.appendChild(shell);

  const input = shell.querySelector("#cmp-input");
  const sugg = shell.querySelector("#cmp-sugg");
  const chips = shell.querySelector("#cmp-chips");

  const drawChips = () => {
    chips.innerHTML = "";
    for (const t of picked) {
      const c = el(`<span class="cmp-chip">${t}<button title="Bỏ">✕</button></span>`);
      c.querySelector("button").onclick = () => {
        picked = picked.filter((x) => x !== t);
        drawChips(); rebuild();
      };
      chips.appendChild(c);
    }
  };

  const renderSugg = (q) => {
    const term = q.trim().toUpperCase();
    if (!term) { sugg.classList.add("hidden"); return; }
    const hits = screen.filter((r) => r.ticker.includes(term) && !picked.includes(r.ticker)).slice(0, 12);
    sugg.innerHTML = "";
    for (const r of hits) {
      const it = el(`<div class="pick"><b>${r.ticker}</b><span>${F.escapeHtml(r.name || "")}</span></div>`);
      it.onmousedown = () => {
        if (picked.length >= 6) return;
        picked.push(r.ticker);
        input.value = ""; sugg.classList.add("hidden");
        drawChips(); rebuild();
      };
      sugg.appendChild(it);
    }
    sugg.classList.toggle("hidden", !hits.length);
  };
  input.addEventListener("input", () => renderSugg(input.value));
  input.addEventListener("blur", () => setTimeout(() => sugg.classList.add("hidden"), 150));

  async function rebuild() {
    const body = shell.querySelector("#cmp-body");
    if (picked.length < 1) { body.innerHTML = `<div class="loading">Chọn ít nhất 1 mã để so sánh.</div>`; return; }
    body.innerHTML = `<div class="loading">Đang tải ${picked.length} mã…</div>`;

    const data = [];
    for (const t of picked) {
      try {
        const d = await loadTicker(t);
        const s = byTicker.get(t) || {};
        const v = d.valuation || {};
        const q = computeQualityScore(v.roe, v.net_margin, v.profit_quality, v.fcf_margin, v.current_ratio, v.debt_to_equity);
        const upFrac = F.isNum((d.model || {}).upside) ? d.model.upside : null;
        data.push({ t, d, v, q, upFrac, sig: upFrac != null ? classifySignal(upFrac, q) : null,
                    sector: (d.company || {}).sector, name: (d.company || {}).name });
      } catch { /* unknown ticker -- skip */ }
    }
    if (!data.length) { body.innerHTML = `<div class="loading">Không tải được dữ liệu.</div>`; return; }

    body.innerHTML = "";
    const pending = [];
    const card = (title, id, extra = "") => {
      const c = el(`<div class="card"><h2 class="sec-h">${title}</h2>${extra}<div id="${id}"></div></div>`);
      body.appendChild(c);
      return c;
    };

    // ── 1. Normalised price performance (100 = start of window) ──────
    const perfCard = card("Hiệu suất giá (chuẩn hóa về 100)", "cmp-perf");
    const traces = data.map((x, i) => {
      const px = (x.d.prices || []).slice(-252);
      if (!px.length) return null;
      const base = px[0].close;
      return {
        type: "scatter", mode: "lines", name: x.t,
        x: px.map((p) => p.date), y: px.map((p) => p.close / base * 100),
        line: { color: SERIES[i % SERIES.length], width: 1.6 },
        hovertemplate: `${x.t}: %{y:.1f}<extra></extra>`,
      };
    }).filter(Boolean);
    pending.push(() => window.Plotly.react(perfCard.querySelector("#cmp-perf"), traces, {
      height: 360, dragmode: false, margin: { l: 52, r: 14, t: 26, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
      legend: { orientation: "h", y: 1.1, x: 0, font: { size: 10 } },
      xaxis: { showgrid: false, tickfont: { size: 9 }, nticks: 8 },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 },
               title: { text: "Giá chuẩn hóa (100 = đầu kỳ)", font: { size: 10 } } },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true }));

    // ── 2. Overall profile radar ─────────────────────────────────────
    const radarCard = card("Hồ sơ tổng thể", "cmp-radar",
      `<div class="vb-note">Mỗi trục đã chuẩn hóa về thang 0–100% của ngưỡng tham chiếu
       (ROE 30%, biên LN ròng 25%, biên FCF 20%, chất lượng 100, upside 100%).</div>`);
    const radarTraces = data.map((x, i) => ({
      type: "scatterpolar", name: x.t, fill: "toself",
      r: RADAR.map((c) => {
        const raw = c.key === "q" ? x.q : c.key === "upFrac" ? x.upFrac : x.v[c.key];
        if (!F.isNum(raw)) return 0;
        return Math.max(0, Math.min(100, raw / c.max * 100));
      }).concat([0]).slice(0, RADAR.length),
      theta: RADAR.map((c) => c.label),
      line: { color: SERIES[i % SERIES.length] },
      fillcolor: SERIES[i % SERIES.length] + "22",
      hovertemplate: `${x.t} %{theta}: %{r:.0f}<extra></extra>`,
    }));
    pending.push(() => window.Plotly.react(radarCard.querySelector("#cmp-radar"), radarTraces, {
      height: 420, dragmode: false, margin: { l: 60, r: 60, t: 40, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)", font: FONT,
      polar: { radialaxis: { visible: true, range: [0, 100], tickfont: { size: 9 } },
               angularaxis: { tickfont: { size: 10 } }, bgcolor: "rgba(0,0,0,0)" },
      legend: { orientation: "h", y: 1.08, x: 0, font: { size: 10 } },
    }, { displayModeBar: false, responsive: true }));

    // ── 3. Financial-metric comparison (grouped bars per metric) ─────
    const metCard = card("So sánh chỉ số tài chính", "cmp-metrics");
    const METRICS = [
      ["P/E", (x) => x.v.pe, "×"], ["P/B", (x) => x.v.pb, "×"],
      ["ROE", (x) => (F.isNum(x.v.roe) ? x.v.roe * 100 : null), "%"],
      ["Biên LN ròng", (x) => (F.isNum(x.v.net_margin) ? x.v.net_margin * 100 : null), "%"],
      ["D/E", (x) => x.v.debt_to_equity, "×"],
      ["Chất lượng", (x) => x.q, ""],
    ];
    const metTraces = data.map((x, i) => ({
      type: "bar", name: x.t,
      x: METRICS.map((m) => m[0]), y: METRICS.map((m) => m[1](x)),
      marker: { color: SERIES[i % SERIES.length] },
      hovertemplate: `${x.t} %{x}: %{y:.2f}<extra></extra>`,
    }));
    pending.push(() => window.Plotly.react(metCard.querySelector("#cmp-metrics"), metTraces, {
      height: 340, dragmode: false, barmode: "group", margin: { l: 50, r: 14, t: 26, b: 34 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
      legend: { orientation: "h", y: 1.1, x: 0, font: { size: 10 } },
      xaxis: { type: "category", showgrid: false, tickfont: { size: 10 } },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 } },
    }, { displayModeBar: false, responsive: true }));

    // ── 4. Revenue & net income, five years ──────────────────────────
    const annCard = card("Doanh thu & Lợi nhuận ròng (5 năm)", "cmp-annual");
    const years = [...new Set(data.flatMap((x) =>
      (x.d.financials || []).filter((f) => f.period_type === "Y").map((f) => String(f.period).slice(0, 4))))]
      .sort().slice(-5);
    const annTraces = [];
    data.forEach((x, i) => {
      const ann = new Map((x.d.financials || []).filter((f) => f.period_type === "Y")
        .map((f) => [String(f.period).slice(0, 4), f]));
      annTraces.push({
        type: "bar", name: `${x.t} · Doanh thu`, x: years,
        y: years.map((y) => (ann.get(y) || {}).revenue ?? null),
        marker: { color: SERIES[i % SERIES.length] },
        hovertemplate: `${x.t} DT %{x}: %{y:,.0f} tỷ<extra></extra>`,
      });
      annTraces.push({
        type: "scatter", mode: "lines+markers", name: `${x.t} · LN ròng`, x: years,
        y: years.map((y) => (ann.get(y) || {}).net_income ?? null), yaxis: "y2",
        line: { color: SERIES[i % SERIES.length], width: 1.6, dash: "dot" }, marker: { size: 5 },
        hovertemplate: `${x.t} LN %{x}: %{y:,.0f} tỷ<extra></extra>`,
      });
    });
    pending.push(() => window.Plotly.react(annCard.querySelector("#cmp-annual"), annTraces, {
      height: 380, dragmode: false, barmode: "group", margin: { l: 58, r: 58, t: 26, b: 34 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
      legend: { orientation: "h", y: 1.12, x: 0, font: { size: 9 } },
      xaxis: { type: "category", showgrid: false, tickfont: { size: 10 } },
      yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 },
               title: { text: "Doanh thu (tỷ ₫)", font: { size: 10 } } },
      yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: { size: 9 },
                title: { text: "LN ròng (tỷ ₫)", font: { size: 10 } } },
      hovermode: "x unified",
    }, { displayModeBar: false, responsive: true }));

    // ── 5. Detail table ──────────────────────────────────────────────
    const tbl = el(`<div class="card"><h2 class="sec-h">Bảng so sánh chi tiết</h2>
      <table class="screen"><thead><tr>
        <th>Mã</th><th>Ngành</th><th>Giá</th><th>P/E</th><th>P/B</th><th>ROE</th>
        <th>Biên LN ròng</th><th>D/E</th><th>Upside</th><th>Chất lượng</th><th>Tín hiệu</th>
      </tr></thead><tbody></tbody></table></div>`);
    const tb = tbl.querySelector("tbody");
    for (const x of data) {
      const px = (x.d.prices || []);
      const lastC = px.length ? px[px.length - 1].close : null;
      const tr = el(`<tr>
        <td><b>${x.t}</b></td>
        <td class="dim">${F.escapeHtml(x.sector || "")}</td>
        <td>${F.priceVND(lastC)}</td>
        <td>${F.mult(x.v.pe, 1)}</td><td>${F.mult(x.v.pb)}</td><td>${F.pct(x.v.roe)}</td>
        <td>${F.pct(x.v.net_margin)}</td><td>${F.mult(x.v.debt_to_equity)}</td>
        <td style="color:${(x.upFrac ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${x.upFrac == null ? "—" : F.pctSigned(x.upFrac * 100)}</td>
        <td>${x.q.toFixed(0)}</td>
        <td>${x.sig ? `<span style="color:${SIGNAL_COLOR[x.sig]}">${SIGNAL_VI[x.sig]}</span>` : "—"}</td></tr>`);
      if (onPick) tr.onclick = () => onPick(x.t);
      tb.appendChild(tr);
    }
    body.appendChild(tbl);

    pending.forEach((fn) => fn());
  }

  drawChips();
  await rebuild();
}

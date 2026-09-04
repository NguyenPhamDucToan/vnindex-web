// "So sánh Cổ phiếu" — the multi-ticker comparison view.
//
// Mirrors the original's five sections: a ticker multi-select, normalised price
// performance, an overall radar profile, a financial-metric comparison, five
// years of revenue/net income, and a detail table. Everything is derived from
// the exported per-ticker files plus the screener snapshot, so no new data.
import { loadTicker, loadScreener } from "./data.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR } from "./signals.js";
import { computeTTM } from "./ttm.js";
import { axesFor, normalise } from "./sector-metrics.js";
import * as F from "./format.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const FONT = { family: "Fira Code, monospace", size: 10, color: "#0a121d" };
// Palette for the per-ticker series; distinct hues rather than a gradient so
// six overlapping lines stay tellable apart.
// Same Excel-ish series palette the original uses for multi-ticker charts.
const SERIES = ["#5b9bd5", "#f0ad4e", "#70ad47", "#7030a0", "#5bc0de", "#c00000"];

export async function renderCompare(root, onPick) {
  root.innerHTML = `<div class="loading">Đang tải…</div>`;
  const screen = await loadScreener();
  const byTicker = new Map(screen.map((r) => [r.ticker, r]));

  // Default to the ticker being viewed plus its most-traded sector peers, as the
  // original does -- opening this on a steel stock should compare steel names,
  // not a fixed blue-chip list.
  const current = new URLSearchParams(location.search).get("ticker");
  let picked;
  const cur = current && byTicker.get(current);
  if (cur && cur.sector) {
    const peers = screen.filter((r) => r.sector === cur.sector && r.ticker !== current)
      .sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 3).map((r) => r.ticker);
    picked = [current, ...peers];
  } else {
    picked = screen.slice().sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 4).map((r) => r.ticker);
  }

  root.innerHTML = "";
  const shell = el(`<div>
    <div class="card">
      <h2 class="sec-h">So sánh Cổ phiếu</h2>
      <div class="cmp-pick">
        <input id="cmp-input" placeholder="Thêm mã… (tối đa 6)" autocomplete="off" spellcheck="false" />
        <div id="cmp-sugg" class="hidden"></div>
        <div id="cmp-chips" class="cmp-chips"></div>
      </div>
      <label class="cmp-ind"><input type="checkbox" id="cmp-industry" />
        Toàn ngành <span class="dim">· so mã đầu tiên với tất cả công ty cùng ngành</span></label>
    </div>
    <div id="cmp-body"></div>
  </div>`);
  root.appendChild(shell);

  const input = shell.querySelector("#cmp-input");
  const sugg = shell.querySelector("#cmp-sugg");
  const chips = shell.querySelector("#cmp-chips");
  // "Toàn ngành": overlay the sector average on the radar and widen the table
  // to the whole sector, as the original's toggle does.
  const indBox = shell.querySelector("#cmp-industry");
  let industryMode = false;
  indBox.addEventListener("change", () => { industryMode = indBox.checked; rebuild(); });

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
                    ttm: computeTTM(d.financials || []) || {},
                    sector: (d.company || {}).sector, name: (d.company || {}).name });
      } catch { /* unknown ticker -- skip */ }
    }
    if (!data.length) { body.innerHTML = `<div class="loading">Không tải được dữ liệu.</div>`; return; }

    // Industry average for the radar. Loading a whole sector can mean sixty
    // per-ticker files, so cap at the twenty most-traded names -- enough for a
    // stable mean, and the label says how many went into it.
    let industryAvg = null;
    if (industryMode && data[0] && data[0].sector) {
      const sectorAxes = axesFor([data[0].sector]);
      const peers = screen.filter((r) => r.sector === data[0].sector)
        .sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 20);
      const acc = {}, cnt = {};
      for (const a of sectorAxes) { acc[a.label] = 0; cnt[a.label] = 0; }
      let n = 0;
      for (const r of peers) {
        let pd;
        try { pd = await loadTicker(r.ticker); } catch { continue; }
        const pv = pd.valuation || {};
        const ctx = {
          t: r.ticker, d: pd, v: pv,
          q: computeQualityScore(pv.roe, pv.net_margin, pv.profit_quality, pv.fcf_margin,
                                 pv.current_ratio, pv.debt_to_equity),
          upFrac: F.isNum((pd.model || {}).upside) ? pd.model.upside : null,
          ttm: computeTTM(pd.financials || []) || {},
        };
        n++;
        for (const a of sectorAxes) {
          let raw = null;
          try { raw = a.calc(ctx); } catch { raw = null; }
          if (F.isNum(raw)) { acc[a.label] += raw; cnt[a.label]++; }
        }
      }
      if (n) {
        const raw = {}, norm = {};
        for (const a of sectorAxes) {
          raw[a.label] = cnt[a.label] ? acc[a.label] / cnt[a.label] : null;
          norm[a.label] = normalise(a, raw[a.label]);
        }
        industryAvg = { n, raw, norm };
      }
    }

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
    // Axes follow the sector when every selected name shares one -- comparing
    // banks on gross margin, or insurers on inventory turns, says nothing.
    const axes = axesFor(data.map((x) => x.sector));
    const theta = axes.map((a) => a.label);
    const radarCard = card("Hồ sơ tổng thể", "cmp-radar",
      `<div class="vb-note">Trục: ${axes.map((a) => a.label).join(" · ")}.
       Mỗi trục chuẩn hóa 0–100 theo ngưỡng tham chiếu; trục "càng thấp càng tốt"
       được đảo chiều nên xa tâm luôn là tốt hơn. Hover để xem số thực.</div>`);

    const traceFor = (name, vals, labels, color, dash, fillAlpha) => ({
      type: "scatterpolar", name, fill: "toself",
      r: vals.concat([vals[0]]), theta: theta.concat([theta[0]]),
      customdata: labels.concat([labels[0]]),
      line: { color, width: dash ? 2 : 2.5, dash: dash || "solid" },
      fillcolor: color + fillAlpha,
      hovertemplate: `%{theta}: %{customdata}<extra>${name}</extra>`,
    });

    const radarTraces = [];
    // Industry average first so the individual names draw on top of it.
    if (industryMode && data.length && data[0].sector) {
      const peers = screen.filter((r) => r.sector === data[0].sector);
      if (peers.length > 1 && industryAvg) {
        const vals = axes.map((a) => industryAvg.norm[a.label] ?? 0);
        const labels = axes.map((a) => a.fmt(industryAvg.raw[a.label]));
        radarTraces.push(traceFor(`TB ngành (${industryAvg.n} CP)`, vals, labels,
                                  "#f97316", "dash", "1f"));
      }
    }
    for (const [i, x] of data.entries()) {
      const raws = axes.map((a) => { try { return a.calc(x); } catch { return null; } });
      radarTraces.push(traceFor(x.t, axes.map((a, k) => normalise(a, raws[k])),
                                axes.map((a, k) => a.fmt(raws[k])),
                                SERIES[i % SERIES.length], null, "33"));
    }
    pending.push(() => window.Plotly.react(radarCard.querySelector("#cmp-radar"), radarTraces, {
      height: 440, dragmode: false, margin: { l: 60, r: 60, t: 20, b: 60 },
      paper_bgcolor: "rgba(0,0,0,0)", font: FONT,
      // Without an explicit square domain the polar drifts to one side of a
      // very wide card; the original's container is narrow so it never did.
      polar: {
        domain: { x: [0.28, 0.72], y: [0, 1] },
        bgcolor: "rgba(241,245,249,0.95)",
        radialaxis: { visible: true, range: [0, 100], showticklabels: false,
                      showline: false, ticks: "", gridcolor: "#e2e8f0" },
        angularaxis: { gridcolor: "#e2e8f0", linecolor: "#64748b", tickfont: { size: 10 } },
      },
      legend: { orientation: "h", yanchor: "bottom", y: -0.14, xanchor: "center", x: 0.5,
                font: { size: 10 } },
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

    // ── 4. Revenue, net income and revenue growth, five years ────────
    const years = [...new Set(data.flatMap((x) =>
      (x.d.financials || []).filter((f) => f.period_type === "Y").map((f) => String(f.period).slice(0, 4))))]
      .sort().slice(-5);
    const annOf = (x) => new Map((x.d.financials || []).filter((f) => f.period_type === "Y")
      .map((f) => [String(f.period).slice(0, 4), f]));

    const annCard = el(`<div class="card"><h2 class="sec-h">Doanh thu &amp; Lợi nhuận ròng (5 năm)</h2><div class="qgrid"></div></div>`);
    body.appendChild(annCard);
    const annualChart = (title, id, pick, suffix) => {
      const box = el(`<div class="qchart"><div class="qtitle">${title}</div><div id="${id}"></div></div>`);
      annCard.querySelector(".qgrid").appendChild(box);
      const c = annCard;
      const tr = data.map((x, i) => {
        const ann = annOf(x);
        return {
          type: "bar", name: x.t, x: years, y: years.map((y) => pick(ann.get(y), ann, y)),
          marker: { color: SERIES[i % SERIES.length] },
          hovertemplate: `${x.t} %{x}: %{y:,.1f}${suffix}<extra></extra>`,
        };
      });
      pending.push(() => window.Plotly.react(c.querySelector("#" + id), tr, {
        height: 340, dragmode: false, barmode: "group", margin: { l: 58, r: 14, t: 26, b: 34 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
        legend: { orientation: "h", y: 1.1, x: 0, font: { size: 10 } },
        xaxis: { type: "category", showgrid: false, tickfont: { size: 10 } },
        yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, ticksuffix: suffix },
        hovermode: "x unified",
      }, { displayModeBar: false, responsive: true }));
    };
    annualChart("Doanh thu (tỷ đồng)", "cmp-rev", (r) => (r && F.isNum(r.revenue) ? r.revenue : null), "");
    annualChart("Lợi nhuận ròng (tỷ đồng)", "cmp-ni", (r) => (r && F.isNum(r.net_income) ? r.net_income : null), "");
    annualChart("Tăng trưởng doanh thu YoY (%)", "cmp-growth", (r, ann, y) => {
      const prev = ann.get(String(+y - 1));
      return (r && prev && F.isNum(r.revenue) && F.isNum(prev.revenue) && prev.revenue)
        ? (r.revenue - prev.revenue) / Math.abs(prev.revenue) * 100 : null;
    }, "%");

    // ── 5. Transposed metric table (one row per metric, one column per mã) ──
    const MET = [
      ["Giá", (x) => F.priceVND((x.d.prices || []).slice(-1)[0]?.close)],
      ["P/E", (x) => F.mult(x.v.pe)], ["P/B", (x) => F.mult(x.v.pb)],
      ["ROE", (x) => F.pct(x.v.roe)], ["Biên LN ròng", (x) => F.pct(x.v.net_margin)],
      ["FCF Margin", (x) => F.pct(x.v.fcf_margin)], ["D/E", (x) => F.mult(x.v.debt_to_equity)],
      ["Current ratio", (x) => F.mult(x.v.current_ratio)],
      ["Avg Upside", (x) => (x.upFrac == null ? "—" : F.pctSigned(x.upFrac * 100))],
      ["Quality", (x) => x.q.toFixed(0)],
    ];
    const tt = el(`<div class="card"><h2 class="sec-h">Bảng chỉ số theo mã</h2>
      <div class="ta-scroll"><table class="screen"><thead><tr><th>Chỉ số</th>${
        data.map((x) => `<th>${x.t}</th>`).join("")}</tr></thead><tbody></tbody></table></div></div>`);
    for (const [name, fn] of MET) {
      tt.querySelector("tbody").appendChild(el(`<tr><td class="dim">${name}</td>${
        data.map((x) => `<td>${fn(x)}</td>`).join("")}</tr>`));
    }
    body.appendChild(tt);

    // ── 6. Detail table ──────────────────────────────────────────────
    const tbl = el(`<div class="card"><h2 class="sec-h">Bảng so sánh chi tiết</h2>
      <table class="screen"><thead><tr>
        <th>Mã</th><th>Ngành</th><th>Giá</th><th>P/E</th><th>P/B</th><th>ROE</th>
        <th>LN ròng</th><th>FCF Margin</th><th>D/E</th><th>CR</th><th>Avg Upside</th><th>Quality</th>
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
        <td>${F.pct(x.v.net_margin)}</td><td>${F.pct(x.v.fcf_margin)}</td>
        <td>${F.mult(x.v.debt_to_equity)}</td><td>${F.mult(x.v.current_ratio)}</td>
        <td style="color:${(x.upFrac ?? 0) >= 0 ? "#15803d" : "#b91c1c"}">${x.upFrac == null ? "—" : F.pctSigned(x.upFrac * 100)}</td>
        <td>${x.q.toFixed(0)}</td></tr>`);
      if (onPick) tr.onclick = () => onPick(x.t);
      tb.appendChild(tr);
    }
    body.appendChild(tbl);

    pending.forEach((fn) => fn());
  }

  drawChips();
  await rebuild();
}

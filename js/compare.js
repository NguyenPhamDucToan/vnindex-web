// "So sánh Cổ phiếu" — the multi-ticker comparison view.
//
// Mirrors the original's five sections: a ticker multi-select, normalised price
// performance, an overall radar profile, a financial-metric comparison, five
// years of revenue/net income, and a detail table. Everything is derived from
// the exported per-ticker files plus the screener snapshot, so no new data.
import { loadTicker, loadScreener, loadMarket } from "./data.js";
import { computeQualityScore, classifySignal, SIGNAL_VI, SIGNAL_COLOR } from "./signals.js";
import { computeTTM } from "./ttm.js";
import { axesFor, normalise, SECTOR_AXES } from "./sector-metrics.js";
import * as F from "./format.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const FONT = { family: "Fira Code, monospace", size: 10, color: "#0a121d" };
// Palette for the per-ticker series; distinct hues rather than a gradient so
// six overlapping lines stay tellable apart.
// Same Excel-ish series palette the original uses for multi-ticker charts.
const SERIES = ["#5b9bd5", "#f0ad4e", "#70ad47", "#7030a0", "#5bc0de", "#c00000"];

// The series palette is tuned for chart marks on white; as 14px text on the
// page background several of those hues land near 2.5:1. Darken toward black
// until the contrast is readable, keeping the hue so a cell still reads as
// belonging to its column.
function readable(hex, bg = [242, 245, 251], target = 4.5) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (c) => {
    const a = lum(c), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  let out = rgb;
  for (let k = 0; k < 20 && ratio(out) < target; k++) out = out.map((v) => Math.round(v * 0.9));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

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
      <label class="cmp-ind">
        <input type="checkbox" id="cmp-industry" class="sw-in" />
        <span class="sw" aria-hidden="true"></span>
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
       được đảo chiều nên xa tâm luôn là tốt hơn.
       <b>Rê chuột dọc một trục</b> để xem toàn bộ mã đang so trên tiêu chí đó, xếp từ tốt nhất.</div>`);

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
    // Keep each name's raw values so the spoke summary can rank them.
    const perName = [];
    for (const [i, x] of data.entries()) {
      const raws = axes.map((a) => { try { return a.calc(x); } catch { return null; } });
      const colour = SERIES[i % SERIES.length];
      perName.push({ name: x.t, raws, colour });
      radarTraces.push(traceFor(x.t, axes.map((a, k) => normalise(a, raws[k])),
                                axes.map((a, k) => a.fmt(raws[k])), colour, null, "33"));
    }

    // One summary per axis: every name on that criterion, best first, each with
    // a swatch in its own colour. "Best" follows the axis, so a lowerBetter
    // metric ranks ascending.
    const spokeText = axes.map((a, k) => {
      const rows = perName
        .map((n) => ({ ...n, v: n.raws[k] }))
        .filter((n) => F.isNum(n.v))
        .sort((p2, q2) => (a.lowerBetter ? p2.v - q2.v : q2.v - p2.v));
      if (industryAvg && F.isNum(industryAvg.raw[a.label])) {
        rows.push({ name: `TB ngành (${industryAvg.n})`, colour: "#f97316",
                    v: industryAvg.raw[a.label] });
      }
      const hint = a.lowerBetter ? " · càng thấp càng tốt" : "";
      return `<b>${a.label}</b>${hint}<br>` + (rows.length
        ? rows.map((n) => `<span style="color:${n.colour}">■</span> ${n.name}: <b>${a.fmt(n.v)}</b>`)
              .join("<br>")
        : "—");
    });

    // Invisible hit-points spread along each spoke, so the summary is reachable
    // anywhere on the axis rather than only at its tip.
    const hitR = [12, 30, 48, 66, 84, 99];
    radarTraces.push({
      type: "scatterpolar", mode: "markers", showlegend: false, hoverinfo: "text",
      r: axes.flatMap(() => hitR),
      theta: axes.flatMap((a) => hitR.map(() => a.label)),
      text: axes.flatMap((_, k) => hitR.map(() => spokeText[k])),
      marker: { size: 26, color: "rgba(0,0,0,0)" },
      hoverlabel: { bgcolor: "#ffffff", bordercolor: "#e2e8f0", align: "left",
                    font: { ...FONT, size: 12, color: "#0f172a" } },
    });
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

    // ── 3. Metric comparison table, graded by rank ───────────────────
    // Grouped by family, one column per ticker, each row shaded so the best
    // value reads darkest. A table, not a chart: these metrics share no axis
    // (a 2.5% NIM against a 1.03x LDR), and it stays readable at twenty
    // columns in industry mode where bars would not.
    const sectorNames = [...new Set(data.map((x) => x.sector).filter(Boolean))];
    const sAxes = (sectorNames.length === 1 && SECTOR_AXES[sectorNames[0]])
      ? SECTOR_AXES[sectorNames[0]] : null;

    const pct1 = (v) => (F.isNum(v) ? `${(v * 100).toFixed(1)}%` : null);
    const mult = (v) => (F.isNum(v) ? `${v.toFixed(2)}×` : null);
    // Price is in thousands VND and shares in millions, so the product is VND
    // billions; the original reports this column in nghìn tỷ.
    const mcapOf = (x) => {
      const px = (x.d.prices || []).slice(-1)[0];
      const sh = x.ttm.shares_outstanding;
      return (px && F.isNum(px.close) && F.isNum(sh)) ? px.close * sh / 1000 : null;
    };
    const GROUPS = [
      ["Thị trường", [
        ["Vốn hóa (nghìn tỷ)", mcapOf, true, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })],
      ]],
      ["Định giá", [
        ["P/E", (x) => x.v.pe, false, (v) => `${v.toFixed(1)}x`],
        ["P/B", (x) => x.v.pb, false, (v) => `${v.toFixed(1)}x`],
      ]],
      ["Sinh lời", [
        ["Biên gộp", (x) => (x.ttm.revenue ? x.ttm.gross_profit / x.ttm.revenue : null), true, pct1],
        ["Biên EBIT", (x) => (x.ttm.revenue ? x.ttm.ebit / x.ttm.revenue : null), true, pct1],
        ["Biên LN ròng", (x) => x.v.net_margin, true, pct1],
        ["Biên FCF", (x) => x.v.fcf_margin, true, pct1],
        ["ROE", (x) => x.v.roe, true, pct1],
      ]],
      ["Sức khỏe", [
        ["D/E", (x) => x.v.debt_to_equity, false, mult],
        ["Current Ratio", (x) => x.v.current_ratio, true, mult],
      ]],
      ["Triển vọng", [
        ["Avg Upside", (x) => x.upFrac, true, (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`],
        ["Quality", (x) => x.q, true, (v) => v.toFixed(0)],
      ]],
    ];
    if (sAxes) {
      // Several sector axes (ROE, net margin, ...) are already in the shared
      // groups above; repeating them would pad the table with duplicate rows.
      const shown = new Set(GROUPS.flatMap(([, rows]) => rows.map(([l]) => l)));
      const own = sAxes.filter((a) => !shown.has(a.label));
      if (own.length) {
        GROUPS.push([`Đặc thù ngành · ${sectorNames[0]}`,
          own.map((a) => [a.label, (x) => { try { return a.calc(x); } catch { return null; } },
                          !a.lowerBetter, a.fmt])]);
      }
    }

    const cmpCard = el(`<div class="card">
      <h2 class="sec-h">So sánh chỉ số tài chính${sAxes ? ` <span class="ta-sub">· gồm chỉ số riêng của ${F.escapeHtml(sectorNames[0])}</span>` : ""}</h2>
      <div class="vb-note">★ = dẫn đầu hàng đó, tô theo màu của mã; hạng nhì đậm hơn phần còn lại.</div>
      <div class="ta-scroll"><table class="screen cmp-heat"><thead><tr><th>Chỉ số</th></tr></thead><tbody></tbody></table></div>
    </div>`);
    body.appendChild(cmpCard);

    // Columns: the picked tickers, then the sector mean when it is on.
    const cols = data.map((x, i) => ({ label: x.t, ctx: x, colour: SERIES[i % SERIES.length] }));
    if (industryAvg) cols.push({ label: `TB ngành (${industryAvg.n})`, avg: true, colour: "#f97316" });

    const head = cmpCard.querySelector("thead tr");
    for (const c of cols) {
      head.appendChild(el(`<th style="color:${c.colour};border-top:3px solid ${c.colour}">${
        F.escapeHtml(c.label)}</th>`));
    }
    const cmpBody = cmpCard.querySelector("tbody");
    // rankLog[colIndex] = [{label, rank, of}] -- feeds the summary above.
    const rankLog = cols.map(() => []);
    for (const [group, rows] of GROUPS) {
      cmpBody.appendChild(el(`<tr class="cmp-grp"><td colspan="${cols.length + 1}">${F.escapeHtml(group)}</td></tr>`));
      for (const [label, get, higherBetter, fmt] of rows) {
        const vals = cols.map((c) => {
          if (!c.avg) { try { return get(c.ctx); } catch { return null; } }
          return industryAvg && F.isNum(industryAvg.raw[label]) ? industryAvg.raw[label] : null;
        });
        const valid = vals.map((v, i) => [v, i]).filter(([v]) => F.isNum(v));
        // Rank inside the row, so shading answers "best here", not "biggest".
        const order = valid.slice().sort((a, b) => (higherBetter ? b[0] - a[0] : a[0] - b[0]));
        const rank = new Map(order.map(([, i], r) => [i, r]));
        const tr = el(`<tr><td class="dim">${F.escapeHtml(label)}</td></tr>`);
        vals.forEach((v, i) => {
          if (!F.isNum(v)) { tr.appendChild(el(`<td class="num dim">—</td>`)); return; }
          const r = rank.get(i) ?? valid.length;
          if (valid.length > 1) rankLog[i].push({ label, rank: r, of: valid.length });
          // Three text tiers, as the original grades them: leader in its own
          // column colour, runner-up darker, the rest grey. No cell fill.
          const best = r === 0 && valid.length > 1;
          const tier = best ? "cmp-r0" : r === 1 ? "cmp-r1" : "cmp-r2";
          // Only the leader is tinted -- one cell per row, so the table stays
          // calm while the winner is unmissable. Text and tint share the hue.
          const style = best
            ? ` style="color:${readable(cols[i].colour)};background:${cols[i].colour}22"`
            : "";
          tr.appendChild(el(`<td class="num ${tier}"${style}>${
            F.escapeHtml(fmt(v) ?? "—")}${best ? ' <span class="cmp-star">★</span>' : ""}</td>`));
        });
        cmpBody.appendChild(tr);
      }
    }

    // ── 3b. Who wins where ───────────────────────────────────────────
    // The sector average is a yardstick, not a contender, so it is excluded
    // from the win count -- otherwise "TB ngành" would appear to compete.
    const contenders = cols.map((c, i) => ({ ...c, i }))
      .filter((c) => !c.avg && rankLog[c.i].length);
    if (contenders.length > 1) {
      const summary = el(`<div class="card">
        <h2 class="sec-h">Tổng kết so sánh</h2>
        <div class="vb-note">Thứ hạng tính trong chính nhóm đang so, không phải toàn thị trường.</div>
        <div class="cmp-cards"></div></div>`);
      const grid = summary.querySelector(".cmp-cards");
      const ranked = contenders
        .map((c) => ({ ...c, wins: rankLog[c.i].filter((r) => r.rank === 0).length }))
        .sort((a, b) => b.wins - a.wins);
      for (const c of ranked) {
        const log = rankLog[c.i];
        const total = log.length;
        // Strongest = best relative position; ties broken by the wider field.
        const byPos = log.slice().sort((a, b) =>
          (a.rank / Math.max(1, a.of - 1)) - (b.rank / Math.max(1, b.of - 1)));
        const strong = byPos.slice(0, 3).map((r) => r.label);
        const weak = byPos.slice(-2).reverse().map((r) => r.label);
        grid.appendChild(el(`<div class="cmp-card" style="border-top-color:${c.colour}">
          <div class="cmp-t" style="color:${c.colour}">${F.escapeHtml(c.label)}</div>
          <div class="cmp-w">${c.wins}<span class="cmp-wl">/${total} chỉ số dẫn đầu</span></div>
          <div class="cmp-l"><b>Mạnh</b> ${F.escapeHtml(strong.join(" · "))}</div>
          <div class="cmp-l"><b>Yếu</b> ${F.escapeHtml(weak.join(" · "))}</div>
        </div>`));
      }
      body.insertBefore(summary, cmpCard);
    }

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

    // (The transposed metric table that used to sit here is gone: the
    // grouped, rank-shaded comparison table above shows the same rows with
    // the sector's own metrics folded in.)

    // ── 5. Margins over five years ───────────────────────────────────
    // Revenue and profit levels are above; margins say whether the growth came
    // with operating leverage or was bought.
    const marginCard = el(`<div class="card"><h2 class="sec-h">Biên lợi nhuận (5 năm)</h2>
      <div class="vb-note">Biên gộp và biên EBIT trống với ngân hàng và bảo hiểm — hai ngành
        không có giá vốn hàng bán theo nghĩa thông thường.</div>
      <div class="qgrid"></div></div>`);
    body.appendChild(marginCard);
    const marginChart = (title, id, pick) => {
      const box = el(`<div class="qchart"><div class="qtitle">${title}</div><div id="${id}"></div></div>`);
      marginCard.querySelector(".qgrid").appendChild(box);
      const tr = data.map((x, i) => {
        const ann = annOf(x);
        return {
          type: "scatter", mode: "lines+markers", name: x.t, x: years,
          y: years.map((y) => { const r = ann.get(y); const v = r ? pick(r) : null; return F.isNum(v) ? v * 100 : null; }),
          line: { color: SERIES[i % SERIES.length], width: 1.8 }, marker: { size: 5 },
          connectgaps: true,
          hovertemplate: `${x.t} %{x}: %{y:.1f}%<extra></extra>`,
        };
      }).filter((t) => t.y.some(F.isNum));
      if (!tr.length) { box.remove(); return; }
      pending.push(() => window.Plotly.react(marginCard.querySelector("#" + id), tr, {
        height: 320, dragmode: false, margin: { l: 52, r: 14, t: 26, b: 34 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
        legend: { orientation: "h", y: 1.1, x: 0, font: { size: 10 } },
        xaxis: { type: "category", showgrid: false, tickfont: { size: 10 } },
        yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, ticksuffix: "%" },
        hovermode: "x unified",
      }, { displayModeBar: false, responsive: true }));
    };
    marginChart("Biên gộp", "cmp-gm", (r) => (r.revenue ? r.gross_profit / r.revenue : null));
    marginChart("Biên EBIT", "cmp-em", (r) => (r.revenue ? r.ebit / r.revenue : null));
    marginChart("Biên LN ròng", "cmp-nm", (r) => (r.revenue ? r.net_income / r.revenue : null));

    // ── 6. Risk, return, market sensitivity and liquidity ────────────
    const market = await loadMarket().catch(() => null);
    const idxSeries = ((market || {}).vnindex || []);
    const idxByDate = new Map(idxSeries.map((r) => [r.date, r.close]));
    const rets = (px) => {
      const out = [];
      for (let i = 1; i < px.length; i++) {
        const a = px[i - 1].close, b = px[i].close;
        if (a > 0 && b > 0) out.push({ date: px[i].date, r: b / a - 1 });
      }
      return out;
    };
    const TRADING_DAYS = 252, RF = 0.05;   // config.py's VN risk-free rate
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const sd = (a) => {
      if (a.length < 2) return null;
      const m = mean(a);
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
    };
    const horizonReturn = (px, days) => {
      if (px.length < days + 1) return null;
      const a = px[px.length - 1 - days].close, b = px[px.length - 1].close;
      return (a > 0 && b > 0) ? b / a - 1 : null;
    };

    const riskRows = data.map((x, i) => {
      const all = x.d.prices || [];
      const px = all.slice(-TRADING_DAYS);
      if (px.length < 60) return null;
      const rr = rets(px);
      const rs = rr.map((q) => q.r);
      const total = px[px.length - 1].close / px[0].close - 1;
      const vol = sd(rs) * Math.sqrt(TRADING_DAYS);
      // Downside deviation: only the days that lost money, which is the risk a
      // holder actually minds. A plain SD punishes upside moves equally.
      const down = rs.filter((v) => v < 0);
      const dvol = down.length > 1 ? sd(down) * Math.sqrt(TRADING_DAYS) : null;
      // Peak-to-trough walked forward -- the loss actually sat through.
      let peak = px[0].close, mdd = 0, troughIdx = 0, peakIdx = 0, curPeak = 0;
      px.forEach((q, k) => {
        if (q.close > peak) { peak = q.close; curPeak = k; }
        const dd = q.close / peak - 1;
        if (dd < mdd) { mdd = dd; troughIdx = k; peakIdx = curPeak; }
      });
      // Days since the trough that the price has still not reclaimed the peak.
      let recovery = null;
      if (mdd < 0) {
        const target = px[peakIdx].close;
        const after = px.slice(troughIdx).findIndex((q) => q.close >= target);
        recovery = after >= 0 ? after : null;   // null = not recovered yet
      }
      // Beta and correlation need both series on the same days.
      const pairs = [];
      for (let k = 1; k < rr.length; k++) {
        const prev = idxByDate.get(rr[k - 1].date), cur = idxByDate.get(rr[k].date);
        if (prev > 0 && cur > 0) pairs.push([rr[k].r, cur / prev - 1]);
      }
      let beta = null, alpha = null, corrIdx = null;
      if (pairs.length > 60) {
        const xs = pairs.map((q) => q[0]), ys = pairs.map((q) => q[1]);
        const mx = mean(xs), my = mean(ys);
        const cov = pairs.reduce((a, q) => a + (q[0] - mx) * (q[1] - my), 0) / (pairs.length - 1);
        const vy = pairs.reduce((a, q) => a + (q[1] - my) ** 2, 0) / (pairs.length - 1);
        beta = vy > 0 ? cov / vy : null;
        const sx = sd(xs), sy = sd(ys);
        corrIdx = (sx && sy) ? cov / (sx * sy) : null;
        // Jensen's alpha, annualised: return earned beyond what the beta
        // exposure alone would have produced.
        if (F.isNum(beta)) {
          const mktTotal = my * pairs.length;
          alpha = (total - RF) - beta * (mktTotal - RF);
        }
      }
      const sharpe = vol > 0 ? (total - RF) / vol : null;
      const sortino = dvol > 0 ? (total - RF) / dvol : null;
      const winRate = rs.length ? rs.filter((v) => v > 0).length / rs.length : null;
      // Traded value per session, in billions: price is thousands VND.
      const liq = mean(px.map((q) => (q.close || 0) * (q.volume || 0) / 1e6));
      return { t: x.t, colour: SERIES[i % SERIES.length],
               r3: horizonReturn(all, 63), r6: horizonReturn(all, 126), total,
               vol, dvol, mdd, recovery, beta, alpha, corrIdx, sharpe, sortino, winRate, liq };
    }).filter(Boolean);

    if (riskRows.length) {
      const pctS = (v) => (F.isNum(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—");
      const pct = (v) => (F.isNum(v) ? `${(v * 100).toFixed(1)}%` : "—");
      const num = (v) => (F.isNum(v) ? v.toFixed(2) : "—");
      const days = (v) => (F.isNum(v) ? `${v} phiên` : "chưa hồi");
      const bn = (v) => (F.isNum(v) ? `${v.toFixed(1)} tỷ` : "—");
      // [label, get, format, higherBetter]  -- null means neither is "better".
      const RISK_GROUPS = [
        ["Lợi nhuận", [
          ["3 tháng", (r) => r.r3, pctS, true],
          ["6 tháng", (r) => r.r6, pctS, true],
          ["1 năm", (r) => r.total, pctS, true],
        ]],
        ["Rủi ro", [
          ["Biến động (năm hóa)", (r) => r.vol, pct, false],
          ["Biến động giảm giá", (r) => r.dvol, pct, false],
          ["Sụt giảm tối đa", (r) => r.mdd, pctS, true],
          ["Thời gian hồi phục", (r) => r.recovery, days, false],
          ["Tỷ lệ phiên tăng", (r) => r.winRate, pct, true],
        ]],
        ["Hiệu quả điều chỉnh rủi ro", [
          ["Sharpe (Rf 5%)", (r) => r.sharpe, num, true],
          ["Sortino (Rf 5%)", (r) => r.sortino, num, true],
        ]],
        ["Nhạy cảm thị trường", [
          ["Beta vs VN-Index", (r) => r.beta, num, null],
          ["Alpha (năm hóa)", (r) => r.alpha, pctS, true],
          ["Tương quan VN-Index", (r) => r.corrIdx, num, null],
        ]],
        ["Thanh khoản", [
          ["GTGD bình quân/phiên", (r) => r.liq, bn, true],
        ]],
      ];
      const rc = el(`<div class="card"><h2 class="sec-h">Rủi ro &amp; Hiệu suất <span class="ta-sub">· 1 năm</span></h2>
        <div class="vb-note">Beta &gt; 1 = dao động mạnh hơn VN-Index. Alpha = phần lãi vượt trên
          mức mà riêng độ nhạy beta đã giải thích được. Sortino giống Sharpe nhưng chỉ tính biến
          động của các phiên giảm — thứ rủi ro người cầm thực sự bận tâm.
          Beta và tương quan không chấm ★: cao hay thấp tốt hơn còn tùy mục đích nắm giữ.</div>
        <div class="ta-scroll"><table class="screen cmp-heat"><thead><tr><th>Chỉ số</th>${
          riskRows.map((r) => `<th style="color:${r.colour};border-top:3px solid ${r.colour}">${r.t}</th>`).join("")
        }</tr></thead><tbody></tbody></table></div></div>`);
      const rb = rc.querySelector("tbody");
      for (const [group, rows] of RISK_GROUPS) {
        rb.appendChild(el(`<tr class="cmp-grp"><td colspan="${riskRows.length + 1}">${group}</td></tr>`));
        for (const [label, get, fmt, higherBetter] of rows) {
          const vals = riskRows.map(get);
          const valid = vals.map((v, i) => [v, i]).filter(([v]) => F.isNum(v));
          let bestIdx = -1;
          if (higherBetter !== null && valid.length > 1) {
            bestIdx = valid.slice().sort((a, b) => (higherBetter ? b[0] - a[0] : a[0] - b[0]))[0][1];
          }
          const tr = el(`<tr><td class="dim">${label}</td></tr>`);
          vals.forEach((v, i) => {
            const best = i === bestIdx;
            tr.appendChild(el(best
              ? `<td class="num cmp-r0" style="color:${readable(riskRows[i].colour)};background:${riskRows[i].colour}22">${
                  F.escapeHtml(fmt(v))} <span class="cmp-star">★</span></td>`
              : `<td class="num cmp-r2">${F.escapeHtml(fmt(v))}</td>`));
          });
          rb.appendChild(tr);
        }
      }
      body.appendChild(rc);
    }

    // ── 7. How closely the names move together ───────────────────────
    if (data.length > 1) {
      const series = data.map((x) => new Map(rets((x.d.prices || []).slice(-TRADING_DAYS)).map((q) => [q.date, q.r])));
      const corr = (a, b) => {
        const xs = [], ys = [];
        for (const [d, v] of a) if (b.has(d)) { xs.push(v); ys.push(b.get(d)); }
        if (xs.length < 30) return null;
        const mx = mean(xs), my = mean(ys);
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < xs.length; i++) {
          sxy += (xs[i] - mx) * (ys[i] - my);
          sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
        }
        return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : null;
      };

      // Every unordered pair once. n names give n(n-1)/2 rows -- six for four
      // names, which is a short list, not a grid to decode.
      const pairs = [];
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          const v = corr(series[i], series[j]);
          if (F.isNum(v)) pairs.push({ a: data[i].t, b: data[j].t, v,
                                       ca: SERIES[i % SERIES.length], cb: SERIES[j % SERIES.length] });
        }
      }
      if (pairs.length) {
        pairs.sort((p2, q2) => q2.v - p2.v);
        const avg = mean(pairs.map((q) => q.v));
        // Bands from how equity correlations actually behave: above 0.7 two
        // names are effectively one position, below 0.4 they are genuinely
        // separate bets.
        const band = (v) => v >= 0.7 ? ["Gần như đi cùng nhau", "#b91c1c"]
          : v >= 0.55 ? ["Đi cùng chiều rõ", "#d97706"]
          : v >= 0.4 ? ["Cùng chiều vừa phải", "#ca8a04"]
          : v >= 0.2 ? ["Khá độc lập", "#4d7c0f"]
          : ["Gần như độc lập", "#15803d"];
        const overall = band(avg);

        const cc = el(`<div class="card">
          <h2 class="sec-h">Mức độ đi cùng nhau <span class="ta-sub">· lợi suất ngày, 1 năm</span></h2>
          <div class="vb-note">Đo mức hai mã cùng lên cùng xuống. Càng cao thì nắm cả hai càng
            ít tác dụng phân tán rủi ro — vì khi một mã giảm, mã kia thường giảm theo.
            Trung bình cả nhóm: <b style="color:${overall[1]}">${avg.toFixed(2)} — ${overall[0].toLowerCase()}</b>.</div>
          <div class="cr-list"></div></div>`);
        const list = cc.querySelector(".cr-list");
        for (const q of pairs) {
          const [label, colour] = band(q.v);
          list.appendChild(el(`<div class="cr-row">
            <div class="cr-pair"><span style="color:${readable(q.ca)}">${q.a}</span>
              <span class="cr-x">↔</span>
              <span style="color:${readable(q.cb)}">${q.b}</span></div>
            <div class="cr-track"><div class="cr-fill" style="width:${Math.max(2, q.v * 100).toFixed(0)}%;background:${colour}"></div></div>
            <div class="cr-val" style="color:${colour}">${q.v.toFixed(2)}</div>
            <div class="cr-lab">${label}</div>
          </div>`));
        }
        body.appendChild(cc);
      }
    }

    // (The detail table that used to close this view is gone: it repeated
    // the comparison table's numbers transposed.)

    pending.forEach((fn) => fn());
  }

  drawChips();
  await rebuild();
}

// "So sánh Cổ phiếu" — the multi-ticker comparison view.
//
// Mirrors the original's five sections: a ticker multi-select, normalised price
// performance, an overall radar profile, a financial-metric comparison, five
// years of revenue/net income, and a detail table. Everything is derived from
// the exported per-ticker files plus the screener snapshot, so no new data.
import { loadTicker, loadScreener } from "./data.js";
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
          tr.appendChild(el(`<td class="num ${tier}"${best ? ` style="color:${readable(cols[i].colour)}"` : ""}>${
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

    // (The detail table that used to close this view is gone: it repeated
    // the comparison table's numbers transposed.)

    pending.forEach((fn) => fn());
  }

  drawChips();
  await rebuild();
}

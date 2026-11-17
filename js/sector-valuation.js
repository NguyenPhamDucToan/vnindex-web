// "Định giá ngành so với lịch sử": each sector's P/E and P/B today against the
// median of its own quarterly history (data/sector_history.json, written by
// export_market_history.py). The sector view's other cards rank sectors
// against each other; this one asks whether a sector is cheap against itself.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => F.escapeHtml(s ?? "");

// Same bar as the market card: within ±10% of the median is the usual range.
const BAND = 0.10;
const median = (xs) => {
  const s = xs.filter(F.isNum).sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const dev = (now, med) => (F.isNum(now) && F.isNum(med) && med > 0 ? now / med - 1 : null);
const devCell = (d) => (d == null ? `<span class="dim">—</span>`
  : `<span class="${d <= -BAND ? "gain" : d >= BAND ? "loss" : ""}">${Math.round(d * 100) === 0 ? "" : d > 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}%</span>`);
const VERDICT = {
  cheap: ["Rẻ hơn lịch sử", "#15803d"], dear: ["Đắt hơn lịch sử", "#b91c1c"], usual: ["Quanh mức thường", "#64748b"],
};

export async function sectorValuationCard(root, onSector) {
  const h = await fetch("data/sector_history.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!h || !h.sectors) return;
  const rows = Object.entries(h.sectors).map(([sector, v]) => {
    const peMed = median(v.hist.map((q) => q.pe)), pbMed = median(v.hist.map((q) => q.pb));
    const dPe = dev(v.now.pe, peMed), dPb = dev(v.now.pb, pbMed);
    const ds = [dPe, dPb].filter((x) => x != null);
    const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
    const verdict = avg == null ? null : avg <= -BAND ? "cheap" : avg >= BAND ? "dear" : "usual";
    return { sector, v, peMed, pbMed, dPe, dPb, avg, verdict, n: v.now.n_pb };
  }).filter((r) => r.avg != null).sort((a, b) => a.avg - b.avg);
  if (!rows.length) return;
  const first = rows[0].v.hist[0]?.quarter, last = rows[0].v.hist.at(-1)?.quarter;

  const card = el(`<div class="card sv-card">
    <h2 class="sec-h">Định giá ngành so với lịch sử</h2>
    <div class="chart-sub"><span>P/E và P/B trung vị của ngành hôm nay so với trung vị các quý ${esc(first)}–${esc(last)}.</span>
      <span>Lệch quá 10% so với trung vị là rẻ hoặc đắt hơn mức thường của chính ngành đó. Bấm một ngành để xem lịch sử.</span></div>
    <div class="sv-tw"><table class="screen sv-table"><thead><tr>
      <th>Ngành</th><th>P/E hiện tại</th><th>P/E trung vị</th><th>Lệch</th>
      <th>P/B hiện tại</th><th>P/B trung vị</th><th>Lệch</th><th>Đánh giá</th></tr></thead><tbody></tbody></table></div>
    <div class="sv-chart hidden"><div class="qtitle sv-title"></div><div class="grid-2 sv-plots"><div class="sv-pe"></div><div class="sv-pb"></div></div></div>
  </div>`);
  const tb = card.querySelector("tbody");
  for (const r of rows) {
    const [label, colour] = VERDICT[r.verdict];
    const tr = el(`<tr data-s="${esc(r.sector)}">
      <td><b>${esc(r.sector)}</b> <span class="sv-n">${r.n} mã</span></td>
      <td>${F.isNum(r.v.now.pe) ? `${r.v.now.pe.toFixed(1)}x` : "—"}</td><td>${F.isNum(r.peMed) ? `${r.peMed.toFixed(1)}x` : "—"}</td><td>${devCell(r.dPe)}</td>
      <td>${F.isNum(r.v.now.pb) ? `${r.v.now.pb.toFixed(2)}x` : "—"}</td><td>${F.isNum(r.pbMed) ? `${r.pbMed.toFixed(2)}x` : "—"}</td><td>${devCell(r.dPb)}</td>
      <td><span class="ev-pill" style="--c:${colour}">${label}</span></td></tr>`);
    tr.onclick = () => show(r, tr);
    tb.appendChild(tr);
  }
  root.appendChild(card);

  const box = card.querySelector(".sv-chart");
  function show(r, tr) {
    tb.querySelectorAll("tr").forEach((x) => x.classList.toggle("sv-on", x === tr));
    box.classList.remove("hidden");
    box.querySelector(".sv-title").textContent = r.sector;
    const xs = [...r.v.hist.map((q) => q.quarter), "Hiện tại"];
    const draw = (node, key, med, digits, colour, label) => {
      const ys = [...r.v.hist.map((q) => q[key]), r.v.now[key]];
      window.Plotly.react(node, [
        { type: "scatter", mode: "lines+markers", name: label, x: xs, y: ys, line: { color: colour, width: 2 },
          marker: { size: xs.map((_, i) => (i === xs.length - 1 ? 10 : 4)), color: colour },
          hovertemplate: `%{y:.${digits}f}x<extra>${label}</extra>` },
      ], {
        height: 240, dragmode: false, margin: { l: 44, r: 12, t: 26, b: 40 },
        title: { text: label, font: { size: 12 }, x: 0.02 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "Fira Code, monospace", size: 10, color: "#0a121d" }, showlegend: false,
        xaxis: { type: "category", tickfont: { size: 8 }, nticks: 8 },
        yaxis: { gridcolor: "rgba(148,163,184,0.22)", tickfont: { size: 9 }, ticksuffix: "x" },
        hovermode: "x unified", hoverdistance: -1,
        shapes: F.isNum(med) ? [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: med, y1: med, line: { color: "#94a3b8", width: 1, dash: "dot" } }] : [],
        annotations: F.isNum(med) ? [{ xref: "paper", x: 0, y: med, xanchor: "left", yanchor: "bottom", showarrow: false,
          text: `trung vị ${med.toFixed(digits)}x`, font: { size: 10, color: "#64748b" } }] : [],
      }, { displayModeBar: false, responsive: true });
    };
    draw(box.querySelector(".sv-pe"), "pe", r.peMed, 1, "#5b9bd5", "P/E");
    draw(box.querySelector(".sv-pb"), "pb", r.pbMed, 2, "#70ad47", "P/B");
    if (onSector) onSector(r.sector);
  }
}

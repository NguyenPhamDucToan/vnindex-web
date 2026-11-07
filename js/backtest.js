// "Kiểm định chiến lược" -- the Phase 10 backtest (export_backtest.py ->
// data/backtest.json). Plan Day 87: equity curves and stats; Day 78 quintile
// test per factor; Day 85 robustness to the number of names; Day 86 in-sample
// vs out-of-sample. The page states its own limits up front: a backtest that
// hides them is the kind the old chart on the screener was.
import * as F from "./format.js";

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const P = { family: "Fira Code, monospace", size: 10, color: "#0a121d" };
const GRID = "rgba(148,163,184,0.22)";
const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#dc2626", "#65a30d", "#db2777", "#0f766e", "#7c3aed"];

const pc = (x, d = 1) => (F.isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const pcs = (x, d = 1) => (F.isNum(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%` : "—");
const tone = (x) => (!F.isNum(x) ? "" : x > 0 ? "bt-g" : x < 0 ? "bt-r" : "");

export async function renderBacktest(root, selectTicker) {
  root.innerHTML = `<div class="loading">Đang tải kết quả kiểm định…</div>`;
  let d;
  try {
    const r = await fetch("data/backtest.json");
    if (!r.ok) throw new Error(r.status);
    d = await r.json();
  } catch {
    root.innerHTML = `<div class="loading">Chưa có kết quả kiểm định.</div>`;
    return;
  }
  if (!d || !Array.isArray(d.strategies)) {
    root.innerHTML = `<div class="loading">Chưa có kết quả kiểm định.</div>`;
    return;
  }
  const S = d.strategies.slice().sort((a, b) => (b.full.cagr ?? -9) - (a.full.cagr ?? -9));
  const vni = d.benchmarks.vnindex, ew = d.benchmarks.ew;
  const prm = d.params || {};
  const colorOf = Object.fromEntries(d.strategies.map((s, i) => [s.key, PALETTE[i % PALETTE.length]]));
  root.innerHTML = "";

  // ── header + verdict ──
  const best = S[0];
  const beatVni = S.filter((s) => F.isNum(s.full.excess_cagr) && s.full.excess_cagr > 0);
  const beatBoth = S.filter((s) => F.isNum(s.full.excess_cagr) && s.full.excess_cagr > 0
    && F.isNum(s.oos.excess_cagr) && s.oos.excess_cagr > 0);
  root.appendChild(el(`<div class="bt-head">
    <h2 class="view-title bt-title">Kiểm định chiến lược</h2>
    <div class="bt-sub">Nếu từ ${F.dateVN(d.start)} mỗi quý mua ${d.top} mã đứng đầu theo một tiêu chí, chia đều vốn, tới ${F.dateVN(d.end)} thì được bao nhiêu — sau phí, thuế và làm tròn lô.</div>
  </div>`));

  const verdict = el(`<div class="bt-verdict">
    <div class="bt-kpi"><div class="bt-kk">VNINDEX</div><div class="bt-kv">${pc(vni?.full.cagr)}<span>/năm</span></div>
      <div class="bt-ks">Sụt tối đa ${pc(vni?.full.max_dd, 0)}</div></div>
    <div class="bt-kpi"><div class="bt-kk">Chia đều cả thị trường</div><div class="bt-kv">${pc(ew.full.cagr)}<span>/năm</span></div>
      <div class="bt-ks">Mọi mã đủ thanh khoản, cùng phí</div></div>
    <div class="bt-kpi bt-kpi-best" style="--c:${colorOf[best.key]}"><div class="bt-kk">Tốt nhất: ${F.escapeHtml(best.name)}</div>
      <div class="bt-kv">${pc(best.full.cagr)}<span>/năm</span></div>
      <div class="bt-ks">${pcs(best.full.excess_cagr)} so với VNINDEX · sụt tối đa ${pc(best.full.max_dd, 0)}</div></div>
    <div class="bt-read">
      <b>${beatVni.length}/${S.length}</b> chiến lược thắng VNINDEX trên cả giai đoạn; <b>${beatBoth.length}</b> thắng cả trong giai đoạn kiểm tra ngoài mẫu (sau ${F.dateVN(d.is_end)}).
      ${F.isNum(ew.full.cagr) && F.isNum(vni?.full.cagr) && ew.full.cagr < vni.full.cagr - 0.03
        ? ` Một cổ phiếu "trung bình" thua chỉ số ${pc(vni.full.cagr - ew.full.cagr)}/năm: VNINDEX tính theo vốn hoá, nên vài mã rất lớn kéo cả chỉ số.` : ""}
    </div></div>`);
  root.appendChild(verdict);

  root.appendChild(el(`<details class="bt-caveat" open><summary>Giả định và giới hạn — đọc trước khi tin con số</summary>
    <ul>
      <li><b>Không dùng thông tin tương lai:</b> BCTC quý chỉ được dùng từ ${prm.publish_lag_days} ngày sau cuối quý, báo cáo năm từ ${prm.annual_lag_days} ngày; đặt lệnh ở giá đóng cửa phiên <i>sau</i> ngày ra tín hiệu.</li>
      <li><b>Chi phí:</b> phí ${pc(prm.commission, 2)} + trượt giá ${pc(prm.slippage, 2)} mỗi chiều, thuế bán ${pc(prm.sell_tax, 2)}; vốn ${F.moneyVND(prm.capital_vnd)}, lô ${prm.lot} cổ phiếu.</li>
      <li><b>Thanh khoản:</b> chỉ mua mã có giá trị khớp bình quân 20 phiên ≥ ${prm.min_adv_bn} tỷ đồng (${prm.universe_min}–${prm.universe_max} mã mỗi kỳ).</li>
      <li><b>Lợi nhuận theo giá, chưa tính cổ tức tiền mặt</b> — cả chiến lược lẫn VNINDEX. Thưởng cổ phiếu, chia tách đã được điều chỉnh.</li>
      <li><b>Thiên lệch sống sót:</b> dữ liệu chỉ có các mã đang niêm yết; mã đã huỷ niêm yết trước đây không có, nên kết quả có thể đẹp hơn thực tế.</li>
      <li><b>Giai đoạn ngắn:</b> ${d.rebalances} lần tái cơ cấu trong ${vni?.full.years ?? ""} năm, trọn một chu kỳ giảm 2022 và hồi 2023–2026. Trong mẫu đến ${F.dateVN(d.is_end)}, ngoài mẫu sau đó. Kết quả quá khứ không bảo đảm tương lai.</li>
      <li>Giá mô hình và tín hiệu Mua/Bán của app <b>chưa</b> được kiểm định ở đây: chúng dùng bội số lịch sử của cả thị trường, chưa tái lập được tại từng thời điểm.</li>
    </ul></details>`));

  // ── stats table ──
  const row = (name, color, x, key, isBench) => `<tr class="${isBench ? "bt-bench" : ""}" ${key ? `data-k="${key}"` : ""}>
    <td class="bt-name"><i style="background:${color}"></i>${F.escapeHtml(name)}</td>
    <td class="${tone(x.full.cagr)}"><b>${pc(x.full.cagr)}</b></td>
    <td class="${tone(x.full.excess_cagr)}">${isBench ? "" : pcs(x.full.excess_cagr)}</td>
    <td class="${tone(x.is?.cagr)}">${pc(x.is?.cagr)}</td>
    <td class="${tone(x.oos?.cagr)}">${pc(x.oos?.cagr)}</td>
    <td>${F.isNum(x.full.sharpe) ? x.full.sharpe.toFixed(2) : "—"}</td>
    <td class="bt-r">${pc(x.full.max_dd, 0)}</td>
    <td>${pc(x.full.vol, 0)}</td>
    <td>${isBench ? "" : pc(x.full.beat_share, 0)}</td>
    <td>${F.isNum(x.turnover) ? pc(x.turnover, 0) : ""}</td></tr>`;
  const tcard = el(`<div class="card"><h2 class="sec-h">Kết quả từng chiến lược</h2>
    <div class="vb-note">Mỗi dòng: mua ${d.top} mã điểm cao nhất theo tiêu chí, tái cơ cấu mỗi quý. Bấm một dòng để vẽ đường vốn của nó.</div>
    <div class="ta-scroll"><table class="screen bt-table"><thead><tr>
      <th>Chiến lược</th><th title="Lợi nhuận kép mỗi năm">CAGR</th><th title="CAGR trừ CAGR của VNINDEX">So với VNINDEX</th>
      <th title="Đến ${d.is_end}">Trong mẫu</th><th title="Sau ${d.is_end}">Ngoài mẫu</th>
      <th title="(CAGR − ${pc(prm.rf)}) / biến động">Sharpe</th><th title="Mức sụt lớn nhất từ đỉnh">Sụt tối đa</th>
      <th title="Độ lệch chuẩn năm hoá">Biến động</th><th title="Tỷ lệ các quãng 3 tháng thắng VNINDEX">Thắng 3T</th><th title="Phần danh mục thay mỗi quý">Vòng quay</th>
    </tr></thead><tbody>
      ${vni ? row("VNINDEX", "#0a121d", vni, null, true) : ""}
      ${row(ew.name, "#94a3b8", ew, null, true)}
      ${S.map((s) => row(s.name, colorOf[s.key], s, s.key, false)).join("")}
    </tbody></table></div></div>`);
  root.appendChild(tcard);

  // ── equity curves ──
  const chosen = new Set([best.key, ...(S.find((s) => s.key === "vqm") ? ["vqm"] : [])]);
  const ccard = el(`<div class="card"><h2 class="sec-h">Đường vốn</h2>
    <div class="bt-chips"></div><div class="bt-opts"><label><input type="checkbox" id="bt-log" checked /> Thang log</label></div>
    <div id="bt-curve"></div></div>`);
  root.appendChild(ccard);
  const chips = ccard.querySelector(".bt-chips");
  for (const s of S) {
    const b = el(`<button class="bt-chip" data-k="${s.key}" style="--c:${colorOf[s.key]}">${F.escapeHtml(s.name)}</button>`);
    b.onclick = () => { if (chosen.has(s.key)) chosen.delete(s.key); else chosen.add(s.key); drawCurve(); };
    chips.appendChild(b);
  }
  const series = (nav) => ({ x: nav.map((p) => p[0]), y: nav.map((p) => p[1]) });
  const drawCurve = () => {
    for (const b of chips.querySelectorAll(".bt-chip")) b.classList.toggle("on", chosen.has(b.dataset.k));
    for (const tr of tcard.querySelectorAll("tr[data-k]")) tr.classList.toggle("on", chosen.has(tr.dataset.k));
    const tr = [];
    if (vni) tr.push({ ...series(vni.nav), type: "scatter", mode: "lines", name: "VNINDEX", line: { color: "#0a121d", width: 2, dash: "dot" } });
    tr.push({ ...series(ew.nav), type: "scatter", mode: "lines", name: ew.name, line: { color: "#94a3b8", width: 1.5 } });
    for (const s of S) if (chosen.has(s.key)) {
      tr.push({ ...series(s.nav), type: "scatter", mode: "lines", name: s.name, line: { color: colorOf[s.key], width: 2.2 } });
    }
    window.Plotly.react(ccard.querySelector("#bt-curve"), tr, {
      height: 440, margin: { l: 50, r: 16, t: 10, b: 40 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
      hovermode: "x unified", legend: { orientation: "h", y: -0.14, font: { size: 10 } },
      xaxis: { gridcolor: GRID },
      yaxis: { gridcolor: GRID, type: ccard.querySelector("#bt-log").checked ? "log" : "linear", title: { text: "Giá trị (bắt đầu = 100)", font: { size: 10 } } },
      shapes: [{ type: "line", x0: d.is_end, x1: d.is_end, yref: "paper", y0: 0, y1: 1, line: { color: "#94a3b8", width: 1, dash: "dash" } }],
      annotations: [{ x: d.is_end, yref: "paper", y: 1, text: "ngoài mẫu →", showarrow: false, xanchor: "left", font: { size: 10, color: "#64748b" } }],
    }, { displayModeBar: false, responsive: true });
  };
  ccard.querySelector("#bt-log").onchange = drawCurve;
  tcard.querySelector("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-k]");
    if (!tr) return;
    const k = tr.dataset.k;
    if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
    drawCurve();
  });
  drawCurve();

  // ── quintiles ──
  const qcard = el(`<div class="card"><h2 class="sec-h">Tiêu chí có phân loại được thị trường không?</h2>
    <div class="vb-note">Chia mọi mã đủ thanh khoản thành 5 nhóm theo từng tiêu chí, nhóm 5 là điểm cao nhất, mỗi nhóm giữ cả quý. Một tiêu chí có tác dụng thì cột tăng dần từ nhóm 1 đến nhóm 5; cột lộn xộn nghĩa là kết quả chiến lược ở trên có thể chỉ là may.</div>
    <div id="bt-quint"></div></div>`);
  root.appendChild(qcard);
  const qs = S.slice().sort((a, b) => ((b.quintiles[4] ?? 0) - (b.quintiles[0] ?? 0)) - ((a.quintiles[4] ?? 0) - (a.quintiles[0] ?? 0)));
  const qColors = ["#fca5a5", "#fdba74", "#e5e7eb", "#86efac", "#16a34a"];
  window.Plotly.react(qcard.querySelector("#bt-quint"), [0, 1, 2, 3, 4].map((k) => ({
    type: "bar", name: k === 0 ? "Nhóm 1 (thấp nhất)" : k === 4 ? "Nhóm 5 (cao nhất)" : `Nhóm ${k + 1}`,
    x: qs.map((s) => s.name), y: qs.map((s) => (F.isNum(s.quintiles[k]) ? s.quintiles[k] * 100 : null)),
    marker: { color: qColors[k] }, hovertemplate: "%{x}<br>" + `Nhóm ${k + 1}` + ": %{y:.1f}%/năm<extra></extra>",
  })), {
    height: 420, barmode: "group", bargap: 0.25, margin: { l: 50, r: 10, t: 10, b: 110 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: P,
    legend: { orientation: "h", y: 1.12, font: { size: 10 } },
    xaxis: { tickangle: -25, automargin: true, tickfont: { size: 10 } },
    yaxis: { gridcolor: GRID, ticksuffix: "%", title: { text: "CAGR mỗi nhóm", font: { size: 10 } }, zeroline: true, zerolinecolor: "#94a3b8" },
  }, { displayModeBar: false, responsive: true });

  // ── robustness + calendar years ──
  const grid = Object.keys(S[0].top_grid || {});
  const years = Object.keys(vni ? vni.years : ew.years);
  const rcard = el(`<div class="card bt-two">
    <div><h2 class="sec-h">Đổi số mã trong danh mục</h2>
      <div class="vb-note">CAGR khi mua ${grid.join(" / ")} mã thay vì ${d.top}. Kết quả tốt chỉ ở một con số là dấu hiệu khớp quá khít với quá khứ.</div>
      <div class="ta-scroll"><table class="screen bt-table bt-small"><thead><tr><th>Chiến lược</th>${grid.map((n) => `<th>${n} mã</th>`).join("")}</tr></thead>
      <tbody>${S.map((s) => `<tr><td class="bt-name"><i style="background:${colorOf[s.key]}"></i>${F.escapeHtml(s.name)}</td>
        ${grid.map((n) => `<td class="${tone(s.top_grid[n])}">${pc(s.top_grid[n])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
    <div><h2 class="sec-h">Từng năm</h2>
      <div class="vb-note">Lợi nhuận mỗi năm dương lịch (năm đầu và năm cuối không trọn).</div>
      <div class="ta-scroll"><table class="screen bt-table bt-small bt-years"><thead><tr><th>Chiến lược</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
      <tbody>${[...(vni ? [["VNINDEX", "#0a121d", vni]] : []), [ew.name, "#94a3b8", ew], ...S.map((s) => [s.name, colorOf[s.key], s])]
        .map(([n, c, x]) => `<tr><td class="bt-name"><i style="background:${c}"></i>${F.escapeHtml(n)}</td>
          ${years.map((y) => { const v = x.years[y]; return `<td style="${heat(v)}">${pc(v, 0)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div>
  </div>`);
  root.appendChild(rcard);

  // ── latest holdings ──
  const hcard = el(`<div class="card"><h2 class="sec-h">Danh mục hiện tại của từng chiến lược</h2>
    <div class="vb-note">Các mã mỗi chiến lược đang nắm sau lần tái cơ cấu gần nhất. Đây là kết quả máy móc của quy tắc, không phải khuyến nghị.</div>
    <div class="bt-hold"></div></div>`);
  root.appendChild(hcard);
  const hold = hcard.querySelector(".bt-hold");
  for (const s of S) {
    const r = el(`<div class="bt-hrow"><div class="bt-hname"><i style="background:${colorOf[s.key]}"></i>${F.escapeHtml(s.name)}
      <span>${F.dateVN(s.latest.date)}</span></div><div class="bt-htk"></div></div>`);
    const box = r.querySelector(".bt-htk");
    for (const t of s.latest.tickers || []) {
      const b = el(`<button class="bt-tk">${t}</button>`);
      b.onclick = () => selectTicker(t);
      box.appendChild(b);
    }
    hold.appendChild(r);
  }
  root.appendChild(el(`<div class="vb-note bt-gen">Tính lại hằng tuần · lần gần nhất ${F.dateVN(String(d.generated_at).slice(0, 10))}</div>`));
}

function heat(v) {
  if (!F.isNum(v)) return "";
  const a = Math.min(1, Math.abs(v) / 0.5);
  const c = v >= 0 ? `rgba(22,163,74,${0.08 + 0.42 * a})` : `rgba(220,38,38,${0.08 + 0.42 * a})`;
  return `background:${c}`;
}

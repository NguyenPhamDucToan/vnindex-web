// Plotly.js chart builders. Plotly is loaded globally from a CDN in index.html
// (window.Plotly). Mirrors the Streamlit app's HOSE-style candlestick + volume
// pane, with categorical dates so weekends/holidays don't leave gaps.

const INK = "#0a121d", MUTED = "#5b6675", RULE = "rgba(148,163,184,0.25)";
// Two-tier convention copied from the original: chart MARKS use the bright
// pair, gain/loss TEXT uses the darker WCAG-safe pair. Mixing them up is what
// made the candles read dull next to the original.
const UP = "#22c55e", DOWN = "#ef4444";
const MA10 = "#60a5fa", MA50 = "#fb923c";
const FONT = { family: "'Fira Code', ui-monospace, monospace", size: 11, color: INK };

function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// prices: [{date, open, high, low, close, volume}], already ascending.
export function priceChart(el, prices, rangeDays = 365) {
  // Moving averages need a run-up: computing them on the visible window alone
  // leaves MA10 blank for 9 bars and MA50 for 49, so both lines visibly start
  // mid-chart. Compute over a 60-bar lookback buffer, then trim to the window
  // (the original does the same).
  const LOOKBACK = 60;
  const withBuf = prices.slice(-(rangeDays + LOOKBACK));
  const closeBuf = withBuf.map((r) => r.close);
  const ma10Buf = sma(closeBuf, 10), ma50Buf = sma(closeBuf, 50);

  const p = prices.slice(-rangeDays);
  const cut = withBuf.length - p.length;
  const x = p.map((r) => r.date);
  const ma10 = ma10Buf.slice(cut), ma50 = ma50Buf.slice(cut);
  const volColors = p.map((r) => (r.close >= r.open ? UP : DOWN));
  // Stored in thousands VND; the axis and the hover both read in raw VND.
  const k = (v) => (typeof v === "number" ? v * 1000 : null);
  const topY = Math.max(...p.map((r) => r.high)) * 1000;
  const prevClose = p.length > 1 ? p[p.length - 2].close * 1000 : null;

  const traces = [
    {
      type: "candlestick", x,
      open: p.map((r) => k(r.open)), high: p.map((r) => k(r.high)),
      low: p.map((r) => k(r.low)), close: p.map((r) => k(r.close)),
      // Filled vs hollow body, not colour alone, so the direction still reads
      // for colourblind users -- the original's choice, kept.
      increasing: { line: { color: UP }, fillcolor: UP },
      decreasing: { line: { color: DOWN }, fillcolor: "rgba(0,0,0,0)" },
      name: "Giá", yaxis: "y", showlegend: false, hoverinfo: "none",
    },
    { type: "scatter", mode: "lines", x, y: ma10.map(k), yaxis: "y",
      line: { color: MA10, width: 1.5 }, name: "MA10", hoverinfo: "none" },
    { type: "scatter", mode: "lines", x, y: ma50.map(k), yaxis: "y",
      line: { color: MA50, width: 1.5 }, name: "MA50", hoverinfo: "none" },
    // One invisible point per day carrying the whole row. Without it, four
    // traces under hovermode "x unified" stack four separate tooltip lines.
    {
      type: "scatter", mode: "markers", x, y: x.map(() => topY), yaxis: "y",
      marker: { color: "rgba(0,0,0,0)", size: 1, opacity: 0 },
      showlegend: false,
      customdata: p.map((r, i) => [k(r.open), k(r.high), k(r.low), k(r.close),
                                   (r.volume || 0) / 1e6, k(ma10[i]), k(ma50[i])]),
      hovertemplate: "O %{customdata[0]:,.0f}  H %{customdata[1]:,.0f}  "
                   + "L %{customdata[2]:,.0f}  C %{customdata[3]:,.0f}  "
                   + "Vol %{customdata[4]:.2f}M<br>"
                   + "MA10 %{customdata[5]:,.0f}  MA50 %{customdata[6]:,.0f}<extra></extra>",
      hoverlabel: { bgcolor: "#ffffff", bordercolor: "#e2e8f0", align: "left",
                    font: { ...FONT, size: 12, color: "#0f172a" } },
    },
    { type: "bar", x, y: p.map((r) => r.volume), yaxis: "y2",
      marker: { color: volColors }, name: "Khối lượng",
      showlegend: false, hoverinfo: "none" },
  ];

  const SPIKE = { showspikes: true, spikemode: "across", spikesnap: "cursor",
                  spikecolor: "#64748b", spikethickness: 1, spikedash: "dot" };

  const layout = {
    dragmode: false, showlegend: true,
    // Under the plot, as upstream -- above it the legend sat on the top candles.
    legend: { orientation: "h", yanchor: "top", y: -0.06, xanchor: "left", x: 0,
              font: { ...FONT, size: 11 } },
    margin: { l: 58, r: 10, t: 6, b: 20 },
    height: 480, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: FONT,
    xaxis: {
      type: "category", rangeslider: { visible: false }, showgrid: false,
      tickfont: { ...FONT, size: 9 }, nticks: 8, domain: [0, 1],
      // Trim the blank half-slot Plotly leaves at each end of a category axis.
      range: [-0.5, x.length - 0.5], ...SPIKE,
    },
    yaxis: {
      domain: [0.25, 1], title: { text: "VND", font: { ...FONT, size: 10 } },
      gridcolor: "#e2e8f0", tickfont: FONT, fixedrange: true,
      ...SPIKE, spikemode: "across+toaxis",
    },
    yaxis2: {
      domain: [0, 0.22], title: { text: "KL", font: { ...FONT, size: 10 } },
      showgrid: false, tickfont: { ...FONT, size: 9 }, fixedrange: true, anchor: "x",
    },
    // Previous close, as a shape so it doesn't stretch the autorange.
    shapes: prevClose ? [{
      type: "line", xref: "paper", x0: 0, x1: 1, yref: "y",
      y0: prevClose, y1: prevClose,
      line: { color: DOWN, width: 1, dash: "dash" }, opacity: 0.6,
    }] : [],
    hovermode: "x unified",
  };
  window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
}

// Price vs intrinsic value over time. history: [{calc_date, dcf_estimate, avg_intrinsic_value}]
// dcf/avg are raw VND; price series is close*1000 to match.
export function priceVsValueChart(el, prices, history) {
  const px = prices.slice(-500);
  const traces = [
    {
      type: "scatter", mode: "lines", name: "Giá thị trường",
      x: px.map((r) => r.date), y: px.map((r) => r.close * 1000),
      line: { color: "#2563eb", width: 1.5 }, fill: "tozeroy",
      fillcolor: "rgba(37,99,235,0.06)",
    },
    {
      type: "scatter", mode: "lines", name: "DCF",
      x: history.map((r) => r.calc_date), y: history.map((r) => r.dcf_estimate),
      line: { color: "#b91c1c", width: 1.5, dash: "dash" }, connectgaps: true,
    },
  ];
  const layout = {
    dragmode: false, margin: { l: 52, r: 12, t: 18, b: 28 }, height: 300,
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: FONT,
    legend: { orientation: "h", y: 1.12, x: 0, font: { ...FONT, size: 10 } },
    xaxis: { gridcolor: RULE, tickfont: { ...FONT, size: 9 } },
    yaxis: { gridcolor: RULE, tickfont: FONT, side: "right" },
    hovermode: "x unified",
  };
  window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
}

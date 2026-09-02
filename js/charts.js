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
  const close = p.map((r) => r.close);
  const ma10 = ma10Buf.slice(cut), ma50 = ma50Buf.slice(cut);
  const volColors = p.map((r) => (r.close >= r.open ? UP : DOWN));

  const traces = [
    {
      type: "candlestick", x,
      open: p.map((r) => r.open), high: p.map((r) => r.high),
      low: p.map((r) => r.low), close,
      // Rising candles are filled; falling candles are hollow, as in the original.
      increasing: { line: { color: UP }, fillcolor: UP },
      decreasing: { line: { color: DOWN }, fillcolor: "rgba(0,0,0,0)" },
      name: "Giá", yaxis: "y", xaxis: "x",
      hoverlabel: { font: FONT },
    },
    { type: "scatter", mode: "lines", x, y: ma10, line: { color: MA10, width: 1.5 }, name: "MA10", yaxis: "y" },
    { type: "scatter", mode: "lines", x, y: ma50, line: { color: MA50, width: 1.5 }, name: "MA50", yaxis: "y" },
    { type: "bar", x, y: p.map((r) => r.volume), marker: { color: volColors }, name: "KL", yaxis: "y2", hoverinfo: "skip" },
  ];

  const layout = {
    dragmode: false, showlegend: true,
    legend: { orientation: "h", y: 1.06, x: 0, font: { ...FONT, size: 10 } },
    margin: { l: 48, r: 12, t: 18, b: 24 },
    height: 430, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: FONT,
    xaxis: {
      type: "category", rangeslider: { visible: false },
      showgrid: false, tickfont: { ...FONT, size: 9 },
      nticks: 8, domain: [0, 1],
    },
    yaxis: { domain: [0.26, 1], gridcolor: RULE, tickfont: FONT, side: "right", fixedrange: true },
    yaxis2: { domain: [0, 0.2], gridcolor: RULE, tickfont: { ...FONT, size: 9 }, side: "right", fixedrange: true },
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

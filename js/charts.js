// Plotly.js chart builders. Plotly is loaded globally from a CDN in index.html
// (window.Plotly). Mirrors the Streamlit app's HOSE-style candlestick + volume
// pane, with categorical dates so weekends/holidays don't leave gaps.

const INK = "#0a121d", MUTED = "#5b6675", RULE = "rgba(148,163,184,0.25)";
const UP = "#15803d", DOWN = "#b91c1c";
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
  const p = prices.slice(-rangeDays);
  const x = p.map((r) => r.date);
  const close = p.map((r) => r.close);
  const ma10 = sma(close, 10), ma50 = sma(close, 50);
  const volColors = p.map((r) => (r.close >= r.open ? "rgba(21,128,61,0.45)" : "rgba(185,28,28,0.45)"));

  const traces = [
    {
      type: "candlestick", x,
      open: p.map((r) => r.open), high: p.map((r) => r.high),
      low: p.map((r) => r.low), close,
      increasing: { line: { color: UP } }, decreasing: { line: { color: DOWN } },
      name: "Giá", yaxis: "y", xaxis: "x",
      hoverlabel: { font: FONT },
    },
    { type: "scatter", mode: "lines", x, y: ma10, line: { color: "#2563eb", width: 1 }, name: "MA10", yaxis: "y" },
    { type: "scatter", mode: "lines", x, y: ma50, line: { color: "#ea580c", width: 1 }, name: "MA50", yaxis: "y" },
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

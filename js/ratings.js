// Port of rating_color() from valuation/ratios.py: maps a metric to a
// traffic-light colour given "good" and "ok" thresholds. higherBetter flips
// the comparison direction (e.g. debt ratios, where lower is safer).
const GREEN = "#16a34a", AMBER = "#d97706", RED = "#dc2626", GREY = "#666f7c";

export function ratingColor(value, good, ok, higherBetter = true) {
  if (typeof value !== "number" || !isFinite(value)) return GREY;
  if (higherBetter) {
    if (value >= good) return GREEN;
    if (value >= ok) return AMBER;
    return RED;
  } else {
    if (value <= good) return GREEN;
    if (value <= ok) return AMBER;
    return RED;
  }
}

export { GREEN, AMBER, RED, GREY };

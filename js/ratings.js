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

// Sector bands for the metrics whose generic thresholds are calibrated on a
// manufacturer and score a whole financial sector into one colour. Measured
// across the market on 2026-09-14: 21 of 21 banks were green on gross margin,
// operating margin AND net margin; 18 of 20 brokers green on gross margin; all
// five insurers amber on operating margin; and in DuPont all 21 banks read
// "asset efficiency low" and "leverage high -- risky", which made the verdict
// tell every bank its ROE was debt-driven and unsustainable.
//
// Each pair is the sector's own [p75, p25] (reversed for lower-is-better), so
// the colour says where a company stands among its peers instead of against an
// industrial benchmark it cannot meet. `null` means the metric is not rated for
// that sector at all.
//
// Shared from here because the scorecard and DuPont both colour net margin: when
// they each kept their own thresholds, SSI showed the same 32.5% as amber in one
// and green in the other on the same page.
export const SECTOR_BANDS = {
  "Ngân hàng": {
    // NII/TOI: a lower share means more fee income, which is usually read as
    // the healthier position, so rewarding a high value would contradict the
    // tooltip beside it. Left unrated, as Beta is in the risk table.
    gross: null,
    op: [0.70, 0.65], net: [0.40, 0.35], roa: [0.018, 0.011],
    turnover: [0.038, 0.028], leverage: [12, 15],
  },
  "Chứng khoán": {
    gross: [0.70, 0.47], op: [0.46, 0.26], net: [0.37, 0.20], roa: [0.047, 0.028],
    turnover: [0.150, 0.101], leverage: [2.0, 2.8],
    // Not one of the 20 brokers clears the 15% ROE bar -- the sector's median is
    // 9.1% -- so the tile could only ever say "you are a broker". The bar stays
    // informative for industrials, where 119 of 357 clear it.
    roe: [0.125, 0.054],
    // A broker funds margin loans (a current asset) with short-term borrowing (a
    // current liability), so its current ratio sits near 1.6 by construction:
    // 15 of 20 read "cảnh báo" on the 2x/1x band and none read red.
    current: [2.083, 1.558],
  },
  "Bảo hiểm": {
    gross: [0.10, 0.05], op: [0.084, 0.066], net: [0.069, 0.053], roa: [0.030, 0.026],
    turnover: [0.574, 0.479], leverage: [2.9, 4.8],
    // Same story, 0 of 5 above 15%: an insurer earns on a float it must hold
    // against future claims, so it cannot run an industrial's ROE.
    roe: [0.131, 0.108],
  },
};

export function sectorBand(sector, key) {
  const s = SECTOR_BANDS[sector];
  if (!s) return undefined;              // no sector table: use the generic band
  return s[key] === undefined ? undefined : s[key];   // null = not rated
}

export { GREEN, AMBER, RED, GREY };

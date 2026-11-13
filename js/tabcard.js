// One card with a tab strip, built from the collapsible <details> sections
// (holders, corporate actions, insiders, earnings reaction). Stacked as four
// closed cards they sat above the price chart and pushed it down the page.
//
// Each section keeps its own markup and its draw-on-"toggle" logic: the tab
// button shows the section's summary, and selecting a tab opens that section's
// <details>, which fires its toggle handler, so a chart is drawn only once its
// pane is visible (Plotly sizes against a hidden pane at width 0).
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// `sections`: [[<details> or null, short tab label], ...]. The section's own
// summary is long ("Giao dịch nội bộ & cổ đông lớn"); the tab gets the short
// label plus any badge the summary carries (the insiders' buy/sell mood).
export function tabbedCard(title, sections) {
  const live = sections.filter(([d]) => d);
  const panes = live.map(([d]) => d);
  if (!panes.length) return null;
  const card = el(`<div class="card tabcard">
    <h3 class="sec-h">${title}</h3>
    <div class="tc-tabs" role="tablist"></div>
    <div class="tc-body"></div></div>`);
  const tabs = card.querySelector(".tc-tabs"), body = card.querySelector(".tc-body");
  const buttons = live.map(([d, label]) => {
    const badge = d.querySelector(":scope > summary .ins-mood");
    const b = el(`<button type="button" class="tc-tab" role="tab"></button>`);
    b.textContent = label;
    if (badge) b.appendChild(badge.cloneNode(true));
    d.classList.add("tc-pane");
    tabs.appendChild(b);
    body.appendChild(d);
    return b;
  });
  const show = (i) => {
    panes.forEach((d, k) => {
      d.classList.toggle("hidden", k !== i);
      buttons[k].classList.toggle("on", k === i);
      buttons[k].setAttribute("aria-selected", k === i ? "true" : "false");
    });
    if (!panes[i].open) panes[i].open = true;     // fires the section's own "toggle" -> draws its chart
  };
  buttons.forEach((b, i) => { b.onclick = () => show(i); });
  // A section that opened itself (an upcoming ex-date, an open insider
  // registration) asks for attention: start on it. Otherwise the first tab.
  const first = Math.max(0, panes.findIndex((d) => d.open));
  panes.forEach((d) => { d.open = false; });
  requestAnimationFrame(() => show(first));
  return card;
}

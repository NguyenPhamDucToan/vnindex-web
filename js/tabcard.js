// One collapsible card with a tab strip, built from the <details> sections
// (holders, corporate actions, insiders, earnings reaction). Stacked as four
// closed cards they sat above the price chart and pushed it down the page.
//
// The card starts closed (it is long, and most visits want price and value),
// unless a section asks for attention -- an upcoming ex-date, an open insider
// registration -- in which case it opens on that tab.
//
// Each section keeps its own markup and its draw-on-"toggle" logic: selecting
// a tab opens that section's <details>, which fires its toggle handler, so a
// chart is drawn only once its pane is visible (Plotly sizes a hidden pane at
// width 0). For the same reason nothing is selected until the card is open.
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// `sections`: [[<details> or null, short tab label], ...]. The section's own
// summary is long ("Giao dịch nội bộ & cổ đông lớn"); the tab gets the short
// label plus any badge the summary carries (the insiders' buy/sell mood).
export function tabbedCard(title, sections) {
  const live = sections.filter(([d]) => d);
  const panes = live.map(([d]) => d);
  if (!panes.length) return null;
  const card = el(`<details class="card tabcard">
    <summary class="sec-h tc-sum">${title}<span class="tc-hint"></span></summary>
    <div class="tc-tabs" role="tablist"></div>
    <div class="tc-body"></div></details>`);
  card.querySelector(".tc-hint").textContent = live.map(([, label]) => label).join(" · ");
  const tabs = card.querySelector(".tc-tabs"), body = card.querySelector(".tc-body");
  const buttons = live.map(([d, label]) => {
    const badge = d.querySelector(":scope > summary .ins-mood");
    const b = el(`<button type="button" class="tc-tab" role="tab"></button>`);
    b.textContent = label;
    if (badge) b.appendChild(badge.cloneNode(true));
    d.classList.add("tc-pane", "hidden");
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

  const urgent = panes.findIndex((d) => d.open);
  // Every section that asked for attention gets a dot on its tab; the card
  // gets an orange frame and the reasons (the sections' data-alert) in its header.
  const alerts = panes.map((d, k) => (d.open ? d.dataset.alert || live[k][1] : null));
  if (urgent >= 0) {
    card.classList.add("tc-urgent");
    alerts.forEach((a, k) => { if (a) buttons[k].classList.add("tc-alert"); });
    const sum = card.querySelector(".tc-sum");
    sum.insertBefore(el(`<span class="tc-flag"></span>`), sum.querySelector(".tc-hint"))
      .textContent = "⚠ " + alerts.filter(Boolean).join(" · ");
  }
  panes.forEach((d) => { d.open = false; });
  let started = false;
  const start = () => { if (!started && card.open) { started = true; show(Math.max(0, urgent)); } };
  card.addEventListener("toggle", start);
  if (urgent >= 0) card.open = true;              // its toggle event runs start() once attached
  return card;
}

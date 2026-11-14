// Vietnamese / English. The pages are written in Vietnamese and stay that way;
// with English selected, this layer rewrites what is on screen: whole strings
// through the dictionary (js/i18n-en.js: EXACT), then known phrases inside
// templated text ("+39.3% so với cùng kỳ năm trước", PHRASES), longest first.
// A MutationObserver applies it to everything rendered later, and app.js runs
// every Plotly chart's data/layout through trPlot() before drawing.
//
// Not translated: anything inside [data-notr] (company and holder names, news
// headlines, VCI event descriptions -- source data, half-translating it reads
// worse than leaving it), and inline <svg> (Plotly's, handled via trPlot).
// A string missing from the dictionary simply stays Vietnamese.
import { EXACT, PHRASES, RX } from "./i18n-en.js";

const KEY = "lang";
export const lang = (() => { try { return localStorage.getItem(KEY) === "en" ? "en" : "vi"; } catch { return "vi"; } })();

const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const norm = (s) => s.replace(/\s+/g, " ").trim();

// Phrases as one regex per entry, longest first so "so với cùng kỳ năm trước"
// wins over "so với". Word-ish boundaries: not inside another Vietnamese word.
const L = "A-Za-zÀ-ỹ";
const PH = PHRASES.filter(Array.isArray).sort((a, b) => b[0].length - a[0].length)
  .map(([vi, en]) => [new RegExp(`(?<![${L}])${vi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![${L}])`, "g"), en]);

// Whole-string match, keeping the original's leading/trailing whitespace
// (inline text nodes rely on it for spacing).
function exact(s) {
  const k = norm(s);
  if (EXACT[k] === undefined) return null;
  return s.match(/^\s*/)[0] + EXACT[k] + s.match(/\s*$/)[0];
}

export function tr(s) {
  if (lang !== "en" || typeof s !== "string" || !VI.test(s)) return s;
  const e = exact(s);
  if (e !== null) return e;
  let out = s;
  for (const [re, en] of PH) {
    if (!VI.test(out)) break;
    out = out.replace(re, en);
  }
  for (const [re, en] of RX) out = out.replace(re, en);
  return out;
}

const skip = (node) => {
  const e = node.nodeType === 1 ? node : node.parentElement;
  // company / holder / insider names and news headlines are source data
  return !e || e.closest("[data-notr], .sh-name, .sx-nm, .ins-nm, .ne-list, svg, script, style, textarea, input[type=text]");
};

function trText(n) {
  if (skip(n)) return;
  const v = n.nodeValue;
  if (!v || !VI.test(v)) return;
  const t = tr(v);
  if (t !== v) n.nodeValue = t;
}

const ATTRS = ["title", "placeholder", "aria-label"];
function trAttrs(e) {
  if (skip(e)) return;
  for (const a of ATTRS) {
    const v = e.getAttribute(a);
    if (v && VI.test(v)) { const t = tr(v); if (t !== v) e.setAttribute(a, t); }
  }
}

function trTree(root) {
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1) return;
  trAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = w.nextNode())) { if (n.nodeType === 3) trText(n); else trAttrs(n); }
}

// Plotly: translate the strings a chart carries (trace names, hover templates,
// titles, annotations, category labels) before it is drawn.
const PLOT_KEYS = new Set(["name", "hovertemplate", "text", "title", "ticktext", "texttemplate", "legendgrouptitle", "ticksuffix", "tickprefix", "suffix", "prefix"]);
function deep(v, key) {
  if (typeof v === "string") return PLOT_KEYS.has(key) || key === "x" || key === "y" || key === "labels" ? tr(v) : v;
  if (Array.isArray(v)) {
    // category axes and pie/treemap labels are arrays of strings
    return (key === "x" || key === "y" || key === "labels" || key === "text" || key === "ticktext" || key === "parents" || key === "ids")
      ? v.map((x) => (typeof x === "string" ? tr(x) : x)) : v.map((x) => deep(x, key));
  }
  if (v && typeof v === "object" && !(v instanceof Date) && !ArrayBuffer.isView(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deep(x, k === "text" && key === "title" ? "title" : k);
    return o;
  }
  return v;
}
export function trPlot(data, layout) {
  if (lang !== "en") return [data, layout];
  return [Array.isArray(data) ? data.map((t) => deep(t, "")) : data, deep(layout || {}, "")];
}

export function initI18n() {
  document.documentElement.lang = lang;
  if (lang !== "en") return;
  trTree(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") trText(m.target);
      else if (m.type === "attributes") trAttrs(m.target);
      else m.addedNodes.forEach(trTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// "VI | EN" switch for the nav. Switching reloads: every view renders in
// Vietnamese and is translated on the way in, so a reload is the one path that
// can't leave a half-translated page behind.
export function langToggle() {
  const b = document.createElement("button");
  b.className = "lang-tog";
  b.type = "button";
  b.setAttribute("data-notr", "");
  b.innerHTML = `<span class="${lang === "vi" ? "on" : ""}">VI</span><span class="${lang === "en" ? "on" : ""}">EN</span>`;
  b.title = lang === "en" ? "Chuyển sang tiếng Việt" : "Switch to English";
  b.onclick = () => { try { localStorage.setItem(KEY, lang === "en" ? "vi" : "en"); } catch { /* ignore */ } location.reload(); };
  return b;
}

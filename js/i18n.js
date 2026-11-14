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
// Number locale: 1,234.5 in English, 1.234,5 in Vietnamese (dates keep dd/mm/yyyy either way).
export const NUM_LOCALE = lang === "en" ? "en-US" : "vi-VN";

const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const norm = (s) => s.replace(/\s+/g, " ").trim();

// Phrases as one regex per entry, longest first so "so với cùng kỳ năm trước"
// wins over "so với". Word-ish boundaries: not inside another Vietnamese word.
const L = "A-Za-zÀ-ỹ";
// The boundary checks apply only at a phrase's letter ends: "; chỉ có khi…"
// follows a letter ("growth; …") and must still match.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isL = (c) => new RegExp(`[${L}]`).test(c);
const PH = PHRASES.filter(Array.isArray).sort((a, b) => b[0].length - a[0].length)
  .map(([vi, en]) => [new RegExp(`${isL(vi[0]) ? `(?<![${L}])` : ""}${esc(vi)}${isL(vi.at(-1)) ? `(?![${L}])` : ""}`, "g"), en]);
// Most specific first: a whole-sentence template must run before the short
// number rules ("1 điểm %" -> "1 pts") rewrite the text it was written against.
// Specificity = how much literal text a pattern requires; boundary checks and
// character classes don't count ("(\d) phiên(?![…])" is less specific than
// "(\d+) phiên đầu" although its source is longer).
const literal = (src) => src.replace(/\(\?<?[!=](?:[^()]|\([^()]*\))*\)/g, "").replace(/\[[^\]]*\]/g, "")
  .replace(/\\./g, "x").replace(/[()?:+*|{}^$.\d]/g, "").length;
const RXS = [...RX].sort((a, b) => literal(b[0].source) - literal(a[0].source));

// Whole-string match, keeping the original's leading/trailing whitespace
// (inline text nodes rely on it for spacing).
function exact(s) {
  const k = norm(s);
  if (EXACT[k] === undefined) return null;
  return s.match(/^\s*/)[0] + EXACT[k] + s.match(/\s*$/)[0];
}

// Pieces between Plotly placeholders, HTML tags and separators: a hover
// template "Giao thông %{x}: %{y} %" or "LNST so cùng kỳ: 12%<br>5 phiên: …"
// is a few known labels glued together, so each piece gets an exact lookup.
const SEP = /(%\{[^}]*\}|<[^>]*>|\s·\s|:\s|\s—\s|\s→\s)/;
function bySegments(s) {
  const parts = s.split(SEP);
  if (parts.length < 2) return null;
  let hit = false;
  const out = parts.map((p, i) => {
    if (i % 2 || !VI.test(p)) return p;
    const e = exact(p);
    if (e !== null) { hit = true; return e; }
    return p;
  });
  return hit ? out.join("") : null;
}

// "Thành viên HĐQT/Tổng Giám đốc/Phụ trách CBTT": titles joined by "/" with
// no spaces (ratio labels like "Nợ / Tổng tài sản" have spaces and are left).
function bySlash(s) {
  const k = norm(s);
  if (!/\S\/\S/.test(k) || / \/ /.test(k)) return null;
  const parts = k.split("/").map((p) => EXACT[p]);
  return parts.every((p) => p !== undefined) ? parts.join(" / ") : null;
}

export function tr(s) {
  if (lang !== "en" || typeof s !== "string" || !VI.test(s)) return s;
  const e = exact(s) ?? bySlash(s);
  if (e !== null) return e;
  // number-carrying sentence templates first (they are written against the
  // Vietnamese text), then known labels piece by piece, then phrases, then
  // the number patterns once more for what the phrases left.
  // Whitespace collapsed (as the browser renders it anyway): source
  // templates wrap long sentences across lines, which no pattern would match.
  let out = s.replace(/\s+/g, " ");
  for (const [re, en] of RXS) out = out.replace(re, en);
  if (!VI.test(out)) return out;
  out = bySegments(out) ?? out;
  for (const [re, en] of PH) {
    if (!VI.test(out)) break;
    out = out.replace(re, en);
  }
  for (const [re, en] of RXS) out = out.replace(re, en);
  return out;
}

const skip = (node) => {
  const e = node.nodeType === 1 ? node : node.parentElement;
  // company / holder / insider names are source data (news headlines carry data-notr)
  return !e || e.closest("[data-notr], .sh-name, .sx-nm, .ins-nm, svg, script, style, textarea, input[type=text]");
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
  if (typeof v === "string") return PLOT_KEYS.has(key) || key === "x" || key === "y" || key === "labels" || key === "customdata" ? tr(v) : v;
  if (Array.isArray(v)) {
    // category axes and pie/treemap labels are arrays of strings
    return (key === "x" || key === "y" || key === "labels" || key === "text" || key === "ticktext" || key === "parents" || key === "ids" || key === "customdata")
      ? v.map((x) => (typeof x === "string" ? tr(x) : deep(x, key))) : v.map((x) => deep(x, key));
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

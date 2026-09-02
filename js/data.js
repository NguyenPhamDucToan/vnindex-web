// Static data-access layer. Every screen reads from these JSON snapshots that
// export_data.py produced from the DB -- no server, no live API. Isolated here
// so the source could later be swapped for a live Supabase/REST endpoint
// without touching any view code.

const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  return p;
}

export const loadMeta = () => getJSON("data/meta.json");
export const loadCompanies = () => getJSON("data/companies.json");
export const loadScreener = () => getJSON("data/screener.json");
export const loadTicker = (t) => getJSON(`data/ticker/${t}.json`);
export const loadMacro = () => getJSON("data/macro.json");
// Optional: absent until export_commodities.py has been run.
export const loadCommodities = () =>
  getJSON("data/commodities.json").catch(() => null);

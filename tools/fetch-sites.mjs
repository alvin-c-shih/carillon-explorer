// Downloads the buildings, roads, water and greenery around each carillon from OpenStreetMap (via the Overpass API)
// and saves a trimmed copy in sites/<slug>.js, so the app's tower close-up loads instantly and needs no map server.
// Run from the project folder:  node tools/fetch-sites.mjs          (skips towers already saved)
//                               node tools/fetch-sites.mjs --force  (downloads everything again)
//                               node tools/fetch-sites.mjs --force Daejeon Rees  (only the towers whose names contain these words)
// Map data © OpenStreetMap contributors, ODbL.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const HALF = 260;   // metres from the tower to each edge of the square that is saved
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'];
const KEEP = ['building', 'building:part', 'man_made', 'height', 'building:height', 'building:levels', 'roof:levels', 'min_height',
  'building:min_level', 'roof:shape', 'roof:height', 'name', 'highway', 'natural', 'waterway', 'leisure', 'landuse'];
const force = process.argv.includes('--force');
const only = process.argv.slice(2).filter((x) => !x.startsWith('--'));   // names (or parts of names) to limit the run to

globalThis.window = {};
new Function(readFileSync('carillons.js', 'utf8'))();
const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('sites', { recursive: true });

async function overpass(q) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const r = await fetch(ep, {
        method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(60000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'carillon-explorer-build/1.0' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (err) { last = err; await sleep(4000); }
  }
  throw last;
}

for (const c of window.CARILLONS) {
  const file = `sites/${slug(c.name)}.js`;
  if (only.length && !only.some((x) => c.name.toLowerCase().includes(x.toLowerCase()))) continue;
  if (existsSync(file) && !force) { console.log('have', c.name); continue; }
  const ky = 110540, kx = Math.cos(c.lat * Math.PI / 180) * 111320, dy = HALF / ky, dx = HALF / kx;
  const q = `[out:json][timeout:50][bbox:${c.lat - dy},${c.lon - dx},${c.lat + dy},${c.lon + dx}];(` + ['way["building"]', 'way["building:part"]',
    'relation["building"]', 'relation["building:part"]', 'way["man_made"="tower"]', 'way["highway"]', 'way["natural"="water"]',
    'relation["natural"="water"]', 'way["waterway"]', 'way["leisure"~"^(park|garden|pitch)$"]',
    'way["landuse"~"^(grass|forest|meadow|cemetery|village_green|recreation_ground)$"]', 'way["natural"~"^(wood|scrub|grassland)$"]']
    .join(';') + ';);out body geom;';
  try {
    const data = await overpass(q);
    // Positions become [east, north] in metres from the tower, to one decimal place
    const local = (g) => g.map((p) => [Math.round((p.lon - c.lon) * kx * 10) / 10, Math.round((p.lat - c.lat) * ky * 10) / 10]);
    const tags = (t = {}) => Object.fromEntries(KEEP.filter((k) => k in t).map((k) => [k, t[k]]));
    const elements = [];
    for (const el of data.elements) {
      if (el.type === 'way' && el.geometry) elements.push({ type: 'way', tags: tags(el.tags), g: local(el.geometry) });
      else if (el.type === 'relation' && el.members) elements.push({ type: 'relation', tags: tags(el.tags),
        m: el.members.filter((m) => m.geometry && (m.role === 'outer' || m.role === 'inner')).map((m) => ({ role: m.role, g: local(m.geometry) })) });
    }
    writeFileSync(file, `(window.SITE_DATA ||= {})[${JSON.stringify(slug(c.name))}] = ${JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), elements })};\n`);
    console.log('saved', c.name, elements.length, 'elements');
  } catch (err) { console.log('FAILED', c.name, err.message); }
  await sleep(2500);
}

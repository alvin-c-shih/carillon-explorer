// Tower close-up: the real buildings around one carillon, extruded to their mapped heights,
// with a drone camera circling the tower. Footprints and heights are OpenStreetMap data, saved in
// sites/<slug>.js by tools/fetch-sites.mjs; there are no photo textures.
window.createSite = function ({ THREE, canvas, calm }) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe0ee);
  scene.fog = new THREE.Fog(0xcfe0ee, 500, 1500);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ae98, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(180, 320, 120); scene.add(sun);
  const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const M = {
    ground: flat(0xdedacf), building: flat(0xcbc4b6), tower: flat(0xd9a441),
    road: flat(0xf8f5ef), path: flat(0xece6da), water: flat(0x8fbfe0), green: flat(0xb9d6a0),
    edge: new THREE.LineBasicMaterial({ color: 0x6b4a1c }),
  };
  scene.add(new THREE.Mesh(new THREE.CircleGeometry(1800, 64).rotateX(-Math.PI / 2), M.ground));

  /* ── Geometry helpers. Map points are [east, north] in metres from the tower; the scene is x = east, z = -north. ── */
  const inside = ([px, py], ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const measure = (ring) => {   // area and centroid
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) < 1e-6) return { area: 0, c: ring[0] };
    return { area: Math.abs(a / 2), c: [cx / (3 * a), cy / (3 * a)] };
  };
  const shapeOf = (poly) => {
    const s = new THREE.Shape(poly.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of poly.holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    return s;
  };
  const solid = (poly, base, top) => new THREE.ExtrudeGeometry(shapeOf(poly), { depth: top - base, bevelEnabled: false })
    .rotateX(-Math.PI / 2).translate(0, base, 0);
  const pointed = (ring, base, top, apex) => {   // a pyramid or spire over a footprint
    const pos = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      pos.push(ring[j][0], base, -ring[j][1], ring[i][0], base, -ring[i][1], apex[0], top, -apex[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  };
  const ribbons = (lines, y, mat) => {   // roads and waterways as flat strips
    const pos = [];
    for (const { pts, w } of lines) for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (!len) continue;
      const nx = -dy / len * w / 2, ny = dx / len * w / 2;
      pos.push(ax + nx, y, -(ay + ny), ax - nx, y, -(ay - ny), bx + nx, y, -(by + ny),
        bx + nx, y, -(by + ny), ax - nx, y, -(ay - ny), bx - nx, y, -(by - ny));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };
  const ROAD_W = { motorway: 13, trunk: 12, primary: 11, secondary: 9, tertiary: 8 };
  const PATHS = ['footway', 'path', 'cycleway', 'steps', 'track', 'bridleway', 'corridor'];
  const POINTED = ['pyramidal', 'cone', 'dome', 'onion', 'spire'];
  const GREEN = (t) => /^(park|garden|pitch)$/.test(t.leisure || '') || /^(grass|forest|meadow|cemetery|village_green|recreation_ground)$/.test(t.landuse || '')
    || /^(wood|scrub|grassland)$/.test(t.natural || '');

  function build(c, data) {
    const closed = (g) => g && g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];
    const ring = (g) => g.slice(0, -1);
    const buildings = [], roads = [], paths = [], waterLines = [], water = [], green = [];

    for (const el of data.elements) {
      const t = el.tags || {};
      let polys = [], line = null;
      if (el.type === 'way' && el.g) {
        if (closed(el.g)) polys = [{ outer: ring(el.g), holes: [] }];
        line = el.g;
      } else if (el.type === 'relation' && el.m) {
        // A relation's outline may be split across several ways: join them end to end into closed rings
        const rings = (role) => {
          const open = el.m.filter((m) => m.role === role && m.g.length > 1).map((m) => m.g.slice()), done = [];
          const same = (a, b) => a[0] === b[0] && a[1] === b[1];
          while (open.length) {
            let cur = open.pop(), grew = true;
            while (!closed(cur) && grew) {
              grew = false;
              for (let k = 0; k < open.length; k++) {
                const w = open[k], end = cur[cur.length - 1];
                if (same(w[0], end)) cur = cur.concat(w.slice(1));
                else if (same(w[w.length - 1], end)) cur = cur.concat(w.slice().reverse().slice(1));
                else continue;
                open.splice(k, 1); grew = true; break;
              }
            }
            if (closed(cur)) done.push(ring(cur));
          }
          return done;
        };
        const inners = rings('inner');
        polys = rings('outer').map((outer) => ({ outer, holes: inners.filter((h) => inside(h[0], outer)) }));
      }
      polys = polys.filter((p) => p.outer.length >= 3);
      const isBuilding = (t.building && t.building !== 'no') || t.man_made === 'tower' && !t['building:part'];
      const part = t['building:part'] && t['building:part'] !== 'no' && !(t.building && t.building !== 'no');   // tagged as both: it is the outline
      if ((part || isBuilding) && polys.length) {
        const m = measure(polys[0].outer);
        buildings.push({ t, polys, part, area: m.area, c: m.c });
      } else if (t.highway && line && el.type === 'way') {
        if (PATHS.includes(t.highway)) paths.push({ pts: line, w: 2.2 });
        else roads.push({ pts: line, w: ROAD_W[t.highway] || 6 });
      } else if ((t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock') && polys.length) water.push(...polys);
      else if (t.waterway && line) waterLines.push({ pts: line, w: t.waterway === 'river' ? 16 : t.waterway === 'canal' ? 9 : 3 });
      else if (GREEN(t) && polys.length) green.push(...polys);
    }

    // Which building is the carillon's? The outline under the map point, or failing that the nearest one.
    const outlines = buildings.filter((b) => !b.part), parts = buildings.filter((b) => b.part);
    let own = null;
    const far = (b) => Math.hypot(b.c[0], b.c[1]);
    const towers = outlines.filter((b) => b.t.man_made === 'tower' && far(b) < 60).sort((a, b) => far(a) - far(b));
    if (!c.approx) {
      // The map often holds the same tower twice (as a "tower" and as a "building"): keep the copy that has a height
      const under = outlines.filter((b) => inside([0, 0], b.polys[0].outer)).sort((a, b) => a.area - b.area);
      const twins = under.filter((b) => b.area < under[0].area * 1.3);   // empty when nothing is under the point
      const tall = (b) => num(b.t.height) != null || num(b.t['building:levels']) != null;
      own = twins.find(tall) || under[0] || null;
      for (const b of twins) if (b !== own) b.replaced = true;
      // The bells hang in a tower: if the map point fell on the church beside it, take the mapped tower instead
      if (towers[0] && !twins.some((b) => b.t.man_made === 'tower')) own = towers[0];
      own = own || outlines.map((b) => ({ b, d: far(b) })).filter((x) => x.d < 60).sort((a, b) => a.d - b.d)[0]?.b || null;
    }
    if (c.approx) {   // position only roughly known: accept a nearby building that is named like the tower
      const key = c.name.split(' ')[0].toLowerCase();
      own = outlines.filter((b) => /carillon|tower|campanile/i.test(b.t.name || '') || (b.t.name || '').toLowerCase().includes(key))
        .sort((a, b) => far(a) - far(b))[0] || towers[0]
        || outlines.filter((b) => /^(church|cathedral|chapel)$/.test(b.t.building) && far(b) < 80).sort((a, b) => far(a) - far(b))[0] || null;
    }
    const ownParts = own ? parts.filter((p) => inside(p.c, own.polys[0].outer))
      : c.approx ? [] : parts.filter((p) => Math.hypot(...p.c) < 15);   // no outline at all: take the parts at the spot
    if (!own && ownParts.length) own = ownParts[0];
    for (const o of outlines) o.replaced = o.replaced || parts.some((p) => p !== o && inside(p.c, o.polys[0].outer));   // parts stand in for their outline

    const group = new THREE.Group();
    const add = (geo, mat, outline) => {
      group.add(new THREE.Mesh(geo, mat));
      if (outline) group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), M.edge));
    };
    let top = { h: 0, c: [0, 0] }, heightKnown = false, drawn = 0;
    const others = [];   // the neighbours, for choosing a side to look from
    for (const b of buildings) {
      if (b.replaced) continue;
      const mine = b === own || ownParts.includes(b), t = b.t;
      let h = num(t.height) ?? num(t['building:height']);
      const levels = num(t['building:levels']);
      if (h == null && levels != null) h = levels * 3.2 + (num(t['roof:levels']) || 0) * 3;
      const known = h != null;
      const minLevel = num(t['building:min_level']);
      const base = num(t.min_height) ?? (minLevel != null ? minLevel * 3.2 : 0);
      if (h == null) h = mine ? (b.area < 500 ? (c.tower || 30) : 18) : 9;
      if (h <= base) h = base + 3;
      const tip = POINTED.includes(t['roof:shape']);
      const roof = tip ? Math.min(h - base - 0.5, num(t['roof:height']) ?? (h - base) * 0.35) : 0;
      const mat = mine ? M.tower : M.building;
      for (const p of b.polys) add(solid(p, base, h - roof), mat, mine);
      if (tip) add(pointed(b.polys[0].outer, h - roof, h, b.c), mat, mine);
      drawn++;
      if (mine) { heightKnown = heightKnown || known; if (h > top.h) top = { h, c: b.c }; }
      else others.push({ c: b.c, h, w: Math.sqrt(b.area) });
    }

    let kind = c.approx && !own ? 'none' : !own ? 'standin' : ownParts.length ? 'parts' : heightKnown ? 'height' : 'outline';
    if (kind === 'standin') {   // nothing mapped at this spot: mark it with a plain block
      const h = c.tower || 35, s = 4;
      add(solid({ outer: [[-s, -s], [s, -s], [s, s], [-s, s]], holes: [] }, 0, h), M.tower, true);
      top = { h, c: [0, 0] };
    }
    if (kind === 'none') top = { h: 30, c: [0, 0] };

    for (const p of green) group.add(new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(p)).rotateX(-Math.PI / 2).translate(0, 0.05, 0), M.green));
    for (const p of water) group.add(new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(p)).rotateX(-Math.PI / 2).translate(0, 0.1, 0), M.water));
    group.add(ribbons(waterLines, 0.12, M.water), ribbons(paths, 0.16, M.path), ribbons(roads, 0.2, M.road));

    // How far the highlighted building reaches from the point the camera circles
    const span = own ? 2 * Math.max(...own.polys[0].outer.map(([x, y]) => Math.hypot(x - top.c[0], y - top.c[1]))) : 0;
    const dist = clamp(Math.max(top.h * 2.3, span * 1.5, 120), 120, 480);
    // Start on the side where the fewest tall neighbours stand between the camera and the tower
    let az = 0.7, least = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = 0.7 + k * Math.PI / 8;
      let blocked = 0;
      for (const o of others) {
        const dx = o.c[0] - top.c[0], dz = -(o.c[1] - top.c[1]), d = Math.hypot(dx, dz);
        if (d > dist || d < 1) continue;
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - a), Math.cos(Math.atan2(dz, dx) - a)));
        if (off < 0.5) blocked += Math.max(0, o.h - (top.h * 0.35 + 0.45 * d)) * o.w * (1 - off);
      }
      if (blocked < least - 1e-6) { least = blocked; az = a; }
    }
    return {
      group,
      target: new THREE.Vector3(top.c[0], top.h * 0.5, -top.c[1]),
      dist, az,
      info: { kind, parts: ownParts.length, buildings: drawn, height: Math.round(top.h) },
    };
  }

  // Each tower's map data is a small script in sites/, loaded the first time the tower is opened
  const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function fetchMap(c) {
    const key = slug(c.name);
    return new Promise((resolve, reject) => {
      if (window.SITE_DATA?.[key]) return resolve(window.SITE_DATA[key]);
      const tag = document.createElement('script');
      tag.src = `sites/${key}.js`;
      tag.onload = () => window.SITE_DATA?.[key] ? resolve(window.SITE_DATA[key]) : reject(new Error('empty map file'));
      tag.onerror = () => { tag.remove(); reject(new Error('no map file')); };
      document.head.appendChild(tag);
    });
  }

  /* ── Drone camera ── */
  const cache = new Map(), target = new THREE.Vector3(0, 20, 0), drone = { az: 0.7, el: 0.42, dist: 200, touched: 0 };
  let group = null, active = false, token = 0, down = null, last = 0, homeDist = 200, homeAz = 0.7;
  const reset = () => { drone.az = homeAz; drone.el = 0.42; drone.dist = homeDist; drone.touched = 0; };

  async function load(c) {
    const my = ++token;
    if (group) { scene.remove(group); group = null; }
    let entry = cache.get(c.name);
    if (!entry) { entry = build(c, await fetchMap(c)); cache.set(c.name, entry); }
    if (my !== token) return null;   // the reader has moved on to another tower
    group = entry.group; scene.add(group);
    target.copy(entry.target); homeDist = entry.dist; homeAz = entry.az; reset();
    return entry.info;
  }

  function update(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!calm() && !down && now - drone.touched > 2500) drone.az += dt * 0.12;   // the slow circle
    const ce = Math.cos(drone.el) * drone.dist;
    camera.position.set(target.x + ce * Math.cos(drone.az), target.y + Math.sin(drone.el) * drone.dist, target.z + ce * Math.sin(drone.az));
    camera.position.y = Math.max(3, camera.position.y);
    camera.lookAt(target);
  }

  // Pointers are tracked by hand so that touch works too: one finger swings the drone, two fingers pinch to zoom
  const ptrs = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0;
    down = [e.clientX, e.clientY]; drone.touched = performance.now(); canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    canvas.style.cursor = 'grab';
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch && gap) drone.dist = clamp(drone.dist * pinch / gap, 35, 900);
      pinch = gap;
    } else {
      drone.az += dx * 0.006;
      drone.el = clamp(drone.el + dy * 0.004, -0.1, 1.45);
    }
    drone.touched = performance.now();
  });
  const release = (e) => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) down = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    if (!active) return;
    e.preventDefault();
    drone.dist = clamp(drone.dist * Math.exp(e.deltaY * 0.0015), 35, 900);
    drone.touched = performance.now();
  }, { passive: false });

  // Keyboard control: turn, tilt and zoom the drone by one step
  function nudge(dx, dy, dz) {
    drone.az += dx * 0.18; drone.el = clamp(drone.el - dy * 0.1, -0.1, 1.45); drone.dist = clamp(drone.dist * (1 + dz * 0.15), 35, 900);
    drone.touched = performance.now();
  }

  return { scene, camera, load, update, reset, nudge, setActive(on) { active = on; down = null; ptrs.clear(); } };
};

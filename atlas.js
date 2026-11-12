// World atlas: a globe with a small tower for every carillon (taller = more bells), coloured by country,
// over country outlines with the carillon countries tinted in the same colours.
// Two camera modes: a free-spinning globe, and a "drone" that circles above one selected carillon.
window.createAtlas = function ({ THREE, OrbitControls, canvas, data, onSelect, calm, tint }) {
  const R = 10, DEG = Math.PI / 180, HOME = 33;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const toVec = (lat, lon, r = 1) => {
    const phi = (90 - lat) * DEG, th = (lon + 180) * DEG;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a14);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
  const START = toVec(38, -12, 1);   // the opening view: Europe and North America either side of the Atlantic
  camera.position.copy(START).multiplyScalar(HOME);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-3, 3, 4); camera.add(sun);

  /* ── Earth ── */
  const globeMat = new THREE.MeshStandardMaterial({ color: 0x2f6594, roughness: 0.95, metalness: 0 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), globeMat);
  scene.add(globe);
  // The Earth photo is a local file (vendor/earth.js); without it the globe stays plain blue with its grid
  if (window.EARTH_IMAGE) new THREE.TextureLoader().load(window.EARTH_IMAGE, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    globeMat.map = t; globeMat.color.set(0xffffff); globeMat.needsUpdate = true;
  });

  // Latitude / longitude grid, visible mostly until the map texture arrives
  {
    const pts = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) pts.push(toVec(lat, lon, R * 1.001), toVec(lat, lon + 4, R * 1.001));
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) pts.push(toVec(lat, lon, R * 1.001), toVec(lat + 4, lon, R * 1.001));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })));
  }

  // Atmosphere glow
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.13, 64, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float i = pow(max(0.0, 0.66 - dot(vN, vec3(0.0, 0.0, 1.0))), 2.6); gl_FragColor = vec4(0.4, 0.65, 1.0, 1.0) * i; }',
  })));

  // Stars
  {
    const p = [];
    for (let k = 0; k < 1800; k++) p.push(new THREE.Vector3().randomDirection().multiplyScalar(400));
    scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(p),
      new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
  }

  /* ── Countries: every border as a fine line, and each carillon country washed in its own colour ── */
  // The outlines are a local file (vendor/countries.js). Drawing them waits a moment so the globe appears first.
  new Promise((done) => setTimeout(() => done(window.COUNTRY_SHAPES), 0)).then((topo) => {
    if (!topo) return;
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });   // [longitude, latitude]
    // Which colour each stretch of border takes: that of a carillon country it belongs to, else none
    const edge = new Map();
    for (const geo of topo.objects.countries.geometries) {
      const colour = tint?.(geo.properties.name);
      if (colour != null) for (const ai of geo.arcs.flat(3)) if (!edge.has(ai < 0 ? ~ai : ai)) edge.set(ai < 0 ? ~ai : ai, new THREE.Color(colour));
    }
    const plain = [], bright = [], hues = [];
    arcs.forEach((a, n) => {
      const c = edge.get(n);
      for (let k = 0; k + 1 < a.length; k++) {
        if (Math.abs(a[k][0]) > 179.9 && Math.abs(a[k + 1][0]) > 179.9) continue;   // the map's own cut along the date line
        (c ? bright : plain).push(toVec(a[k][1], a[k][0], R * 1.003), toVec(a[k + 1][1], a[k + 1][0], R * 1.003));
        if (c) hues.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    });
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(plain), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })));
    const lit = new THREE.BufferGeometry().setFromPoints(bright); lit.setAttribute('color', new THREE.Float32BufferAttribute(hues, 3));
    scene.add(new THREE.LineSegments(lit, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })));

    const W = 4096, H = 2048, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (const geo of topo.objects.countries.geometries) {
      const colour = tint?.(geo.properties.name);
      if (colour == null) continue;
      const hex = '#' + colour.toString(16).padStart(6, '0');
      for (const poly of geo.type === 'Polygon' ? [geo.arcs] : geo.arcs) {
        for (const shift of [-W, 0, W]) {   // drawn three times so shapes that cross the date line wrap round
          g.beginPath();
          for (const ring of poly) {
            let last = null, turn = 0, first = true;
            for (const ai of ring) for (const [lon, lat] of ai < 0 ? arcs[~ai].slice().reverse() : arcs[ai]) {
              if (last !== null) turn += lon - last > 180 ? -360 : lon - last < -180 ? 360 : 0;
              last = lon;
              const x = (lon + turn + 180) / 360 * W + shift, y = (90 - lat) / 180 * H;
              if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
            }
            g.closePath();
          }
          g.globalAlpha = 0.3; g.fillStyle = hex; g.fill('evenodd');
        }
      }
    }
    const wash = new THREE.CanvasTexture(cv); wash.colorSpace = THREE.SRGBColorSpace; wash.anisotropy = 8;
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.0015, 128, 96), new THREE.MeshBasicMaterial({ map: wash, transparent: true, depthWrite: false })));
  }).catch((err) => console.warn('Country outlines could not be drawn', err));   // the towers keep their colours

  /* ── Markers: featured carillons are small towers; all the others are slim posts drawn in one batch ── */
  const labelsEl = document.getElementById('atlasLabels');
  const Y = new THREE.Vector3(0, 1, 0);
  const bodyGeo = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(0.09, 0.18, 4).rotateY(Math.PI / 4).translate(0, 0.07, 0);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 1, 0.045).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, data.filter((c) => !c.featured).length));
  posts.frustumCulled = false; scene.add(posts);
  const WHITE = new THREE.Color(0xffffff);
  let slots = 0;
  const marks = data.map((c, i) => {
    const n = toVec(c.lat, c.lon), h = c.featured ? 0.2 + 1.2 * c.bells / 78 : 0.1 + 0.8 * (c.bells || 23) / 78;
    const e = new THREE.Vector3().crossVectors(Y, n).normalize(), north = new THREE.Vector3().crossVectors(n, e);
    const own = new THREE.Color(c.color ?? 0xc79a45);
    const m = { c, i, n, e, north, h, tint: { idle: own, fresh: own.clone().lerp(WHITE, 0.6), hover: own.clone().lerp(WHITE, 0.75), sel: WHITE }, P: n.clone().multiplyScalar(R), q: new THREE.Quaternion().setFromUnitVectors(Y, n), show: true, el: null };
    if (c.featured) {
      m.mat = new THREE.MeshStandardMaterial({ color: own, emissive: own, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.2 });
      m.g = new THREE.Group(); m.g.position.copy(m.P); m.g.quaternion.copy(m.q);
      const body = new THREE.Mesh(bodyGeo, m.mat); body.scale.y = h;
      const roof = new THREE.Mesh(roofGeo, m.mat); roof.position.y = h;
      m.g.add(body, roof); scene.add(m.g);
    } else m.slot = slots++;
    return m;
  });
  const label = (m) => {   // labels are made the first time they are needed
    if (!m.el) {
      m.el = document.createElement('div');
      m.el.setAttribute('role', 'button'); m.el.tabIndex = 0;   // reachable and usable from the keyboard
      m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(m.i); } });
      m.el.textContent = `${m.c.name}, ${m.c.city}`;
      m.el.addEventListener('click', () => select(m.i));
      m.el.style.setProperty('--dot', '#' + m.tint.idle.getHexString());
      labelsEl.appendChild(m.el);
    }
    return m.el;
  };

  /* ── Camera ── */
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.2;   // short glide of its own; a flick adds the long spin below
  controls.minDistance = R + 0.6; controls.maxDistance = 48;
  controls.autoRotate = !calm(); controls.autoRotateSpeed = 0.35; controls.enabled = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  let active = false, sel = -1, hover = -1, trans = null, down = null, last = 0, scale = 1, drawnScale = -1, homeDist = HOME;
  const drone = { az: 0, el: 0.7, dist: 3, touched: 0 };
  const spin = { az: 0, pol: 0 }, trail = [];   // flick: how fast the globe is still turning (radians a second), and the pointer's recent path
  const look = new THREE.Vector3(), homeDir = camera.position.clone().normalize();
  const to = { pos: new THREE.Vector3(), up: new THREE.Vector3(), look: new THREE.Vector3() };

  function targetPose() {
    if (sel < 0) { to.pos.copy(homeDir).multiplyScalar(homeDist); to.up.copy(Y); to.look.set(0, 0, 0); return; }
    const m = marks[sel], ce = Math.cos(drone.el) * drone.dist;
    to.pos.copy(m.P).addScaledVector(m.n, Math.sin(drone.el) * drone.dist)
      .addScaledVector(m.e, ce * Math.cos(drone.az)).addScaledVector(m.north, ce * Math.sin(drone.az));
    to.up.copy(m.n);
    to.look.copy(m.P).addScaledVector(m.n, m.h * scale * 0.5);
  }

  function select(i, silent = false) {
    if (i === sel && i >= 0 && !trans) return;
    const from = { pos: camera.position.clone(), up: camera.up.clone(), look: look.clone() };
    if (i < 0) {
      homeDir.copy(camera.position).normalize(); homeDir.y = clamp(homeDir.y, -0.75, 0.75); homeDir.normalize();
    } else {
      const m = marks[i], off = camera.position.clone().sub(m.P);
      drone.az = Math.atan2(off.dot(m.north), off.dot(m.e));   // arrive from the side we are already on
      drone.el = 0.7; drone.dist = 3; drone.touched = 0;
    }
    sel = i; controls.enabled = false; controls.autoRotate = false; spin.az = spin.pol = 0;
    targetPose();
    const ang = from.pos.angleTo(to.pos);
    trans = { from, ang, t0: performance.now(), dur: calm() ? 1 : 1700 + ang * 900 };
    if (!silent) onSelect(i);
  }

  // Turn the globe to face a set of carillons, close enough to see them apart. No list: the whole globe.
  function frame(list) {
    const from = { pos: camera.position.clone(), up: camera.up.clone(), look: look.clone() };
    if (!list || !list.length || list.length === marks.length) {
      homeDist = HOME; homeDir.copy(camera.position).normalize(); homeDir.y = clamp(homeDir.y, -0.75, 0.75); homeDir.normalize();
    } else {
      const mid = new THREE.Vector3();
      for (const i of list) mid.add(marks[i].n);
      if (mid.length() < 1e-3) mid.copy(marks[list[0]].n);
      mid.normalize();
      const spread = Math.max(...list.map((i) => marks[i].n.angleTo(mid)));
      homeDir.copy(mid); homeDist = R + clamp(spread * R * 2.6, 1.2, HOME - R);
    }
    sel = -1; controls.enabled = false; controls.autoRotate = false; spin.az = spin.pol = 0;
    targetPose();
    trans = { from, t0: performance.now(), dur: calm() ? 1 : 1700 + from.pos.angleTo(to.pos) * 600 };
  }
  let fresh = null;   // markers to make glow, for example the newest ones in the history view
  // Back to the opening view: same side of the Earth, same distance, north up
  function home() {
    const from = { pos: camera.position.clone(), up: camera.up.clone(), look: look.clone() }, had = sel;
    homeDir.copy(START); homeDist = HOME;
    sel = -1; controls.enabled = false; controls.autoRotate = false; spin.az = spin.pol = 0;
    targetPose();
    trans = { from, t0: performance.now(), dur: calm() ? 1 : 1200 + from.pos.angleTo(to.pos) * 600 };
    if (had >= 0) onSelect(-1);
  }
  // Keyboard control: turn (dx), tilt (dy) and zoom (dz) by one step, for the globe or for the drone over a carillon
  function nudge(dx, dy, dz) {
    spin.az = spin.pol = 0;
    if (sel >= 0) {
      drone.az += dx * 0.18; drone.el = clamp(drone.el - dy * 0.1, 0.2, 1.45); drone.dist = clamp(drone.dist * (1 + dz * 0.15), 0.8, 9);
      drone.touched = performance.now();
    } else if (!trans) {
      controls.autoRotate = false;
      const len = camera.position.length(), pol = Math.acos(clamp(camera.position.y / len, -1, 1));
      const tilt = clamp(pol + dy * 0.12, 0.2, Math.PI - 0.2) - pol;
      camera.position.applyAxisAngle(side.crossVectors(Y, camera.position).normalize(), tilt).applyAxisAngle(Y, dx * 0.18)
        .setLength(clamp(len * (1 + dz * 0.12), controls.minDistance, controls.maxDistance));
    }
  }
  function resetDrone() { drone.el = 0.7; drone.dist = 3; drone.touched = 0; }   // the starting height and distance above the selected carillon
  function setFilter(set, glow = null) { for (const m of marks) m.show = !set || set.has(m.i); fresh = glow; drawnScale = -1; }

  const side = new THREE.Vector3();
  const dirA = new THREE.Vector3(), dirB = new THREE.Vector3(), tip = new THREE.Vector3(), mtx = new THREE.Matrix4(), size = new THREE.Vector3();
  function update(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    scale = clamp((camera.position.length() - R) / 12, 0.1, 1);   // towers shrink as the camera comes down
    const redraw = Math.abs(scale - drawnScale) > 1e-4;
    for (const m of marks) {
      const state = m.i === sel ? 'sel' : m.i === hover ? 'hover' : fresh?.has(m.i) ? 'fresh' : 'idle', on = m.show || m.i === sel;
      if (m.g) {
        m.g.visible = on; m.g.scale.setScalar(scale);
        m.mat.emissive.copy(state === 'sel' ? WHITE : m.tint.idle);
        m.mat.emissiveIntensity = state === 'sel' ? 0.9 : state === 'idle' ? 0.3 : 0.75;
      } else if (redraw || m.state !== state) {
        const big = state === 'sel' || state === 'hover', wide = !on ? 0 : big ? scale * 2.2 : state === 'fresh' ? scale * 1.4 : scale;
        mtx.compose(m.P, m.q, size.set(wide, on ? scale * m.h * (big ? 1.4 : 1) : 0, wide));
        posts.setMatrixAt(m.slot, mtx); posts.setColorAt(m.slot, m.tint[state]);
        posts.instanceMatrix.needsUpdate = true; posts.instanceColor.needsUpdate = true;
        m.state = state;
      }
    }
    drawnScale = scale;
    if (!calm() && sel >= 0 && !down && now - drone.touched > 2500) drone.az += dt * 0.1;   // the slow circle
    targetPose();

    if (trans) {
      const u = Math.min(1, (now - trans.t0) / trans.dur), k = ease(u), f = trans.from;
      const la = f.pos.length(), lb = to.pos.length();
      dirA.copy(f.pos).normalize(); dirB.copy(to.pos).normalize();
      const ang = dirA.angleTo(dirB), s = Math.sin(ang);
      if (s > 1e-3) dirA.multiplyScalar(Math.sin((1 - k) * ang) / s).addScaledVector(dirB, Math.sin(k * ang) / s);
      const hop = Math.max(la, lb) < 18 ? Math.sin(Math.PI * k) * Math.min(ang, 2) * 3.5 : 0;   // rise up between two towers
      camera.position.copy(dirA).normalize().multiplyScalar(la + (lb - la) * k + hop);
      camera.up.copy(f.up).lerp(to.up, k).normalize();
      look.copy(f.look).lerp(to.look, k);
      camera.lookAt(look);
      if (u >= 1) {
        trans = null;
        if (sel < 0) { camera.up.copy(Y); controls.target.set(0, 0, 0); controls.enabled = active; controls.update(); }
      }
    } else if (sel >= 0) {
      camera.position.copy(to.pos); camera.up.copy(to.up); look.copy(to.look); camera.lookAt(look);
    } else {
      controls.rotateSpeed = clamp((camera.position.length() - R) / 17, 0.06, 1);
      if (!down && (spin.az || spin.pol)) {   // keep turning after a flick, slowing like a heavy ball
        const len = camera.position.length(), pol = Math.acos(clamp(camera.position.y / len, -1, 1));
        const tilt = clamp(pol + spin.pol * dt, 0.2, Math.PI - 0.2) - pol;
        camera.position.applyAxisAngle(side.crossVectors(Y, camera.position).normalize(), tilt).applyAxisAngle(Y, spin.az * dt);
        const slow = Math.exp(-dt * 0.9); spin.az *= slow; spin.pol *= slow * slow;
        if (Math.hypot(spin.az, spin.pol) < 0.01) spin.az = spin.pol = 0;
      }
      controls.update(); look.set(0, 0, 0);
    }

    // Labels: the selected tower, the hovered one, and neighbours once the drone has arrived
    const w = innerWidth, h = innerHeight, shown = [];
    let near = null;
    if (sel >= 0 && !trans) {   // up to ten neighbours, fewer the lower the drone flies
      const reach = 7 * DEG * clamp(drone.dist / 3, 0.3, 1.6), here = marks[sel].n;
      near = new Set(marks.filter((m) => m.show && m.i !== sel).map((m) => [m.n.angleTo(here), m]).filter((x) => x[0] < reach)
        .sort((x, y) => x[0] - y[0]).slice(0, 10).map((x) => x[1]));
    }
    for (const m of marks) {
      let show = m.i === sel || m.i === hover || (near !== null && near.has(m));
      if (show) {
        tip.copy(m.P).addScaledVector(m.n, m.h * scale * 1.1);
        show = tip.dot(camera.position) > R * R;   // not over the horizon
        tip.project(camera);
        show = show && tip.z < 1;
        if (show) shown.push({ m, x: (tip.x + 1) / 2 * w, y: (1 - tip.y) / 2 * h });
      }
      if (!show) { if (m.el) m.el.style.display = 'none'; continue; }
      const el = label(m);
      el.style.display = '';
      el.classList.toggle('sel', m.i === sel);
      el.style.zIndex = m.i === sel ? 2 : m.i === hover ? 1 : 0;
    }
    // Nudge labels apart where towers crowd together (the Low Countries)
    shown.sort((a, b) => a.y - b.y);
    shown.forEach((l, k) => {
      for (let j = 0; j < k; j++) {
        const o = shown[j];
        if (Math.abs(o.x - l.x) < 190 && l.y - o.y < 22) l.y = o.y + 22;
      }
      l.m.el.style.left = l.x + 'px'; l.m.el.style.top = l.y + 'px';
    });
  }

  /* ── Pointer ── */
  // Picking is done on screen: the nearest marker within a few pixels of the pointer
  function pick(e) {
    let best = -1, reach = 15;
    for (const m of marks) {
      if (!m.show && m.i !== sel) continue;
      tip.copy(m.P).addScaledVector(m.n, m.h * scale * 0.5);
      if (tip.dot(camera.position) < R * R) continue;
      tip.project(camera);
      if (tip.z > 1) continue;
      const d = Math.hypot((tip.x + 1) / 2 * innerWidth - e.clientX, (1 - tip.y) / 2 * innerHeight - e.clientY) - (m.c.featured ? 5 : 0);
      if (d < reach) { reach = d; best = m.i; }
    }
    return best;
  }
  const hint = document.getElementById('atlasHint');
  // Pointers are tracked by hand so that touch works too: one finger swings the drone, two fingers pinch to zoom
  const ptrs = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0;
    down = [e.clientX, e.clientY]; drone.touched = performance.now(); hint?.classList.add('gone');
    spin.az = spin.pol = 0; trail.length = 0;   // a touch stops the spin
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const p = ptrs.get(e.pointerId);
    if (p && down && sel < 0) { trail.push([performance.now(), e.clientX, e.clientY]); if (trail.length > 12) trail.shift(); }
    if (p && down && sel >= 0 && !trans) {   // drag to swing the drone around and up or down
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch && gap) drone.dist = clamp(drone.dist * pinch / gap, 0.8, 9);
        pinch = gap;
      } else {
        drone.az -= dx * 0.006;
        drone.el = clamp(drone.el + dy * 0.004, 0.2, 1.45);
      }
      drone.touched = performance.now();
    } else if (!e.buttons && e.pointerType !== 'touch') {
      hover = pick(e);
      canvas.style.cursor = hover >= 0 ? 'pointer' : 'grab';
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasOne = ptrs.size === 1;
    ptrs.delete(e.pointerId); pinch = 0;
    if (!active || !down) return;
    if (wasOne && sel < 0 && !trans) {   // flick: carry on at the speed the pointer had over its last tenth of a second
      const now = performance.now(), recent = trail.filter((s) => now - s[0] < 110);
      if (recent.length > 1 && now - recent[recent.length - 1][0] < 60) {
        const a = recent[0], b = recent[recent.length - 1], secs = Math.max(0.016, (b[0] - a[0]) / 1000);
        const k = 2 * Math.PI / canvas.clientHeight * controls.rotateSpeed, vx = (b[1] - a[1]) / secs, vy = (b[2] - a[2]) / secs;
        if (Math.hypot(vx, vy) > 120) { spin.az = clamp(-vx * k, -9, 9); spin.pol = clamp(-vy * k, -5, 5); }
      }
    }
    const still = Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5;
    down = null;
    if (still) { const i = pick(e); if (i >= 0) select(i); }
  });
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = 0; down = null; });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('wheel', (e) => {
    if (!active || sel < 0) return;
    e.preventDefault();
    drone.dist = clamp(drone.dist * Math.exp(e.deltaY * 0.0015), 0.8, 9);
    drone.touched = performance.now();
  }, { passive: false });

  function setActive(on) {
    active = on; hover = -1; down = null; ptrs.clear();
    controls.enabled = on && sel < 0 && !trans;
    labelsEl.style.display = on ? '' : 'none';
  }
  setActive(false);

  return { scene, camera, controls, marks, select, setActive, update, frame, home, resetDrone, nudge, setFilter, setHover(i) { hover = i; }, get selected() { return sel; } };
};

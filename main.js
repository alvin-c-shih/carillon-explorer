// Everything the app needs to run is in this folder: three.js, the Earth photo and the country outlines are local
// files in vendor/ (built by tools/build-vendor.mjs), loaded as ordinary scripts so the page also works when
// index.html is opened straight from disk. Only the extras need a connection: photos and recordings from
// Wikimedia Commons, and the links out to Wikipedia, Google Earth and YouTube.
(async () => {
const lib = window.CARILLON_3D;
if (!lib) {
  document.getElementById('title').textContent = 'A file is missing';
  document.getElementById('body').innerHTML = '<p>Carillon Explorer could not find <b>vendor/three.bundle.js</b>. Run <kbd>node tools/build-vendor.mjs</kbd> in the project folder to rebuild the vendor files, then reload.</p>';
  return;
}
const { THREE, OrbitControls, LineSegments2, LineMaterial, LineSegmentsGeometry, Sky, EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass } = lib;

/* ───────────────────────── Instrument data ───────────────────────── */

const N = 37;                 // three chromatic octaves, C3–C6
const F0 = 130.81;            // prime of the bourdon (C3)
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP = [1, 3, 6, 8, 10];

// Tower dimensions, metres
const HALF = 4.5, WALL = 0.8, SHAFT_H = 36, CABIN_Y = 31, BELFRY_Y = 36, BELFRY_H = 11;
const RACK_Y = 36.3;          // lowest level of the crank rack, just above the cabin ceiling
const CONSOLE_Z = -0.6;

const TIERS = [
  { count: 4, cols: 2, spacing: 2.5, crownY: 39.4 },
  { count: 9, cols: 3, spacing: 1.75, crownY: 41.5 },
  { count: 12, cols: 4, spacing: 1.2, crownY: 42.9 },
  { count: 12, cols: 4, spacing: 0.85, crownY: 43.9 },
];

const bells = [];
{
  let i = 0;
  for (const tier of TIERS) {
    const rows = tier.count / tier.cols;
    for (let k = 0; k < tier.count; k++, i++) {
      const r = Math.floor(k / tier.cols), c = k % tier.cols;
      const f = F0 * 2 ** (i / 12);
      // Real trebles are cast thicker than pure scaling predicts, so diameter
      // shrinks a little slower than 1/frequency.
      const D = 1.6 * (F0 / f) ** 0.85;
      bells.push({
        i, f, D, H: 0.8 * D, kg: 600 * D ** 3,
        name: NOTE[i % 12] + (3 + Math.floor(i / 12)),
        x: (c - (tier.cols - 1) / 2) * tier.spacing,
        z: ((rows - 1) / 2 - r) * tier.spacing,
        crownY: tier.crownY, hitAt: -1e9, vel: 0,
      });
    }
  }
}

/* ───────────────────────── Scene setup ───────────────────────── */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const EXPOSURE = 0.5;   // for the tower scene, whose sky and sun are physically bright; the globe and close-up use 1

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9cde2, 160, 1150);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 160;

// A late-afternoon sun, a sky computed from it, and reflections taken from that sky
const SUN = new THREE.Vector3(0.74, 0.46, 0.5).normalize();
const sky = new Sky();
sky.scale.setScalar(4000); sky.renderOrder = -1;
Object.entries({ turbidity: 2, rayleigh: 2.3, mieCoefficient: 0.004, mieDirectionalG: 0.86 }).forEach(([k, v]) => { sky.material.uniforms[k].value = v; });
sky.material.uniforms.sunPosition.value.copy(SUN);
{
  const pm = new THREE.PMREMGenerator(renderer), only = new THREE.Scene();
  only.add(sky);
  scene.environment = pm.fromScene(only, 0, 1, 5000).texture;
  pm.dispose();
}
scene.add(sky);
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x8f8266, 1.7));
const sun = new THREE.DirectionalLight(0xffe3bd, 5.2);
sun.position.copy(SUN).multiplyScalar(220);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 95, bottom: -70, near: 20, far: 460 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.06;
scene.add(sun);

/* ───────────────────────── Materials ───────────────────────── */

// Every surface texture is painted here on a canvas, so the app needs no image files
const paint = (size, draw) => { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; };
const texture = (c, colour = true, rx = 1, ry = 1) => {
  const t = new THREE.CanvasTexture(c);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  return t;
};
const rand = (a, b) => a + Math.random() * (b - a);
// Turns a greyscale height picture into a normal map, so flat walls catch the light like carved stone
function normalsFrom(c, strength) {
  const S = c.width, src = c.getContext('2d').getImageData(0, 0, S, S).data;
  const out = paint(S, () => {}), og = out.getContext('2d'), img = og.createImageData(S, S);
  const at = (x, y) => src[(((y + S) % S) * S + (x + S) % S) * 4];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength / 255, dy = (at(x, y + 1) - at(x, y - 1)) * strength / 255;
    const l = Math.hypot(dx, dy, 1), k = (y * S + x) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

// Ashlar stone: four courses of blocks per tile, with mortar joints, weathering and a matching height picture
let stoneHeight;
const stoneColour = paint(1024, (g, S) => {
  stoneHeight = paint(S, (h) => { h.fillStyle = '#1c1c1c'; h.fillRect(0, 0, S, S); });
  const h = stoneHeight.getContext('2d');
  g.fillStyle = '#6c6456'; g.fillRect(0, 0, S, S);
  for (let r = 0; r < 4; r++) {
    const cuts = [0, 1, 2, 3].map((k) => (k + rand(0.25, 0.75)) * S / 4), shift = rand(0, S);
    cuts.forEach((c0, k) => {
      const w = (k < 3 ? cuts[k + 1] : cuts[0] + S) - c0, tone = `hsl(${rand(32, 44)}, ${rand(9, 20)}%, ${rand(56, 70)}%)`, lift = Math.round(rand(150, 235));
      for (const wrap of [0, -S]) {
        const x = (c0 + shift) % S + wrap, y = r * 256;
        g.fillStyle = tone; g.fillRect(x + 3, y + 3, w - 6, 250);
        h.fillStyle = `rgb(${lift - 60},${lift - 60},${lift - 60})`; h.fillRect(x + 3, y + 3, w - 6, 250);
        h.fillStyle = `rgb(${lift},${lift},${lift})`; h.fillRect(x + 8, y + 8, w - 16, 240);
      }
    });
  }
  for (let k = 0; k < 14000; k++) {   // grain and pitting
    const x = rand(0, S), y = rand(0, S), d = rand(1, 4);
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,250,235'},${rand(0.02, 0.09)})`; g.fillRect(x, y, d, d);
    h.fillStyle = `rgba(0,0,0,${rand(0.05, 0.3)})`; h.fillRect(x, y, d, d);
  }
  for (let k = 0; k < 40; k++) {   // rain streaks
    const x = rand(0, S), y = rand(0, S), len = rand(120, 420), grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(40,36,28,${rand(0.05, 0.16)})`); grad.addColorStop(1, 'rgba(40,36,28,0)');
    g.fillStyle = grad; g.fillRect(x, y, rand(6, 26), len);
  }
});
const stoneTex = texture(stoneColour), stoneNormal = texture(normalsFrom(stoneHeight, 2.2), false);

const shell = [];   // materials that fade when the walls go see-through
function stoneMat(ru, rv) {
  const map = stoneTex.clone(), normalMap = stoneNormal.clone();
  for (const t of [map, normalMap]) { t.repeat.set(ru, rv); t.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, envMapIntensity: 0.5 });
  shell.push(m);
  return m;
}

// Bell bronze: lathe rings, a darker inside, and green patina running down from the crown.
// A second picture carries roughness (green channel) and metalness (blue channel) for the same marks.
let bronzeSurface;
const bronzeColour = paint(512, (g, S) => {
  bronzeSurface = paint(S, (m) => { m.fillStyle = 'rgb(0,88,255)'; m.fillRect(0, 0, S, S); });
  const m = bronzeSurface.getContext('2d');
  g.fillStyle = '#b07a44'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(30,18,8,0.45)'; g.fillRect(0, 0, S, S * 0.5);   // top half of the picture is the inside of the bell
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,220,170' : '40,22,8'},${rand(0.02, 0.08)})`; g.fillRect(0, y, S, 2); }
  for (let k = 0; k < 70; k++) {   // patina: starts at the crown (bottom edge) and runs toward the lip (the middle)
    const x = rand(0, S), w = rand(8, 46), len = rand(0.08, 0.42) * S, a = rand(0.25, 0.7);
    for (const [ctx, rgb] of [[g, '104,150,128'], [m, '0,225,40']]) {
      const grad = ctx.createLinearGradient(0, S, 0, S - len);
      grad.addColorStop(0, `rgba(${rgb},${a})`); grad.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = grad;
      for (const wrap of [0, S, -S]) ctx.fillRect(x + wrap, S - len, w, len);
    }
  }
  for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(20,12,4,${rand(0.03, 0.12)})`; g.fillRect(rand(0, S), rand(0, S), rand(1, 3), rand(1, 3)); }
});
const bronzeTex = texture(bronzeColour), bronzeOrm = texture(bronzeSurface, false);

const woodTex = texture(paint(512, (g, S) => {   // floorboards
  for (let p = 0; p < 8; p++) {
    g.fillStyle = `hsl(${rand(26, 34)}, ${rand(30, 42)}%, ${rand(52, 64)}%)`; g.fillRect(p * 64, 0, 64, S);
    for (let k = 0; k < 26; k++) { g.fillStyle = `rgba(60,36,14,${rand(0.05, 0.18)})`; g.fillRect(p * 64 + rand(2, 60), 0, rand(1, 2.5), S); }
    g.fillStyle = 'rgba(20,10,4,0.55)'; g.fillRect(p * 64, 0, 2, S);
  }
}));
const copperTex = texture(paint(512, (g, S) => {   // weathered copper sheet with standing seams
  g.fillStyle = '#6aa696'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,90,80' : '170,215,200'},${rand(0.04, 0.14)})`; g.beginPath(); g.ellipse(rand(0, S), rand(0, S), rand(6, 40), rand(20, 120), 0, 0, 7); g.fill(); }
  for (let x = 0; x < S; x += 64) { g.fillStyle = 'rgba(20,50,45,0.55)'; g.fillRect(x, 0, 4, S); g.fillStyle = 'rgba(210,240,230,0.35)'; g.fillRect(x + 4, 0, 3, S); }
}), true, 3, 1);
const grassTex = texture(paint(512, (g, S) => {
  g.fillStyle = '#6f9150'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 9000; k++) { g.fillStyle = `hsla(${rand(78, 112)}, ${rand(28, 50)}%, ${rand(26, 50)}%, ${rand(0.15, 0.5)})`; g.fillRect(rand(0, S), rand(0, S), rand(1, 4), rand(2, 7)); }
  for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,60,20' : '170,190,110'},0.07)`; g.beginPath(); g.arc(rand(0, S), rand(0, S), rand(30, 110), 0, 7); g.fill(); }
}), true, 260, 260);
const pavingTex = texture(paint(1024, (g, S) => {   // setts laid in rings around the tower
  g.fillStyle = '#857d70'; g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  for (let r = S / 2 + 24; r > 0; r -= 24) {
    const n = Math.max(6, Math.round(r * 2 * Math.PI / 40)), turn = rand(0, 1);
    for (let k = 0; k < n; k++) {
      const a0 = (k + turn) / n * Math.PI * 2, a1 = a0 + Math.PI * 2 / n - 2.5 / r;
      g.fillStyle = `hsl(${rand(30, 42)}, ${rand(6, 14)}%, ${rand(58, 74)}%)`;
      g.beginPath(); g.arc(0, 0, r - 2, a0, a1); g.arc(0, 0, Math.max(0, r - 22), a1, a0, true); g.fill();
    }
  }
}));

const flat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.5, ...o });
const M = {
  wood: flat(0xb08a5c, { map: woodTex }), woodDark: flat(0x4a3622), woodLight: flat(0xd8b98a),
  steel: flat(0x2f3338, { metalness: 0.7, roughness: 0.45 }),
  dark: flat(0x1b1f26), copper: flat(0xffffff, { map: copperTex, roughness: 0.7, metalness: 0.25 }),
  cream: flat(0xf1e9d6), grass: flat(0xffffff, { map: grassTex, roughness: 1 }), paving: flat(0xffffff, { map: pavingTex, roughness: 0.9 }),
  leaf: [0x4f7a45, 0x5f8c4a, 0x44703f].map((c) => flat(c, { roughness: 1 })), person: flat(0x3d5a80), skin: flat(0xe0b996),
  trim: flat(0xc3baa5, { roughness: 0.9 }), hill: flat(0x56775c, { roughness: 1 }),
  glass: flat(0x16212e, { roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6 }),
  gold: flat(0xe6b450, { roughness: 0.25, metalness: 1, envMapIntensity: 1.4 }),
  bronze: new THREE.MeshStandardMaterial({ map: bronzeTex, roughnessMap: bronzeOrm, metalnessMap: bronzeOrm, color: 0xffffff, metalness: 1, roughness: 1,
    envMapIntensity: 1.5, side: THREE.DoubleSide, emissive: 0xffa030, emissiveIntensity: 0 }),
};

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function limb(a, b, r, mat, parent) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(A).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m); return m;
}

/* ───────────────────────── Grounds ───────────────────────── */

{
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1300, 64), M.grass);
  ground.rotation.x = -Math.PI / 2; ground.userData.noCast = true; scene.add(ground);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 64), M.paving);
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.03; plaza.userData.noCast = true; scene.add(plaza);

  // Trees: a trunk and a few overlapping lumpy crowns each
  const lump = new THREE.SphereGeometry(1, 12, 9), lp = lump.attributes.position;
  for (let k = 0; k < lp.count; k++) {
    const x = lp.getX(k), y = lp.getY(k), z = lp.getZ(k), f = 1 + 0.16 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 + y * 2.1);
    lp.setXYZ(k, x * f, y * f, z * f);
  }
  lump.computeVertexNormals();
  for (let k = 0; k < 34; k++) {
    const a = k * 2.399 + 0.6, r = 24 + (k * 37 % 52);
    if (Math.abs(Math.atan2(Math.sin(a - 0.6), Math.cos(a - 0.6))) < 0.35) continue; // keep the approach clear
    const s = 0.8 + (k * 13 % 7) / 9, x = Math.sin(a) * r, z = Math.cos(a) * r;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.38 * s, 3.4 * s, 8), M.woodDark);
    trunk.position.set(x, 1.7 * s, z); scene.add(trunk);
    for (let j = 0; j < 5; j++) {
      const crown = new THREE.Mesh(lump, M.leaf[(k + j) % 3]), w = (j ? rand(1.3, 1.9) : 2.3) * s;
      crown.position.set(x + (j ? rand(-1.5, 1.5) * s : 0), (j ? rand(3.6, 6.2) : 4.8) * s, z + (j ? rand(-1.5, 1.5) * s : 0));
      crown.scale.set(w, w * rand(0.85, 1.15), w); crown.rotation.y = rand(0, 6); scene.add(crown);
    }
  }

  // Far hills, softened by the haze
  const dome = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let k = 0; k < 40; k++) {
    const a = k / 40 * Math.PI * 2 + rand(-0.1, 0.1), r = rand(520, 1050);
    const hill = new THREE.Mesh(dome, M.hill);
    hill.position.set(Math.sin(a) * r, -4, Math.cos(a) * r); hill.scale.set(rand(200, 420), rand(18, 60) * r / 600, rand(200, 420));
    hill.userData.noCast = true; scene.add(hill);
  }

  // Clouds: soft painted puffs on sheets that face the tower
  const sheet = new THREE.PlaneGeometry(1, 1);
  const puff = texture(paint(256, (g) => {
    for (let k = 0; k < 16; k++) {
      const x = rand(60, 196), y = rand(105, 150), r = rand(26, 58), grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    }
  }));
  for (let k = 0; k < 18; k++) {
    const a = rand(0, Math.PI * 2), r = rand(700, 1700);
    const cloud = new THREE.Mesh(sheet, new THREE.MeshBasicMaterial({ map: puff, color: 0xfff4e6, transparent: true, opacity: rand(0.55, 0.9), fog: false, depthWrite: false }));
    cloud.position.set(Math.sin(a) * r, rand(220, 520), Math.cos(a) * r); cloud.scale.set(rand(380, 760), rand(150, 260), 1);
    cloud.lookAt(0, 40, 0); cloud.isLine = true; cloud.userData.noCast = true;   // "line" keeps it out of the contact-shading pass; it still draws as a surface
    scene.add(cloud);
  }

  // A visitor by the door, for scale
  const p = new THREE.Group(); p.position.set(2.6, 0, 7.5); scene.add(p);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 10), M.person); body.position.y = 0.85; p.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), M.skin); head.position.y = 1.62; p.add(head);
}

/* ───────────────────────── Tower ───────────────────────── */

const decor = new THREE.Group(); scene.add(decor);   // surface details hidden in see-through mode
let hourHand, minuteHand;
{
  const inner = 2 * (HALF - WALL);
  // Shaft: four slabs so the inside faces exist for the stairwell view
  for (const s of [1, -1]) {
    box(2 * HALF, SHAFT_H, WALL, stoneMat(4.5, 18), 0, SHAFT_H / 2, s * (HALF - WALL / 2));
    box(WALL, SHAFT_H, inner, stoneMat(3.7, 18), s * (HALF - WALL / 2), SHAFT_H / 2, 0);
  }
  const total = BELFRY_Y + BELFRY_H;
  for (const sx of [1, -1]) for (const sz of [1, -1])
    box(1, total, 1, stoneMat(0.5, total / 2), sx * (HALF - 0.4), total / 2, sz * (HALF - 0.4));

  // Belfry: each side is a wall pierced by two lancet openings
  const shape = new THREE.Shape();
  shape.moveTo(-HALF, 0); shape.lineTo(HALF, 0); shape.lineTo(HALF, BELFRY_H); shape.lineTo(-HALF, BELFRY_H); shape.closePath();
  for (const cx of [-2.1, 2.1]) {
    const h = new THREE.Path();
    h.moveTo(cx - 1.3, 1); h.lineTo(cx + 1.3, 1); h.lineTo(cx + 1.3, 6.5);
    h.quadraticCurveTo(cx + 1.3, 8.2, cx, 8.8); h.quadraticCurveTo(cx - 1.3, 8.2, cx - 1.3, 6.5); h.closePath();
    shape.holes.push(h);
  }
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: WALL, bevelEnabled: false, curveSegments: 10 });
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group(); g.rotation.y = k * Math.PI / 2; scene.add(g);
    const m = new THREE.Mesh(wallGeo, stoneMat(0.5, 0.5));
    m.position.set(0, BELFRY_Y, HALF - WALL); g.add(m);
  }

  // Floors
  box(inner, 0.3, inner, M.wood, 0, CABIN_Y - 0.15, 0);
  box(2 * HALF + 0.5, 0.4, 2 * HALF + 0.5, stoneMat(4.7, 0.2), 0, BELFRY_Y - 0.2, 0);   // string course + belfry floor

  // Roof: a cornice, an eight-sided copper spire with a gilded finial, and four corner pinnacles
  box(2 * HALF + 0.6, 0.5, 2 * HALF + 0.6, M.trim, 0, total + 0.25, 0);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(5.2, 17, 8), M.copper);
  spire.rotation.y = Math.PI / 8; spire.position.y = total + 0.5 + 8.5; scene.add(spire);
  const tip = total + 17.5;
  limb([0, tip - 0.6, 0], [0, tip + 1.9, 0], 0.05, M.gold, scene);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 14), M.gold); ball.position.y = tip + 0.2; scene.add(ball);
  box(1.3, 0.07, 0.03, M.gold, 0.1, tip + 1.55, 0);   // weathervane
  box(0.3, 0.34, 0.03, M.gold, -0.5, tip + 1.55, 0);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    box(1.0, 0.9, 1.0, M.trim, sx * 4.3, total + 0.95, sz * 4.3);
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.6, 8), M.copper);
    pin.position.set(sx * 4.3, total + 3.2, sz * 4.3); scene.add(pin);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), M.gold); knob.position.set(sx * 4.3, total + 5.05, sz * 4.3); scene.add(knob);
  }

  // Stairs hugging the walls around an open well
  const steps = 169;
  const stairs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.12, 1.1), M.wood, steps);
  const mat4 = new THREE.Matrix4(), rot = new THREE.Matrix4();
  for (let n = 0; n < steps; n++) {
    const side = Math.floor(n / 21) % 4, k = n % 21;
    rot.makeRotationY(side * Math.PI / 2);
    mat4.makeTranslation(-3.15 + (k + 0.5) * 0.3, 0.18 * (n + 1), 3.15).premultiply(rot);
    stairs.setMatrixAt(n, mat4);
  }
  scene.add(stairs);

  // Surface details: all outside the walls, and hidden in see-through mode
  const band = (y, h, out, mat = M.trim) => {   // a course of stone that runs round the tower, proud of the wall
    for (const s of [1, -1]) {
      box(2 * (HALF + out), h, out, mat, 0, y, s * (HALF + out / 2), decor);
      box(out, h, 2 * HALF, mat, s * (HALF + out / 2), y, 0, decor);
    }
  };
  band(12, 0.4, 0.16); band(24, 0.4, 0.16); band(BELFRY_Y + 0.25, 0.5, 0.3); band(total - 0.35, 0.7, 0.32); band(total - 1.0, 0.35, 0.16);
  // Plinth, with a gap for the door, and steps up to it
  box(2 * HALF + 1, 1.7, 0.5, stoneMat(5, 0.85), 0, 0.85, -(HALF + 0.25), decor);
  for (const s of [1, -1]) {
    box(0.5, 1.7, 2 * HALF, stoneMat(4.5, 0.85), s * (HALF + 0.25), 0.85, 0, decor);
    box(3.95, 1.7, 0.5, stoneMat(2, 0.85), s * 3.025, 0.85, HALF + 0.25, decor);
  }
  band(1.78, 0.16, 0.56);
  box(3.4, 0.14, 2.0, M.trim, 0, 0.07, HALF + 1.2, decor); box(2.6, 0.14, 1.2, M.trim, 0, 0.21, HALF + 0.8, decor);
  // Corner buttresses that step in as they rise
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    box(1.5, 12, 1.5, stoneMat(0.75, 6), sx * HALF, 6, sz * HALF, decor);
    box(1.3, 12, 1.3, stoneMat(0.65, 6), sx * HALF, 18, sz * HALF, decor);
    box(1.6, 0.25, 1.6, M.trim, sx * HALF, 12.1, sz * HALF, decor); box(1.4, 0.25, 1.4, M.trim, sx * HALF, 24.1, sz * HALF, decor);
  }
  // Door under a stone arch
  box(1.7, 2.9, 0.12, M.woodDark, 0, 1.45, HALF + 0.02, decor);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24, 0, Math.PI), M.woodDark); fan.position.set(0, 2.9, HALF + 0.08); decor.add(fan);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.17, 10, 24, Math.PI), M.trim); arch.position.set(0, 2.9, HALF + 0.05); decor.add(arch);
  for (const s of [1, -1]) box(0.26, 2.9, 0.3, M.trim, s * 0.98, 1.45, HALF + 0.1, decor);
  // Windows: dark glass set in dressed stone
  const win = (x, y, w, h, g) => {
    box(w, h, 0.06, M.glass, x, y, HALF + 0.03, g);
    box(w + 0.5, 0.16, 0.34, M.trim, x, y - h / 2 - 0.08, HALF + 0.13, g);
    box(w + 0.44, 0.24, 0.26, M.trim, x, y + h / 2 + 0.12, HALF + 0.1, g);
    for (const s of [1, -1]) box(0.17, h, 0.2, M.trim, x + s * (w / 2 + 0.085), y, HALF + 0.08, g);
    box(0.05, h, 0.1, M.dark, x, y, HALF + 0.06, g); box(w, 0.05, 0.1, M.dark, x, y + h * 0.18, HALF + 0.06, g);
  };
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group(); g.rotation.y = k * Math.PI / 2; decor.add(g);
    for (const y of [7, 14.6, 20.6]) win(0, y, 0.7, 2.3, g);
    for (const x of [-1.5, 1.5]) win(x, CABIN_Y + 2, 1.0, 1.7, g);
    for (const cx of [-2.1, 2.1]) box(3.0, 0.22, 0.36, M.trim, cx, BELFRY_Y + 0.95, HALF + 0.1, g);   // sills of the belfry openings
  }
  // Clock: cream dial, gilded bezel and hour marks
  const face = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.12, 48), M.cream);
  face.rotation.x = Math.PI / 2; face.position.set(0, 26.5, HALF + 0.05); decor.add(face);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.11, 10, 48), M.gold);
  ring.position.set(0, 26.5, HALF + 0.1); decor.add(ring);
  for (let k = 0; k < 12; k++) {
    const g = new THREE.Group(); g.position.set(0, 26.5, HALF + 0.12); g.rotation.z = k * Math.PI / 6; decor.add(g);
    box(k % 3 ? 0.07 : 0.12, k % 3 ? 0.28 : 0.4, 0.03, M.gold, 0, 1.5, 0, g);
  }
  const hand = (len, w) => {
    const g = new THREE.Group(); g.position.set(0, 26.5, HALF + 0.14); decor.add(g);
    box(w, len, 0.04, M.dark, 0, len / 2 - 0.15, 0, g); return g;
  };
  hourHand = hand(1.05, 0.14); minuteHand = hand(1.6, 0.09);
  const setClock = () => {
    const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    minuteHand.rotation.z = -m / 60 * Math.PI * 2; hourHand.rotation.z = -h / 12 * Math.PI * 2;
  };
  setClock(); setInterval(setClock, 10000);

  // Lamps
  const lamp = new THREE.PointLight(0xffd9a0, 90, 14); lamp.position.set(0, CABIN_Y + 3.6, 1.2); scene.add(lamp);
  const lamp2 = new THREE.PointLight(0xfff0d8, 110, 18); lamp2.position.set(0, BELFRY_Y + 1.2, 0); scene.add(lamp2);
}

/* ───────────────────────── Bells ───────────────────────── */

// Outer profile as [radius / mouth radius, depth below crown / height]
const PROFILE = [[0, 0], [0.22, 0], [0.42, 0.03], [0.5, 0.1], [0.52, 0.25], [0.56, 0.45], [0.64, 0.63], [0.76, 0.78], [0.9, 0.9], [0.98, 0.96], [1, 1]];
const REST = 0.3, STRIKE = 0.46;   // clapper angles, radians
const bellMeshes = [];

/* The transmission. A wire rises from each baton to a bell crank in the rack (an L-shaped lever on a pivot), which turns the
   pull sideways. A second crank beside the bell sends it up, and a third pulls the clapper's tail sideways into the bronze.
   Each bell's clapper is turned to face its own crank, and the crank stands where its wire clears the bells and beams below. */
const ARM = 0.11, WIRE_Z = CONSOLE_Z - 0.02, UP = new THREE.Vector3(0, 1, 0);
{
  const levels = [...new Set(bells.map((b) => b.crownY))];
  const ANGLES = [0, Math.PI, 0.5, -0.5, Math.PI - 0.5, Math.PI + 0.5, 1, -1, Math.PI - 1, Math.PI + 1, Math.PI / 2, -Math.PI / 2];   // along the beam first
  for (const b of bells) {
    const reach = b.D / 2 * 1.12 + ARM + 0.06;
    const lower = bells.filter((o) => o.crownY < b.crownY), same = bells.filter((o) => o !== b && o.crownY === b.crownY), beams = [...new Set(lower.map((o) => o.z))];
    let best = null;
    for (const a of ANGLES) {
      const px = b.x + Math.cos(a) * reach, pz = b.z + Math.sin(a) * reach;
      let clear = Math.min(3.4 - Math.abs(px), 3.4 - Math.abs(pz));
      for (const o of lower) clear = Math.min(clear, Math.hypot(px - o.x, pz - o.z) - o.D / 2 - 0.05);
      for (const o of same) clear = Math.min(clear, Math.hypot(px - o.x, pz - o.z) - o.D / 2 - 0.03);
      for (const z of beams) clear = Math.min(clear, Math.abs(pz - z) - 0.16);
      if (!best || clear > best.clear) best = { a, clear, px, pz };
      if (clear > 0) { best = { a, clear, px, pz }; break; }
    }
    const tier = levels.indexOf(b.crownY), nth = same.filter((o) => o.i < b.i).length;
    b.pull = best.a; b.px = best.px; b.pz = best.pz;
    b.rackY = RACK_Y + 0.2 * tier + 0.013 * nth;   // every run has its own height, so no two wires cross
  }
}
const armGeo = new THREE.BoxGeometry(ARM, 0.024, 0.024).translate(ARM / 2, 0, 0), armGeo2 = new THREE.BoxGeometry(0.024, ARM, 0.024).translate(0, ARM / 2, 0);
const pinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10).rotateX(Math.PI / 2), pullGeo = new THREE.CylinderGeometry(0.007, 0.007, 1, 6);
const brass = flat(0xc79a4a, { metalness: 0.9, roughness: 0.35, envMapIntensity: 1.2 });
// A bell crank at corner K of a wire that arrives travelling along u and leaves along v. The wire stops one arm short of the
// corner and starts again one arm after it; the crank's two arms bridge the gap from a pivot set diagonally inside the corner.
function crank(K, u, v) {
  const g = new THREE.Group(), X = v.clone().negate();
  g.position.copy(K).addScaledVector(v, ARM).addScaledVector(u, -ARM);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, u, new THREE.Vector3().crossVectors(X, u)));
  g.add(new THREE.Mesh(armGeo, brass), new THREE.Mesh(armGeo2, brass), new THREE.Mesh(pinGeo, M.steel));
  scene.add(g);
  return { g, base: g.quaternion.clone(), P: g.position, E1: K.clone().addScaledVector(u, -ARM), E2: K.clone().addScaledVector(v, ARM) };
}
const tailAt = (b, angle, out) => out.set(b.x + Math.sin(angle) * b.Lt * Math.cos(b.pull), b.crownY - 0.1 * b.H - Math.cos(angle) * b.Lt, b.z + Math.sin(angle) * b.Lt * Math.sin(b.pull));
const pullEnd = new THREE.Vector3(), pullDir = new THREE.Vector3();
function setPull(b, angle) {   // the last, sideways wire follows the clapper's tail as it swings
  tailAt(b, angle, pullEnd); pullDir.copy(pullEnd).sub(b.cranks[2].E2);
  const len = pullDir.length();
  b.pullWire.position.copy(b.cranks[2].E2).addScaledVector(pullDir, 0.5);
  b.pullWire.quaternion.setFromUnitVectors(UP, pullDir.divideScalar(len)); b.pullWire.scale.y = len;
}
// Called once the baton exists: builds the three cranks, the wire between them and their supports
function rig(b, from) {
  const d = new THREE.Vector3(Math.cos(b.pull), 0, Math.sin(b.pull)), tail = tailAt(b, REST, new THREE.Vector3());
  const KA = new THREE.Vector3(from.x, b.rackY, WIRE_Z), KB = new THREE.Vector3(b.px, b.rackY, b.pz), KC = new THREE.Vector3(b.px, tail.y, b.pz);
  const along = KB.clone().sub(KA).normalize();
  b.cranks = [crank(KA, UP, along), crank(KB, along, UP), crank(KC, UP, d.clone().negate())];
  b.corners = [KA, KB, KC];
  const [A, B, C] = b.cranks;
  b.wireMat = new LineMaterial({ color: WIRE_IDLE, linewidth: 1.3 });
  scene.add(new LineSegments2(new LineSegmentsGeometry().setPositions([from, A.E1, A.E2, B.E1, B.E2, C.E1].flatMap((p) => [p.x, p.y, p.z])), b.wireMat));
  b.pullMat = new THREE.MeshBasicMaterial({ color: WIRE_IDLE });
  b.pullWire = new THREE.Mesh(pullGeo, b.pullMat); scene.add(b.pullWire); setPull(b, REST);
  // Supports: a post from the belfry floor under the second crank, and a hanger from the bell's own beam for the third
  limb([B.P.x, BELFRY_Y, B.P.z], [B.P.x, B.P.y, B.P.z], 0.012, M.steel, scene);
  const beamY = b.crownY + 0.21;
  limb([C.P.x, C.P.y, C.P.z], [C.P.x, beamY, C.P.z], 0.012, M.steel, scene);
  if (Math.abs(C.P.z - b.z) > 0.02) limb([C.P.x, beamY, C.P.z], [C.P.x, beamY, b.z], 0.012, M.steel, scene);
}

for (const b of bells) {
  const R = b.D / 2, H = b.H;
  const pts = PROFILE.map(([r, y]) => new THREE.Vector2(r * R, -y * H));
  for (let k = PROFILE.length - 1; k >= 0; k--) pts.push(new THREE.Vector2(PROFILE[k][0] * R * 0.88, -0.05 * H - PROFILE[k][1] * H * 0.95));
  const g = new THREE.Group(); g.position.set(b.x, b.crownY, b.z); scene.add(g);
  b.mat = M.bronze.clone();
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), b.mat);
  mesh.userData.i = b.i; g.add(mesh); bellMeshes.push(mesh);
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * b.D, 0.1 * b.D, 0.12, 12), M.steel);
  hanger.position.y = 0.06; g.add(hanger);

  // The clapper: a rod with the striking ball inside the bell and a tail that reaches below the lip, where the wire pulls it
  b.L = 0.78 * H; b.Lt = (0.9 * H + 0.05 + 0.05 * b.D) / Math.cos(REST);
  const turn = new THREE.Group(); turn.position.y = -0.1 * H; turn.rotation.y = -b.pull; g.add(turn);   // swing toward this bell's crank
  b.clapper = new THREE.Group(); b.clapper.rotation.z = REST; turn.add(b.clapper);
  limb([0, 0, 0], [0, -b.Lt, 0], 0.012 * b.D + 0.004, M.steel, b.clapper);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07 * b.D, 14, 10), M.steel);
  ball.position.y = -b.L; b.clapper.add(ball);
  b.ballPos = new THREE.Vector3(b.x + Math.sin(REST) * b.L * Math.cos(b.pull), b.crownY - 0.1 * H - Math.cos(REST) * b.L, b.z + Math.sin(REST) * b.L * Math.sin(b.pull));
}
for (const tier of TIERS) {
  const rows = tier.count / tier.cols;
  for (let r = 0; r < rows; r++)
    box(2 * (HALF - WALL), 0.18, 0.22, M.steel, 0, tier.crownY + 0.21, ((rows - 1) / 2 - r) * tier.spacing);
}

/* ───────────────────────── Playing cabin ───────────────────────── */

const WIRE_IDLE = new THREE.Color(0x3c3f45), WIRE_HOT = new THREE.Color(0xffc45e).multiplyScalar(6);   // bright enough to bloom
{
  const con = new THREE.Group(); con.position.set(0, CABIN_Y, CONSOLE_Z); scene.add(con);
  for (const s of [1, -1]) box(0.08, 2.3, 0.5, M.woodDark, s * 1.2, 1.15, 0, con);
  box(2.48, 0.08, 0.5, M.woodDark, 0, 2.3, 0, con);
  box(2.4, 0.1, 0.3, M.wood, 0, 0.88, 0, con);
  box(2.4, 0.5, 0.06, M.wood, 0, 1.45, -0.1, con);
  box(1.5, 0.06, 0.5, M.wood, 0, 0.1, 0.28, con);

  for (const b of bells) {
    const sharp = SHARP.includes(b.i % 12), x = (b.i - 18) * 0.058;
    const len = sharp ? 0.2 : 0.3;
    b.baton = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 10), sharp ? M.woodDark : M.woodLight);
    b.baton.rotation.x = Math.PI / 2;
    b.batonY = sharp ? 1.09 : 0.98;
    b.baton.position.set(x, b.batonY, 0.05 + len / 2); con.add(b.baton);
    if (b.i < 18) {   // pedals double the lowest octave and a half
      b.pedalY = sharp ? 0.26 : 0.18;
      b.pedal = box(0.035, 0.035, sharp ? 0.24 : 0.34, sharp ? M.woodDark : M.woodLight, (b.i - 8.5) * 0.075, b.pedalY, sharp ? 0.2 : 0.3, con);
    }
    rig(b, new THREE.Vector3(x, CABIN_Y + b.batonY, WIRE_Z));
  }
  // The rack that carries the first row of cranks: one rail for each tier of bells
  for (let t = 0; t < TIERS.length; t++) box(2.5, 0.035, 0.035, M.steel, 0, RACK_Y + 0.2 * t - ARM - 0.04, WIRE_Z - 0.03);
  for (const sx of [1, -1]) box(0.04, RACK_Y + 0.6 - BELFRY_Y, 0.04, M.steel, sx * 1.25, (RACK_Y + 0.6 + BELFRY_Y) / 2 - 0.1, WIRE_Z - 0.03);

  // Bench and carillonneur
  box(1.4, 0.06, 0.4, M.wood, 0, 0.62, 0.85, con);
  for (const s of [1, -1]) box(0.06, 0.6, 0.36, M.woodDark, s * 0.62, 0.3, 0.85, con);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), M.person);
  torso.position.set(0, 1.02, 0.85); con.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), M.skin);
  head.position.set(0, 1.5, 0.83); con.add(head);
  for (const s of [1, -1]) {
    limb([s * 0.2, 1.27, 0.82], [s * 0.3, 1.03, 0.52], 0.045, M.person, con);
    limb([s * 0.3, 1.03, 0.52], [s * 0.26, 1.02, 0.36], 0.04, M.skin, con);
    limb([s * 0.1, 0.7, 0.8], [s * 0.14, 0.62, 0.48], 0.065, M.dark, con);
    limb([s * 0.14, 0.62, 0.48], [s * 0.14, 0.24, 0.36], 0.055, M.dark, con);
  }
}

/* ───────────────────────── Sound ───────────────────────── */

const PARTIALS = [
  { key: 'hum', r: 0.5, a: 0.5, d: 1.0 },
  { key: 'prime', r: 1, a: 0.7, d: 0.6 },
  { key: 'tierce', r: 2 ** (3 / 12), a: 0.55, d: 0.45 },
  { key: 'quint', r: 1.5, a: 0.2, d: 0.3 },
  { key: 'nominal', r: 2, a: 0.6, d: 0.35 },
  { r: 3, a: 0.22, d: 0.16 },
  { r: 4, a: 0.16, d: 0.1 },
  { r: 5.33, a: 0.08, d: 0.06 },
];
const MAJOR_TIERCE = 2 ** (4 / 12);
let ctx, master, noise, majorThird = false, volume = 1;
try { volume = +(localStorage.getItem('carillon-volume') ?? 1); } catch (err) { /* private window */ }

function audio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
  master = ctx.createGain(); master.gain.value = 0.45 * volume;
  // Short synthetic reverb for the stone tower
  const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len) ** 3;
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.2;
  master.connect(comp); master.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
  return ctx;
}

function ring(i, vel = 0.8, only = null) {
  audio();
  const b = typeof i === 'number' ? bells[i] : i, t = ctx.currentTime;   // a bell index, or any { f }
  const T = 14 * (F0 / b.f) ** 0.7;        // big bells ring for much longer
  for (const p of PARTIALS) {
    if (only && p.key !== only) continue;
    const ratio = p.key === 'tierce' && majorThird ? MAJOR_TIERCE : p.r;
    const f = b.f * ratio;
    if (f > 9000) continue;
    const dur = only ? Math.max(3, T * p.d * 1.4) : T * p.d;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((only ? 0.6 : p.a * vel) * 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  if (!only) {   // the metallic click of clapper on bronze
    const s = ctx.createBufferSource(); s.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, b.f * 6); bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    s.connect(bp).connect(g).connect(master); s.start(t);
  }
}

function play(i, vel = 0.8, hold = 160) {
  if (i < 0 || i >= N) return;
  ring(i, vel);
  const b = bells[i]; b.hitAt = performance.now(); b.vel = vel;
  for (const el of [keyEls[i], pedEls[i]]) if (el) { el.classList.add('down'); setTimeout(() => el.classList.remove('down'), hold); }
}

/* ───────────────────────── Tunes ───────────────────────── */

// Notes are written like "e4 g#4*2 bb3 r": name, octave, then *beats (1 if left out); r is a rest and | is only for the eye
const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function notes(str, beat, m, start = 0, v = 0.8, shift = 0) {
  const ev = []; let t = start;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const x = /^([a-gr])([#b]?)(\d?)(?:\*([\d.]+))?$/.exec(tok);
    if (x[1] !== 'r') ev.push({ t: t * beat, n: SEMI[x[1]] + (x[2] === '#' ? 1 : x[2] === 'b' ? -1 : 0) + (x[3] - 3) * 12 + shift, v, m });
    t += +(x[4] || 1);
  }
  return ev;
}
// m marks the melody: the notes that fall for the player in "Play along". The tower plays the rest itself.
const FRERE = 'f4 g4 a4 f4 | f4 g4 a4 f4 | a4 bb4 c5*2 | a4 bb4 c5*2 | c5*.5 d5*.5 c5*.5 bb4*.5 a4 f4 | c5*.5 d5*.5 c5*.5 bb4*.5 a4 f4 | f4 c4 f4*2 | f4 c4 f4*2';
const TUNES = {
  westminster: {
    name: 'Westminster chimes', about: 'Four bells in four orders, then the hour on the biggest bell. Most tower clocks play this by machine.',
    ev: () => [...notes('c4 e4 d4 g3*2 | c4 d4 e4 c4*2 | e4 c4 d4 g3*2 | g3 d4 e4 c4*2', 0.75, true),
      ...notes('c3*2.7 c3*2.7 c3', 0.75, true, 21, 1)],
  },
  ode: {
    name: 'Ode to Joy', about: 'The low bells mark each bar. A carillonneur would play them with the feet.',
    ev: () => [...notes('e4 e4 f4 g4 | g4 f4 e4 d4 | c4 c4 d4 e4 | e4*1.5 d4*.5 d4*2 | e4 e4 f4 g4 | g4 f4 e4 d4 | c4 c4 d4 e4 | d4*1.5 c4*.5 c4*2', 0.5, true),
      ...notes('c3*4 g3*4 c3*4 c3*2 g3*2 | c3*4 g3*4 c3*4 g3*2 c3*2', 0.5, false, 0, 0.7)],
  },
  frere: {
    name: 'Frère Jacques', about: 'A round: the low bells play the same tune two bars behind you. With no dampers, the two voices blur into chords.',
    ev: () => [...notes(FRERE, 0.45, true), ...notes(FRERE, 0.45, false, 8, 0.65, -12)],
  },
  greensleeves: {
    name: 'Greensleeves', about: 'A tune in a minor key. It suits bells, because every bell already carries a minor third inside it.',
    ev: () => [...notes('a4 | c5*2 d5 | e5*1.5 f#5*.5 e5 | d5*2 b4 | g4*1.5 a4*.5 b4 | c5*2 a4 | a4*1.5 g#4*.5 a4 | b4*2 g#4 | e4*2 a4 | c5*2 d5 | e5*1.5 f#5*.5 e5 | d5*2 b4 | g4*1.5 a4*.5 b4 | c5*1.5 b4*.5 a4 | g#4*1.5 f#4*.5 g#4 | a4*3', 0.34, true),
      ...notes('r a3*3 a3*3 g3*3 g3*3 a3*3 a3*3 e3*3 e3*3 a3*3 a3*3 g3*3 g3*3 a3*3 e3*3 a3*3', 0.34, false, 0, 0.6)],
  },
  sweep: {
    name: 'All 37 bells', about: 'From the smallest bell down to the bourdon.', listenOnly: true,
    ev: () => bells.map((b) => ({ t: (N - 1 - b.i) * 0.17, n: b.i, v: 0.75 })),
  },
};

// One engine plays a tune and drops its notes down the lane above the batons.
// Listening runs on the clock. Playing along waits at each melody note until the player strikes it.
const touchy = matchMedia('(pointer: coarse)').matches;
const lane = document.createElement('div'); lane.id = 'lane'; lane.setAttribute('aria-hidden', 'true');
// The tune menu is on the Play a tune button at every stop of the tour, not only the last one
const tuneRows = `<div class="tunes">${Object.entries(TUNES).map(([id, T]) => `<div><span>${T.name}</span><button class="btn" data-tune="${id}">Listen</button>${T.listenOnly ? '' : `<button class="btn primary" data-along="${id}">Play along</button>`}</div>`).join('')}</div>`;
const tunesBtn = document.getElementById('tunesBtn'), tunePop = document.getElementById('tunePop');
tunePop.innerHTML = tuneRows + '<p id="tuneNote" aria-live="polite">Listen, or play along: the notes fall onto the batons and the tower waits for you.</p>';
const openTunes = (on) => { tunePop.classList.toggle('on', on); tunesBtn.setAttribute('aria-expanded', on); };
tunesBtn.onclick = () => { if (song) return stopTune(); document.getElementById('more').classList.remove('on'); openTunes(!tunePop.classList.contains('on')); };
tunePop.addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  startSong(btn.dataset.along || btn.dataset.tune, !!btn.dataset.along);
});
const FALL = 62;   // pixels a note falls per second
let tuneTimers = [], song = null;
function stopTune() {
  tuneTimers.forEach(clearTimeout); tuneTimers = [];
  tunesBtn.textContent = '♪ Play a tune';
  if (!song) return;
  song.want?.classList.remove('want'); song = null;
  lane.replaceChildren(); document.body.classList.remove('song'); layout();
}
function startSong(id, along) {
  stopTune(); audio(); game = null;
  const ev = TUNES[id].ev().sort((a, b) => a.t - b.t);
  song = { id, along, ev, pos: -1.6, last: performance.now(), hitT: -1, slips: 0, want: null };
  for (const e of ev) {
    e.el = document.createElement('div');
    e.el.className = 'fall' + (along && !e.m ? ' acc' : '');
    e.el.style.left = keyEls[e.n].style.left; e.el.style.width = keyEls[e.n].style.width;
    if (along && e.m) e.el.textContent = touchy ? bells[e.n].name : HINT[e.n] ?? '';   // a phone has no keys to name, so name the note
    lane.appendChild(e.el);
  }
  document.body.classList.add('song'); layout();
  tunesBtn.textContent = '■ Stop the tune'; tunePop.classList.remove('on'); tunesBtn.setAttribute('aria-expanded', false);
  gameStatus(along ? 'Strike each bronze note as it reaches the line. The tower waits for you and plays the grey notes itself.' : TUNES[id].about);
}
function tickSong(now) {
  const s = song, dt = Math.min(0.1, (now - s.last) / 1000); s.last = now;
  const next = s.along ? s.ev.find((e) => e.m && !e.done) : null;
  s.pos = Math.min(next ? next.t : Infinity, s.pos + dt);
  for (const e of s.ev) {
    if (!e.done && !(s.along && e.m) && (s.along ? e.t < s.pos || e.t <= s.hitT : e.t <= s.pos)) { e.done = true; play(e.n, e.v); }
    const y = (e.t - s.pos) * FALL;
    e.el.style.display = e.done || y > lane.clientHeight ? 'none' : '';
    e.el.style.transform = `translateY(${-y}px)`;
  }
  const want = next && next.t - s.pos < 0.01 ? keyEls[next.n] : null;   // light the baton the lane is waiting for
  if (want !== s.want) {
    s.want?.classList.remove('want'); want?.classList.add('want'); s.want = want;
    const strip = $('kbwrap');   // on a phone the batons scroll sideways: bring the wanted one into view
    if (want && strip.scrollWidth > strip.clientWidth + 4) strip.scrollTo({ left: want.offsetLeft - strip.clientWidth / 2, behavior: calm ? 'auto' : 'smooth' });
  }
  if (s.ev.every((e) => e.done) && s.pos > s.ev[s.ev.length - 1].t + 1.2) {
    const n = s.ev.filter((e) => e.m).length, T = TUNES[s.id];
    stopTune();
    gameStatus(s.along ? `${T.name}: ${n} notes, ${s.slips ? s.slips + (s.slips === 1 ? ' slip' : ' slips') : 'no slips'}. ${T.about}` : T.about);
  }
}
function songStrike(i) {   // the player struck bell i during a play-along
  const next = song.ev.find((e) => e.m && !e.done);
  if (!next) return;
  if (next.n === i) { next.done = true; song.hitT = next.t; song.pos = Math.max(song.pos, next.t); }
  else if (next.t - song.pos < 1.5) { song.slips++; gameStatus(`That was ${bells[i].name}. The lane is waiting for ${bells[next.n].name}${HINT[next.n] ? `, key ${HINT[next.n].toUpperCase()}` : ''}.`); }
}

/* ───────────────────────── Echo game ───────────────────────── */

const GAME_NOTES = [12, 14, 16, 17, 19, 21, 23, 24];   // the white batons C4–C5
let game = null;
const gameStatus = (t) => { for (const id of ['game', 'tuneNote']) { const el = document.getElementById(id); if (el) el.textContent = t; } };
function gameRound() {
  const g = game;
  g.seq.push(GAME_NOTES[Math.floor(Math.random() * GAME_NOTES.length)]); g.pos = 0; g.listening = false;
  gameStatus(`Round ${g.seq.length}: listen…`);
  stopTune();
  tuneTimers = g.seq.map((n, k) => setTimeout(() => play(n, 0.85, 420), 700 + k * 650));
  tuneTimers.push(setTimeout(() => {
    if (game === g) { g.listening = true; gameStatus(`Round ${g.seq.length}: your turn. Play it back.`); }
  }, 700 + g.seq.length * 650));
}
function gameStart() { game = { seq: [], pos: 0, listening: false }; gameRound(); }

// Everything the user plays goes through here
function userPlay(i, vel = 0.85) {
  play(i, vel); select(i);
  if (song?.along) return songStrike(i);
  if (!game || !game.listening) return;
  if (i === game.seq[game.pos]) {
    if (++game.pos < game.seq.length) return;
    game.listening = false; gameStatus('Right!');
    const g = game; tuneTimers.push(setTimeout(() => { if (game === g) gameRound(); }, 900));
  } else {
    gameStatus(`That was ${bells[i].name}; the bell was ${bells[game.seq[game.pos]].name}. You echoed ${game.seq.length - 1} in a row.`);
    game = null;
  }
}

/* ───────────────────────── On-screen baton keyboard ───────────────────────── */

const KEYS = {};
'zsxdcvgbhnjm'.split('').forEach((k, n) => KEYS[k] = n);
Object.assign(KEYS, { ',': 12, l: 13, '.': 14, ';': 15, '/': 16 });
'q2w3er5t6y7ui9o0p'.split('').forEach((k, n) => KEYS[k] = 12 + n);
Object.assign(KEYS, { '[': 29, '=': 30, ']': 31 });
const SHIFTED = { '<': ',', '>': '.', ':': ';', '?': '/', '@': '2', '#': '3' };   // what Shift turns the low keys into
const HINT = {};
for (const [k, n] of Object.entries(KEYS)) if (!(n in HINT) || 'q2w3e'.includes(k)) HINT[n] = k;

const kb = document.getElementById('kb'), keyEls = [], pedEls = [];
kb.appendChild(lane);
const PEDALS = 18;   // C3–F4, the same bells as the lowest batons
{
  const W = 100 / 22; let nat = 0;
  for (const b of bells) {
    const sharp = SHARP.includes(b.i % 12);
    const el = document.createElement('div');
    el.className = 'key ' + (sharp ? 'shp' : 'nat') + (b.i % 12 === 0 ? ' c' : '');
    el.dataset.name = b.name;
    el.style.left = (sharp ? nat * W - W * 0.32 : nat * W + W * 0.08) + '%';
    el.style.width = (sharp ? W * 0.64 : W * 0.84) + '%';
    el.innerHTML = `<i>${HINT[b.i] ?? ''}</i>`;
    el.title = b.name; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `${b.name} baton`); el.tabIndex = b.i === 12 ? 0 : -1; el.dataset.bell = b.i;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId); userPlay(b.i); });   // let a drag slide on to the next baton
    el.addEventListener('pointerenter', (e) => { if (e.buttons || e.pointerType === 'touch') userPlay(b.i, 0.7); });   // drag for a glissando
    kb.appendChild(el); keyEls.push(el);
    if (b.i < PEDALS) {
      const ped = document.createElement('div');
      ped.className = 'key ped ' + (sharp ? 'shp' : 'nat');
      ped.style.left = el.style.left; ped.style.width = el.style.width;
      ped.title = b.name + ' pedal'; ped.setAttribute('role', 'button'); ped.setAttribute('aria-label', `${b.name} pedal`); ped.tabIndex = -1; ped.dataset.bell = b.i; ped.dataset.pedal = 1;
      ped.addEventListener('pointerdown', (e) => { e.preventDefault(); if (ped.hasPointerCapture?.(e.pointerId)) ped.releasePointerCapture(e.pointerId); userPlay(b.i, 1); });
      ped.addEventListener('pointerenter', (e) => { if (e.buttons || e.pointerType === 'touch') userPlay(b.i, 0.85); });
      kb.appendChild(ped); pedEls[b.i] = ped;
    }
    if (!sharp) nat++;
  }
}
// Keyboard on the batons themselves: one of them is in the Tab order, and the arrow keys move between them
kb.addEventListener('keydown', (e) => {
  const at = e.target.closest('.key'); if (!at) return;
  const i = +at.dataset.bell, ped = !!at.dataset.pedal;
  const go = (el) => { if (el) { for (const k of kb.querySelectorAll('.key[tabindex="0"]')) k.tabIndex = -1; el.tabIndex = 0; el.focus(); } };
  if (e.key === 'ArrowRight') go(ped ? pedEls[i + 1] : keyEls[i + 1]);
  else if (e.key === 'ArrowLeft') go(ped ? pedEls[i - 1] : keyEls[i - 1]);
  else if (e.key === 'ArrowDown') go(pedEls[Math.min(i, PEDALS - 1)]);
  else if (e.key === 'ArrowUp') go(keyEls[i]);
  else if (e.key === 'Enter' || e.key === ' ') userPlay(i, ped ? 1 : 0.85);
  else return;
  e.preventDefault(); e.stopPropagation();
});
// The scene itself takes the keyboard too: arrows turn and tilt the view, plus and minus zoom
const orbit = new THREE.Spherical();
function nudgeView(dx, dy, dz) {
  if (mode === 'atlas') return atlas.nudge(dx, dy, dz);
  if (mode === 'site') return site.nudge(dx, dy, dz);
  if (trans) return;
  orbit.setFromVector3(tmp.copy(camera.position).sub(controls.target));
  orbit.theta += dx * 0.15; orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.05, orbit.phi + dy * 0.1));
  orbit.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, orbit.radius * (1 + dz * 0.12)));
  camera.position.setFromSpherical(orbit).add(controls.target); controls.update();
}
canvas.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, -1, 0], ArrowDown: [0, 1, 0], '+': [0, 0, -1], '=': [0, 0, -1], '-': [0, 0, 1], _: [0, 0, 1] }[e.key];
  if (!step || e.metaKey || e.ctrlKey || e.altKey) return;
  nudgeView(...step); e.preventDefault(); e.stopPropagation();
});
// Typing letters to play is a single-key shortcut, so it can be switched off (for people who use speech input, say)
let typing = true;
try { typing = localStorage.getItem('carillon-typing') !== 'off'; } catch (err) { /* private window */ }
const showTyping = () => { $('typing').textContent = `Typing plays bells: ${typing ? 'on' : 'off'}`; $('typing').setAttribute('aria-pressed', typing); };

addEventListener('keydown', (e) => {
  if ($('lightbox').classList.contains('on')) {
    if (e.key === 'Escape') closePhoto();
    if (e.key === 'Tab') {   // keep the Tab key inside the open photo
      const stops = [...$('lightbox').querySelectorAll('a[href], button')], k = stops.indexOf(document.activeElement);
      e.preventDefault(); stops[(k + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
    }
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT)$/.test(e.target.tagName)) return;
  if (mode !== 'tower') {
    if (e.key === 'ArrowRight') atlasStep(1); else if (e.key === 'ArrowLeft') atlasStep(-1);
    else if (e.key === 'Escape') mode === 'site' ? setMode('atlas') : atlas.select(-1);
    return;
  }
  if (e.key === 'ArrowRight') return goTo(cur + 1);
  if (e.key === 'ArrowLeft') return goTo(cur - 1);
  const k = e.key.toLowerCase(), n = KEYS[SHIFTED[k] ?? k];
  if (n === undefined || !typing) return;
  e.preventDefault();
  if (e.shiftKey && n < PEDALS) userPlay(n, 1);   // Shift + a low key = the pedal: same bell, struck harder
  else userPlay(n);
});

/* ───────────────────────── Tour ───────────────────────── */

const climbPath = [
  { p: [0, 1.7, 10], t: [0, 2.2, 0] },
  { p: [0, 1.8, 1.5], t: [0, 4, -2] },
];
for (let k = 0; k <= 8; k++) {
  const a = -Math.PI / 2 + k * 0.6, y = 3 + k * 3.2;
  climbPath.push({ p: [0, y, 0], t: [Math.cos(a) * 3, y + 3.4, Math.sin(a) * 3] });
}

// A long video tour of a real carillon; a search link, because the video's own address is not known here
const WATCH = 'https://www.youtube.com/results?search_query=Rob+Scallon+Carillon+%28A+tower+filled+with+100+tons+of+bells%29';
const b0 = bells[0];
const STOPS = [
  {
    title: 'A tower that is an instrument',
    pos: [38, 12, 58], target: [0, 29, 0], xray: 0,
    html: `<p>A <b>carillon</b> is at least 23 bronze bells, tuned to play melody and harmony, and played by one person from a keyboard. This tower has <b>37</b>.</p>
<p><button class="btn primary" data-tune="westminster">Hear it ring</button> <button class="btn" data-menu="tunes">More tunes</button></p>
<p>The bells are bolted in place and never swing. Only the clappers inside them move.</p>
<p>The instrument grew out of clock chimes in the Low Countries in the 1500s. <button class="btn link" data-visit="Belfry of Bruges">See one of those towers: Bruges</button></p>
<p><a class="btn" href="${WATCH}" target="_blank" rel="noopener">▶ Watch a real one played and explained: Rob Scallon at the University of Chicago ↗</a></p>
<p class="try">Drag to look around, scroll to zoom. By keyboard: Tab to the scene, then the arrow keys turn it and <kbd>+</kbd> <kbd>−</kbd> zoom. Next flies you inside; click the scene to skip a flight. This tower is stylised, not a real one.</p>`,
  },
  {
    title: 'The climb',
    pos: [-1.9, 29.2, -1.9], target: [1.0, 12, 1.0], xray: 0, path: climbPath, dur: 11000,   // at the top, looking back down the stairwell
    html: `<p>The player, a <b>carillonneur</b>, climbs the tower and plays from a small room right under the bells.</p>
<p>The room is that high because every key is tied to its bell by a wire. Shorter wires mean a lighter touch.</p>
<p>The chimes a tower plays by itself on the hour use a separate mechanism, traditionally a pinned drum like a music box.</p>`,
  },
  {
    title: 'The playing cabin',
    pos: [2.7, CABIN_Y + 2.5, 1.5], target: [0, CABIN_Y + 0.8, -0.3], xray: 0, labels: 'cabin',   // from the player's right and above, so the body does not hide the batons
    html: `<p class="try">Play the batons below. Drag across them, or type <kbd>Z</kbd>–<kbd>M</kbd> and <kbd>Q</kbd>–<kbd>P</kbd>.</p>
<p>The keys are wooden <b>batons</b>, struck with loosely closed fists. Lower row: naturals. Upper row: sharps and flats.</p>
<p>The <b>pedals</b> are wired to the same bells as the lowest batons, here C3 to F4, so the feet can carry the bass while the fists play above. Press a pedal and its baton dips too. Hold <kbd>Shift</kbd> with a key to use the pedal.</p>
<p>Nothing is electric. Hit harder and the bell rings louder.</p>
<p>The first school for carillonneurs opened in Mechelen in 1922. <button class="btn link" data-visit="St Rumbold's Tower">Visit its tower</button></p>`,
  },
  {
    title: 'Wires and cranks',
    pos: [6.2, 38.3, 7.4], target: [0.2, 37.2, -0.4], xray: 1, labels: 'wires',   // close on the crank rack and the lowest bells
    html: `<p class="try">Play a few notes: the wire lights up and its three cranks rock.</p>
<p>Each baton pulls a wire down. Above the ceiling the wire meets a <b>bell crank</b>, an L-shaped lever on a pivot, which turns the pull sideways.</p>
<p>A second crank beside the bell sends the pull up, and a third drags the <b>clapper</b>'s tail sideways into the bronze. Every run sits at its own height so no two wires touch.</p>
<p>Each crank adds friction, so real builders use as few as they can and hang the bells close above the keyboard. This tower shows the full chain.</p>
<p>There are <b>no dampers</b>. A struck bell rings until it fades, many seconds for the big ones, and the music is written around that.</p>`,
  },
  {
    title: 'The belfry',
    pos: [3.0, 37.2, 3.0], target: [-0.4, 41.4, -0.4], xray: 0,
    html: `<p class="try">Click any bell to ring it and see its size.</p>
<p>The lowest bell, the <b>bourdon</b>, is about 1.6 m across and 2.5 tonnes. The smallest is about 25 cm and 10 kg.</p>
<p>To sound an octave lower, a bell must be twice as wide and <b>eight times as heavy</b>. Low notes are what make a carillon expensive.</p>
<p>The heaviest carillon bell anywhere weighs about as much as seven of our bourdons. <button class="btn link" data-visit="Riverside Church">Visit it in New York</button></p>`,
  },
  {
    title: 'Anatomy of a bell',
    pos: [-2.2, 37.5, 4.9], target: [b0.x, b0.crownY - 0.55 * b0.H, b0.z], xray: 0, labels: 'anatomy',
    html: `<p>The wall is thickest at the <b>sound bow</b>, near the rim, where the clapper strikes.</p>
<p>Bell bronze is about four parts copper to one part tin: hard, brittle and slow to stop ringing.</p>
<p>After casting, a bell is tuned on a lathe by shaving metal from the inside. It cannot be put back.</p>`,
  },
  {
    title: 'Why bells sound like bells',
    pos: [-3.0, 40.1, 3.0], target: [0.3, 41.7, -0.3], xray: 0, lab: true,
    html: `<p>A bell sounds several notes at once, called <b>partials</b>. Listen to each:</p>
<div id="lab"></div>
<p>The <b>tierce</b> is a minor third, which gives bells their bittersweet colour even in cheerful music.</p>
<p>The Hemony brothers cast the first well-tuned carillon in Zutphen in 1644. Major-third bells only arrived in the 1980s. <button class="btn link" data-visit="Wijnhuistoren">Visit the tower in Zutphen</button></p>`,
  },
  {
    title: 'Your turn',
    pos: [13, 43, 19], target: [0, 39.5, 0], xray: 1,
    html: `${tuneRows}
<p class="try" id="game" aria-live="polite">Play along: the notes fall onto the batons, each marked with its key. The tower waits for you.</p>
<div class="stack two">
  <button class="btn" data-tune="stop">Stop</button>
  <button class="btn" data-tune="game">Echo game</button>
</div>
<p>The echo game plays a growing phrase on the white batons from C4 to C5 (keys <kbd>Q</kbd> to <kbd>I</kbd>) for you to repeat.</p>
<p><button class="btn primary" data-mode="atlas">See real carillons around the world</button></p>
<p><a class="btn" href="${WATCH}" target="_blank" rel="noopener">▶ Watch a real carillon played: Rob Scallon's 36-minute tour ↗</a></p>
<p><button class="btn" data-mode="atlas" data-tab="quiz">Take the quiz</button> <button class="btn" data-mode="atlas" data-tab="history">500 years on the globe</button></p>`,
  },
];

const $ = (id) => document.getElementById(id);
// Text from the data files (some of it gathered from Wikipedia) is escaped before it is written into the page as HTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Less motion (no flights, no circling) starts on if the device asks for it, and the Motion button overrides that
let calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
try { const saved = localStorage.getItem('carillon-motion'); if (saved) calm = saved === 'off'; } catch (err) { /* private window */ }
const panel = $('panel'), labelsEl = $('labels'), chip = $('chip'), xrayBtn = $('xray');
let cur = 0, trans = null, xray = 0, xrayGoal = 0, selected = 12;

STOPS.forEach((s, k) => {
  const d = document.createElement('button');
  d.title = s.title; d.setAttribute('aria-label', `Stop ${k + 1}: ${s.title}`);
  d.onclick = () => goTo(k); $('dots').appendChild(d);
});
$('prev').onclick = () => mode !== 'tower' ? atlasStep(-1) : goTo(cur - 1);
$('next').onclick = () => mode !== 'tower' ? atlasStep(1) : goTo(cur === STOPS.length - 1 ? 0 : cur + 1);   // after the last stop, Next starts the tour again
// "See inside" fades the walls and flies to a view of the whole instrument, cabin to bells; pressing again returns to the stop's view
const INSIDE = { pos: [11.5, 38.6, 15], target: [0, 37.3, 0] };
function flyTo(pos, target, x1) {
  if (calm) { trans = null; camera.position.copy(V(pos)); controls.target.copy(V(target)); xray = xrayGoal = x1; controls.update(); return; }
  trans = { pc: new THREE.CatmullRomCurve3([camera.position.clone(), V(pos)]), tc: new THREE.CatmullRomCurve3([controls.target.clone(), V(target)]),
    t0: performance.now(), dur: 1800, x0: xray, x1 };
  controls.enabled = false;
}
xrayBtn.onclick = () => xrayGoal > 0.5 ? flyTo(STOPS[cur].pos, STOPS[cur].target, 0) : flyTo(INSIDE.pos, INSIDE.target, 1);
$('recenter').onclick = () => mode === 'site' ? site.reset() : mode === 'atlas' ? (atlas.selected >= 0 ? atlas.resetDrone() : atlas.home()) : goTo(cur);
const moreCheck = () => {
  const b = $('body'); b.classList.toggle('more', b.scrollHeight - b.scrollTop - b.clientHeight > 8);
  // Housekeeping for screen readers after any redraw: say that outside links open a new tab, and hide decorations
  for (const a of b.querySelectorAll('a[target="_blank"]:not([data-told])')) { a.dataset.told = 1; a.insertAdjacentHTML('beforeend', '<span class="sr"> (opens in a new tab)</span>'); }
  for (const d of b.querySelectorAll('.dot:not([aria-hidden]), .meter i:not([aria-hidden])')) d.setAttribute('aria-hidden', 'true');
};
// A line read out by screen readers when the view changes, and a description of what the 3D scene is showing
const announce = (text) => { $('announce').textContent = text; };
const describeScene = (text) => canvas.setAttribute('aria-label', `${text} Arrow keys turn the view, plus and minus zoom.`);
// Redrawing the panel destroys the button that was just pressed. This finds its counterpart in the new content
// (same id, or same data attribute), so keyboard focus is not thrown back to the top of the page.
function focusKey() {
  const a = document.activeElement;
  if (!a || !$('body').contains(a)) return null;
  if (a.id) return '#' + a.id;
  const [k, v] = Object.entries(a.dataset)[0] || [];
  return k ? `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${String(v).replace(/["\\]/g, '\\$&')}"]` : 'h1';
}
function restoreFocus(key, ...fallbacks) {
  if (!key) return;
  const b = $('body'), el = [key, ...fallbacks].map((sel) => sel && b.querySelector(sel)).find((x) => x && !x.disabled);
  if (el) el.focus({ preventScroll: true }); else $('title').focus();
}
$('body').addEventListener('scroll', moreCheck);

$('body').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.dataset.mode) { if (btn.dataset.tab) openTab(btn.dataset.tab, false); if (btn.dataset.stop) cur = +btn.dataset.stop; return setMode(btn.dataset.mode); }
  if (btn.dataset.menu) return openTunes(true);
  if (btn.dataset.nation) { filter.where = filter.where === btn.dataset.nation ? '' : btn.dataset.nation; renderAtlas(-1); return applyFilter(true); }
  if (btn.dataset.visit) { setMode('atlas'); return pickCarillon(CARILLONS.findIndex((c) => c.name === btn.dataset.visit)); }
  if (btn.dataset.more) { listMax += 80; return renderList(); }
  if (btn.dataset.along) return startSong(btn.dataset.along, true);
  if (btn.dataset.story) return openStory(+btn.dataset.story);
  if (btn.dataset.hplay) return playHistory();
  if (btn.dataset.quiz) return quizClick(btn.dataset.quiz);
  if (btn.dataset.hear) return ring({ f: +btn.dataset.hear }, 0.9);
  if (btn.dataset.atlas) return pickCarillon(+btn.dataset.atlas);
  if (btn.dataset.tab) return openTab(btn.dataset.tab, true);
  if (btn.dataset.recorded) { filter.recorded = !filter.recorded; btn.setAttribute('aria-pressed', filter.recorded); return applyFilter(true); }
  if (btn.dataset.real) return playReal(atlas.selected);
  if (btn.dataset.featured) { filter.featured = !filter.featured; btn.setAttribute('aria-pressed', filter.featured); return applyFilter(false); }
  if (btn.dataset.random) return matches.length ? pickCarillon(matches[Math.floor(Math.random() * matches.length)]) : undefined;
  if (btn.dataset.ring) return ring({ f: estHz(+btn.dataset.ring) }, 0.9);
  if (btn.dataset.tune === 'stop') { stopTune(); game = null; gameStatus(''); }
  else if (btn.dataset.tune === 'game') gameStart();
  else if (btn.dataset.tune) startSong(btn.dataset.tune, false);
  if (btn.dataset.partial) {
    const b = bells[selected]; b.hitAt = performance.now(); b.vel = 0.7;
    ring(selected, 0.8, btn.dataset.partial === 'all' ? null : btn.dataset.partial);
  }
});
// Pointing at a name in the atlas list lights up its tower on the globe
$('body').addEventListener('pointerover', (e) => { const r = e.target.closest('[data-atlas]'); if (mode === 'atlas') atlas.setHover(r ? +r.dataset.atlas : -1); });
$('body').addEventListener('pointerleave', () => { if (mode === 'atlas') atlas.setHover(-1); });
$('body').addEventListener('change', (e) => {
  if (e.target.id === 'major') { majorThird = e.target.checked; renderLab(); }
  if (e.target.id === 'fwhere') { filter.where = e.target.value; applyFilter(true); }
  if (e.target.id === 'fmin') { filter.min = +e.target.value; applyFilter(false); }
});

function renderLab() {
  const lab = $('lab'); if (!lab) return;
  const b = bells[selected], hz = (r) => Math.round(b.f * r) + ' Hz';
  lab.innerHTML = `<div class="stack two">
  <button class="btn" data-partial="hum" title="An octave below the prime">Hum <span>${hz(0.5)}</span></button>
  <button class="btn" data-partial="prime" title="The note the bell is named for">Prime <span>${hz(1)}</span></button>
  <button class="btn" data-partial="tierce" title="A ${majorThird ? 'major' : 'minor'} third above the prime">Tierce <span>${hz(majorThird ? MAJOR_TIERCE : PARTIALS[2].r)}</span></button>
  <button class="btn" data-partial="quint" title="A fifth above the prime">Quint <span>${hz(1.5)}</span></button>
  <button class="btn" data-partial="nominal" title="An octave above the prime">Nominal <span>${hz(2)}</span></button>
  <button class="btn primary" data-partial="all">Whole bell</button>
</div>
<label class="check"><input type="checkbox" id="major" ${majorThird ? 'checked' : ''}> Make the tierce a major third</label>
<p class="try">Bell ${b.name}. Click any bell to switch.</p>`;
  moreCheck();
}

function select(i) {
  selected = i;
  const b = bells[i];
  chip.style.display = 'block';
  chip.innerHTML = `<b>${b.name}</b>${i === 0 ? ' · bourdon' : ''} · about ${b.D.toFixed(2)} m wide · ${b.kg >= 100 ? Math.round(b.kg / 10) * 10 : Math.round(b.kg)} kg · ${Math.round(b.f)} Hz`;
  renderLab();
}

const V = (a) => new THREE.Vector3(...a);
function goTo(idx, instant = false) {
  if (idx < 0 || idx >= STOPS.length) return;
  const prev = cur; cur = idx;
  const s = STOPS[idx];
  const hadFocus = $('body').contains(document.activeElement);
  $('eyebrow').textContent = `Stop ${idx + 1} of ${STOPS.length}`;
  $('title').textContent = s.title;
  $('body').innerHTML = s.html; $('body').scrollTop = 0;
  if (hadFocus) $('title').focus();   // the button that was pressed is gone: carry on from the heading
  announce(`Stop ${idx + 1} of ${STOPS.length}: ${s.title}`);
  describeScene(`The bell tower, at the stop called ${s.title}.`);
  renderLab();
  $('prev').disabled = idx === 0; $('next').disabled = false;
  $('next').textContent = idx === STOPS.length - 1 ? 'Start again' : 'Next';
  [...$('dots').children].forEach((d, k) => { d.classList.toggle('on', k === idx); if (k === idx) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
  labelsEl.classList.remove('on');
  if (game) { game = null; stopTune(); }
  layout(); moreCheck(); syncHash();
  if (instant || calm) {
    trans = null; controls.enabled = true;
    if (s.labels) labelsEl.classList.add('on');
    camera.position.copy(V(s.pos)); controls.target.copy(V(s.target)); xray = xrayGoal = s.xray; controls.update();
    return;
  }
  const guided = s.path && idx === prev + 1;
  const pp = [camera.position.clone()], tp = [controls.target.clone()];
  if (guided) for (const w of s.path) { pp.push(V(w.p)); tp.push(V(w.t)); }
  pp.push(V(s.pos)); tp.push(V(s.target));
  trans = {
    pc: new THREE.CatmullRomCurve3(pp, false, 'centripetal'), tc: new THREE.CatmullRomCurve3(tp, false, 'centripetal'),
    t0: performance.now(), dur: guided ? s.dur : 2600, x0: xray, x1: s.xray,
  };
  controls.enabled = false;
}

/* ───────────────────────── Anatomy labels ───────────────────────── */

const R0 = b0.D / 2;
const LABELS = [
  ...[
  ['Crown', [b0.x, b0.crownY + 0.1, b0.z]],
  ['Shoulder', [b0.x + 0.5 * R0, b0.crownY - 0.1 * b0.H, b0.z + 0.1]],
  ['Waist', [b0.x - 0.56 * R0, b0.crownY - 0.45 * b0.H, b0.z + 0.1]],
  ['Sound bow', [b0.x + 0.92 * R0, b0.crownY - 0.92 * b0.H, b0.z + 0.1]],
  ['Lip', [b0.x - 0.98 * R0, b0.crownY - b0.H, b0.z + 0.2]],
  ['Clapper', [b0.ballPos.x, b0.ballPos.y - 0.12, b0.ballPos.z]],
].map((l) => ['anatomy', ...l]),
  ['cabin', 'Batons, played with the fists', [0.62, CABIN_Y + 1.0, CONSOLE_Z + 0.34]],
  ['cabin', 'Pedals, played with the feet', [0.62, CABIN_Y + 0.2, CONSOLE_Z + 0.46]],
  ['cabin', 'Wires up to the bells', [0.1, CABIN_Y + 1.7, CONSOLE_Z - 0.02]],
  ['wires', 'First crank: up becomes sideways', b0.corners[0].toArray()],
  ['wires', 'Second crank: sideways becomes up', b0.corners[1].toArray()],
  ['wires', 'Third crank pulls the clapper tail', b0.corners[2].toArray()],
].map(([set, text, p]) => {
  const el = document.createElement('div'); el.textContent = text; labelsEl.appendChild(el);
  return { set, el, p: V(p) };
});

/* ───────────────────────── Picking ───────────────────────── */

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
function pick(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(bellMeshes, false)[0];
  return hit ? hit.object.userData.i : -1;
}
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; if (trans) trans.t0 = -1e9; });   // a press skips the flight
canvas.addEventListener('pointerup', (e) => {
  if (mode !== 'tower' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const i = pick(e); if (i >= 0) userPlay(i, 0.9);
});
let hovered = -1;
canvas.addEventListener('pointermove', (e) => { if (mode === 'tower' && !e.buttons) { hovered = pick(e); canvas.style.cursor = hovered >= 0 ? 'pointer' : 'grab'; } });
canvas.addEventListener('pointerleave', () => { hovered = -1; });

/* ───────────────────────── Layout and render loop ───────────────────────── */

function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h;
  // Centre the view in the area not covered by the panel and the keyboard
  const p = panel.getBoundingClientRect(), k = $('kbwrap').getBoundingClientRect();
  const wide = w > 820, left = wide ? p.right : 0, top = wide ? 0 : p.bottom;
  const bottom = mode !== 'tower' ? h : k.top;   // the keyboard is hidden in the atlas
  for (const c of [camera, atlas.camera, site.camera]) {
    c.aspect = w / h;
    c.setViewOffset(w, h, w / 2 - (left + w) / 2, h / 2 - (top + bottom) / 2, w, h);
    c.updateProjectionMatrix();
  }
  for (const b of bells) b.wireMat.resolution.set(w, h);
}
addEventListener('resize', () => { layout(); moreCheck(); });

// Shadows for every solid thing, then the finishing passes: contact shading in corners, a glow on struck bells, colour grading
const shellMeshes = [];
scene.traverse((o) => {
  if (o.isLineSegments2) { o.isLine = true; return; }   // marks the wires as lines so the contact-shading pass leaves them out
  if (!o.isMesh || o === sky) return;
  o.castShadow = !o.userData.noCast; o.receiveShadow = !o.isLine;
  if (shell.includes(o.material)) shellMeshes.push(o);
});
const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = composer.renderTarget2.samples = 4;
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 1.3, distanceExponent: 1.5, thickness: 1.2, scale: 1.15, samples: 16 });
composer.addPass(gtao);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.7, 3.2));
composer.addPass(new OutputPass());

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const tmp = new THREE.Vector3(), rock = new THREE.Quaternion(), ZAXIS = new THREE.Vector3(0, 0, 1);

function frame(now) {
  requestAnimationFrame(frame);

  if (song && mode === 'tower') tickSong(now);
  renderer.toneMappingExposure = mode === 'tower' ? EXPOSURE : 1;
  if (mode === 'atlas') { atlas.update(now); renderer.render(atlas.scene, atlas.camera); return; }
  if (mode === 'site') { site.update(now); renderer.render(site.scene, site.camera); return; }

  if (trans) {
    const raw = (now - trans.t0) / trans.dur, u = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1, e = ease(u);   // never hand the path a bad position
    camera.position.copy(trans.pc.getPoint(e));
    controls.target.copy(trans.tc.getPoint(e));
    camera.lookAt(controls.target);
    xray = xrayGoal = trans.x0 + (trans.x1 - trans.x0) * e;
    if (u >= 1) { trans = null; controls.enabled = true; if (STOPS[cur].labels) labelsEl.classList.add('on'); }
  } else {
    xray += (xrayGoal - xray) * 0.12;
    controls.update();
  }

  const see = xray > 0.01;
  for (const m of shell) {
    if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }   // the shader forces alpha to 1 while opaque
    m.opacity = 1 - 0.9 * xray; m.depthWrite = xray < 0.5;
  }
  decor.visible = xray < 0.5;
  if (shellMeshes[0].castShadow !== xray < 0.5) for (const m of shellMeshes) m.castShadow = xray < 0.5;   // see-through walls let the sun in
  gtao.enabled = xray < 0.3;
  if (xrayBtn.getAttribute('aria-pressed') !== String(xrayGoal > 0.5)) {
    xrayBtn.setAttribute('aria-pressed', xrayGoal > 0.5); xrayBtn.textContent = xrayGoal > 0.5 ? 'Show the walls' : 'See inside';
  }

  for (const b of bells) {
    const dt = (now - b.hitAt) / 1000;
    const swing = dt < 0.05 ? dt / 0.05 : Math.max(0, 1 - (dt - 0.05) / 0.3);
    b.clapper.rotation.z = REST + (STRIKE - REST) * swing;
    if (swing > 0 || b.rocked) {   // the three cranks rock together and the last wire follows the clapper
      for (const c of b.cranks) c.g.quaternion.copy(c.base).multiply(rock.setFromAxisAngle(ZAXIS, -0.32 * swing));
      setPull(b, b.clapper.rotation.z); b.rocked = swing > 0;
    }
    b.baton.position.y = b.batonY - 0.05 * swing;
    if (b.pedal) b.pedal.position.y = b.pedalY - 0.04 * swing;
    b.mat.emissiveIntensity = Math.max(dt < 6 ? 5 * b.vel * Math.exp(-dt * 2.2) : 0, b.i === hovered ? 0.3 : 0);   // a fresh strike is bright enough to bloom
    const hot = dt < 5 ? Math.exp(-dt * 1.6) : 0;
    b.wireMat.color.copy(WIRE_IDLE).lerp(WIRE_HOT, hot); b.wireMat.linewidth = 1.3 + 3.5 * hot; b.pullMat.color.copy(b.wireMat.color);
  }

  for (const l of LABELS) {
    if (l.set !== STOPS[cur].labels) { l.el.style.display = 'none'; continue; }
    tmp.copy(l.p).project(camera);
    l.el.style.left = (tmp.x + 1) / 2 * innerWidth + 'px';
    l.el.classList.toggle('flip', tmp.x > 0.1);   // near the right edge, open to the left
    l.el.style.top = (1 - tmp.y) / 2 * innerHeight + 'px';
    l.el.style.display = tmp.z < 1 ? '' : 'none';
  }

  composer.render();
}

/* ───────────────────────── World atlas ───────────────────────── */

// The 30 hand-written "featured" carillons, plus every other one in Wikipedia's lists (world.js, if it has been built)
const FEATURED = window.CARILLONS;
FEATURED.forEach((c) => { c.featured = true; });
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]+/g, '').split(' ')
  .filter((w) => w.length > 3 && !/^(carillon|church|tower|memorial|saint|sint|university|cathedral|kerk|toren)$/.test(w));
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));
const regionOf = (c) => /^(Netherlands|Belgium)$/.test(c.country) ? 'Low Countries' : /^(USA|Canada)$/.test(c.country) ? 'North America'
  : c.lat > 35 && c.lat < 72 && c.lon > -25 && c.lon < 45 ? 'Europe' : 'Rest of the world';
const CARILLONS = [...FEATURED, ...(window.WORLD || [])
  .map(([name, city, country, lat, lon, bells, kg, maker, photo, since, exact]) => ({ name, city, country, lat, lon, bells, heavy: kg / 1000, maker, photo: photo || null, since, approx: !exact, trivia: [] }))
  .filter((w) => !FEATURED.some((f) => {   // the same tower as a featured one: on the same spot, or nearby with the same name
    const d = km(f, w), mine = words(f.name), shared = mine.filter((x) => words(w.name).includes(x)).length;
    return (d < 0.15 && !w.approx) || (d < 3 && (shared > 0 || (w.bells > 0 && w.bells === f.bells))) || (d < 30 && shared >= Math.max(1, Math.min(2, mine.length)));
  }))];
for (const c of CARILLONS) { c.region = regionOf(c); c.audio = (window.RECORDINGS || {})[`${c.name}|${c.city}`] || null; }
// Every country gets a colour, shared by its towers on the globe, its tinted outline and the legend.
// Countries near one another never share a colour. The names on the right are those used by the country outlines.
const OUTLINE = { USA: 'United States of America', England: 'United Kingdom', Scotland: 'United Kingdom', Wales: 'United Kingdom', 'Northern Ireland': 'United Kingdom',
  'Czech Republic': 'Czechia', 'Bosnia and Herzegovina': 'Bosnia and Herz.' };
const PALETTE = [0xf5b83d, 0xff7a59, 0xf062a8, 0xb48cf7, 0x56d0ea, 0x9be36a, 0xf4eede, 0x8fb2ff];   // gold, coral, pink, violet, cyan, green, cream, periwinkle
const NATIONS = new Map();
for (const c of CARILLONS) {
  c.nation = OUTLINE[c.country] || c.country;
  const n = NATIONS.get(c.nation) || { count: 0, lat: 0, lon: 0 };
  n.count++; n.lat += c.lat; n.lon += c.lon; NATIONS.set(c.nation, n);
}
[...NATIONS.values()].sort((x, y) => y.count - x.count).forEach((n, k, all) => {
  n.lat /= n.count; n.lon /= n.count;
  const taken = all.slice(0, k).filter((o) => km(o, n) < 2500).map((o) => o.color);
  n.color = [...PALETTE.slice(k % PALETTE.length), ...PALETTE].find((col) => !taken.includes(col)) ?? PALETTE[k % PALETTE.length];
});
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
for (const c of CARILLONS) c.color = NATIONS.get(c.nation).color;
// A year for the history view: the first year in "since", or else the oldest year named beside the bell founders
const OLDEST = { "St Rumbold's Tower": 1674 };   // its old carillon still has Hemony bells of 1674
for (const c of CARILLONS) {
  const own = String(c.since ?? '').match(/\d{4}/), cast = String(c.maker ?? '').match(/\b(1[4-9]\d\d|20[0-2]\d)\b/g);
  c.yr = OLDEST[c.name] ?? (own ? +own[0] : cast ? Math.min(...cast) : 0);
}
const DATED = CARILLONS.map((c, k) => k).filter((k) => CARILLONS[k].yr).sort((x, y) => CARILLONS[x].yr - CARILLONS[y].yr);
{ // Carillons that were only placed to the same town centre are fanned out a little, so each can be seen and clicked
  const stack = new Map();
  for (const c of CARILLONS) {
    const key = c.lat + ',' + c.lon, n = stack.get(key) || 0;
    stack.set(key, n + 1);
    if (n) { c.lat += 0.006 * Math.cos(n * 2.4) * Math.sqrt(n); c.lon += 0.009 * Math.sin(n * 2.4) * Math.sqrt(n); }
  }
}
const SEARCH = CARILLONS.map((c) => `${c.name} ${c.city} ${c.country}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
const weight = (t) => t >= 1 ? `${Math.round(t * 10) / 10} tonnes` : `${Math.round(t * 1000)} kg`;

let lastHome = false, lastCard = -1, mode = 'tower', atlasTab = 'towers';
const filter = { q: '', where: '', min: 0, featured: false, recorded: false };
let listMax = 80, restoring = true;
let matches = CARILLONS.map((c, k) => k);   // the carillons that pass the filters, biggest first
const atlas = window.createAtlas({ THREE, OrbitControls, canvas, data: CARILLONS, onSelect: renderAtlas, calm: () => calm, tint: (name) => NATIONS.get(name)?.color });
const site = window.createSite({ THREE, canvas, calm: () => calm });
const atlasBtn = $('atlasBtn');
const tons = (a, b) => (bells.slice(a, b).reduce((sum, x) => sum + x.kg, 0) / 1000).toFixed(1);
const estHz = (kg) => F0 / ((kg / 600) ** (1 / 3) / 1.6) ** (1 / 0.85);   // this app's size-to-pitch model, run backwards

function renderAtlas(i) {
  const body = $('body'), keepScroll = lastHome && i < 0;   // switching tabs or filters should not jump
  const focusWas = focusKey(), cameFrom = lastCard;
  lastHome = i < 0;
  stopReal();
  if (i >= 0) stopHistory();
  if (i >= 0) $('atlasHint').classList.add('gone');
  $('prev').disabled = i < 0; $('next').disabled = false; $('next').textContent = 'Next';
  if (i < 0) {
    $('eyebrow').textContent = 'World atlas';
    $('title').textContent = 'Where the carillons are';
    const at = (name) => CARILLONS.findIndex((c) => c.name === name);
    const tab = (id, label) => `<button data-tab="${id}" aria-pressed="${atlasTab === id}">${label}</button>`;
    let html = `<p class="intro"><b>${CARILLONS.length}</b> of the world's roughly 700 carillons are on this globe, coloured by country. Two thirds are in the Netherlands, Belgium and the USA.</p>
<div class="tabs">${tab('towers', 'Towers')}${tab('history', 'History')}${tab('records', 'Records')}${tab('cost', 'Cost')}${tab('quiz', 'Quiz')}</div>`;
    if (atlasTab === 'towers') {
      const count = (key) => CARILLONS.reduce((map, c) => map.set(c[key], (map.get(c[key]) || 0) + 1), new Map());
      const opt = (v, label) => `<option value="${esc(v)}" ${filter.where === v ? 'selected' : ''}>${esc(label)}</option>`;
      html += `<input id="fq" type="search" placeholder="Search a name, town or country" value="${esc(filter.q)}" aria-label="Search carillons">
<div class="pick"><select id="fwhere" aria-label="Region or country">${opt('', 'Whole world')}
<optgroup label="Regions">${[...count('region')].map(([r, n]) => opt('r:' + r, `${r} (${n})`)).join('')}</optgroup>
<optgroup label="Countries">${[...count('country')].sort((x, y) => y[1] - x[1]).map(([r, n]) => opt('c:' + r, `${r} (${n})`)).join('')}</optgroup></select>
<select id="fmin" aria-label="Size">${[[0, 'Any size'], [35, '35+ bells'], [47, '47+ bells'], [60, '60+ bells']].map(([v, l]) => `<option value="${v}" ${filter.min === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div class="legend">${[...count('country')].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, n]) => `<button data-nation="c:${esc(name)}" aria-pressed="${filter.where === 'c:' + name}"><i class="dot" style="background:${css(CARILLONS.find((c) => c.country === name).color)}"></i>${esc(name)} <b>${n}</b></button>`).join('')}</div>
<div class="chips"><button data-featured="1" aria-pressed="${filter.featured}">Featured, with 3D close-up</button><button data-recorded="1" aria-pressed="${filter.recorded}">♪ Real recording</button><button class="lucky" data-random="1">Surprise me</button></div>
<div id="alist"></div>
<p class="try">The ${FEATURED.length} featured towers are written by hand. The rest come from Wikipedia's lists of carillons (CC BY-SA), placed with OpenStreetMap, often only to the right town.</p>`;
    } else if (atlasTab === 'records') {
      const tallest = CARILLONS.reduce((x, y) => (y.tower || 0) > (x.tower || 0) ? y : x);
      const south = CARILLONS.reduce((x, y) => y.lat < x.lat ? y : x);
      const card = (name, title, hook) => { const c = CARILLONS[at(name)]; return `<button class="row card" data-atlas="${at(name)}"><span>${title}<small>${esc(c.name)}, ${esc(c.city)}. ${hook}</small></span></button>`; };
      html += `<div class="rows">
${card('Riverside Church', 'Heaviest', 'Over 100 tonnes of bronze; one bell alone weighs 18.')}
${card('Kirk in the Hills', 'Most bells', '77 bells, though Daejeon in South Korea may have 78.')}
${card('Wijnhuistoren', 'First in tune', 'In 1644 bells were first tuned partial by partial.')}
${card("St Rumbold's Tower", 'First school', 'Teaching carillonneurs since 1922.')}
${card(tallest.name, 'Tallest tower here', `${tallest.tower} m to the top.`)}
${card('Elliott Tower', 'Newest here', 'Built in 2014, with a published price.')}
${card(south.name, 'Farthest south', 'Carillons reached the far side of the world as memorials and gifts.')}
</div>`;
    } else if (atlasTab === 'history') html += historyHtml();
    else if (atlasTab === 'quiz') html += quizHtml();
    else {
      html += `<p>There is no price list. Every carillon is made to order, and the bill is mostly bronze, a tower strong enough to carry it, and skilled labour.</p>
<p>Low notes cost the most. In this app's tower the 12 lowest bells weigh about <b>${tons(0, 12)} tonnes</b>; the other 25 together weigh about <b>${tons(12, N)}</b>.</p>
<div class="rows">
<button class="row card" data-atlas="${at('Elliott Tower')}"><span>About $6.5 million<small>Elliott Tower, Michigan, 2014: a new tower, 49 bells and a plaza.</small></span></button>
<button class="row card" data-atlas="${at('Netherlands Carillon')}"><span>$5.8 to 10 million<small>Netherlands Carillon, near Washington: restoration with three new bells. Planned at the lower figure, reported at the higher.</small></span></button>
</div>
<p>That is why so many carillons were gifts: from a Rockefeller, a chocolate maker, a magazine editor, or one country to another.</p>`;
    }
    body.innerHTML = html;
    if (atlasTab === 'towers') renderList();
    if (atlasTab === 'history') fillHistory();
  } else {
    const c = CARILLONS[i], more = c.bells - N, at = matches.indexOf(i);
    $('eyebrow').textContent = `${c.city}, ${c.country}` + (at >= 0 ? ` · ${at + 1} of ${matches.length}` : '');
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = css(c.color); $('eyebrow').prepend(dot);
    $('title').textContent = c.name;
    const rows = [['Bells', c.bellsNote ?? (c.bells || 'not listed')], c.heavy && ['Heaviest bell', weight(c.heavy)], c.tower && ['Tower', `${c.tower} m tall`],
      c.since && ['Carillon since', c.since], c.maker && ['Bells cast by', c.maker],
      c.approx && ['On the globe', c.featured ? 'placed roughly, near the tower' : 'placed at its town, not on the tower']].filter(Boolean);
    const q = encodeURIComponent(c.earth ?? `${c.name}, ${c.city}, ${c.country}`);
    if (c.cost) rows.push(['Cost', c.cost]);
    const versus = more > 0 ? `${more} more bells than` : more < 0 ? `${-more} fewer bells than` : 'The same number of bells as';
    body.innerHTML = `${c.photo ? '<figure class="photo" id="photo"></figure>' : ''}
${mode === 'site' ? '<p><button class="btn" data-mode="atlas">◀ Back to the globe</button></p><p class="try" id="siteStatus"></p>'
      : c.featured ? '<p><button class="btn primary" data-mode="site">Fly around this tower in 3D</button></p>' : ''}
<dl class="spec">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${c.trivia.map((t) => `<p>${esc(t)}</p>`).join('')}
${c.watch ? `<p><a class="btn" href="${esc(c.watch.url)}" target="_blank" rel="noopener">▶ ${esc(c.watch.label)} ↗</a></p>` : ''}
${c.featured ? '' : `<p>From Wikipedia's lists of carillons, not checked by hand. <a href="https://en.wikipedia.org/wiki/Special:Search?search=${q}" target="_blank" rel="noopener">Look it up on Wikipedia ↗</a></p>`}
${!c.featured && c.bells > 78 ? `<p>Wikipedia lists ${c.bells} bells here, more than any traditional carillon has, so this is probably an electronic or automatic instrument, not one played from batons.</p>` : ''}
${c.bells ? `<p>${versus} the tower you climbed in this app.${c.heavy >= 3.7 ? ` Its heaviest bell weighs about as much as ${Math.round(c.heavy * 1000 / bells[0].kg)} of our bourdons.` : ''}</p>` : ''}
${c.audio ? `<div id="real"><p><button class="btn primary" data-real="1">▶ Hear the real carillon</button></p><p class="try">${esc(c.audio.note)}</p></div>` : ''}
<p><button class="btn" data-mode="tower" data-stop="2">See how a carillon is played, inside our tower</button></p>
${c.heavy ? `<p><button class="btn primary" data-ring="${c.heavy * 1000}">Hear a bell this heavy</button></p>
<p class="try">A synthesised guess from the weight alone, about ${Math.round(estHz(c.heavy * 1000))} Hz. Not a recording of the real bell.</p>` : ''}
<p><a class="btn" href="https://earth.google.com/web/search/${q}" target="_blank" rel="noopener">Fly around the real tower in Google Earth ↗</a></p>
<p class="try">${c.featured ? 'The 3D view in this app is built from map data, so it has real shapes but no photographs. ' : ''}Google Earth has photographic models of many towers; once there, hold Shift and drag to tilt and circle.</p>
<p class="try">Here: drag to swing the camera around, scroll to climb or drop. Back and Next visit the neighbours.</p>
<p><button class="btn" data-atlas="-1">◀ All carillons</button></p>`;
  }
  if (i >= 0 || !keepScroll) body.scrollTop = 0;
  moreCheck();
  // Focus: back on the same control if it survived the redraw; else the next sensible one; else the heading
  restoreFocus(focusWas, i < 0 && cameFrom >= 0 && `[data-atlas="${cameFrom}"]`, atlasTab === 'quiz' && '[data-quiz="next"]', atlasTab === 'quiz' && '[data-quiz]');
  lastCard = i;
  if (i >= 0) {
    const c = CARILLONS[i];
    announce(`${c.name}, ${c.city}, ${c.country}${c.bells ? `, ${c.bells} bells` : ''}`);
    describeScene(mode === 'site' ? `A 3D map of the buildings around ${c.name}, with the tower highlighted.` : `The globe, with the camera circling above ${c.name} in ${c.city}.`);
  } else {
    announce(`World atlas: ${atlasTab}`);
    describeScene(`A globe showing ${matches.length} carillons as small towers, coloured by country. The list in the guide panel has the same carillons.`);
  }
  if (i >= 0) loadPhoto(CARILLONS[i], i);
  if (i >= 0 && mode === 'site') openSite(i);
  syncHash();
}

// The close-up: real buildings around the tower, from OpenStreetMap
async function openSite(i) {
  const say = (html) => { const el = $('siteStatus'); if (el && atlas.selected === i && mode === 'site') { el.innerHTML = html; moreCheck(); } };
  say('Loading the buildings around the tower…');
  try {
    const info = await site.load(CARILLONS[i]);
    if (!info) return;
    const what = {
      parts: `The tower is highlighted in bronze, mapped in ${info.parts} parts`,
      height: 'The tower is highlighted in bronze, as one outline with a mapped height',
      outline: 'The building is highlighted in bronze. The map has its outline but not its height, so the height here is a guess',
      standin: 'The map has no outline for this tower, so a plain bronze block stands in for it',
      none: 'The exact spot of this tower is not pinned down on the map, so this is the area around it',
    }[info.kind];
    say(`${what}. ${info.buildings} buildings are shown, with real footprints and heights where the map records them. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.`);
  } catch (err) {
    say('No map data has been saved for this tower yet, so there is nothing to fly around here.');
  }
}
function pickCarillon(i) {
  if (mode === 'site' && (i < 0 || !CARILLONS[i].featured)) setMode('atlas');   // only featured towers have a close-up
  atlas.select(i);
}

// The Towers tab: work out which carillons pass the filters, show them on the globe and in the list
function applyFilter(zoom) {
  const q = filter.q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  matches = CARILLONS.map((c, k) => k).filter((k) => {
    const c = CARILLONS[k];
    return (!q || SEARCH[k].includes(q)) && (!filter.featured || c.featured) && (!filter.recorded || c.audio) && c.bells >= filter.min
      && (!filter.where || (filter.where[0] === 'r' ? c.region : c.country) === filter.where.slice(2));
  }).sort((x, y) => CARILLONS[y].bells - CARILLONS[x].bells || CARILLONS[x].name.localeCompare(CARILLONS[y].name));
  atlas.setFilter(matches.length === CARILLONS.length ? null : new Set(matches));
  if (zoom && atlas.selected < 0) atlas.frame(q || filter.where || filter.recorded ? matches : null);
  listMax = 80; renderList(); syncHash();
}
function renderList() {
  const el = $('alist'); if (!el) return;
  const top = matches.slice(0, listMax);
  el.innerHTML = `<p class="count">${matches.length === CARILLONS.length ? `All ${matches.length} carillons` : `${matches.length} of ${CARILLONS.length} carillons`}, biggest first</p>
<div class="rows">${top.map((k) => { const c = CARILLONS[k]; return `<button class="row${c.featured ? ' star' : ''}" data-atlas="${k}"><span>${c.audio ? '♪ ' : ''}${esc(c.name)}<small><i class="dot" style="background:${css(c.color)}"></i>${esc(c.city)}, ${esc(c.country)}</small></span>
<span class="meter"><i style="width:${Math.min(100, Math.round((c.bells || 0) / 78 * 100))}%"></i><b>${c.bells || '?'}</b></span></button>`; }).join('')}</div>
${matches.length > top.length ? `<p><button class="btn" data-more="1">Show ${Math.min(80, matches.length - top.length)} more</button> <span class="count">${top.length} of ${matches.length} shown</span></p>` : ''}${matches.length ? '' : '<p class="try">Nothing matches. Try a shorter search.</p>'}`;
  moreCheck();
}
let searchTimer = 0;
$('body').addEventListener('input', (e) => {
  if (e.target.id === 'hyear') { stopHistory(); histYear = +e.target.value; applyHistory(); }
  if (e.target.id !== 'fq') return;
  filter.q = e.target.value;
  clearTimeout(searchTimer); searchTimer = setTimeout(() => applyFilter(true), 350);   // wait for a pause in typing before turning the globe
});

// A real recording of the carillon, streamed from Wikimedia Commons with its credit.
// Commons offers each file in several encodings; the player is given MP3 first (every browser plays it), then the original.
let realAudio = null;
function stopReal() { if (realAudio) { realAudio.pause(); realAudio = null; } }
async function playReal(i) {
  const c = CARILLONS[i], box = $('real'); if (!c?.audio || !box) return;
  box.querySelector('button').textContent = 'Loading…';
  try {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&prop=videoinfo&viprop=url|derivatives|extmetadata&format=json&formatversion=2&origin=*&titles='
      + encodeURIComponent('File:' + c.audio.file);
    const info = (await (await fetch(url)).json()).query.pages[0].videoinfo[0], meta = info.extmetadata || {};
    if (atlas.selected !== i || !$('real')) return;   // the reader has moved on
    const kinds = (info.derivatives || []).filter((d) => /^audio\//.test(d.type)).sort((x, y) => /mpeg/.test(y.type) - /mpeg/.test(x.type));
    const small = (info.derivatives || []).filter((d) => /^video\//.test(d.type) && d.width).sort((x, y) => x.width - y.width)[0];   // for a video, its smallest copy
    stopReal();
    realAudio = document.createElement('audio'); realAudio.controls = true; realAudio.autoplay = true; realAudio.volume = volume;
    for (const d of [...kinds, small, { src: info.url }].filter(Boolean)) { const s = document.createElement('source'); s.src = d.src; if (d.type) s.type = d.type; realAudio.appendChild(s); }
    const credit = document.createElement('small'), a = document.createElement('a');
    a.href = info.descriptionurl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `Recording: ${[plain(meta.Artist?.value).slice(0, 70), plain(meta.LicenseShortName?.value)].filter(Boolean).join(', ') || 'see source'}, via Wikimedia Commons`;
    credit.appendChild(a);
    box.firstElementChild.replaceWith(realAudio, credit);
    moreCheck();
  } catch (err) {
    box.querySelector('button').textContent = 'Could not load the recording. Try again';
  }
}

// Click the photo on a card for a large, uncropped view
async function openPhoto(i) {
  const c = CARILLONS[i]; if (!c.photo) return;
  const box = $('lightbox'), img = box.querySelector('img');
  box.querySelector('h2').textContent = c.name;
  box.querySelector('p').textContent = `${c.city}, ${c.country}${c.bells ? ` · ${c.bells} bells` : ''}`;
  img.removeAttribute('src'); img.alt = `${c.name}, ${c.city}`;
  box.querySelector('a').textContent = '';
  box.classList.add('on'); $('lbClose').focus();
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400&format=json&formatversion=2&origin=*&titles='
      + encodeURIComponent('File:' + c.photo);
    const info = (await (await fetch(url)).json()).query.pages[0].imageinfo[0], meta = info.extmetadata || {};
    img.src = info.thumburl;
    const a = box.querySelector('a');
    a.href = info.descriptionurl;
    a.textContent = `Photo: ${[plain(meta.Artist?.value).slice(0, 60), plain(meta.LicenseShortName?.value)].filter(Boolean).join(', ') || 'see source'}, via Wikimedia Commons`;
  } catch (err) { closePhoto(); }
}
function closePhoto() {   // and put the keyboard back on the photo that opened it
  if (!$('lightbox').classList.contains('on')) return;
  $('lightbox').classList.remove('on'); $('body').querySelector('.photoBtn')?.focus();
}
$('lightbox').addEventListener('click', (e) => { if (!e.target.closest('a')) closePhoto(); });
$('body').addEventListener('click', (e) => { if (e.target.closest('.photoBtn') && atlas.selected >= 0) openPhoto(atlas.selected); });

// Photos come from Wikimedia Commons at view time, with the photographer and licence shown underneath
const photoCache = {};
const plain = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim();
async function loadPhoto(c, i) {
  if (!c.photo) return;
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=720&format=json&formatversion=2&origin=*&titles='
      + encodeURIComponent('File:' + c.photo);
    const info = await (photoCache[c.photo] ??= fetch(url).then((r) => r.json()).then((j) => j.query.pages[0].imageinfo[0]));
    const fig = $('photo');
    if (!fig || atlas.selected !== i) return;   // the reader has moved on
    const meta = info.extmetadata || {}, by = plain(meta.Artist?.value).slice(0, 60), lic = plain(meta.LicenseShortName?.value);
    const img = new Image();
    img.alt = `Photo of ${c.name}, ${c.city}`; img.src = info.thumburl;
    img.onload = moreCheck;
    const cap = document.createElement('figcaption'), a = document.createElement('a');
    a.href = info.descriptionurl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `Photo: ${[by, lic].filter(Boolean).join(', ') || 'see source'}, via Wikimedia Commons`;
    const open = document.createElement('button');   // a real button, so the photo can be opened from the keyboard
    open.className = 'photoBtn'; open.title = 'Enlarge the photo'; open.setAttribute('aria-label', `Enlarge the photo of ${c.name}`); open.appendChild(img);
    cap.appendChild(a); fig.replaceChildren(open, cap);
  } catch (err) {
    delete photoCache[c.photo];
    $('photo')?.remove();   // no photo is better than a broken one
  }
}
function atlasStep(d) {   // Back and Next walk through the carillons that pass the filters
  if (!matches.length) return;
  const at = matches.indexOf(atlas.selected);
  if (at < 0) return pickCarillon(d > 0 ? matches[0] : -1);
  const to = at + d;
  pickCarillon(to < 0 ? -1 : matches[to % matches.length]);
}
function setMode(m) {
  if (m === mode || (m === 'site' && atlas.selected < 0)) return;
  mode = m;
  document.body.classList.toggle('atlas', m !== 'tower');
  document.body.classList.toggle('site', m === 'site');
  stopTune(); game = null; stopHistory(); stopReal();
  atlas.setActive(m === 'atlas'); site.setActive(m === 'site');
  atlasBtn.textContent = m === 'tower' ? 'World atlas' : 'Back to the bell tower';
  if (m === 'tower') return goTo(cur, true);
  controls.enabled = false; renderAtlas(atlas.selected); layout();
}

/* ───────────────────────── History on the globe ───────────────────────── */

const Y0 = 1480, Y1 = 2025;
const STORY = [
  { y: 1510, t: 'Bells get a keyboard', where: 'r:Low Countries', p: 'Flemish and Dutch towns already had clock bells that chimed a warning before the hour struck. Around 1510, in Oudenaarde in Flanders, bells were first recorded as joined to a keyboard. Now a person could play any tune on them.' },
  { y: 1644, t: 'The first carillon in tune', where: 'c:Netherlands', p: 'The brothers François and Pieter Hemony, working with the blind musician Jacob van Eyck, found how to tune each partial of a bell on a lathe. Their first carillon rang in Zutphen in 1644. They went on to cast about fifty.' },
  { y: 1700, t: 'The skill is lost', where: 'r:Low Countries', p: 'After the Hemonys and their pupils died, few founders could tune bells as well. For some two hundred years new carillons often sounded worse than old ones, and interest faded.' },
  { y: 1895, t: 'Tuning rediscovered', where: 'c:England', p: 'In the 1890s an English clergyman, Canon Arthur Simpson, worked out and published how the old bells had been tuned. The Taylor foundry in Loughborough put it into practice, and well-tuned carillons could be made again.' },
  { y: 1922, t: 'A school in Mechelen', where: 'c:Belgium', p: 'Jef Denyn had drawn crowds to his evening recitals in Mechelen since the 1890s. In 1922 he founded the first carillon school there, and its students carried the art abroad.' },
  { y: 1932, t: 'North America joins in', where: 'r:North America', p: 'The first true carillons in North America arrived in 1922. Within ten years donors and universities had built dozens, among them the heaviest ever made, at Riverside Church in New York.' },
  { y: 1945, t: 'Bells lost to war', where: 'r:Europe', p: 'In both world wars bells were seized and melted down for their metal. In the Second World War well over a hundred thousand were taken across occupied Europe, and many carillons were lost. A large share of the Dutch and German carillons on this globe date from the rebuilding that followed.' },
  { y: 1970, t: 'Gifts and memorials', where: 'r:Rest of the world', p: 'After the war carillons spread as memorials and gifts. The Netherlands gave one to the United States in thanks, Britain gave one to Australia, and later ones rose in Japan, the Philippines and South Korea.' },
  { y: 2014, t: 'Recognised as heritage', where: 'c:Belgium', p: 'In 2014 UNESCO recognised Belgium’s work to keep carillon culture alive. About 700 carillons are played around the world today, more than at any time before.' },
];
let histYear = Y1, histTimer = 0;
const inPlace = (where) => CARILLONS.map((c, k) => k).filter((k) => (where[0] === 'r' ? CARILLONS[k].region : CARILLONS[k].country) === where.slice(2));
function historyHtml() {
  return `<p class="year"><b id="hy"></b><span id="hn"></span></p>
<input id="hyear" type="range" min="${Y0}" max="${Y1}" step="1" aria-label="Year">
<p><button class="btn primary" id="hplay" data-hplay="1"></button></p>
<div id="hstory" aria-live="polite"></div>
<h2>Jump to a moment</h2>
<div class="rows">${STORY.map((s, k) => `<button class="row" data-story="${k}"><span>${s.t}</span><span class="meter"><b>${s.y}</b></span></button>`).join('')}</div>
<p class="try">Only the ${DATED.length} carillons with a date in Wikipedia's lists appear here, out of ${CARILLONS.length}. The date is often that of the oldest bells or of the present instrument, and towers that lost their carillon are missing, so the early centuries look emptier than they were. Next steps through them from oldest to newest.</p>`;
}
function fillHistory() {
  if (!$('hyear')) return;
  $('hyear').value = histYear; $('hy').textContent = histYear;
  const n = DATED.filter((k) => CARILLONS[k].yr <= histYear).length;
  $('hn').textContent = n ? `${n} of today's dated carillons ${n === 1 ? 'goes' : 'go'} back this far` : 'None of today\'s dated carillons goes back this far';
  $('hplay').textContent = histTimer ? '❚❚ Pause' : histYear >= Y1 ? '▶ Play five centuries' : '▶ Carry on from ' + histYear;
  const k = STORY.findLastIndex((s) => s.y <= histYear), box = $('hstory');
  if (box.dataset.k !== String(k)) {
    box.dataset.k = k;
    box.innerHTML = k < 0 ? '<h2>Before 1510</h2><p>Tower clocks strike the hours on bells, and a few small bells chime a warning first. Nobody can yet play them like an instrument.</p>'
      : `<h2>${STORY[k].y} · ${STORY[k].t}</h2><p>${STORY[k].p}</p>`;
    moreCheck();
  }
}
function applyHistory() {   // show only the carillons that existed by the chosen year; the newest dozen years glow
  matches = DATED.filter((k) => CARILLONS[k].yr <= histYear);
  atlas.setFilter(new Set(matches), new Set(matches.filter((k) => CARILLONS[k].yr > histYear - 12)));
  fillHistory();
  if (!histTimer) syncHash();
}
function stopHistory() { if (histTimer) { clearInterval(histTimer); histTimer = 0; fillHistory(); syncHash(); } }
function playHistory() {
  if (histTimer) return stopHistory();
  if (histYear >= Y1) { histYear = Y0; atlas.frame([...inPlace('r:Low Countries'), ...inPlace('r:Europe')]); }
  histTimer = setInterval(() => {
    histYear++;
    if (histYear === 1915) atlas.frame([...inPlace('r:Low Countries'), ...inPlace('r:North America')]);   // pull back to take in the Atlantic
    if (histYear === 1950) atlas.frame(null);
    if (histYear >= Y1) { clearInterval(histTimer); histTimer = 0; }
    applyHistory();
  }, 60);
  applyHistory();
}
function openStory(k) {
  stopHistory(); histYear = STORY[k].y; applyHistory();
  atlas.frame(inPlace(STORY[k].where));
}
function openTab(id, draw) {
  stopHistory(); atlasTab = id;
  if (draw) renderAtlas(-1);
  if (id === 'history') applyHistory(); else applyFilter(false);
  if (id === 'quiz' && quiz && !quiz.done && draw) quizShow();
}

/* ───────────────────────── Quiz ───────────────────────── */

// The first answer of each fact is the right one; they are shuffled when shown
const FACTS = [
  ['How few bells can a carillon have?', ['23', '12', '37', '49'], 'With fewer than 23 bells the instrument is called a chime.'],
  ['What moves when a carillon bell rings?', ['Only the clapper inside it', 'The whole bell swings', 'A hammer outside the bell', 'A loudspeaker'], 'The bells are bolted in place. Each baton pulls a wire that swings a clapper.'],
  ['A bell that sounds an octave lower is twice as wide. How much heavier is it?', ['8 times', '2 times', '4 times', '16 times'], 'Weight grows with the cube of the size, which is why low notes cost so much.'],
  ['Which partial gives bells their bittersweet colour?', ['The tierce, a minor third', 'The hum, an octave below', 'The quint, a fifth', 'The nominal, an octave above'], 'Every traditional bell carries a minor third above its main note, even in cheerful music.'],
  ['How are the batons played?', ['With loosely closed fists', 'With the fingertips', 'With mallets', 'With the elbows'], 'The feet play pedals wired to the same low bells.'],
  ['What is bell bronze?', ['About four parts copper to one part tin', 'Copper and zinc', 'Iron and nickel', 'Pure copper'], 'It is hard, brittle and slow to stop ringing.'],
  ['How is a bell tuned after it is cast?', ['Metal is shaved from the inside on a lathe', 'It is reheated and stretched', 'Weights are bolted to the rim', 'The clapper is swapped'], 'Metal cannot be put back, so the tuner must stop in time.'],
  ['Who cast the first well-tuned carillon, in 1644?', ['The Hemony brothers', 'The Taylor foundry', 'Jef Denyn', 'Royal Eijsbouts'], 'It rang in Zutphen, in the Netherlands.'],
  ['What stops a carillon bell sounding once it is struck?', ['Nothing: it rings until it fades', 'A felt damper', 'The player lets go of the baton', 'A pedal'], 'There are no dampers, and the music is written around the long ring.'],
  ['Where did the carillon begin?', ['The Low Countries', 'Italy', 'England', 'Russia'], 'It grew out of clock chimes in what are now Belgium and the Netherlands, in the 1500s.'],
  ['Why is the playing cabin high in the tower, just under the bells?', ['Short wires give a lighter touch', 'So the player can see the street', 'To keep the batons dry', 'Because sound travels downwards'], 'Every baton is tied to its bell by a wire.'],
  ['What did Jef Denyn found in Mechelen in 1922?', ['The first carillon school', 'A bell foundry', 'The first carillon in America', 'A clock factory'], 'Its students carried the art around the world.'],
];
const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BEST = 'carillon-quiz-best';
let quiz = null;
function quizBuild() {
  const idx = shuffle(FEATURED.map((c) => CARILLONS.indexOf(c))), F = (k) => CARILLONS[k], full = (k) => `${F(k).name}, ${F(k).city}`;
  const pair = (ok) => { for (const a of idx) for (const b of idx) if (a !== b && ok(F(a), F(b))) return [a, b]; };
  const qs = shuffle(FACTS).slice(0, 4).map(([q, a, why]) => ({ q, why, opts: shuffle(a.map((label, k) => ({ label, ok: k === 0 }))) }));
  { const [a, b] = pair((x, y) => Math.abs(x.bells - y.bells) >= 6);
    qs.push({ q: 'Which carillon has more bells?', frame: [a, b], visit: F(a).bells > F(b).bells ? a : b,
      opts: [a, b].map((k) => ({ label: full(k), ok: F(k).bells === Math.max(F(a).bells, F(b).bells) })), why: `${F(a).name} has ${F(a).bells} and ${F(b).name} has ${F(b).bells}.` }); }
  { const [a, b] = pair((x, y) => x.heavy && y.heavy && x.heavy / y.heavy >= 2.5);
    const [l, r] = shuffle([a, b]);
    qs.push({ q: 'Listen to the heaviest bells of two real carillons. Which bell is heavier?', hear: [l, r].map((k) => Math.round(estHz(F(k).heavy * 1000))),
      opts: [l, r].map((k, n) => ({ label: `Bell ${'AB'[n]}`, ok: k === a })), visit: a,
      why: `The lower the note, the heavier the bell. Bell ${'AB'[[l, r].indexOf(a)]} is modelled on ${F(a).name}, ${weight(F(a).heavy)}; the other on ${F(b).name}, ${weight(F(b).heavy)}.` }); }
  { const count = CARILLONS.reduce((map, c) => map.set(c.country, (map.get(c.country) || 0) + 1), new Map());
    const four = shuffle([...count].filter((x) => x[1] >= 4)).filter((x, k, all) => all.findIndex((y) => y[1] === x[1]) === k).slice(0, 4), top = Math.max(...four.map((x) => x[1]));
    qs.push({ q: 'Which of these countries has the most carillons on this globe?', opts: four.map(([label, n]) => ({ label, ok: n === top })),
      why: four.sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} ${n}`).join(', ') + '.' }); }
  if (Math.random() < 0.5) {
    const a = idx[0], others = shuffle([...new Set(FEATURED.map((c) => c.country))].filter((c) => c !== F(a).country)).slice(0, 3);
    qs.push({ q: `In which country is this carillon: ${F(a).name}?`, visit: a, opts: shuffle([F(a).country, ...others]).map((label) => ({ label, ok: label === F(a).country })), why: `It is in ${F(a).city}, ${F(a).country}.` });
  } else {
    const [a, b] = pair((x, y) => x.yr && y.yr && y.yr - x.yr >= 40);
    qs.push({ q: 'Which carillon is older?', frame: [a, b], visit: a, opts: shuffle([a, b]).map((k) => ({ label: full(k), ok: k === a })), why: `${F(a).name} dates from ${F(a).yr}, ${F(b).name} from ${F(b).yr}.` });
  }
  return shuffle(qs);
}
function quizHtml() {
  let best = 0; try { best = +localStorage.getItem(BEST) || 0; } catch (err) { /* private window */ }
  if (!quiz) return `<p>Eight quick questions about how a carillon works and where the real ones are. Some you answer with your ears.</p>
<p><button class="btn primary" data-quiz="start">Start the quiz</button></p>${best ? `<p class="try">Your best so far: ${best} of 8.</p>` : ''}`;
  if (quiz.done) return `<p class="year"><b>${quiz.score} / ${quiz.qs.length}</b><span>${quiz.score >= 7 ? 'Carillonneur material.' : quiz.score >= 4 ? 'A good ear for bells.' : 'Climb the tower once more and try again.'}</span></p>
<p><button class="btn primary" data-quiz="start">Play again</button> <button class="btn" data-mode="tower">Back to the bell tower</button></p>
<p class="try">Your best so far: ${best} of 8. The questions change every round.</p>`;
  const q = quiz.qs[quiz.at], done = quiz.picked >= 0;
  return `<p class="count">Question ${quiz.at + 1} of ${quiz.qs.length} · ${quiz.score} right so far</p>
<p><b>${esc(q.q)}</b></p>
${q.hear ? `<div class="stack two">${q.hear.map((hz, n) => `<button class="btn" data-hear="${hz}">▶ Bell ${'AB'[n]}</button>`).join('')}</div>` : ''}
<div class="rows">${q.opts.map((o, n) => `<button class="row card${done && o.ok ? ' right' : done && n === quiz.picked ? ' wrong' : ''}" data-quiz="${n}" ${done ? 'disabled' : ''}><span>${esc(o.label)}</span></button>`).join('')}</div>
${done ? `<p class="try" role="status">${q.opts[quiz.picked].ok ? 'Right.' : 'Not quite.'} ${esc(q.why)}</p>
<p><button class="btn primary" data-quiz="next">${quiz.at + 1 < quiz.qs.length ? 'Next question' : 'See your score'}</button>${q.visit !== undefined ? ` <button class="btn" data-atlas="${q.visit}">Visit ${esc(CARILLONS[q.visit].name)}</button>` : ''}</p>` : ''}`;
}
function quizShow() {   // turn the globe to the towers a question is about
  const q = quiz.qs[quiz.at];
  if (q?.frame && atlas.selected < 0 && quiz.picked < 0) atlas.frame(q.frame);
}
function quizClick(what) {
  if (what === 'start') quiz = { qs: quizBuild(), at: 0, score: 0, picked: -1, done: false };
  else if (what === 'next') {
    quiz.picked = -1;
    if (++quiz.at >= quiz.qs.length) {
      quiz.done = true;
      try { localStorage.setItem(BEST, Math.max(quiz.score, +localStorage.getItem(BEST) || 0)); } catch (err) { /* private window */ }
    }
  } else if (quiz.picked < 0) { quiz.picked = +what; if (quiz.qs[quiz.at].opts[quiz.picked].ok) quiz.score++; }
  renderAtlas(-1);
  if (!quiz.done && what !== String(quiz.picked)) quizShow();
}

/* ───────────────────────── Links that remember where you are ───────────────────────── */

// The address after # records the stop, tab, filters and carillon, so a reload or a shared link opens the same view
const slugOf = (c) => `${c.name} ${c.city}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function syncHash() {
  if (restoring) return;
  const p = new URLSearchParams();
  if (mode === 'tower') { if (cur) p.set('stop', cur + 1); }
  else {
    p.set('view', mode === 'site' ? 'closeup' : 'globe');
    if (atlasTab !== 'towers') p.set('tab', atlasTab);
    if (atlasTab === 'history' && histYear < Y1) p.set('year', histYear);
    if (filter.q) p.set('q', filter.q);
    if (filter.where) p.set('where', filter.where);
    if (filter.min) p.set('min', filter.min);
    if (filter.featured) p.set('featured', 1);
    if (filter.recorded) p.set('recorded', 1);
    if (atlas.selected >= 0) p.set('c', slugOf(CARILLONS[atlas.selected]));
  }
  try { history.replaceState(null, '', '#' + p); } catch (err) { /* some browsers refuse this for pages opened from disk */ }
}
function restoreFromHash() {
  const p = new URLSearchParams(location.hash.slice(1)), stop = +p.get('stop');
  goTo(stop >= 1 && stop <= STOPS.length ? stop - 1 : 0, true);
  if (p.get('view')) {
    filter.q = p.get('q') || ''; filter.where = p.get('where') || ''; filter.min = +p.get('min') || 0; filter.featured = !!p.get('featured'); filter.recorded = !!p.get('recorded');
    if (['history', 'records', 'cost', 'quiz'].includes(p.get('tab'))) atlasTab = p.get('tab');
    const y = +p.get('year'); if (y >= Y0 && y <= Y1) histYear = y;
    setMode('atlas');
    if (atlasTab === 'history') applyHistory(); else applyFilter(true);
    const i = CARILLONS.findIndex((c) => slugOf(c) === p.get('c'));
    if (i >= 0) { atlas.select(i); if (p.get('view') === 'closeup' && CARILLONS[i].featured) setMode('site'); }
  }
  restoring = false;
}
$('share').onclick = async () => {
  const say = (t) => { $('share').textContent = t; setTimeout(() => { $('share').textContent = 'Copy link'; }, 2200); };
  try { await navigator.clipboard.writeText(location.href); say('Link copied'); } catch (err) { say('Copy it from the address bar'); }
};
const showMotion = () => { $('motion').textContent = calm ? 'Motion: off' : 'Motion: on'; $('motion').setAttribute('aria-pressed', !calm); };
$('motion').onclick = () => {
  calm = !calm; showMotion();
  try { localStorage.setItem('carillon-motion', calm ? 'off' : 'on'); } catch (err) { /* private window */ }
};
showMotion();
// Compact screens: the guide panel folds away, and the extra controls live in a menu
$('fold').onclick = () => {
  const min = panel.classList.toggle('min');
  $('fold').textContent = min ? '▾' : '▴'; $('fold').setAttribute('aria-expanded', !min); $('fold').setAttribute('aria-label', min ? 'Show the text' : 'Hide the text');
  layout();
};
const openMore = (on) => { $('more').classList.toggle('on', on); $('moreBtn').setAttribute('aria-expanded', on); };
$('moreBtn').onclick = () => { openTunes(false); openMore(!$('more').classList.contains('on')); };
$('more').addEventListener('click', (e) => { if (e.target.closest('#xray, #recenter')) openMore(false); });   // these change the view, so get out of its way
if (touchy) $('atlasHint').textContent = 'Drag to spin · Pinch to zoom · Tap a tower';
{ const strip = $('kbwrap'); if (strip.scrollWidth > strip.clientWidth + 4) strip.scrollLeft = keyEls[12].offsetLeft - 24; }   // start the phone's batons at C4

$('typing').onclick = () => {
  typing = !typing; showTyping();
  try { localStorage.setItem('carillon-typing', typing ? 'on' : 'off'); } catch (err) { /* private window */ }
};
showTyping();
$('volume').value = Math.round(volume * 100);
$('volume').oninput = (e) => {
  volume = e.target.value / 100; if (master) master.gain.value = 0.45 * volume;
  if (realAudio) realAudio.volume = volume;
  try { localStorage.setItem('carillon-volume', volume); } catch (err) { /* private window */ }
};

atlasBtn.onclick = () => setMode(mode === 'tower' ? 'atlas' : 'tower');
applyFilter(false);   // sort the full list once at the start

restoreFromHash();
requestAnimationFrame(frame);

// Debug handle for the console
window.carillon = { bells, play, goTo, camera, controls, atlas, site, setMode, renderer, composer };

})();

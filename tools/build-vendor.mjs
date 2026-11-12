// Builds the vendor/ folder, so the app runs with no internet connection and straight from disk:
//   vendor/three.bundle.js  three.js and the add-ons the app uses, as one ordinary script (window.CARILLON_3D)
//   vendor/earth.js         the Earth photo for the globe, as a data address (window.EARTH_IMAGE)
//   vendor/countries.js     country outlines (window.COUNTRY_SHAPES)
// They are plain scripts, not modules or data files, because browsers refuse to load modules, images for 3D, or
// JSON from a page opened from disk.
// Run from the project folder, once, with a connection:  node tools/build-vendor.mjs
// three.js: MIT licence. Earth photo: from the three.js examples (NASA imagery). Outlines: world-atlas (Natural Earth, public domain).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const THREE_VERSION = '0.170.0', ATLAS_VERSION = '2.0.2';
const out = resolve('vendor'), work = mkdtempSync(join(tmpdir(), 'carillon-vendor-'));
mkdirSync(out, { recursive: true });
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: work, stdio: 'inherit' });   // arguments are passed as a list, never through a shell

run('npm', 'init', '-y', '--silent');
// Exact versions, and no install scripts from the packages: esbuild's program arrives as an ordinary dependency
run('npm', 'install', '--silent', '--no-audit', '--no-fund', '--ignore-scripts', `three@${THREE_VERSION}`, `world-atlas@${ATLAS_VERSION}`, 'esbuild@0.24.0');

// 1. three.js and its add-ons
writeFileSync(join(work, 'entry.js'), `
export * as THREE from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
export { LineMaterial } from 'three/addons/lines/LineMaterial.js';
export { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
export { Sky } from 'three/addons/objects/Sky.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
export { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
`);
run('npx', 'esbuild', 'entry.js', '--bundle', '--minify', '--format=iife', '--global-name=CARILLON_3D', '--legal-comments=inline', `--outfile=${join(out, 'three.bundle.js')}`);

// 2. The Earth photo, embedded so that it also loads when the page is opened from disk
const photo = await fetch(`https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/earth_day_4096.jpg`);
if (!photo.ok) throw new Error('Earth photo: HTTP ' + photo.status);
writeFileSync(join(out, 'earth.js'), '// The Earth by day, from the three.js examples (NASA imagery). Built by tools/build-vendor.mjs.\n'
  + `window.EARTH_IMAGE = 'data:image/jpeg;base64,${Buffer.from(await photo.arrayBuffer()).toString('base64')}';\n`);

// 3. Country outlines
const shapes = readFileSync(join(work, 'node_modules/world-atlas/countries-50m.json'), 'utf8');
writeFileSync(join(out, 'countries.js'), '// Country outlines at 1:50m from world-atlas (Natural Earth, public domain). Built by tools/build-vendor.mjs.\n'
  + `window.COUNTRY_SHAPES = ${shapes.trim()};\n`);

rmSync(work, { recursive: true, force: true });
console.log('vendor/ is ready');

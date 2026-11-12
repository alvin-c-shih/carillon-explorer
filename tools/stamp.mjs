// Stamps each local script in index.html with a short fingerprint of its contents (main.js?v=1a2b3c4d).
// A browser that has an old copy of a script then fetches the new one as soon as it loads the new page, so the
// page and its code can never be out of step. Run before every commit that changes a script:
//   node tools/stamp.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('index.html', 'utf8'), n = 0;
html = html.replace(/<script src="([^"?:]+)(?:\?v=[0-9a-f]+)?"><\/script>/g, (all, file) => {
  const v = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
  n++;
  return `<script src="${file}?v=${v}"></script>`;
});
writeFileSync('index.html', html);
console.log(`stamped ${n} scripts`);

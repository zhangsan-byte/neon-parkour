/* 校验代码里引用的调色板键是否都存在（避免 undefined 颜色这类低级错误） */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = join(HERE, '..', 'js');

const core = readFileSync(join(JS, '00_core.js'), 'utf8');
const palette = {};
for (const grp of ['pastel', 'neon']) {
  const m = core.match(new RegExp(grp + ':\\s*\\{([^}]*)\\}'));
  if (!m) { console.log('!! 找不到分组 ' + grp); continue; }
  palette[grp] = m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
}
const top = ['skyTop', 'skyBottom', 'fog', 'ink', 'cream', 'white'];
console.log('pastel:', palette.pastel.join(', '));
console.log('neon  :', palette.neon.join(', '));

const bad = [];
for (const f of readdirSync(JS)) {
  const src = readFileSync(join(JS, f), 'utf8');
  for (const m of src.matchAll(/PAL\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) {
    const g = m[1], k = m[2];
    if (!palette[g] || !palette[g].includes(k)) bad.push(`${f}: PAL.${g}.${k}`);
  }
  for (const m of src.matchAll(/PAL\.([a-zA-Z]+)(?![a-zA-Z.])/g)) {
    const k = m[1];
    if (!top.includes(k) && !palette[k]) bad.push(`${f}: PAL.${k}`);
  }
}
console.log(bad.length ? 'BAD KEYS:\n' + [...new Set(bad)].join('\n') : '✓ 调色板键全部有效');
process.exit(bad.length ? 1 : 0);

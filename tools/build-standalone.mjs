/* =========================================================================
 * 打包单文件版：把 three.js 和全部游戏脚本内联进一个 HTML
 * 产物：dist/neon-parkour.html —— 双击即可离线运行（无外部依赖）
 * 用法: node tools/build-standalone.mjs
 * ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'dist');

const JS_ORDER = [
  'js/00_core.js',
  'js/10_audio.js',
  'js/20_board.js',
  'js/30_fx.js',
  'js/40_world.js',
  'js/50_player.js',
  'js/60_game.js'
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');   // 防止提前闭合脚本标签

let html = read('index.html');

// 1) 内联 three.js
const three = safe(read('three.min.js'));
html = html.replace(
  /<script src="three\.min\.js"><\/script>/,
  `<script>/* three.js r149 (MIT) —— 内联以便离线单文件运行 */\n${three}\n</script>`
);

// 2) 内联游戏脚本
for (const f of JS_ORDER) {
  const tag = `<script src="${f}"></script>`;
  if (!html.includes(tag)) throw new Error('index.html 中找不到脚本标签: ' + tag);
  html = html.replace(tag, `<script>\n/* ${f} */\n${safe(read(f))}\n</script>`);
}

// 3) 标注为单文件产物
html = html.replace('<title>', '<!-- 单文件版：three.js 与全部逻辑已内联，可离线双击运行 -->\n<title>');

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'neon-parkour.html');
writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('✓ 已生成 ' + out + ' (' + kb + ' KB)');
console.log('  内联脚本: three.min.js + ' + JS_ORDER.length + ' 个模块');

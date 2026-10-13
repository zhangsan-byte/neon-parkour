/* 本地静态服务器：强制 no-store，避免开发时浏览器缓存旧 JS */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] || '.';
const PORT = Number(process.argv[3] || 8899);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^([/\\])+/, ''));
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(403); return res.end('dir'); }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Length': body.length
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + req.url);
  }
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT));

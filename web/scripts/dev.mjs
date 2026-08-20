/**
 * 开发服务器：零依赖静态服务器（node:http，无任何子进程）
 * + fs.watch 监听 src/ 变化自动重新打包。
 */
import http from 'node:http';
import { watch } from 'node:fs';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildOnce, dist, root } from './build-lib.mjs';

const PORT = 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

console.log('initial build...');
await buildOnce(false);
console.log('ready');

let rebuilding = false;
let pending = false;
async function rebuild() {
  if (rebuilding) { pending = true; return; }
  rebuilding = true;
  try {
    await buildOnce(false);
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
  } catch (e) {
    console.error('rebuild failed:', e.message);
  } finally {
    rebuilding = false;
    if (pending) { pending = false; rebuild(); }
  }
}

watch(join(root, 'src'), { recursive: true }, () => void rebuild());

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const safe = normalize(pathname).replace(/^([.][.](\\|\/))+/, '');
  const file = join(dist, safe);
  let body;
  if (!file.startsWith(dist)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  try {
    body = readFileSync(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`➜ http://127.0.0.1:${PORT}`);
});

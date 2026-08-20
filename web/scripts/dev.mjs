/**
 * 开发服务器：零依赖静态服务器（node:http，无任何子进程）
 * + fs.watch 监听 src/ 变化自动重新打包。
 */
import http from 'node:http';
import { watch } from 'node:fs';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
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
  // 路径遍历防护（安全审查 H-1 修复）：
  // 1) 剥离所有前导斜杠——%2f 解码产生的 "//.." 会躲过针对 ".." 开头的正则，
  //    且 Windows 上 join(dist, "\\..\\..") 会从盘符根回溯到 dist 之外；
  // 2) 用 path.relative 做包含判断，不依赖字符串前缀技巧（无 dist-demo 边界歧义）。
  const safe = normalize(pathname).replace(/^[\\/]+/, '');
  const file = join(dist, safe);
  const rel = relative(dist, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes('\0')) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  let body;
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
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`➜ http://127.0.0.1:${PORT}`);
});

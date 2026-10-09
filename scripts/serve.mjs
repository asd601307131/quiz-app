/**
 * 零依赖静态服务器 + 可选 API Mock。
 *
 *   node scripts/serve.mjs            默认 5173 端口
 *   node scripts/serve.mjs 8080       指定端口
 *   node scripts/serve.mjs 8080 --mock 额外开启 /api/* 模拟接口
 *   node scripts/serve.mjs 8080 --local 只监听回环（仅本机访问，最安全）
 *
 * 默认监听 0.0.0.0 与 ::，即 IPv4/IPv6 的所有网卡都能访问；
 * 启动时会列出所有可用地址，并标注哪些地址当前真的可达。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5173);
const mockEnabled = args.includes('--mock');
const localOnly = args.includes('--local');
// 默认 '::' 为 IPv6 未指定地址，在双栈下同时接受 IPv4 与 IPv6 连接，
// 因此 localhost / 127.0.0.1 / [::1] / 局域网 IP 都能访问。
const host = localOnly ? '127.0.0.1' : (process.env.HOST || '::');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.map': 'application/json; charset=utf-8',
};

/** 下载类文件加 Content-Disposition，便于浏览器直接保存 */
const DOWNLOAD_EXT = new Set(['.csv', '.xlsx', '.xls', '.zip']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

/** 极简 mock：让 ?api=<本机地址> 时前端走「远端模式」 */
async function handleMockApi(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, mode: 'mock' });

  if (pathname === '/api/chapters' || pathname === '/api/questions') {
    const mod = await import(path.join(ROOT, 'src/data/questions.js'));
    if (pathname === '/api/chapters') {
      return sendJson(
        res,
        200,
        mod.CHAPTERS.map((c) => ({ ...c, stats: mod.chapterStats(c.id) }))
      );
    }
    const chapterId = url.searchParams.get('chapterId');
    const difficulty = url.searchParams.get('difficulty');
    return sendJson(
      res,
      200,
      mod.QUESTIONS.filter(
        (q) => (!chapterId || q.chapterId === chapterId) && (!difficulty || q.difficulty === difficulty)
      )
    );
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => sendJson(res, 200, { ok: true, received: body.length }));
    return undefined;
  }

  if (pathname === '/api/wrong' && req.method === 'POST') {
    req.resume();
    req.on('end', () => sendJson(res, 200, { ok: true }));
    return undefined;
  }

  return sendJson(res, 404, { ok: false, error: 'mock 未实现该接口' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (mockEnabled && url.pathname.startsWith('/api/')) {
    try {
      await handleMockApi(req, res, url);
    } catch (err) {
      console.error('[mock] 处理失败', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(err) });
    }
    return;
  }

  let filePath = decodeURIComponent(url.pathname);
  if (filePath.endsWith('/')) filePath += 'index.html';
  const abs = path.join(ROOT, path.normalize(filePath));

  // 防目录穿越
  if (!abs.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      // 单页应用回退：未知路径返回 index.html
      const indexPath = path.join(ROOT, 'index.html');
      fs.readFile(indexPath, (e2, buf) => {
        if (e2) return send(res, 404, 'Not Found');
        send(res, 200, buf, { 'Content-Type': MIME['.html'] });
      });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    fs.readFile(abs, (e2, buf) => {
      if (e2) return send(res, 500, 'Read Error');
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (DOWNLOAD_EXT.has(ext)) {
        const name = path.basename(abs);
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
      }
      send(res, 200, buf, headers);
    });
  });
});

/** 收集本机可用的 IPv4 地址，并标注网卡是否处于连接状态 */
function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const linkLocal = item.address.startsWith('169.254.');
      out.push({ name, address: item.address, linkLocal });
    }
  }
  return out;
}

server.listen(port, host, () => {
  const addrs = localAddresses();
  const usable = addrs.filter((a) => !a.linkLocal);

  console.log(`\n  答题闯关 · 本地服务已启动 ${host}:${port}`);
  console.log(`  本机访问:   http://localhost:${port}/`);
  if (addrs.length) {
    console.log(`  其他设备:   （需与本机在同一局域网，且本机防火墙放行 node）`);
    for (const a of addrs) {
      const tag = a.linkLocal ? '  ← 未联网，手机连不上' : '';
      console.log(`              http://${a.address}:${port}/   [网卡: ${a.name}]${tag}`);
    }
    if (!usable.length) {
      console.log('              ⚠ 当前没有已联网的网卡（WiFi/以太网均未连接），手机无法访问；');
      console.log('                请先让本机连上 WiFi，再重启本服务获取正确地址。');
    }
  }
  if (mockEnabled) {
    console.log(`  Mock 接口:  http://localhost:${port}/?api=http://localhost:${port}  (前端将走远端模式)`);
  }
  if (localOnly) console.log('  当前为 --local 模式：仅本机可访问');
  console.log(`  停止服务:   Ctrl + C\n`);
});

/* ============================================================
 *  offline-check.mjs — 인터넷 없이 게임이 뜨는지 확인한다.
 *
 *  로컬 서버는 살아 있고 외부 네트워크만 끊긴 상황을 재현한다.
 *  현재는 three.js 를 CDN 에서 받으므로 실행 자체가 되지 않는다.
 *  의존성을 저장소에 넣기로 한다면 이 스크립트로 검증하면 된다.
 *
 *  실행:  cd test && npm run offline
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8412;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, rep) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rep.writeHead(404); return rep.end('nf'); }
  rep.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rep);
});
await new Promise(r => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage();

// 캐시를 비우고, localhost 이외의 모든 요청을 끊는다 = 인터넷 없음
await page.setCacheEnabled(false);
await page.setRequestInterception(true);
const blocked = [];
page.on('request', r => {
  const u = r.url();
  if (u.startsWith(`http://localhost:${PORT}`) || u.startsWith('data:')) return r.continue();
  blocked.push(u.replace(/^https:\/\//, '').slice(0, 60));
  r.abort();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

await page.goto(`http://localhost:${PORT}/play/`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2500));

const state = await page.evaluate(() => ({
  PENGUIN: typeof window.PENGUIN,
  canvasHasGL: (() => { try { return !!document.getElementById('game').getContext('webgl2'); } catch { return 'n/a'; } })(),
  titleVisible: !document.getElementById('scr-title').classList.contains('hidden'),
  startBtn: !!document.getElementById('btn-start'),
}));

console.log('--- 오프라인 (인터넷 차단, 로컬 서버만) ---');
console.log('window.PENGUIN     :', state.PENGUIN);
console.log('타이틀 화면 표시   :', state.titleVisible);
console.log('차단된 외부 요청   :', [...new Set(blocked)].join('\n                     '));
console.log('에러               :', errors.length ? errors.join('\n                     ') : '없음');

// 게임이 실제로 시작되는지 (키보드 모드)
const canPlay = await page.evaluate(() => {
  try {
    if (typeof window.PENGUIN !== 'object') return 'PENGUIN 없음 — 스크립트가 아예 실행되지 않음';
    window.PENGUIN.quickStart('key');
    for (let i = 0; i < 60; i++) window.PENGUIN.step(1 / 60);
    return '이동 거리 ' + Math.round(window.PENGUIN.state.dist) + 'm';
  } catch (e) { return '실패: ' + e.message.slice(0, 80); }
});
console.log('키보드 모드 시작   :', canPlay);

await browser.close();
server.close();

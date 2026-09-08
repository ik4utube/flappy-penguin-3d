/* ============================================================
 *  shots.mjs — README / 랜딩 페이지용 스크린샷 자동 생성
 *
 *  실제 게임을 헤드리스 Chrome 으로 띄워 각 화면을 캡처한다.
 *  손으로 찍지 않으므로 UI 를 고치면 다시 돌리기만 하면 된다.
 *
 *  실행:  cd test && npm run shots
 *  결과:  shots/*.png
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const PORT = 8408;
const W = 1280, H = 720;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && fs.existsSync(p));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rep) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rep.writeHead(404); return rep.end('not found');
      }
      rep.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rep);
    });
    s.listen(PORT, () => res(s));
  });
}

/* 화면 전환 애니메이션과 커서 깜빡임은 캡처 타이밍을 흔든다 */
const FREEZE = `
  const st = document.createElement('style');
  st.textContent = '.screen{animation:none !important;opacity:1 !important}' +
                   '#story-text::after{content:"" !important}' +
                   '.press-start{animation:none !important;opacity:1 !important}';
  document.head.appendChild(st);
`;

/* 사람 대신 대본 랜드마크를 넣어 웹캠 패널이 실제로 인식 중인 것처럼 보이게 한다 */
const FAKE_POSE = `
window.__fake = function () {
  const c = window.PENGUIN.ctrl;
  if (!c || !c.landmarker) return false;
  const mk = (ly, ry) => {
    const a = [];
    for (let i = 0; i < 33; i++) a.push({ x: .5, y: .5, z: 0, visibility: .99 });
    a[11] = { x: .62, y: .42, z: 0, visibility: .99 };
    a[12] = { x: .38, y: .42, z: 0, visibility: .99 };
    a[13] = { x: .76, y: .40, z: 0, visibility: .99 };
    a[14] = { x: .24, y: .46, z: 0, visibility: .99 };
    a[23] = { x: .58, y: .74, z: 0, visibility: .99 };
    a[24] = { x: .42, y: .74, z: 0, visibility: .99 };
    a[15] = { x: .88, y: ly, z: 0, visibility: .99 };
    a[16] = { x: .12, y: ry, z: 0, visibility: .99 };
    a[17] = { x: .90, y: ly + .03, z: 0, visibility: .95 };
    a[19] = { x: .91, y: ly + .01, z: 0, visibility: .95 };
    a[18] = { x: .10, y: ry + .03, z: 0, visibility: .95 };
    a[20] = { x: .09, y: ry + .01, z: 0, visibility: .95 };
    return a;
  };
  // 손목을 2.5Hz 로 흔들어 실제 '날갯짓' 신호를 만든다.
  // 고정 포즈로 두면 양력이 0 이라 촬영 도중 펭귄이 추락한다.
  const t0 = performance.now();
  c.landmarker = {
    detectForVideo: () => {
      const t = (performance.now() - t0) / 1000;
      const w = Math.sin(t * 2 * Math.PI * 2.5) * 0.07;
      return { landmarks: [mk(0.36 + w, 0.54 + w)], worldLandmarks: [] };   // 오른팔이 낮음 → 우선회
    },
  };
  return true;
};
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = await serve();
fs.mkdirSync(OUT, { recursive: true });
if (!CHROME) { console.error('Chrome 을 찾지 못했습니다.'); process.exit(2); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--hide-scrollbars',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

const shot = async (name, note = '', clip = null) => {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ✓ shots/${name}.png  ${kb}KB  ${note}`);
};

/** HUD 배너를 지운다. 시뮬레이션 시간만 돌리면 실제 시간이 흐르지 않아
 *  배너 타이머가 만료되지 않고, opacity 트랜지션에도 실제 시간이 필요하다. */
const clearBanner = async () => {
  await page.evaluate(() => {
    const el = document.getElementById('state-msg');
    el.classList.remove('show');
    el.style.transition = 'none';
  });
  await sleep(120);
};

/** 게임 화면(3D)은 rAF 로 그려지므로 원하는 만큼 프레임을 진행시킨 뒤 찍는다 */
const advance = (frames, mode = 'preview') =>
  page.evaluate((n, m) => {
    for (let i = 0; i < n; i++) m === 'preview' ? window.PENGUIN.preview(1 / 60) : window.PENGUIN.step(1 / 60);
  }, frames, mode);

try {
  console.log('스크린샷 생성 중...');

  /* ---------- 1. 타이틀 ---------- */
  await page.goto(`http://localhost:${PORT}/play/`, { waitUntil: 'networkidle2' });
  await page.evaluate(FREEZE);
  await page.evaluate(FAKE_POSE);
  await page.evaluate(() => document.fonts.ready);
  await advance(600);
  await shot('title', '타이틀');

  /* ---------- 2. 프롤로그 ---------- */
  await page.click('#btn-start');
  await sleep(1600);                       // 첫 문단이 다 찍힐 때까지
  await advance(120);
  await shot('prologue', '프롤로그');

  /* ---------- 3. 캐릭터 선택 (6종) ---------- */
  await page.click('#btn-story-skip');
  const ids = await page.evaluate(async () => {
    const m = await import('../js/characters.js');
    return m.CHARACTERS.map(c => c.id);
  });
  // 캐릭터 카드용 — 주변 UI 를 잠시 숨기고 펭귄만 잘라낸다.
  // (그냥 크롭하면 오른쪽 정보 패널이 잘려 들어간다)
  const CARD = { x: 355, y: 250, width: 570, height: 340 };
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'card-mode';
    st.textContent = '.sel-head,.sel-left,.sel-right,.sel-foot,.portrait-stage{visibility:hidden !important}';
    document.head.appendChild(st);
  });
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate(n => window.PENGUIN.ui.select(n), i);
    await advance(240);                    // 카메라가 정면에 자리잡을 시간
    await shot('card-' + ids[i], ids[i], CARD);
  }
  await page.evaluate(() => document.getElementById('card-mode').remove());
  await page.evaluate(() => window.PENGUIN.ui.select(0));
  await advance(240);
  await shot('select', '캐릭터 선택 화면');

  /* ---------- 4. 조작 안내 ---------- */
  await page.click('#btn-sel-ok');
  await advance(60);
  await shot('howto', '조작 안내');

  /* ---------- 5. 게임 플레이 (키보드) ---------- */
  await page.click('#btn-key');
  await page.evaluate(() => {
    const P = window.PENGUIN;
    P.ctrl = { roll: .34, flap: .52, tracked: true, landmarks: null, update() {} };
    P.state.pos.set(0, 78, 0); P.state.invuln = 9999;
  });
  await advance(420, 'step');
  await clearBanner();
  await shot('play', '플레이 (3인칭)');

  // 랜딩 히어로 배경용 — HUD 를 빼서 소개 페이지 UI 와 섞이지 않게 한다
  await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
  await advance(200, 'step');
  await shot('hero', '히어로 배경 (HUD 없음)');
  await page.evaluate(() => { document.getElementById('hud').style.visibility = ''; });

  /* ---------- 6. 웹캠 모드 (대본 포즈로 스켈레톤 표시) ---------- */
  await page.goto(`http://localhost:${PORT}/play/`, { waitUntil: 'networkidle2' });
  await page.evaluate(FREEZE);
  await page.evaluate(FAKE_POSE);
  await page.evaluate(() => window.PENGUIN.ui.select(3));
  await page.evaluate(() => window.PENGUIN.quickStart('cam'));
  await page.waitForFunction(() => window.PENGUIN.state.running && window.PENGUIN.ctrl.landmarker,
                             { timeout: 90000, polling: 300 });
  await page.evaluate(() => window.__fake());
  await sleep(1200);                       // 대본 랜드마크가 컨트롤러까지 흐르도록
  await page.evaluate(() => {
    const P = window.PENGUIN;
    P.state.pos.set(0, 62, 0); P.state.invuln = 9999;
  });
  await advance(240, 'step');
  await clearBanner();
  await shot('webcam', '웹캠 모드 + 스켈레톤');

  console.log(`\n완료 — ${fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length}장`);
} catch (e) {
  console.error('실패:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

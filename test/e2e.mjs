/* ============================================================
 *  e2e.mjs — 웹캠 경로 전체를 실제 Chrome에서 검증한다.
 *
 *  Chrome을 --use-fake-device-for-media-stream 으로 띄워
 *  getUserMedia → MediaPipe Pose → 조작 신호 → 비행 물리
 *  까지 실제 게임 루프(rAF) 위에서 돌려보고 결과를 단언한다.
 *
 *  실행:  npm test            (test/ 폴더에서)
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8399;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/* ---------------- 아주 작은 테스트 러너 ---------------- */
let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  (ok ? pass++ : fail++);
  results.push({ ok, name, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? '   → ' + detail : ''}`);
}
function section(t) { console.log(`\n\x1b[36m${t}\x1b[0m`); }

/* ---------------- 정적 서버 ---------------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.json': 'application/json' };
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

/* ---------------- 브라우저에 주입할 헬퍼 ----------------
 * 실제 사람 대신, 대본대로 움직이는 랜드마크를 만들어
 * MediaPipe의 detectForVideo 출력 자리에 끼워넣는다.
 * (신경망 자체를 제외한 나머지 경로는 전부 진짜로 돈다)
 */
const INJECT = `
window.__pose = { mode: 'none', t0: performance.now(), calls: 0 };

window.__makeLandmarks = function (wristLy, wristRy) {
  const a = [];
  for (let i = 0; i < 33; i++) a.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 });
  a[11] = { x: 0.60, y: 0.40, z: 0, visibility: 0.99 };  // 본인 기준 왼쪽 어깨
  a[12] = { x: 0.40, y: 0.40, z: 0, visibility: 0.99 };  // 오른쪽 어깨
  a[13] = { x: 0.72, y: 0.40, z: 0, visibility: 0.99 };  // 팔꿈치
  a[14] = { x: 0.28, y: 0.40, z: 0, visibility: 0.99 };
  a[23] = { x: 0.58, y: 0.70, z: 0, visibility: 0.99 };  // 골반
  a[24] = { x: 0.42, y: 0.70, z: 0, visibility: 0.99 };
  a[15] = { x: 0.85, y: wristLy, z: 0, visibility: 0.99 }; // 왼 손목
  a[16] = { x: 0.15, y: wristRy, z: 0, visibility: 0.99 }; // 오른 손목
  return a;
};

// 대본: 시간에 따른 양 손목 높이 (y가 클수록 아래)
window.__script = function (mode, t) {
  const flap = 0.14 * Math.sin(2 * Math.PI * 2.5 * t);   // 2.5Hz 날갯짓
  switch (mode) {
    case 'level':      return [0.40, 0.40];                    // 양팔 수평
    case 'rightDown':  return [0.40, 0.62];                    // 오른팔 내림
    case 'leftDown':   return [0.62, 0.40];                    // 왼팔 내림
    case 'flap':       return [0.40 + flap, 0.40 + flap];      // 파닥파닥
    case 'still':      return [0.40, 0.40];                    // 가만히
    default:           return null;                            // 사람 없음
  }
};

// PoseController가 들고 있는 landmarker를 대본용 스텁으로 통째로 교체한다.
// (원본은 보관해두고 mode='real' 일 때 그대로 위임)
window.__hijack = function () {
  const c = window.PENGUIN.ctrl;
  if (!c || !c.landmarker) return false;
  if (!c.__realLandmarker) c.__realLandmarker = c.landmarker;
  c.landmarker = {
    detectForVideo: function (video, ts) {
      window.__pose.calls++;
      const S = window.__pose;
      if (S.mode === 'real') return c.__realLandmarker.detectForVideo(video, ts);
      const w = window.__script(S.mode, (performance.now() - S.t0) / 1000);
      const lm = w ? window.__makeLandmarks(w[0], w[1]) : null;   // 손목 높이 → 33개 랜드마크
      return { landmarks: lm ? [lm] : [], worldLandmarks: [] };
    },
  };
  return c.landmarker.detectForVideo !== undefined;
};

window.__setMode = function (m) {
  window.__pose.mode = m;
  window.__pose.t0 = performance.now();
};

// 각 구간을 공정하게 비교하기 위한 초기화
window.__reset = function (y) {
  const s = window.PENGUIN.state;
  s.pos.set(0, y, 0); s.yaw = 0; s.vy = 0; s.dist = 0; s.fish = 0;
  s.crash = 0; s.invuln = 9999;      // 구간 중 충돌로 튕기지 않게
  return true;
};

window.__snap = function () {
  const s = window.PENGUIN.state, c = window.PENGUIN.ctrl;
  return { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw,
           roll: c.roll, flap: c.flap, tracked: c.tracked,
           rawRoll: c._rawRoll, ema: c._flapEma, calls: window.__pose.calls };
};
`;

/* ---------------- 본체 ---------------- */
const server = await serve();
const exe = CHROME_CANDIDATES.find(p => p && fs.existsSync(p));
if (!exe) { console.error('Chrome을 찾지 못했습니다.'); process.exit(2); }
console.log(`브라우저: ${exe}`);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: [
    '--use-fake-device-for-media-stream',   // 합성 카메라 (권한 대화상자 없음)
    '--use-fake-ui-for-media-stream',       // 권한 자동 허용
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',          // headless에서 WebGL
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-sandbox',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 620 });

const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
const BENIGN = [/TensorFlow Lite XNNPACK/, /GL version/, /^INFO:/, /favicon/];
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (BENIGN.some(re => re.test(t))) return;   // MediaPipe wasm 의 INFO 로그
  consoleErrors.push('console: ' + t);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  /* ===== 1. 로드 + 화면 흐름 ===== */
  section('1. 타이틀 → 프롤로그 → 캐릭터 선택');
  await page.goto(`http://localhost:${PORT}/play/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(INJECT);
  const vis = id => page.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);

  check('타이틀 화면이 표시된다', await vis('scr-title'));
  check('Three.js 씬이 생성됐다', await page.evaluate(() => !!window.PENGUIN && !!window.PENGUIN.world));
  check('픽셀 폰트가 적용됐다', await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('12px Galmuri11') || document.fonts.check('12px "Press Start 2P"');
  }));

  await page.click('#btn-start');
  check('PRESS START → 프롤로그로 넘어간다', await vis('scr-story'));
  await sleep(700);
  check('프롤로그가 한 글자씩 찍힌다',
        (await page.$eval('#story-text', el => el.textContent)).length > 3);

  await page.click('#btn-story-skip');
  check('캐릭터 선택 화면이 열린다', await vis('scr-select'));

  const roster = await page.$$eval('#roster .slot', els => els.length);
  check('캐릭터 명단이 채워진다', roster === 6, `${roster}명`);

  // 캐릭터를 바꾸면 이름·스토리·스탯·3D 모델·성능 배율이 모두 따라온다
  const charA = await page.evaluate(() => ({
    name: document.getElementById('ch-name').textContent,
    perf: { ...window.PENGUIN.perf },
    uuid: window.PENGUIN.penguin.root.uuid,
  }));
  await page.evaluate(() => window.PENGUIN.ui.select(2));   // 검은바위 (속도 5 / 선회 2 / 양력 2)
  const charB = await page.evaluate(() => ({
    name: document.getElementById('ch-name').textContent,
    title: document.getElementById('ch-title').textContent,
    story: document.getElementById('ch-story').textContent,
    pips: document.querySelectorAll('#pip-speed b.on').length,
    perf: { ...window.PENGUIN.perf },
    uuid: window.PENGUIN.penguin.root.uuid,
  }));
  check('캐릭터를 바꾸면 이름과 스토리가 바뀐다',
        charB.name !== charA.name && charB.title.length > 0 && charB.story.length > 20,
        `${charA.name} → ${charB.name}`);
  check('스탯 표시가 캐릭터를 따라간다', charB.pips === 5, `속도 ${charB.pips}/5`);
  check('성능 배율이 실제로 바뀐다', charB.perf.speed > charA.perf.speed,
        `speed ${charA.perf.speed.toFixed(2)} → ${charB.perf.speed.toFixed(2)}`);
  check('3D 모델이 교체된다', charB.uuid !== charA.uuid);

  // 얼굴 부품을 머리의 +Z 쪽에 붙이면 부리가 몸통을 향해 펭귄이 뒤로 나는 꼴이 된다.
  // 캐릭터 선택 화면에서 얼굴이 안 보이는 것도 같은 원인이었다.
  const facing = await page.evaluate(() => {
    const P = window.PENGUIN, root = P.penguin.root, s = P.state;
    for (let i = 0; i < 200; i++) P.preview(1 / 60);      // 카메라를 자리잡게
    root.updateMatrixWorld(true);
    let beak = null;
    root.traverse(o => {
      if (o.isMesh && o.geometry.type === 'ConeGeometry' && o.geometry.parameters.radialSegments === 5) beak = o;
    });
    if (!beak) return null;
    const V = root.position.constructor;
    const bp = new V(); beak.getWorldPosition(bp);
    const fwd = new V(0, 0, -1).applyQuaternion(root.quaternion);
    const toBeak = bp.clone().sub(s.pos).normalize();
    const toCam = P.camera.position.clone().sub(s.pos).normalize();
    return { fwd: fwd.dot(toBeak), cam: toCam.dot(toBeak) };
  });
  check('부리가 진행 방향을 향한다', facing && facing.fwd > 0.6,
        facing ? `dot=${facing.fwd.toFixed(2)}` : '부리를 못 찾음');
  check('캐릭터 선택 카메라가 얼굴 쪽에 있다', facing && facing.cam > 0.6,
        facing ? `dot=${facing.cam.toFixed(2)}` : '');

  await page.click('#btn-sel-ok');
  check('조작 안내 화면으로 넘어간다', await vis('scr-mode'));
  check('선택한 캐릭터 이름이 안내에 나온다',
        (await page.$eval('#mode-name', el => el.textContent)) === charB.name);

  /* ===== 2. 실제 웹캠 경로 기동 ===== */
  section('2. 웹캠 모드 기동 (getUserMedia + MediaPipe 실제 로딩)');
  const t0 = Date.now();
  await page.click('#btn-cam');
  let started = false;
  try {
    await page.waitForFunction(
      () => window.PENGUIN.state.running && window.PENGUIN.ctrl && window.PENGUIN.ctrl.landmarker,
      { timeout: 90000, polling: 300 });
    started = true;
  } catch (e) { /* 아래에서 실패로 기록 */ }
  check('카메라 권한 획득 + 포즈 모델 로드 완료', started,
        started ? `${((Date.now() - t0) / 1000).toFixed(1)}s` : await page.$eval('#menu-hint', el => el.textContent).catch(() => ''));
  if (!started) throw new Error('웹캠 모드 기동 실패 — 이후 검증 불가');

  check('비디오 스트림이 재생중이다',
        await page.evaluate(() => { const v = document.getElementById('cam'); return v.readyState >= 2 && !v.paused; }));
  check('HUD와 웹캠 패널이 표시된다',
        await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden') &&
                                  !document.getElementById('cam-panel').classList.contains('hidden')));
  check('게임 중에는 메뉴 오버레이가 사라진다',
        await page.evaluate(() => document.getElementById('ui').classList.contains('hidden')));
  check('선택한 캐릭터가 게임에 반영된다',
        await page.evaluate(() => window.PENGUIN.state.character && window.PENGUIN.state.character.id === 'geomeun'),
        await page.evaluate(() => window.PENGUIN.state.character.name));

  /* ===== 3. 실제 추론 루프 ===== */
  section('3. 실제 추론 루프 (합성 카메라 = 사람 없음)');
  const before = await page.evaluate(() => ({ vt: window.PENGUIN.ctrl.lastVideoTime }));
  await sleep(2500);
  const after = await page.evaluate(() => ({ vt: window.PENGUIN.ctrl.lastVideoTime, tracked: window.PENGUIN.ctrl.tracked }));
  check('비디오 프레임이 계속 들어온다', after.vt > before.vt, `currentTime ${before.vt.toFixed(2)} → ${after.vt.toFixed(2)}`);
  check('사람이 없으면 tracked=false 로 떨어진다', after.tracked === false);
  check('웹캠 패널이 미인식 상태를 표시한다',
        (await page.$eval('#cam-status', el => el.textContent)).includes('안 보여요'));

  const fps = await page.evaluate(async () => {
    const t = performance.now(); let n = 0;
    await new Promise(r => { const f = () => { n++; performance.now() - t > 1000 ? r() : requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return Math.round(n / ((performance.now() - t) / 1000));
  });
  check('게임 루프가 실시간으로 돈다 (>20fps)', fps > 20, `${fps} fps`);

  /* ===== 3-b. 성능: 추론 / 지형 재빌드 비용 ===== */
  section('3-b. 프레임 예산 (16.7ms) 대비 비용');
  const perf = await page.evaluate(async () => {
    const P = window.PENGUIN, c = P.ctrl, v = document.getElementById('cam');
    // 실제 추론 1회 비용
    const inf = [];
    for (let i = 0; i < 25; i++) {
      const a = performance.now();
      try { c.landmarker.detectForVideo(v, performance.now()); } catch (e) { /* 같은 타임스탬프 스킵 */ }
      inf.push(performance.now() - a);
      await new Promise(r => requestAnimationFrame(r));
    }
    // 지형 재빌드 1회 비용
    const T = P.world.terrain, ter = [];
    for (let i = 0; i < 15; i++) { T._cx = NaN; const a = performance.now(); T.update(i * 9, i * 9); ter.push(performance.now() - a); }
    const med = arr => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length / 2)];
    return { inference: +med(inf).toFixed(2), terrain: +med(ter).toFixed(2) };
  });
  check('포즈 추론 1회가 프레임 예산 안에 들어온다', perf.inference < 16,
        `${perf.inference}ms (상한 ${16}ms)`);
  check('지형 재빌드 1회가 프레임 예산 안에 들어온다', perf.terrain < 8,
        `${perf.terrain}ms`);

  /* ===== 4. 대본 랜드마크로 조작 검증 ===== */
  section('4. 팔 동작 → 펭귄 조작 (실제 게임 루프 위에서)');
  check('추론 출력 지점에 대본을 연결했다', await page.evaluate(() => window.__hijack()));

  /* 동작을 먼저 걸어 입력 필터(EMA)를 안정시킨 뒤 위치를 리셋하고 측정한다.
   * 그래야 직전 구간의 잔여 입력이 결과에 섞이지 않는다. */
  async function phase(mode, seconds, startY = 100, settle = 0.8) {
    await page.evaluate(m => window.__setMode(m), mode);
    await sleep(settle * 1000);
    await page.evaluate(y => window.__reset(y), startY);
    const a = await page.evaluate(() => window.__snap());
    await sleep(seconds * 1000);
    const b = await page.evaluate(() => window.__snap());
    return { a, b, dx: b.x - a.x, dy: b.y - a.y, dyaw: b.yaw - a.yaw };
  }

  const probe = await phase('level', 1.0);
  check('대본 랜드마크가 컨트롤러까지 도달한다',
        probe.b.calls > probe.a.calls && probe.b.tracked === true,
        `추론 호출 +${probe.b.calls - probe.a.calls}, tracked=${probe.b.tracked}`);

  const level = await phase('level', 2.0);
  check('양팔 수평 → 직진 (선회 없음)', Math.abs(level.dyaw) < 0.08 && Math.abs(level.dx) < 3,
        `Δyaw=${level.dyaw.toFixed(3)} Δx=${level.dx.toFixed(2)} roll=${level.b.roll.toFixed(2)}`);

  const right = await phase('rightDown', 2.0);
  check('오른팔 내림 → 오른쪽 선회', right.dyaw < -0.5 && right.dx > 5,
        `Δyaw=${right.dyaw.toFixed(2)} Δx=+${right.dx.toFixed(1)} roll=${right.b.roll.toFixed(2)}`);

  const left = await phase('leftDown', 2.0);
  check('왼팔 내림 → 왼쪽 선회', left.dyaw > 0.5 && left.dx < -5,
        `Δyaw=+${left.dyaw.toFixed(2)} Δx=${left.dx.toFixed(1)} roll=${left.b.roll.toFixed(2)}`);

  const up = await phase('flap', 2.5, 90);
  check('파닥파닥 날갯짓 → 상승', up.dy > 8 && up.b.flap > 0.3,
        `Δy=+${up.dy.toFixed(1)} flap=${up.b.flap.toFixed(2)}`);

  const down = await phase('still', 2.5, 130);
  check('날갯짓 멈춤 → 하강', down.dy < -8 && down.b.flap < 0.1,
        `Δy=${down.dy.toFixed(1)} flap=${down.b.flap.toFixed(2)}`);

  const lost = await phase('none', 2.0);
  check('사람을 놓치면 입력이 중립으로 감쇠', Math.abs(lost.b.roll) < 0.1 && lost.b.flap < 0.1,
        `roll=${lost.b.roll.toFixed(3)} flap=${lost.b.flap.toFixed(3)}`);

  /* ===== 4-b. 회귀: 오래 선회해도 화면/펭귄이 뒤집히지 않는가 ===== */
  section('4-b. 자세 안정성 (뒤집힘 회귀 방지)');
  const att = await page.evaluate(() => {
    const P = window.PENGUIN, s = P.state, B = P.penguin.body, C = P.camera;
    const f = { roll: 0, flap: 0.5, tracked: true, landmarks: null, update() {} };
    P.ctrl = f;
    const run = rollFn => {
      s.pos.set(0, 110, 0); s.yaw = 0; s.vy = 0; s.crash = 0; s.invuln = 99999;
      for (let i = 0; i < 120; i++) { f.roll = rollFn(0); P.step(1 / 60); }  // 카메라 정착
      let minUp = 1, maxBank = 0;
      for (let i = 0; i < 1800; i++) {                                       // 30초
        f.roll = rollFn(i / 60);
        P.step(1 / 60);
        C.updateMatrixWorld(true);
        minUp = Math.min(minUp, C.matrixWorld.elements[5]);   // 카메라 up 의 월드 Y
        maxBank = Math.max(maxBank, Math.abs(B.rotation.z));
      }
      return { tilt: Math.acos(Math.min(1, minUp)) * 180 / Math.PI, bank: maxBank * 180 / Math.PI };
    };
    const sweep = run(t => Math.sin(t * 0.7));
    const hard  = run(t => Math.sign(Math.sin(t * Math.PI * 2)));
    const hold  = run(() => -1);

    // 충돌 텀블이 누적되지 않고 중립으로 복귀하는가
    s.pos.set(0, 110, 0); s.invuln = 99999; f.roll = 0;
    for (let i = 0; i < 120; i++) P.step(1 / 60);
    for (let n = 0; n < 5; n++) { s.crash = 1; for (let i = 0; i < 90; i++) P.step(1 / 60); }
    for (let i = 0; i < 180; i++) P.step(1 / 60);
    const afterCrash = Math.abs(B.rotation.z) * 180 / Math.PI;

    const worst = a => Math.max(sweep[a], hard[a], hold[a]);
    return { tilt: +worst('tilt').toFixed(1), bank: +worst('bank').toFixed(1), afterCrash: +afterCrash.toFixed(1) };
  });
  check('30초 연속 선회에도 화면이 뒤집히지 않는다', att.tilt < 20,
        `최대 화면 기울기 ${att.tilt}도`);
  check('몸통 뱅킹이 상한에서 멈춘다', att.bank < 40, `최대 ${att.bank}도`);
  check('충돌 텀블이 누적되지 않고 복귀한다', att.afterCrash < 2, `${att.afterCrash}도`);

  /* ===== 5. 실제 사진으로 모델 인식 확인 (선택) ===== */
  section('5. 실제 인물 사진에 대한 모델 인식 (네트워크 의존, 실패 시 skip)');
  const real = await page.evaluate(async () => {
    const URLS = [
      'https://storage.googleapis.com/mediapipe-assets/pose.jpg',
      'https://storage.googleapis.com/mediapipe-assets/pose_segmentation.jpg',
      'https://storage.googleapis.com/mediapipe-tasks/pose_landmarker/woman_stretching.jpg',
    ];
    for (const u of URLS) {
      try {
        const r = await fetch(u); if (!r.ok) continue;
        const bmp = await createImageBitmap(await r.blob());
        const V = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const fsr = await V.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        const lmk = await V.PoseLandmarker.createFromOptions(fsr, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
          runningMode: 'IMAGE', numPoses: 1,
        });
        const res = lmk.detect(bmp);
        lmk.close();
        if (!res.landmarks.length) continue;
        const lm = res.landmarks[0];
        // 우리 코드의 측정 함수를 실제 랜드마크에 그대로 먹여본다
        const M = await import('/js/pose.js');
        const p = new M.PoseController({ readyState: 0, currentTime: 0 });
        p._measure(lm);
        return { url: u, count: lm.length, valid: p._valid(lm),
                 raiseL: +p.raiseL.toFixed(2), raiseR: +p.raiseR.toFixed(2),
                 roll: +p._shape(p._rawRoll).toFixed(2) };
      } catch (e) { /* 다음 후보 */ }
    }
    return null;
  });
  if (!real) {
    console.log('  \x1b[33mSKIP\x1b[0m  샘플 사진을 받지 못했습니다 (네트워크/자산 URL)');
  } else {
    check('실제 인물 사진에서 33개 랜드마크를 얻는다', real.count === 33, real.url.split('/').pop());
    check('상반신 랜드마크가 신뢰도 기준을 통과한다', real.valid === true);
    check('실제 랜드마크로 조작값이 정상 계산된다',
          Number.isFinite(real.raiseL) && Number.isFinite(real.raiseR) && Math.abs(real.roll) <= 1,
          `raiseL=${real.raiseL} raiseR=${real.raiseR} roll=${real.roll}`);
  }

  /* ===== 6. 콘솔 에러 ===== */
  section('6. 콘솔');
  check('페이지 에러가 없다', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

} catch (err) {
  check('테스트 실행 중 예외', false, String(err.message || err));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${'='.repeat(52)}`);
console.log(`  통과 ${pass} / 실패 ${fail}`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);

/* ==========================================================
 *  main.js — 부트스트랩 / 물리 / 카메라 / 게임 루프
 * ========================================================== */
import * as THREE from 'three';
import { PoseController, KeyController } from './pose.js';
import { World, terrainHeight } from './world.js';
import { createPenguin } from './penguin.js';
import { CHARACTERS, statMul } from './characters.js';
import { Hud } from './hud.js';
import { Ui } from './ui.js';

// ---------- 튜닝 상수 ----------
const PIXEL_DIV   = 3.2;    // 렌더 해상도 축소 배율 (레트로 픽셀감)
const BASE_SPEED  = 26;     // 기본 전진 속도 (u/s)
const DIVE_GAIN   = 0.55;   // 하강 시 속도 보너스
const MAX_SPEED   = 58;
const TURN_RATE   = 1.15;   // rad/s (최대 선회)
const LIFT        = 32;     // 날갯짓 양력 가속도
const GRAVITY     = 13;     // 중력 가속도
const VY_DAMP     = 1.3;    // 공기저항 (1/s). 종단속도 = GRAVITY / VY_DAMP
const MAX_VY      = 26;
const CEILING     = 165;
const GROUND_CLR  = 3.2;    // 지면 위 최소 여유
const MAX_CAM_TILT = 0.20;  // 카메라 수평선 기울기 상한 (rad, 약 11도)

const state = {
  pos: new THREE.Vector3(0, 45, 0),
  yaw: 0,
  vy: 0,
  speed: BASE_SPEED,
  dist: 0,
  fish: 0,
  crash: 0,
  invuln: 0,
  running: false,
  character: null,
};

// 선택한 캐릭터에서 나오는 성능 배율
const perf = { speed: 1, turn: 1, lift: 1 };

let renderer, scene, camera, world, penguin, hud, ui, ctrl, shadow, portraitLight;
let useCam = false;
let last = performance.now();
let previewMode = 'cinematic';
let previewT = 0;

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camLookSmooth = new THREE.Vector3();
// 카메라는 조작 입력을 그대로 따라가지 않는다.
// 랜드마크 지터가 화면 기울기로 바로 새어나오면 심하게 흔들려 보이기 때문.
let camRoll = 0, camPitch = 0;

/* ================= 초기화 ================= */
function initThree() {
  const canvas = document.getElementById('game');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);

  world = new World(scene);
  setCharacter(CHARACTERS[0]);

  // 지면 그림자 — 고도를 눈으로 가늠하게 해준다
  shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 10),
    new THREE.MeshBasicMaterial({ color: 0x1b2740, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // 캐릭터 선택 화면 전용 조명. 태양이 뒤쪽에 있어서 정면이 그늘지는데,
  // 캐릭터를 고르는 화면에서는 색과 생김새가 보여야 한다.
  // PointLight 는 r155 이후 물리 단위(칸델라)라 이 거리에서는 사실상 보이지 않는다.
  // 방향광으로 카메라 쪽에서 캐릭터를 비춘다.
  portraitLight = new THREE.DirectionalLight(0xfff2e0, 1.6);
  portraitLight.visible = false;
  scene.add(portraitLight);
  scene.add(portraitLight.target);

  hud = new Hud();
  resize();
  addEventListener('resize', resize);
}

/** 캐릭터 교체: 3D 모델을 새로 만들고 성능 배율을 갱신 */
function setCharacter(c) {
  if (penguin) {
    scene.remove(penguin.root);
    penguin.dispose();
  }
  penguin = createPenguin(c.shape);
  scene.add(penguin.root);

  perf.speed = statMul(c.stats.speed);
  perf.turn  = statMul(c.stats.turn);
  perf.lift  = statMul(c.stats.lift);
  state.character = c;
}

function resize() {
  const w = Math.max(320, innerWidth);
  const h = Math.max(240, innerHeight);
  // 저해상도로 그리고 CSS가 픽셀 그대로 확대한다
  renderer.setSize(Math.floor(w / PIXEL_DIV), Math.floor(h / PIXEL_DIV), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ================= 물리 / 갱신 ================= */
function step(dt) {
  ctrl.update(dt);

  const roll = THREE.MathUtils.clamp(ctrl.roll, -1, 1);
  const flap = THREE.MathUtils.clamp(ctrl.flap, 0, 1);

  // ---- 선회 : roll > 0 이면 오른쪽 ----
  state.yaw -= roll * TURN_RATE * perf.turn * dt;

  // ---- 수직 : 날갯짓 양력 vs 중력 ----
  state.vy += (flap * LIFT * perf.lift - GRAVITY) * dt;
  state.vy *= Math.exp(-VY_DAMP * dt);
  state.vy = THREE.MathUtils.clamp(state.vy, -MAX_VY, MAX_VY);

  // ---- 전진 속도 : 하강하면 가속, 상승하면 감속 ----
  const base = BASE_SPEED * perf.speed;
  const targetSpeed = THREE.MathUtils.clamp(
    base - state.vy * DIVE_GAIN, base * 0.62, MAX_SPEED);
  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 2);

  // ---- 위치 적분 ----
  const fx = -Math.sin(state.yaw);
  const fz = -Math.cos(state.yaw);
  state.pos.x += fx * state.speed * dt;
  state.pos.z += fz * state.speed * dt;
  state.pos.y += state.vy * dt;
  state.dist += state.speed * dt;

  // ---- 지면 / 천장 ----
  const gh = terrainHeight(state.pos.x, state.pos.z);
  const floor = gh + GROUND_CLR;
  state.invuln = Math.max(0, state.invuln - dt);
  state.crash = Math.max(0, state.crash - dt * 1.6);

  if (state.pos.y < floor) {
    state.pos.y = floor;
    if (state.vy < -4 && state.invuln <= 0) {
      crash('쿵!  땅에 부딪혔다');            // crash() 안에서 위로 튕겨준다
    } else {
      state.vy = Math.max(state.vy, 0);       // 평소엔 지면을 따라 미끄러진다 (튐 방지)
    }
  }
  if (state.pos.y > CEILING) {
    state.pos.y = CEILING;
    state.vy = Math.min(state.vy, 0);
  }

  // ---- 월드 갱신 + 충돌/수집 ----
  world.update(state.pos.x, state.pos.y, state.pos.z, state.yaw, dt);

  if (state.invuln <= 0 && world.hitsObstacle(state.pos)) crash('쾅!  장애물 충돌');

  const got = world.collectFish(state.pos);
  if (got) {
    state.fish += got;
    state.speed = Math.min(MAX_SPEED, state.speed + 6);
    hud.message('🐟 +' + got, 0.7);
  }

  // ---- 펭귄 자세 ----
  penguin.root.position.copy(state.pos);
  penguin.root.rotation.y = state.yaw;
  const pitch = THREE.MathUtils.clamp(state.vy / 40, -0.7, 0.7);
  penguin.anim.update(dt, flap, roll, pitch, state.crash);
  updateShadow(gh);

  updateCamera(dt, roll, pitch);

  hud.update(dt, {
    speed: state.speed,
    alt: Math.max(0, state.pos.y - gh),
    dist: state.dist,
    fish: state.fish,
  }, ctrl, useCam);
}

/** 지면 그림자: 높이 올라갈수록 커지고 옅어진다 */
function updateShadow(groundY) {
  const alt = Math.max(0, state.pos.y - groundY);
  shadow.position.set(state.pos.x, groundY + 0.35, state.pos.z);
  shadow.rotation.z = -state.yaw;
  const k = 1 + alt / 55;
  shadow.scale.set(k, k * 0.85, 1);
  shadow.material.opacity = 0.34 * Math.max(0, 1 - alt / 130);
  shadow.visible = shadow.material.opacity > 0.02;
}

function crash(msg) {
  state.crash = 1;
  state.invuln = 1.4;
  state.vy = 14;
  state.speed = BASE_SPEED * 0.6;
  hud.flash();
  hud.message(msg, 1.1);
}

function updateCamera(dt, roll, pitch) {
  // 조작값을 느리게 따라가는 카메라 전용 값 (지터 제거)
  camRoll  += (roll  - camRoll)  * Math.min(1, dt * 2.2);
  camPitch += (pitch - camPitch) * Math.min(1, dt * 2.0);

  const back = 16, up = 5.0;
  camTarget.set(
    state.pos.x + Math.sin(state.yaw) * back + Math.cos(state.yaw) * camRoll * 2.2,
    state.pos.y + up - camPitch * 4,
    state.pos.z + Math.cos(state.yaw) * back - Math.sin(state.yaw) * camRoll * 2.2
  );
  // 지형을 뚫지 않게
  const minY = terrainHeight(camTarget.x, camTarget.z) + 2.5;
  if (camTarget.y < minY) camTarget.y = minY;

  camera.position.lerp(camTarget, Math.min(1, dt * 3.2));

  camLook.set(
    state.pos.x - Math.sin(state.yaw) * 12,
    state.pos.y + 1.5 + camPitch * 6,
    state.pos.z - Math.cos(state.yaw) * 12
  );
  // 바라보는 지점도 한 번 더 완만하게
  if (camLookSmooth.lengthSq() === 0) camLookSmooth.copy(camLook);
  camLookSmooth.lerp(camLook, Math.min(1, dt * 6));
  camera.lookAt(camLookSmooth);

  // 주의: lookAt() 은 쿼터니언을 새로 쓴다.
  // 그 뒤에 camera.rotation.z(오일러 각)를 직접 대입하면, 분해 결과에 따라
  // X 가 ±180도 근처로 나오는 표현이 섞여 화면이 통째로 뒤집힌다.
  // 카메라 자신의 로컬 Z 축을 기준으로 돌려야 안전하다.
  const tilt = THREE.MathUtils.clamp(-camRoll * 0.12, -MAX_CAM_TILT, MAX_CAM_TILT);
  camera.rotateZ(tilt);
}

/* ================= 메뉴 배경 연출 =================
 * 게임 시작 전에도 같은 월드에서 펭귄이 실제로 날고 있다.
 *   cinematic : 지형과 함께 넓게 잡아 활공을 보여준다 (타이틀/프롤로그)
 *   portrait  : 캐릭터를 가까이서 천천히 돌며 보여준다 (캐릭터 선택)
 */
function updatePreview(dt) {
  previewT += dt;
  const t = previewT;
  const portrait = previewMode === 'portrait';

  // 월드는 어느 화면에서든 계속 흐른다 (배경이 살아 있어야 한다)
  const yaw = t * 0.16;
  const r = 150;
  state.yaw = yaw;
  state.pos.set(Math.sin(yaw) * r, 0, Math.cos(yaw) * r);
  state.pos.y = terrainHeight(state.pos.x, state.pos.z) + 52 + Math.sin(t * 0.5) * 6;

  world.update(state.pos.x, state.pos.y, state.pos.z, state.yaw, dt);

  penguin.root.position.copy(state.pos);
  penguin.root.rotation.y = state.yaw;

  if (portrait) {
    // ---- 캐릭터 선택 : 정면 고정 포즈 ----
    // 뱅킹(roll)을 주면 몸이 눕고 머리가 돌아가 얼굴이 안 보인다.
    // 제자리 호버링처럼 날갯짓만 시키고 자세는 정면으로 고정한다.
    penguin.anim.update(dt, 0.42 + Math.sin(t * 1.6) * 0.12, 0, 0, 0);
  } else {
    penguin.anim.update(dt, 0.35 + Math.sin(t * 0.9) * 0.25, Math.sin(t * 0.5) * 0.35, 0, 0);
  }
  updateShadow(terrainHeight(state.pos.x, state.pos.z));

  // 메뉴 배경은 구도가 중요하다. lerp 로 따라가면 펭귄이 계속 이동하는 탓에
  // 지연이 쌓여 프레임 밖으로 밀려난다. 여기서는 펭귄 기준 고정 오프셋으로 놓는다.
  //
  // 펭귄의 정면은 로컬 -Z. 따라서 yaw + PI 방향에 카메라를 두면 부리가 화면을 향한다.
  // 살아 있는 느낌만 남도록 좌우 흔들림은 ±5도로 아주 작게 준다.
  const angle  = portrait
    ? state.yaw + Math.PI + Math.sin(t * 0.45) * 0.09
    : state.yaw + 1.15 + t * 0.06;
  const dist   = portrait ? 11 : 19;
  const height = portrait ? 1.9 : 4.5;
  const lookUp = portrait ? 1.5 : 3.2;   // portrait 은 머리 높이를 본다   // 시선을 올리면 펭귄이 화면 아래쪽에 앉는다

  camera.position.set(
    state.pos.x + Math.sin(angle) * dist,
    state.pos.y + height,
    state.pos.z + Math.cos(angle) * dist
  );

  portraitLight.visible = portrait;
  if (portrait) {
    // 카메라 쪽에서 살짝 위로 — 얼굴과 배가 밝게 나오도록
    portraitLight.position.set(camera.position.x, camera.position.y + 7, camera.position.z);
    portraitLight.target.position.copy(state.pos);
    portraitLight.target.updateMatrixWorld();
  }

  camLookSmooth.set(state.pos.x, state.pos.y + lookUp, state.pos.z);
  camera.lookAt(camLookSmooth);
  camera.rotateZ(portrait ? 0 : Math.sin(t * 0.23) * 0.05);
}

/* ================= 루프 ================= */
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.running) step(dt);
  else updatePreview(dt);
  renderer.render(scene, camera);
}

/* ================= 시작 ================= */
async function startCam() {
  ui.loading('카메라 권한 요청중...');
  const pose = new PoseController(document.getElementById('cam'));
  try {
    await pose.start(m => ui.loading(m));
  } catch (err) {
    console.error(err);
    ui.error('웹캠/모델 로드 실패: ' + (err && err.message ? err.message : err) +
      ' — 키보드 모드로 플레이하거나, 카메라 권한과 인터넷 연결을 확인하세요.');
    return;
  }
  ctrl = pose;
  useCam = true;
  begin();
}

function startKeys() {
  ctrl = new KeyController();
  useCam = false;
  begin();
}

function begin() {
  ui.hideAll();

  // 프리뷰 카메라가 옮겨놓은 상태를 초기화
  state.pos.set(0, 60, 0);
  state.yaw = 0;
  state.vy = 0;
  state.speed = BASE_SPEED * perf.speed;
  state.dist = 0;
  state.fish = 0;
  state.crash = 0;
  state.invuln = 1.0;
  camera.position.set(0, 66, 20);
  camRoll = 0; camPitch = 0; camLookSmooth.set(0, 0, 0);

  hud.show(useCam);
  hud.message(useCam ? '팔을 펴고 파닥파닥!' : '← → 선회 / Space 연타로 상승', 2.2);
  last = performance.now();
  state.running = true;
}

/* ================= 부트 ================= */
initThree();

ui = new Ui({
  onPreview: mode => { previewMode = mode; },
  onCharacter: c => setCharacter(c),
  onStart: cam => (cam ? startCam() : startKeys()),
});

// 디버그 핸들: 콘솔에서 PENGUIN.state 확인 / PENGUIN.step(dt) 수동 진행
window.PENGUIN = {
  state,
  step,
  perf,
  get ctrl() { return ctrl; },
  set ctrl(c) { ctrl = c; },
  get world() { return world; },
  get penguin() { return penguin; },
  get camera() { return camera; },
  get ui() { return ui; },
  /** 테스트용 빠른 시작 (화면 전환을 건너뛴다) */
  quickStart(mode = 'key') { return mode === 'cam' ? startCam() : startKeys(); },
  /** 테스트용: 메뉴 배경 연출을 수동으로 진행 */
  preview(dt) { updatePreview(dt); },
};

loop();

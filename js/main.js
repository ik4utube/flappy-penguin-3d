/* ==========================================================
 *  main.js — 부트스트랩 / 물리 / 카메라 / 게임 루프
 * ========================================================== */
import * as THREE from 'three';
import { PoseController, KeyController } from './pose.js';
import { World, terrainHeight } from './world.js';
import { createPenguin } from './penguin.js';
import { Hud } from './hud.js';

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
};

let renderer, scene, camera, world, penguin, hud, ctrl, shadow;
let useCam = false;
let last = performance.now();
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
  penguin = createPenguin();
  scene.add(penguin.root);

  // 지면 그림자 — 고도를 눈으로 가늠하게 해준다
  shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 10),
    new THREE.MeshBasicMaterial({ color: 0x1b2740, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  hud = new Hud();
  resize();
  addEventListener('resize', resize);
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
  state.yaw -= roll * TURN_RATE * dt;

  // ---- 수직 : 날갯짓 양력 vs 중력 ----
  state.vy += (flap * LIFT - GRAVITY) * dt;
  state.vy *= Math.exp(-VY_DAMP * dt);
  state.vy = THREE.MathUtils.clamp(state.vy, -MAX_VY, MAX_VY);

  // ---- 전진 속도 : 하강하면 가속, 상승하면 감속 ----
  const targetSpeed = THREE.MathUtils.clamp(
    BASE_SPEED - state.vy * DIVE_GAIN, BASE_SPEED * 0.62, MAX_SPEED);
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

  // lookAt() 이 매 프레임 카메라 회전을 통째로 덮어쓴다.
  // 따라서 여기서 += 로 누적하면 프레임레이트에 따라 값이 달라지고 실제로는 거의 적용되지 않는다.
  // 이미 완만하게 필터링된 camRoll 을 그대로 대입한다.
  camera.rotation.z = -camRoll * 0.12;
}

/* ================= 루프 ================= */
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.running) step(dt);
  renderer.render(scene, camera);
}

/* ================= 시작 ================= */
async function startCam() {
  const menu = document.getElementById('menu');
  const loading = document.getElementById('loading');
  const loadMsg = document.getElementById('load-msg');
  const hint = document.getElementById('menu-hint');

  menu.classList.add('hidden');
  loading.classList.remove('hidden');

  const pose = new PoseController(document.getElementById('cam'));
  try {
    await pose.start(m => { loadMsg.textContent = m; });
  } catch (err) {
    console.error(err);
    loading.classList.add('hidden');
    menu.classList.remove('hidden');
    hint.classList.add('err');
    hint.textContent = '웹캠/모델 로드 실패: ' + (err && err.message ? err.message : err) +
      ' — 키보드 모드로 플레이하거나, 카메라 권한과 인터넷 연결을 확인하세요.';
    return;
  }

  ctrl = pose;
  useCam = true;
  loading.classList.add('hidden');
  begin();
}

function startKeys() {
  document.getElementById('menu').classList.add('hidden');
  ctrl = new KeyController();
  useCam = false;
  begin();
}

function begin() {
  // 프리뷰 카메라가 옮겨놓은 상태를 초기화
  state.pos.set(0, 60, 0);
  state.yaw = 0;
  state.vy = 0;
  state.speed = BASE_SPEED;
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

// 디버그 핸들: 콘솔에서 PENGUIN.state 확인 / PENGUIN.step(dt) 수동 진행
window.PENGUIN = {
  state,
  step,
  get ctrl() { return ctrl; },
  set ctrl(c) { ctrl = c; },
  get world() { return world; },
};
loop();   // 메뉴 뒤에서도 씬을 렌더링

document.getElementById('btn-cam').addEventListener('click', startCam);
document.getElementById('btn-key').addEventListener('click', startKeys);

// 메뉴 화면에서는 카메라가 월드를 천천히 둘러본다
(function preview() {
  const t = performance.now() * 0.00012;
  if (!state.running) {
    state.pos.set(Math.sin(t) * 60, 55, Math.cos(t) * 60);
    state.yaw = -t + Math.PI;
    world.update(state.pos.x, state.pos.y, state.pos.z, state.yaw, 1 / 60);
    penguin.root.position.copy(state.pos);
    penguin.root.rotation.y = state.yaw;
    penguin.anim.update(1 / 60, 0.25, 0, 0, 0);
    updateShadow(terrainHeight(state.pos.x, state.pos.z));
    updateCamera(1 / 60, 0, 0);
  }
  requestAnimationFrame(preview);
})();

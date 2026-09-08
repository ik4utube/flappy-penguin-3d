/* ==========================================================
 *  penguin.js — 절차적 로우폴리 펭귄 + 애니메이션
 * ========================================================== */
import * as THREE from 'three';

const BLACK  = 0x2c3652;   // 완전한 검정 대신 푸른 기가 도는 검정 (실루엣 가독성)
const BELLY  = 0xf4f9ff;
const ORANGE = 0xff9d3d;
const DARK   = 0x151a2b;

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
}

export function createPenguin() {
  const root = new THREE.Group();
  const body = new THREE.Group();          // 기울기(뱅킹/피치)를 받는 부분
  root.add(body);

  const mBlack  = mat(BLACK);
  const mBelly  = mat(BELLY);
  const mOrange = mat(ORANGE);
  const mDark   = mat(DARK);

  // ---- 몸통 : 낮은 폴리 구를 늘려서 ----
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mBlack);
  torso.scale.set(1.0, 1.15, 1.35);
  body.add(torso);

  // ---- 하얀 배 ----
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.86, 8, 6), mBelly);
  belly.scale.set(0.92, 1.02, 1.2);
  belly.position.set(0, -0.08, 0.28);
  body.add(belly);

  // ---- 머리 ----
  const head = new THREE.Group();
  head.position.set(0, 0.72, -0.52);
  body.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), mBlack);
  skull.scale.set(1, 0.95, 1);
  head.add(skull);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), mBelly);
  face.scale.set(0.82, 0.88, 0.7);
  face.position.set(0, -0.06, 0.36);
  head.add(face);

  // 부리 : 앞(-Z)이 진행 방향
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 5), mOrange);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, -0.05, 0.72);
  head.add(beak);

  // 눈
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 6, 5), mDark);
    eye.position.set(sx * 0.24, 0.14, 0.48);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), mBelly);
    glint.position.set(sx * 0.26, 0.19, 0.56);
    head.add(glint);
  }

  // ---- 날개 : 어깨를 피벗으로 회전 ----
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.9, 0.16, 0.05);
    body.add(pivot);

    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), mBlack);
    wing.scale.set(1.05, 0.22, 0.72);
    wing.position.set(sx * 1.0, 0, 0);
    pivot.add(wing);

    // 날개 끝 깃털
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 4), mBlack);
    tip.rotation.z = sx * Math.PI / 2;
    tip.position.set(sx * 2.2, 0, 0.05);
    pivot.add(tip);

    wings.push({ pivot, sign: sx });
  }

  // ---- 꼬리 ----
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 4), mBlack);
  tail.rotation.x = Math.PI / 2 + 0.35;
  tail.position.set(0, -0.25, 1.25);
  body.add(tail);

  // ---- 발 ----
  const feet = [];
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.62), mOrange);
    foot.position.set(sx * 0.32, -1.05, 0.34);
    body.add(foot);
    feet.push(foot);
  }

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // ---------- 애니메이션 상태 ----------
  const anim = {
    t: 0,
    flapPhase: 0,
    /**
     * @param {number} dt      초
     * @param {number} flap    0~1 날갯짓 세기
     * @param {number} roll    -1~1 선회 입력
     * @param {number} pitch   라디안, 위를 보면 +
     * @param {number} crash   0~1 충돌 연출
     */
    update(dt, flap, roll, pitch, crash = 0) {
      this.t += dt;

      // 날갯짓 속도: 안 하면 활공(느린 흔들림), 하면 빠르게 파닥
      const speed = 2.0 + flap * 14;
      this.flapPhase += dt * speed;

      const amp = 0.22 + flap * 0.95;               // 진폭
      const s = Math.sin(this.flapPhase);
      for (const w of wings) {
        // 기본으로 살짝 벌린 상태(글라이드) + 파닥임
        const base = -0.12 - flap * 0.15;
        w.pivot.rotation.z = w.sign * (base + s * amp);
        // 선회할 때 안쪽 날개를 내린다
        w.pivot.rotation.z += -roll * 0.35;
        w.pivot.rotation.x = s * amp * 0.25;
      }

      // 몸통 뱅킹 / 피치 / 요잉
      const targetRoll  = -roll * 0.62;
      const targetPitch = THREE.MathUtils.clamp(pitch, -0.7, 0.7);
      body.rotation.z += (targetRoll - body.rotation.z) * Math.min(1, dt * 6);
      body.rotation.x += (targetPitch - body.rotation.x) * Math.min(1, dt * 5);
      body.rotation.y += (roll * 0.18 - body.rotation.y) * Math.min(1, dt * 5);

      // 위아래로 살짝 둥실
      body.position.y = Math.sin(this.t * 2.2) * 0.12 + s * flap * 0.18;

      // 머리는 진행 방향을 본다(관성 느낌)
      head.rotation.y = -roll * 0.35;
      head.rotation.x = -targetPitch * 0.4;

      // 발은 활공 중엔 뒤로 붙인다
      for (const f of feet) f.rotation.x = -0.6 + flap * 0.5;

      // 충돌하면 빙글
      if (crash > 0) body.rotation.z += Math.sin(this.t * 30) * crash * 0.5;
    },
  };

  root.scale.setScalar(1.45);   // 3인칭 카메라에서 잘 보이도록
  root.userData.anim = anim;
  return { root, body, anim };
}

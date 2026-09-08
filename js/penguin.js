/* ==========================================================
 *  penguin.js — 절차적 로우폴리 펭귄 + 애니메이션
 *
 *  createPenguin(shape) 의 shape 는 characters.js 가 넘겨주는
 *  외형 파라미터. 생략하면 기본 펭귄이 만들어진다.
 * ========================================================== */
import * as THREE from 'three';

const DEFAULT_SHAPE = {
  body: 0x2c3652,      // 완전한 검정 대신 푸른 기가 도는 검정 (실루엣 가독성)
  belly: 0xf4f9ff,
  beak: 0xff9d3d,
  foot: 0xff9d3d,
  eye: 0x151a2b,
  crest: null,         // 볏 색. null 이면 볏 없음
  brow: false,         // 눈썹
  scale: 1,            // 전체 크기
  girth: 1,            // 통통함
  wing: 1,             // 날개 길이
  beakLen: 1,
  tail: 1,
};

const MAX_BANK = 0.62;   // 몸통 뱅킹 상한 (rad, 약 35도)

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
}

export function createPenguin(shape = {}) {
  const S = { ...DEFAULT_SHAPE, ...shape };

  const root = new THREE.Group();
  const body = new THREE.Group();          // 기울기(뱅킹/피치)를 받는 부분
  root.add(body);

  const mBody  = mat(S.body);
  const mBelly = mat(S.belly);
  const mBeak  = mat(S.beak);
  const mFoot  = mat(S.foot);
  const mEye   = mat(S.eye);

  // ---- 몸통 : 낮은 폴리 구를 늘려서 ----
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mBody);
  torso.scale.set(1.0 * S.girth, 1.15, 1.35);
  body.add(torso);

  // ---- 하얀 배 ----
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.86, 8, 6), mBelly);
  belly.scale.set(0.92 * S.girth, 1.02, 1.2);
  belly.position.set(0, -0.08, 0.28);
  body.add(belly);

  // ---- 머리 ----
  const head = new THREE.Group();
  head.position.set(0, 0.72, -0.52);
  body.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), mBody);
  skull.scale.set(1, 0.95, 1);
  head.add(skull);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), mBelly);
  face.scale.set(0.82, 0.88, 0.7);
  face.position.set(0, -0.06, 0.36);
  head.add(face);

  // 부리 : 앞(-Z)이 진행 방향
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55 * S.beakLen, 5), mBeak);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, -0.05, 0.62 + 0.1 * S.beakLen);
  head.add(beak);

  // 눈
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 6, 5), mEye);
    eye.position.set(sx * 0.24, 0.14, 0.48);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), mBelly);
    glint.position.set(sx * 0.26, 0.19, 0.56);
    head.add(glint);

    // 눈썹 (사나운 인상)
    if (S.brow) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), mBelly);
      brow.position.set(sx * 0.25, 0.33, 0.46);
      brow.rotation.z = sx * 0.35;
      head.add(brow);
    }
  }

  // 볏 (마카로니 / 전설의 펭귄)
  if (S.crest) {
    const mCrest = mat(S.crest);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const q = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.5 + i * 0.12, 4), mCrest);
        q.position.set(sx * (0.26 + i * 0.06), 0.5 - i * 0.03, 0.22 - i * 0.18);
        q.rotation.set(-0.5 - i * 0.18, 0, sx * (0.35 + i * 0.12));
        head.add(q);
      }
    }
  }

  // ---- 날개 : 어깨를 피벗으로 회전 ----
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.9 * S.girth, 0.16, 0.05);
    body.add(pivot);

    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), mBody);
    wing.scale.set(1.05 * S.wing, 0.22, 0.72);
    wing.position.set(sx * 1.0 * S.wing, 0, 0);
    pivot.add(wing);

    // 날개 끝 깃털
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 4), mBody);
    tip.rotation.z = sx * Math.PI / 2;
    tip.position.set(sx * 2.2 * S.wing, 0, 0.05);
    pivot.add(tip);

    wings.push({ pivot, sign: sx });
  }

  // ---- 꼬리 ----
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0 * S.tail, 4), mBody);
  tail.rotation.x = Math.PI / 2 + 0.35;
  tail.position.set(0, -0.25, 1.15 + 0.2 * S.tail);
  body.add(tail);

  // ---- 발 ----
  const feet = [];
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.62), mFoot);
    foot.position.set(sx * 0.32, -1.05, 0.34);
    body.add(foot);
    feet.push(foot);
  }

  root.scale.setScalar(1.45 * S.scale);   // 3인칭 카메라에서 잘 보이도록

  // ---------- 애니메이션 상태 ----------
  const anim = {
    t: 0,
    flapPhase: 0,
    bankZ: 0,      // 뱅킹 각도를 따로 들고 있는다 (충돌 텀블과 섞이지 않게)
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
      const targetRoll  = THREE.MathUtils.clamp(-roll * MAX_BANK, -MAX_BANK, MAX_BANK);
      const targetPitch = THREE.MathUtils.clamp(pitch, -0.7, 0.7);
      this.bankZ += (targetRoll - this.bankZ) * Math.min(1, dt * 6);
      body.rotation.x += (targetPitch - body.rotation.x) * Math.min(1, dt * 5);
      body.rotation.y += (roll * 0.18 - body.rotation.y) * Math.min(1, dt * 5);

      // 위아래로 살짝 둥실
      body.position.y = Math.sin(this.t * 2.2) * 0.12 + s * flap * 0.18;

      // 머리는 진행 방향을 본다(관성 느낌)
      head.rotation.y = -roll * 0.35;
      head.rotation.x = -targetPitch * 0.4;

      // 발은 활공 중엔 뒤로 붙인다
      for (const f of feet) f.rotation.x = -0.6 + flap * 0.5;

      // 충돌 텀블은 뱅킹 위에 얹기만 한다.
      // 예전처럼 body.rotation.z 에 += 로 누적하면 프레임마다 값이 쌓여
      // 펭귄이 통째로 뒤집힌 채 돌아오지 않는다.
      const tumble = crash > 0 ? Math.sin(this.t * 30) * crash * 0.5 : 0;
      body.rotation.z = this.bankZ + tumble;
    },
  };

  /** 캐릭터를 바꿀 때 GPU 자원 정리 */
  function dispose() {
    root.traverse(o => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }

  root.userData.anim = anim;
  return { root, body, anim, dispose };
}

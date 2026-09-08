/* ==========================================================
 *  world.js — 무한 지형 + 나무/돌/구름/물고기 (오브젝트 풀 재활용)
 * ========================================================== */
import * as THREE from 'three';

// ---------- 팔레트 ----------
export const PALETTE = {
  sky:     0x3d84c9,
  horizon: 0xb2ddf5,
  fog:     0x9cc9e8,
  snow:    0xf2f8ff,
  snowLo:  0xcfe4f5,
  rock:    0x5b6478,
  rockLo:  0x424b5e,
  pine:    0x1f5c3d,
  pineLo:  0x14402b,
  trunk:   0x5a3a24,
  cloud:   0xffffff,
  fish:    0xffd15c,
};

// ---------- 지형 설정 ----------
const TERRAIN_SIZE = 440;
const TERRAIN_SEG  = 64;                       // 정점 수를 절반 이하로 (재빌드 비용)
const CELL         = TERRAIN_SIZE / TERRAIN_SEG;
const SNAP         = CELL * 2;                 // 2셀 단위로만 재중심화 → 재빌드 횟수 감소

/** 결정론적 지형 높이 (노이즈 라이브러리 없이 사인 합성) */
export function terrainHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.0132) * Math.cos(z * 0.0119) * 26;
  h += Math.sin(x * 0.0291 + 1.7) * Math.sin(z * 0.0247 - 0.6) * 12;
  h += Math.cos(x * 0.0605 - 2.1) * Math.sin(z * 0.0533 + 0.9) * 5.0;
  h += Math.sin(x * 0.121 + z * 0.098) * 1.8;
  // 낮은 곳은 더 평평하게 눌러 비행 공간을 넓힌다
  return h > 0 ? h : h * 0.55;
}

function flatMat(color, extra) {
  return new THREE.MeshLambertMaterial(Object.assign({ color: color, flatShading: true }, extra || {}));
}

/* ================= 지형 ================= */
class Terrain {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);
    const count = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, flatMat(0xffffff, { vertexColors: true }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._cx = NaN;
    this._cz = NaN;
    this._snow  = new THREE.Color(PALETTE.snow);
    this._snowL = new THREE.Color(PALETTE.snowLo);
    this._rock  = new THREE.Color(PALETTE.rock);
    this._rockL = new THREE.Color(PALETTE.rockLo);
    this._tmp   = new THREE.Color();
    this._tmp2  = new THREE.Color();   // 루프 안에서 재사용 (할당 없이)
    this._h     = new Float32Array(count);   // 높이 격자 (법선 유도용)
  }

  /** 플레이어를 따라 그리드 단위로 재중심화 (셀에 스냅해 지형이 미끄러지지 않게) */
  update(px, pz) {
    const cx = Math.round(px / SNAP) * SNAP;
    const cz = Math.round(pz / SNAP) * SNAP;
    if (cx === this._cx && cz === this._cz) return;
    this._cx = cx;
    this._cz = cz;
    this.mesh.position.set(cx, 0, cz);

    const pos = this.geo.attributes.position;
    const col = this.geo.attributes.color;
    const nrm = this.geo.attributes.normal;
    const h = this._h;
    const W = TERRAIN_SEG + 1;

    // --- 1패스: 높이와 색 ---
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx;
      const wz = pos.getZ(i) + cz;
      const y = terrainHeight(wx, wz);
      h[i] = y;
      pos.setY(i, y);

      // 고도에 따라 눈 / 바위, 미세 노이즈로 얼룩
      const speck = (Math.sin(wx * 0.7) * Math.cos(wz * 0.63) + 1) * 0.5;
      const rocky = clamp((y - 9) / 16, 0, 1);
      this._tmp.copy(this._snow).lerp(this._snowL, speck * 0.7);
      if (rocky > 0) {
        this._tmp2.copy(this._rock).lerp(this._rockL, speck * 0.7);
        this._tmp.lerp(this._tmp2, rocky);
      }
      col.setXYZ(i, this._tmp.r, this._tmp.g, this._tmp.b);
    }

    // --- 2패스: 법선을 높이 격자의 기울기에서 바로 구한다 ---
    // computeVertexNormals() 는 면을 모두 순회해 재빌드 비용의 대부분을 차지했다.
    // 격자라서 이웃 높이만 보면 같은 결과를 훨씬 싸게 얻을 수 있다.
    for (let iz = 0; iz < W; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        const xl = ix > 0 ? i - 1 : i;
        const xr = ix < W - 1 ? i + 1 : i;
        const zl = iz > 0 ? i - W : i;
        const zr = iz < W - 1 ? i + W : i;
        // 가장자리에서는 한쪽 이웃만 있으므로 간격이 1셀, 안쪽은 2셀
        const dx = (h[xr] - h[xl]) / ((xr - xl) * CELL);
        const dz = (h[zr] - h[zl]) / (((zr - zl) / W) * CELL);
        // y = f(x,z) 인 지형의 위쪽 법선 = (-df/dx, 1, -df/dz)
        const inv = 1 / Math.hypot(dx, 1, dz);
        nrm.setXYZ(i, -dx * inv, inv, -dz * inv);
      }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    nrm.needsUpdate = true;
  }
}

/* ================= 프롭 생성기 ================= */
function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 3.2, 5), flatMat(PALETTE.trunk));
  trunk.position.y = 1.6;
  g.add(trunk);

  const tiers = [
    { r: 3.0, h: 4.2, y: 3.6, c: PALETTE.pineLo },
    { r: 2.3, h: 3.6, y: 5.9, c: PALETTE.pine },
    { r: 1.5, h: 3.0, y: 8.0, c: PALETTE.pine },
  ];
  for (const t of tiers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 6), flatMat(t.c));
    cone.position.y = t.y;
    g.add(cone);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.5, 6), flatMat(PALETTE.snow));
  cap.position.y = 9.0;
  g.add(cap);
  g.userData.topY = 10.0;
  return g;
}

function makeRock() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0), flatMat(PALETTE.rock));
  r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  g.add(r);
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), flatMat(PALETTE.snow));
  cap.position.y = 1.1;
  cap.scale.set(1, 0.5, 1);
  g.add(cap);
  g.userData.topY = 3.2;
  return g;
}

function makeCloud() {
  const g = new THREE.Group();
  // 아래에서 올려다봐도 어두워지지 않도록 라이팅을 받지 않는 재질을 쓴다
  const m = new THREE.MeshBasicMaterial({ color: PALETTE.cloud, transparent: true, opacity: 0.9, fog: true });
  const n = 3 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), m);
    s.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 12);
    const sc = 3.5 + Math.random() * 5;
    s.scale.set(sc, sc * 0.62, sc);
    g.add(s);
  }
  return g;
}

function makeFish() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 6, 5), flatMat(PALETTE.fish));
  body.scale.set(0.62, 0.85, 1.5);
  g.add(body);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 4), flatMat(0xffb020));
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = 1.4;
  g.add(tail);

  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), flatMat(0x22283a));
    eye.position.set(sx * 0.28, 0.22, -0.72);
    g.add(eye);
  }
  return g;
}

/* ================= 오브젝트 풀 =================
 * 플레이어 반경 밖으로 나간 오브젝트를 진행 방향 전방에 다시 뿌린다.
 */
class Pool {
  constructor(scene, factory, cfg) {
    this.cfg = cfg;
    this.items = [];
    for (let i = 0; i < cfg.count; i++) {
      const obj = factory();
      obj.visible = false;
      scene.add(obj);
      this.items.push({ obj: obj, placed: false, spin: Math.random() * 6.28, alive: true, radius: 0 });
    }
  }

  _place(it, px, pz, yaw) {
    const c = this.cfg;
    const spread = c.spread === undefined ? 1.35 : c.spread;
    // yaw 기준 전방 = (-sin(yaw), -cos(yaw))
    const a = yaw + (Math.random() - 0.5) * 2 * spread;
    const d = c.near + Math.random() * (c.far - c.near);
    const x = px - Math.sin(a) * d;
    const z = pz - Math.cos(a) * d;

    const s = c.scaleMin + Math.random() * (c.scaleMax - c.scaleMin);
    const o = it.obj;
    if (c.air) {
      o.position.set(x, c.minY + Math.random() * (c.maxY - c.minY), z);
    } else {
      o.position.set(x, terrainHeight(x, z) + (c.yOffset || 0), z);
    }
    o.scale.setScalar(s);
    o.rotation.y = Math.random() * Math.PI * 2;
    o.visible = true;
    it.placed = true;
    it.alive = true;
    it.radius = (c.hitRadius || 0) * s;
    it.baseY = o.position.y;
  }

  update(px, pz, yaw, dt, time) {
    const cull = this.cfg.cull;
    for (const it of this.items) {
      if (!it.placed) {
        this._place(it, px, pz, yaw);
        continue;
      }
      const dx = it.obj.position.x - px;
      const dz = it.obj.position.z - pz;
      if (!it.alive || dx * dx + dz * dz > cull * cull) {
        this._place(it, px, pz, yaw);
        continue;
      }
      if (this.cfg.spinSpeed) {
        it.obj.rotation.y += dt * this.cfg.spinSpeed;
        it.obj.position.y = it.baseY + Math.sin(time * 2 + it.spin) * 1.6;
      }
      if (this.cfg.driftX) it.obj.position.x += this.cfg.driftX * dt;
    }
  }
}

/* ================= World ================= */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    scene.background = new THREE.Color(PALETTE.fog);
    scene.fog = new THREE.Fog(PALETTE.fog, 110, 360);
    this._addSky(scene);

    // 레트로 라이팅: PBR 없이 반구광 + 방향광
    scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x8fa8c2, 0.80));
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.0);
    sun.position.set(-60, 120, 40);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9ecbff, 0.45);
    rim.position.set(60, 40, -80);
    scene.add(rim);

    this.terrain = new Terrain(scene);

    this.trees = new Pool(scene, makeTree, {
      count: 120, near: 70, far: 270, cull: 300,
      scaleMin: 0.7, scaleMax: 1.8, hitRadius: 3.0,
    });
    this.rocks = new Pool(scene, makeRock, {
      count: 60, near: 60, far: 270, cull: 300,
      scaleMin: 0.6, scaleMax: 2.2, yOffset: -0.6, hitRadius: 2.4,
    });
    this.clouds = new Pool(scene, makeCloud, {
      count: 26, near: 60, far: 320, cull: 360,
      scaleMin: 0.9, scaleMax: 2.4, air: true, minY: 100, maxY: 165,
      spread: 2.6, driftX: 1.5,
    });
    this.fish = new Pool(scene, makeFish, {
      count: 14, near: 100, far: 230, cull: 260,
      scaleMin: 1.2, scaleMax: 1.8, air: true, minY: 16, maxY: 72,
      spread: 0.85, spinSpeed: 1.4, hitRadius: 5.0,
    });
  }

  _addSky(scene) {
    const geo = new THREE.SphereGeometry(900, 12, 10);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top:    { value: new THREE.Color(PALETTE.sky) },
        bottom: { value: new THREE.Color(PALETTE.horizon) },
      },
      vertexShader: [
        'varying float vY;',
        'void main(){',
        '  vY = normalize(position).y;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 top;',
        'uniform vec3 bottom;',
        'varying float vY;',
        'void main(){',
        '  float t = clamp(vY * 1.35 + 0.28, 0.0, 1.0);',
        '  t = floor(t * 10.0) / 10.0;',   // 레트로 컬러 밴딩
        '  gl_FragColor = vec4(mix(bottom, top, t), 1.0);',
        '}',
      ].join('\n'),
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);
  }

  update(px, py, pz, yaw, dt) {
    this.time += dt;
    this.sky.position.set(px, py, pz);
    this.terrain.update(px, pz);
    this.trees.update(px, pz, yaw, dt, this.time);
    this.rocks.update(px, pz, yaw, dt, this.time);
    this.clouds.update(px, pz, yaw, dt, this.time);
    this.fish.update(px, pz, yaw, dt, this.time);
  }

  /** 물고기 획득 판정 → 이번 프레임에 먹은 개수 */
  collectFish(pos) {
    let got = 0;
    for (const it of this.fish.items) {
      if (!it.placed || !it.alive) continue;
      if (it.obj.position.distanceTo(pos) < (it.radius || 5)) {
        it.alive = false;
        it.obj.visible = false;
        got++;
      }
    }
    return got;
  }

  /** 나무/돌과 부딪혔는가 */
  hitsObstacle(pos) {
    for (const pool of [this.trees, this.rocks]) {
      for (const it of pool.items) {
        if (!it.placed) continue;
        const o = it.obj;
        const dx = o.position.x - pos.x;
        const dz = o.position.z - pos.z;
        if (dx * dx + dz * dz > 100) continue;
        const top = o.position.y + (o.userData.topY || 4) * o.scale.y;
        if (pos.y < top && Math.sqrt(dx * dx + dz * dz) < it.radius + 1.4) return true;
      }
    }
    return false;
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

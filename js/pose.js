/* ==========================================================
 *  pose.js — 웹캠 + MediaPipe Pose → 게임 입력
 *
 *  출력 컨트롤 상태:
 *    roll      -1(좌) ~ +1(우)   : 어느 팔이 더 내려갔는가
 *    flap       0 ~ 1            : 날갯짓의 세기
 *    tracked   bool              : 사람이 잡히는가
 *    landmarks 33개 (오버레이용)
 * ========================================================== */

const TASKS_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
                   'pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// 랜드마크 인덱스
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW    = 13, R_ELBOW    = 14;
const L_WRIST    = 15, R_WRIST    = 16;
const L_HIP      = 23, R_HIP      = 24;

// 튜닝값
const DEADZONE   = 0.13;   // 이보다 작은 팔 높이차는 "수평"으로 간주
const ROLL_FULL  = 0.85;   // 이 차이면 최대 선회
const FLAP_LOW   = 1.3;    // 날갯짓 판정 하한 (정규화된 팔 진동 속도)
const FLAP_HIGH  = 3.6;    // 이 이상이면 최대 양력
const VIS_MIN    = 0.45;   // landmark 신뢰도 하한
const DETECT_HZ  = 24;     // 추론 주기 상한. 추론은 메인 스레드를 막으므로
                           // 카메라 fps 를 그대로 따라가면 화면이 끊긴다.

export class PoseController {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;

    // 출력
    this.roll = 0;
    this.flap = 0;
    this.tracked = false;
    this.landmarks = null;
    this.raiseL = 0;
    this.raiseR = 0;

    // 내부 필터 상태
    this._rawRoll = 0;
    this._avg = 0;
    this._avgPrev = null;
    this._flapEma = 0;
    this._lostFrames = 0;
    this._lastDetect = 0;
  }

  /** 카메라 열고 모델 로드. 실패 시 throw */
  async start(onProgress = () => {}) {
    onProgress('카메라 권한 요청중...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    onProgress('모션 인식 엔진 로딩중...');
    const vision = await import(/* @vite-ignore */ `${TASKS_URL}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${TASKS_URL}/wasm`);

    onProgress('포즈 모델 내려받는 중... (약 6MB)');
    const opts = delegate => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      // WebGL 델리게이트를 못 쓰는 환경에서는 CPU로 (느리지만 동작)
      console.warn('GPU 델리게이트 실패, CPU로 전환:', e);
      onProgress('CPU 모드로 전환중...');
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  /** 매 프레임 호출. dt = 초 */
  update(dt) {
    if (!this.landmarker || this.video.readyState < 2) return;

    // 같은 프레임을 두 번 넣으면 MediaPipe가 에러를 낸다.
    // 여기에 더해 추론 주기에 상한을 둬서 렌더 프레임을 굶기지 않게 한다.
    const now = performance.now();
    if (this.video.currentTime !== this.lastVideoTime && now - this._lastDetect >= 1000 / DETECT_HZ) {
      this.lastVideoTime = this.video.currentTime;
      this._lastDetect = now;
      let res = null;
      try {
        res = this.landmarker.detectForVideo(this.video, performance.now());
      } catch (e) { /* 프레임 스킵 */ }

      const lm = res && res.landmarks && res.landmarks[0];
      if (lm && this._valid(lm)) {
        this.landmarks = lm;
        this._lostFrames = 0;
        this._measure(lm);
      } else {
        this._lostFrames++;
        if (this._lostFrames > 12) { this.landmarks = null; }
      }
    }

    this.tracked = this._lostFrames <= 12;

    // ---- 스무딩 ----
    if (this.tracked) {
      this.roll += (this._shape(this._rawRoll) - this.roll) * Math.min(1, dt * 12);
    } else {
      // 사람을 놓치면 입력을 서서히 중립으로
      this.roll += (0 - this.roll) * Math.min(1, dt * 3);
      this._flapEma += (0 - this._flapEma) * Math.min(1, dt * 2);
      this._avgPrev = null;
    }
    this.flap = clamp01((this._flapEma - FLAP_LOW) / (FLAP_HIGH - FLAP_LOW));
  }

  /** 상반신 주요 랜드마크가 모두 보이는가 */
  _valid(lm) {
    const need = [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST];
    return need.every(i => lm[i] && (lm[i].visibility === undefined || lm[i].visibility > VIS_MIN));
  }

  /** 랜드마크 → roll / flap 원시값 */
  _measure(lm) {
    const sL = lm[L_SHOULDER], sR = lm[R_SHOULDER];
    const wL = lm[L_WRIST],    wR = lm[R_WRIST];

    // 신체 스케일: 어깨 너비 (카메라 거리 보정). 정면 기준 0.15~0.4 정도.
    let scale = Math.hypot(sL.x - sR.x, sL.y - sR.y);
    // 팔을 벌리면 어깨가 흔들리므로 몸통 길이도 섞어서 안정화
    const hL = lm[L_HIP], hR = lm[R_HIP];
    if (hL && hR) {
      const torso = Math.abs((hL.y + hR.y) / 2 - (sL.y + sR.y) / 2);
      scale = scale * 0.6 + torso * 0.55;
    }
    if (scale < 0.04) return;   // 너무 멀거나 잘못 잡힘

    // 이미지 좌표는 y가 아래로 증가 → 부호 반전해서 "들어올린 정도"로
    const raiseL = (sL.y - wL.y) / scale;
    const raiseR = (sR.y - wR.y) / scale;
    this.raiseL = raiseL;
    this.raiseR = raiseR;

    // 오른팔이 낮으면(raiseR 작음) roll > 0 → 오른쪽 선회
    this._rawRoll = raiseL - raiseR;

    // 날갯짓: 양팔 평균 높이의 진동 속도
    const avg = (raiseL + raiseR) / 2;
    if (this._avgPrev !== null) {
      const dtv = Math.max(1 / 120, this._dtVideo());
      const v = Math.abs(avg - this._avgPrev) / dtv;
      // 상승은 빠르게, 하강은 천천히 → 파닥이면 유지, 멈추면 서서히 0
      const k = v > this._flapEma ? 0.45 : 0.10;
      this._flapEma += (v - this._flapEma) * k;
    }
    this._avgPrev = avg;
    this._avg = avg;
  }

  _dtVideo() {
    const now = performance.now();
    const dt = (now - (this._lastMeasure || now - 33)) / 1000;
    this._lastMeasure = now;
    return Math.min(0.1, dt);
  }

  /** 데드존 + 정규화 + 부드러운 곡선 */
  _shape(raw) {
    const s = Math.sign(raw);
    const a = Math.abs(raw);
    if (a < DEADZONE) return 0;
    const t = Math.min(1, (a - DEADZONE) / (ROLL_FULL - DEADZONE));
    return s * t * t * (3 - 2 * t);   // smoothstep
  }
}

/* ---------- 키보드 폴백 ---------- */
export class KeyController {
  constructor() {
    this.roll = 0; this.flap = 0; this.tracked = true; this.landmarks = null;
    this.raiseL = 0; this.raiseR = 0;
    this._left = false; this._right = false;
    this._flapEma = 0; this._space = false; this._taps = [];

    addEventListener('keydown', e => this._key(e, true));
    addEventListener('keyup',   e => this._key(e, false));
  }
  _key(e, down) {
    const k = e.key;
    if (k === 'ArrowLeft'  || k === 'a' || k === 'A') { this._left  = down; e.preventDefault(); }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { this._right = down; e.preventDefault(); }
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      if (down && !this._space) this._taps.push(performance.now());
      this._space = down; e.preventDefault();
    }
  }
  update(dt) {
    const target = (this._right ? 1 : 0) - (this._left ? 1 : 0);
    this.roll += (target - this.roll) * Math.min(1, dt * 7);
    this.raiseL = -this.roll; this.raiseR = this.roll;

    // 최근 1.1초 내 스페이스 연타 수 → 날갯짓 세기
    const now = performance.now();
    this._taps = this._taps.filter(t => now - t < 1100);
    const target2 = Math.min(1, this._taps.length / 4) * (this._space || this._taps.length ? 1 : 0);
    const k = target2 > this._flapEma ? 0.25 : 0.03;
    this._flapEma += (target2 - this._flapEma) * k;
    this.flap = clamp01(this._flapEma);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

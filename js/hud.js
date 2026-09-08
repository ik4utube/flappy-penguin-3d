/* ==========================================================
 *  hud.js — 계기판 + 웹캠 스켈레톤 오버레이
 * ========================================================== */

// MediaPipe Pose 연결선 (상반신 위주)
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [15, 17], [15, 19], [16, 18], [16, 20],
];

export class Hud {
  constructor() {
    this.el = {
      hud:    document.getElementById('hud'),
      speed:  document.getElementById('s-speed'),
      alt:    document.getElementById('s-alt'),
      dist:   document.getElementById('s-dist'),
      fish:   document.getElementById('s-fish'),
      fps:    document.getElementById('s-fps'),
      msg:    document.getElementById('state-msg'),
      flash:  document.getElementById('flash'),
      panel:  document.getElementById('cam-panel'),
      status: document.getElementById('cam-status'),
      barRoll: document.getElementById('bar-roll'),
      barFlap: document.getElementById('bar-flap'),
    };
    this.canvas = document.getElementById('cam-overlay');
    this.ctx = this.canvas.getContext('2d');
    this.video = document.getElementById('cam');
    this._msgUntil = 0;
    this._acc = 0;
    this._frames = 0;
    this._fps = 0;
  }

  show(useCam) {
    this.el.hud.classList.remove('hidden');
    if (useCam) this.el.panel.classList.remove('hidden');
  }

  /** 텍스트 배너 (충돌, 물고기 획득 등) */
  message(text, seconds = 1.2) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('show');
    this._msgUntil = performance.now() + seconds * 1000;
  }

  flash() {
    this.el.flash.classList.add('on');
    setTimeout(() => this.el.flash.classList.remove('on'), 90);
  }

  update(dt, stats, ctrl, useCam) {
    // 숫자는 초당 5회만 갱신 (레이아웃 비용 절약)
    this._frames++;
    this._acc += dt;
    if (this._acc > 0.2) {
      this._fps = Math.round(this._frames / this._acc);
      this._frames = 0;
      this._acc = 0;
      this.el.speed.textContent = Math.round(stats.speed);
      this.el.alt.textContent   = Math.round(stats.alt);
      this.el.dist.textContent  = stats.dist < 1000
        ? Math.round(stats.dist) + 'm'
        : (stats.dist / 1000).toFixed(2) + 'km';
      this.el.fish.textContent  = stats.fish;
      this.el.fps.textContent   = this._fps;
    }

    if (this._msgUntil && performance.now() > this._msgUntil) {
      this.el.msg.classList.remove('show');
      this._msgUntil = 0;
    }

    // 입력 게이지
    const r = Math.max(-1, Math.min(1, ctrl.roll));
    const half = 50 * Math.abs(r);
    this.el.barRoll.style.left  = (r >= 0 ? 50 : 50 - half) + '%';
    this.el.barRoll.style.width = half + '%';
    this.el.barFlap.style.width = Math.round(ctrl.flap * 100) + '%';

    if (useCam) this._drawCam(ctrl);
  }

  _drawCam(ctrl) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    c.fillStyle = '#040914';
    c.fillRect(0, 0, W, H);

    // 좌우 반전(거울) 상태로 웹캠 그리기
    if (this.video.readyState >= 2) {
      c.save();
      c.translate(W, 0);
      c.scale(-1, 1);
      c.globalAlpha = 0.55;
      c.drawImage(this.video, 0, 0, W, H);
      c.restore();
      c.globalAlpha = 1;
    }

    const lm = ctrl.landmarks;
    if (!lm) {
      this.el.status.textContent = '사람이 안 보여요';
      this.el.status.classList.add('lost');
      return;
    }
    this.el.status.classList.remove('lost');
    this.el.status.textContent = 'TRACKING';

    const X = p => (1 - p.x) * W;   // 거울 반전
    const Y = p => p.y * H;

    c.lineWidth = 2;
    c.strokeStyle = '#7fd4ff';
    c.beginPath();
    for (const [a, b] of BONES) {
      if (!lm[a] || !lm[b]) continue;
      c.moveTo(X(lm[a]), Y(lm[a]));
      c.lineTo(X(lm[b]), Y(lm[b]));
    }
    c.stroke();

    // 손목/어깨 강조
    const marks = [[11, '#ffd15c'], [12, '#ffd15c'], [15, '#ff6b5e'], [16, '#ff6b5e']];
    for (const [i, col] of marks) {
      if (!lm[i]) continue;
      c.fillStyle = col;
      c.fillRect(X(lm[i]) - 3, Y(lm[i]) - 3, 6, 6);
    }

    // 양팔 높이 기준선
    if (lm[15] && lm[16]) {
      c.strokeStyle = 'rgba(255,255,255,.35)';
      c.setLineDash([4, 4]);
      c.beginPath();
      c.moveTo(0, Y(lm[15])); c.lineTo(W, Y(lm[15]));
      c.moveTo(0, Y(lm[16])); c.lineTo(W, Y(lm[16]));
      c.stroke();
      c.setLineDash([]);
    }

    // 방향 표시
    c.fillStyle = '#ffffff';
    c.font = '14px monospace';
    c.textAlign = 'center';
    const dir = ctrl.roll > 0.15 ? '▶ 우선회' : ctrl.roll < -0.15 ? '◀ 좌선회' : '▲ 직진';
    c.fillText(dir, W / 2, H - 8);
    if (ctrl.flap > 0.15) {
      c.fillStyle = '#ffd15c';
      c.fillText('↑ 상승', W / 2, 16);
    }
  }
}

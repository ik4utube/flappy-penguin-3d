/* ==========================================================
 *  ui.js — 화면 전환 (타이틀 → 프롤로그 → 캐릭터 선택 → 모드)
 *
 *  3D 씬은 항상 뒤에서 돌고 있고, 이 모듈은 그 위에 얹히는
 *  오버레이만 담당한다. 카메라 연출 요청은 콜백으로 넘긴다.
 * ========================================================== */
import { CHARACTERS, PROLOGUE } from './characters.js';

const $ = id => document.getElementById(id);

export class Ui {
  /**
   * @param {object} hooks
   *   onPreview(mode)      'cinematic' | 'portrait'
   *   onCharacter(char)    선택이 바뀔 때 (3D 펭귄 교체)
   *   onStart(useCam)      플레이 시작
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.index = 0;
    this.storyStep = 0;
    this._typer = null;

    this.screens = {
      title:   $('scr-title'),
      story:   $('scr-story'),
      select:  $('scr-select'),
      mode:    $('scr-mode'),
      loading: $('scr-loading'),
    };

    this._buildRoster();
    this._bind();
    this.show('title');
  }

  /* ---------------- 화면 전환 ---------------- */
  show(name) {
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    $('ui').classList.remove('hidden');

    if (name === 'select') this.hooks.onPreview('portrait');
    else if (name !== 'loading') this.hooks.onPreview('cinematic');
  }

  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
    $('ui').classList.add('hidden');
  }

  loading(msg) {
    $('load-msg').textContent = msg;
    this.show('loading');
  }

  error(msg) {
    this.show('mode');
    const h = $('menu-hint');
    h.classList.add('err');
    h.textContent = msg;
  }

  get character() { return CHARACTERS[this.index]; }

  /* ---------------- 프롤로그 ---------------- */
  _startStory() {
    this.storyStep = 0;
    const dots = $('story-dots');
    dots.innerHTML = PROLOGUE.map(() => '<i></i>').join('');
    this.show('story');
    this._typeStep();
  }

  _typeStep() {
    const el = $('story-text');
    const text = PROLOGUE[this.storyStep];
    const dots = $('story-dots').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i <= this.storyStep);

    clearInterval(this._typer);
    el.classList.remove('done');
    el.textContent = '';
    let i = 0;
    this._typer = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(this._typer);
        this._typer = null;
        el.classList.add('done');
      }
    }, 38);

    $('btn-story-next').textContent =
      this.storyStep === PROLOGUE.length - 1 ? '펭귄 고르기 ▶' : '다음 ▶';
  }

  /** 타이핑 중이면 즉시 완성, 아니면 다음 문단 */
  _storyNext() {
    if (this._typer) {                       // 아직 찍는 중 → 마저 다 보여준다
      clearInterval(this._typer);
      this._typer = null;
      const el = $('story-text');
      el.textContent = PROLOGUE[this.storyStep];
      el.classList.add('done');
      return;
    }
    if (this.storyStep < PROLOGUE.length - 1) {
      this.storyStep++;
      this._typeStep();
    } else {
      this._openSelect();
    }
  }

  /* ---------------- 캐릭터 선택 ---------------- */
  _buildRoster() {
    const box = $('roster');
    box.innerHTML = '';
    CHARACTERS.forEach((c, i) => {
      const slot = document.createElement('button');
      slot.className = 'slot';
      slot.type = 'button';
      slot.dataset.index = i;
      slot.innerHTML =
        `<span class="chip" style="background:#${c.shape.body.toString(16).padStart(6, '0')}"></span>` +
        `<span class="nm">${c.name}</span>`;
      slot.addEventListener('click', () => this.select(i));
      box.appendChild(slot);
    });
  }

  _openSelect() {
    this.show('select');
    this.select(this.index, true);
  }

  select(i, force = false) {
    const n = CHARACTERS.length;
    i = ((i % n) + n) % n;
    if (i === this.index && !force) return;
    this.index = i;
    const c = CHARACTERS[i];

    [...$('roster').children].forEach((el, k) => el.classList.toggle('on', k === i));

    $('stage-tag').textContent = c.roman;
    $('ch-roman').textContent = c.roman;
    $('ch-name').textContent = c.name;
    $('ch-title').textContent = c.title;
    $('ch-quote').textContent = `“${c.quote}”`;
    $('ch-story').textContent = c.story;

    for (const [key, id] of [['speed', 'pip-speed'], ['turn', 'pip-turn'], ['lift', 'pip-lift']]) {
      $(id).innerHTML = Array.from({ length: 5 },
        (_, k) => `<b class="${k < c.stats[key] ? 'on' : ''}"></b>`).join('');
    }

    this.hooks.onCharacter(c);
  }

  /* ---------------- 입력 ---------------- */
  _bind() {
    $('btn-start').addEventListener('click', () => this._startStory());
    $('btn-story-next').addEventListener('click', () => this._storyNext());
    $('btn-story-skip').addEventListener('click', () => this._openSelect());

    $('btn-sel-back').addEventListener('click', () => this.show('title'));
    $('btn-sel-ok').addEventListener('click', () => this._openMode());

    $('btn-mode-back').addEventListener('click', () => this._openSelect());
    $('btn-cam').addEventListener('click', () => this.hooks.onStart(true));
    $('btn-key').addEventListener('click', () => this.hooks.onStart(false));

    addEventListener('keydown', e => this._key(e));
  }

  _openMode() {
    $('mode-name').textContent = this.character.name;
    const h = $('menu-hint');
    h.classList.remove('err');
    h.textContent = '웹캠 모드는 카메라 권한이 필요합니다. 상반신이 보이도록 1~2m 떨어져 주세요.';
    this.show('mode');
  }

  _key(e) {
    if ($('ui').classList.contains('hidden')) return;   // 게임 중
    const k = e.key;
    if (this.current === 'title') {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); this._startStory(); }
      return;
    }
    if (this.current === 'story') {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); this._storyNext(); }
      if (k === 'Escape') this._openSelect();
      return;
    }
    if (this.current === 'select') {
      if (k === 'ArrowRight') { e.preventDefault(); this.select(this.index + 1); }
      if (k === 'ArrowLeft')  { e.preventDefault(); this.select(this.index - 1); }
      if (k === 'ArrowDown')  { e.preventDefault(); this.select(this.index + 3); }
      if (k === 'ArrowUp')    { e.preventDefault(); this.select(this.index - 3); }
      if (k === 'Enter')      { e.preventDefault(); this._openMode(); }
      if (k === 'Escape')     this.show('title');
      return;
    }
    if (this.current === 'mode' && k === 'Escape') this._openSelect();
  }
}

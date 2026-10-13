/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 60 游戏主控
 *   状态机：menu → countdown → playing → paused / over
 *   第三人称跟随相机 / 定步长物理 / 分数与连击 / 排行榜联动 / 自适应画质
 * ========================================================================= */
(function (NP) {
  'use strict';

  const M = NP.M;
  const PAL = NP.PAL;
  const A = NP.Audio;
  const Board = NP.Board;

  const STATE = { MENU: 'menu', COUNT: 'countdown', PLAY: 'playing', PAUSE: 'paused', OVER: 'over' };
  const STEP = 1 / 120;         // 定步长物理
  const LIVES = 3;
  const COMBO_TIME = 2.6;
  const COMBO_MAX = 8;
  const COUNT_TIME = 0.62;

  const $ = (id) => document.getElementById(id);
  // 只在元素存在时写入，避免个别 UI 改动导致整个流程崩掉
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  class Game {
    constructor() {
      this.state = STATE.MENU;
      this.quality = 1;
      this.t = 0;                 // 本局时间
      this.acc = 0;
      this.distance = 0;
      this.orbScore = 0;
      this.orbs = 0;
      this.combo = 1;
      this.bestCombo = 1;
      this.comboTimer = 0;
      this.lives = LIVES;
      this.countT = 0;
      this.countStage = 3;
      this.shake = 0;
      this.roll = 0;
      this.camPos = new THREE.Vector3(0, 3, 10);
      this.camLook = new THREE.Vector3(0, 1.5, -6);
      this.safeSpot = { x: 0, y: 0, z: 0 };
      this.safeTimer = 0;
      this.heartT = 0;
      this.newRecord = false;
      this.savedRank = 0;
      this.fpsSamples = [];
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.fps = 60;
      this.showFps = false;
      this._rafId = null;
      this._last = 0;
    }

    /* ================================================== 初始化 */
    init() {
      const canvas = $('game-canvas');
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false
      });
      // 触屏设备（手机）默认像素比降到 1.5，避免中低端机型一开始就掉帧
      this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
      this.basePR = Math.min(window.devicePixelRatio || 1, this.isTouchDevice ? 1.5 : 2);
      this.renderer.setPixelRatio(this.basePR);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(PAL.fog, 1);

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.Fog(PAL.fog, 78, 330);

      this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
      this.camera.position.copy(this.camPos);

      // 光照：柔和半球光 + 一盏主平行光（投影）
      // 注意：three 传统光照模式下强度是叠加的，这里刻意压得很低，
      // 否则浅色卡通材质会整体过曝成白片。
      this.hemi = new THREE.HemisphereLight(0xe6f7ff, 0xffd9ee, 0.52);
      this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xfff4e2, 0.52);
      this.sun.position.set(-16, 26, 12);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
      sc.updateProjectionMatrix();
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);
      this.rim = new THREE.DirectionalLight(0xffd6ee, 0.16);
      this.rim.position.set(14, 8, -16);
      this.scene.add(this.rim);

      // 世界 / 特效 / 角色
      this.fx = new NP.FX(this.scene);
      this.world = new NP.World(this.scene, this.fx);
      this.player = new NP.Player(this.scene, this.fx);
      this.player.reset(this.world);
      this._bindPlayerEvents();

      this.input = this._initInput();
      this._bindUI();
      this._onResize();
      this._updateOrientation();
      window.addEventListener('resize', () => this._onResize());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === STATE.PLAY) this.pause();
      });

      // 静音偏好
      const pref = Board.getPrefs();
      A.setMuted(pref.muted);
      this._syncSoundBtn();

      this.renderBoard($('board-list'));
      this.renderBoard($('over-board'));
      $('menu-best').textContent = Board.best().toLocaleString('en-US');
      this._updateHUD();
      this._tickUi(0);
      this.startLoop();
      this.setState(STATE.MENU);
    }

    /* -------------------------------------------------- 玩家事件 */
    _bindPlayerEvents() {
      const p = this.player;
      p.onJump = () => {
        A.sfx.jump();
        this.fx.dust(p.pos.x, p.pos.y + 0.08, p.pos.z, 8, 0.8);
        this.fx.burst(p.pos.x, p.pos.y + 0.1, p.pos.z, { count: 8, speed: 3.2, colors: [PAL.neon.cyan, PAL.white], size: 0.22, life: 0.4, gravity: -3 });
      };
      p.onDoubleJump = () => {
        A.sfx.doubleJump();
        this.fx.burst(p.pos.x, p.pos.y + 0.5, p.pos.z, { count: 22, speed: 7.5, colors: [PAL.neon.purple, PAL.neon.pink, PAL.white], size: 0.3, life: 0.55, gravity: -5 });
        this.fx.dust(p.pos.x, p.pos.y + 0.3, p.pos.z, 8, 1.1);
      };
      p.onLand = (pl, impact) => {
        A.sfx.land(impact);
        this.fx.dust(pl.pos.x, pl.pos.y + 0.05, pl.pos.z, Math.round(9 * impact), 0.85 * impact);
        this.fx.burst(pl.pos.x, pl.pos.y + 0.06, pl.pos.z, { count: Math.round(7 * impact), speed: 3.6, colors: [PAL.pastel.aqua, PAL.white, PAL.neon.cyan], size: 0.2, life: 0.35, gravity: -2 });
        this.shake = Math.min(0.5, this.shake + 0.09 * impact);
      };
      p.onSlide = () => { A.sfx.slide(); };
      p.onHit = (pl, box) => this._takeHit(box);
      p.onFall = (pl) => this._takeFall();
    }

    _takeHit() {
      if (this.player.invuln > 0 || this.state !== STATE.PLAY) return;
      this.lives--;
      this.player.invuln = 1.5;
      this.player.vel.y = 4.4;               // 只是踉跄一下，不足以越障
      this.player.pos.z += 2.0;              // 撞击回弹
      this.player.speed *= 0.55;
      this.combo = 1;
      this.comboTimer = 0;
      this.shake = 0.62;
      A.sfx.hit();
      this.fx.crash(this.player.pos.x, this.player.pos.y + 0.9, this.player.pos.z);
      this._flash('-1 ♥', '#ff5f8d');
      this._updateHUD();
      if (this.lives <= 0) this.gameOver();
    }

    _takeFall() {
      if (this.state !== STATE.PLAY) return;
      this.lives--;
      A.sfx.fall();
      this._flash('-1 ♥', '#a06cff');
      this.player.respawn(this.world, this.safeSpot);
      this._snapCamera();
      this.fx.burst(this.player.pos.x, this.player.pos.y + 0.8, this.player.pos.z, {
        count: 30, speed: 6, colors: [PAL.neon.purple, PAL.white, PAL.pastel.lilac], size: 0.34, life: 0.7, gravity: 2
      });
      this.shake = 0.5;
      this.combo = 1;
      this._updateHUD();
      if (this.lives <= 0) this.gameOver();
    }

    /* -------------------------------------------------- 输入 */
    _initInput() {
      const st = {
        left: false, right: false, jumpHeld: false, jumpPressed: false,
        slideHeld: false, _jp: false, _jh: false, _sl: false
      };
      const keyMap = {
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
        ArrowDown: 'slide', s: 'slide', S: 'slide', Shift: 'slide',
        ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', Spacebar: 'jump'
      };
      window.addEventListener('keydown', (e) => {
        const k = keyMap[e.key];
        if (k) {
          e.preventDefault();
          if (k === 'jump') {
            if (!e.repeat) st._jp = true;
            st._jh = true;
          } else if (k === 'slide') st._sl = true;
          else st[k] = true;
          if (e.repeat) return;
        }
        // 全局功能键
        switch (e.key) {
          case 'Escape':
          case 'p': case 'P':
            if (this.state === STATE.PLAY) this.pause();
            else if (this.state === STATE.PAUSE) this.resume();
            break;
          case 'm': case 'M':
            this.toggleSound();
            break;
          case 'r': case 'R':
            if (this.state !== STATE.MENU) this.restart();
            break;
          case 'Enter':
            if (this.state === STATE.MENU) this.startGame();
            else if (this.state === STATE.OVER) {
              const inp = $('name-input');
              if (document.activeElement !== inp) this.saveScore();
            }
            break;
          case 'f': case 'F':
            this.showFps = !this.showFps;
            $('fps').style.display = this.showFps ? 'block' : 'none';
            break;
        }
        if ((e.key === ' ' || e.key === 'Enter') && this.state === STATE.MENU) this.startGame();
      });
      window.addEventListener('keyup', (e) => {
        const k = keyMap[e.key];
        if (!k) return;
        if (k === 'jump') st._jh = false;
        else if (k === 'slide') st._sl = false;
        else st[k] = false;
      });
      window.addEventListener('blur', () => {
        st.left = st.right = false; st._jh = false; st._sl = false;
      });
      this._initTouch(st);
      return st;
    }

    /* -------------------------------------------------- 触屏操作
     * · 左下 ◀ ▶ 按住持续横移（支持多指同时按）
     * · 右下「跳跃」「滑铲」按钮 + 画面上滑/下滑手势
     * 输入直接写进同一份输入状态，物理逻辑与键盘完全一致。
     */
    _initTouch(st) {
      const body = document.body;
      const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
      const markTouch = () => {
        body.classList.add('is-touch');
        this._updateOrientation();
      };
      if (touchCapable) markTouch();
      window.addEventListener('touchstart', markTouch, { once: true, passive: true });
      window.addEventListener('resize', () => this._updateOrientation());

      // 按钮：按下即生效，抬起/移出/取消都算松开
      const bind = (el, down, up) => {
        if (!el) return;
        const press = (e) => {
          e.preventDefault();
          if (el.setPointerCapture && e.pointerId !== undefined) {
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          }
          el.classList.add('pressed');
          down();
        };
        const release = () => {
          el.classList.remove('pressed');
          if (up) up();
        };
        el.addEventListener('pointerdown', press);
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('lostpointercapture', release);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
      };

      const btns = document.querySelectorAll('#touch .t-btn');
      btns.forEach((el) => {
        const act = el.dataset.act;
        if (act === 'left') bind(el, () => { st.left = true; }, () => { st.left = false; });
        else if (act === 'right') bind(el, () => { st.right = true; }, () => { st.right = false; });
        else if (act === 'jump') bind(el, () => { st._jp = true; st._jh = true; }, () => { st._jh = false; });
        else if (act === 'slide') bind(el, () => { st._sl = true; }, () => { st._sl = false; });
      });

      // 画布手势：上滑跳跃 / 下滑滑铲
      const canvas = $('game-canvas');
      let sx = 0, sy = 0, moved = false;
      canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
      canvas.addEventListener('pointermove', (e) => {
        if (moved) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) < 26 && Math.abs(dy) < 26) return;
        moved = true;
        if (dy < -26 && Math.abs(dy) > Math.abs(dx)) {
          st._jp = true; st._jh = true;                 // 上滑：跳
          setTimeout(() => { st._jh = false; }, 220);
        } else if (dy > 26 && Math.abs(dy) > Math.abs(dx)) {
          st._sl = true;                                 // 下滑：滑铲
          setTimeout(() => { st._sl = false; }, 700);
        }
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _updateOrientation() {
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      document.body.classList.toggle('is-portrait', portrait);
    }

    _readInput() {
      const st = this.input;
      const out = {
        left: st.left, right: st.right,
        jumpHeld: st._jh,
        slideHeld: st._sl,
        jumpPressed: false
      };
      if (st._jp) { out.jumpPressed = true; st._jp = false; }
      return out;
    }

    /* -------------------------------------------------- UI 绑定 */
    _bindUI() {
      const click = (id, fn) => {
        const el = $(id);
        if (el) el.addEventListener('click', (e) => {
          e.preventDefault();
          A.sfx.ui();
          if (el.blur) el.blur();          // 防止空格/回车重复触发按钮
          fn();
        });
      };
      click('btn-start', () => this.startGame());
      click('btn-retry', () => this.restart());
      click('btn-quit', () => this.toMenu());
      click('btn-resume', () => this.resume());
      click('btn-pause', () => this.pause());
      click('btn-menu', () => this.toMenu());
      click('btn-sound', () => this.toggleSound());
      click('btn-sound2', () => this.toggleSound());
      click('btn-sound-menu', () => this.toggleSound());
      click('btn-save', () => this.saveScore());
      click('btn-board', () => { this.renderBoard($('board-list')); this._show('board-panel'); });
      click('btn-board-close', () => this._hide('board-panel'));
      click('btn-board-clear', () => {
        if (window.confirm('确定要清空排行榜吗？此操作不可撤销。')) {
          Board.clear();
          this.renderBoard($('board-list'));
          this.renderBoard($('over-board'));
          $('menu-best').textContent = '0';
        }
      });
      const nameInput = $('name-input');
      if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); this.saveScore(); }
        });
      }
    }

    _show(id) { const el = $(id); if (el) el.classList.add('show'); }
    _hide(id) { const el = $(id); if (el) el.classList.remove('show'); }

    _syncSoundBtn() {
      const txt = A.muted ? '🔇 静音中 (M)' : '🔊 音效开 (M)';
      ['btn-sound', 'btn-sound2', 'btn-sound-menu'].forEach((id) => { const el = $(id); if (el) el.textContent = txt; });
    }

    toggleSound() {
      const muted = A.toggleMute();
      Board.setPrefs(Object.assign(Board.getPrefs(), { muted: muted }));
      this._syncSoundBtn();
      if (!muted) A.sfx.ui();
    }

    _flash(text, color) {
      const el = $('flash');
      el.textContent = text;
      el.style.color = color || '#1fd8ff';
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }

    /* ================================================== 状态切换 */
    setState(s) {
      this.state = s;
      const wrap = document.body;
      wrap.dataset.state = s;
      $('hud').classList.toggle('show', s === STATE.PLAY || s === STATE.PAUSE || s === STATE.COUNT);
      this._hide('menu'); this._hide('over'); this._hide('pause-panel'); this._hide('board-panel');
      if (s === STATE.MENU) { this._show('menu'); A.playMusicMenu(); }
      if (s === STATE.PAUSE) { this._show('pause-panel'); }
      if (s === STATE.OVER) { this._show('over'); A.playMusicMenu(); }
      if (s === STATE.PLAY) A.playMusicIn();
      $('btn-pause').classList.toggle('show', s === STATE.PLAY);
    }

    startGame() {
      A.resume();
      this.newRun();
      this.countT = COUNT_TIME;
      this.countStage = 3;
      this.setState(STATE.COUNT);
      $('count').textContent = '3';
      $('count').classList.add('show');
      A.sfx.ui();
    }

    newRun() {
      this.t = 0; this.acc = 0;
      this.distance = 0; this.orbScore = 0; this.orbs = 0;
      this.combo = 1; this.bestCombo = 1; this.comboTimer = 0;
      this.lives = LIVES;
      this.shake = 0; this.heartT = 0;
      this.savedRank = 0; this.newRecord = false;
      this.world.reset();
      this.player.reset(this.world);
      this.fx.clearTrail();
      this.fx.setTrailActive(1);
      this.fx.popups.clear();
      this._snapCamera();
      this.safeSpot = { x: 0, y: 0, z: 2 };
      this.safeTimer = 0;
      this.pendingJump = false;
      this.sun.position.set(this.player.pos.x - 7, 30, this.player.pos.z + 8);
      this._updateHUD();
      $('name-input').value = Board.getPlayerName() || '';
      $('save-done').classList.remove('show');
      $('name-row').style.display = 'flex';
      this._hide('over-board-wrap');
    }

    restart() {
      A.resume();
      this.newRun();
      this.countT = COUNT_TIME;
      this.countStage = 3;
      this.setState(STATE.COUNT);
      $('count').textContent = '3';
      $('count').classList.add('show');
    }

    pause() {
      if (this.state !== STATE.PLAY) return;
      this.setState(STATE.PAUSE);
    }

    resume() {
      if (this.state !== STATE.PAUSE) return;
      this.setState(STATE.PLAY);
      this.fx.setTrailActive(1);
    }

    toMenu() {
      this.setState(STATE.MENU);
      this.world.reset();
      this.player.reset(this.world);
      this.fx.clearTrail();
      this.fx.setTrailActive(0);
      $('menu-best').textContent = Board.best().toLocaleString('en-US');
      this.renderBoard($('board-list'));
    }

    gameOver() {
      if (this.state === STATE.OVER) return;
      this.player.alive = false;
      this.state = STATE.OVER;
      this.fx.setTrailActive(0);
      A.sfx.over();
      this.shake = 0.4;
      const score = this.totalScore;
      const qualifies = Board.qualifies(score);
      setTxt('over-score-big', score.toLocaleString('en-US'));
      setTxt('over-dist', Math.floor(this.distance).toLocaleString('en-US'));
      setTxt('over-orbs', this.orbs);
      setTxt('over-combo', 'x' + this.bestCombo);
      setTxt('over-best', Board.best().toLocaleString('en-US'));
      setTxt('over-rank-hint', qualifies
        ? '🏆 成绩够格进入排行榜，留下你的名字吧！'
        : '本次成绩未进入前十，仍可保存留念。');
      $('name-row').style.display = 'flex';
      $('save-done').classList.remove('show');
      this._hide('over-board-wrap');
      this.setState(STATE.OVER);
      this.renderBoard($('over-board'));
    }

    saveScore() {
      if (this.state !== STATE.OVER || this.savedRank > 0) return;
      const input = $('name-input');
      let name = (input.value || '').replace(/[<>]/g, '').trim().slice(0, 12);
      if (!name) name = 'RUNNER';
      const score = this.totalScore;
      const res = Board.add({
        name: name,
        score: score,
        distance: Math.floor(this.distance),
        orbs: this.orbs,
        combo: this.bestCombo
      });
      this.savedRank = res.rank;
      this.newRecord = res.isRecord;
      input.value = name;
      $('name-row').style.display = 'none';
      const done = $('save-done');
      done.textContent = res.rank <= 10
        ? `已保存 · 第 ${res.rank} 名${res.isRecord ? ' · 新纪录！' : ''}`
        : `已保存 · 第 ${res.rank} 名（未进前十）`;
      done.classList.add('show');
      $('over-best').textContent = Board.best().toLocaleString('en-US');
      $('menu-best').textContent = Board.best().toLocaleString('en-US');
      this.renderBoard($('over-board'), res.entry);
      this._show('over-board-wrap');
      A.sfx[res.isRecord ? 'record' : 'ui']();
    }

    get totalScore() { return Math.floor(this.distance) + this.orbScore; }

    /* -------------------------------------------------- 排行榜渲染 */
    renderBoard(container, highlight) {
      if (!container) return;
      const list = Board.top(10);
      container.textContent = '';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'board-empty';
        empty.textContent = '榜单空空的，快去创造第一条成绩吧！';
        container.appendChild(empty);
        return;
      }
      list.forEach((e, i) => {
        const row = document.createElement('div');
        row.className = 'board-row' + (e.npc ? ' npc' : '') + (highlight && highlight === e ? ' me' : '');
        const medal = ['①', '②', '③'][i] || (i + 1);
        const rk = document.createElement('span'); rk.className = 'b-rank'; rk.textContent = medal;
        const nm = document.createElement('span'); nm.className = 'b-name'; nm.textContent = e.name;
        if (e.npc) {
          const tag = document.createElement('i');
          tag.className = 'b-tag';
          tag.textContent = 'BOT';
          nm.appendChild(tag);
        }
        const sc = document.createElement('span'); sc.className = 'b-score'; sc.textContent = e.score.toLocaleString('en-US');
        const dt = document.createElement('span'); dt.className = 'b-meta';
        dt.textContent = (e.distance || 0) + 'm · x' + (e.combo || 1);
        row.append(rk, nm, sc, dt);
        container.appendChild(row);
      });
    }

    /* ================================================== 主循环 */
    startLoop() {
      this._last = performance.now();
      const loop = (now) => {
        this._rafId = requestAnimationFrame(loop);
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > 0.25) dt = 0.25;          // 切后台回来不要瞬移
        this.step(dt);
      };
      this._rafId = requestAnimationFrame(loop);
    }

    step(dt) {
      // FPS 统计
      this.fpsAcc += dt; this.fpsFrames++;
      if (dt > (this.maxDt || 0)) this.maxDt = dt;      // 用于排查卡顿（F 键性能面板）
      if (this.fpsAcc > 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0; this.fpsFrames = 0;
        this._adaptQuality();
        if (this.showFps) $('fps').textContent = this.fps.toFixed(0) + ' fps · ' + this.renderer.info.render.calls + ' calls';
      }

      if (this.state === STATE.COUNT) this._stepCountdown(dt);
      else if (this.state === STATE.PLAY) this._stepPlay(dt);
      else this._stepIdle(dt);

      this._updateCamera(dt);
      this._updateWorldVisual(dt);
      this.fx.setPixelScale(this._pixelScale());
      this.fx.update(dt);
      this.renderer.render(this.scene, this.camera);
      this._tickUi(dt);
    }

    _pixelScale() {
      const h = this.renderer.domElement.height;
      const fov = this.camera.fov * Math.PI / 180;
      return h / (2 * Math.tan(fov / 2));
    }

    _stepCountdown(dt) {
      this.countT -= dt;
      const stage = Math.max(0, Math.ceil(this.countT / COUNT_TIME));
      if (stage !== this.countStage) {
        this.countStage = stage;
        const el = $('count');
        if (stage > 0) {
          el.textContent = String(stage);
          el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
          A.sfx.coin(0);
        } else {
          el.textContent = 'GO!';
          el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
          A.sfx.start();
        }
      }
      // 倒计时期间原地踏步（世界与动画继续运转）
      this.player.update(dt, this.world,
        { left: false, right: false, jumpHeld: false, slideHeld: false, jumpPressed: false },
        this.t, { frozen: true });
      this.world.update(dt, this.player.pos.z, this.quality > 0.8);
      this.world.setCamX(this.camPos.x);
      if (this.countT <= -0.5) {
        $('count').classList.remove('show');
        this.player.speed = 0;             // 从零加速起跑
        this.setState(STATE.PLAY);
        this.player.invuln = 0.5;
        this._flash('GO!', '#1fd8ff');
      }
    }

    _stepPlay(dt) {
      const inp = this._readInput();
      this.t += dt;
      A.setIntensity(M.clamp((this.player.speed - 13) / 17, 0, 1));

      // 跳跃输入跨帧保留：定步长物理可能一帧内不推进
      if (inp.jumpPressed) this.pendingJump = true;

      // 定步长物理
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        const sub = {
          left: inp.left, right: inp.right,
          jumpHeld: inp.jumpHeld, slideHeld: inp.slideHeld,
          jumpPressed: !!this.pendingJump
        };
        this.player.update(STEP, this.world, sub, this.t);
        this.pendingJump = false;
        this.acc -= STEP;
        steps++;
        if (this.state !== STATE.PLAY) break;
      }
      if (steps >= 8) this.acc = 0;
      this.player.tickRender();

      // 距离与分数
      this.distance = Math.max(this.distance, -this.player.pos.z);
      // 连击计时
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) { this.combo = 1; }
      }

      // 拾取能量珠
      const got = this.world.collect(this.player.pos, 1.05);
      for (const o of got) {
        this.orbs++;
        this.orbScore += 10 * this.combo;
        this.combo = Math.min(COMBO_MAX, this.combo + 1);
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.comboTimer = COMBO_TIME;
        A.sfx.coin(this.combo);
        this.fx.pickup(o.x, o.mesh.position.y, o.z, Math.max(1, this.combo - 1));
        if (this.combo >= 5 && this.combo % 2 === 1) this._flash('COMBO x' + this.combo, '#ff4fb8');
      }

      // 复活点捕捉
      this.safeTimer -= dt;
      if (this.player.grounded && this.safeTimer <= 0) {
        const plat = this.world.platformAt(this.player.pos.x, this.player.pos.z, this.player.pos.y);
        if (plat) {
          const cx = M.clamp(this.player.pos.x, plat.minX + 2, plat.maxX - 2);
          const cz = M.clamp(this.player.pos.z, plat.minZ + 2, plat.maxZ - 2);
          this.safeSpot = { x: cx, y: plat.topY, z: cz };
          this.safeTimer = 0.25;
        }
      }

      // 一血心跳
      if (this.lives === 1) {
        this.heartT -= dt;
        if (this.heartT <= 0) { A.sfx.heartbeat(); this.heartT = 1.15; }
      }

      this.world.update(dt, this.player.pos.z, this.quality > 0.8);
      this.world.setCamX(this.camPos.x);
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    /* 菜单 / 暂停 / 结算：角色原地待机，世界少量更新 */
    _stepIdle(dt) {
      this.player.update(dt, this.world,
        { left: false, right: false, jumpHeld: false, slideHeld: false, jumpPressed: false },
        this.t, { frozen: true });
      // 保底：待机状态下若被顶出赛道，拉回出生点
      if (this.player.pos.y < this.world.spawn.y - 3) {
        this.player.reset(this.world);
        this._snapCamera();
      }
      if (this.state !== STATE.PAUSE) {
        this.world.update(dt, this.player.pos.z, this.quality > 0.8);
      }
      this.world.setCamX(this.camPos.x);
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    /** 立即对齐相机（复活/重开时避免长距离拖拽） */
    _snapCamera() {
      const p = this.player.pos;
      this.camPos.set(p.x * 0.92, p.y + 2.05, p.z + 5.15);
      this.camLook.set(p.x * 0.55, p.y + 1.25, p.z - 6.4);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
    }

    /* -------------------------------------------------- 相机 */
    _updateCamera(dt) {
      const p = this.player.pos;
      const spdN = M.clamp((this.player.speed - 13) / 17, 0, 1);

      // 目标位置：身后上方，横向部分跟随（留出前方视野）
      // 竖屏视野窄，相机拉近一些，避免角色小得看不清
      const narrow = this.camera.aspect < 1.05;
      const wantX = p.x * 0.92;
      const wantY = p.y + (narrow ? 1.95 : 2.05);
      const wantZ = p.z + (narrow ? 4.85 : 5.15) + spdN * 0.9;
      this.camPos.x = M.damp(this.camPos.x, wantX, 6.5, dt);
      this.camPos.y = M.damp(this.camPos.y, wantY, this.player.grounded ? 5.0 : 2.6, dt);
      this.camPos.z = M.damp(this.camPos.z, wantZ, 9, dt);

      const lookX = p.x * 0.9;
      const lookY = p.y + (narrow ? 0.95 : 1.15);
      const lookZ = p.z - (narrow ? 6.1 : 6.4) - spdN * 2.4;
      this.camLook.x = M.damp(this.camLook.x, lookX, 7, dt);
      this.camLook.y = M.damp(this.camLook.y, lookY, 4.5, dt);
      this.camLook.z = M.damp(this.camLook.z, lookZ, 9, dt);

      const sx = this.shake ? (Math.random() - 0.5) * this.shake * 0.7 : 0;
      const sy = this.shake ? (Math.random() - 0.5) * this.shake * 0.7 : 0;
      this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
      this.camera.lookAt(this.camLook.x, this.camLook.y, this.camLook.z);
      const wantRoll = -this.player.vel.x * 0.007 + (this.shake ? (Math.random() - 0.5) * this.shake * 0.25 : 0);
      this.roll = M.damp(this.roll, wantRoll, 7, dt);
      this.camera.rotateZ(this.roll);

      // 视角按「水平视角」恒定来算：three 的 fov 是垂直视角，
      // 直接固定它会在大宽高比（手机横屏）下把水平视角顶到 110°+，角色小得像蚂蚁。
      const aspect = this.camera.aspect || 1.6;
      const targetH = 88 + spdN * 12;                                   // 期望水平视角
      const vfov = 2 * Math.atan(Math.tan(targetH * Math.PI / 360) / aspect) * 180 / Math.PI;
      const wantFov = M.clamp(vfov, 42, 68);
      this.camera.fov = M.damp(this.camera.fov, wantFov, 3, dt);
      this.camera.updateProjectionMatrix();
      // 竖屏等窄视野下，世界空间飘字要相应缩小，否则会糊满屏幕
      this.fx.popups.baseScale = M.clamp(aspect / 1.7, 0.5, 1.15);

      // 阴影相机跟随
      this.sun.position.set(p.x - 7, p.y + 30, p.z + 8);
      this.sun.target.position.set(p.x, p.y, p.z);
      this.sun.target.updateMatrixWorld();
    }

    _updateWorldVisual(dt) {
      // 角色渲染位置同步（相机已用物理位置）
      this.player.tickRender();
      // 地面阴影跟随（用道具化的软阴影替代真实阴影的成本）
    }

    /* -------------------------------------------------- HUD */
    _updateHUD() {
      const hearts = $('hud-lives');
      hearts.textContent = '';
      for (let i = 0; i < LIVES; i++) {
        const s = document.createElement('span');
        s.className = 'heart' + (i < this.lives ? '' : ' lost');
        s.textContent = '♥';
        hearts.appendChild(s);
      }
      $('hud-best').textContent = Board.best().toLocaleString('en-US');
      $('hud-score').textContent = this.totalScore.toLocaleString('en-US');
      $('hud-dist').textContent = Math.floor(this.distance) + ' m';
      $('hud-orbs').textContent = this.orbs;
    }

    _tickUi(dt) {
      if (this.state !== STATE.PLAY && this.state !== STATE.COUNT) return;
      $('hud-score').textContent = this.totalScore.toLocaleString('en-US');
      $('hud-dist').textContent = Math.floor(this.distance) + ' m';
      $('hud-orbs').textContent = this.orbs;
      const cx = $('hud-combo');
      if (this.combo > 1) {
        cx.classList.add('show');
        cx.textContent = 'x' + this.combo;
        cx.style.setProperty('--cd', (this.comboTimer / COMBO_TIME).toFixed(3));
        cx.classList.toggle('hot', this.combo >= 5);
      } else {
        cx.classList.remove('show');
      }
      const spdN = M.clamp((this.player.speed - 13) / 17, 0, 1);
      $('hud-speed-fill').style.width = (8 + spdN * 92).toFixed(1) + '%';
      $('hud-speed-num').textContent = Math.round(this.player.speed * 3.6) + ' km/h';
    }

    /* -------------------------------------------------- 自适应画质 */
    _adaptQuality() {
      const lowBar = this.isTouchDevice ? 50 : 46;
      if (this.fps < lowBar) {
        this._lowFrames = (this._lowFrames || 0) + 1;
        if (this.quality > 0.6 && this._lowFrames >= 2) {
          this.quality = 0.62;
          this.fx.quality = 0.6;
          this.renderer.setPixelRatio(Math.min(1, this.basePR));
          this.renderer.shadowMap.enabled = false;
        }
      } else if (this.fps > (this.isTouchDevice ? 58 : 57)) {
        this._lowFrames = 0;
        if (this.quality < 1) {
          this.quality = 1;
          this.fx.quality = 1;
          this.renderer.setPixelRatio(this.basePR);
          this.renderer.shadowMap.enabled = true;
        }
      }
    }

    /* -------------------------------------------------- 尺寸 */
    _onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    }
  }

  NP.Game = Game;
  NP.GAME_STATE = STATE;
})(window.NP);

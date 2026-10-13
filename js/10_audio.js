/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 10 音频层
 * 全部用 WebAudio 实时合成（不依赖任何音频文件）：
 *   · 自适应 BGM：五声音阶琶音 + 弹拨贝斯 + 柔和 pad + 轻鼓，速度越快越"燃"
 *   · 音效：跳跃 / 二段跳 / 落地 / 滑铲 / 拾取（连击升高音）/ 撞击 / 坠落 / 结束
 * ========================================================================= */
(function (NP) {
  'use strict';

  const A = {
    ctx: null,
    master: null,
    musicBus: null,
    sfxBus: null,
    delay: null,
    ready: false,
    muted: false,
    musicOn: true,
    intensity: 0,     // 0~1，由游戏速度驱动
    _timer: null,
    _step: 0,
    _nextTime: 0,
    _noise: null,
    _padOsc: null,
    _padGain: null,
    _padFilter: null
  };

  const BPM = 104;
  const STEP = 60 / BPM / 4;           // 十六分音符时长
  const PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  const ROOTS = [110.0, 87.31, 130.81, 98.0];   // Am - F - C - G
  const BARS = 4;

  /* ------------------------------------------------------------ 初始化 */
  A.init = function () {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.5;
    this.sfxBus.connect(this.master);

    // 梦幻延迟（琶音尾巴）
    const dl = ctx.createDelay(1.0);
    dl.delayTime.value = 60 / BPM * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 2600;
    dl.connect(fb); fb.connect(damp); damp.connect(dl);
    dl.connect(wet); wet.connect(this.musicBus);
    this.delay = dl;

    // 白噪声缓冲
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;

    // 恒定 pad（缓慢起伏，营造赛博氛围）
    const padGain = ctx.createGain();
    padGain.gain.value = 0.0;
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass'; pf.frequency.value = 780; pf.Q.value = 0.7;
    padGain.connect(pf); pf.connect(this.musicBus);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 110;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 110 * 1.007;
    o1.connect(padGain); o2.connect(padGain);
    o1.start(); o2.start();
    this._padOsc = [o1, o2];
    this._padGain = padGain;
    this._padFilter = pf;

    this.ready = true;
    return true;
  };

  A.resume = function () {
    if (!this.ready) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  A.now = function () { return this.ctx ? this.ctx.currentTime : 0; };

  /* ------------------------------------------------------------ 原子发声 */
  function env(gain, t, a, d, peak) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function blip(freq, dur, type, vol, at, bus, slideTo) {
    if (!A.ready) return;
    const ctx = A.ctx, t = at || ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    env(g, t, Math.min(0.012, dur * 0.25), dur, vol === undefined ? 0.3 : vol);
    o.connect(g); g.connect(bus || A.sfxBus);
    o.start(t); o.stop(t + dur + 0.06);
    return o;
  }

  function noiseBurst(dur, vol, at, filterType, freq, q) {
    if (!A.ready) return;
    const ctx = A.ctx, t = at || ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = A._noise;
    s.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t);
    f.Q.value = q === undefined ? 1 : q;
    const g = ctx.createGain();
    env(g, t, 0.004, dur, vol === undefined ? 0.25 : vol);
    s.connect(f); f.connect(g); g.connect(A.sfxBus);
    s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.05);
    return f;
  }

  /* ------------------------------------------------------------ 音效集 */
  A.sfx = {
    jump() {
      blip(430, 0.16, 'sine', 0.30, 0, null, 900);
      noiseBurst(0.07, 0.10, 0, 'highpass', 2600, 0.8);
    },
    doubleJump() {
      blip(660, 0.18, 'triangle', 0.26, 0, null, 1380);
      blip(990, 0.12, 'sine', 0.14, 0.02, null, 1500);
    },
    land(power) {
      const p = NP.M.clamp(power === undefined ? 1 : power, 0.2, 1.6);
      blip(150 * p + 60, 0.13, 'sine', 0.22 * p, 0, null, 70);
      noiseBurst(0.1, 0.09 * p, 0, 'lowpass', 900, 0.6);
    },
    slide() {
      const f = noiseBurst(0.42, 0.16, 0, 'bandpass', 520, 1.2);
      if (f) f.frequency.exponentialRampToValueAtTime(1800, A.now() + 0.4);
    },
    coin(step) {
      const i = NP.M.clamp(step || 0, 0, 9);
      const base = PENTA[Math.min(PENTA.length - 1, i + 3)];
      blip(base, 0.1, 'triangle', 0.22);
      blip(base * 2, 0.16, 'sine', 0.16, A.now() + 0.06);
    },
    hit() {
      noiseBurst(0.26, 0.34, 0, 'bandpass', 900, 0.9);
      blip(320, 0.34, 'sawtooth', 0.26, 0, null, 60);
    },
    fall() {
      blip(700, 0.7, 'triangle', 0.24, 0, null, 90);
      noiseBurst(0.5, 0.1, 0, 'lowpass', 700, 0.5);
    },
    over() {
      const t = A.now();
      [440, 349.23, 293.66, 220].forEach((f, i) => {
        blip(f, 0.5, 'triangle', 0.22, t + i * 0.13);
        blip(f * 2, 0.4, 'sine', 0.10, t + i * 0.13 + 0.02);
      });
    },
    start() {
      const t = A.now();
      [329.63, 392.0, 523.25, 659.25].forEach((f, i) => blip(f, 0.34, 'triangle', 0.2, t + i * 0.085));
      blip(1046.5, 0.6, 'sine', 0.14, t + 0.36);
    },
    ui() { blip(760, 0.07, 'triangle', 0.16); blip(1140, 0.06, 'sine', 0.1, A.now() + 0.04); },
    heartbeat() {
      const t = A.now();
      blip(62, 0.2, 'sine', 0.42, t, null, 44);
      blip(58, 0.24, 'sine', 0.3, t + 0.19, null, 40);
    },
    record() {
      const t = A.now();
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => blip(f, 0.5, 'triangle', 0.2, t + i * 0.1));
    }
  };

  /* ------------------------------------------------------------ BGM 调度 */
  function scheduleStep(step, t) {
    const bar = Math.floor(step / 16) % BARS;
    const s16 = step % 16;
    const root = ROOTS[bar];
    const inten = A.intensity;

    // 贝斯：弹拨，八分音符跳进
    if (s16 % 2 === 0) {
      const off = (s16 === 6 || s16 === 14) ? 2 : (s16 % 8 === 4 ? 1.5 : 1);
      const f = root * (s16 % 4 === 0 ? 1 : off);
      blip(f, 0.2, 'triangle', 0.34, t, A.musicBus);
      blip(f * 0.5, 0.24, 'sine', 0.18, t, A.musicBus);   // 低八度叠加厚度
    }

    // 琶音：延迟尾巴制造梦幻感
    const arpPattern = [0, 3, 5, 7, 8, 7, 5, 3];
    if (s16 % 2 === 1) {
      const idx = arpPattern[(s16 >> 1) % arpPattern.length] + (bar % 2 ? 1 : 0);
      const f = PENTA[Math.min(PENTA.length - 1, idx)];
      const o = blip(f, 0.22, 'sine', 0.13 + inten * 0.05, t, null, f);
      if (o && A.delay) o.connect(A.delay);
    }
    if (s16 === 0 || s16 === 10) {
      const f = PENTA[(bar + 4) % PENTA.length];
      const o = blip(f * 2, 0.5, 'triangle', 0.07, t, A.musicBus);
      if (o && A.delay) o.connect(A.delay);
    }

    // 鼓：速度越快越明显
    if (inten > 0.12 && (s16 === 0 || s16 === 8 || (inten > 0.5 && s16 === 11))) {
      const ctx = A.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.14);
      const g = ctx.createGain();
      env(g, t, 0.002, 0.17, 0.42);
      o.connect(g); g.connect(A.musicBus);
      o.start(t); o.stop(t + 0.24);
    }
    if (inten > 0.25 && s16 % 4 === 2) {
      noiseBurst(0.035, 0.05 + inten * 0.05, t, 'highpass', 8200, 0.7);
    }
    if (inten > 0.55 && s16 % 2 === 1) {
      noiseBurst(0.025, 0.022 + inten * 0.02, t, 'highpass', 9200, 0.6);
    }

    // pad 跟随和弦根音
    if (A._padOsc && s16 === 0) {
      const tt = t;
      A._padOsc[0].frequency.setTargetAtTime(root, tt, 0.08);
      A._padOsc[1].frequency.setTargetAtTime(root * 1.007, tt, 0.08);
      A._padOsc[1].detune.setValueAtTime(bar % 2 ? 8 : -8, tt);
    }
  }

  function tick() {
    if (!A.ready || !A.musicOn) return;
    const ctx = A.ctx;
    const now = ctx.currentTime;
    // 浏览器自动播放策略或切后台会让 AudioContext 挂起、currentTime 停走。
    // 恢复时若时间已经跳远，必须重新对齐，否则会在一次 tick 里补排上百个音符。
    if (A._nextTime < now - 0.4) {
      A._nextTime = now + 0.05;
    }
    const lookahead = 0.14;
    let guard = 0;
    while (A._nextTime < now + lookahead && guard++ < 64) {
      scheduleStep(A._step, A._nextTime);
      A._step++;
      A._nextTime += STEP;
    }
  }

  A.startMusic = function () {
    if (!this.init()) return;
    this.resume();
    this.musicOn = true;
    if (this._timer) return;
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.1;
    this._timer = setInterval(tick, 25);
    this._step = 0;
  };

  A.stopMusic = function (fade) {
    this.musicOn = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.ready) {
      this.musicBus.gain.cancelScheduledValues(this.now());
      this.musicBus.gain.setTargetAtTime(0, this.now(), (fade || 0.4) / 3);
    }
  };

  // 播放中：音量渐入
  A.playMusicIn = function () {
    if (!this.init()) return;
    this.resume();
    if (!this._timer) this.startMusic();
    this.musicOn = true;
    const t = this.now();
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.34, t, 0.6);
    this._nextTime = Math.max(this._nextTime, t + 0.05);
  };

  // 菜单中：更安静的氛围
  A.playMusicMenu = function () {
    if (!this.init()) return;
    this.resume();
    if (!this._timer) this.startMusic();
    this.musicOn = true;
    const t = this.now();
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.2, t, 1.0);
    this._nextTime = Math.max(this._nextTime, t + 0.05);
  };

  A.setIntensity = function (v) {
    this.intensity = NP.M.clamp(v, 0, 1);
    if (this.ready && this._padGain) {
      this._padGain.gain.setTargetAtTime(0.05 + this.intensity * 0.06, this.now(), 0.5);
      this._padFilter.frequency.setTargetAtTime(620 + this.intensity * 900, this.now(), 0.6);
    }
  };

  A.setMuted = function (m) {
    this.muted = !!m;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.now(), 0.05);
  };

  A.toggleMute = function () { this.setMuted(!this.muted); return this.muted; };

  NP.Audio = A;
})(window.NP);

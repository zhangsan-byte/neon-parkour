/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 30 特效层
 *   · ParticleSystem：GPU 点精灵粒子（火花 / 尘雾两套，各一次 draw call）
 *   · Ribbon：玩家身后的霓虹拖尾缎带（CPU 侧面扩展 + 顶点色渐隐）
 *   · Popups：世界空间飘字（+10 / COMBO）
 * ========================================================================= */
(function (NP) {
  'use strict';

  const M = NP.M;

  /* ====================================================== 粒子系统 */
  const VERT = `
    uniform float uPixelScale;
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vColor = aColor;
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPixelScale / max(0.05, -mv.z);
    }`;
  const FRAG = `
    uniform sampler2D uMap;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec4 t = texture2D(uMap, gl_PointCoord);
      float a = t.a * vAlpha;
      if (a < 0.008) discard;
      gl_FragColor = vec4(vColor, a);
    }`;

  class ParticleSystem {
    constructor(opts) {
      opts = opts || {};
      this.cap = opts.capacity || 900;
      const cap = this.cap;
      this.pos = new Float32Array(cap * 3);
      this.vel = new Float32Array(cap * 3);
      this.col = new Float32Array(cap * 3);
      this.size = new Float32Array(cap);
      this.alpha = new Float32Array(cap);
      this.life = new Float32Array(cap);
      this.maxLife = new Float32Array(cap);
      this.grav = new Float32Array(cap);
      this.drag = new Float32Array(cap);
      this.spin = new Float32Array(cap);       // 大小变化率
      this.cursor = 0;

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, cap);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // 永远不裁剪

      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: opts.texture || NP.tex.dot() },
          uPixelScale: { value: 600.0 }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: opts.blending === undefined ? THREE.NormalBlending : opts.blending,
        fog: false
      });
      this.points = new THREE.Points(g, this.material);
      this.points.frustumCulled = false;
      this.geometry = g;
    }

    /* 发射一粒 */
    emit(o) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const i3 = i * 3;
      this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
      this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
      const c = o.color;
      this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
      this.size[i] = o.size || 0.3;
      this.spin[i] = o.grow === undefined ? 0 : o.grow;
      this.maxLife[i] = this.life[i] = o.life || 0.8;
      this.alpha[i] = o.alpha === undefined ? 1 : o.alpha;
      this.grav[i] = o.gravity === undefined ? 0 : o.gravity;
      this.drag[i] = o.drag === undefined ? 0 : o.drag;
    }

    update(dt) {
      const cap = this.cap, pos = this.pos, vel = this.vel, alpha = this.alpha;
      let any = false;
      for (let i = 0; i < cap; i++) {
        if (this.life[i] <= 0) {
          if (alpha[i] !== 0) { alpha[i] = 0; any = true; }
          continue;
        }
        any = true;
        this.life[i] -= dt;
        const i3 = i * 3;
        const dr = Math.max(0, 1 - this.drag[i] * dt);
        vel[i3] *= dr; vel[i3 + 2] *= dr;
        vel[i3 + 1] = vel[i3 + 1] * dr + this.grav[i] * dt;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        this.size[i] = Math.max(0.001, this.size[i] + this.spin[i] * dt);
        const t = Math.max(0, this.life[i] / this.maxLife[i]);
        alpha[i] = t * t * (3 - 2 * t);          // 平滑淡出
      }
      if (any) {
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.aAlpha.needsUpdate = true;
        this.geometry.attributes.aSize.needsUpdate = true;
        this.geometry.attributes.aColor.needsUpdate = true;
      }
    }

    setPixelScale(v) { this.material.uniforms.uPixelScale.value = v; }
  }

  /* ====================================================== 特效总线 */
  class FX {
    constructor(scene) {
      this.scene = scene;
      this.sparks = new ParticleSystem({ capacity: 1400, texture: NP.tex.glow(), blending: THREE.AdditiveBlending });
      this.puffs = new ParticleSystem({ capacity: 700, texture: NP.tex.puff(), blending: THREE.NormalBlending });
      scene.add(this.sparks.points);
      scene.add(this.puffs.points);
      // 双条侧向拖尾：从喷气背包两侧甩出，避免糊住角色本体
      this.ribbons = [
        new NP.Ribbon(scene, { samples: 46, width: 0.19, offsetX: -0.46, hueBase: 0.50, hueSpan: 0.16 }),
        new NP.Ribbon(scene, { samples: 46, width: 0.19, offsetX: 0.46, hueBase: 0.85, hueSpan: 0.16 })
      ];
      this.popups = new NP.Popups(scene);
      this._c = new THREE.Color();
      this.quality = 1;
    }

    pushTrail(x, y, z) {
      for (const r of this.ribbons) r.push(x + r.offsetX, y, z);
    }
    clearTrail() { for (const r of this.ribbons) r.clear(); }
    setTrailActive(a) { for (const r of this.ribbons) r.setActive(a); }

    setPixelScale(v) {
      this.sparks.setPixelScale(v);
      this.puffs.setPixelScale(v);
    }

    /** 起跑/落地火花 */
    burst(x, y, z, opts) {
      opts = opts || {};
      const n = Math.round((opts.count || 16) * this.quality);
      const colors = opts.colors || [NP.PAL.neon.cyan, NP.PAL.white, NP.PAL.neon.purple];
      const spd = opts.speed || 4.5;
      const sys = opts.additive === false ? this.puffs : this.sparks;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = Math.acos(M.rand(-0.4, 1.0));
        const s = spd * M.rand(0.35, 1.15);
        this._c.setHex(colors[i % colors.length]);
        sys.emit({
          x: x + M.rand(-0.1, 0.1), y: y + M.rand(-0.1, 0.1), z: z + M.rand(-0.1, 0.1),
          vx: Math.sin(e) * Math.cos(a) * s,
          vy: Math.cos(e) * s * M.rand(0.4, 1.0),
          vz: Math.sin(e) * Math.sin(a) * s,
          color: this._c,
          size: (opts.size || 0.3) * M.rand(0.6, 1.4),
          life: (opts.life || 0.7) * M.rand(0.6, 1.3),
          alpha: opts.alpha === undefined ? 0.95 : opts.alpha,
          gravity: opts.gravity === undefined ? -7 : opts.gravity,
          drag: 1.8,
          grow: opts.grow === undefined ? -0.25 : opts.grow
        });
      }
    }

    /** 脚下尘雾（浅色卡通感） */
    dust(x, y, z, count, power) {
      const n = Math.round((count || 10) * this.quality);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = M.rand(1.0, 3.2) * (power || 1);
        this._c.setHex(i % 3 === 0 ? NP.PAL.pastel.lilac : NP.PAL.white);
        this.puffs.emit({
          x, y, z,
          vx: Math.cos(a) * s, vy: M.rand(0.4, 1.8) * (power || 1), vz: Math.sin(a) * s * 0.6,
          color: this._c,
          size: M.rand(0.5, 1.1) * (power || 1),
          life: M.rand(0.4, 0.85),
          alpha: 0.8,
          gravity: 0.4,
          drag: 2.6,
          grow: 1.1
        });
      }
    }

    /** 拾取能量珠 */
    pickup(x, y, z, combo) {
      const cols = [NP.PAL.neon.cyan, NP.PAL.white, NP.PAL.neon.lime, NP.PAL.pastel.aqua];
      const n = Math.round(14 * this.quality);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.acos(M.rand(-0.6, 1));
        const s = M.rand(2.5, 7.5);
        this._c.setHex(cols[i % cols.length]);
        this.sparks.emit({
          x, y, z,
          vx: Math.sin(e) * Math.cos(a) * s, vy: Math.cos(e) * s * 0.8, vz: Math.sin(e) * Math.sin(a) * s,
          color: this._c,
          size: M.rand(0.16, 0.4),
          life: M.rand(0.3, 0.6),
          gravity: -4, drag: 2.2, grow: -0.3
        });
      }
      this.popups.show(x, y + 0.5, z, '+' + (10 * combo), combo >= 4 ? NP.PAL.neon.pink : NP.PAL.neon.cyan);
    }

    /** 撞击 */
    crash(x, y, z) {
      const cols = [NP.PAL.neon.coral, NP.PAL.neon.pink, NP.PAL.white];
      for (let i = 0; i < Math.round(30 * this.quality); i++) {
        const a = Math.random() * Math.PI * 2, e = Math.acos(M.rand(-1, 1));
        const s = M.rand(3, 11);
        this._c.setHex(cols[i % cols.length]);
        this.sparks.emit({
          x, y, z,
          vx: Math.sin(e) * Math.cos(a) * s, vy: Math.abs(Math.cos(e)) * s * 0.9, vz: Math.sin(e) * Math.sin(a) * s,
          color: this._c, size: M.rand(0.18, 0.5),
          life: M.rand(0.4, 0.9), gravity: -9, drag: 1.5, grow: -0.2
        });
      }
      for (let i = 0; i < Math.round(10 * this.quality); i++) {
        const a = Math.random() * Math.PI * 2, s = M.rand(1, 4);
        this._c.setHex(NP.PAL.pastel.peach);
        this.puffs.emit({
          x, y, z, vx: Math.cos(a) * s, vy: M.rand(0.5, 3), vz: Math.sin(a) * s,
          color: this._c, size: M.rand(0.6, 1.4), life: M.rand(0.5, 1.0),
          gravity: -1, drag: 2.2, grow: 0.9, alpha: 0.85
        });
      }
    }

    /** 滑铲尾焰 */
    slideTrail(x, y, z, dir) {
      const n = Math.round(6 * this.quality);
      for (let i = 0; i < n; i++) {
        this._c.setHex(i % 2 ? NP.PAL.neon.cyan : NP.PAL.pastel.aqua);
        this.sparks.emit({
          x: x + M.rand(-0.35, 0.35), y: y + M.rand(-0.25, 0.1), z: z + M.rand(-0.2, 1.4),
          vx: M.rand(-1.2, 1.2), vy: M.rand(0.6, 2.6), vz: dir * M.rand(1.5, 5),
          color: this._c, size: M.rand(0.14, 0.34),
          life: M.rand(0.2, 0.45), gravity: -1, drag: 2.4, grow: -0.4
        });
      }
    }

    /** 喷气背包拖尾（每帧少量） */
    jet(x, y, z, power) {
      if (Math.random() > 0.85) return;
      this._c.setHex(Math.random() < 0.5 ? NP.PAL.neon.cyan : NP.PAL.pastel.aqua);
      this.sparks.emit({
        x: x + M.rand(-0.16, 0.16), y, z,
        vx: M.rand(-0.7, 0.7), vy: M.rand(-0.6, 1.2), vz: M.rand(1.5, 4.5),
        color: this._c, size: M.rand(0.12, 0.3) * (power || 1),
        life: M.rand(0.2, 0.42), gravity: 1.2, drag: 2.0, grow: -0.2
      });
    }

    update(dt) {
      this.sparks.update(dt);
      this.puffs.update(dt);
      for (const r of this.ribbons) r.update(dt);
      this.popups.update(dt);
    }
  }

  /* ====================================================== 拖尾缎带 */
  class Ribbon {
    constructor(scene, opts) {
      this.n = opts.samples || 44;
      this.maxW = opts.width || 0.6;
      this.offsetX = opts.offsetX || 0;
      this.hueBase = opts.hueBase === undefined ? 0.52 : opts.hueBase;
      this.hueSpan = opts.hueSpan === undefined ? 0.42 : opts.hueSpan;
      const n = this.n;
      this.pts = new Float32Array(n * 3);
      this.side = new Float32Array(n * 3);
      this.head = 0;
      this.count = 0;
      this.energy = 0;
      this._last = new THREE.Vector3(1e9, 0, 0);

      const verts = new Float32Array(n * 2 * 3);
      const cols = new Float32Array(n * 2 * 3);
      const alphas = new Float32Array(n * 2);
      const idx = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aColor', new THREE.BufferAttribute(cols, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      this.geometry = g;
      this.verts = verts; this.cols = cols; this.alphas = alphas;

      const mkMat = (alphaScale, colorScale) => new THREE.ShaderMaterial({
        uniforms: {
          uAlpha: { value: 1.0 },
          uAlphaScale: { value: alphaScale },
          uColorScale: { value: colorScale },
          uTint: { value: new THREE.Color(NP.PAL.white) }
        },
        vertexShader: `
          attribute vec3 aColor; attribute float aAlpha;
          varying vec3 vColor; varying float vAlpha;
          void main(){
            vColor = aColor; vAlpha = aAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform float uAlpha; uniform float uAlphaScale; uniform vec3 uTint;
          varying vec3 vColor; varying float vAlpha;
          void main(){
            float a = vAlpha * uAlpha * uAlphaScale;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vColor * uTint, a);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      this.mesh = new THREE.Mesh(g, mkMat(0.9, 1.0));
      this.mesh.frustumCulled = false;
      this.glow = new THREE.Mesh(g, mkMat(0.55, 1.0));
      this.glow.material.blending = THREE.AdditiveBlending;
      this.glow.material.uniforms.uTint.value = new THREE.Color(0xcdeeff);
      this.glow.frustumCulled = false;
      this.glow.scale.set(1.55, 1.55, 1.55);
      scene.add(this.mesh);
      scene.add(this.glow);
      this._c = new THREE.Color();
      this._v = new THREE.Vector3();
    }

    setActive(a) { this.energy = M.clamp(a, 0, 1); }

    clear() {
      this.count = 0; this.head = 0;
      this._last.set(1e9, 0, 0);
    }

    // 每帧推入锚点（角色身后）
    push(x, y, z) {
      const dx = x - this._last.x, dy = y - this._last.y, dz = z - this._last.z;
      if (dx * dx + dy * dy + dz * dz < 0.0256) return false;   // 采样间距 0.16m
      this._last.set(x, y, z);
      this.pts[this.head * 3] = x;
      this.pts[this.head * 3 + 1] = y;
      this.pts[this.head * 3 + 2] = z;
      this.head = (this.head + 1) % this.n;
      this.count = Math.min(this.count + 1, this.n);
      return true;
    }

    update(dt) {
      const n = this.count;
      const uAlpha = this.mesh.material.uniforms.uAlpha;
      uAlpha.value = this.energy;
      this.glow.material.uniforms.uAlpha.value = this.energy;
      if (n < 3 || this.energy <= 0.001) {
        this.geometry.setDrawRange(0, 0);
        return;
      }
      this.geometry.setDrawRange(0, (n - 1) * 6);

      // 归一化到时间顺序：u=0 最旧，u=1 最新
      const p = (k) => (this.head - n + k + this.n * 2) % this.n;
      const t = performance.now() * 0.0006;

      // 先算切线方向 -> 侧面向量（side = normalize(cross(tangent, up))）
      let px = 0, py = 0, pz = 0;
      let lastSx = 1, lastSz = 0;
      for (let k = 0; k < n; k++) {
        const i = p(k), i3 = i * 3;
        const x = this.pts[i3], y = this.pts[i3 + 1], z = this.pts[i3 + 2];
        let tx, ty, tz;
        if (k === 0) { tx = 0; ty = 0; tz = -1; }
        else { tx = x - px; ty = y - py; tz = z - pz; }
        px = x; py = y; pz = z;
        // cross((tx,ty,tz), (0,1,0)) = (-tz, 0, tx)
        let sx = -tz, sz = tx;
        const sl = Math.hypot(sx, sz);
        if (sl < 1e-4) { sx = lastSx; sz = lastSz; }   // 垂直运动时沿用上一段方向
        else { sx /= sl; sz /= sl; lastSx = sx; lastSz = sz; }
        this.side[i3] = sx; this.side[i3 + 1] = 0; this.side[i3 + 2] = sz;
      }

      const vs = this.verts, cs = this.cols, al = this.alphas;
      const cA = this._c;
      for (let k = 0; k < n; k++) {
        const i = p(k), i3 = i * 3;
        const u = k / (n - 1);
        const x = this.pts[i3], y = this.pts[i3 + 1], z = this.pts[i3 + 2];
        const sx = this.side[i3], sz = this.side[i3 + 2];
        const w = this.maxW * (0.12 + 0.88 * Math.pow(u, 0.75)) * (1 - 0.25 * Math.sin(u * Math.PI));
        const v0 = (k * 2) * 3, v1 = (k * 2 + 1) * 3;
        vs[v0] = x - sx * w; vs[v0 + 1] = y; vs[v0 + 2] = z - sz * w;
        vs[v1] = x + sx * w; vs[v1 + 1] = y; vs[v1 + 2] = z + sz * w;

        // 霓虹渐变：单色系流动（青→紫 / 粉→洋红），避免整条彩虹糊成一片
        const hue = (this.hueBase + u * this.hueSpan + t * 0.6) % 1;
        cA.setHSL(hue, 0.95, 0.68);
        cs[v0] = cA.r; cs[v0 + 1] = cA.g; cs[v0 + 2] = cA.b;
        cs[v1] = cA.r; cs[v1 + 1] = cA.g; cs[v1 + 2] = cA.b;

        const a = 0.34 * Math.pow(u, 1.4);
        al[k * 2] = a; al[k * 2 + 1] = a;
      }
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  /* ====================================================== 世界飘字 */
  class Popups {
    constructor(scene) {
      this.scene = scene;
      this.items = [];
      this.texCache = {};
      this.pool = [];
      this.max = 10;
      this.baseScale = 1;      // 由游戏层按画面宽高比调整（竖屏时缩小）
    }

    _texture(text, colorHex) {
      const key = text + '|' + colorHex;
      if (this.texCache[key]) return this.texCache[key];
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 256, 128);
      ctx.font = 'bold 76px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(text, 128, 66);
      ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.fillText(text, 128, 66);
      const t = new THREE.CanvasTexture(c);
      t.needsUpdate = true;
      this.texCache[key] = t;
      return t;
    }

    show(x, y, z, text, colorHex) {
      if (this.items.length >= this.max) return;
      let sp = this.pool.pop();
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._texture(text, colorHex || NP.PAL.neon.cyan),
          transparent: true, depthWrite: false, depthTest: false, fog: false
        }));
        sp.scale.set(1.7 * this.baseScale, 0.85 * this.baseScale, 1);
        this.scene.add(sp);
      } else {
        sp.material.map = this._texture(text, colorHex || NP.PAL.neon.cyan);
        sp.material.opacity = 1;
        sp.visible = true;
      }
      sp.position.set(x, y, z);
      sp.material.opacity = 1;
      this.items.push({ sp, life: 0, max: 0.85 });
    }

    clear() {
      for (const it of this.items) {
        it.sp.visible = false;
        this.pool.push(it.sp);
      }
      this.items.length = 0;
    }

    update(dt) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        it.life += dt;
        const t = it.life / it.max;
        it.sp.position.y += dt * 2.2;
        it.sp.position.z += dt * 1.2;
        const s = (1.7 + t * 0.35) * this.baseScale;
        it.sp.scale.set(s, s * 0.5, 1);
        it.sp.material.opacity = t < 0.15 ? t / 0.15 : 1 - Math.pow((t - 0.15) / 0.85, 1.6);
        if (t >= 1) {
          it.sp.visible = false;
          this.pool.push(it.sp);
          this.items.splice(i, 1);
        }
      }
    }
  }

  NP.ParticleSystem = ParticleSystem;
  NP.Ribbon = Ribbon;
  NP.Popups = Popups;
  NP.FX = FX;
})(window.NP);

/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 50 角色层
 *   · 卡通小机器人（圆润造型 + 描边 + 飘带围巾 + 喷气背包）
 *   · 弧线跑酷物理：自动前进 / 二段跳 / 滑铲 / 土狼时间 / 跳跃缓冲
 *   · AABB 逐轴分离求解 + 台阶宽容，手感偏"宽容型休闲"
 * ========================================================================= */
(function (NP) {
  'use strict';

  const M = NP.M;
  const PAL = NP.PAL;

  /* -------------------------------------------------- 物理参数 */
  const GRAV = 36.0;          // 重力
  const JUMP_V = 13.0;        // 一段跳初速度（跳高 ≈ 2.35m）
  const JUMP2_V = 11.8;       // 二段跳
  const MAX_FALL = 36.0;      // 最大下落速度
  const SPEED_BASE = 13.0;    // 起始前进速度
  const SPEED_MAX = 30.0;     // 冲刺上限
  const SPEED_RISE = 0.30;    // 每秒加速
  const SPEED_HIT = 0.55;     // 撞击后速度衰减
  const COYOTE = 0.13;        // 土狼时间
  const JUMP_BUFFER = 0.14;   // 跳跃缓冲
  const SLIDE_TIME = 0.85;    // 滑铲时长
  const SLIDE_BOOST = 1.16;   // 滑铲加速
  const STAND_H = 1.56;       // 站立碰撞高
  const SLIDE_H = 0.82;       // 滑铲碰撞高
  const HALF_W = 0.42;        // 碰撞半宽
  const STEP_UP = 0.62;       // 台阶宽容
  const FALL_LIMIT = 6.5;     // 相对最后落脚平台的下坠判定

  // 复用临时向量，避免每帧产生垃圾
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  class Player {
    constructor(scene, fx) {
      this.fx = fx;
      this.root = new THREE.Group();
      this.body = new THREE.Group();      // 用于压扁拉伸 / 翻滚 / 倾斜
      this.root.add(this.body);
      scene.add(this.root);

      this.halfW = HALF_W;
      this.height = STAND_H;
      this.slideHeight = SLIDE_H;

      this.pos = new THREE.Vector3(0, 0.9, 0);
      this.vel = new THREE.Vector3();
      this.grounded = false;
      this.slideTimer = 0;
      this.sliding = false;
      this.jumpsLeft = 2;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.invuln = 0;
      this.alive = true;
      this.speed = SPEED_BASE;
      this.floorY = 0;
      this.runPhase = 0;
      this.flip = 0;                 // 二段跳翻滚 0..1，0=未进行
      this.flipActive = false;
      this.squash = 0;               // 压扁量（负=压扁）
      this.squashV = 0;
      this.hurtT = 0;
      this.wind = 0;

      // 事件回调（由游戏层挂载）
      this.onLand = null;
      this.onJump = null;
      this.onDoubleJump = null;
      this.onSlide = null;
      this.onHit = null;
      this.onFall = null;

      this._build();
      this._buildFlash();
    }

    /* -------------------------------------------------- 建模 */
    _build() {
      const matBody = NP.mat.toon(PAL.pastel.mint);
      const matLimb = NP.mat.toon(0x8fe6cf);
      const matHead = NP.mat.toon(PAL.cream);
      const matPack = NP.mat.toon(PAL.pastel.pink);
      const matVisor = new THREE.MeshBasicMaterial({ color: 0x3a3a7a });
      const matGlow = NP.mat.neon(PAL.neon.cyan);
      const matPink = NP.mat.neon(PAL.neon.pink);
      const outline = NP.mat.outline();

      const mkOutline = (geo, sx, sy, sz) => {
        const m = new THREE.Mesh(geo, outline);
        m.scale.set(sx, sy, sz);
        return m;
      };

      // 躯干
      const bodyGeo = NP.geo.roundedBox(0.74, 0.72, 0.62, 0.26);
      this.torso = new THREE.Mesh(bodyGeo, matBody);
      this.torso.position.y = 0.95;
      this.torso.castShadow = true;
      this.body.add(this.torso, (() => { const o = mkOutline(bodyGeo, 1.07, 1.07, 1.07); o.position.y = 0.95; return o; })());

      // 头
      const headGeo = NP.geo.sphere(0.38, 20);
      this.head = new THREE.Mesh(headGeo, matHead);
      this.head.position.set(0, 1.52, -0.02);
      this.head.castShadow = true;
      const headOutline = mkOutline(headGeo, 1.06, 1.06, 1.06);
      headOutline.position.copy(this.head.position);
      this.body.add(this.head, headOutline);

      // 护目镜（深色面罩 + 霓虹光条）
      const visor = new THREE.Mesh(NP.geo.roundedBox(0.58, 0.26, 0.22, 0.1), matVisor);
      visor.position.set(0, 1.54, -0.3);
      this.visorGlow = new THREE.Mesh(NP.geo.roundedBox(0.46, 0.08, 0.06, 0.03), matGlow);
      this.visorGlow.position.set(0, 1.54, -0.41);
      this.body.add(visor, this.visorGlow);

      // 天线
      const ant = new THREE.Mesh(NP.geo.cylinder(0.025, 0.025, 0.34, 6), matLimb);
      ant.position.set(0.18, 1.95, 0.06);
      ant.rotation.z = -0.24;
      this.antBall = new THREE.Mesh(NP.geo.sphere(0.085, 10), matPink);
      this.antBall.position.set(0.26, 2.11, 0.06);
      this.body.add(ant, this.antBall);

      // 手臂
      this.arms = [];
      [-1, 1].forEach((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.42, 1.16, 0);
        const arm = new THREE.Mesh(NP.geo.capsule(0.13, 0.26), matLimb);
        arm.position.y = -0.22;
        arm.castShadow = true;
        const glove = new THREE.Mesh(NP.geo.sphere(0.15, 12), matGlow);
        glove.position.y = -0.44;
        pivot.add(arm, glove);
        this.body.add(pivot);
        this.arms.push(pivot);
      });

      // 腿
      this.legs = [];
      [-1, 1].forEach((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.2, 0.62, 0);
        const leg = new THREE.Mesh(NP.geo.capsule(0.155, 0.2), matLimb);
        leg.position.y = -0.2;
        leg.castShadow = true;
        const shoe = new THREE.Mesh(NP.geo.roundedBox(0.28, 0.16, 0.4, 0.07), matPink);
        shoe.position.set(0, -0.44, -0.06);
        pivot.add(leg, shoe);
        this.body.add(pivot);
        this.legs.push(pivot);
      });

      // 喷气背包
      const packGeo = NP.geo.roundedBox(0.5, 0.56, 0.3, 0.14);
      const pack = new THREE.Mesh(packGeo, matPack);
      pack.position.set(0, 1.0, 0.42);
      pack.castShadow = true;
      this.body.add(pack, (() => { const o = mkOutline(packGeo, 1.08, 1.08, 1.08); o.position.set(0, 1.0, 0.42); return o; })());
      this.nozzles = [];
      [-1, 1].forEach((s) => {
        const n = new THREE.Mesh(NP.geo.cylinder(0.1, 0.13, 0.22, 10), NP.mat.neon(0xdddddd));
        n.position.set(s * 0.15, 0.68, 0.44);
        this.nozzles.push(n);
        this.body.add(n);
        const core = NP.makeHalo(PAL.neon.cyan, 0.9, 0.85);
        core.position.set(s * 0.15, 0.6, 0.46);
        this.body.add(core);
        (this._flames = this._flames || []).push(core);
      });

      // 飘带围巾（滞后跟随链）
      const scarfMat = NP.mat.toon(PAL.neon.pink);
      this.scarf = [];
      this.scarfPts = [];
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.Mesh(NP.geo.roundedBox(0.3 - i * 0.03, 0.1, 0.22, 0.04), scarfMat);
        this.body.add(seg);
        this.scarf.push(seg);
        this.scarfPts.push(new THREE.Vector3(0, 1.42, 0.16));
      }
    }

    // 受伤闪红壳（独立材质，避免影响共享材质）
    _buildFlash() {
      this.flashMat = new THREE.MeshBasicMaterial({
        color: 0xff5470, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const geo = NP.geo.roundedBox(1.0, 2.1, 0.9, 0.34);
      this.flash = new THREE.Mesh(geo, this.flashMat);
      this.flash.position.y = 1.05;
      this.flash.visible = false;
      this.body.add(this.flash);
    }

    /* -------------------------------------------------- 状态重置 */
    reset(world) {
      const sp = (world && world.spawn) || { x: 0, y: 0, z: 2 };
      this.pos.set(sp.x, sp.y + 0.05, sp.z);
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.alive = true;
      this.speed = SPEED_BASE;
      this.jumpsLeft = 2;
      this.slideTimer = 0;
      this.sliding = false;
      this.invuln = 1.0;
      this.floorY = sp.y;
      this.squash = 0; this.squashV = 0;
      this.flip = 0; this.flipActive = false;
      this.hurtT = 0;
      this.height = STAND_H;
      this.body.rotation.set(0, 0, 0);
      this.body.scale.set(1, 1, 1);
      this._resetScarf();
      this._sync();
    }

    setCheckpoint() {
      this.floorY = NP.M.clamp(this.floorY, -999, 999);
    }

    /** 把飘带链重置到身体后方（重生/重开时避免长距离拖拽） */
    _resetScarf() {
      for (let i = 0; i < this.scarfPts.length; i++) {
        this.scarfPts[i].set(this.pos.x, this.pos.y + 1.4 - i * 0.04, this.pos.z + 0.2 + i * 0.21);
      }
    }

    /** 掉落后回到最近的安全落脚点 */
    respawn(world, atPos) {
      const p = atPos || { x: this.pos.x, y: this.floorY, z: this.pos.z };
      this.pos.set(p.x, p.y + 0.1, p.z);
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.invuln = 1.6;
      this.speed = SPEED_BASE;
      this.jumpsLeft = 2;
      this.sliding = false;
      this.slideTimer = 0;
      this.height = STAND_H;
      this.floorY = p.y;
      this._resetScarf();
    }

    get aabb() {
      return {
        minX: this.pos.x - this.halfW, maxX: this.pos.x + this.halfW,
        minY: this.pos.y, maxY: this.pos.y + this.height,
        minZ: this.pos.z - this.halfW, maxZ: this.pos.z + this.halfW
      };
    }

    /* ================================================== 物理更新 */
    update(dt, world, input, t, opts) {
      const frozen = !!(opts && opts.frozen);   // 菜单/结算：原地待机

      // --- 输入：跳跃缓冲 / 长按
      if (!frozen && input.jumpPressed) this.jumpBuffer = JUMP_BUFFER;
      else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.hurtT = Math.max(0, this.hurtT - dt);

      // --- 滑铲
      if (!frozen && input.slideHeld && this.grounded && this.slideTimer <= 0 && !this.sliding && this.speed > SPEED_BASE * 0.75) {
        this.sliding = true;
        this.slideTimer = SLIDE_TIME;
        if (this.onSlide) this.onSlide(this);
      }
      if (this.sliding) {
        this.slideTimer -= dt;
        if (this.slideTimer <= 0 || (!input.slideHeld && !frozen)) this.sliding = false;
      }

      // --- 前进速度（自动跑）
      if (frozen) {
        this.speed = 0;
      } else {
        const targetSpeed = Math.min(SPEED_MAX, SPEED_BASE + (t || 0) * SPEED_RISE);
        this.speed = M.damp(this.speed, targetSpeed * (this.sliding ? SLIDE_BOOST : 1), 1.6, dt);
      }

      // --- 横向控制
      const lateralMax = 7.2 + this.speed * 0.13;
      const wantVX = frozen ? 0 : ((input.right ? 1 : 0) - (input.left ? 1 : 0));
      const targetVX = wantVX * lateralMax;
      const ctrl = this.grounded ? 15 : 8.5;
      this.vel.x = M.damp(this.vel.x, targetVX, ctrl, dt);

      // --- 重力 / 跳跃
      if (this.jumpBuffer > 0) {
        if (this.grounded || this.coyote > 0) {
          this.vel.y = JUMP_V;
          this.grounded = false;
          this.coyote = 0;
          this.jumpBuffer = 0;
          this.jumpsLeft = 1;
          this.squash = 0.3; this.squashV = 0;
          if (this.onJump) this.onJump(this);
        } else if (this.jumpsLeft > 0) {
          this.vel.y = JUMP2_V;
          this.jumpsLeft--;
          this.jumpBuffer = 0;
          this.flip = 0.0001; this.flipActive = true;
          if (this.onDoubleJump) this.onDoubleJump(this);
        }
      }
      // 松手削顶（可变跳跃高度）
      if (!input.jumpHeld && this.vel.y > 4.5) this.vel.y -= 26 * dt;

      this.vel.y = Math.max(-MAX_FALL, this.vel.y - GRAV * dt);

      // --- 位移 + 逐轴碰撞
      const wasGrounded = this.grounded;
      this.grounded = false;

      // Z 轴（前进）
      if (!frozen) this.pos.z -= this.speed * dt;
      this._resolveAxis('z', dt, world);

      // X 轴（横移）
      this.pos.x += this.vel.x * dt;
      this._resolveAxis('x', dt, world);

      // Y 轴
      const vyBefore = this.vel.y;          // 记录落地前的下落速度（用于撞击强度）
      this.pos.y += this.vel.y * dt;
      this._resolveY(dt, world);

      // 地面吸附 & 记录落脚高度（用于坠落判定与复活点）
      this._groundProbe(world, dt);

      // 横向软护栏：防止一路飘出赛道
      const LIMIT = 14.5;
      if (Math.abs(this.pos.x) > LIMIT) {
        this.pos.x = Math.sign(this.pos.x) * LIMIT;
        this.vel.x *= -0.25;
      }

      // --- 落地 / 起跳动画状态
      if (this.grounded && !wasGrounded) {
        const impact = M.clamp(Math.abs(vyBefore) / 16, 0.35, 1.4);
        this.squash = -0.34 * impact;
        this.squashV = 0;
        this.jumpsLeft = 2;
        this.flipActive = false;
        this.flip = 0;
        if (this.onLand) this.onLand(this, impact);
      }
      if (!this.grounded && wasGrounded && this.vel.y < 0) this.coyote = COYOTE;

      // --- 坠落判定
      if (this.pos.y < this.floorY - FALL_LIMIT) {
        if (this.onFall) this.onFall(this);
      }

      // --- 模型动画
      this._animate(dt, t || 0);

      // --- 特效：拖尾 / 喷气 / 滑铲火花
      if (this.fx && !frozen) {
        this.fx.pushTrail(this.pos.x, this.pos.y + 1.06, this.pos.z + 0.34);
        this.fx.jet(this.pos.x, this.pos.y + 0.62, this.pos.z + 0.46, this.sliding ? 1.8 : 1.0);
        if (this.sliding && this.grounded) {
          this.fx.slideTrail(this.pos.x, this.pos.y + 0.06, this.pos.z, 1);
        }
      }
      this.height = this.sliding ? SLIDE_H : STAND_H;
    }

    /* -------------------------------------------------- 碰撞求解 */
    _overlaps(b) {
      const e = 0.02;
      return (this.pos.x + this.halfW) > (b.minX + e) && (this.pos.x - this.halfW) < (b.maxX - e) &&
        (this.pos.z + this.halfW) > (b.minZ + e) && (this.pos.z - this.halfW) < (b.maxZ - e) &&
        (this.pos.y + this.height) > (b.minY + e) && this.pos.y < (b.maxY - e);
    }

    _resolveAxis(axis, dt, world) {
      const boxes = world.nearBoxes(this.pos.x, this.pos.z, 3.2, 1.6);
      const key = axis === 'x' ? 'x' : 'z';
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this._overlaps(b)) continue;
        // 台阶宽容：差一点点就能踩上去
        if (b.maxY - this.pos.y > 0 && b.maxY - this.pos.y <= STEP_UP && this.vel.y <= 0.2) {
          this.pos.y = b.maxY;
          this.vel.y = 0;
          this.grounded = true;
          continue;
        }
        // 推出
        const half = this.halfW;
        if (key === 'x') {
          const pushL = b.minX - half - this.pos.x;   // 往 -x 推
          const pushR = b.maxX + half - this.pos.x;   // 往 +x 推
          this.pos.x += Math.abs(pushL) < Math.abs(pushR) ? pushL : pushR;
          this.vel.x = 0;
        } else {
          const pushF = b.maxZ + half - this.pos.z;   // 往 +z（后方）推
          const pushB = b.minZ - half - this.pos.z;   // 往 -z 推
          this.pos.z += Math.abs(pushF) < Math.abs(pushB) ? pushF : pushB;
        }
        if (b.damage) this._hurt(b);
      }
    }

    _resolveY(dt, world) {
      const boxes = world.nearBoxes(this.pos.x, this.pos.z, 3.2, 1.6);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this._overlaps(b)) continue;
        if (this.vel.y <= 0 && this.pos.y > (b.maxY + b.minY) / 2 - 0.1) {
          // 从上方落下 -> 站立
          this.pos.y = b.maxY;
          this.vel.y = 0;
          this.grounded = true;
          if (b.damage && b.kind !== 'hurdle' && b.kind !== 'block') this._hurt(b);
        } else if (this.vel.y > 0) {
          // 顶头
          this.pos.y = b.minY - this.height - 0.01;
          this.vel.y = -1.0;
        } else {
          // 侧向嵌入 -> 向上抬出
          this.pos.y = b.maxY;
          this.vel.y = 0;
          this.grounded = true;
        }
      }
    }

    _groundProbe(world, dt) {
      if (this.vel.y > 0.4) return;
      const boxes = world.nearBoxes(this.pos.x, this.pos.z, 1.4, 1.0);
      let bestY = -Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if ((this.pos.x + this.halfW) < b.minX || (this.pos.x - this.halfW) > b.maxX) continue;
        if ((this.pos.z + this.halfW) < b.minZ || (this.pos.z - this.halfW) > b.maxZ) continue;
        const gap = this.pos.y - b.maxY;
        if (gap >= -0.02 && gap <= 0.16 && b.maxY > bestY) bestY = b.maxY;
      }
      if (bestY > -Infinity) {
        this.pos.y = bestY;
        this.vel.y = 0;
        this.grounded = true;
      }
      if (this.grounded) this.floorY = M.damp(this.floorY, this.pos.y, 14, dt);
    }

    _hurt(box) {
      if (this.invuln > 0 || !this.alive) return;
      this.hurtT = 0.45;
      if (this.onHit) this.onHit(this, box);
    }

    /* -------------------------------------------------- 动画 */
    _animate(dt, t) {
      const b = this.body;
      const spdN = M.clamp((this.speed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE), 0, 1);
      const airborne = !this.grounded;

      // 跑步循环
      const runSpeed = 8.4 + this.speed * 0.32;
      this.runPhase += dt * runSpeed;
      const ph = this.runPhase;

      // 压扁拉伸弹簧
      const k = 190, c = 15;
      this.squashV += (-k * this.squash - c * this.squashV) * dt;
      this.squash += this.squashV * dt;
      this.squash = M.clamp(this.squash, -0.45, 0.4);

      const sy = 1 + this.squash;
      const sxz = 1 - this.squash * 0.45;
      b.scale.set(sxz, sy, sxz);

      // 前倾 & 侧倾
      const leanTarget = airborne ? (this.vel.y > 0 ? 0.16 : -0.12) : 0.1 + spdN * 0.16;
      b.rotation.x = M.damp(b.rotation.x, leanTarget, 9, dt);
      b.rotation.z = M.damp(b.rotation.z, -this.vel.x * 0.028, 8, dt);
      b.rotation.y = M.damp(b.rotation.y, -this.vel.x * 0.016, 8, dt);

      // 二段跳翻滚
      if (this.flipActive) {
        this.flip += dt / 0.42;
        if (this.flip >= 1) { this.flip = 0; this.flipActive = false; }
        b.rotation.x = -Math.PI * 2 * (1 - Math.pow(1 - M.clamp(this.flip, 0, 1), 2));
      }

      // 受伤抖动
      if (this.hurtT > 0) {
        const w = this.hurtT / 0.45;
        b.rotation.z += Math.sin(this.hurtT * 60) * 0.22 * w;
        this.flash.visible = true;
        this.flashMat.opacity = 0.5 * w;
      } else {
        this.flash.visible = false;
      }

      // 无敌闪烁
      if (this.invuln > 0 && this.hurtT <= 0) {
        const blink = Math.sin(this.invuln * 34) > -0.2;
        this.root.visible = blink;
      } else {
        this.root.visible = true;
      }

      // 肢体
      if (this.sliding) {
        this.legs[0].rotation.x = -1.5; this.legs[1].rotation.x = -1.15;
        this.arms[0].rotation.x = -1.9; this.arms[1].rotation.x = -1.7;
        b.position.y = -0.32;
      } else if (airborne) {
        const up = this.vel.y > 0;
        this.legs[0].rotation.x = M.damp(this.legs[0].rotation.x, up ? -1.15 : -0.35, 12, dt);
        this.legs[1].rotation.x = M.damp(this.legs[1].rotation.x, up ? 0.75 : 0.5, 12, dt);
        this.arms[0].rotation.x = M.damp(this.arms[0].rotation.x, up ? -2.5 : -2.05, 12, dt);
        this.arms[1].rotation.x = M.damp(this.arms[1].rotation.x, up ? -2.3 : -1.85, 12, dt);
        b.position.y = M.damp(b.position.y, 0, 12, dt);
      } else if (this.speed < 0.6) {
        // 待机（菜单/结算）：轻轻呼吸
        const br = Math.sin(t * 1.7);
        for (const l of this.legs) l.rotation.x = M.damp(l.rotation.x, 0, 8, dt);
        for (const a of this.arms) a.rotation.x = M.damp(a.rotation.x, -0.1 + br * 0.05, 8, dt);
        this.arms[0].rotation.z = M.damp(this.arms[0].rotation.z, 0.2, 8, dt);
        this.arms[1].rotation.z = M.damp(this.arms[1].rotation.z, -0.2, 8, dt);
        b.position.y = M.damp(b.position.y, br * 0.04, 8, dt);
        this.runPhase += dt * 1.2;
      } else {
        const sw = Math.sin(ph), sw2 = Math.cos(ph);
        this.legs[0].rotation.x = sw * (0.85 + spdN * 0.35);
        this.legs[1].rotation.x = -sw * (0.85 + spdN * 0.35);
        this.arms[0].rotation.x = -sw * (0.75 + spdN * 0.3) - 0.15;
        this.arms[1].rotation.x = sw * (0.75 + spdN * 0.3) - 0.15;
        this.arms[0].rotation.z = 0.16 + sw2 * 0.06;
        this.arms[1].rotation.z = -0.16 - sw2 * 0.06;
        b.position.y = Math.abs(Math.sin(ph)) * 0.07 - 0.02 + Math.sin(t * 2.4) * 0.012;
      }
      this.torso.rotation.y = Math.sin(ph) * 0.09;
      this.head.rotation.y = Math.sin(ph + 1) * 0.06;
      this.antBall.scale.setScalar(1 + Math.sin(t * 4 + 1) * 0.08);

      // 喷气口火焰闪烁
      const flame = this.grounded ? 0.55 : 1.15;
      this.wind = M.damp(this.wind || 0, flame, 8, dt);
      if (this._flames) {
        for (const f of this._flames) {
          const s = (0.55 + Math.random() * 0.32) * this.wind;
          f.scale.set(s * 1.1, s, 1);
          f.material.opacity = 0.5 + Math.random() * 0.35;
        }
      }

      // 飘带：定长滞后链（每段保持固定间距，像真飘带一样弯在身后）
      this.body.localToWorld(_v1.set(0, 1.42, 0.18));
      this.scarfPts[0].lerp(_v1, 1 - Math.exp(-18 * dt));
      const SEG = 0.21;
      for (let i = 1; i < this.scarfPts.length; i++) {
        const prev = this.scarfPts[i - 1];
        const cur = this.scarfPts[i];
        _v2.copy(cur).sub(prev);
        const len = _v2.length() || 1e-4;
        _v2.multiplyScalar(SEG / len).add(prev);      // 目标点：沿当前方向保持定长
        _v2.y -= 0.012;                               // 略微下垂
        cur.lerp(_v2, 1 - Math.exp(-24 * dt));
      }
      for (let i = 0; i < this.scarf.length; i++) {
        const seg = this.scarf[i];
        _v1.copy(this.scarfPts[i]);
        this.body.worldToLocal(_v1);
        seg.position.copy(_v1);
        seg.rotation.x = -0.38 - i * 0.05 + Math.sin(t * 9 - i * 0.7) * 0.13;
        seg.rotation.z = Math.sin(t * 6.5 - i * 0.9) * 0.17;
      }
    }

    /* -------------------------------------------------- 同步渲染位置 */
    _sync() {
      this.root.position.copy(this.pos);
      this.body.position.set(0, 0, 0);
    }

    tickRender() {
      this.root.position.copy(this.pos);
    }
  }

  Player.SPEED_BASE = SPEED_BASE;
  Player.SPEED_MAX = SPEED_MAX;
  Player.STAND_H = STAND_H;
  Player.SLIDE_H = SLIDE_H;
  NP.Player = Player;
})(window.NP);

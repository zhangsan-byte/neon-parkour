/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 40 世界层
 *   · Sky：渐变天空穹顶 + 粉彩太阳 + 环形星球
 *   · World：程序化赛道（浮空糖果平台 / 障碍 / 能量珠）+ 背景霓虹城市 + 云海
 * 前进方向 = -Z；玩家起点 z=0，地面高度 y=0
 * ========================================================================= */
(function (NP) {
  'use strict';

  const M = NP.M;
  const PAL = NP.PAL;

  const PLAT_THICK = 2.8;      // 平台厚度
  const REACH_GAP = 7.6;       // 最大间隙（保证基础速度也能跳过）
  const REACH_UP = 1.9;        // 最大抬升
  const REACH_SIDE = 4.0;      // 最大横向偏移

  // 糖果配色对（平台主体 / 霓虹边条）
  const TRACK_COLORS = [
    { body: PAL.pastel.mint, rim: PAL.neon.cyan },
    { body: PAL.pastel.lilac, rim: PAL.neon.purple },
    { body: PAL.pastel.pink, rim: PAL.neon.pink },
    { body: PAL.pastel.sky, rim: PAL.neon.cyan },
    { body: PAL.pastel.lemon, rim: PAL.neon.yellow },
    { body: PAL.pastel.aqua, rim: PAL.neon.purple }
  ];

  const FACADES = [
    { base: 0xb9d4f5, lit: 0xf6fbff, neon: [PAL.neon.cyan, PAL.neon.pink] },
    { base: 0xcbc0f2, lit: 0xf8f4ff, neon: [PAL.neon.purple, PAL.neon.cyan] },
    { base: 0xf7bfdc, lit: 0xfff2f8, neon: [PAL.neon.pink, PAL.neon.yellow] },
    { base: 0xa9e8d6, lit: 0xeafff8, neon: [PAL.neon.lime, PAL.neon.cyan] }
  ];

  /* ========================================================= 建筑几何 */
  const bldCache = {};
  function buildingGeo(w, h, d, tile) {
    const key = `${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}|${tile}`;
    if (bldCache[key]) return bldCache[key];
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const rx = Math.max(1, Math.round(w / tile));
    const ry = Math.max(1, Math.round(h / tile));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
    uv.needsUpdate = true;
    g.computeVertexNormals();
    bldCache[key] = g;
    return g;
  }
  const facadeMatCache = {};
  function facadeMat(fi) {
    if (facadeMatCache[fi]) return facadeMatCache[fi];
    const f = FACADES[fi % FACADES.length];
    const tex = NP.tex.windows(f.base, f.lit, f.neon, 2, 2);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, map: tex, gradientMap: NP.tex.toonGradient(4) });
    facadeMatCache[fi] = m;
    return m;
  }

  /* ========================================================= 天空 */
  class Sky {
    constructor(scene) {
      this.group = new THREE.Group();
      const geo = new THREE.SphereGeometry(760, 32, 20);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(PAL.skyTop) },
          uBottom: { value: new THREE.Color(PAL.skyBottom) },
          uMid: { value: new THREE.Color(0xfff0f6) }
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uMid;
          varying vec3 vP;
          void main(){
            float h = normalize(vP).y;
            vec3 c = mix(uBottom, uMid, smoothstep(-0.25, 0.28, h));
            c = mix(c, uTop, smoothstep(0.12, 0.85, h));
            gl_FragColor = vec4(c, 1.0);
          }`
      });
      this.dome = new THREE.Mesh(geo, mat);
      this.dome.frustumCulled = false;
      this.group.add(this.dome);

      // 粉彩太阳 + 光晕（偏置到侧上方，避免糊住赛道）
      this.sun = new THREE.Group();
      const disc = new THREE.Mesh(NP.geo.sphere(1, 20), NP.mat.neon(0xfff2c4));
      disc.scale.setScalar(20);
      const halo = NP.makeHalo(0xffe6a8, 130, 0.34);
      const halo2 = NP.makeHalo(0xffd1e8, 210, 0.16);
      this.sun.add(disc, halo, halo2);
      this.group.add(this.sun);

      // 远处的环形星球
      this.planets = [];
      for (let i = 0; i < 2; i++) {
        const g = new THREE.Group();
        const ball = new THREE.Mesh(NP.geo.sphere(1, 18), NP.mat.neon(i ? 0xffd9ef : 0xd9e8ff, 0.92));
        ball.scale.setScalar(30 + i * 16);
        const ring = new THREE.Mesh(NP.geo.torus(1, 0.055, 40), NP.mat.neon(i ? PAL.neon.pink : PAL.neon.purple, 0.75));
        ring.scale.setScalar(52 + i * 24);
        ring.rotation.set(1.15, 0.4, 0.2);
        g.add(ball, ring);
        this.group.add(g);
        this.planets.push(g);
      }
      scene.add(this.group);
      this._t = 0;
    }

    update(dt, camPos) {
      this._t += dt;
      this.group.position.set(camPos.x, 0, camPos.z);
      this.sun.position.set(-150, 165, -520);
      this.sun.rotation.z = this._t * 0.02;
      this.planets[0].position.set(430, 120, -560);
      this.planets[1].position.set(-460, 210, -600);
      this.planets[0].rotation.y = 0.5 + this._t * 0.05;
      this.planets[1].rotation.y = 1.1 - this._t * 0.04;
    }
  }

  /* ========================================================= 云海（跟随玩家的低空云层） */
  class CloudSea {
    constructor(scene) {
      this.group = new THREE.Group();
      const mat = NP.mat.toon(0xffffff);
      const matPink = NP.mat.toon(0xfff0f6);
      for (let i = 0; i < 16; i++) {
        const cl = new THREE.Group();
        const n = M.randInt(3, 5);
        for (let k = 0; k < n; k++) {
          const s = M.rand(2.4, 5.6);
          const b = new THREE.Mesh(NP.geo.sphere(1, 12), Math.random() < 0.35 ? matPink : mat);
          b.scale.set(s * M.rand(1.0, 1.6), s * 0.62, s * M.rand(0.9, 1.4));
          b.position.set(M.rand(-6, 6), M.rand(-0.5, 0.5), M.rand(-4, 4));
          cl.add(b);
        }
        cl.position.set(M.rand(-90, 90), -11 + M.rand(-2.5, 2.5), -M.rand(0, 260));
        cl.userData.speed = M.rand(0.4, 1.2);
        this.group.add(cl);
      }
      scene.add(this.group);
    }
    update(dt, playerZ) {
      // 云层缓慢向后流动，营造速度感
      for (const cl of this.group.children) {
        cl.position.z += cl.userData.speed * dt * 6;
        if (cl.position.z > playerZ + 60) {
          cl.position.z = playerZ - M.rand(180, 300);
          cl.position.x = M.rand(-90, 90);
        }
      }
    }
  }

  /* ========================================================= 主世界 */
  class World {
    constructor(scene, fx) {
      this.scene = scene;
      this.fx = fx;
      this.root = new THREE.Group();
      scene.add(this.root);
      this.sky = new Sky(scene);
      this.cloudSea = new CloudSea(scene);
      this.units = [];
      this.boxes = [];
      this.orbs = [];
      this._t = 0;
      this.orbMat = {
        core: NP.mat.neon(PAL.neon.cyan),
        coreHot: NP.mat.neon(0xffffff),
        halo: new THREE.SpriteMaterial({
          map: NP.tex.glow(), color: PAL.neon.cyan, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false
        })
      };
      this.halosOn = true;
      this.reset();
    }

    /* -------------------------------------------------- 重置 */
    reset() {
      for (const u of this.units) this._disposeUnit(u);
      this.units.length = 0;
      this.boxes.length = 0;
      this.orbs.length = 0;
      this.curX = 0;
      this.curTopY = 0;
      this.frontier = 34;        // 首个平台近边 z
      this.unitCount = 0;
      this.startZ = 0;
      this.makeStart();
      while (this.frontier > -180) this.makeUnit();
    }

    _disposeUnit(u) {
      // 只做解挂：几何与材质都是全局缓存共享，不需要 dispose
      // （注意：不要在 traverse 回调里删除子节点，会让 three 递归到 undefined）
      this.root.remove(u.group);
    }

    /* -------------------------------------------------- 难度曲线 */
    // d：赛道形态难度（缝隙变宽、平台变窄），约 44 段后满级
    get difficulty() { return M.clamp(this.unitCount / 44, 0, 1); }
    // pressure：障碍密度（上得更快一些，约 16 段后达到每段 3 个障碍）
    get pressure() { return M.clamp((this.unitCount - 2) / 14, 0, 1); }

    /* -------------------------------------------------- 构建：起点跑道 */
    makeStart() {
      const u = this._newUnit();
      const zNear = this.frontier;
      const d = 54;
      const p = this.addPlatform(u, { xc: 0, topY: 0, w: 13, d: d, zNear, colorIdx: 0 });
      // 起点霓虹拱门
      this.addGate(u, 0, 0, zNear - 3, PAL.neon.cyan, 6.2, 13);
      this.addGate(u, 0, 0, zNear - 34, PAL.neon.pink, 5.6, 13);
      // 起点角落灯柱
      [-1, 1].forEach((s) => {
        const post = new THREE.Mesh(NP.geo.roundedBox(0.3, 3.2, 0.3, 0.1), NP.mat.neon(PAL.neon.cyan));
        post.position.set(s * 6.1, 1.6, zNear - 1.5);
        u.group.add(post);
      });
      for (let i = 0; i < 3; i++) {
        this.addOrb(u, 0, 1.35, zNear - 12 - i * 4);
      }
      u.zFar = zNear - d;
      this.frontier = u.zFar;
      this.curX = 0; this.curTopY = 0;
      this.spawn = { x: 0, y: 0, z: 2 };      // 出生点固定在起点跑道上
      this.unitCount++;
    }

    _newUnit() {
      const u = { group: new THREE.Group(), boxes: [], orbs: [], zFar: 0, zNear: 0 };
      this.root.add(u.group);
      this.units.push(u);
      return u;
    }

    /* -------------------------------------------------- 构建：单个赛道段 */
    makeUnit() {
      const u = this._newUnit();
      const d = this.difficulty;
      const zNear = this.frontier;
      u.zNear = zNear;
      const pat = this._pickPattern(d);
      const ctx = { u, zNear: zNear, x: this.curX, topY: this.curTopY, d: d, pr: this.pressure };
      this._patterns[pat](ctx);
      this.frontier = ctx.zNear;
      this.curX = ctx.x;
      this.curTopY = ctx.topY;
      u.zFar = ctx.zNear;
      this.unitCount++;

      // 背景装饰（城市 / 云 / 霓虹环）
      this._decorate(u, u.zNear, u.zFar, ctx.topY);
      return u;
    }

    _pickPattern(d) {
      const list = ['run', 'run', 'gap', 'stairs', 'islands', 'slalom', 'narrow', 'split'];
      if (d < 0.08) return 'run';
      // 早期只出基础样式，逐渐解锁
      const pool = ['run', 'gap', 'run', 'gap', 'stairs'];
      if (d > 0.2) pool.push('islands', 'slalom');
      if (d > 0.35) pool.push('narrow', 'split');
      return M.pick(pool);
    }

    /* 平台：返回平台信息；xc 中心、topY 顶面高度、w 宽、d 进深、zNear 近边 */
    addPlatform(u, o) {
      const w = o.w, d = o.d, topY = o.topY, xc = o.xc;
      const zc = o.zNear - d / 2;
      const col = TRACK_COLORS[(o.colorIdx === undefined ? M.randInt(0, TRACK_COLORS.length - 1) : o.colorIdx) % TRACK_COLORS.length];
      const g = new THREE.Group();
      g.position.set(xc, 0, zc);

      const body = new THREE.Mesh(NP.geo.roundedBox(w, PLAT_THICK, d, Math.min(0.75, w * 0.16)), NP.mat.toon(col.body));
      body.position.y = topY - PLAT_THICK / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      // 霓虹边框：比台面宽出一圈、顶面略低于台面，
      // 俯视时是环绕糖果台面的发光描边，侧视时是平台边缘的灯带。
      const rim = new THREE.Mesh(
        NP.geo.roundedBox(w + 0.62, 0.2, d + 0.62, Math.min(0.8, w * 0.15)),
        NP.mat.neon(col.rim)
      );
      rim.position.y = topY - 0.12;
      g.add(rim);

      u.group.add(g);
      const box = {
        minX: xc - w / 2, maxX: xc + w / 2,
        minY: topY - PLAT_THICK, maxY: topY,
        minZ: zc - d / 2, maxZ: zc + d / 2,
        topY: topY, kind: 'platform', solid: true
      };
      u.boxes.push(box);
      this.boxes.push(box);
      return { xc: xc, topY: topY, w: w, d: d, zNear: o.zNear, zFar: o.zNear - d, group: g, colorIdx: o.colorIdx };
    }

    /* 障碍：跨栏（需跳） */
    addHurdle(u, x, topY, z, w, h) {
      w = w || 2.2; h = h || 0.85;
      const g = new THREE.Group();
      g.position.set(x, topY, z);
      const body = new THREE.Mesh(NP.geo.roundedBox(w, h, 0.6, 0.16), NP.mat.toon(PAL.pastel.coral));
      body.position.y = h / 2;
      body.castShadow = true;
      g.add(body);
      const band = new THREE.Mesh(NP.geo.roundedBox(w + 0.1, 0.16, 0.72, 0.06), NP.mat.neon(PAL.neon.pink));
      band.position.y = h - 0.06;
      g.add(band);
      u.group.add(g);
      const bx = { minX: x - w / 2, maxX: x + w / 2, minY: topY, maxY: topY + h, minZ: z - 0.3, maxZ: z + 0.3, topY: topY + h, kind: 'hurdle', solid: true, damage: true };
      u.boxes.push(bx); this.boxes.push(bx);
    }

    /* 障碍：限高横杆（需滑铲） */
    addBar(u, x, topY, z, w) {
      w = w || 9;
      const barY = topY + 1.12;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const bar = new THREE.Mesh(NP.geo.roundedBox(w, 0.4, 0.5, 0.16), NP.mat.neon(PAL.neon.cyan));
      bar.position.y = barY + 0.2;
      g.add(bar);
      const glow = NP.makeGlowQuad(PAL.neon.cyan, w * 1.05, 2.4, 0.32);
      glow.position.set(0, barY + 0.2, 0.35);
      g.add(glow);
      [-1, 1].forEach((s) => {
        const post = new THREE.Mesh(NP.geo.roundedBox(0.28, 2.4, 0.28, 0.1), NP.mat.toon(PAL.pastel.lilac));
        post.position.set(s * (w / 2 + 0.35), topY + 1.2, 0);
        post.castShadow = true;
        g.add(post);
        const tip = new THREE.Mesh(NP.geo.sphere(0.16, 10), NP.mat.neon(PAL.neon.pink));
        tip.position.set(s * (w / 2 + 0.35), topY + 2.5, 0);
        g.add(tip);
      });
      u.group.add(g);
      const bx = { minX: x - w / 2, maxX: x + w / 2, minY: barY, maxY: barY + 0.4, minZ: z - 0.25, maxZ: z + 0.25, topY: barY + 0.4, kind: 'bar', solid: true, damage: true };
      u.boxes.push(bx); this.boxes.push(bx);
    }

    /* 障碍：立方墩（侧向绕行或跳过） */
    addBlock(u, x, topY, z, size) {
      size = size || 1.9;
      const g = new THREE.Group();
      g.position.set(x, topY, z);
      const body = new THREE.Mesh(NP.geo.roundedBox(size, size * 1.1, size, 0.22), NP.mat.toon(PAL.pastel.peach));
      body.position.y = size * 0.55;
      body.castShadow = true;
      g.add(body);
      const band = new THREE.Mesh(NP.geo.roundedBox(size + 0.12, 0.18, size + 0.12, 0.08), NP.mat.neon(PAL.neon.coral));
      band.position.y = size * 1.05;
      g.add(band);
      u.group.add(g);
      const bx = { minX: x - size / 2, maxX: x + size / 2, minY: topY, maxY: topY + size * 1.1, minZ: z - size / 2, maxZ: z + size / 2, topY: topY + size * 1.1, kind: 'block', solid: true, damage: true };
      u.boxes.push(bx); this.boxes.push(bx);
    }

    /* 障碍：旋转霓虹棱锥（空中巡游） */
    addSpinner(u, x, topY, z, r) {
      r = r || 1.05;
      const g = new THREE.Group();
      g.position.set(x, topY + 1.55, z);
      const core = new THREE.Mesh(NP.geo.octa(r), NP.mat.neon(PAL.neon.purple));
      g.add(core);
      const halo = NP.makeHalo(PAL.neon.purple, r * 6, 0.5);
      g.add(halo);
      const pole = new THREE.Mesh(NP.geo.cylinder(0.08, 0.08, 3.0, 8), NP.mat.neon(PAL.neon.purple, 0.7));
      pole.position.y = -1.9;
      g.add(pole);
      u.group.add(g);
      u.spinners = u.spinners || [];
      u.spinners.push({ obj: g, core: core, baseY: topY + 1.55, phase: Math.random() * 6.28, r: r });
      const bx = { minX: x - r * 0.8, maxX: x + r * 0.8, minY: topY + 1.55 - r * 0.8, maxY: topY + 1.55 + r * 0.8, minZ: z - r * 0.8, maxZ: z + r * 0.8, topY: topY + 1.55 + r * 0.8, kind: 'spinner', solid: true, damage: true, follow: g };
      u.boxes.push(bx); this.boxes.push(bx);
    }

    /* 能量珠 */
    addOrb(u, x, y, z) {
      const mesh = new THREE.Mesh(NP.geo.icosa(0.3, 0), NP.mat.neon(PAL.neon.cyan));
      mesh.position.set(x, y, z);
      const halo = new THREE.Sprite(this.orbMat.halo);
      halo.scale.set(1.9, 1.9, 1);
      halo.position.copy(mesh.position);
      halo.visible = this.halosOn;
      u.group.add(mesh);
      u.group.add(halo);
      const orb = { mesh: mesh, halo: halo, x: x, y0: y, z: z, phase: Math.random() * 6.28, taken: false, unit: u };
      u.orbs.push(orb);
      this.orbs.push(orb);
      return orb;
    }

    /* 霓虹拱门 */
    addGate(u, x, topY, z, color, height, span) {
      span = span || 12;
      const g = new THREE.Group();
      g.position.set(x, topY, z);
      height = height || 6;
      const postGeo = NP.geo.roundedBox(0.34, height, 0.34, 0.12);
      [-1, 1].forEach((s) => {
        const p = new THREE.Mesh(postGeo, NP.mat.neon(color));
        p.position.set(s * span / 2, height / 2, 0);
        g.add(p);
      });
      const beam = new THREE.Mesh(NP.geo.roundedBox(span + 0.34, 0.4, 0.4, 0.14), NP.mat.neon(color));
      beam.position.y = height;
      g.add(beam);
      const sign = NP.makeGlowQuad(color, span * 0.55, 2.6, 0.5);
      sign.position.set(0, height - 1.5, 0.1);
      g.add(sign);
      u.group.add(g);
      return g;
    }

    /* 平台上的障碍与奖励布置 */
    _dress(u, plat, d, opts) {
      opts = opts || {};
      const usableW = plat.w - 1.6;
      const len = plat.d;
      // 开局前两段不放障碍，给玩家熟悉操作的空间
      const warmup = this.unitCount <= 2;
      const maxObs = warmup ? 0 : (opts.maxObs === undefined
        ? Math.min(3, Math.round(this.pressure * 3))
        : opts.maxObs);
      const obsCount = len < 10 ? Math.min(1, maxObs) : maxObs;
      const placed = [];
      for (let i = 0; i < obsCount; i++) {
        const t = (i + 0.55) / (obsCount + 0.1);
        const z = plat.zNear - len * t;
        if (placed.length && Math.abs(placed[placed.length - 1] - z) < 9) continue;   // 反应距离
        placed.push(z);
        if (Math.random() < 0.34 && usableW > 6.5) this.addBar(u, plat.xc, plat.topY, z, Math.min(usableW, 10));
        else if (Math.random() < 0.45 && usableW > 5.5) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const off = (usableW / 2 - 1.4) * side;
          this.addBlock(u, plat.xc + off, plat.topY, z, M.rand(1.6, 2.1));
        } else {
          this.addHurdle(u, plat.xc, plat.topY, z, Math.min(usableW, M.rand(2.4, 4.2)), M.rand(0.7, 1.05));
        }
        // 障碍上方/前方放奖励珠，提示路线
        for (let k = 0; k < 3; k++) this.addOrb(u, plat.xc + M.rand(-0.4, 0.4), plat.topY + 1.75 + Math.sin(k) * 0.25, z - 1.4 + k * 1.4);
      }
      if (!obsCount) {
        // 空平台也给点奖励，引导走中间
        const n = Math.max(2, Math.round(len / 7));
        for (let k = 0; k < n; k++) this.addOrb(u, plat.xc, plat.topY + 1.15, plat.zNear - 3 - k * (len - 6) / Math.max(1, n - 1));
      }
      // 旋转棱锥属于「高压」机关，靠后解锁
      if (this.pressure > 0.6 && Math.random() < 0.3) {
        this.addSpinner(u, plat.xc + M.rand(-usableW / 3, usableW / 3), plat.topY, plat.zNear - len * M.rand(0.3, 0.5), 1.0);
      }
    }

    /* -------------------------------------------------- 各类赛道样式 */
    get _patterns() {
      if (this.__patterns) return this.__patterns;
      const self = this;
      const canGoX = (from, to) => M.clamp(to, Math.max(-6, from - REACH_SIDE), Math.min(6, from + REACH_SIDE));
      const canGoY = (from, to) => M.clamp(to, from - 6, from + REACH_UP);

      this.__patterns = {
        // 长直平台
        run(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          // 开局前两段不留缝：让玩家先熟悉奔跑，再面对跳跃
          const gap = self.unitCount <= 2 ? 0 : Math.min(REACH_GAP * 0.5, M.rand(1.5, 3.6));
          const w = M.rand(9, 12) - d * 1.6;
          const len = M.rand(18, 30) - d * 5;
          const xc = canGoX(ctx.x, ctx.x + M.rand(-1.2, 1.2));
          const topY = ctx.topY + M.rand(-0.6, 0.6);
          const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
          self._dress(u, p, d, { maxObs: Math.min(3, Math.floor(d * 3) + 1) });
          ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
        },

        // 跳跃间隙
        gap(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const gap = M.rand(3.6, 4.6 + d * 2.6);
          const w = M.rand(9, 12) - d * 2;
          const len = M.rand(11, 17);
          const xc = canGoX(ctx.x, ctx.x + M.rand(-2.5, 2.5));
          const topY = canGoY(ctx.topY, ctx.topY + M.rand(-1.2, 0.5));
          const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
          // 间隙上方的抛物线奖励珠
          const n = 3;
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const z = ctx.zNear - gap * t;
            const y = M.lerp(ctx.topY, topY, t) + 1.3 + Math.sin(t * Math.PI) * 1.1;
            const x = M.lerp(ctx.x, xc, t);
            self.addOrb(u, x, y, z);
          }
          if (Math.random() < 0.5) self._dress(u, p, d, { maxObs: Math.min(2, Math.floor(d * 2) + 1) });
          else for (let k = 0; k < 2; k++) self.addOrb(u, xc, topY + 1.15, p.zNear - len * (0.3 + k * 0.35));
          ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
        },

        // 阶梯（上升或下降）
        stairs(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const up = Math.random() < 0.62 || ctx.topY < -2;
          const steps = M.randInt(2, 3);
          for (let i = 0; i < steps; i++) {
            const gap = M.rand(2.4, 4.2);
            const dy = (up ? 1 : -1) * M.rand(1.0, Math.min(REACH_UP - 0.2, 1.6));
            const w = M.rand(7, 10) - d * 1.5;
            const len = M.rand(7, 10);
            const xc = canGoX(ctx.x, ctx.x + M.rand(-2, 2));
            const topY = up ? M.min(ctx.topY + dy, 16) : canGoY(ctx.topY, ctx.topY + dy);
            const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
            self.addOrb(u, xc, topY + 1.2, p.zNear - len * 0.5);
            if (pr > 0.2 && Math.random() < 0.45) self.addHurdle(u, xc, topY, p.zNear - len * 0.7, M.rand(2.4, 3.6), 0.8);
            ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
          }
        },

        // 浮空小岛
        islands(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const n = M.randInt(3, 4);
          for (let i = 0; i < n; i++) {
            const gap = M.rand(3.4, 4.4 + d * 2.2);
            const w = M.rand(5.2, 7.6);
            const len = M.rand(5, 7);
            const xc = canGoX(ctx.x, ctx.x + M.rand(-3.2, 3.2));
            const topY = canGoY(ctx.topY, ctx.topY + M.rand(-1.6, 1.2));
            const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
            self.addOrb(u, xc, topY + 1.2, p.zNear - len * 0.5);
            if (i === 1 && pr > 0.3 && Math.random() < 0.5) self.addHurdle(u, xc, topY, p.zNear - len * 0.6, M.rand(2, 3), 0.8);
            ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
          }
        },

        // 窄梁
        narrow(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const gap = M.rand(2.6, 4.2);
          const w = M.rand(3.8, 5.2);
          const len = M.rand(18, 26);
          const xc = canGoX(ctx.x, ctx.x + M.rand(-2.2, 2.2));
          const topY = canGoY(ctx.topY, ctx.topY + M.rand(-1.0, 1.0));
          const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
          const n = Math.floor(len / 4);
          for (let k = 0; k < n; k++) self.addOrb(u, xc, topY + 1.15, p.zNear - 3 - k * 4);
          if (pr > 0.4 && Math.random() < 0.55) self.addHurdle(u, xc, topY, p.zNear - len * 0.6, w * 0.8, 0.8);
          ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
        },

        // 左右绕行（Z 字）
        slalom(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const n = M.randInt(3, 4);
          let dir = Math.random() < 0.5 ? -1 : 1;
          for (let i = 0; i < n; i++) {
            const gap = M.rand(3.2, 4.6);
            const w = M.rand(6, 8.4);
            const len = M.rand(6, 9);
            const xc = canGoX(ctx.x, ctx.x + dir * M.rand(2.4, 3.8));
            const topY = canGoY(ctx.topY, ctx.topY + M.rand(-1.2, 1.0));
            const p = self.addPlatform(u, { xc: xc, topY: topY, w: w, d: len, zNear: ctx.zNear - gap });
            self.addOrb(u, xc, topY + 1.2, p.zNear - len * 0.5);
            if (i > 0 && Math.random() < 0.5) self.addBlock(u, xc - dir * (w / 2 - 1.2), topY, p.zNear - len * 0.6, 1.7);
            ctx.zNear = p.zFar; ctx.x = xc; ctx.topY = topY;
            dir *= -1;
          }
        },

        // 双道分流
        split(ctx) {
          const d = ctx.d, pr = ctx.pr, u = ctx.u;
          const gap = M.rand(3.0, 4.4);
          const len = M.rand(14, 20);
          const half = M.rand(2.6, 3.4);
          const off = M.rand(4.2, 5.2);
          const topY = canGoY(ctx.topY, ctx.topY + M.rand(-0.8, 0.8));
          const xc = ctx.x;
          [1, -1].forEach((s) => {
            const lane = xc + s * off;
            const p = self.addPlatform(u, { xc: lane, topY: topY, w: half * 2, d: len, zNear: ctx.zNear - gap });
            for (let k = 0; k < 3; k++) self.addOrb(u, lane, topY + 1.15, p.zNear - 3 - k * 4);
            if (pr > 0.35 && Math.random() < 0.65) {
              self.addHurdle(u, lane, topY, p.zNear - len * M.rand(0.4, 0.7), Math.min(2.2, half * 1.6), 0.8);
            }
          });
          // 中间的缝隙上用珠子引导
          for (let k = 0; k < 2; k++) self.addOrb(u, xc, topY + 2.2, ctx.zNear - gap - len * (0.35 + k * 0.3));
          ctx.zNear = ctx.zNear - gap - len; ctx.x = xc; ctx.topY = topY;
        }
      };
      return this.__patterns;
    }

    /* -------------------------------------------------- 背景装饰 */
    _decorate(u, zNear, zFar, topY) {
      const len = Math.abs(zNear - zFar) + 20;
      // 远景城市
      const nB = M.randInt(2, 4);
      for (let i = 0; i < nB; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const w = M.rand(4.5, 9), dd = M.rand(4.5, 9), h = M.rand(12, 36);
        const x = side * M.rand(17, 46);
        const z = zNear + M.rand(-len, 0);
        const b = new THREE.Mesh(buildingGeo(w, h, dd, 3.4), facadeMat(M.randInt(0, FACADES.length - 1)));
        b.position.set(x, topY - 14 + h / 2, z);
        b.rotation.y = M.rand(-0.25, 0.25);
        u.group.add(b);
        // 楼层霓虹竖条
        if (Math.random() < 0.65) {
          const col = M.pick([PAL.neon.cyan, PAL.neon.pink, PAL.neon.purple, PAL.neon.lime]);
          const strip = new THREE.Mesh(NP.geo.roundedBox(0.26, h * M.rand(0.4, 0.75), 0.26, 0.08), NP.mat.neon(col));
          strip.position.set(x - Math.sign(x) * (w / 2 + 0.15), b.position.y + M.rand(-1, 2), z);
          u.group.add(strip);
        }
        // 楼顶灯带
        if (Math.random() < 0.5) {
          const top = new THREE.Mesh(NP.geo.roundedBox(w * 1.02, 0.3, dd * 1.02, 0.1), NP.mat.neon(M.pick([PAL.neon.cyan, PAL.neon.pink])));
          top.position.set(x, topY - 14 + h + 0.15, z);
          u.group.add(top);
        }
      }

      // 高空云团
      if (Math.random() < 0.75) {
        const cl = new THREE.Group();
        const mat = NP.mat.toon(0xffffff);
        const n = M.randInt(3, 4);
        for (let k = 0; k < n; k++) {
          const s = M.rand(3, 7);
          const b = new THREE.Mesh(NP.geo.sphere(1, 12), mat);
          b.scale.set(s * M.rand(1.1, 1.7), s * 0.6, s * M.rand(1, 1.4));
          b.position.set(M.rand(-5, 5), M.rand(-0.6, 0.6), M.rand(-4, 4));
          cl.add(b);
        }
        const side = Math.random() < 0.5 ? -1 : 1;
        cl.position.set(side * M.rand(10, 42), topY + M.rand(14, 30), zNear - M.rand(0, len));
        u.group.add(cl);
      }

      // 霓虹圆环（空中装饰，带视差）
      if (Math.random() < 0.4) {
        const ring = new THREE.Mesh(NP.geo.torus(M.rand(2.5, 4.5), 0.12, 28), NP.mat.neon(M.pick([PAL.neon.pink, PAL.neon.cyan, PAL.neon.purple]), 0.9));
        const side = Math.random() < 0.5 ? -1 : 1;
        ring.position.set(side * M.rand(9, 24), topY + M.rand(4, 16), zNear - M.rand(0, len));
        ring.rotation.set(M.rand(0, 3.1), M.rand(0, 3.1), 0);
        u.rings = u.rings || [];
        u.rings.push(ring);
        u.group.add(ring);
      }

      // 跨道霓虹门（每 2~3 段出现一次）
      if (this.unitCount > 2 && this.unitCount % 3 === 0) {
        const col = M.pick([PAL.neon.cyan, PAL.neon.pink, PAL.neon.purple]);
        this.addGate(u, this.curX, this.curTopY, zNear - 1.5, col, M.rand(6, 8), M.rand(13, 16));
      }
    }

    /* -------------------------------------------------- 每帧更新 */
    update(dt, playerZ, halosOn) {
      this._t += dt;
      // 回收落后的单元
      const units = this.units;
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        if (u.zFar > playerZ + 46) {
          // 先做数据侧的回收，再解挂场景节点
          for (const b of u.boxes) {
            const k = this.boxes.indexOf(b); if (k >= 0) this.boxes.splice(k, 1);
          }
          for (const o of u.orbs) {
            const k = this.orbs.indexOf(o); if (k >= 0) this.orbs.splice(k, 1);
          }
          this._disposeUnit(u);
          units.splice(i, 1);
        }
      }
      // 向前补足赛道
      let guard = 0;
      while (this.frontier > playerZ - 175 && guard++ < 8) this.makeUnit();

      // 能量珠浮动 + 旋转
      const t = this._t;
      for (let i = 0; i < this.orbs.length; i++) {
        const o = this.orbs[i];
        if (o.taken) continue;
        const y = o.y0 + Math.sin(t * 2.1 + o.phase) * 0.15;
        o.mesh.position.y = y;
        o.halo.position.y = y;
        o.mesh.rotation.y = t * 1.4 + o.phase;
        o.mesh.rotation.x = t * 0.7;
        if (halosOn !== undefined && o.halo.visible !== halosOn) o.halo.visible = halosOn;
      }
      // 旋转棱锥动画
      for (const u of this.units) {
        if (!u.spinners) continue;
        for (const s of u.spinners) {
          s.obj.rotation.y = t * 2.2;
          s.core.rotation.x = t * 1.7 + s.phase;
          s.obj.position.y = s.baseY + Math.sin(t * 1.6 + s.phase) * 0.32;
        }
      }
      for (const u of this.units) {
        if (!u.rings) continue;
        for (const r of u.rings) { r.rotation.z += dt * 0.35; r.rotation.y += dt * 0.18; }
      }
      this.sky.update(dt, { x: this._camX || 0, z: playerZ });
      this.cloudSea.update(dt, playerZ);
    }

    setCamX(x) { this._camX = x; }

    /* -------------------------------------------------- 物理查询 */
    // 取出玩家附近的碰撞盒（避免全量遍历）
    nearBoxes(x, z, spanZ, spanX) {
      const out = this._near || (this._near = []);
      out.length = 0;
      const boxes = this.boxes;
      const z0 = z - spanZ, z1 = z + spanZ;
      const x0 = x - spanX, x1 = x + spanX;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.maxZ < z0 || b.minZ > z1) continue;
        if (b.maxX < x0 || b.minX > x1) continue;
        out.push(b);
      }
      return out;
    }

    // 玩家脚下踩着的平台（复活点捕捉用）
    platformAt(x, z, y) {
      let best = null;
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (b.kind !== 'platform') continue;
        if (x < b.minX + 0.35 || x > b.maxX - 0.35) continue;
        if (z < b.minZ + 0.35 || z > b.maxZ - 0.35) continue;
        if (Math.abs(b.topY - y) > 0.4) continue;
        if (!best || b.topY > best.topY) best = b;
      }
      return best;
    }

    // 某点下方最近的平台顶面（用于坠落判定与复活点捕捉）
    platformTopBelow(x, z) {      let best = -Infinity;
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (b.kind !== 'platform') continue;
        if (x < b.minX - 0.4 || x > b.maxX + 0.4) continue;
        if (z < b.minZ || z > b.maxZ) continue;
        if (b.topY > best) best = b.topY;
      }
      return best;
    }

    // 收集判定
    collect(playerPos, radius) {
      const got = [];
      for (let i = 0; i < this.orbs.length; i++) {
        const o = this.orbs[i];
        if (o.taken) continue;
        const dx = o.x - playerPos.x, dy = o.mesh.position.y - (playerPos.y + 0.75), dz = o.z - playerPos.z;
        if (dx * dx + dy * dy + dz * dz < radius * radius) {
          o.taken = true;
          o.mesh.visible = false;
          o.halo.visible = false;
          got.push(o);
        }
      }
      return got;
    }
  }

  NP.Sky = Sky;
  NP.CloudSea = CloudSea;
  NP.World = World;
  NP.WORLD_CONST = { PLAT_THICK: PLAT_THICK, REACH_GAP: REACH_GAP, REACH_UP: REACH_UP, REACH_SIDE: REACH_SIDE, TRACK_COLORS: TRACK_COLORS };
})(window.NP);

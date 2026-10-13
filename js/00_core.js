/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 00 基础层
 * 调色板 / 数学工具 / 程序化贴图 / 共享几何体与材质缓存
 * 风格：浅色小清新卡通 + 霓虹赛博点缀
 * ========================================================================= */
window.NP = window.NP || {};

(function (NP) {
  'use strict';

  /* ---------------------------------------------------------------- 调色板
   * 底色走「浅色小清新」：马卡龙粉蓝绿紫；霓虹色走高饱和，用于描边与发光件。
   */
  const PAL = {
    skyTop: 0x9ee2ff,
    skyBottom: 0xffe4f3,
    fog: 0xdff1ff,
    ink: 0x4a3f75,            // 卡通描边：柔和的紫墨色（比纯黑更可爱）

    cream: 0xfff6e9,
    white: 0xffffff,

    pastel: {
      mint: 0xa8f0dc,
      sky: 0xa9dcff,
      lilac: 0xd3c4ff,
      pink: 0xffc8e4,
      peach: 0xffd2b8,
      coral: 0xffc0a8,
      lemon: 0xffeaa8,
      aqua: 0xbdf3ff
    },
    neon: {
      cyan: 0x1fd8ff,
      pink: 0xff4fb8,
      purple: 0x9d6bff,
      lime: 0x86ff6b,
      yellow: 0xffd23f,
      coral: 0xff8a6b
    }
  };
  NP.PAL = PAL;

  /* ---------------------------------------------------------------- 数学 */
  const M = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    min: Math.min,
    max: Math.max,
    lerp: (a, b, t) => a + (b - a) * t,
    // 帧率无关阻尼插值
    damp(cur, target, lambda, dt) {
      return M.lerp(cur, target, 1 - Math.exp(-lambda * dt));
    },
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    smoothstep(e0, e1, x) {
      const t = M.clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    },
    // 可复现随机数（用于装饰摆放）
    seeded(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    angleLerp(a, b, t) {
      let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    }
  };
  NP.M = M;

  /* ------------------------------------------------------- 程序化贴图（无外部资源） */
  const texCache = {};

  function canvasTex(key, size, draw) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    draw(ctx, size);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    texCache[key] = t;
    return t;
  }

  NP.tex = {
    // 柔和圆点：粒子与拖尾用
    dot() {
      return canvasTex('dot', 64, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0.0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.72, 'rgba(255,255,255,0.25)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    },
    // 光晕：霓虹件的辉光
    glow() {
      return canvasTex('glow', 128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    },
    // 云团：柔和蓬松的椭圆
    puff() {
      return canvasTex('puff', 128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
        g.addColorStop(0.0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.72)');
        g.addColorStop(0.85, 'rgba(255,255,255,0.22)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    },
    // 光柱：赛道边缘的霓虹垂直光带
    stripe() {
      return canvasTex('stripe', 64, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, s, 0);
        g.addColorStop(0.0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    },
    // 卡通窗格：远景建筑立面
    windows(baseHex, litHex, neonHexes, cols, rows) {
      const key = `win_${baseHex}_${litHex}_${neonHexes.join('_')}_${cols}_${rows}`;
      return canvasTex(key, 256, (ctx, s) => {
        ctx.fillStyle = '#' + baseHex.toString(16).padStart(6, '0');
        ctx.fillRect(0, 0, s, s);
        const cw = s / cols, ch = s / rows;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const r = Math.random();
            let col;
            if (r < 0.55) col = '#' + litHex.toString(16).padStart(6, '0');
            else if (r < 0.72) col = '#' + neonHexes[(x + y) % neonHexes.length].toString(16).padStart(6, '0');
            else col = 'rgba(255,255,255,0.35)';
            ctx.fillStyle = col;
            const pad = cw * 0.22;
            const w = cw - pad * 2, h = ch - pad * 2;
            const rx = x * cw + (cw - w) / 2, ry = y * ch + (ch - h) / 2;
            const rad = Math.min(w, h) * 0.3;
            ctx.beginPath();
            ctx.moveTo(rx + rad, ry);
            ctx.arcTo(rx + w, ry, rx + w, ry + h, rad);
            ctx.arcTo(rx + w, ry + h, rx, ry + h, rad);
            ctx.arcTo(rx, ry + h, rx, ry, rad);
            ctx.arcTo(rx, ry, rx + w, ry, rad);
            ctx.closePath();
            ctx.fill();
          }
        }
      });
    }
  };

  // 卡通分级渐变（3~4 段色阶，形成赛璐璐质感）
  NP.tex.toonGradient = function (levels) {
    levels = levels || 4;
    const key = 'toon' + levels;
    if (texCache[key]) return texCache[key];
    const data = new Uint8Array(levels);
    const ramp = [110, 168, 214, 255, 255];
    for (let i = 0; i < levels; i++) data[i] = ramp[Math.min(i, ramp.length - 1)];
    const t = new THREE.DataTexture(data, levels, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    texCache[key] = t;
    return t;
  };

  /* ---------------------------------------------------------- 几何体缓存 */
  const geoCache = {};
  let geoCacheCount = 0;

  function cachedGeo(key, build) {
    if (geoCache[key]) return geoCache[key];
    if (geoCacheCount > 400) { // 极端情况下清理，避免无限增长
      for (const k in geoCache) delete geoCache[k];
      geoCacheCount = 0;
    }
    const g = build();
    geoCache[key] = g;
    geoCacheCount++;
    return g;
  }
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

  NP.geo = {
    // 圆角方块：赛道的核心造型语言（卡通感来自圆角）
    roundedBox(w, h, d, r) {
      r = Math.max(0.02, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
      const key = `rb|${f2(w)}|${f2(h)}|${f2(d)}|${f2(r)}`;
      return cachedGeo(key, () => {
        const bevel = Math.min(r * 0.66, h * 0.24, 0.16);
        const hw = w / 2 - r, hd = d / 2 - r;
        const shape = new THREE.Shape();
        shape.moveTo(-hw, -d / 2);
        shape.lineTo(hw, -d / 2);
        shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -hd);
        shape.lineTo(w / 2, hd);
        shape.quadraticCurveTo(w / 2, d / 2, hw, d / 2);
        shape.lineTo(-hw, d / 2);
        shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, hd);
        shape.lineTo(-w / 2, -hd);
        shape.quadraticCurveTo(-w / 2, -d / 2, -hw, -d / 2);

        const depth = Math.max(0.02, h - bevel * 2);
        const g = new THREE.ExtrudeGeometry(shape, {
          depth: depth,
          bevelEnabled: true,
          bevelThickness: bevel,
          bevelSize: bevel,
          bevelSegments: 2,
          curveSegments: 3,
          steps: 1
        });
        // 归一到精确尺寸：先把截面缩到目标 w/h 边界，再居中
        g.computeBoundingBox();
        const bb = g.boundingBox;
        const sx = w / Math.max(0.001, bb.max.x - bb.min.x);
        const sy = h / Math.max(0.001, bb.max.y - bb.min.y);
        const sz = d / Math.max(0.001, bb.max.z - bb.min.z);
        g.scale(sx, sy, sz);
        g.center();
        g.computeVertexNormals();
        return g;
      });
    },
    plane() {
      return cachedGeo('plane', () => new THREE.PlaneGeometry(1, 1));
    },
    sphere(r, seg) {
      return cachedGeo(`sph|${f2(r)}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)));
    },
    capsule(r, len) {
      return cachedGeo(`cap|${f2(r)}|${f2(len)}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));
    },
    cylinder(rt, rb, h, seg) {
      return cachedGeo(`cyl|${f2(rt)}|${f2(rb)}|${f2(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
    },
    icosa(r, detail) {
      return cachedGeo(`ico|${f2(r)}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
    },
    torus(r, tube, seg) {
      return cachedGeo(`tor|${f2(r)}|${f2(tube)}|${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg));
    },
    cone(r, h, seg) {
      return cachedGeo(`cone|${f2(r)}|${f2(h)}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    },
    octa(r) {
      return cachedGeo(`oct|${f2(r)}`, () => new THREE.OctahedronGeometry(r, 0));
    }
  };

  /* ---------------------------------------------------------- 材质缓存 */
  const matCache = {};

  NP.mat = {
    // 卡通着色（受光）——赛道主体、角色、装饰用
    // 注意：MeshToonMaterial 不支持 flatShading，卡通感来自 4 段色阶渐变
    toon(color, opts) {
      opts = opts || {};
      const key = `toon|${color}|${opts.emissive || 0}|${opts.emissiveIntensity || 1}`;
      if (matCache[key]) return matCache[key];
      const m = new THREE.MeshToonMaterial({
        color: color,
        gradientMap: NP.tex.toonGradient(4),
        emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 1,
        transparent: !!opts.transparent,
        opacity: opts.opacity !== undefined ? opts.opacity : 1
      });
      matCache[key] = m;
      return m;
    },
    // 自发光纯色（不受光）——霓虹灯管、发光边条
    neon(color, opacity) {
      const key = `neon|${color}|${opacity === undefined ? 1 : opacity}`;
      if (matCache[key]) return matCache[key];
      const m = new THREE.MeshBasicMaterial({
        color: color,
        transparent: opacity !== undefined && opacity < 1,
        opacity: opacity === undefined ? 1 : opacity
      });
      matCache[key] = m;
      return m;
    },
    // 卡通描边（反面外扩壳）
    outline() {
      return cachedMatOutline();
    },
    // 半透明玻璃（UI 化的地面光环等）
    glass(color, opacity) {
      const key = `glass|${color}|${opacity}`;
      if (matCache[key]) return matCache[key];
      const m = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: opacity,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      matCache[key] = m;
      return m;
    },
    // 建筑立面
    facade(baseHex, litHex, neonHexes, cols, rows) {
      const key = `fac|${baseHex}|${cols}|${rows}`;
      if (matCache[key]) return matCache[key];
      const tex = NP.tex.windows(baseHex, litHex, neonHexes, cols, rows);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const m = new THREE.MeshToonMaterial({ color: 0xffffff, map: tex, gradientMap: NP.tex.toonGradient(4) });
      matCache[key] = m;
      return m;
    }
  };

  function cachedMatOutline() {
    if (matCache.outline) return matCache.outline;
    const m = new THREE.MeshBasicMaterial({ color: PAL.ink, side: THREE.BackSide });
    matCache.outline = m;
    return m;
  }

  /* ------------------------------------------------- 发光精灵 / 光环辅助 */
  NP.makeHalo = function (color, size, opacity) {
    const mat = new THREE.SpriteMaterial({
      map: NP.tex.glow(),
      color: color,
      transparent: true,
      opacity: opacity === undefined ? 0.6 : opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  };

  // 扁平发光片：贴在赛道边缘/霓虹条下方，制造辉光
  NP.makeGlowQuad = function (color, w, h, opacity) {
    const mat = new THREE.MeshBasicMaterial({
      map: NP.tex.glow(),
      color: color,
      transparent: true,
      opacity: opacity === undefined ? 0.5 : opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    const m = new THREE.Mesh(NP.geo.plane(), mat);
    m.scale.set(w, h, 1);
    return m;
  };

  NP.Textures = texCache;
})(window.NP);

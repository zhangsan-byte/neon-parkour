(async () => {
  const g = window.game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { layout: {}, input: {} };

  // ---- 布局：触屏 UI 是否显示、键盘说明是否让位
  const vis = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return 'missing';
    return getComputedStyle(e).display;
  };
  out.layout = {
    isTouch: document.body.classList.contains('is-touch'),
    isPortrait: document.body.classList.contains('is-portrait'),
    touchUI: vis('#touch'),
    jumpBtn: vis('.t-btn.t-jump'),
    kbHint: vis('.hint-kbd'),
    touchHint: vis('.hint-touch'),
    rotateHint: vis('#rotate-hint'),
    pixelRatio: g.renderer.getPixelRatio(),
    basePR: g.basePR,
    isTouchDevice: g.isTouchDevice,
    viewport: [window.innerWidth, window.innerHeight]
  };

  // ---- 点真实按钮开始游戏
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.click();
  await sleep(3200);
  out.afterStart = { state: g.state, calls: g.renderer.info.render.calls };

  // ---- 触屏按钮坐标（给驱动层用）
  const rect = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
  };
  out.buttons = {
    jump: rect('.t-btn.t-jump'), slide: rect('.t-btn.t-slide'),
    left: rect('[data-act="left"]'), right: rect('[data-act="right"]')
  };
  return JSON.stringify(out);
})()

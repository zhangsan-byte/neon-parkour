(async () => {
  const g = window.game, p = g.player;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // 进入可操作状态（跳过倒计时），每项测试前把角色复位到起点跑道
  g.newRun();
  g.setState('playing');
  const resetPlayer = () => { p.reset(g.world); p.invuln = 999; g.lives = 3; };
  resetPlayer();
  out.ready = { state: g.state, y: +p.pos.y.toFixed(2), speed: +p.speed.toFixed(1) };

  const btn = (sel) => document.querySelector(sel);
  const pd = (sel, id) => btn(sel).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: id || 1, pointerType: 'touch', isPrimary: true }));
  const pu = (sel, id) => btn(sel).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: id || 1, pointerType: 'touch', isPrimary: true }));

  // ---------- A) 跳跃按钮 ----------
  resetPlayer();
  const y0 = p.pos.y;
  pd('.t-btn.t-jump');
  out.jumpPressedClass = btn('.t-btn.t-jump').classList.contains('pressed');
  pu('.t-btn.t-jump');
  await sleep(300);
  out.jump = { rose: p.pos.y > y0 + 0.4, y: +p.pos.y.toFixed(2), jumpsLeft: p.jumpsLeft, grounded: p.grounded,
    classCleared: !btn('.t-btn.t-jump').classList.contains('pressed') };

  // ---------- A2) 空中再点 = 二段跳 ----------
  pd('.t-btn.t-jump'); pu('.t-btn.t-jump');
  await sleep(220);
  out.doubleJump = { jumpsLeft: p.jumpsLeft, flipActive: p.flipActive, y: +p.pos.y.toFixed(2) };
  await sleep(1400);

  // ---------- B) 按住右移 ----------
  resetPlayer();
  const x0 = p.pos.x;
  pd('[data-act="right"]');
  await sleep(800);
  const xDuring = p.pos.x;
  const heldFlag = g.input.right;
  pu('[data-act="right"]');
  await sleep(250);
  out.lateralRight = { moved: +(xDuring - x0).toFixed(2), flagDuringHold: heldFlag, flagAfterUp: g.input.right };

  // ---------- B2) 按住左移 ----------
  const x1 = p.pos.x;
  pd('[data-act="left"]');
  await sleep(800);
  const xDuring2 = p.pos.x;
  pu('[data-act="left"]');
  out.lateralLeft = { moved: +(xDuring2 - x1).toFixed(2) };

  // ---------- C) 按住滑铲 ----------
  resetPlayer();
  await sleep(200);
  pd('.t-btn.t-slide');
  await sleep(400);
  out.slide = { sliding: p.sliding, height: +p.height.toFixed(2), inputFlag: g.input._sl };
  pu('.t-btn.t-slide');
  await sleep(1000);
  out.slideEnd = { sliding: p.sliding, height: +p.height.toFixed(2) };

  // ---------- D) 画布手势：上滑跳跃 / 下滑滑铲 ----------
  resetPlayer();
  const cv = document.getElementById('game-canvas');
  const touch = (type, x, y, id) => cv.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id || 2, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y
  }));
  await sleep(250);
  const y2 = p.pos.y;
  touch('pointerdown', 420, 320); touch('pointermove', 420, 280); touch('pointermove', 420, 200); touch('pointerup', 420, 190);
  await sleep(320);
  out.swipeUp = { rose: p.pos.y > y2 + 0.3, y: +p.pos.y.toFixed(2), jumpsLeft: p.jumpsLeft };
  await sleep(1400);

  const y3 = p.pos.y;
  touch('pointerdown', 420, 160); touch('pointermove', 420, 210); touch('pointermove', 420, 270); touch('pointerup', 420, 280);
  await sleep(320);
  out.swipeDown = { sliding: p.sliding, height: +p.height.toFixed(2), movedVertically: p.pos.y > y3 + 0.3 };

  // ---------- E) 触屏按钮不被遮挡 ----------
  const r = btn('.t-btn.t-jump').getBoundingClientRect();
  const hitEl = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  out.hitTest = { topmost: hitEl ? (hitEl.id || hitEl.className) : 'null', isJumpBtn: hitEl === btn('.t-btn.t-jump') };

  p.invuln = 0;
  return JSON.stringify(out);
})()

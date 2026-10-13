(() => {
  const g = window.game, p = g.player;
  if (g._rafId) cancelAnimationFrame(g._rafId); g._rafId = null;
  g.newRun(); g.setState('playing');
  let bar = g.world.boxes.find(b => b.kind === 'bar');
  if (!bar) {
    const plat = g.world.boxes.filter(b => b.kind === 'platform')
      .sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
    const u = g.world.units.find(uu => uu.boxes.indexOf(plat) >= 0);
    const before = g.world.boxes.length;
    g.world.addBar(u, (plat.minX + plat.maxX) / 2, plat.topY, plat.maxZ - 30, 9);
    bar = g.world.boxes.slice(before)[0];
  }
  const cx = (bar.minX + bar.maxX) / 2;
  const platTop = bar.minY - 1.12;
  const hits = [];
  const oldHit = p.onHit;
  p.onHit = (pl, box) => { hits.push({ at: +pl.pos.z.toFixed(2), boxZ: +box.minZ.toFixed(2), kind: box.kind }); if (oldHit) oldHit(pl, box); };
  p.pos.set(cx, platTop + 0.05, bar.maxZ + 3);
  p.vel.set(0, 0, 0); p.sliding = false; p.slideTimer = 0; p.speed = 13;
  p.jumpsLeft = 2; p.grounded = true; p.invuln = 0; p.height = 1.56; p.hurtT = 0;
  g.lives = 3;
  const inp = { left: false, right: false, jumpHeld: false, slideHeld: false, jumpPressed: false };
  const trace = [];
  for (let i = 0; i < 200; i++) {
    p.update(1 / 120, g.world, inp, 5, { frozen: false });
    if (i % 10 === 0) trace.push([+p.pos.z.toFixed(2), +p.pos.y.toFixed(2), +p.invuln.toFixed(2), g.lives, p.grounded ? 1 : 0, p.height]);
  }
  p.onHit = oldHit;
  return JSON.stringify({
    bar: { x: [+bar.minX.toFixed(1), +bar.maxX.toFixed(1)], y: [+bar.minY.toFixed(2), +bar.maxY.toFixed(2)], z: [+bar.minZ.toFixed(2), +bar.maxZ.toFixed(2)], damage: !!bar.damage, platTop: +platTop.toFixed(2) },
    startZ: +(bar.maxZ + 3).toFixed(2), hits, finalZ: +p.pos.z.toFixed(2), lives: g.lives,
    trace: trace.slice(0, 12)
  });
})()

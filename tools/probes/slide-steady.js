(() => {
  const g = window.game, p = g.player;
  if (g._rafId) cancelAnimationFrame(g._rafId); g._rafId = null;
  g.newRun(); g.setState('playing');
  p.invuln = 0; p.hurtT = 0; p.root.visible = true;
  let bar = g.world.boxes.find(b => b.kind === 'bar');
  if (!bar) {
    const plat = g.world.boxes.filter(b => b.kind === 'platform')
      .sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
    const u = g.world.units.find(uu => uu.boxes.indexOf(plat) >= 0);
    const before = g.world.boxes.length;
    g.world.addBar(u, (plat.minX + plat.maxX) / 2, plat.topY, plat.maxZ - 40, 9);
    bar = g.world.boxes.slice(before)[0];
  }
  const platTop = bar.minY - 1.12;
  p.pos.set((bar.minX + bar.maxX) / 2, platTop + 0.05, bar.minZ + 3);
  p.vel.set(0, 0, 0); p.speed = 14; p.sliding = true; p.slideTimer = 99; p.height = 0.95;
  const inp = { left: false, right: false, jumpHeld: false, slideHeld: true, jumpPressed: false };
  for (let i = 0; i < 200; i++) p.update(1 / 120, g.world, inp, 3, { frozen: false });   // 跑到稳态
  p.tickRender(); p.body.updateWorldMatrix(true, true);
  // 逐网格量高度，找出最高的部件
  const v = new THREE.Vector3(); let top = -99, who = '';
  p.body.traverse(o => {
    if (!o.isMesh || o === p.flash) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
      v.set(cx, cy, cz).applyMatrix4(o.matrixWorld);
      const h = v.y - p.pos.y;
      if (h > top) { top = h; who = (o === p.head ? 'head' : o === p.torso ? 'torso' : p.scarf.indexOf(o) >= 0 ? 'scarf' : (o.material && o.material.color ? '#' + o.material.color.getHexString() : 'mesh')); }
    }
  });
  const lean = +p.body.rotation.x.toFixed(2);
  return JSON.stringify({ lean, steadyTop: +top.toFixed(2), highest: who, clearance: +(1.12 - top).toFixed(2), fitsUnderBar: top < 1.12, sliding: p.sliding, y: +p.pos.y.toFixed(2) });
})()

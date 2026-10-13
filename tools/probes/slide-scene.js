(() => {
  const g = window.game, p = g.player;
  if (g._rafId) cancelAnimationFrame(g._rafId);
  g._rafId = null;
  g.newRun(); g.setState('playing');
  g.world.root.visible = true; g.world.cloudSea.group.visible = true;
  p.invuln = 0; p.hurtT = 0; p.root.visible = true;
  // 找一根横杆，没有就造一根
  let bar = g.world.boxes.find(b => b.kind === 'bar');
  if (!bar) {
    const plat = g.world.boxes.filter(b => b.kind === 'platform')
      .sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
    const u = g.world.units.find(uu => uu.boxes.indexOf(plat) >= 0);
    const before = g.world.boxes.length;
    g.world.addBar(u, (plat.minX + plat.maxX) / 2, plat.topY, plat.maxZ - 16, 9);
    bar = g.world.boxes.slice(before)[0];
  }
  const bx = (bar.minX + bar.maxX) / 2;
  const platTop = bar.minY - 1.12;
  // 站到横杆前 1.2 米，按住滑铲推进若干物理步，正好停在横杆下方
  p.pos.set(bx, platTop + 0.05, bar.minZ + 1.2);
  p.vel.set(0, 0, 0); p.speed = 14; p.sliding = true; p.slideTimer = 9; p.height = 0.95;
  const inp = { left: false, right: false, jumpHeld: false, slideHeld: true, jumpPressed: false };
  for (let i = 0; i < 14; i++) p.update(1 / 120, g.world, inp, 3, { frozen: false });
  p.tickRender();
  p.body.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  p.body.traverse(o => { if (!o.isMesh || o === p.flash) return; if (p.scarf.indexOf(o) >= 0) return; box.expandByObject(o); });
  // 用游戏自己的第三人称跟随相机取景
  g.camera.fov = 58; g.camera.aspect = 1440 / 900;
  g.camera.position.set(p.pos.x * 0.92 + 1.2, p.pos.y + 1.75, p.pos.z + 4.6);
  g.camera.lookAt(p.pos.x, p.pos.y + 0.75, p.pos.z - 4.2);
  g.camera.updateProjectionMatrix();
  g.renderer.render(g.scene, g.camera);
  const r = {
    sliding: p.sliding,
    bodyTop: +(box.max.y - p.pos.y).toFixed(2),
    barBottomAbovePlatform: 1.12,
    clearance: +(1.12 - (box.max.y - p.pos.y)).toFixed(2),
    playerZ: +p.pos.z.toFixed(2), barZ: +bar.minZ.toFixed(2),
    url: g.renderer.domElement.toDataURL('image/png')
  };
  window.__slideScene = r;
  return JSON.stringify({ sliding: r.sliding, bodyTop: r.bodyTop, clearance: r.clearance });
})()

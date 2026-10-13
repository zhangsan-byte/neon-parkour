(() => {
  const g = window.game, p = g.player;
  // 彻底停掉主循环，否则待机动画与无敌闪烁会覆盖我们摆好的姿势
  if (g._rafId) cancelAnimationFrame(g._rafId);
  g._rafId = null;
  p.invuln = 0; p.hurtT = 0; p.root.visible = true;
  g.state = 'paused';
  let bar = g.world.boxes.find(b => b.kind === 'bar');
  if (!bar) {
    // 现造一根：在起点跑道上放一个横杆（与游戏内构造参数一致）
    const plat = g.world.boxes.filter(b => b.kind === 'platform')
      .sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
    const u = g.world.units.find(uu => uu.boxes.indexOf(plat) >= 0);
    const cx = (plat.minX + plat.maxX) / 2;
    const z = plat.maxZ - 12;
    const before = g.world.boxes.length;
    g.world.addBar(u, cx, plat.topY, z, 9);
    bar = g.world.boxes.slice(before)[0];
  }
  if (!bar) return 'still no bar';
  const bx = (bar.minX + bar.maxX) / 2;
  const platTop = bar.minY - 1.12;
  const bz = (bar.minZ + bar.maxZ) / 2;
  // 把角色放在横杆正下方并摆成滑铲姿态
  p.pos.set(bx, platTop + 0.02, bz); p.vel.set(0, 0, 0);
  p.sliding = true; p.slideTimer = 9; p.height = 0.95;
  p.body.position.set(0, 0, 0);
  p.body.rotation.set(-1.2, 0, 0);
  p.legs[0].rotation.x = -0.9; p.legs[1].rotation.x = -0.35;
  p.arms[0].rotation.x = -2.6; p.arms[1].rotation.x = -0.5;
  p.tickRender();
  p.body.updateWorldMatrix(true, true);
  // 只量"身体"（排除受伤闪光壳与飘带）
  const box = new THREE.Box3();
  p.body.traverse(o => {
    if (!o.isMesh || o === p.flash) return;
    if (p.scarf.indexOf(o) >= 0) return;
    box.expandByObject(o);
  });
  const bodyTop = box.max.y - p.pos.y;
  // 侧视相机（隐藏世界，只看角色姿态）
  g.world.root.visible = false;
  g.world.cloudSea.group.visible = false;
  g.camera.fov = 34; g.camera.aspect = 1440 / 900;
  g.camera.position.set(bx + 4.6, platTop + 0.85, bz + 0.15);
  g.camera.lookAt(bx + 0.35, platTop + 0.42, bz);
  g.camera.updateProjectionMatrix();
  g.renderer.render(g.scene, g.camera);
  const url = g.renderer.domElement.toDataURL('image/png');
  window.__side = { bodyTop: +bodyTop.toFixed(2), barBottom: +(bar.minY - platTop).toFixed(2), fits: bodyTop < (bar.minY - platTop), url };
  return JSON.stringify({ bodyTop: +bodyTop.toFixed(2), barBottom: +(bar.minY - platTop).toFixed(2), fits: bodyTop < (bar.minY - platTop) });
})()

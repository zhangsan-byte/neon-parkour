/* =========================================================================
 * 自动化验收脚本：启动无头 Chrome → 跑一遍真实玩法 → 截图 + 状态断言
 * 用法: node tools/verify.mjs [场景...]
 *   menu  play  jump  slide  sound  gameover  board  mechan  perf  stall
 * 可用环境变量覆盖：CHROME_PATH / CHROME_PROFILE / CDP_PORT / WEB_PORT
 * ========================================================================= */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = join(HERE, 'shots');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = process.env.CHROME_PROFILE || join(tmpdir(), 'neon-parkour-chrome-profile');
const PORT = Number(process.env.CDP_PORT || 9222);
const WEB_PORT = Number(process.env.WEB_PORT || 8899);
const URL_BASE = `http://127.0.0.1:${WEB_PORT}/index.html`;
const TAB_MATCH = ':' + WEB_PORT + '/';
const SCENES = process.argv.slice(2);
const WANT = (s) => SCENES.length === 0 || SCENES.includes(s);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOT_DIR, { recursive: true });

/* ---------------------------------------------------- 本地服务器 */
let startedServer = false;
async function ensureServer() {
  const alive = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${WEB_PORT}/index.html`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch (e) { return false; }
  };
  if (await alive()) return;
  console.log('[server] starting dev server...');
  const ROOT = join(HERE, '..');
  const child = spawn(process.execPath, [join(HERE, 'dev-server.mjs'), ROOT, String(WEB_PORT)], { detached: true, stdio: 'ignore' });
  child.unref();
  startedServer = true;
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    if (await alive()) { console.log('[server] up'); return; }
  }
  throw new Error('dev server 未就绪');
}

/* ---------------------------------------------------- Chrome 生命周期 */
async function endpointAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch (e) { return false; }
}

async function ensureChrome() {
  if (await endpointAlive()) return false;
  console.log('[chrome] launching detached debug instance...');
  // 无头模式：验证过程不弹窗口、不抢前台焦点
  const args = [
    '--headless',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1440,900',
    'about:blank'
  ];
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    if (await endpointAlive()) { console.log('[chrome] up after ~' + ((i + 1) * 0.6).toFixed(1) + 's'); return true; }
  }
  throw new Error('Chrome 调试端口未就绪');
}

/* ---------------------------------------------------- 极简 CDP 客户端 */
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter((t) => t.type === 'page');
  const page = pages.find((t) => t.url.includes(TAB_MATCH)) || pages[0];
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  };
  const send = (method, params = {}) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((res, rej) => {
      pending.set(mid, { res, rej });
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, method === 'Page.captureScreenshot' ? 25000 : 15000);
    });
  };
  return { send, ws };
}

const ERR_HOOK = `
  window.__errs = window.__errs || [];
  // 自动化测试：让页面始终认为自己是可见/聚焦的，否则游戏会按设计自动暂停
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  } catch (e) {}
  const trim = (s) => String(s||'').split('\\n').slice(0,9).map(x=>x.trim().replace(/https?:\\/\\/[^/]+\\//,'')).join(' <- ');
  window.addEventListener('error', e => window.__errs.push('ERROR: ' + (e.message||'') + ' || ' + trim(e.error && e.error.stack || '')));
  window.addEventListener('unhandledrejection', e => window.__errs.push('REJECT: ' + trim(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  (function(){ const ce=console.error, cw=console.warn;
    console.error=function(){ window.__errs.push('console.error: '+Array.from(arguments).map(String).join(' ')); ce.apply(console,arguments); };
    console.warn=function(){ window.__errs.push('console.warn: '+Array.from(arguments).map(String).join(' ') + ' || ' + trim(new Error().stack)); cw.apply(console,arguments); };
  })();
`;

const KEYS = {
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  KeyW: { key: 'w', code: 'KeyW', vk: 87, text: 'w' },
  KeyA: { key: 'a', code: 'KeyA', vk: 65, text: 'a' },
  KeyD: { key: 'd', code: 'KeyD', vk: 68, text: 'd' },
  KeyS: { key: 's', code: 'KeyS', vk: 83, text: 's' },
  KeyP: { key: 'p', code: 'KeyP', vk: 80, text: 'p' },
  KeyR: { key: 'r', code: 'KeyR', vk: 82, text: 'r' },
  KeyF: { key: 'f', code: 'KeyF', vk: 70, text: 'f' },
  KeyM: { key: 'm', code: 'KeyM', vk: 77, text: 'm' }
};

/* --------------------------------------------- 让目标标签页真正处于前台
 * 浏览器会节流后台标签页的 requestAnimationFrame，导致游戏不推进，
 * 所以这里通过 browser 级 CDP 把游戏标签页激活到前台。 */
async function activateTab() {   // 无头模式下不需要，保留作为诊断输出
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('browser ws fail')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  const send = (method, params = {}) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((res, rej) => { pending.set(mid, { res, rej }); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 8000); });
  };
  const { targetInfos } = await send('Target.getTargets');
  const tabs = targetInfos.filter((t) => t.type === 'page');
  console.log('[tabs] ' + tabs.map((t) => (t.url.slice(0, 46) || 'about:blank')).join(' | '));
  const game = tabs.find((t) => t.url.includes(TAB_MATCH)) || tabs[0];
  ws.close();
  return game.targetId;
}

async function main() {
  await ensureServer();
  await ensureChrome();
  const { send } = await connect();
  await activateTab();
  await sleep(400);

  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: ERR_HOOK });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };
  /** 直接读 canvas 像素：不依赖窗口是否被遮挡（不含 DOM 界面） */
  const shotCanvas = async (name) => {
    const dataUrl = await evalJs(`(()=>{const g=window.game;g.renderer.render(g.scene,g.camera);return g.renderer.domElement.toDataURL('image/png')})()`);
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image') !== 0) {
      console.log('  (canvas 取像失败: ' + String(dataUrl).slice(0, 100) + ')');
      return false;
    }
    writeFileSync(join(SHOT_DIR, name + '-canvas.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('  [shot-canvas] ' + join(SHOT_DIR, name + '-canvas.png'));
    return true;
  };

  const shot = async (name) => {
    await sleep(200);
    try {
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(join(SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('  [shot] ' + join(SHOT_DIR, name + '.png'));
      return true;
    } catch (e) {
      console.log('  (窗口截图失败: ' + e.message + ' → 回退 canvas 取像)');
      return shotCanvas(name);
    }
  };
  const key = async (name) => {
    const k = KEYS[name];
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base, k.text ? { text: k.text } : {}));
    if (k.text && name !== 'Enter') {
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: k.text }, base));
    }
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  };
  const hold = async (name, ms) => {
    const k = KEYS[name];
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
    await sleep(ms);
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  };
  const state = () => evalJs(`(()=>{const g=window.game;if(!g)return{noGame:true};const p=g.player;return{
      fps:+g.fps.toFixed(1), calls:g.renderer.info.render.calls, tris:g.renderer.info.render.triangles,
      maxDt:+(g.maxDt||0).toFixed(3),
      state:g.state, score:g.totalScore, dist:Math.floor(g.distance), lives:g.lives, orbs:g.orbs,
      combo:g.combo, speed:+p.speed.toFixed(1),
      pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)],
      grounded:p.grounded, sliding:p.sliding, invuln:+p.invuln.toFixed(2),
      units:g.world.units.length, boxes:g.world.boxes.length, liveOrbs:g.world.orbs.length,
      errs:(window.__errs||[]).slice(0,6)}})()`);

  /* ---------------------------------------------------------- 场景 */
  console.log('\n== 加载页面 ==');
  await send('Page.navigate', { url: URL_BASE + '?t=' + Date.now() });
  await sleep(4500);
  console.log(JSON.stringify(await state()));

  if (WANT('menu')) {
    console.log('\n== 菜单截图 ==');
    await shot('01-menu');
  }

  console.log('\n== 开始游戏（回车）==');
  await key('Enter');
  await sleep(1200);
  await shot('02-countdown');
  console.log(JSON.stringify(await state()));

  if (WANT('play')) {
    console.log('\n== 跑一段（不操作 3 秒，看是否自动前进/掉落）==');
    await sleep(3000);
    const s1 = await state();
    console.log(JSON.stringify(s1));
    await shot('03-playing');
    console.log('\n== 右移 1.2 秒 ==');
    await hold('ArrowRight', 1200);
    await sleep(600);
    console.log(JSON.stringify(await state()));
    await shot('04-lateral');
    console.log('\n== 左移 1.2 秒 ==');
    await hold('ArrowLeft', 1200);
    await sleep(500);
    console.log(JSON.stringify(await state()));
    await shot('05-lateral-left');
  }

  if (WANT('jump')) {
    console.log('\n== 连续跳跃 ==');
    await key('Space');
    await sleep(260);
    await key('Space');       // 二段跳
    await sleep(420);
    await shot('06-doublejump');
    console.log(JSON.stringify(await state()));
    await sleep(1500);
  }

  if (WANT('slide')) {
    console.log('\n== 滑铲 1 秒 ==');
    await hold('ArrowDown', 1000);
    await sleep(200);
    await shot('07-slide');
    console.log(JSON.stringify(await state()));
    await sleep(800);
  }

  if (WANT('perf')) {
    console.log('\n== 长时间巡航 20 秒（观察转弯/跳跃/速率）==');
    const marks = [];
    for (let i = 0; i < 10; i++) {
      await key('Space');
      if (i % 3 === 0) await hold('ArrowRight', 400); else if (i % 3 === 1) await hold('ArrowLeft', 400);
      await sleep(2000);
      const s = await state();
      marks.push({ t: (i + 1) * 2, dist: s.dist, lives: s.lives, orbs: s.orbs, speed: s.speed, fps: s.fps, y: s.pos && s.pos[1], grounded: s.grounded });
    }
    console.log(JSON.stringify(marks, null, 0));
    await shot('08-cruise');
    console.log(JSON.stringify(await state()));
  }

  if (WANT('gameover')) {
    console.log('\n== 强制三次受伤 → 结算界面 ==');
    await evalJs('game._takeHit();');
    await sleep(500);
    await evalJs('game.player.invuln=0;game._takeHit();');
    await sleep(500);
    const s = await state();
    console.log('lives after 2 hits =', s.lives);
    await evalJs('game.player.invuln=0;game._takeHit();');
    await sleep(1200);
    console.log(JSON.stringify(await state()));
    await shot('09-gameover');
  }

  if (WANT('board')) {
    console.log('\n== 填写名字并保存到排行榜 ==');
    await evalJs(`(()=>{const i=document.getElementById('name-input');i.value='测试跑者';return i.value})()`);
    await evalJs(`document.getElementById('btn-save').click()`);
    await sleep(900);
    await shot('10-board-saved');
    console.log('board =', JSON.stringify(await evalJs('NP.Board.top(10).map(e=>[e.name,e.score,!!e.npc])')));
    console.log('saved rank text =', await evalJs(`document.getElementById('save-done').textContent`));
    await evalJs(`document.getElementById('btn-board').click()`);
    await sleep(600);
    await shot('11-board-panel');
    await evalJs(`document.getElementById('btn-board-close').click()`);
    console.log('\n== 重开一局 ==');
    await evalJs(`document.getElementById('btn-retry').click()`);
    await sleep(2500);
    console.log(JSON.stringify(await state()));
    await shot('12-restart');
  }

  if (WANT('sound')) {
    console.log('\n== 音频管线（用可信按键触发用户手势）==');
    const probe = () => evalJs(`JSON.stringify({ctx: NP.Audio.ctx&&NP.Audio.ctx.state, step: NP.Audio._step, next:+NP.Audio._nextTime.toFixed(2), now:+(NP.Audio.ctx?NP.Audio.ctx.currentTime:0).toFixed(2), musicGain:+(NP.Audio.musicBus?NP.Audio.musicBus.gain.value:0).toFixed(3), inten:+NP.Audio.intensity.toFixed(2)})`);
    console.log('start 前 : ' + await probe());
    await key('Enter');                       // 可信手势 → 允许恢复 AudioContext
    await sleep(2500);
    console.log('start 后 : ' + await probe());
    await sleep(2500);
    console.log('2.5s 后  : ' + await probe());
    await key('Space'); await sleep(1200);
    console.log('跳跃后   : ' + await probe());
  }

  if (WANT('mechan')) {
    console.log('\n== 玩法机制验证：横杆必须滑铲、跨栏必须跳（直接驱动物理） ==');
    const r = await evalJs(`(()=>{
      const g=window.game, w=g.world, p=g.player;
      const savedState=g.state, savedLives=g.lives;
      g.state='playing';
      const noInp={left:false,right:false,jumpHeld:false,slideHeld:false,jumpPressed:false};
      const setInp=(o)=>Object.assign({},noInp,o);
      // 跑到「越过目标盒」为止；返回 {passed, hit, died, steps}
      const run = (inp, steps, box, fromAbove) => {
        let passed=false, hit=false, died=false;
        const old=p.onHit; p.onHit=()=>{hit=true; if(old)old(p,box);};
        for(let i=0;i<steps;i++){
          p.update(1/120,w,inp,5,{frozen:false});
          if(p.pos.z < box.minZ-0.6) {passed=true;break;}
          if(p.pos.y < -60) {died=true;break;}
        }
        p.onHit=old;
        return {passed, hit, died, z:+p.pos.z.toFixed(1), y:+p.pos.y.toFixed(1)};
      };
      const place=(box,back)=>{
        const cx=(box.minX+box.maxX)/2;
        const cands=w.boxes.filter(b=>b.kind==='platform'&&cx>b.minX&&cx<b.maxX&&box.minZ>b.minZ&&box.maxZ<b.maxZ);
        const plat=cands[0];
        const topY=plat?plat.topY:box.minY-1.12;
        p.pos.set(cx, topY+0.05, box.maxZ+back);
        p.vel.set(0,0,0); p.sliding=false; p.slideTimer=0; p.speed=13; p.jumpsLeft=2;
        p.grounded=true; p.invuln=0; p.height=1.56; p.hurtT=0; g.lives=3;
        p.alive = true;              // 前面的场景可能已经把角色玩死（alive=false 会跳过扣血判定）
        return topY;
      };
      const out={};
      const bars=w.boxes.filter(b=>b.kind==='bar');
      if(bars.length){
        place(bars[0],3.0); out.bar_stand = run(noInp,300,bars[0]);
        place(bars[0],3.0); out.bar_slide = run(setInp({slideHeld:true}),300,bars[0]);
      } else out.bar='世界里暂无横杆';
      // 跨栏：若当前赛道还没有，就现造一个，保证这条规则一定被覆盖
      let hurs=w.boxes.filter(b=>b.kind==='hurdle');
      if(!hurs.length){
        const plat=w.boxes.filter(b=>b.kind==='platform')[1]||w.boxes.filter(b=>b.kind==='platform')[0];
        const u=w.units.find(uu=>uu.boxes.indexOf(plat)>=0);
        if(plat&&u){
          const cx=(plat.minX+plat.maxX)/2;
          const z=plat.maxZ-9;
          const before=w.boxes.length;
          w.addHurdle(u, cx, plat.topY, z, 3.0, 0.9);
          hurs=w.boxes.slice(before);
        }
      }
      if(hurs.length){
        place(hurs[0],4.0); out.hurdle_walk = run(noInp,300,hurs[0]);
        place(hurs[0],4.0);
        // 起跳：先跑 0.35s，再按住跳跃
        (()=>{for(let i=0;i<42;i++)p.update(1/120,w,noInp,5,{frozen:false});})();
        out.hurdle_jump = run(setInp({jumpHeld:true,jumpPressed:true}),260,hurs[0]);
      } else out.hurdle='世界里暂无跨栏';
      const blks=w.boxes.filter(b=>b.kind==='block');
      if(blks.length){
        const b=blks[0]; const cx=(b.minX+b.maxX)/2;
        place(b,3.5); out.block_center = run(noInp,300,b);           // 直冲墩子：应撞上
        place(b,3.5); out.block_dodge = run(setInp({right:true}),300,b); // 侧移绕开：应通过
      } else out.block='世界里暂无方块障碍';
      out.counts={bar:bars.length,hurdle:hurs.length,block:blks.length,spinner:w.boxes.filter(b=>b.kind==='spinner').length};
      out.units=w.units.length; out.pressure=+g.world.pressure.toFixed(2);
      g.lives=savedLives; g.state=savedState;
      return JSON.stringify(out);
    })()`);
    console.log(r);
  }

  if (WANT('stall')) {
    console.log('\n== 卡顿诊断：重置 maxDt，观察 8 秒 ==');
    await evalJs('game.maxDt=0;');
    await sleep(8000);
    console.log('8 秒内最大帧间隔 = ' + (await evalJs('(game.maxDt||0).toFixed(3)')) + ' 秒；当前 fps=' + (await evalJs('game.fps.toFixed(1)')));
    await evalJs('game.maxDt=0;');
  }

  const finalErrs = await evalJs('JSON.stringify(window.__errs||[])');
  console.log('\n=== 控制台问题汇总 ===');
  console.log(finalErrs);
  try { (await connect()).ws; } catch (e) { /* ignore */ }
  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAIL:', e.message); process.exit(1); });

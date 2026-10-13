/* =========================================================================
 * 霓虹跑酷 NEON PARKOUR —— 20 排行榜
 * localStorage 持久化；首次进入会预置几位「街区 NPC」成绩，让榜单不空荡。
 * ========================================================================= */
(function (NP) {
  'use strict';

  const KEY_BOARD = 'neon-parkour.board.v1';
  const KEY_NAME = 'neon-parkour.player.v1';
  const KEY_PREF = 'neon-parkour.pref.v1';
  const MAX_SHOW = 10;
  const MAX_KEEP = 24;

  // 首次运行的默认榜单（NPC 机器人成绩，UI 中以 BOT 标记区分）
  const SEED = [
    { name: 'MIRA·7', score: 4820, distance: 3120, orbs: 170, combo: 8, ts: 0, npc: true },
    { name: 'ZED-01', score: 3960, distance: 2680, orbs: 128, combo: 7, ts: 0, npc: true },
    { name: 'NEKO', score: 3110, distance: 2140, orbs: 97, combo: 6, ts: 0, npc: true },
    { name: 'PIP', score: 2380, distance: 1690, orbs: 69, combo: 5, ts: 0, npc: true },
    { name: 'RUNE', score: 1640, distance: 1250, orbs: 39, combo: 4, ts: 0, npc: true }
  ];

  const memory = { board: null, name: '', pref: null };

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }

  const Board = {
    /* -------------------------------------------------- 成绩存取 */
    load() {
      const raw = safeGet(KEY_BOARD);
      let list = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        } catch (e) { list = null; }
      }
      if (!list) {
        list = SEED.map((e) => Object.assign({}, e));
        this.save(list);
      }
      return list;
    },

    save(list) {
      memory.board = list;
      safeSet(KEY_BOARD, JSON.stringify(list.slice(0, MAX_KEEP)));
    },

    top(n) {
      const list = this.load().slice().sort((a, b) => b.score - a.score);
      return list.slice(0, n || MAX_SHOW);
    },

    // 本机最高分：只统计玩家自己的成绩，NPC 内置成绩不算个人记录
    best() {
      const list = this.load().filter((e) => !e.npc);
      let m = 0;
      for (const e of list) if (e.score > m) m = e.score;
      return m;
    },

    // 是否够格进入榜单
    qualifies(score) {
      const list = this.load();
      const humans = list.filter((e) => !e.npc);
      if (humans.length < MAX_SHOW) return score > 0;
      const t = this.top(MAX_SHOW);
      return score > t[t.length - 1].score;
    },

    /* 提交成绩：返回 { rank, entry, isRecord } */
    add(entry) {
      const list = this.load();
      entry = Object.assign({ ts: Date.now(), npc: false }, entry);
      const prevBest = Math.max(0, ...list.filter((e) => !e.npc).map((e) => e.score));
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      const trimmed = list.slice(0, MAX_KEEP);
      this.save(trimmed);
      const idx = trimmed.indexOf(entry);
      this.setPlayerName(entry.name);
      return { rank: idx + 1, entry: entry, isRecord: entry.score > prevBest && prevBest > 0 };
    },

    clear() {
      this.save([]);
      memory.board = [];
      return [];
    },

    resetToSeed() {
      const list = SEED.map((e) => Object.assign({}, e));
      this.save(list);
      return list;
    },

    /* -------------------------------------------------- 玩家名 / 偏好 */
    getPlayerName() {
      const n = safeGet(KEY_NAME);
      return (n && n.trim()) || memory.name || '';
    },
    setPlayerName(n) {
      memory.name = n;
      safeSet(KEY_NAME, n);
    },

    getPrefs() {
      const raw = safeGet(KEY_PREF);
      if (raw) {
        try { return JSON.parse(raw); } catch (e) { /* ignore */ }
      }
      return memory.pref || { muted: false };
    },
    setPrefs(p) {
      memory.pref = p;
      safeSet(KEY_PREF, JSON.stringify(p));
    }
  };

  NP.Board = Board;
})(window.NP);

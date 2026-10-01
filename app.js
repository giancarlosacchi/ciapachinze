/* Ciapachinze — interfaccia, rete P2P e voce */
(() => {
'use strict';
const APP_VERSION = '202610011154';
const C = Cirulla;
const root_Arcade = () => (typeof Arcade !== 'undefined' ? Arcade : null);
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* =====================================================================
   Utility UI
   ===================================================================== */
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms);
}
function modal(html, { closable = true } = {}) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  if (closable) bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  $('#modals').appendChild(bg);
  bg.close = () => bg.remove();
  return bg;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = n => (n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/* =====================================================================
   Salvataggio robusto: localStorage + copia in IndexedDB (sopravvive meglio su iPhone/Android)
   ===================================================================== */
const Store = {
  keys: ['cpz-name', 'cpz-arcade', 'cpz-record', 'cpz-4col', 'cpz-sound', 'cpz-token', 'cpz-theme'],
  get(k) { try { return localStorage.getItem(k); } catch (e) { return this.mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} this.mem[k] = v; this.mirror(); },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} delete this.mem[k]; this.deleted.add(k); this.mirror(); },
  mem: {}, deleted: new Set(),
  db() {
    if (this._db) return this._db;
    this._db = new Promise((res) => {
      try {
        const r = indexedDB.open('ciapachinze', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return this._db;
  },
  async mirror() {
    const db = await this.db(); if (!db) return;
    try { const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'); for (const k of this.keys) { const v = this.get(k); if (v != null) st.put(v, k); else if (this.deleted.has(k)) st.delete(k); } this.deleted.clear(); } catch (e) {}
  },
  /* all'avvio: se localStorage è vuoto ma IndexedDB ha dati (o viceversa), riallinea */
  async restore() {
    const db = await this.db(); if (!db) return false;
    return new Promise(res => {
      try {
        const tx = db.transaction('kv', 'readonly'), st = tx.objectStore('kv'); let changed = false, pending = this.keys.length;
        for (const k of this.keys) {
          const rq = st.get(k);
          rq.onsuccess = () => { const v = rq.result; const cur = this.get(k); if (v != null && cur == null) { try { localStorage.setItem(k, v); } catch (e) {} this.mem[k] = v; changed = true; } if (--pending === 0) res(changed); };
          rq.onerror = () => { if (--pending === 0) res(changed); };
        }
      } catch (e) { res(false); }
    });
  },
  /* esporta/importa tutto (per cambiare telefono) */
  exportAll() { const o = {}; this.keys.forEach(k => { const v = this.get(k); if (v != null && k !== 'cpz-token') o[k] = v; }); return btoa(unescape(encodeURIComponent(JSON.stringify(o)))); },
  importAll(code) { try { const o = JSON.parse(decodeURIComponent(escape(atob(code.trim())))); Object.keys(o).forEach(k => { if (this.keys.includes(k)) this.set(k, o[k]); }); return true; } catch (e) { return false; } },
};
window.Store = Store;


/* =====================================================================
   Suoni (sintetizzati, nessun file)
   ===================================================================== */
const Sound = (() => {
  /* Suoni sintetizzati con cura: materiali (carta, panno), note con inviluppo morbido, riverbero leggero. */
  let ctx = null, master = null, verb = null, on = Store.get('cpz-sound') !== 'off';
  function ac() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = .9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    // riverbero a convoluzione con coda corta (0.7 s): dà aria senza allungare i suoni
    const len = Math.floor(ctx.sampleRate * .7), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * .5; }
    verb = ctx.createConvolver(); verb.buffer = buf; const vg = ctx.createGain(); vg.gain.value = .14;
    master.connect(comp).connect(ctx.destination); master.connect(verb).connect(vg).connect(comp);
    return ctx;
  }
  const now = () => ac().currentTime;
  function env(node, t0, a, d, s, r, peak = 1) { const g = node.gain; g.cancelScheduledValues(t0); g.setValueAtTime(0, t0); g.linearRampToValueAtTime(peak, t0 + a); g.exponentialRampToValueAtTime(Math.max(.0001, peak * s), t0 + a + d); g.exponentialRampToValueAtTime(.0001, t0 + a + d + r); }
  function note(freq, t0, { a = .01, d = .12, s = .3, r = .4, type = 'sine', vol = .2, detune = 0, lp = 6000 } = {}) {
    const a_ = ac(), o = a_.createOscillator(), g = a_.createGain(), f = a_.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune; f.type = 'lowpass'; f.frequency.value = lp;
    env(g, t0, a, d, s, r, vol); o.connect(f).connect(g).connect(master); o.start(t0); o.stop(t0 + a + d + r + .05);
  }
  // campanella morbida: fondamentale + armonica a 2.76x (campana) che decade più in fretta
  function bell(freq, t0, vol = .18, dur = .9) {
    note(freq, t0, { a: .004, d: dur * .6, s: .15, r: dur * .4, type: 'sine', vol });
    note(freq * 2.76, t0, { a: .002, d: dur * .25, s: .05, r: dur * .2, type: 'sine', vol: vol * .35 });
    note(freq * 1.005, t0, { a: .004, d: dur * .5, s: .1, r: dur * .3, type: 'triangle', vol: vol * .25, lp: 3000 });
  }
  function noise(t0, dur, { bp = 1800, q = .8, vol = .1, hp = 200 } = {}) {
    const a_ = ac(), b = a_.createBuffer(1, Math.ceil(a_.sampleRate * dur), a_.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = a_.createBufferSource(), g = a_.createGain(), f = a_.createBiquadFilter(), h = a_.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; h.type = 'highpass'; h.frequency.value = hp; src.buffer = b;
    env(g, t0, .003, dur * .4, .2, dur * .6, vol);
    src.connect(h).connect(f).connect(g).connect(master); src.start(t0);
  }
  // scintilla: sinusoide che sale di un'ottava in pochi ms, poi si spegne (il "ping" della scopa)
  function sparkle(f0, t0, vol = .16, dur = .32) {
    const a_ = ac(), o = a_.createOscillator(), g = a_.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 2, t0 + .05);
    env(g, t0, .003, dur * .5, .12, dur * .5, vol); o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + .05);
  }
  /* tutti brevi: con l'audio acceso non devono mai sovrapporsi in modo fastidioso */
  const SFX = {
    card() { const t = now(); noise(t, .05, { bp: 2600, q: .6, vol: .06 }); noise(t + .015, .035, { bp: 900, q: 1, vol: .045 }); },           // carta posata sul panno
    take() { const t = now(); noise(t, .04, { bp: 3000, q: .7, vol: .05 }); bell(1046, t + .005, .045, .18); },                               // presa: fruscio + tocco di campanella
    deal() { const t = now(); for (let i = 0; i < 4; i++) noise(t + i * .045, .035, { bp: 2400 + i * 150, q: .7, vol: .045 }); },             // distribuzione
    turn() { const t = now(); bell(1318, t, .06, .28); },                                                                                        // tocca a te
    scopa() { const t = now(); sparkle(1318, t, .14, .3); bell(2637, t + .06, .07, .3); noise(t, .025, { bp: 7000, q: .6, vol: .035, hp: 3000 }); }, // scopa: scintilla breve, diversa dalle carte
    buona() { const t = now(); note(110, t, { a: .004, d: .1, s: .1, r: .14, type: 'sine', vol: .45, lp: 400 }); noise(t, .03, { bp: 500, q: 1, vol: .22, hp: 80 }); bell(1760, t + .14, .06, .3); }, // un colpo sul tavolo + campanella
    win() { const t = now(); [659, 784, 1046, 1318].forEach((f, i) => bell(f, t + i * .07, .11, .5)); },
    lose() { const t = now(); [392, 349, 311].forEach((f, i) => note(f, t + i * .14, { a: .01, d: .12, s: .3, r: .2, type: 'triangle', vol: .1, lp: 1200 })); },
    ptt() { const t = now(); bell(1976, t, .045, .16); },
    tap() { const t = now(); noise(t, .02, { bp: 3500, q: 1, vol: .035 }); },
  };
  const play = name => { if (!on || !SFX[name]) return; try { if (ac().state === 'suspended') ac().resume(); SFX[name](); } catch (e) {} };
  return { play, get on() { return on; }, set on(v) { on = v; Store.set('cpz-sound', v ? 'on' : 'off'); } };
})();

/* =====================================================================
   Grafica carte (SVG)
   ===================================================================== */
const SUIT_PATH = {
  H: 'M10 18 C4 12 1 9 1 5.5 A4.5 4.5 0 0 1 10 4 A4.5 4.5 0 0 1 19 5.5 C19 9 16 12 10 18Z',
  D: 'M10 1 L18 10 L10 19 L2 10Z',
  C: 'M10 2 a4 4 0 0 1 3.2 6.4 a4 4 0 1 1 -2.4 6.1 L12 19 H8 L9.2 14.5 a4 4 0 1 1 -2.4 -6.1 A4 4 0 0 1 10 2Z',
  S: 'M10 1 C6 6 2 9 2 12.5 a4 4 0 0 0 6.8 2.9 L8 19 H12 L11.2 15.4 A4 4 0 0 0 18 12.5 C18 9 14 6 10 1Z',
};
const suitIcon = (s, x, y, size, col) => `<path d="${SUIT_PATH[s]}" fill="${col}" transform="translate(${x} ${y}) scale(${size / 20})"/>`;
const FONT_NUM = "'Nunito Sans', 'Arial Black', Arial, sans-serif";
const Record = {
  key: 'cpz-record',
  load() { try { return JSON.parse(Store.get(this.key) || '{}'); } catch (e) { return {}; } },
  save(r) { Store.set(this.key, JSON.stringify(r)); },
  norm: n => String(n || '').replace(/\s*\(pc\)/, '').trim().toLowerCase(),
  add(opponents, won) {
    const r = this.load(); const k = opponents.map(this.norm).sort().join(' & ');
    if (!k) return null;
    r[k] = r[k] || { name: opponents.map(n => String(n).replace(/\s*\(pc\)/, '')).join(' & '), w: 0, l: 0 };
    if (won) r[k].w++; else r[k].l++;
    this.save(r); return r[k];
  },
  get(opponents) { const r = this.load(); return r[opponents.map(this.norm).sort().join(' & ')] || null; },
};
const Settings = {
  get fourColor() { return Store.get('cpz-4col') === 'on'; },
  set fourColor(v) { Store.set('cpz-4col', v ? 'on' : 'off'); },
  get theme() { return Store.get('cpz-theme') || 'classico'; },
  set theme(v) { Store.set('cpz-theme', v); applyTheme(); },
};
function applyTheme() { document.documentElement.classList.toggle('theme-memphis', Settings.theme === 'memphis'); const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.setAttribute('content', Settings.theme === 'memphis' ? '#f6f1e4' : '#1c2230'); }
// colori dei semi: classici (rosso/nero) oppure a quattro colori come nei casinò (♥ rosso, ♦ blu, ♣ verde, ♠ nero)
function suitColor(s) {
  if (Settings.fourColor) return { H: '#1f5fbf', D: '#c8202f', C: '#1f8a3c', S: '#1b1a24' }[s];
  return (s === 'H' || s === 'D') ? '#c8202f' : '#1b1a24';
}
function cardSVG(id, mattaVal) {
  const r = C.rankOf(id), s = C.suitOf(id), lbl = C.RANK_LABEL[r];
  const col = suitColor(s);
  let center;
  if (r >= 8) {
    // figure: lettera grande e, sotto, il valore di presa in chiaro
    center = `<text x="44" y="74" text-anchor="middle" font-family="${FONT_NUM}" font-weight="900" font-size="60" fill="${col}">${lbl}</text>
      <rect x="22" y="84" width="44" height="22" rx="11" fill="${col}"/>
      <text x="44" y="100" text-anchor="middle" font-family="${FONT_NUM}" font-weight="900" font-size="16" fill="#fbf7ee">= ${r}</text>`;
  } else {
    center = `<text x="44" y="80" text-anchor="middle" font-family="${FONT_NUM}" font-weight="900" font-size="68" fill="${col}">${lbl}</text>
      ${suitIcon(s, 33, 88, 22, col)}`;
  }
  let badge = '';
  if (id === C.SETTEBELLO) badge = `<g transform="translate(62 8)"><circle cx="9" cy="9" r="9" fill="#d9a621"/><path d="M9 3.5 L10.6 7.2 L14.6 7.5 L11.5 10.1 L12.5 14 L9 11.9 L5.5 14 L6.5 10.1 L3.4 7.5 L7.4 7.2Z" fill="#1b1a24"/></g>`;
  if (id === C.MATTA && mattaVal) badge = `<g transform="translate(42 4)"><rect width="42" height="18" rx="9" fill="#7fa36c"/><text x="21" y="13" text-anchor="middle" font-family="${FONT_NUM}" font-weight="900" font-size="11" fill="#fff">vale ${mattaVal}</text></g>`;
  return `<svg viewBox="0 0 88 128" xmlns="http://www.w3.org/2000/svg" aria-label="${C.cardName(id)}">
    <text x="8" y="22" font-family="${FONT_NUM}" font-weight="900" font-size="19" fill="${col}">${lbl}</text>
    ${suitIcon(s, 7, 26, 13, col)}
    ${center}${badge}</svg>`;
}
function miniCard(id, extra = '') {
  const s = C.suitOf(id), col = suitColor(s);
  return `<div class="mini ${s === 'D' ? 'denari' : ''} ${extra}" style="color:${col}" title="${C.cardName(id)}">${C.RANK_LABEL[C.rankOf(id)]}<svg viewBox="0 0 20 20" width="10" height="10">${suitIcon(s, 0, 0, 20, col)}</svg></div>`;
}
const cardShort = id => `${C.RANK_LABEL[C.rankOf(id)]}${C.SUIT_SYMBOL[C.suitOf(id)]}`;

/* =====================================================================
   Stato applicazione
   ===================================================================== */
const App = {
  mode: null,           // 'host' | 'guest' | 'solo'
  myName: '',
  mySeat: null,
  code: null,
  cfg: { players: 2, target: 51 },
  peer: null, hostConn: null,
  roster: [],           // [{seat, name, online, peerId, bot}]
  view: null,           // ultima vista ricevuta
  seenEventId: 0,
};
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
] };
const token = (() => { let t = Store.get('cpz-token'); if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); Store.set('cpz-token', t); } return t; })();
const genCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };

function showScreen(id) {
  $$('.screen').forEach(s => { s.classList.toggle('off', s.id !== id); s.classList.remove('enter'); if (s.id === id) s.scrollTop = 0; });
  $('#game').classList.toggle('hidden', id !== 'game'); $('#game').classList.remove('enter');
  if (showScreen.first) { showScreen.first = false; return; }
  const el = id === 'game' ? $('#game') : $('#' + id); if (el) { void el.offsetWidth; el.classList.add('enter'); }
}
showScreen.first = true;

/* =====================================================================
   HOST: gestisce stato, connessioni, bot
   ===================================================================== */
const Host = {
  game: null, players: [], conns: new Map(), started: false,
  init(cfg, name, solo) {
    this.players = []; this.conns = new Map(); this.started = false; this.game = null;
    this.cfg = cfg; this.arcade = cfg.arcade || null;
    this.addPlayer({ name, token, peerId: null, online: true, bot: false, local: true });
    if (solo) {
      const names = cfg.botNames || ['Bacci', 'Rina', 'Tugnin'];
      for (let i = 1; i < cfg.players; i++) this.addPlayer({ name: names[i - 1] + (cfg.arcade ? '' : ' (pc)'), token: 'bot' + i, peerId: null, online: true, bot: true, level: cfg.botLevel != null ? cfg.botLevel : 1 });
    }
  },
  addPlayer(p, seat) {
    if (seat == null) { seat = 0; while (this.players.some(x => x.seat === seat)) seat++; }
    p.seat = seat; this.players.push(p); this.players.sort((a, b) => a.seat - b.seat); return p;
  },
  isLocal(seat) { const p = this.players.find(x => x.seat === seat); return !!(p && p.local); },
  removeBot(seat) { const i = this.players.findIndex(p => p.seat === seat && p.bot); if (i >= 0) { this.players.splice(i, 1); this.broadcastLobby(); } },
  addBot(seat) {
    if (this.started || seat < 0 || seat >= this.cfg.players || this.players.some(p => p.seat === seat)) return;
    const used = new Set(this.players.map(p => p.name));
    const name = ['Bacci', 'Rina', 'Tugnin', 'Ciccio'].map(n => n + ' (pc)').find(n => !used.has(n)) || 'Pc (pc)';
    this.addPlayer({ name, token: 'bot' + seat + Date.now(), peerId: null, online: true, bot: true }, seat);
    this.broadcastLobby();
  },
  roster() { return this.players.map(p => ({ seat: p.seat, name: p.name, online: p.online, peerId: p.peerId, bot: p.bot })); },
  teamName(t) { return this.players.filter(p => C.teamOf(this.game, p.seat) === t).map(p => p.name.replace(/ \(pc\)/, '')).join(' & '); },
  onConnection(conn) {
    conn.on('data', msg => this.onData(conn, msg));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  },
  onData(conn, msg) {
    if (msg.t === 'hello') {
      let p = this.players.find(x => x.token === msg.token);
      if (p) { p.online = true; p.peerId = conn.peer; p.name = msg.name || p.name; }
      else if (this.players.length < this.cfg.players && !this.started) p = this.addPlayer({ name: msg.name || 'Ospite', token: msg.token, peerId: conn.peer, online: true, bot: false });
      else if (!this.started && this.players.some(x => x.bot)) { const bot = this.players.find(x => x.bot); this.players.splice(this.players.indexOf(bot), 1); p = this.addPlayer({ name: msg.name || 'Ospite', token: msg.token, peerId: conn.peer, online: true, bot: false }, bot.seat); }
      else { conn.send({ t: 'full' }); return; }
      this.conns.set(p.seat, conn); conn.seat = p.seat;
      conn.send({ t: 'welcome', seat: p.seat, cfg: this.cfg, code: App.code });
      this.broadcastLobby();
      if (this.started) this.pushViews();
      toast(`${p.name} si è seduto al tavolo`);
      return;
    }
    const seat = conn.seat; if (seat == null) return;
    this.handleAction(seat, msg);
  },
  onClose(conn) {
    const p = this.players.find(x => x.seat === conn.seat);
    if (p) { p.online = false; this.conns.delete(p.seat); this.broadcastLobby(); toast(`${p.name} si è disconnesso: può rientrare con lo stesso codice`); if (this.started) this.pushViews(); }
  },
  handleAction(seat, msg) {
    const g = this.game;
    switch (msg.t) {
      case 'play': {
        if (!g) return;
        const r = C.play(g, seat, msg.card, msg.idx);
        if (!r.ok) { this.sendTo(seat, { t: 'err', msg: r.error }); return; }
        this.pushViews(); this.afterMove(); break;
      }
      case 'buona': {
        if (!g) return;
        const r = C.declareBuona(g, seat, msg.i);
        if (!r.ok) { this.sendTo(seat, { t: 'err', msg: r.error }); return; }
        this.pushViews(); this.afterMove(); break;
      }
      case 'next': if (g && g.phase === 'dealEnd') { C.startDeal(g); this.pushViews(); this.afterMove(); } break;
      case 'again': if (g && g.phase === 'gameEnd') { this.startGame(); } break;
      case 'chat': this.broadcast({ t: 'chat', seat, text: String(msg.text).slice(0, 200) }); break;
      case 'ptt': this.broadcast({ t: 'ptt', seat, on: !!msg.on }); break;
      case 'call-invite': case 'call-accept': case 'call-decline': case 'call-end': this.broadcast({ t: msg.t, seat }); break;
      case 'swap': if (this.isLocal(seat) && !this.started) this.swapSeats(msg.a, msg.b); break;
      case 'addbot': if (this.isLocal(seat)) this.addBot(msg.seat); break;
      case 'rmbot': if (this.isLocal(seat) && !this.started) this.removeBot(msg.seat); break;
    }
  },
  swapSeats(a, b) {
    if (a === b || a < 0 || b < 0 || a >= this.cfg.players || b >= this.cfg.players) return;
    const pa = this.players.find(p => p.seat === a), pb = this.players.find(p => p.seat === b);
    if (!pa && !pb) return;
    if (pa) pa.seat = b; if (pb) pb.seat = a;
    this.players.sort((x, y) => x.seat - y.seat);
    const ca = this.conns.get(a), cb = this.conns.get(b);
    this.conns.delete(a); this.conns.delete(b);
    if (ca) { this.conns.set(b, ca); ca.seat = b; } if (cb) { this.conns.set(a, cb); cb.seat = a; }
    this.players.forEach(p => { if (!p.local && !p.bot) this.sendTo(p.seat, { t: 'welcome', seat: p.seat, cfg: this.cfg, code: App.code }); });
    App.mySeat = this.players.find(p => p.local).seat;
    this.broadcastLobby();
  },
  sendTo(seat, msg) {
    const p = this.players.find(x => x.seat === seat); if (!p) return;
    if (p.local) Client.receive(JSON.parse(JSON.stringify(msg)));
    else if (p.bot) return;
    else { const c = this.conns.get(seat); if (c && c.open) c.send(msg); }
  },
  broadcast(msg) { this.players.forEach(p => this.sendTo(p.seat, msg)); },
  broadcastLobby() { this.broadcast({ t: 'lobby', roster: this.roster(), cfg: this.cfg, started: this.started }); },
  pushViews() {
    const g = this.game; if (!g) return;
    this.players.forEach(p => { if (!p.bot) this.sendTo(p.seat, { t: 'view', view: C.viewFor(g, p.seat), roster: this.roster() }); });
  },
  startGame() {
    // riempi con il computer i posti rimasti vuoti
    for (let i = 0; i < this.cfg.players; i++) if (!this.players.some(p => p.seat === i)) this.addBot(i);
    const names = []; for (let i = 0; i < this.cfg.players; i++) names[i] = (this.players.find(p => p.seat === i) || {}).name || 'Pc';
    this.game = C.newGame({ players: this.cfg.players, target: this.cfg.target, names });
    if (this.arcade && this.arcade.handicap) this.game.scores[1] = this.arcade.handicap;
    this.started = true;
    C.startDeal(this.game);
    this.broadcastLobby();
    this.pushViews();
    this.afterMove();
  },
  afterMove() {
    const g = this.game; if (!g) return;
    if (g.phase === 'play') {
      const seat = g.pendingBuona ? g.pendingBuona.seat : g.turn;
      const p = this.players.find(x => x.seat === seat);
      if (p && p.bot) { clearTimeout(this.botTimer); this.botTimer = setTimeout(() => this.botMove(seat), g.pendingBuona ? 700 : 1100 + Math.random() * 600); }
    }
  },
  botMove(seat) {
    const g = this.game; if (!g || g.phase !== 'play') return;
    if (g.pendingBuona && g.pendingBuona.seat === seat) {
      const opts = g.pendingBuona.options; let best = 0;
      opts.forEach((o, i) => { if (o.points > opts[best].points) best = i; });
      C.declareBuona(g, seat, best); this.pushViews(); this.afterMove(); return;
    }
    if (g.turn !== seat) return;
    const hand = g.hands[seat];
    const pl = this.players.find(p => p.seat === seat);
    const level = pl && pl.level != null ? pl.level : 1;
    if (root_Arcade()) {
      const mv = root_Arcade().chooseMove(g, seat, level, Math.random);
      if (mv) { const r = C.play(g, seat, mv.card, mv.idx); if (r.ok) { this.pushViews(); this.afterMove(); return; } }
    }
    let best = null;
    for (const card of hand) {
      const opts = C.optionsFor(g, seat, card);
      if (!opts.length) {
        // valuta il rischio di lasciare la carta: preferisci non lasciare somme facili
        const v = C.playValue(g, card);
        const tableSum = g.table.reduce((a, x) => a + x.val, 0) + v;
        let score = -1 - (card === C.SETTEBELLO ? 8 : 0) - (C.suitOf(card) === 'D' ? 1.5 : 0) - (v === 1 ? 3 : 0);
        if (tableSum === 15 || tableSum <= 10) score -= 2;
        if (!best || score > best.score) best = { card, idx: null, score };
        continue;
      }
      for (const o of opts) {
        const taken = o.idx.map(i => g.table[i].id);
        let score = taken.length + 1;
        score += taken.concat(card).filter(c => C.suitOf(c) === 'D').length * 2;
        if (taken.includes(C.SETTEBELLO) || card === C.SETTEBELLO) score += 8;
        if (o.scopa && g.cardsPlayed < 35) score += 6;
        score += taken.concat(card).reduce((a, c) => a + C.PRIMIERA[C.rankOf(c)], 0) / 20;
        if (!best || score > best.score) best = { card, idx: o.idx, score };
      }
    }
    const r = C.play(g, seat, best.card, best.idx);
    if (!r.ok) { console.warn('bot', r); const c = hand[0]; const o = C.optionsFor(g, seat, c); C.play(g, seat, c, o.length ? o[0].idx : null); }
    this.pushViews(); this.afterMove();
  },
};

/* =====================================================================
   CLIENT: riceve viste, disegna, invia azioni
   ===================================================================== */
const Client = {
  send(msg) {
    if (App.mode === 'guest') { if (App.hostConn && App.hostConn.open) App.hostConn.send(msg); else toast('Connessione al tavolo persa'); }
    else Host.handleAction(App.mySeat, msg);
  },
  receive(msg) {
    switch (msg.t) {
      case 'welcome': App.mySeat = msg.seat; App.cfg = msg.cfg; App.code = msg.code; App.rotateSkipped = false; updateOrientation(); break;
      case 'lobby': App.roster = msg.roster; App.cfg = msg.cfg; if (!msg.started) { showScreen('scr-lobby'); renderLobby(); } else renderPlayers(); Voice.rosterChanged(); break;
      case 'view': onView(msg.view, msg.roster); break;
      case 'err': toast(msg.msg); Stage.locked = false; Stage.clearSelection(); if (App.view) Stage.render(App.view); break;
      case 'full': toast('Il tavolo è pieno'); break;
      case 'chat': Side.addChat(msg.seat, msg.text); break;
      case 'ptt': Voice.remotePtt(msg.seat, msg.on); break;
      case 'call-invite': Voice.onInvite(msg.seat); break;
      case 'call-accept': Voice.onAccept(msg.seat); break;
      case 'call-decline': Voice.onDecline(msg.seat); break;
      case 'call-end': Voice.onEnd(msg.seat); break;
      case 'stage-result': if (App.mode === 'guest') { $$('#modals .modal-bg').forEach(x => x.remove()); const m = modal(`<h2>${msg.stars ? 'Tappa superata!' : 'Tappa fallita'}<small>${esc(msg.town)} · ${esc(msg.who)}</small></h2><div class="stars-big">${'★'.repeat(msg.stars)}<span class="off">${'★'.repeat(3 - msg.stars)}</span></div><p style="text-align:center">${msg.stars ? 'Obiettivo centrato: ' : 'Obiettivo mancato: '}${esc(msg.goal)}. Il tuo compagno sceglie la prossima tappa.</p><div class="actions"><button class="btn" onclick="this.closest('.modal-bg').remove()">Ok</button></div>`); m.querySelector('.modal').classList.add(msg.stars ? 'won' : 'lost'); if (msg.stars) Stage.sparks(); } break;
      case 'bye': toast('Il tavolo è stato chiuso'); Session.clear(); location.hash = ''; setTimeout(() => location.reload(), 1500); break;
    }
  },
};

/* =====================================================================
   Rete PeerJS
   ===================================================================== */
function makePeer(id) {
  const p = new Peer(id, { config: ICE, debug: 1 });
  return p;
}
const Session = {
  save() { try { if ((App.mode === 'host' || App.mode === 'guest') && !App.arcade) localStorage.setItem('cpz-session', JSON.stringify({ mode: App.mode, code: App.code, name: App.myName, cfg: App.cfg, at: Date.now() })); } catch (e) {} },
  load() { try { const s = JSON.parse(localStorage.getItem('cpz-session') || 'null'); return s && Date.now() - s.at < 6 * 3600e3 ? s : null; } catch (e) { return null; } },
  clear() { try { localStorage.removeItem('cpz-session'); } catch (e) {} },
};
async function hostRoom(cfg, name, solo, reuseCode) {
  App.mode = solo ? 'solo' : 'host'; App.myName = name; App.mySeat = 0; App.cfg = cfg; App.rotateSkipped = false; App.pendingStart = false; setTimeout(updateOrientation, 0);
  Host.init(cfg, name, solo);
  if (solo) {
    App.code = 'LOCALE'; App.roster = Host.roster();
    // nel 2 contro 2 sul telefono in verticale: aspetta che il telefono sia girato (o che si scelga di restare in verticale) prima di dare le carte
    const portraitPhone = window.innerWidth < 640 && window.innerWidth <= window.innerHeight;
    if (cfg.players === 4 && portraitPhone) { App.pendingStart = true; updateOrientation(); return; }
    Host.startGame(); return;
  }
  App.code = reuseCode || genCode();
  $('#lobby-code').textContent = App.code;
  $('#lobby-status').textContent = 'Connessione al servizio…';
  showScreen('scr-lobby');
  App.peer = makePeer('cpz-' + App.code);
  App.peer.on('open', () => { $('#lobby-status').textContent = ''; App.roster = Host.roster(); renderLobby(); Voice.attachPeer(App.peer); Session.save(); });
  App.peer.on('connection', conn => Host.onConnection(conn));
  App.peer.on('error', e => {
    if (e.type === 'unavailable-id') { App.code = genCode(); $('#lobby-code').textContent = App.code; App.peer.destroy(); hostRoom(cfg, name); }
    else if (e.type === 'peer-unavailable') { /* ignora */ }
    else { $('#lobby-status').textContent = 'Errore di rete: ' + e.type; }
  });
  App.peer.on('disconnected', () => { try { App.peer.reconnect(); } catch (e) {} });
  App.roster = Host.roster(); renderLobby();
  history.replaceState(null, '', '#' + App.code);
}
function joinRoom(code, name) {
  App.mode = 'guest'; App.myName = name; App.code = code;
  const st = $('#join-status'); st.textContent = 'Mi collego al tavolo…';
  App.peer = makePeer(undefined);
  App.peer.on('open', () => {
    Voice.attachPeer(App.peer);
    connectToHost();
  });
  App.peer.on('error', e => { if (e.type === 'peer-unavailable') { st.textContent = 'Tavolo non trovato: controlla il codice.'; } else st.textContent = 'Errore: ' + e.type; });
  App.peer.on('disconnected', () => { try { App.peer.reconnect(); } catch (e) {} });
  let tries = 0;
  function connectToHost() {
    const conn = App.peer.connect('cpz-' + code, { reliable: true, metadata: { name } });
    App.hostConn = conn;
    conn.on('open', () => { tries = 0; st.textContent = ''; conn.send({ t: 'hello', name, token }); $('#lobby-code').textContent = code; history.replaceState(null, '', '#' + code); Session.save(); });
    conn.on('data', msg => Client.receive(msg));
    conn.on('close', () => { toast('Connessione persa, riprovo…'); if (tries++ < 20) setTimeout(connectToHost, 1500 + tries * 500); else toast('Impossibile ricollegarsi: riapri il link del tavolo'); });
    conn.on('error', () => {});
  }
}

/* =====================================================================
   Lobby
   ===================================================================== */
function renderLobby() {
  const n = App.cfg.players; const seats = $('#seats'); seats.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const p = App.roster.find(x => x.seat === i);
    const team = n === 4 ? (i % 2) : i;
    const d = document.createElement('div'); d.className = `seat team${team} ${p ? 'full' : ''}`;
    d.innerHTML = p ? `<div class="avatar">${initials(p.name)}</div><div class="who">${esc(p.name)}${p.seat === App.mySeat ? ' (tu)' : ''} ${p.online ? '' : '<span class="offline">· offline</span>'}<div class="team">${n === 4 ? (team === 0 ? 'Coppia oro' : 'Coppia blu') : ''} ${i === 0 ? '· ospite del tavolo' : ''}</div></div>`
      : `<div class="avatar" style="background:rgba(255,255,255,.1);color:var(--testo-2)">?</div><div class="who" style="color:var(--testo-2);font-weight:400">Posto libero — condividi il codice</div>`;
    if (App.mode === 'host' && !Host.started) {
      if (!p && !(App.arcade)) {
        const b = document.createElement('button'); b.className = 'btn sm oro'; b.textContent = '+ computer'; b.title = 'Fai giocare il computer in questo posto';
        b.onclick = () => Host.addBot(i); d.appendChild(b);
      } else if (p && p.bot && !App.arcade) {
        const b = document.createElement('button'); b.className = 'btn sm ghost'; b.textContent = '✕'; b.title = 'Togli il computer';
        b.onclick = () => Host.removeBot(i); d.appendChild(b);
      }
      if (n === 4 && p && !p.bot && p.seat !== App.mySeat && !App.arcade) {
        const withMe = (i % 2) === (App.mySeat % 2);
        const b = document.createElement('button'); b.className = 'pairbtn ' + (withMe ? 'mine' : 'theirs');
        b.innerHTML = withMe ? '<span class="dot"></span>Con me' : '<span class="dot"></span>Contro';
        b.title = withMe ? 'Ora gioca in coppia con te: tocca per metterlo contro' : 'Ora gioca contro di te: tocca per metterlo in coppia con te';
        // scambia con il posto dell'altra coppia più vicino
        const otherPair = [0, 1, 2, 3].filter(k => (k % 2) !== (App.mySeat % 2)), myPair = [0, 1, 2, 3].filter(k => (k % 2) === (App.mySeat % 2) && k !== App.mySeat);
        const target = withMe ? otherPair[0] : myPair[0];
        b.onclick = () => Host.swapSeats(i, target);
        d.appendChild(b);
      }
    }
    seats.appendChild(d);
  }
  const opp = App.roster.filter(p => p.seat !== App.mySeat && (n === 2 || (p.seat % 2) !== (App.mySeat % 2))).map(p => p.name);
  const rec = opp.length ? Record.get(opp) : null;
  $('#lobby-record').textContent = rec ? `Precedenti con ${rec.name}: ${rec.w} vinte · ${rec.l} perse` : '';
  const humans = App.roster.filter(p => !p.bot);
  const full = App.roster.length >= n && App.roster.every(p => p.online);
  const coop = !!(App.arcade && App.mode === 'host');
  const canStart = App.mode === 'host' && App.roster.every(p => p.online) && (full || (humans.length >= 1 && !coop));
  $('#btn-start').disabled = !canStart;
  $('#btn-start').textContent = coop ? (full ? 'Inizia la tappa' : 'Aspetta il tuo compagno') : full ? 'Inizia la partita' : 'Inizia (il computer prende i posti liberi)';
  $('#btn-start').classList.toggle('hidden', App.mode !== 'host');
  if (App.arcade && ArcadeUI.stage) $('#lobby-info').textContent = `Arcade a coppie · ${ArcadeUI.stage.town}: ${Arcade.goalText(ArcadeUI.stage.goal)}. Invita un amico con il link: sarà il tuo compagno.`;
  else $('#lobby-info').textContent = n === 4 ? 'A coppie: i posti 1 e 3 giocano insieme (oro), 2 e 4 insieme (blu). Con "Con me / Contro" sposti un amico di coppia; i posti vuoti li può prendere il computer.' : 'Uno contro uno, si vince a ' + App.cfg.target + '. Se non arriva nessuno puoi far giocare il computer.';
  const missing = n - App.roster.length;
  $('#lobby-status').textContent = App.mode === 'host' ? (full ? 'Tutti al tavolo: puoi iniziare.' : `${missing} post${missing === 1 ? 'o libero' : 'i liberi'}: aspetta gli amici o aggiungi il computer.`) : 'In attesa che l\'ospite inizi la partita…';
}

/* =====================================================================
   Vista di gioco → animazioni ed eventi
   ===================================================================== */
const queue = [];
let processing = false;
function onView(view, roster) {
  App.roster = roster || App.roster;
  const first = !App.view;
  if (view.eventId < App.seenEventId) App.seenEventId = 0;   // nuova partita
  let newEvents = first ? [] : (view.events || []).filter(e => e.id > App.seenEventId);
  if (first && view.cardsPlayed === 0 && view.phase === 'play') {
    // appena seduti: rigioca la distribuzione, così le carte arrivano dal mazzo
    const evs = view.events || []; let k = evs.length - 1;
    while (k > 0 && evs[k].type !== 'deal') k--;
    if (k >= 0 && evs[k].type === 'deal') newEvents = evs.slice(k);
  }
  App.seenEventId = view.eventId;
  queue.push({ view, events: newEvents });
  if (!processing) processQueue();
}
async function processQueue() {
  processing = true;
  if ($('#game').classList.contains('hidden')) { showScreen('game'); Stage.init(); }
  $('#game').classList.toggle('novoice', App.mode === 'solo');
  updateOrientation();
  while (queue.length) {
    const { view, events } = queue.shift();
    // lo stato di riferimento per la simulazione: l'ultima vista
    const sim = App.view ? JSON.parse(JSON.stringify(App.view)) : (events.length ? Object.assign(JSON.parse(JSON.stringify(view)), { table: [], hands: view.hands.map(() => []), captured: [[], []], scope: [0, 0], scopeCards: [[], []] }) : null);
    if (!App.view && events.length) { App.view = sim; Stage.render(sim); }
    for (const ev of events) { try { await Stage.animateEvent(ev, sim, view); } catch (e) { console.error('animazione', ev.type, e); } }
    App.view = view;
    Stage.render(view);
    renderTop(view); renderPlayers(view); Side.refresh();
    if (App.arcade) ArcadeUI.goalbar(); else { const gb = $('#goalbar'); if (gb) gb.classList.add('hidden'); }
    if (view.phase === 'dealEnd' || view.phase === 'gameEnd') { await sleep(400); showDealEnd(view); }
    if (view.pendingBuona && view.pendingBuona.options) showBuonaChoice(view.pendingBuona);
    if (view.phase === 'play' && view.turn === App.mySeat && !view.pendingBuona) Sound.play('turn');
  }
  processing = false;
}

function renderTop(view) {
  const myTeam = C.teamOf(view, App.mySeat);
  const nm = t => view.cfg.players === 4 ? (t === myTeam ? 'Noi' : 'Loro') : (t === myTeam ? 'Tu' : (view.names[view.teams[t][0]] || 'Loro').split(' ')[0]);
  $('#sc-n0').textContent = nm(myTeam); $('#sc-0').textContent = view.scores[myTeam];
  $('#sc-n1').textContent = nm(1 - myTeam); $('#sc-1').textContent = view.scores[1 - myTeam];
  $('#sc-target').textContent = 'a ' + view.cfg.target;
  $('.score.t0').classList.toggle('t0', true);
}

/* =====================================================================
   STAGE: posizionamento e animazione delle carte
   ===================================================================== */
const Stage = {
  el: null, wrap: null, nodes: new Map(), W: 0, H: 0, playerEls: new Map(), selected: null, hover: null, inited: false,
  init() {
    if (this.inited) return; this.inited = true;
    this.el = $('#stage'); this.wrap = $('#stage-wrap');
    const deck = document.createElement('div'); deck.className = 'deck'; deck.id = 'deck';
    deck.innerHTML = '<div class="layer" style="transform:translate(4px,4px)"></div><div class="layer" style="transform:translate(2px,2px)"></div><div class="layer"></div><div class="count"></div>';
    this.el.appendChild(deck);
    for (let t = 0; t < 2; t++) {
      const p = document.createElement('div'); p.className = 'pile'; p.id = 'pile' + t; p.innerHTML = `<div class="layer l3"></div><div class="layer l2"></div><div class="layer l1"></div><span class="lbl"></span><span class="cnt"></span>`;
      this.el.appendChild(p);
    }
    new ResizeObserver(() => { this.measure(); if (App.view) { this.render(App.view); renderPlayers(App.view); } }).observe(this.wrap);
    this.measure();
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.selected) this.clearSelection(); });
  },
  measure() { const r = this.wrap.getBoundingClientRect(); this.W = r.width; this.H = r.height; },
  cw() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')); },
  ch() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-h')); },
  rel(seat, view) { const n = view.cfg.players; return (seat - App.mySeat + n) % n; },
  /* posizione dei posti relativi: 0 = io (basso), 4p: 1 destra, 2 alto, 3 sinistra; 2p: 1 alto */
  // "mobile" = telefono in verticale. In orizzontale (2 vs 2) si usa la disposizione a quattro lati.
  get mobile() { return this.W < 640 && this.W <= this.H; },
  get landscape() { return this.W > this.H && this.H < 520; },
  seatAnchor(rel, view) {
    const n = view.cfg.players, W = this.W, H = this.H, cw = this.cw(), ch = this.ch();
    if (this.mobile) {
      // smartphone: la mia mano in basso, tutti gli avversari in alto (sinistra / centro / destra)
      if (rel === 0) return { x: W / 2 + 8, y: H - ch / 2 - 10, rot: 0, dir: 'h' };
      const top = ch / 2 + 40;
      if (n === 2 || rel === 2) return { x: W / 2, y: top, rot: 0, dir: 'h', compact: true };
      if (rel === 1) return { x: W - cw * .85 - 10, y: top, rot: -12, dir: 'h', compact: true };
      return { x: cw * .85 + 10, y: top, rot: 12, dir: 'h', compact: true };
    }
    const L = this.landscape;
    if (rel === 0) return { x: W / 2, y: H - ch / 2 - (L ? 20 : 18), rot: 0, dir: 'h' };
    if (n === 2 || rel === 2) return { x: W / 2, y: ch / 2 + (L ? 6 : 22), rot: 0, dir: 'h' };
    if (rel === 1) return { x: W - ch / 2 - (L ? 10 : 16), y: H / 2 - (L ? 14 : 0), rot: -90, dir: 'v' };
    return { x: ch / 2 + (L ? 10 : 16), y: H / 2 - (L ? 14 : 0), rot: 90, dir: 'v' };
  },
  deckPos() {
    const cw = this.cw(), ch = this.ch(); const n = App.view ? App.view.cfg.players : 2;
    if (this.mobile) return { x: 10, y: 10, scale: .55 };
    if (this.landscape) return { x: 12, y: 10, scale: .62 };
    return n === 4 ? { x: 26, y: 80 } : { x: 34, y: this.H / 2 - ch / 2 };
  },
  pileScale() { return this.mobile ? .58 : this.landscape ? .8 : 1; },
  pilePos(team, view) {
    const my = C.teamOf(view, App.mySeat), cw = this.cw(), ch = this.ch(), k = this.pileScale();
    // il mazzetto sta sempre alla sinistra di chi ha preso: il mio in basso a sinistra, il loro a destra delle loro carte
    if (this.mobile) {
      const top = this.seatAnchor(view.cfg.players === 4 ? 1 : 1, view);
      return team === my ? { x: 6, y: this.H - ch * k - ch * 1.9 } : { x: this.W - cw * k - 30, y: view.cfg.players === 4 ? top.y + ch * .6 + 30 : top.y - ch * k / 2 + 6 };
    }
    if (this.landscape) return team === my ? { x: 14, y: this.H - ch * k - 20 } : { x: this.W - cw * k - 14, y: 10 };
    return team === my ? { x: 26 + (ch - cw) / 2, y: this.H - ch - 30 } : { x: this.W - cw - 26 - (ch - cw) / 2, y: 70 };
  },
  tableSlots(count) {
    const cw = this.cw(), ch = this.ch(), gap = 14;
    const maxCols = Math.max(2, Math.floor((this.W * (App.view && App.view.cfg.players === 4 ? .5 : .62)) / (cw + gap)));
    const cols = Math.min(count, maxCols), rows = Math.ceil(count / cols) || 1;
    const out = []; const totalH = rows * ch + (rows - 1) * gap;
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols), inRow = Math.min(cols, count - r * cols), c = i % cols;
      const totalW = inRow * cw + (inRow - 1) * gap;
      out.push({ x: this.W / 2 - totalW / 2 + c * (cw + gap), y: this.H / 2 - (this.mobile ? 30 : 16) - totalH / 2 + r * (ch + gap) });
    }
    return out;
  },
  handSlots(rel, count, view) {
    const a = this.seatAnchor(rel, view), cw = this.cw(), ch = this.ch();
    const spread = rel === 0 ? (this.mobile ? cw * 1.08 : cw * 1.12) : (a.compact ? cw * 0.28 : cw * 0.55);
    const out = [];
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spread;
      const fan = rel === 0 ? (i - (count - 1) / 2) * 5 : 0;
      if (a.dir === 'h') out.push({ x: a.x + off - cw / 2, y: a.y - ch / 2 + (rel === 0 ? Math.abs(i - (count - 1) / 2) * 4 : 0), rot: a.rot + fan });
      else out.push({ x: a.x - cw / 2, y: a.y + off - ch / 2, rot: a.rot });
    }
    return out;
  },
  /* piccolo disordine stabile per ogni carta: posate a mano, non da computer */
  jitter(id, k = 1) {
    let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const r1 = ((h & 0xff) / 255 - .5), r2 = (((h >> 8) & 0xff) / 255 - .5), r3 = (((h >> 16) & 0xff) / 255 - .5);
    return { dx: r1 * 12 * k, dy: r2 * 10 * k, rot: r3 * 9 * k };
  },
  /** costruisce il layout completo da una vista */
  layout(view, opts = {}) {
    if (this.reviewing) return this.reviewLayout(view);
    const items = []; const n = view.cfg.players;
    // mani
    for (let s = 0; s < n; s++) {
      const rel = this.rel(s, view), hand = view.hands[s] || [];
      const slots = this.handSlots(rel, hand.length, view);
      hand.forEach((id, i) => {
        const key = id || `h:${s}:${i}`;
        const it = { key, id, face: !!id, ...slots[i], z: 10 + i, hand: s, hi: i };
        if (s === App.mySeat && id === this.selected) {
          it.z = 40;
          if (this.floating) { const ts = this.tableSlots(Math.max(1, view.table.length)); it.x = this.W / 2 - this.cw() / 2; it.y = ts[ts.length - 1].y + this.ch() * .55; it.rot = 0; }
          else { it.y -= 28; it.rot = 0; }
        }
        items.push(it);
      });
    }
    // tavolo
    const slots = this.tableSlots(view.table.length);
    view.table.forEach((t, i) => { const j = this.jitter(t.id); items.push({ key: t.id, id: t.id, face: true, x: slots[i].x + j.dx, y: slots[i].y + j.dy, rot: j.rot, z: 5, table: i, val: t.val }); });
    // scope segnate sui mazzetti
    for (let t = 0; t < 2; t++) {
      const pp = this.pilePos(t, view), k = this.pileScale(), cw = this.cw(), ch = this.ch();
      // le scope spuntano da sotto il mazzetto: si vede solo un angolo
      // le scope spuntano verso l'alto, ben strette: anche con molte scope non escono dall'angolo del mazzetto
      // le scope spuntano da sotto: verso l'interno del campo per il mazzetto avversario, mai oltre il bordo
      const theirs = t !== C.teamOf(view, App.mySeat);
      (view.scopeCards[t] || []).forEach((id, i) => items.push({ key: 'sc:' + id, id, face: true, x: pp.x + (theirs ? -cw * k * .14 - Math.min(i, 8) * 1.2 : cw * k * .12 + Math.min(i, 8) * 1.2), y: pp.y - ch * k * .16 - Math.min(i, 8) * 2.2, rot: theirs ? -6 - (i % 3) * 2 : 6 + (i % 3) * 2, z: 1, scale: k, scopa: true }));
    }
    return items;
  },
  /* tutte le carte prese, stese sul campo: le nostre in basso, le loro in alto */
  reviewLayout(view) {
    const my = C.teamOf(view, App.mySeat), cw = this.cw(), ch = this.ch();
    const order = c => C.SUITS.indexOf(C.suitOf(c)) * 10 + C.rankOf(c);
    const items = [];
    const spread = (cards, top, bottom, team) => {
      const sorted = cards.slice().sort((a, b) => order(a) - order(b));
      const avail = this.W - 24, cols = Math.max(1, Math.min(sorted.length, Math.floor(avail / (cw * .62))));
      const rows = Math.ceil(sorted.length / cols) || 1;
      const stepX = cols > 1 ? Math.min(cw * 1.1, (avail - cw) / (cols - 1)) : 0;
      const stepY = rows > 1 ? Math.min(ch * .55, (bottom - top - ch) / (rows - 1)) : 0;
      sorted.forEach((id, i) => {
        const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, sorted.length - r * cols);
        const rowW = cw + (inRow - 1) * stepX, j = this.jitter(id, .6);
        items.push({ key: 'rv:' + id, id, face: true, x: this.W / 2 - rowW / 2 + c * stepX + j.dx, y: top + r * stepY + j.dy, rot: j.rot, z: 5 + i, review: team, scopa: view.scopeCards[team].includes(id) });
      });
    };
    const half = this.H / 2;
    spread(view.captured[1 - my], 46, half - 12, 1 - my);
    spread(view.captured[my], half + 12, this.H - ch - 12, my);
    return items;
  },
  reviewCaptured(on) {
    this.reviewing = on;
    if (!App.view) return;
    const sp = {};
    for (let t = 0; t < 2; t++) { const pp = this.pilePos(t, App.view); App.view.captured[t].forEach(id => { sp['rv:' + id] = pp; sp['exit:rv:' + id] = pp; }); }
    const items = this.layout(App.view);
    if (on) items.forEach((it, i) => { it.delay = Math.min(1200, i * 18); });
    this.draw(items, sp);
    $('#review-bar').classList.toggle('hidden', !on);
    for (const [k, n] of this.nodes) if (n._it && n._it.review != null) n.classList.toggle('target', !!n._it.scopa);
    if (on) { const my = C.teamOf(App.view, App.mySeat); $('#review-lbl').textContent = `In alto ${App.view.cfg.players === 4 ? 'le loro' : 'le sue'} prese, in basso ${App.view.cfg.players === 4 ? 'le nostre' : 'le tue'} · con il bordo verde le scope`; }
  },
  /** disegna un layout (riconcilia i nodi) */
  draw(items, spawn = {}) {
    const keep = new Set();
    items.forEach((it, idx) => {
      keep.add(it.key);
      let node = this.nodes.get(it.key);
      const fresh = !node;
      if (fresh) {
        node = document.createElement('div'); node.className = 'card';
        node.innerHTML = `<div class="face"></div><div class="back"></div>`;
        node.dataset.key = it.key;
        const sp = spawn[it.key] || spawn['*'] || this.deckPos();
        node.classList.add('no-anim');
        node.style.transform = `translate(${sp.x}px,${sp.y}px) rotate(${sp.rot || 0}deg) rotateY(180deg)`;
        node.style.zIndex = it.z || 2;
        this.el.appendChild(node);
        node.getBoundingClientRect(); // forza il reflow
        node.classList.remove('no-anim');
        this.nodes.set(it.key, node);
      }
      const faceKey = it.id ? it.id + ':' + (it.id === C.MATTA && App.view && App.view.mattaVal ? App.view.mattaVal : '') + (Settings.fourColor ? ':4' : '') : '';
      if (it.id && node.dataset.face !== faceKey) {
        node.dataset.id = it.id; node.dataset.face = faceKey;
        node.querySelector('.face').innerHTML = cardSVG(it.id, it.id === C.MATTA && App.view ? App.view.mattaVal : null);
        const s = C.suitOf(it.id);
        node.classList.toggle('red', s === 'H' || s === 'D'); node.classList.toggle('denari', s === 'D');
      }
      node.style.transitionDelay = (it.delay || 0) + 'ms';
      if (!(this.drag && this.drag.id === it.key)) node.style.transform = `translate(${it.x}px,${it.y}px) rotate(${it.rot || 0}deg) rotateY(${it.face ? 0 : 180}deg)${it.scale && it.scale !== 1 ? ` scale(${it.scale})` : ''}`;
      node.style.zIndex = it.z || 2;
      node.classList.toggle('scopa-mark', !!it.scopa);
      node.classList.toggle('selected', it.key === this.selected);
      node._it = it;
    });
    // nodi non più presenti: escono
    for (const [key, node] of this.nodes) {
      if (keep.has(key)) continue;
      this.nodes.delete(key);
      const exit = spawn['exit:' + key] || spawn['exit'];
      node.dataset.key = 'gone:' + key;
      if (exit) {
        // vola nel mazzetto: si gira sul dorso durante il volo e si adagia sulla pila
        const k = this.pileScale();
        node.style.transitionDelay = (exit.delay || 0) + 'ms';
        node.style.zIndex = 4;
        node.classList.remove('target', 'alt', 'target-dim', 'selected');
        node.style.transform = `translate(${exit.x}px,${exit.y}px) rotate(${exit.rot || 0}deg) rotateY(180deg)${k !== 1 ? ` scale(${k})` : ''}`;
        setTimeout(() => node.remove(), 650 + (exit.delay || 0));
      }
      else node.remove();
    }
    // mazzo e mazzetti
    const dp = this.deckPos(); const deck = $('#deck');
    deck.style.left = dp.x + 'px'; deck.style.top = dp.y + 'px'; deck.style.transform = dp.scale ? `scale(${dp.scale})` : ''; deck.style.setProperty('--deck-k', dp.scale || 1);
  },
  render(view) {
    this.measure();
    this.locked = queue.length > 0;
    if (this.reviewing && view.phase === 'play') this.reviewCaptured(false);
    this.draw(this.layout(view));
    if (App.arcade && view.phase === 'play' && typeof ArcadeUI !== 'undefined') ArcadeUI.liveCheck(view);
    const mob = this.mobile;
    $('#deck').classList.toggle('hidden', !view.deckCount); $('#mstrip').classList.add('hidden');
    const deck = $('#deck'); deck.querySelector('.count').textContent = view.deckCount || '';
    deck.style.opacity = 1;
    const my = C.teamOf(view, App.mySeat);
    for (let t = 0; t < 2; t++) {
      const p = $('#pile' + t), pp = this.pilePos(t, view);
      p.style.left = pp.x + 'px'; p.style.top = pp.y + 'px';
      const nc = view.captured[t].length, sc = view.scope[t];
      p.className = 'pile ' + (t === my ? 't0' : 't1') + (nc ? ' full' : '') + (t === my ? '' : ' theirs') + (mob && !nc ? ' hidden' : '');
      p.style.transform = `scale(${this.pileScale()})`;
      p.querySelector('.lbl').textContent = nc ? '' : (t === my ? (view.cfg.players === 4 ? 'le nostre prese' : 'le tue prese') : (view.cfg.players === 4 ? 'le loro prese' : 'le sue prese'));
      p.querySelector('.cnt').textContent = '';
      p.title = `${nc} cart${nc === 1 ? 'a' : 'e'}${sc ? ` · ${sc} scop${sc === 1 ? 'a' : 'e'}` : ''}`;
    }
    this.updateInteractivity(view);
    // la selezione sopravvive a un aggiornamento solo se è ancora valida
    if (this.selected && !this.canAct(view, this.selected)) this.clearSelection();
    else if (this.selected) this.showOptions(this.selected);
  },
  canAct(view, id) {
    return !!view && !this.locked && view.phase === 'play' && view.turn === App.mySeat && !view.pendingBuona && (view.hands[App.mySeat] || []).includes(id);
  },
  updateInteractivity(view) {
    const myTurn = view.phase === 'play' && view.turn === App.mySeat && !view.pendingBuona && !this.locked;
    const hand = view.hands[App.mySeat] || [];
    for (const [key, node] of this.nodes) {
      const it = node._it; if (!it) continue;
      const mine = it.hand === App.mySeat;
      node.classList.toggle('selectable', mine && myTurn);
      node.classList.toggle('playable', mine && myTurn && !!it.id && this.optionsOf(it.id).length > 0);
      node.onclick = null; node.onpointerdown = null;
      if (mine && myTurn) node.onpointerdown = e => this.dragStart(e, it.id);
      if (it.table != null) node.onclick = () => this.clickTable(it.table);
    }
    const arcEl = $('#hintarc'); if (arcEl) arcEl.classList.toggle('myturn', !!myTurn);
    if (view.phase === 'play') {
      if (view.pendingBuona && !view.pendingBuona.options) this.setHint(`${view.names[view.pendingBuona.seat]} sta dichiarando una buona…`, true);
      else if (myTurn) this.setHint(hand.length ? 'tocca a te' : '', true);
      else this.setHint(`tocca a ${view.names[view.turn] || ''}`, true);
    } else this.setHint('', false);
  },
  /* arco che separa la mano dal campo: centro sotto la mano, raggio in funzione delle carte */
  arc(view) {
    const a = this.seatAnchor(0, view || App.view), ch = this.ch(), cw = this.cw();
    const cx = this.W / 2, cy = a.y + ch * .9;
    const R = Math.min(this.W * .48, this.mobile ? ch * 1.75 + 24 : this.landscape ? ch * 1.45 + 30 : ch * 1.7 + 60);
    const t1 = Math.PI * (this.mobile ? .93 : .87), t2 = Math.PI - t1;
    const p = t => ({ x: cx + R * Math.cos(t), y: cy - R * Math.sin(t) });
    const s = p(t1), e = p(t2);
    return { cx, cy, R, s, e, d: `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${R} ${R} 0 0 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}` };
  },
  beyondArc(px, py) { const a = this.arc(); return py < a.cy && Math.hypot(px - a.cx, py - a.cy) > a.R; },
  setHint(text, on) {
    const svg = $('#hintarc'); if (!svg) return;
    if (!on) { svg.classList.add('hidden'); return; }
    const a = this.arc();
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    ['#hint-path', '#hint-glow', '#hint-aurora', '#hint-comet', '#hint-comet2'].forEach(id => $(id).setAttribute('d', a.d));
    // le due "comete" che scorrono lungo l'arco: una scia corta su un tratteggio lungo quanto l'arco
    const len = a.R * (Math.PI * (this.mobile ? .93 : .87) - Math.PI * (this.mobile ? .07 : .13));
    const dash = Math.round(len * .14), gap = Math.round(len * 1.1);
    [$('#hint-comet'), $('#hint-comet2')].forEach((c, i) => { c.style.strokeDasharray = `${dash} ${gap}`; c.style.setProperty('--period', (dash + gap) + 'px'); c.style.animationDelay = i ? '-2.1s' : '0s'; });
    $('#hint-text').textContent = text;
    svg.classList.remove('hidden');
  },
  /* p: 0 = carta ancora in mano, 1 = oltre la linea. Linea e alone affiorano con continuità; sotto la carta un faro segue il dito */
  showDropzone(on, p, px, py) {
    const svg = $('#dropzone'); if (!on) { svg.classList.add('hidden'); this.dzOver = false; return; }
    const a = this.arc();
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    const path = $('#drop-path'), solid = $('#drop-solid'), fill = $('#drop-fill'), band = $('#drop-band'), spot = $('#drop-spotfill');
    const region = `${a.d} L ${this.W} ${a.e.y.toFixed(1)} L ${this.W} 0 L 0 0 L 0 ${a.s.y.toFixed(1)} Z`;
    path.setAttribute('d', a.d); solid.setAttribute('d', a.d); band.setAttribute('d', a.d);
    fill.setAttribute('d', region); spot.setAttribute('d', region);
    p = clamp(p || 0, 0, 1);
    const e = p * p * (3 - 2 * p);   // curva morbida
    solid.style.opacity = e.toFixed(3);
    solid.style.strokeWidth = (2 + 1.5 * e).toFixed(2);
    band.style.opacity = (.25 + .75 * e).toFixed(3);
    band.style.strokeWidth = (10 + 16 * e).toFixed(1);
    path.style.opacity = (1 - .85 * e).toFixed(3);
    fill.style.fill = `rgba(190,230,170,${(.03 + .07 * e).toFixed(3)})`;
    const g = $('#drop-spot');
    if (px != null) { g.setAttribute('cx', px.toFixed(0)); g.setAttribute('cy', py.toFixed(0)); g.setAttribute('r', (this.cw() * (1.6 + .6 * e)).toFixed(0)); spot.style.opacity = (.2 + .8 * e).toFixed(2); }
    else spot.style.opacity = 0;
    // scatto "magnetico" quando si supera la linea: un anello che si allarga dal punto in cui si entra
    const over = p >= 1;
    if (over && !this.dzOver && px != null) {
      const pulse = $('#drop-pulse'); pulse.setAttribute('cx', px.toFixed(0)); pulse.setAttribute('cy', py.toFixed(0));
      pulse.classList.remove('go'); void pulse.getBoundingClientRect(); pulse.classList.add('go');
      if (navigator.vibrate) navigator.vibrate(8);
    }
    this.dzOver = over;
    svg.classList.remove('hidden');
  },
  /* quanto la carta si è avvicinata alla linea: 0 vicino alla mano, 1 sulla linea o oltre */
  arcProgress(px, py) {
    const a = this.arc();
    if (py >= a.cy) return 0;
    const d = Math.hypot(px - a.cx, py - a.cy);
    return clamp((d - a.R * .45) / (a.R * .55), 0, 1);
  },
  optionsOf(id) {
    const view = App.view;
    const val = view.mattaVal && id === C.MATTA ? view.mattaVal : C.rankOf(id);
    return C.captureOptions(view.table, val);
  },
  /* ---------- tocco: seleziona / deseleziona ---------- */
  select(id) {
    if (!this.canAct(App.view, id)) return;
    if (this.selected === id) { this.clearSelection(); return; }
    this.selected = id; this.floating = false;
    this.draw(this.layout(App.view));
    this.showOptions(id);
  },
  /* mostra chip e bagliori per la carta indicata (non tocca la posizione delle carte) */
  showOptions(id) {
    const view = App.view;
    const opts = this.optionsOf(id);
    this.currentOptions = opts; this.focused = null;
    const ch = $('#choices'); ch.innerHTML = '';
    const describe = o => o.idx.map(i => cardShort(view.table[i].id)).join(' + ');
    if (!opts.length) {
      // nessuna presa: niente scritte, la carta andrà semplicemente in tavola
      ch.classList.add('hidden'); this.setHint('', false); return;
    } else {
      opts.forEach((o, i) => {
        const b = document.createElement('button'); b.className = 'choice'; b.dataset.i = i;
        const kind = o.kind === 'ace' ? 'asso piglia tutto' : o.kind === 'fifteen' ? 'fa 15' : 'presa';
        b.innerHTML = `<span class="k ${o.kind}">${kind}</span>${describe(o)}${o.scopa ? ' <b>· scopa!</b>' : ''}`;
        b.onmouseenter = () => this.focus(i); b.onmouseleave = () => this.focus(null);
        b.onclick = () => this.play(id, o.idx);
        ch.appendChild(b);
      });
    }
    this.focus(opts.length === 1 ? 0 : null);
    ch.classList.add('hidden');   // nessuna scritta sopra il campo: parlano solo le carte illuminate
    this.setHint('', false);
  },
  /* riquadro di scelta tra più prese (dopo il rilascio in campo) */
  showChooser(id) {
    const view = App.view, opts = this.currentOptions || [];
    const box = $('#chooser'); box.innerHTML = '';
    let bg = $('#chooser-bg'); if (!bg) { bg = document.createElement('div'); bg.id = 'chooser-bg'; bg.className = 'chooser-bg hidden'; box.parentNode.insertBefore(bg, box); }
    bg.classList.remove('hidden'); bg.onclick = () => this.clearSelection();
    const h = document.createElement('div'); h.className = 'ch-title'; h.textContent = 'Cosa prendi?'; box.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'ch-sub'; sub.textContent = `Con ${C.cardName(id)} puoi fare ${opts.length} prese diverse`; box.appendChild(sub);
    opts.forEach((o, i) => {
      const b = document.createElement('button'); b.className = 'ch-opt'; b.dataset.i = i;
      const kind = o.kind === 'ace' ? 'asso piglia tutto' : o.kind === 'fifteen' ? 'fa 15' : 'carta uguale';
      const label = o.kind === 'simple' && o.idx.length > 1 ? 'somma' : kind;
      b.innerHTML = `<span class="cards">${o.idx.map(k => miniCard(view.table[k].id)).join('<span class="plus">+</span>')}</span><span class="meta"><span class="k ${o.kind}">${label}</span>${o.scopa ? '<span class="sc">scopa!</span>' : ''}</span>`;
      b.onmouseenter = () => this.focus(i); b.onmouseleave = () => this.focus(null);
      b.onclick = () => this.play(id, o.idx);
      box.appendChild(b);
    });
    const c = document.createElement('button'); c.className = 'ch-cancel'; c.textContent = 'Rimetti in mano'; c.onclick = () => this.clearSelection(); box.appendChild(c);
    box.classList.remove('hidden');
    $('#choices').classList.add('hidden');
  },
  /* evidenzia l'opzione i (o tutte le possibili se null) */
  focus(i) {
    const view = App.view; const opts = this.currentOptions || [];
    this.focused = i;
    $$('#choices .choice').forEach(b => b.classList.toggle('hl', b.dataset.i == i));
    view.table.forEach((t, k) => {
      const n = this.nodes.get(t.id); if (!n) return;
      n.classList.remove('target', 'alt', 'target-dim');
      if (i != null && opts[i]) { if (opts[i].idx.includes(k)) n.classList.add('target'); else n.classList.add('target-dim'); }
      else if (opts.length > 1 && opts.some(o => o.idx.includes(k))) n.classList.add('target', 'alt');
    });
  },
  clickTable(k) {
    if (!this.selected) return;
    const hits = this.currentOptions.map((o, i) => o.idx.includes(k) ? i : -1).filter(i => i >= 0);
    if (hits.length === 1) this.play(this.selected, this.currentOptions[hits[0]].idx);
    else if (hits.length > 1) { this.focus(hits[0]); toast('Questa carta rientra in più prese: scegline una'); }
  },
  clearSelection() {
    const had = this.selected;
    this.selected = null; this.floating = false; this.currentOptions = []; this.focused = null;
    $('#choices').classList.add('hidden'); $('#chooser').classList.add('hidden'); const cbg = $('#chooser-bg'); if (cbg) cbg.classList.add('hidden');
    this.showDropzone(false);
    if (App.view) {
      App.view.table.forEach(t => this.nodes.get(t.id)?.classList.remove('target', 'alt', 'target-dim'));
      if (had) this.draw(this.layout(App.view));
      if (App.view.phase === 'play') this.updateInteractivity(App.view);
    }
  },
  play(id, idx) {
    if (this.locked) return;
    this.locked = true;
    this.clearSelection();
    Client.send({ t: 'play', card: id, idx });
    clearTimeout(this.unlockTimer);
    this.unlockTimer = setTimeout(() => { if (this.locked && !queue.length && !processing) { this.locked = false; if (App.view) this.render(App.view); } }, 6000);
  },
  /* ---------- trascinamento ---------- */
  dragStart(e, id) {
    if (!this.canAct(App.view, id) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const node = this.nodes.get(id); if (!node) return;
    const it = node._it;
    const drag = { id, node, x0: e.clientX, y0: e.clientY, ox: it.x, oy: it.y, moved: false, over: false };
    node.setPointerCapture(e.pointerId);
    // già alla pressione: evidenzia cosa prende questa carta (seconda pressione sulla stessa = rimetti in mano)
    if (this.selected === id && !this.floating) { drag.deselect = true; }
    if (this.selected && this.selected !== id) this.clearSelection();
    this.selected = id; this.floating = false;
    this.draw(this.layout(App.view));
    this.drag = drag;
    this.showOptions(id);
    this.showDropzone(true, 0);
    const move = ev => {
      const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 8) return;
        drag.moved = true;
        node.classList.add('dragging'); node.style.zIndex = 60;
      }
      // la carta si inclina leggermente nel verso del movimento, come tenuta tra le dita
      const now = performance.now(), dt = Math.max(8, now - (drag.t || now)), vx = (ev.clientX - (drag.lx ?? ev.clientX)) / dt;
      drag.t = now; drag.lx = ev.clientX;
      drag.tilt = (drag.tilt || 0) * .75 + clamp(vx * 14, -10, 10) * .25;
      const r = this.wrap.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      drag.over = this.beyondArc(px, py);
      node.classList.toggle('over-table', drag.over);
      node.style.transform = `translate(${drag.ox + dx}px,${drag.oy + dy - 28}px) rotate(${drag.tilt.toFixed(1)}deg) rotateY(0deg) scale(${drag.over ? 1.1 : 1.06})`;
      this.showDropzone(true, this.arcProgress(px, py), px, py);
      // cosa c'è sotto il dito?
      const under = (document.elementsFromPoint(ev.clientX, ev.clientY) || []).find(el => !node.contains(el)) || null;
      const chip = under && under.closest('.choice');
      const card = under && under.closest('.card');
      let f = null;
      if (chip && chip.dataset.i != null) f = +chip.dataset.i;
      else if (card && card._it && card._it.table != null) {
        const k = card._it.table; const hits = this.currentOptions.map((o, i) => o.idx.includes(k) ? i : -1).filter(i => i >= 0);
        if (hits.length) f = hits[0];
      }
      drag.overOpt = f;
      if (f !== this.focused) this.focus(f ?? (this.currentOptions.length === 1 ? 0 : null));
    };
    const cancel = ev => { drag.over = false; end(ev); };
    const end = ev => {
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', cancel);
      try { node.releasePointerCapture(ev.pointerId); } catch (x) {}
      node.classList.remove('dragging', 'over-table'); node.style.zIndex = it.z || 2;
      // atterraggio: molla morbida e ombra che si ritira
      node.classList.add('landing'); clearTimeout(node._landT); node._landT = setTimeout(() => node.classList.remove('landing'), 700);
      this.drag = null;
      this.showDropzone(false);
      if (!drag.moved) { if (drag.deselect) this.clearSelection(); return; }   // tocco: resta selezionata (o torna in mano)
      const opts = this.currentOptions || [];
      if (drag.over) {
        if (opts.length === 0) return this.play(id, null);
        if (opts.length === 1) return this.play(id, opts[0].idx);
        if (drag.overOpt != null && opts[drag.overOpt]) return this.play(id, opts[drag.overOpt].idx);   // lasciata sopra una carta precisa
        // più prese possibili: la carta resta sospesa in tavola e scegli nel riquadro
        this.floating = true;
        this.draw(this.layout(App.view));
        this.showChooser(id);
        return;
      }
      this.clearSelection();                                        // rimessa in mano
    };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', cancel);
  },
  /* ---------- animazione di un evento ---------- */
  async animateEvent(ev, sim, finalView) {
    const view = App.view;
    switch (ev.type) {
      case 'deal': {
        Sound.play('deal');
        if (!sim) return;
        const n = finalView.cfg.players;
        if (ev.round === 0) { sim.table = []; sim.captured = [[], []]; sim.scope = [0, 0]; sim.scopeCards = [[], []]; sim.dealer = ev.dealer; sim.lastCapture = null; }
        if (ev.table) sim.table = ev.table.map(id => ({ id, val: C.rankOf(id) }));
        sim.deckCount = finalView.deckCount; sim.round = ev.round; sim.faceUp = new Array(n).fill(false); sim.mattaVal = null;
        const mineKnown = finalView.round === ev.round && finalView.hands[App.mySeat].length === 3;
        sim.hands = finalView.hands.map((h, s) => s === App.mySeat && mineKnown ? h.slice() : [null, null, null]);
        const items = this.layout(sim);
        const order = []; for (let k = 0; k < 3; k++) for (let i = 1; i <= n; i++) order.push(`${(ev.dealer + i) % n}:${k}`);
        items.forEach(it => { if (it.hand != null) it.delay = 70 * order.indexOf(`${it.hand}:${it.hi}`); if (it.table != null && ev.table) it.delay = 70 * (3 * n + it.table); });
        this.draw(items, { '*': this.deckPos() });
        await sleep(70 * (3 * n + (ev.table ? 4 : 0)) + 600);
        break;
      }
      case 'monte': toast('Mano a monte: due assi in tavola, si ridà'); await sleep(600); break;
      case 'dealer-buona': {
        this.fx(`Buona del mazziere`, `le quattro carte fanno ${ev.sum}: ${ev.points === 2 ? 'due scope' : 'una scopa'} a ${finalView.names[ev.seat]}`, 'oro');
        Sound.play('scopa');
        await sleep(1200);
        if (sim) { const t = C.teamOf(finalView, ev.seat); sim.table = []; sim.captured[t] = ev.cards.slice(); sim.scope[t] = ev.points; sim.scopeCards[t] = ev.cards.slice(0, ev.points); const pp = this.pilePos(t, finalView), ex = {}; ev.cards.forEach((id, i) => ex['exit:' + id] = { x: pp.x, y: pp.y - i, rot: (i % 3 - 1) * 2, delay: i * 70 }); this.draw(this.layout(sim), ex); await sleep(900); }
        break;
      }
      case 'buona': {
        Sound.play('buona');
        this.wrap.classList.remove('shake'); void this.wrap.offsetWidth; this.wrap.classList.add('shake');
        const who = ev.seat === App.mySeat ? 'Hai bussato!' : `${finalView.names[ev.seat]} bussa!`;
        this.fx(who, `${ev.label} · +${ev.points}`, 'oro');
        if (sim) { sim.faceUp[ev.seat] = true; sim.hands[ev.seat] = ev.cards.slice(); const t = C.teamOf(finalView, ev.seat); sim.scope[t] += ev.points; this.draw(this.layout(sim)); }
        await sleep(1700);
        break;
      }
      case 'play': {
        if (!sim) return;
        const played = ev.card;
        const hand = sim.hands[ev.seat];
        const k = hand.indexOf(played) >= 0 ? hand.indexOf(played) : hand.length - 1;
        const slotKey = hand[k] || `h:${ev.seat}:${k}`;
        const spawn = {};
        const slotNode = this.nodes.get(slotKey);
        if (slotNode && slotKey !== played) { const it = slotNode._it; spawn[played] = { x: it.x, y: it.y, rot: it.rot }; this.nodes.delete(slotKey); slotNode.remove(); }
        hand.splice(k, 1);
        sim.table.push({ id: played, val: ev.val });
        sim.mattaVal = finalView.mattaVal;
        this.draw(this.layout(sim), spawn);
        Sound.play('card');
        await sleep(ev.captured.length ? 520 : 420);
        if (ev.captured.length) {
          // evidenzia e poi porta al mazzetto
          ev.captured.concat(played).forEach(id => this.nodes.get(id)?.classList.add('target'));
          if (ev.scopa) { this.fx('Scopa!', ev.kind === 'ace' ? `asso piglia tutto · ${finalView.names[ev.seat]}` : finalView.names[ev.seat]); Sound.play('scopa'); this.sparks(); }
          else Sound.play('take');
          await sleep(ev.scopa ? 900 : 380);
          const t = C.teamOf(finalView, ev.seat);
          sim.table = sim.table.filter(x => !ev.captured.includes(x.id) && x.id !== played);
          sim.captured[t].push(...ev.captured, played);
          if (ev.scopa) { sim.scope[t]++; sim.scopeCards[t].push(played); }
          const pp = this.pilePos(t, finalView), ex = {};
          ev.captured.concat(played).forEach((id, i) => { ex['exit:' + id] = { x: pp.x + (i % 2 ? 1 : -1), y: pp.y - i, rot: (i % 3 - 1) * 2, delay: i * 70 }; });
          this.draw(this.layout(sim), ex);
          await sleep(620 + ev.captured.length * 70);
        }
        break;
      }
      case 'deal-end': {
        if (ev.leftover && ev.leftover.length && sim) {
          const t = ev.lastCapturer != null ? C.teamOf(finalView, ev.lastCapturer) : 0;
          toast(`Le carte rimaste in tavola vanno a ${finalView.names[ev.lastCapturer] || 'chi ha preso per ultimo'}`);
          const pp = this.pilePos(t, finalView), ex = {}; ev.leftover.forEach((id, i) => ex['exit:' + id] = { x: pp.x, y: pp.y - i, rot: (i % 3 - 1) * 2, delay: i * 70 });
          sim.table = []; this.draw(this.layout(sim), ex);
          await sleep(700 + ev.leftover.length * 70);
        }
        break;
      }
    }
  },
  fx(text, sub, cls = '') {
    $$('.fxwrap').forEach(x => x.remove());
    const w = document.createElement('div'); w.className = 'fxwrap';
    const d = document.createElement('div'); d.className = 'fx ' + cls;
    const suits = ['♥', '♦', '♣', '♠'];
    let flying = '';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + (Math.random() - .5) * .4, r = 150 + Math.random() * 110; flying += `<i style="--dx:${(Math.cos(a) * r).toFixed(0)}px;--dy:${(Math.sin(a) * r * .7).toFixed(0)}px;--r:${(Math.random() * 300 - 150).toFixed(0)}deg;animation-delay:${(Math.random() * .12).toFixed(2)}s">${suits[i % 4]}</i>`; }
    d.innerHTML = `<div class="glow"></div><div class="ring"></div><div class="suits">${flying}</div><div class="ribbon"><span class="t">${esc(text)}</span></div>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    w.appendChild(d); this.wrap.appendChild(w);
    // il campo dietro si abbassa e si sfoca per un attimo: la scritta resta leggibile
    this.wrap.classList.add('fxon'); clearTimeout(this.fxTimer);
    this.fxTimer = setTimeout(() => this.wrap.classList.remove('fxon'), 1500);
    setTimeout(() => w.remove(), 2050);
  },
  sparks(palette) {
    const colors = palette || ['#d9a621', '#f0c750', '#c8202f', '#f6f0e1', '#7fa36c'];
    for (let i = 0; i < 34; i++) {
      const s = document.createElement('div'); s.className = 'spark';
      const a = Math.random() * Math.PI * 2, r = 110 + Math.random() * 220;
      s.style.left = this.W / 2 + 'px'; s.style.top = this.H * .45 + 'px'; s.style.background = colors[i % colors.length];
      s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', Math.sin(a) * r + 'px');
      this.wrap.appendChild(s); setTimeout(() => s.remove(), 1100);
    }
  },
};

/* ---------- badge giocatori ---------- */
function renderPlayers(view) {
  view = view || App.view; if (!view || !Stage.inited) return;
  const n = view.cfg.players;
  for (let s = 0; s < n; s++) {
    let el = Stage.playerEls.get(s);
    if (!el) { el = document.createElement('div'); el.className = 'player'; el.innerHTML = `<div class="avatar"></div><div><div class="name"></div><div class="sub"></div></div><span class="mic"></span>`; Stage.el.appendChild(el); Stage.playerEls.set(s, el); }
    const p = App.roster.find(x => x.seat === s) || {};
    const name = view.names[s] || p.name || '…';
    const rel = Stage.rel(s, view);
    el.querySelector('.avatar').textContent = initials(name).slice(0, rel === 0 ? 2 : 1);
    el.querySelector('.name').textContent = s === App.mySeat ? `${name} (tu)` : name;
    const team = C.teamOf(view, s);
    const sub = [n === 4 ? (team === C.teamOf(view, App.mySeat) ? 'tua coppia' : 'avversari') : '', view.dealer === s ? 'mazziere' : '', view.faceUp[s] ? 'carte scoperte' : ''].filter(Boolean).join(' · ');
    el.querySelector('.sub').textContent = sub;
    el.className = `player team${team === C.teamOf(view, App.mySeat) ? 0 : 1}` + (view.phase === 'play' && view.turn === s ? ' turn' : '') + (view.dealer === s ? ' dealer' : '') + (p.online === false ? ' offline' : '') + (Voice.speaking.has(s) ? ' speaking' : '');
    el.querySelector('.mic').textContent = Voice.speaking.has(s) ? '🎙' : '';
    const a = Stage.seatAnchor(rel, view), cw = Stage.cw(), ch = Stage.ch();
    el.style.right = '';
    el.classList.toggle('hidden', (Stage.mobile || Stage.landscape) && rel === 0);
    el.classList.toggle('compact', !!a.compact);
    el.title = sub;
    el.classList.toggle('label', rel !== 0);
    if (a.compact) {
      // etichetta sotto le carte, centrata sul mazzetto di carte
      el.style.top = `${a.y + ch * .5 + 6}px`; el.style.left = `${a.x}px`; el.style.transform = 'translateX(-50%)';
    } else if (a.dir === 'h' && rel !== 0) {
      el.style.top = `${a.y + ch / 2 + 8}px`; el.style.left = `${a.x}px`; el.style.transform = 'translateX(-50%)';
    } else if (a.dir === 'h') {
      el.style.transform = '';
      // accanto alla mia mano, a sinistra
      const half = cw * 1.12 * 1.5;
      el.style.top = `${a.y - 20}px`;
      el.style.left = ''; el.style.right = `${Stage.W - (a.x - half - 14)}px`;
    } else {
      // mano verticale: etichetta sotto le carte, ma sempre dentro il campo
      const half = cw * 0.55 + ch / 2;
      const top = Math.min(a.y + half + 6, Stage.H - 34);
      el.style.top = `${top}px`;
      if (rel === 1) { el.style.left = ''; el.style.right = '8px'; el.style.transform = ''; }
      else { el.style.left = '8px'; el.style.transform = ''; }
    }
  }
}

/* =====================================================================
   Modali: buona, fine smazzata, regole
   ===================================================================== */
function showBuonaChoice(pb) {
  if ($('#buona-modal')) return;
  const html = `<h2>Hai una buona!<small>Scegli come dichiararla: la Matta prenderà il valore scelto</small></h2>
    <div class="minicards" style="margin:8px 0 14px">${App.view.hands[App.mySeat].map(id => miniCard(id)).join('')}</div>
    <div class="buona-opts">${pb.options.map((o, i) => `<button data-i="${i}">${esc(o.label)} <b style="float:right">+${o.points}</b></button>`).join('')}</div>`;
  const m = modal(html, { closable: false }); m.id = 'buona-modal';
  m.querySelectorAll('button').forEach(b => b.onclick = () => { Client.send({ t: 'buona', i: +b.dataset.i }); m.remove(); });
}

function showDealEnd(view) {
  if ($('#end-modal')) return;
  const d = view.lastDeal; if (!d) return;
  if (App.arcade && ArcadeUI.stage) {
    const finished = ArcadeUI.onDealEnd(view);
    if (finished) { ArcadeUI.showResult(view); return; }
    showDealEndTable(view, d, true); return;
  }
  showDealEndTable(view, d, false);
}
function showDealEndTable(view, d, arcadeContinue) {
  const my = C.teamOf(view, App.mySeat), ot = 1 - my;
  const names = t => view.cfg.players === 4 ? view.teams[t].map(s => view.names[s]).join(' & ') : view.names[view.teams[t][0]];
  const rows = [['Carte', 'carte', t => `${d.teams[t].nCarte}`], ['Denari ♦', 'denari', t => `${d.teams[t].nDenari}`], ['Settebello', 'settebello', () => ''], ['Primiera', 'primiera', t => `${d.teams[t].primieraVal}`], ['Scope e buone', 'scope', () => ''], ['Grande', 'grande', () => ''], ['Piccola', 'piccola', () => '']];
  const cell = (t, key, sub) => { const v = d.teams[t][key]; return `<td><span class="${v ? 'pt' : 'zero'}">${v ? '+' + v : '–'}</span>${sub(t) ? `<div style="font-size:11px;color:var(--testo-2)">${sub(t)}</div>` : ''}</td>`; };
  const gameOver = view.phase === 'gameEnd';
  const iWon = view.winner === my;
  let title = gameOver ? (iWon ? 'Partita vinta!' : 'Partita persa') : `Smazzata ${d.dealNo}`;
  let sub = gameOver ? (d.cappotto != null ? 'Cappotto: tutti i denari in una mano!' : `${names(view.winner)} ${view.cfg.players === 4 ? 'vincono' : 'vince'} ${view.scores[view.winner]} a ${view.scores[1 - view.winner]}`) : (d.teams[my].total > d.teams[ot].total ? 'Smazzata a tuo favore' : d.teams[my].total < d.teams[ot].total ? 'Smazzata agli avversari' : 'Smazzata in parità');
  const buone = d.buone.length ? `<p style="font-size:13px">${d.buone.map(b => `${esc(view.names[b.seat])}: ${b.type === 'decino' ? 'decino' : b.type === 'grande' ? 'grande in mano' : 'buona da tre'} (+${b.points})`).join(' · ')}</p>` : '';
  const html = `<h2>${title}<small>${esc(sub)}</small></h2>
    <table class="tbl"><tr><th></th><th>${esc(names(my))}</th><th>${esc(names(ot))}</th></tr>
    ${rows.map(([lbl, key, sub]) => `<tr><td>${lbl}</td>${cell(my, key, sub)}${cell(ot, key, sub)}</tr>`).join('')}
    <tr class="tot"><td>Questa smazzata</td><td>+${d.teams[my].total}</td><td>+${d.teams[ot].total}</td></tr>
    <tr class="tot"><td>Totale</td><td>${d.after[my]}</td><td>${d.after[ot]}</td></tr></table>${buone}
    <div class="actions"><button class="btn ghost" id="end-prese">Vedi le carte prese</button>
    ${gameOver ? `<button class="btn" id="end-again">Nuova partita</button>` : `<button class="btn" id="end-next">${App.mode === 'guest' ? 'Pronto per la prossima' : 'Prossima smazzata'}</button>`}</div>`;
  const m = modal(html, { closable: false }); m.id = 'end-modal';
  m.querySelector('.modal').classList.add(gameOver ? (iWon ? 'won' : 'lost') : 'deal');
  if (gameOver && App.mode !== 'solo' && !App.arcade) {
    const opp = view.teams[ot].map(sIdx => view.names[sIdx]);
    const rec = Record.add(opp, iWon);
    if (rec) { const p = document.createElement('p'); p.className = 'record'; p.innerHTML = `Con <b>${esc(rec.name)}</b>: ${rec.w} vint${rec.w === 1 ? 'a' : 'e'} · ${rec.l} pers${rec.l === 1 ? 'a' : 'e'}`; m.querySelector('.actions').before(p); }
  }
  Sound.play(gameOver ? (iWon ? 'win' : 'lose') : (d.teams[my].total >= d.teams[ot].total ? 'take' : 'card'));
  if (gameOver && iWon) { Stage.sparks(); setTimeout(() => Stage.sparks(), 700); }
  m.querySelector('#end-prese').onclick = () => { m.classList.add('hidden'); Stage.reviewCaptured(true); };
  m.querySelector('#end-prese').title = 'Si possono guardare solo a fine smazzata';
  $('#review-close').onclick = () => { Stage.reviewCaptured(false); m.classList.remove('hidden'); };
  const nb = m.querySelector('#end-next'); if (nb) nb.onclick = () => { nb.disabled = true; nb.textContent = 'In attesa…'; Client.send({ t: 'next' }); if (arcadeContinue) setTimeout(() => ArcadeUI.goalbar(), 100); };
  const ab = m.querySelector('#end-again'); if (ab) ab.onclick = () => { Client.send({ t: 'again' }); m.remove(); };
  // il modale viene chiuso all'arrivo della nuova smazzata
  const obs = () => { if (App.view && App.view.phase === 'play') { m.remove(); } else requestAnimationFrame(obs); };
  requestAnimationFrame(obs);
}

const RULES_HTML = `<h2>Come si gioca a Cirulla<small>ciapachinze = acchiappa quindici</small></h2>
<div class="rules">
<h3>Il mazzo</h3><ul><li>40 carte genovesi: A, 2–7, J (vale 8), Q (vale 9), K (vale 10) nei quattro semi.</li><li>I <b>denari</b> sono i ♦: il <b>Settebello</b> è il 7♦ (★). La <b>Matta</b> è il 7♥.</li></ul>
<h3>La mano</h3><ul><li>3 carte a testa e 4 in tavola. Se le 4 fanno <b>15 o 30</b>, il mazziere le prende e segna 1 o 2 scope. Con 2 assi in tavola si ridà.</li><li>Finite le 3 carte se ne danno altre 3, fino a esaurire il mazzo.</li></ul>
<h3>Le prese (obbligatorie)</h3><ul><li><b>Semplice</b>: carta uguale o somma di carte. Se c'è la carta uguale devi prendere quella.</li><li><b>Da 15</b>: la tua carta più una o più carte in tavola fanno 15.</li><li><b>Asso piglia tutto</b>: se non ci sono assi in tavola prende tutto e vale scopa. Con un asso in tavola prendi solo quello (o fai 15).</li><li><b>Scopa</b> (+1): svuoti il tavolo. L'ultima carta della mano non fa scopa; ciò che resta va a chi ha preso per ultimo.</li></ul>
<h3>Le buone (bussate)</h3><ul><li><b>Buona da tre</b> (bàrsega): tre carte che sommano 9 o meno → +3.</li><li><b>Decino</b>: tre carte uguali → +10.</li><li>La Matta vale ciò che serve per fare una buona e tiene quel valore finché è in tavola. Chi bussa gioca a carte scoperte.</li></ul>
<h3>I punti a fine smazzata</h3><ul><li>Carte (più di 20), Denari (più di 5), Settebello, Primiera (7=21, 6=18, A=16, 5=15, 4=14, 3=13, 2=12, figure=10): 1 punto ciascuno.</li><li>Ogni scopa 1 punto. <b>Grande</b> J-Q-K♦ = 5. <b>Piccola</b> A-2-3♦ = 3, +1 per il 4, 5 e 6 in fila.</li><li><b>Cappotto</b>: tutti i 10 ♦ in una smazzata → partita vinta subito.</li></ul>
</div><div class="actions"><button class="btn" onclick="this.closest('.modal-bg').remove()">Chiudi</button></div>`;

/* =====================================================================
   Pannello laterale: prese, storico, chat
   ===================================================================== */
const Side = {
  tab: 'storico', unread: 0, chats: [],
  open(tab) { if (tab) this.setTab(tab); $('#side').classList.add('open'); this.unread = 0; this.badge(); },
  close() { $('#side').classList.remove('open'); },
  setTab(t) { this.tab = t; $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $('#chat-bar').classList.toggle('hidden', t !== 'chat'); this.refresh(); },
  badge() { const b = $('#side-badge'); b.textContent = this.unread; b.classList.toggle('hidden', !this.unread); },
  addChat(seat, text) { const name = (App.view && App.view.names[seat]) || (App.roster.find(p => p.seat === seat) || {}).name || '?'; this.chats.push({ name, text }); if (!$('#side').classList.contains('open') || this.tab !== 'chat') { this.unread++; this.badge(); toast(`${name}: ${text}`, 3500); } this.refresh(); },
  refresh() {
    const body = $('#side-body'); const view = App.view; if (!view) return;
    if (false) {
    } else if (this.tab === 'storico') {
      const evs = view.events.slice().reverse().filter(e => ['play', 'buona', 'dealer-buona', 'deal-end', 'deal'].includes(e.type));
      body.innerHTML = `<div class="log">${evs.map(e => {
        if (e.type === 'play') return `<div class="e ${e.scopa ? 'scopa' : ''}"><span class="who">${esc(view.names[e.seat])}</span><span>${e.captured.length ? `prende ${e.captured.length + 1} cart${e.captured.length + 1 === 1 ? 'a' : 'e'}${e.kind === 'fifteen' ? ' facendo 15' : e.kind === 'ace' ? ' con l\'asso' : ''}` : 'lascia una carta in tavola'}${e.scopa ? ' · SCOPA' : ''}</span></div>`;
        if (e.type === 'buona') return `<div class="e buona"><span class="who">${esc(view.names[e.seat])}</span><span>bussa: ${esc(e.label)} (+${e.points})</span></div>`;
        if (e.type === 'dealer-buona') return `<div class="e buona"><span class="who">${esc(view.names[e.seat])}</span><span>buona del mazziere: ${e.sum} in tavola (+${e.points})</span></div>`;
        if (e.type === 'deal') return `<div class="e"><span class="who">Mazziere ${esc(view.names[e.dealer])}</span><span>${e.round === 0 ? 'nuova smazzata' : 'dà altre 3 carte'}</span></div>`;
        if (e.type === 'deal-end') return `<div class="e"><span class="who">Fine smazzata</span><span>${e.scores.join(' – ')}</span></div>`;
        return '';
      }).join('')}</div>`;
    } else {
      body.innerHTML = this.chats.map(c => `<div class="msg"><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join('') || '<p style="color:var(--testo-2);font-size:13px">Nessun messaggio. Per parlare usa la chiamata o il walkie-talkie in basso.</p>';
      body.scrollTop = body.scrollHeight;
    }
  },
};

/* =====================================================================
   VOCE: chiamata continua e walkie-talkie (WebRTC via PeerJS)
   ===================================================================== */
const Voice = {
  mode: 'off', stream: null, muted: false, live: false, peer: null,
  outgoing: new Map(), incoming: new Map(), audios: new Map(), analysers: new Map(), speaking: new Set(), ctx: null,
  attachPeer(peer) {
    this.peer = peer;
    peer.on('call', mc => {
      mc.answer(this.stream || undefined);
      mc.on('stream', s => this.attachRemote(mc.peer, s));
      mc.on('close', () => this.detachRemote(mc.peer));
      this.incoming.set(mc.peer, mc);
    });
  },
  async ensureStream() {
    if (this.stream) return this.stream;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) { toast('Microfono non disponibile: controlla i permessi del browser'); throw e; }
    this.setupLocalMeter();
    this.applyTrackState();
    // rispondi alle chiamate già ricevute con il tuo flusso: le richiami
    this.callAll();
    return this.stream;
  },
  hostPeerId() { return 'cpz-' + App.code; },
  peersOthers() { return App.roster.filter(p => p.seat !== App.mySeat && !p.bot).map(p => ({ seat: p.seat, peerId: p.peerId || (App.mode === 'guest' ? this.hostPeerId() : null) })).filter(p => p.peerId); },
  callAll() {
    if (!this.stream || !this.peer) return;
    for (const p of this.peersOthers()) {
      if (this.outgoing.has(p.peerId)) continue;
      const mc = this.peer.call(p.peerId, this.stream);
      if (!mc) continue;
      this.outgoing.set(p.peerId, mc);
      mc.on('stream', s => this.attachRemote(p.peerId, s));
      mc.on('close', () => this.outgoing.delete(p.peerId));
      mc.on('error', () => this.outgoing.delete(p.peerId));
    }
  },
  rosterChanged() { if (this.mode !== 'off') this.callAll(); },
  seatOfPeer(peerId) { if (peerId === this.hostPeerId()) { const h = App.roster.find(x => !x.peerId && !x.bot); return h ? h.seat : 0; } const p = App.roster.find(x => x.peerId === peerId); return p ? p.seat : null; },
  attachRemote(peerId, stream) {
    let a = this.audios.get(peerId);
    if (!a) { a = document.createElement('audio'); a.autoplay = true; a.playsInline = true; document.body.appendChild(a); this.audios.set(peerId, a); }
    if (a.srcObject !== stream) { a.srcObject = stream; a.play().catch(() => {}); this.meter(peerId, stream); }
  },
  detachRemote(peerId) { const a = this.audios.get(peerId); if (a) { a.remove(); this.audios.delete(peerId); } },
  ac() { return this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); },
  meter(peerId, stream) {
    try {
      const ac = this.ac(); if (ac.state === 'suspended') ac.resume();
      const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
      this.analysers.set(peerId, { an, buf: new Uint8Array(an.frequencyBinCount) });
      this.startLoop();
    } catch (e) {}
  },
  setupLocalMeter() { try { const ac = this.ac(); const src = ac.createMediaStreamSource(this.stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); this.localAn = { an, buf: new Uint8Array(an.frequencyBinCount) }; this.startLoop(); } catch (e) {} },
  startLoop() {
    if (this.loop) return;
    const level = m => { m.an.getByteTimeDomainData(m.buf); let s = 0; for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / m.buf.length); };
    const tick = () => {
      let changed = false;
      for (const [pid, m] of this.analysers) {
        const seat = this.seatOfPeer(pid); if (seat == null) continue;
        const on = level(m) > .02;
        if (on && !this.speaking.has(seat)) { this.speaking.add(seat); changed = true; }
        if (!on && this.speaking.has(seat) && !this.remoteLive.has(seat)) { this.speaking.delete(seat); changed = true; }
      }
      if (this.localAn) { const l = this.stream && this.stream.getAudioTracks()[0].enabled ? level(this.localAn) : 0; $('#lvl-me').style.height = clamp(l * 500, 0, 100) + '%'; }
      if (changed) renderPlayers();
      this.loop = requestAnimationFrame(tick);
    };
    this.loop = requestAnimationFrame(tick);
  },
  remoteLive: new Set(),
  remotePtt(seat, on) { if (seat === App.mySeat) return; if (on) { this.remoteLive.add(seat); this.speaking.add(seat); } else { this.remoteLive.delete(seat); this.speaking.delete(seat); } renderPlayers(); },
  applyTrackState() {
    if (!this.stream) return;
    const en = !this.muted && (this.mode === 'call' || (this.mode === 'ptt' && this.live));
    this.stream.getAudioTracks().forEach(t => t.enabled = en);
    this.ui();
  },
  nameOf(seat) { const p = App.roster.find(x => x.seat === seat); return p ? p.name : 'Un giocatore'; },
  /* --- chiamata: chi preme chiama gli altri, che accettano; poi si resta in chiamata --- */
  async startCall() {
    if (App.mode === 'solo') { toast('La voce funziona solo con giocatori online'); return; }
    if (this.mode === 'call') { this.setMode('off'); Client.send({ t: 'call-end' }); return; }
    try { await this.ensureStream(); } catch (e) { return; }
    if (this.mode === 'ptt' && this.live) this.pttEnd();
    this.mode = 'call'; this.applyTrackState();
    Client.send({ t: 'call-invite' });
    toast('Chiamata in corso: gli altri devono accettare');
  },
  onInvite(seat) {
    if (seat === App.mySeat) return;
    if (this.mode === 'call') { Client.send({ t: 'call-accept' }); this.callAll(); return; }
    if ($('#call-modal')) return;
    Sound.play('turn');
    const m = modal(`<h2>📞 ${esc(this.nameOf(seat))} ti chiama<small>Accettando resterete in chiamata per tutta la partita</small></h2>
      <div class="actions"><button class="btn ghost" id="call-no">Rifiuta</button><button class="btn" id="call-yes">Accetta</button></div>`, { closable: false });
    m.id = 'call-modal';
    m.querySelector('#call-no').onclick = () => { m.remove(); Client.send({ t: 'call-decline' }); };
    m.querySelector('#call-yes').onclick = async () => { m.remove(); try { await this.ensureStream(); } catch (e) { Client.send({ t: 'call-decline' }); return; } if (this.mode === 'ptt' && this.live) this.pttEnd(); this.mode = 'call'; this.applyTrackState(); Client.send({ t: 'call-accept' }); this.callAll(); toast('In chiamata'); };
  },
  onAccept(seat) { if (seat !== App.mySeat) { toast(`${this.nameOf(seat)} ha accettato la chiamata`); this.callAll(); } },
  onDecline(seat) { if (seat !== App.mySeat) toast(`${this.nameOf(seat)} ha rifiutato la chiamata`); },
  onEnd(seat) { if (seat !== App.mySeat) toast(`${this.nameOf(seat)} ha chiuso la chiamata`); },
  async setMode(m) {
    if (App.mode === 'solo') { toast('La voce funziona solo con giocatori online'); return; }
    if (m === this.mode) m = 'off';
    if (m !== 'off') { try { await this.ensureStream(); } catch (e) { return; } }
    if (this.mode === 'ptt' && this.live) this.pttEnd();
    this.mode = m; this.applyTrackState();
    if (m === 'ptt') toast('Walkie-talkie: tieni premuto per parlare, lascia per ascoltare'); else if (m === 'off') toast('Microfono spento');
  },
  pttStart() { if (this.mode !== 'ptt' || this.live || this.muted) return; this.live = true; this.applyTrackState(); Sound.play('ptt'); Client.send({ t: 'ptt', on: true }); },
  pttEnd() { if (!this.live) return; this.live = false; this.applyTrackState(); Client.send({ t: 'ptt', on: false }); },
  ui() {
    $('#btn-call').classList.toggle('on', this.mode === 'call');
    $('#btn-ptt').classList.toggle('on', this.mode === 'ptt');
    $('#btn-ptt').classList.toggle('live', this.live);
    $('#btn-ptt').querySelector('.lbl').textContent = this.live ? 'Stai parlando…' : 'Walkie-talkie';
    $('#btn-call').querySelector('.lbl').textContent = this.mode === 'call' ? 'In chiamata' : 'Chiamata';
    $('#btn-mute').classList.toggle('on', this.muted);
    $('#btn-mute').textContent = this.muted ? '🔇' : '🎤';
  },
};

/* =====================================================================
   Avvio, eventi UI
   ===================================================================== */
function seg(id, cb) {
  const el = $(id);
  // pastiglia che scivola sotto l'opzione scelta
  let thumb = el.querySelector('.thumb'); if (!thumb) { thumb = document.createElement('span'); thumb.className = 'thumb'; el.prepend(thumb); }
  const place = (animate = true) => { const on = el.querySelector('button.on'); if (!on) return; if (!animate) thumb.style.transition = 'none'; thumb.style.left = on.offsetLeft + 'px'; thumb.style.width = on.offsetWidth + 'px'; if (!animate) requestAnimationFrame(() => { thumb.style.transition = ''; }); };
  const choose = (b, animate = true) => { if (!b || b.classList.contains('on')) { place(animate); return; } el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); place(animate); cb(b.dataset.v); };
  el.querySelectorAll('button').forEach(b => b.onclick = () => choose(b));
  // trascinamento: la pastiglia segue il dito e si aggancia all'opzione più vicina
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (document.documentElement.classList.contains('theme-memphis')) return;
    const on = el.querySelector('button.on'); if (!on) return;
    drag = { x0: e.clientX, left0: on.offsetLeft, w: on.offsetWidth, moved: false, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0; if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true; thumb.style.transition = 'none'; el.classList.add('dragging');
    const min = 4, max = el.clientWidth - drag.w - 4;
    const left = Math.max(min, Math.min(max, drag.left0 + dx));
    thumb.style.left = left + 'px';
    // evidenzia l'opzione sotto la pastiglia
    const cx = left + drag.w / 2; let best = null, bd = 1e9;
    el.querySelectorAll('button').forEach(b => { const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = b; } });
    el.querySelectorAll('button').forEach(b => b.classList.toggle('near', b === best));
  });
  const end = e => {
    if (!drag) return; const was = drag; drag = null; el.classList.remove('dragging'); thumb.style.transition = '';
    el.querySelectorAll('button').forEach(b => b.classList.remove('near'));
    if (!was.moved) return;                             // era un tocco: ci pensa il click
    const cx = parseFloat(thumb.style.left) + was.w / 2; let best = null, bd = 1e9;
    el.querySelectorAll('button').forEach(b => { const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = b; } });
    choose(best, true);
    el._suppressClick = true; setTimeout(() => { el._suppressClick = false; }, 50);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => { if (el._suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  const ready = () => { place(false); el.classList.add('ready'); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(ready)); else requestAnimationFrame(ready);
  if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(el);
  window.addEventListener('resize', () => place(false));
}
/* onda luminosa al tocco sui pulsanti della home */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('#scr-home .btn'); if (!b || document.documentElement.classList.contains('theme-memphis')) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
  const rp = document.createElement('span'); rp.className = 'ripple'; rp.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${d}px;height:${d}px`;
  b.appendChild(rp); setTimeout(() => rp.remove(), 600);
}, { passive: true });
/* le schede si inclinano verso il dito (solo con il mouse o un tocco fermo) */
(() => {
  const cards = $$('#scr-home .home-cards .panel');
  cards.forEach(card => {
    const move = e => { if (document.documentElement.classList.contains('theme-memphis')) return; const r = card.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; card.classList.add('tilt'); card.style.transform = `perspective(900px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg) translateY(-2px)`; };
    const reset = () => { card.classList.remove('tilt'); card.style.transform = ''; };
    card.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') move(e); });
    card.addEventListener('pointerleave', reset); card.addEventListener('pointercancel', reset); card.addEventListener('pointerup', reset);
  });
})();
seg('#seg-players', v => App.cfg.players = +v);
seg('#seg-target', v => App.cfg.target = +v);
const savedName = Store.get('cpz-name') || '';
$('#host-name').value = savedName; $('#join-name').value = savedName;
// il nome si salva mentre lo scrivi, non solo quando premi un pulsante
['#host-name', '#join-name'].forEach(sel => $(sel).addEventListener('input', e => { const v = e.target.value.trim(); if (v) Store.set('cpz-name', v); }));
function applyName() {
  const n = (Store.get('cpz-name') || '').trim();
  $$('.name-field').forEach(f => f.classList.toggle('hidden', !!n));
  $('#hello').classList.toggle('hidden', !n);
  if (n) { $('#hello-name').textContent = n; $('#host-name').value = n; $('#join-name').value = n; }
}
applyName();

const myName = () => ($('#host-name').value.trim() || $('#join-name').value.trim() || Store.get('cpz-name') || '').trim();
const hashCode = (location.hash || '').replace('#', '').toUpperCase();
if (hashCode && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
if (/^[A-Z0-9]{6}$/.test(hashCode)) { $('#join-code').value = hashCode; }
// nessun campo prende il fuoco all'apertura o al ritorno nell'app: la tastiera compare solo quando tocchi un campo
function blurAll() { try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (e) {} }
/* quando un campo prende il fuoco, resta visibile sopra la tastiera */
document.addEventListener('focusin', e => { const el = e.target; if (el && el.tagName === 'INPUT') setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {} }, 250); });
blurAll();
// animazione di benvenuto nella home (ogni volta che si apre l'app, una sola volta per apertura)
(() => { const h = $('#scr-home'); h.classList.add('intro'); setTimeout(() => h.classList.remove('intro'), 2600); })();
// niente tastiera all'apertura; ma mai togliere il fuoco a un campo che l'utente ha appena toccato
let lastTouch = 0; document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true); document.addEventListener('touchstart', () => { lastTouch = Date.now(); }, { capture: true, passive: true });
const blurSoft = () => { if (Date.now() - lastTouch > 1200) blurAll(); };
window.addEventListener('load', blurAll);
window.addEventListener('pageshow', blurSoft);
document.addEventListener('visibilitychange', () => { if (!document.hidden) blurSoft(); });

function needName(input) { const n = myName(); if (!n) { $$('.name-field').forEach(f => f.classList.remove('hidden')); input.focus(); toast('Scrivi prima il tuo nome'); return null; } Store.set('cpz-name', n); applyName(); return n; }
$('#btn-host').onclick = () => { const name = needName($('#host-name')); if (name) hostRoom({ players: App.cfg.players, target: App.cfg.target }, name, false); };
$('#btn-solo').onclick = () => { const name = needName($('#host-name')); if (name) hostRoom({ players: App.cfg.players, target: App.cfg.target }, name, true); };
$('#btn-join').onclick = () => { const code = $('#join-code').value.trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(code)) { $('#join-status').textContent = 'Inserisci il codice di 6 caratteri.'; return; } const name = needName($('#join-name')); if (name) joinRoom(code, name); };
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#btn-rules-home').onclick = () => modal(RULES_HTML);
$('#btn-settings-home').onclick = () => openSettings();
$('#btn-rules').onclick = () => openSettings();
function openSettings() {
  const m = modal(`<h2>Impostazioni</h2>
    <div class="field"><label for="opt-name">Il tuo nome</label><input id="opt-name" maxlength="16" placeholder="es. Mario Rossi" value="${esc(Store.get('cpz-name') || '')}"></div>
    <div class="field"><label>Tema</label><div class="seg" id="opt-theme"><button data-v="classico" class="${Settings.theme === 'classico' ? 'on' : ''}">Classico · panno verde</button><button data-v="memphis" class="${Settings.theme === 'memphis' ? 'on' : ''}">Memphis · colori pop</button></div></div>
    <label class="opt"><input type="checkbox" id="opt-4col" ${Settings.fourColor ? 'checked' : ''}> <span><b>Carte a quattro colori</b><br><small>♦ rosso, ♥ blu, ♣ verde, ♠ nero: i semi si riconoscono al volo</small></span></label>
    <label class="opt"><input type="checkbox" id="opt-sound" ${Sound.on ? 'checked' : ''}> <span><b>Suoni</b></span></label>
    <details class="backup"><summary>Salvataggi (nome, arcade, storico)</summary>
      <p style="font-size:13px;margin:6px 0">Tutto è salvato su questo telefono e resta anche dopo gli aggiornamenti dell'app. Per portarlo su un altro telefono copia il codice e incollalo lì.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm ghost" id="opt-export">Copia codice di salvataggio</button><button class="btn sm ghost" id="opt-import">Incolla un codice</button></div>
    </details>
    <p style="font-size:12px;color:var(--testo-2);margin:6px 0 0">Versione ${APP_VERSION} · <button class="linkish" id="opt-update" style="font-size:12px">Controlla aggiornamenti</button></p>
    <div class="actions"><button class="btn ghost" id="opt-rules">Regole</button><button class="btn" id="opt-close">Salva e chiudi</button></div>`);
  m.querySelector('#opt-update').onclick = () => Updater.check(true);
  m.querySelectorAll('#opt-theme button').forEach(b => b.onclick = () => { Settings.theme = b.dataset.v; m.querySelectorAll('#opt-theme button').forEach(x => x.classList.toggle('on', x === b)); });
  const nameIn = m.querySelector('#opt-name');
  const saveName = () => { const v = nameIn.value.trim(); if (v) { Store.set('cpz-name', v); applyName(); } };
  nameIn.addEventListener('input', saveName);
  m.querySelector('#opt-close').onclick = () => { saveName(); m.remove(); };
  m.querySelector('#opt-export').onclick = () => { const code = Store.exportAll(); (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Codice copiato: incollalo nelle impostazioni dell\'altro telefono'), () => { const ta = document.createElement('textarea'); ta.value = code; ta.style.cssText = 'width:100%;height:80px;margin-top:8px'; m.querySelector('.backup').appendChild(ta); ta.select(); }); };
  m.querySelector('#opt-import').onclick = () => { const box = document.createElement('div'); box.innerHTML = `<input id="imp-code" placeholder="incolla qui il codice" style="width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:#fff"><button class="btn sm oro" id="imp-go" style="margin-top:6px">Importa</button>`; m.querySelector('.backup').appendChild(box); box.querySelector('#imp-go').onclick = () => { if (Store.importAll(box.querySelector('#imp-code').value)) { toast('Salvataggi importati'); setTimeout(() => location.reload(), 800); } else toast('Codice non valido'); }; };
  m.querySelector('#opt-4col').onchange = e => { Settings.fourColor = e.target.checked; if (App.view) { Stage.nodes.forEach(n => { n.dataset.face = ''; }); Stage.render(App.view); } };
  m.querySelector('#opt-sound').onchange = e => { Sound.on = e.target.checked; };
  m.querySelector('#opt-rules').onclick = () => { m.remove(); modal(RULES_HTML); };
}
$('#btn-start').onclick = () => { if (App.mode === 'host') Host.startGame(); };
$('#btn-leave-lobby').onclick = () => { if (App.mode === 'host') Host.broadcast({ t: 'bye' }); Session.clear(); location.hash = ''; location.reload(); };
// rientro automatico: se avevo un tavolo aperto (o ero seduto) e riapro la pagina, torno al mio posto con lo stesso codice
(() => {
  const prev = Session.load();
  if (!prev) return;
  const wantCode = hashCode || prev.code;
  if (wantCode !== prev.code) return;
  const bar = document.createElement('div'); bar.className = 'resume';
  bar.innerHTML = `<span>Eri al tavolo <b>${esc(prev.code)}</b> come <b>${esc(prev.name)}</b>.</span><button class="btn sm oro" id="resume-yes">Rientra</button><button class="btn sm ghost" id="resume-no">No</button>`;
  $('#scr-home .home').prepend(bar);
  bar.querySelector('#resume-no').onclick = () => { Session.clear(); bar.remove(); };
  bar.querySelector('#resume-yes').onclick = () => { bar.remove(); if (prev.mode === 'host') hostRoom(prev.cfg, prev.name, false, prev.code); else joinRoom(prev.code, prev.name); };
})();
const inviteLink = () => location.origin + location.pathname + '#' + App.code;
$('#btn-copy-code').onclick = () => navigator.clipboard.writeText(App.code).then(() => toast('Codice copiato'));
$('#btn-copy-link').onclick = () => navigator.clipboard.writeText(inviteLink()).then(() => toast('Link copiato: mandalo agli amici'));
if (navigator.share) { $('#btn-share').style.display = ''; $('#btn-share').onclick = () => navigator.share({ title: 'Ciapachinze', text: `Vieni a giocare a cirulla! Codice tavolo ${App.code}`, url: inviteLink() }).catch(() => {}); }
$('#btn-side').onclick = () => Side.open();
$('#game .wordmark').onclick = () => { if (App.mode === 'solo' || (App.arcade && App.mode === 'host')) { const m = modal(`<h2>Lasciare il tavolo?</h2><div class="actions"><button class="btn ghost" onclick="this.closest('.modal-bg').remove()">Resta</button><button class="btn" id="leave-yes">Esci</button></div>`); m.querySelector('#leave-yes').onclick = () => { m.remove(); const wasArcade = !!App.arcade; ArcadeUI.leave(); App.mode = null; showScreen(wasArcade ? 'scr-arcade' : 'scr-home'); if (wasArcade) ArcadeUI.open(); }; } };
$('#btn-side-close').onclick = () => Side.close();
$$('.tabs button').forEach(b => b.onclick = () => Side.setTab(b.dataset.tab));
$('#chat-send').onclick = () => { const i = $('#chat-input'); const t = i.value.trim(); if (!t) return; Client.send({ t: 'chat', text: t }); i.value = ''; };
$('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#chat-send').click(); e.stopPropagation(); });
$('#btn-sound').onclick = () => openSettings();
$('#btn-call').onclick = () => Voice.startCall();

$('#btn-mute').onclick = () => { Voice.muted = !Voice.muted; Voice.applyTrackState(); if (!Voice.stream) Voice.ui(); };
const ptt = $('#btn-ptt');
ptt.addEventListener('contextmenu', e => e.preventDefault());
let pttPressed = false;
ptt.addEventListener('pointerdown', async e => {
  pttPressed = true;
  try { ptt.setPointerCapture(e.pointerId); } catch (x) {}
  if (Voice.mode !== 'ptt') { await Voice.setMode('ptt'); }
  if (Voice.mode === 'ptt' && pttPressed) Voice.pttStart();
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => ptt.addEventListener(ev, () => { pttPressed = false; Voice.pttEnd(); }));
window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && Voice.mode === 'ptt') { e.preventDefault(); Voice.pttStart(); } });
window.addEventListener('keyup', e => { if (e.code === 'Space' && Voice.mode === 'ptt') { e.preventDefault(); Voice.pttEnd(); } });
window.addEventListener('blur', () => Voice.pttEnd());
window.addEventListener('beforeunload', () => { if (App.mode === 'host' && Host.players.length > 1) Host.broadcast({ t: 'bye' }); });
Voice.ui();
/* =====================================================================
   ARCADE: mappa, tappe, obiettivi, traguardi
   ===================================================================== */
const ArcadeUI = {
  prog: null, stage: null, dealsPlayed: 0, goalDone: false, bonusDone: false, mode: 'solo',
  open() { this.prog = Arcade.load(); this.renderMap(); showScreen('scr-arcade'); },
  setMode(m) { this.mode = m; this.renderMap(); },
  homeProgress() {
    const p = Arcade.load(); const done = p.stats.stagesDone, tot = Arcade.STAGES.length, stars = Arcade.totalStars(p);
    $('#arcade-progress').innerHTML = `<span>${done}/${tot} tappe</span><div class="bar"><i style="width:${Math.round(done / tot * 100)}%"></i></div><span>★ ${stars}</span>`;
    $('#btn-arcade').textContent = done === 0 ? 'Parti da Ventimiglia' : done >= tot ? 'Rigioca il giro' : 'Continua il giro';
  },
  renderMap() {
    const p = this.prog; const list = Arcade.stagesFor(this.mode);
    const tot = list.reduce((a, st) => a + (p.stars[st.id] || 0), 0), done = list.filter(st => (p.stars[st.id] || 0) >= 1).length;
    $('#stars-total').textContent = `★ ${tot} / ${list.length * 3}`;
    $('#arcade-note').textContent = this.mode === 'coop' ? 'A coppie: apri il tavolo, invita un amico con il codice e affrontate insieme due computer.' : '';
    $('#arcade-summary').innerHTML = `<div class="sum"><b>${done}</b><span>tappe su ${list.length}</span></div><div class="sum"><b>${tot}</b><span>stelle su ${list.length * 3}</span></div><div class="sum"><b>${p.unlocked.length}</b><span>traguardi</span></div>`;
    const map = $('#map'); map.innerHTML = '';
    // sentiero verticale che scende: una tappa per riga, leggera onda a sinistra/destra
    const W = Math.min(map.clientWidth || 360, 520), stepY = 104, padY = 60, n = list.length;
    const H = padY * 2 + stepY * (n - 1);
    const amp = Math.min(70, W * 0.16);
    const pts = list.map((st, i) => ({ x: W / 2 + amp * Math.sin(i * 0.9), y: padY + i * stepY }));
    const curve = (upto) => { let d = `M ${pts[0].x} ${pts[0].y}`; for (let i = 1; i <= upto; i++) { const a = pts[i - 1], b = pts[i]; const cy = (a.y + b.y) / 2; d += ` C ${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${b.y}`; } return d; };
    let lastDoneIdx = -1; list.forEach((st, i) => { if ((p.stars[st.id] || 0) >= 1) lastDoneIdx = i; });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.classList.add('path-map');
    let bands = '';
    Arcade.ZONES.forEach((z, zi) => { const idx = list.map((st, i) => st.zone === zi ? i : -1).filter(i => i >= 0); if (!idx.length) return; const y1 = pts[idx[0]].y - stepY / 2, y2 = pts[idx[idx.length - 1]].y + stepY / 2; bands += `<rect x="0" y="${Math.max(0, y1)}" width="${W}" height="${Math.min(H, y2) - Math.max(0, y1)}" rx="18" fill="${z.color}" opacity=".08"/><text x="${W - 14}" y="${Math.max(0, y1) + 22}" text-anchor="end" class="zone-lbl" fill="${z.color}">${esc(z.name)}</text>`; });
    svg.innerHTML = `${bands}<path d="${curve(n - 1)}" class="trail"/>${lastDoneIdx >= 0 ? `<path d="${curve(Math.min(lastDoneIdx + 1, n - 1))}" class="trail done"/>` : ''}`;
    map.appendChild(svg);
    let nextFound = false;
    list.forEach((st, i) => {
      const stars = p.stars[st.id] || 0, unlocked = Arcade.isUnlockedIn(p, list, st.id);
      const isNext = unlocked && stars === 0 && !nextFound; if (isNext) nextFound = true;
      const b = document.createElement('button'); b.className = 'node' + (stars ? ' done' : '') + (isNext ? ' next' : '') + (unlocked ? '' : ' locked') + (st.players === 4 ? ' four' : '');
      b.style.left = pts[i].x + 'px'; b.style.top = pts[i].y + 'px'; b.disabled = !unlocked;
      const side = pts[i].x < W / 2 ? 'r' : 'l';
      const lock = '<svg viewBox="0 0 20 20" width="18" height="18"><rect x="4" y="9" width="12" height="9" rx="2" fill="currentColor"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      b.innerHTML = `<span class="pin">${unlocked ? (stars ? '★' : (i + 1)) : lock}</span><span class="lbl ${side}"><b>${esc(st.town)}</b><i>${'★'.repeat(stars)}<em>${'★'.repeat(3 - stars)}</em></i></span>`;
      b.onclick = () => this.brief(st);
      map.appendChild(b);
    });
    // la pagina parte sempre dall'alto (titolo), senza saltare alla tappa corrente
    const scr = $('#scr-arcade'); if (scr) scr.scrollTop = 0;
  },
  brief(st) {
    const stars = this.prog.stars[st.id] || 0;
    const list = Arcade.stagesFor(this.mode);
    const m = modal(`<h2>${esc(st.town)}<small>Tappa ${list.indexOf(st) + 1} · contro ${esc(st.who)}</small></h2>
      <div class="stars-brief">
        <div class="${stars >= 1 ? 'ok' : ''}"><span>★</span><span>${esc(Arcade.goalText(st.goal))}${st.handicap ? ` (lui parte da ${st.handicap})` : ''}</span></div>
        <div class="${stars >= 2 ? 'ok' : ''}"><span>★★</span><span>${esc(Arcade.goalText(st.star2))}</span></div>
        <div class="${stars >= 3 ? 'ok' : ''}"><span>★★★</span><span>${esc(Arcade.goalText(st.bonus))}</span></div>
      </div>
      <p style="font-size:13px;color:var(--testo-2)">${st.deals ? (st.deals === 1 ? 'Una smazzata' : st.deals + ' smazzate') : 'Partita a ' + st.target} · computer ${['ingenuo', 'medio', 'furbo', 'campione'][st.level]}</p>
      <div class="actions"><button class="btn ghost" onclick="this.closest('.modal-bg').remove()">Indietro</button><button class="btn oro" id="stage-go">${this.mode === 'coop' ? 'Apri il tavolo e invita' : 'Gioca'}</button></div>`);
    m.querySelector('#stage-go').onclick = () => { m.remove(); this.mode === 'coop' ? this.startCoop(st) : this.start(st); };
  },
  start(st) {
    this.stage = st; this.dealsPlayed = 0; this.goalDone = false; this.bonusDone = false; this.star2Done = false; this.marginBest = -99; this.t0 = Date.now();
    const names = st.players === 4 ? [st.who.split(' ')[0].replace(/^(il|la|lo|i|le|l')$/i, st.who), 'Compagno', st.who] : [st.who];
    const botNames = st.players === 4 ? ['Avversario 1', 'Il tuo compagno', 'Avversario 2'] : [st.who];
    if (st.players === 4) { botNames[0] = st.who; botNames[2] = st.who + ' 2'; }
    App.seenEventId = 0; App.view = null;
    hostRoom({ players: st.players, target: st.target || 999, arcade: { id: st.id, handicap: st.handicap || 0, deals: st.deals || 0 }, botLevel: st.level, botNames }, Store.get('cpz-name') || 'Tu', true);
    App.mode = 'solo'; App.arcade = st;
    setTimeout(() => this.goalbar(), 50);
  },
  startCoop(st) {
    this.stage = st; this.dealsPlayed = 0; this.goalDone = false; this.bonusDone = false; this.star2Done = false; this.marginBest = -99; this.t0 = Date.now();
    App.seenEventId = 0; App.view = null; App.arcade = st;
    const name = Store.get('cpz-name') || 'Tu';
    hostRoom({ players: 4, target: st.target || 999, arcade: { id: st.id, handicap: st.handicap || 0, deals: st.deals || 0, coop: true }, botLevel: st.level }, name, false);
    // due avversari computer ai posti 1 e 3; il posto 2 (il mio compagno) resta per l'amico
    setTimeout(() => { Host.addBot(1); Host.addBot(3); const b1 = Host.players.find(p => p.seat === 1), b3 = Host.players.find(p => p.seat === 3); if (b1) { b1.name = st.who; b1.level = st.level; } if (b3) { b3.name = st.who + ' 2'; b3.level = st.level; } Host.broadcastLobby(); }, 50);
    setTimeout(() => { $('#lobby-info').textContent = `Arcade a coppie · ${st.town}: ${Arcade.goalText(st.goal)}. Invita un amico con il link: sarà il tuo compagno.`; }, 120);
  },
  goalbar() {
    let g = $('#goalbar'); if (!g) { g = document.createElement('div'); g.id = 'goalbar'; g.className = 'goalbar'; $('#stage-wrap').appendChild(g); }
    const st = this.stage; if (!st) { g.classList.add('hidden'); return; }
    if (!st.star2) Arcade.stagesFor(st.coop || st.players === 4 && Arcade.COOP_STAGES.includes(st) ? 'coop' : 'solo');
    g.classList.remove('hidden');
    const deals = st.deals && st.deals > 1 ? `<span class="n">${Math.min(this.dealsPlayed + 1, st.deals)}/${st.deals}</span>` : '';
    const k = (this.goalDone ? 1 : 0) + (this.star2Done ? 1 : 0) + (this.bonusDone ? 1 : 0);
    g.innerHTML = `<button class="goalbtn" type="button" aria-label="Obiettivi della tappa"><span class="s">${'★'.repeat(k)}<i>${'★'.repeat(3 - k)}</i></span>${deals}</button>
      <div class="goalpop">
        <b class="town">${esc(st.town)}</b>
        <div class="${this.goalDone ? 'ok' : ''}"><span>★</span><span>${esc(Arcade.goalText(st.goal))}${st.handicap ? ` (lui parte da ${st.handicap})` : ''}</span><em>fatto</em></div>
        <div class="${this.star2Done ? 'ok' : ''}"><span>★★</span><span>${esc(Arcade.goalText(st.star2))}</span><em>fatto</em></div>
        <div class="${this.bonusDone ? 'ok' : ''}"><span>★★★</span><span>${esc(Arcade.goalText(st.bonus))}</span><em>fatto</em></div>
        ${st.deals > 1 ? `<small>Smazzata ${Math.min(this.dealsPlayed + 1, st.deals)} di ${st.deals}</small>` : st.deals ? '' : `<small>Partita a ${st.target}</small>`}
      </div>`;
    const btn = g.querySelector('.goalbtn');
    btn.onclick = e => { e.stopPropagation(); g.classList.toggle('open'); Sound.play('tap'); };
    if (!g._bound) { g._bound = true; document.addEventListener('pointerdown', e => { if (!g.contains(e.target)) g.classList.remove('open'); }); }
  },
  /* durante la smazzata: le condizioni che, una volta vere, restano vere (scope, settebello, piccola, grande, buona) si spuntano subito */
  LIVE: { scope: 1, settebello: 1, piccola: 1, grande: 1, buona: 1 },
  liveCheck(view) {
    const st = this.stage; if (!st || !view.captured) return;
    let partial; try { partial = C.scoreDeal(view.captured, view.scope, view.cfg); } catch (e) { return; }
    partial.buone = view.buone || [];
    const my = C.teamOf(view, App.mySeat), ot = 1 - my;
    const ctx = { deal: partial, my, ot, mySeats: view.teams[my], scores: view.scores, won: false, elapsed: null };
    let changed = false;
    const test = (g, flag) => { if (!g || this[flag] || !this.LIVE[g[0]]) return; if (Arcade.goalCheck(g, ctx)) { this[flag] = true; changed = true; } };
    test(st.goal, 'goalDone'); test(st.star2, 'star2Done'); test(st.bonus, 'bonusDone');
    if (changed) { this.goalbar(); const b = $('#goalbar .goalbtn'); if (b) { b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 900); } }
  },
  /* chiamato a fine smazzata (solo mode arcade) → ritorna true se la tappa è finita */
  onDealEnd(view) {
    const st = this.stage; if (!st) return false;
    const my = C.teamOf(view, App.mySeat), ot = 1 - my; const d = view.lastDeal;
    const mySeats = view.teams[my];
    const won = view.phase === 'gameEnd' && view.winner === my;
    const ctx = { deal: d, my, ot, mySeats, scores: view.scores, won, elapsed: Math.round((Date.now() - this.t0) / 1000) };
    this.dealsPlayed++;
    if (Arcade.goalCheck(st.goal, ctx)) this.goalDone = true;
    if (st.star2 && Arcade.goalCheck(st.star2, ctx)) this.star2Done = true;
    if (Arcade.goalCheck(st.bonus, ctx)) this.bonusDone = true;
    const margin = d.teams[my].total - d.teams[ot].total; if (margin > this.marginBest) this.marginBest = margin;
    const fresh = Arcade.recordDeal(this.prog, d, my, mySeats);
    this.toastAch(fresh);
    const finished = st.deals ? (this.goalDone || this.dealsPlayed >= st.deals) : (view.phase === 'gameEnd');
    if (!finished) { this.goalbar(); return false; }
    this.goalbar();
    // stelle: 1 = obiettivo, +1 = seconda condizione, +1 = terza condizione (solo se l'obiettivo è fatto)
    let stars = 0;
    if (this.goalDone) { stars = 1 + (this.star2Done ? 1 : 0) + (this.bonusDone ? 1 : 0); }
    this.starsDetail = { goal: this.goalDone, s2: this.star2Done, s3: this.bonusDone };
    const fresh2 = Arcade.recordStage(this.prog, st, stars);
    this.toastAch(fresh2);
    this.result = { stars, won: stars > 0 };
    if (App.mode === 'host') Host.broadcast({ t: 'stage-result', stars, town: st.town, who: st.who, goal: Arcade.goalText(st.goal) });
    return true;
  },
  toastAch(list) {
    (list || []).forEach((a, i) => setTimeout(() => {
      const t = document.createElement('div'); t.className = 'ach-toast'; t.innerHTML = `<span class="ic">${a.icon}</span><div><b>Traguardo: ${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
      document.body.appendChild(t); Sound.play('scopa'); setTimeout(() => t.remove(), 3800);
    }, i * 1200));
  },
  showResult(view) {
    const st = this.stage, r = this.result; const nextSt = Arcade.STAGES.find(x => x.id === st.id + 1);
    const m = modal(`<h2>${r.won ? 'Tappa superata!' : 'Tappa fallita'}<small>${esc(st.town)} · ${esc(st.who)}</small></h2>
      <div class="stars-big">${'★'.repeat(r.stars)}<span class="off">${'★'.repeat(3 - r.stars)}</span></div>
      <div class="starlist">
        <div class="${this.starsDetail.goal ? 'ok' : ''}"><span>★</span>${esc(Arcade.goalText(st.goal))}</div>
        <div class="${this.starsDetail.goal && this.starsDetail.s2 ? 'ok' : ''}"><span>★</span>${esc(Arcade.goalText(st.star2))}</div>
        <div class="${this.starsDetail.goal && this.starsDetail.s3 ? 'ok' : ''}"><span>★</span>${esc(Arcade.goalText(st.bonus))}</div>
      </div>
      <div class="actions"><button class="btn ghost" id="res-map">Mappa</button><button class="btn" id="res-retry">${r.won ? 'Rigioca' : 'Riprova'}</button>${r.won && nextSt ? `<button class="btn oro" id="res-next">Prossima: ${esc(nextSt.town)}</button>` : ''}</div>`, { closable: false });
    m.querySelector('.modal').classList.add(r.won ? 'won' : 'lost');
    if (r.won) Stage.sparks();
    m.querySelector('#res-map').onclick = () => { m.remove(); this.leave(); this.open(); };
    m.querySelector('#res-retry').onclick = () => { m.remove(); this.leave(); this.start(st); };
    const nb = m.querySelector('#res-next'); if (nb) nb.onclick = () => { m.remove(); this.leave(); this.start(nextSt); };
  },
  leave() {
    if (App.mode === 'host' && App.peer) { try { Host.broadcast({ t: 'bye' }); App.peer.destroy(); } catch (e) {} App.peer = null; Session.clear(); }
    this.stage = null; App.arcade = null; App.view = null; App.seenEventId = 0;
    clearTimeout(Host.botTimer); Host.game = null;
    Stage.nodes.forEach(n => n.remove()); Stage.nodes.clear(); Stage.playerEls.forEach(e => e.remove()); Stage.playerEls.clear();
    $$('#modals .modal-bg').forEach(x => x.remove());
    const g = $('#goalbar'); if (g) g.classList.add('hidden');
    this.homeProgress();
  },
};
$('#btn-arcade').onclick = () => ArcadeUI.open();
seg('#arcade-mode', v => ArcadeUI.setMode(v));
$('#arcade-back').onclick = () => { showScreen('scr-home'); ArcadeUI.homeProgress(); };
$('#btn-achievements').onclick = () => {
  const p = Arcade.load();
  modal(`<h2>Traguardi<small>${p.unlocked.length} su ${Arcade.ACHIEVEMENTS.length}</small></h2><div class="ach-grid">${Arcade.ACHIEVEMENTS.map(a => `<div class="ach ${p.unlocked.includes(a.id) ? '' : 'locked'}"><div class="ic">${a.icon}</div><div class="nm">${esc(a.name)}</div><div class="ds">${esc(a.desc)}</div></div>`).join('')}</div><div class="actions"><button class="btn" onclick="this.closest('.modal-bg').remove()">Chiudi</button></div>`);
};
ArcadeUI.homeProgress();
applyTheme();
Store.restore().then(changed => { if (changed) { applyName(); ArcadeUI.homeProgress(); applyTheme(); } Store.mirror(); });
/* 2 vs 2 sul telefono: si gioca in orizzontale */
function updateOrientation() {
  const four = (App.view && App.view.cfg.players === 4) || (!App.view && App.cfg && App.cfg.players === 4 && (App.mode === 'host' || App.mode === 'guest' || App.mode === 'solo'));
  const portraitPhone = window.innerWidth < 640 && window.innerWidth <= window.innerHeight;
  const showRotate = four && portraitPhone && !App.rotateSkipped;
  $('#rotate').classList.toggle('hidden', !showRotate);
  $('#game').classList.toggle('landscape', !!(four && !portraitPhone && window.innerHeight < 520));
  if (App.pendingStart && !showRotate && App.mode === 'solo' && !Host.started) { App.pendingStart = false; setTimeout(() => Host.startGame(), 350); }
}
/* dopo una rotazione: riporta la finestra a zero, togli il fuoco e ridisegna il tavolo con le misure nuove */
let lastW = window.innerWidth;
function afterRotate() {
  // solo per una vera rotazione (cambia la larghezza): l'apertura della tastiera cambia solo l'altezza e non deve togliere il fuoco al campo
  const rotated = window.innerWidth !== lastW; lastW = window.innerWidth;
  updateOrientation();
  if (!rotated) return;
  try { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) {}
  if (document.activeElement && document.activeElement.blur && document.activeElement.tagName !== 'BODY') document.activeElement.blur();
  if (App.view && !$('#game').classList.contains('hidden') && !(processing || queue.length)) { try { Stage.render(App.view); } catch (e) {} }
}
let rotateTimer = null;
window.addEventListener('resize', () => { updateOrientation(); clearTimeout(rotateTimer); rotateTimer = setTimeout(afterRotate, 120); });
window.addEventListener('orientationchange', () => { setTimeout(afterRotate, 80); setTimeout(afterRotate, 450); });
try { matchMedia('(orientation: portrait)').addEventListener('change', () => setTimeout(updateOrientation, 50)); } catch (e) {}
/* "Continua in verticale": reagisce al tocco (anche se iOS, dopo la rotazione, non consegna il click) */
{
  const skip = () => { App.rotateSkipped = true; updateOrientation(); };
  const btn = $('#rotate-skip');
  btn.onclick = skip;
  btn.addEventListener('touchend', e => { e.preventDefault(); skip(); }, { passive: false });
  btn.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') skip(); });
}
/* aggiornamenti: se online c'è una versione più nuova, ricarica (solo quando non si sta giocando) */
const Updater = {
  async check(manual) {
    try {
      const r = await fetch(location.pathname.replace(/[^/]*$/, '') + 'index.html?nocache=' + Date.now(), { cache: 'no-store' });
      const txt = await r.text(); const m = txt.match(/app\.js\?v=(\d+)/); const latest = m ? m[1] : null;
      if (latest && latest !== APP_VERSION) {
        // mai ricaricare da soli: si avvisa e si lascia scegliere
        if (this.shown) return; this.shown = true;
        const t = document.createElement('div'); t.className = 'toast update'; t.innerHTML = `Nuova versione disponibile <button class="btn sm oro" id="upd-go">Aggiorna</button>`;
        $('#toasts').appendChild(t);
        t.querySelector('#upd-go').onclick = () => { location.reload(); };
        setTimeout(() => t.remove(), 12000);
      } else if (manual) toast('Hai già l\'ultima versione');
    } catch (e) { if (manual) toast('Non riesco a controllare adesso'); }
  },
};
setTimeout(() => Updater.check(false), 4000);
// service worker: la pagina e i file si prendono sempre dalla rete quando c'è, dalla copia locale quando non c'è
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); }); }
window.__cpz = { App, Host, Client, Stage, Voice, C, ArcadeUI, Store, Sound, busy: () => processing || queue.length > 0 };
})();

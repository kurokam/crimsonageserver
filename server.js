'use strict';
// Kızıl Çağ çevrimiçi sunucusu: liderlik tablosu + oyuncular arası eşya takası.
// Bağımlılık yok (yalnızca Node'un kendi modülleri). Çalıştırma: node server.js   (PORT, DATA_FILE, TRUST_PROXY ortam değişkenleri)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEROES = ['gorak', 'golge', 'saman', 'avci', 'muhafiz', 'zehir', 'ozan', 'kan'];
const SLOTS = ['weapon', 'armor', 'charm'];
const LIMITS = { body: 16 * 1024, players: 200000, offer: 6, roomTtl: 15 * 60 * 1000, doneTtl: 10 * 60 * 1000, rate: 300, rateWin: 60 * 1000, regPerHour: 10 };

function start(opts = {}) {
  const dataFile = opts.dataFile || process.env.DATA_FILE || path.join(__dirname, 'data.json');
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  let db = { players: {} };
  try { db = JSON.parse(fs.readFileSync(dataFile, 'utf8')); if (!db.players) db = { players: {} }; } catch (e) { /* ilk çalıştırma */ }
  let saveT = null;
  const persist = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { fs.writeFileSync(dataFile + '.tmp', JSON.stringify(db)); fs.renameSync(dataFile + '.tmp', dataFile); } catch (e) { console.error('Kayıt yazılamadı:', e.message); }
    }, 500);
    if (saveT.unref) saveT.unref();
  };
  const rooms = new Map();      // kod -> oda
  const inRoom = new Map();     // oyuncu id -> kod
  const hits = new Map();       // ip -> [zaman]
  const regs = new Map();       // ip -> [zaman]

  const hash = t => crypto.createHash('sha256').update(t).digest('hex');
  const rid = n => crypto.randomBytes(n).toString('hex');
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const cleanName = s => {
    if (typeof s !== 'string') return null;
    const n = s.trim().replace(/\s+/g, ' ');
    return /^[\p{L}\p{N} _.-]{2,16}$/u.test(n) ? n : null;
  };
  const rateOk = (map, ip, max, win) => {
    const now = Date.now(), a = (map.get(ip) || []).filter(t => now - t < win);
    if (a.length >= max) { map.set(ip, a); return false; }
    a.push(now); map.set(ip, a); return true;
  };
  const sweep = () => {
    const now = Date.now();
    rooms.forEach((r, code) => {
      if (now - r.created > LIMITS.roomTtl || (r.status !== 'open' && now - r.ended > LIMITS.doneTtl)) {
        r.players.forEach(p => { if (inRoom.get(p.id) === code) inRoom.delete(p.id); });
        rooms.delete(code);
      }
    });
    hits.forEach((a, ip) => { if (!a.length || now - a[a.length - 1] > LIMITS.rateWin) hits.delete(ip); });
    regs.forEach((a, ip) => { if (!a.length || now - a[a.length - 1] > 3600e3) regs.delete(ip); });
  };
  const sweeper = setInterval(sweep, 30000); if (sweeper.unref) sweeper.unref();

  const validItem = it => it && typeof it === 'object' && SLOTS.includes(it.slot) && isInt(it.rar, 0, 3) && isInt(it.val, 1, 100000) &&
    HEROES.includes(it.hero) && isInt(it.pi, 0, 30) && isInt(it.bi, 0, 30);
  const pickItem = it => ({ slot: it.slot, rar: it.rar, val: it.val, hero: it.hero, pi: it.pi, bi: it.bi });
  const auth = b => {
    if (!b || typeof b.id !== 'string' || typeof b.token !== 'string' || b.token.length > 100) return null;
    const p = db.players[b.id]; if (!p) return null;
    const a = Buffer.from(hash(b.token)), c = Buffer.from(p.token);
    return a.length === c.length && crypto.timingSafeEqual(a, c) ? p : null;
  };
  const roomView = (r, pid) => {
    const me = r.players.find(p => p.id === pid), other = r.players.find(p => p.id !== pid);
    return { status: r.status, rev: r.rev, tradeId: r.tradeId || null, you: { offer: me.offer, ok: me.ok }, them: other ? { name: db.players[other.id].name, offer: other.offer, ok: other.ok } : null };
  };
  const newCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (let t = 0; t < 50; t++) { let c = ''; const b = crypto.randomBytes(5); for (let i = 0; i < 5; i++) c += A[b[i] % A.length]; if (!rooms.has(c)) return c; } return null; };
  const leave = pid => {
    const code = inRoom.get(pid); if (!code) return;
    inRoom.delete(pid);
    const r = rooms.get(code);
    if (r && r.status === 'open') { r.status = 'cancelled'; r.ended = Date.now(); r.players.forEach(p => { if (inRoom.get(p.id) === code) inRoom.delete(p.id); }); }
  };

  // ---- rotalar ----
  const routes = {
    'POST /api/register': (b, ip) => {
      if (!rateOk(regs, ip, LIMITS.regPerHour, 3600e3)) return [429, { error: 'rate' }];
      const name = cleanName(b.name); if (!name) return [400, { error: 'name' }];
      if (Object.keys(db.players).length >= LIMITS.players) return [503, { error: 'full' }];
      const id = rid(8), token = rid(24);
      db.players[id] = { name, token: hash(token), tower: 0, wave: 0, created: Date.now(), last: 0 };
      persist(); return [200, { id, token, name }];
    },
    'POST /api/rename': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const name = cleanName(b.name); if (!name) return [400, { error: 'name' }];
      p.name = name; persist(); return [200, { name }];
    },
    'POST /api/score': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      if (!isInt(b.tower, 0, 1000) || !isInt(b.wave, 0, 10000)) return [400, { error: 'value' }];
      const now = Date.now(); if (now - p.last < 4000) return [429, { error: 'rate' }];
      p.last = now; p.tower = Math.max(p.tower, b.tower); p.wave = Math.max(p.wave, b.wave); persist();
      return [200, { tower: p.tower, wave: p.wave }];
    },
    'POST /api/trade/create': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      leave(b.id);
      const code = newCode(); if (!code) return [503, { error: 'busy' }];
      rooms.set(code, { code, created: Date.now(), status: 'open', rev: 1, players: [{ id: b.id, offer: [], ok: false }] });
      inRoom.set(b.id, code); return [200, { code }];
    },
    'POST /api/trade/join': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '', r = rooms.get(code);
      if (!r || r.status !== 'open') return [404, { error: 'room' }];
      if (r.players.some(x => x.id === b.id)) return [200, { code }];
      if (r.players.length >= 2) return [409, { error: 'full' }];
      leave(b.id); r.players.push({ id: b.id, offer: [], ok: false }); r.rev++; inRoom.set(b.id, code);
      return [200, { code }];
    },
    'POST /api/trade/state': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const r = rooms.get(typeof b.code === 'string' ? b.code.toUpperCase() : '');
      if (!r || !r.players.some(x => x.id === b.id)) return [404, { error: 'room' }];
      return [200, roomView(r, b.id)];
    },
    'POST /api/trade/offer': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const r = rooms.get(typeof b.code === 'string' ? b.code.toUpperCase() : '');
      const me = r && r.players.find(x => x.id === b.id);
      if (!me) return [404, { error: 'room' }];
      if (r.status !== 'open') return [409, { error: 'closed' }];
      if (!Array.isArray(b.items) || b.items.length > LIMITS.offer || !b.items.every(validItem)) return [400, { error: 'items' }];
      me.offer = b.items.map(pickItem);
      r.players.forEach(x => { x.ok = false; }); r.rev++;       // teklif değişince onaylar sıfırlanır
      return [200, roomView(r, b.id)];
    },
    'POST /api/trade/confirm': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const r = rooms.get(typeof b.code === 'string' ? b.code.toUpperCase() : '');
      const me = r && r.players.find(x => x.id === b.id);
      if (!me) return [404, { error: 'room' }];
      if (r.status !== 'open') return [409, { error: 'closed' }];
      if (r.players.length < 2) return [409, { error: 'alone' }];
      if (b.rev !== r.rev) return [409, { error: 'stale' }];     // onaylanan teklif artık değişmiş
      me.ok = b.ok !== false;
      if (r.players.every(x => x.ok) && r.players.some(x => x.offer.length)) {
        r.status = 'done'; r.ended = Date.now(); r.tradeId = rid(8);
        r.players.forEach(x => { if (inRoom.get(x.id) === r.code) inRoom.delete(x.id); });
      }
      return [200, roomView(r, b.id)];
    },
    'POST /api/trade/cancel': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const r = rooms.get(typeof b.code === 'string' ? b.code.toUpperCase() : '');
      if (r && r.players.some(x => x.id === b.id) && r.status === 'open') { r.status = 'cancelled'; r.ended = Date.now(); r.players.forEach(x => { if (inRoom.get(x.id) === r.code) inRoom.delete(x.id); }); }
      return [200, { ok: true }];
    },
    'GET /api/leaderboard': (b, ip, q) => {
      const board = q.get('board') === 'wave' ? 'wave' : 'tower', me = q.get('id');
      const all = Object.entries(db.players).filter(([, p]) => p[board] > 0).sort((a, c) => c[1][board] - a[1][board] || a[1].created - c[1].created);
      const top = all.slice(0, 50).map(([, p], i) => ({ rank: i + 1, name: p.name, value: p[board] }));
      const idx = me ? all.findIndex(([id]) => id === me) : -1;
      return [200, { board, top, total: all.length, me: idx >= 0 ? { rank: idx + 1, value: all[idx][1][board] } : null }];
    },
    'GET /api/health': () => [200, { ok: true }]
  };

  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
    const send = (code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) }); res.end(s); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    if (!rateOk(hits, ip, LIMITS.rate, LIMITS.rateWin)) { send(429, { error: 'rate' }); return; }
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { send(400, { error: 'url' }); return; }
    const h = routes[req.method + ' ' + url.pathname];
    if (!h) { send(404, { error: 'not_found' }); return; }
    const run = body => { try { const [c, o] = h(body, ip, url.searchParams); send(c, o); } catch (e) { console.error(e); send(500, { error: 'server' }); } };
    if (req.method === 'GET') { run({}); return; }
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > LIMITS.body) { send(413, { error: 'big' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (size > LIMITS.body) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { send(400, { error: 'json' }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(400, { error: 'json' }); return; }
      run(body);
    });
  });
  const port = opts.port ?? Number(process.env.PORT || 8787);
  return new Promise(resolve => server.listen(port, opts.host || process.env.HOST || '0.0.0.0', () => resolve({ server, port: server.address().port, db, rooms, close: () => new Promise(r => { clearInterval(sweeper); clearTimeout(saveT); server.close(r); }) })));
}

module.exports = { start };
if (require.main === module) start().then(s => console.log('Kızıl Çağ sunucusu dinliyor: port ' + s.port));

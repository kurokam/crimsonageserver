'use strict';
// Kızıl Çağ çevrimiçi sunucusu: liderlik tablosu + oyuncular arası eşya takası.
// Bağımlılık yok (yalnızca Node'un kendi modülleri). Çalıştırma: node server.js
// Ortam: PORT, HOST, TRUST_PROXY, DATA_FILE (dosya deposu) veya UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (kalıcı bulut depo; ücretsiz Render için önerilir)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEROES = ['gorak', 'golge', 'saman', 'avci', 'muhafiz', 'zehir', 'ozan', 'kan'];
const SLOTS = ['weapon', 'head', 'armor', 'hands', 'feet', 'charm', 'ring'];
const LIMITS = { body: 16 * 1024, players: 200000, offer: 6, roomTtl: 15 * 60 * 1000, doneTtl: 10 * 60 * 1000, rate: 300, rateWin: 60 * 1000, regPerHour: 30, save: 500 * 1024, saveGap: 15 * 1000 };

// ---- depolama: oyuncu/skor listesi + oyuncu başına kayıt dosyası ----
function fileStore(dataFile) {
  const dir = dataFile + '.saves';
  return {
    kind: 'file',
    loadPlayers: async () => { try { const d = JSON.parse(fs.readFileSync(dataFile, 'utf8')); return d && d.players ? d : { players: {} }; } catch (e) { return { players: {} }; } },
    savePlayers: async db => { fs.writeFileSync(dataFile + '.tmp', JSON.stringify(db)); fs.renameSync(dataFile + '.tmp', dataFile); },
    getBlob: async id => { try { return fs.readFileSync(path.join(dir, id + '.json'), 'utf8'); } catch (e) { return null; } },
    putBlob: async (id, str) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, id + '.json'); fs.writeFileSync(f + '.tmp', str); fs.renameSync(f + '.tmp', f); }
  };
}
function redisStore(url, token, fetchFn) {   // Upstash Redis REST: ücretsiz sunucularda disk silinse de veri kalır
  const call = async cmd => {
    const r = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
    return j.result;
  };
  return {
    kind: 'redis',
    loadPlayers: async () => { const v = await call(['GET', 'kizil:players']); const d = v ? JSON.parse(v) : null; return d && d.players ? d : { players: {} }; },
    savePlayers: async db => { await call(['SET', 'kizil:players', JSON.stringify(db)]); },
    getBlob: async id => call(['GET', 'kizil:save:' + id]),
    putBlob: async (id, str) => { await call(['SET', 'kizil:save:' + id, str]); }
  };
}

async function start(opts = {}) {
  const dataFile = opts.dataFile || process.env.DATA_FILE || path.join(__dirname, 'data.json');
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const rUrl = opts.redisUrl || process.env.UPSTASH_REDIS_REST_URL, rTok = opts.redisToken || process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = rUrl && rTok ? redisStore(rUrl, rTok, opts.fetch || fetch) : fileStore(dataFile);
  let db = { players: {} };
  try { db = await store.loadPlayers(); } catch (e) { console.error('Depo okunamadı, sunucu başlatılmıyor:', e.message); throw e; }   // boş başlayıp mevcut veriyi ezmemek için durur
  let saveT = null, dirty = false;
  const flush = async () => { if (!dirty) return; dirty = false; try { await store.savePlayers(db); } catch (e) { dirty = true; console.error('Kayıt yazılamadı:', e.message); } };
  const persist = () => {
    dirty = true; clearTimeout(saveT);
    saveT = setTimeout(flush, store.kind === 'redis' ? 2500 : 500);
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
    'POST /api/save': async b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      if (typeof b.data !== 'string' || b.data.length > LIMITS.save) return [413, { error: 'big' }];
      let o; try { o = JSON.parse(b.data); } catch (e) { return [400, { error: 'json' }]; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return [400, { error: 'json' }];
      const now = Date.now(); if (now - (p.lastSave || 0) < LIMITS.saveGap) return [429, { error: 'rate' }];
      await store.putBlob(b.id, b.data);
      p.lastSave = now; p.saveAt = now; p.saveSeen = Number.isFinite(o.seen) ? o.seen : now; persist();
      return [200, { at: p.saveAt, seen: p.saveSeen }];
    },
    'POST /api/load': async b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      const data = await store.getBlob(b.id); if (!data) return [404, { error: 'nosave' }];
      return [200, { data, seen: p.saveSeen || 0, at: p.saveAt || 0 }];
    },
    'POST /api/me': b => {
      const p = auth(b); if (!p) return [401, { error: 'auth' }];
      return [200, { name: p.name, saveAt: p.saveAt || 0, saveSeen: p.saveSeen || 0 }];
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
    const run = body => { Promise.resolve().then(() => h(body, ip, url.searchParams)).then(([c, o]) => send(c, o)).catch(e => { console.error(e); send(500, { error: 'server' }); }); };
    if (req.method === 'GET') { run({}); return; }
    let size = 0; const chunks = [], maxBody = url.pathname === '/api/save' ? LIMITS.save + 4096 : LIMITS.body;
    req.on('data', c => { size += c.length; if (size > maxBody) { send(413, { error: 'big' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (size > maxBody) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { send(400, { error: 'json' }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(400, { error: 'json' }); return; }
      run(body);
    });
  });
  const port = opts.port ?? Number(process.env.PORT || 8787);
  return new Promise(resolve => server.listen(port, opts.host || process.env.HOST || '0.0.0.0', () => resolve({ server, port: server.address().port, db, rooms, store, close: async () => { clearInterval(sweeper); clearTimeout(saveT); await flush(); await new Promise(r => server.close(r)); } })));
}

module.exports = { start };
if (require.main === module) start().then(s => console.log('Kızıl Çağ sunucusu dinliyor: port ' + s.port));

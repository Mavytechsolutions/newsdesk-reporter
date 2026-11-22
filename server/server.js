// APBJA member app server. No outside packages: Node 22 only.
// Data lives in /data (db.json + photos/), never in Git.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || '/data';
const PUB = path.join(__dirname, '..', 'public');
const DBF = path.join(DATA, 'db.json'), PHOTOS = path.join(DATA, 'photos'), BACK = path.join(DATA, 'backups');
const OTP = process.env.TEST_OTP || '1234';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '9959959524';
for (const d of [DATA, PHOTOS, BACK]) fs.mkdirSync(d, { recursive: true });

const DISTRICTS = ['Alluri Sitharama Raju','Anakapalli','Anantapuramu','Annamayya','Bapatla','Chittoor','East Godavari','Eluru','Guntur','Kakinada','Konaseema','Krishna','Kurnool','Nandyal','Nellore','NTR','Palnadu','Parvathipuram Manyam','Prakasam','Srikakulam','Sri Sathya Sai','Tirupati','Visakhapatnam','Vizianagaram','West Godavari','YSR Kadapa'];
const POSTS = [['Honorary President',1],['General Secretary',1],['Treasurer',1],['Publicity Secretary',1],['Vice President',3],['Joint Secretary',3],['Executive Committee Member',8]];
const SLOTS = POSTS.flatMap(([p,c]) => Array.from({length:c}, (_,i) => ({p, no: c>1 ? i+1 : 0})));

/* ---------- storage ---------- */
let S;
function blank(o) { return { id:'', phone:'', name:'', org:'', job:'', district:'', area:'', address:'', photo:'', post:'Member', no:0, status:'approved', admin:false, head:null, mid:'', note:'', approvedAt:0, approvedBy:'', ...o }; }
function seed() {
  let rows = [];
  try {
    if (process.env.SEED_B64) rows = JSON.parse(zlib.gunzipSync(Buffer.from(process.env.SEED_B64, 'base64')).toString());
    else if (process.env.SEED_KEY) { // member list, locked with a key that lives only on the server
      const b = Buffer.from(fs.readFileSync(path.join(__dirname, 'seed.enc'), 'utf8'), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.SEED_KEY, 'hex'), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
      rows = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])).toString());
    }
  } catch (e) { console.error('seed read failed', e.message); }
  let n = 1; const M = [];
  const add = o => { const m = blank({ id: 'm' + (n++), ...o }); M.push(m); return m; };
  add({ phone: ADMIN_PHONE, name: 'APBJA Admin', admin: true, org: 'APBJA', area: 'Andhra Pradesh', mid: '0001' });
  rows.forEach(d => { const single = (POSTS.find(p => p[0] === d.post) || [0,1])[1] === 1;
    add({ phone: d.p, name: d.n, org: d.c, district: 'Anantapuramu', area: d.a, address: d.ad, mid: d.id, note: d.note || '', post: d.post, no: d.post === 'President' || single ? 0 : d.no }); });
  const pr = M.find(m => m.post === 'President'); if (pr) { pr.phone = '8886688864'; pr.note = ''; }
  let mx = Math.max(8000, ...M.map(m => parseInt(m.mid) || 0)); M.forEach(m => { if (!m.mid) m.mid = String(++mx); });
  const msgs = [{ id:'n1', kind:'notice', from:M[0].id, to:M.slice(1).map(m=>m.id), label:'Everyone', title:'Welcome to the APBJA app', body:'All association notices will now come here. Please check your profile, add your photo and see your member ID card.', ts:Date.now(), read:[] }];
  return { members: M, msgs, seq: n, sessions: {} };
}
function load() { try { S = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch { S = seed(); save(); console.log('new database created with', S.members.length, 'members'); } }
let lastBackup = '';
function save() {
  const tmp = DBF + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(S)); fs.renameSync(tmp, DBF);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackup) { lastBackup = day; try { fs.copyFileSync(DBF, path.join(BACK, 'db-' + day + '.json'));
    fs.readdirSync(BACK).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(BACK, f))); } catch {} }
}
load();

/* ---------- rules (same as the app) ---------- */
const Mb = id => S.members.find(m => m.id === id);
const approved = () => S.members.filter(m => m.status === 'approved');
const presOf = d => approved().find(m => m.district === d && m.post === 'President');
const isPres = m => m.post === 'President';
const isLeader = v => v.admin || !!v.head || isPres(v);
const scope = v => v.admin ? DISTRICTS : [...new Set([...(v.head ? v.head.districts : []), ...(isPres(v) ? [v.district] : [])])];
const rank = m => m.post === 'President' ? 0 : m.post === 'Member' ? 99 : 1 + SLOTS.findIndex(s => s.p === m.post && s.no === m.no);
const canManage = (v, m) => v.admin || (isPres(v) && v.district === m.district && m.id !== v.id && !m.admin);
const canApprove = (v, m) => v.admin || (isPres(v) && v.district === m.district);
function leaders(v) {
  if (v.admin) return [];
  const out = new Map();
  approved().filter(x => x.admin && x.id !== v.id).forEach(x => out.set(x.id, x));
  approved().filter(x => x.head && x.head.districts.includes(v.district) && x.id !== v.id).forEach(x => out.set(x.id, x));
  const p = presOf(v.district); if (p && p.id !== v.id) out.set(p.id, p);
  if (!isPres(v)) approved().filter(x => x.district === v.district && x.post !== 'Member' && !isPres(x) && x.id !== v.id && rank(x) < rank(v)).forEach(x => out.set(x.id, x));
  return [...out.values()];
}
const sendPool = v => approved().filter(m => m.id !== v.id && (v.admin || scope(v).includes(m.district)));
function dmPeople(v) {
  if (v.admin) return approved().filter(m => m.id !== v.id);
  const set = new Map(leaders(v).map(m => [m.id, m]));
  sendPool(v).forEach(m => set.set(m.id, m));
  S.msgs.filter(x => x.kind === 'dm' && x.to.includes(v.id)).forEach(x => { const f = Mb(x.from); if (f) set.set(f.id, f); });
  return [...set.values()];
}
const nextMid = () => String(Math.max(8000, ...S.members.map(m => parseInt(m.mid) || 0)) + 1);
function setPresident(d, m) { const old = presOf(d); if (old && old.id !== m.id) { old.post = 'Member'; old.no = 0; } m.district = d; m.post = 'President'; m.no = 0; m.status = 'approved'; if (!m.mid) m.mid = nextMid(); if (!m.approvedAt) m.approvedAt = Date.now(); }
function givePost(m, key) {
  if (key === 'Member') { m.post = 'Member'; m.no = 0; return; }
  if (key === 'President') { setPresident(m.district, m); return; }
  const [p, no] = String(key).split('|'); if (!SLOTS.some(s => s.p === p && s.no === +no)) throw new Error('Unknown designation');
  const t = approved().find(x => x.district === m.district && x.post === p && x.no === +no && x.id !== m.id); if (t) { t.post = 'Member'; t.no = 0; }
  m.post = p; m.no = +no;
}

/* what one member may see */
const PUBLIC = m => ({ ...m });
const SLIM = m => ({ id:m.id, name:m.name, phone:m.phone, org:m.org, job:m.job, district:m.district, area:m.area, photo:m.photo, post:m.post, no:m.no, status:m.status, admin:m.admin, head:m.head, mid:m.mid, approvedAt:m.approvedAt, approvedBy:m.approvedBy, address:'', note:'' });
function view(v) {
  const vis = new Map();
  const put = (m, full) => { if (m && (!vis.has(m.id) || full)) vis.set(m.id, full ? PUBLIC(m) : SLIM(m)); };
  if (v.admin) S.members.forEach(m => put(m, true));
  else {
    const sc = scope(v);
    if (sc.length) S.members.filter(m => sc.includes(m.district)).forEach(m => put(m, true));
    leaders(v).forEach(m => put(m));
    approved().filter(m => m.district === v.district && m.post !== 'Member').forEach(m => put(m));
  }
  const msgs = S.msgs.filter(x => x.from === v.id || x.to.includes(v.id)).map(x => x.kind === 'notice' && x.from !== v.id ? { ...x, to: [v.id], read: x.read.includes(v.id) ? [v.id] : [] } : x);
  msgs.forEach(x => { put(Mb(x.from)); x.to.forEach(id => { if (x.kind === 'dm') put(Mb(id)); }); });
  const ab = Mb(v.approvedBy); if (ab) put(ab);
  put(v, true);
  return { me: v.id, members: [...vis.values()], msgs };
}

/* ---------- actions ---------- */
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const phoneOk = p => /^\d{10}$/.test(p);
function savePhoto(m, data) {
  const b64 = String(data || '').replace(/^data:image\/\w+;base64,/, ''); if (!b64) return;
  const buf = Buffer.from(b64, 'base64'); if (buf.length > 600000) throw new Error('Photo too large');
  const key = crypto.randomBytes(6).toString('hex');
  if (m.photo) { const old = m.photo.match(/\/p\/([\w-]+\.jpg)/); if (old) fs.rm(path.join(PHOTOS, old[1]), () => {}); }
  const file = m.id + '-' + key + '.jpg'; fs.writeFileSync(path.join(PHOTOS, file), buf); m.photo = '/p/' + file;
}
function act(sess, a) {
  const v = Mb(sess.member);
  const need = c => { if (!c) throw new Error('Not allowed'); };
  const tgt = () => { const m = Mb(a.id); if (!m) throw new Error('Member not found'); return m; };
  switch (a.type) {
    case 'register': {
      const vals = { name: clean(a.name, 80), org: clean(a.org, 80), job: clean(a.job, 40), area: clean(a.area, 80), address: clean(a.address, 300) };
      if (!vals.name) throw new Error('Name is needed');
      if (v) { Object.assign(v, vals); if (!v.district && DISTRICTS.includes(a.district)) v.district = a.district; if (a.photo) savePhoto(v, a.photo); return; }
      if (!DISTRICTS.includes(a.district)) throw new Error('Choose a district');
      if (S.members.some(m => m.phone === sess.phone)) throw new Error('This number is already registered');
      const m = blank({ id: 'm' + (S.seq++), phone: sess.phone, district: a.district, status: 'pending', ...vals });
      if (a.photo) savePhoto(m, a.photo);
      S.members.push(m); sess.member = m.id; return;
    }
  }
  need(v);
  switch (a.type) {
    case 'profile': Object.assign(v, { name: clean(a.name, 80) || v.name, org: clean(a.org, 80), job: clean(a.job, 40), area: clean(a.area, 80), address: clean(a.address, 300) }); return;
    case 'photo': savePhoto(v, a.photo); return;
    case 'read': S.msgs.forEach(x => { if ((a.ids || []).includes(x.id) && x.to.includes(v.id) && !x.read.includes(v.id)) x.read.push(v.id); }); return;
  }
  need(v.status === 'approved');
  switch (a.type) {
    case 'approve': { const m = tgt(); need(m.status === 'pending' && canApprove(v, m)); m.status = 'approved'; m.mid = m.mid || nextMid(); m.approvedAt = Date.now(); m.approvedBy = v.id; m.post = 'Member'; m.no = 0; return; }
    case 'reject': { const m = tgt(); need(m.status === 'pending' && canApprove(v, m)); m.status = 'rejected'; return; }
    case 'post': { const m = tgt(); need(canManage(v, m)); if (a.key === 'President') need(v.admin); givePost(m, a.key); return; }
    case 'setpres': {
      need(v.admin); const p = clean(a.phone, 10); if (!phoneOk(p)) throw new Error('Enter a 10-digit mobile number'); if (!DISTRICTS.includes(a.district)) throw new Error('Unknown district');
      let m = S.members.find(x => x.phone === p);
      if (m && m.admin) throw new Error('That is the admin number');
      if (!m) { m = blank({ id: 'm' + (S.seq++), phone: p, district: a.district, note: 'New President — will add details at first login', approvedAt: Date.now(), approvedBy: v.id }); S.members.push(m); }
      setPresident(a.district, m); return;
    }
    case 'editm': {
      need(v.admin); const m = tgt(); const p = clean(a.phone, 10);
      if (p && !phoneOk(p)) throw new Error('Mobile must be 10 digits');
      const dup = p && S.members.find(x => x.phone === p && x.id !== m.id); if (dup) throw new Error('Number already used by ' + dup.name);
      if (!DISTRICTS.includes(a.district)) throw new Error('Unknown district');
      if (m.district !== a.district && m.post !== 'Member') { m.post = 'Member'; m.no = 0; }
      Object.assign(m, { name: clean(a.name, 80), phone: p, org: clean(a.org, 80), district: a.district, area: clean(a.area, 80) });
      if (p && /mobile/i.test(m.note)) m.note = ''; return;
    }
    case 'head': { need(v.admin); const m = tgt(); const ds = (a.districts || []).filter(d => DISTRICTS.includes(d)); if (!ds.length) throw new Error('Choose at least one district'); m.head = { title: clean(a.title, 60) || 'Head', districts: ds }; return; }
    case 'rmhead': { need(v.admin); tgt().head = null; return; }
    case 'send': {
      need(isLeader(v)); const pool = new Set(sendPool(v).map(m => m.id));
      const to = [...new Set(a.to || [])].filter(id => pool.has(id)); if (!to.length) throw new Error('Choose who should get it');
      const title = clean(a.title, 80), body = clean(a.body, 3000); if (!title || !body) throw new Error('Write a title and message');
      S.msgs.push({ id: 'n' + Date.now() + crypto.randomBytes(2).toString('hex'), kind: 'notice', from: v.id, to, label: clean(a.label, 200), title, body, ts: Date.now(), read: [] }); return;
    }
    case 'dm': {
      const o = Mb(a.to); need(o && dmPeople(v).some(m => m.id === o.id)); const body = clean(a.body, 3000); if (!body) throw new Error('Write a message');
      S.msgs.push({ id: 'd' + Date.now() + crypto.randomBytes(2).toString('hex'), kind: 'dm', from: v.id, to: [o.id], body, ts: Date.now(), read: [] }); return;
    }
    case 'reset': { need(v.admin); const keep = S.sessions; S = seed(); S.sessions = keep; return; }
  }
  throw new Error('Unknown action');
}

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const tries = new Map();
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok, bad) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 1.5e6) { bad(new Error('Too large')); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch { bad(new Error('Bad request')); } }); }); }
function session(req) { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); return t && S.sessions[t] ? S.sessions[t] : null; }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, members: S.members.length });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress, now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 600000);
      if (t.length > 30) return send(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
      t.push(now); tries.set(ip, t);
      const a = await body(req), phone = clean(a.phone, 10);
      if (!phoneOk(phone)) return send(res, 400, { error: 'Enter a 10-digit mobile number' });
      if (String(a.otp) !== OTP) return send(res, 401, { error: 'Wrong OTP' });
      const m = S.members.find(x => x.phone === phone), token = crypto.randomBytes(24).toString('hex');
      S.sessions[token] = { phone, member: m ? m.id : null, at: now };
      for (const [k, s] of Object.entries(S.sessions)) if (now - s.at > 180 * 864e5) delete S.sessions[k];
      save(); return send(res, 200, { token, state: m ? view(m) : null });
    }
    if (url.pathname === '/api/state') { const s = session(req); if (!s) return send(res, 401, { error: 'Please log in again' }); const m = Mb(s.member); return send(res, 200, { state: m ? view(m) : null }); }
    if (url.pathname === '/api/act' && req.method === 'POST') {
      const s = session(req); if (!s) return send(res, 401, { error: 'Please log in again' });
      const a = await body(req);
      try { act(s, a); } catch (e) { return send(res, 400, { error: e.message }); }
      save(); const m = Mb(s.member); return send(res, 200, { state: m ? view(m) : null });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); delete S.sessions[t]; save(); return send(res, 200, { ok: true }); }
    if (url.pathname.startsWith('/p/')) {
      const f = path.join(PHOTOS, path.basename(url.pathname));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' }); return fs.createReadStream(f).pipe(res);
    }
    if (url.pathname === '/download' || url.pathname === '/apk') { res.writeHead(302, { location: 'https://raw.githubusercontent.com/Mavytechsolutions/newsdesk-reporter/apbja-build/APBJA.apk' }); return res.end(); }
    let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'Server problem. Try again.' }); }
}).listen(PORT, () => console.log('APBJA server on', PORT, '— members:', S.members.length));

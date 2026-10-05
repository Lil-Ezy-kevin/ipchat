const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const createStore = require('./store');

const PORT = process.env.PORT || 3000;
const TEAM_CODE = process.env.TEAM_CODE || 'equipe2026'; // code requis pour créer un compte
const DATA = process.env.DATA_DIR || __dirname;           // dossier des données et des fichiers
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
if (!process.env.TEAM_CODE) console.warn('Attention : TEAM_CODE non défini, code par défaut "equipe2026". Change-le.');

const store = createStore(path.join(DATA, 'data.json'));
process.on('exit', () => { try { store.flush(); } catch {} });
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => process.exit(0)));

// ---------- Utilitaires ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const newSession = user => { const t = crypto.randomBytes(24).toString('hex'); store.createSession(t, user); return t; };
const userOf = token => store.sessionUser(token);
const bearer = req => (req.headers.authorization || '').replace('Bearer ', '');
const listRooms = () => store.listRooms();
const listUsers = () => store.listUsers();
const userRow = name => store.findUser(name);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const dmParts = room => (room.startsWith('dm:') ? room.slice(3).split('|') : null);
const canAccess = (room, name) => {
  const p = dmParts(room);
  if (p) return p.length === 2 && p.some(x => same(x, name)) && p.every(userRow);
  return listRooms().includes(room);
};
const passwordOk = (u, pw) => crypto.timingSafeEqual(Buffer.from(hashPw(String(pw || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));

// Limite les essais : 10 échecs par IP et par 10 minutes
const fails = new Map();
const limited = ip => (fails.get(ip) || []).filter(t => Date.now() - t < 600000).length >= 10;
const addFail = ip => fails.set(ip, [...(fails.get(ip) || []).filter(t => Date.now() - t < 600000), Date.now()]);

// ---------- HTTP ----------
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const json = express.json({ limit: '10kb' });

app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.get('/healthz', (req, res) => res.send('ok')); // utilisé par Render pour vérifier que le service tourne
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', json, (req, res) => {
  const { name, password, code } = req.body || {};
  if (limited(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 10 minutes.' });
  if (code !== TEAM_CODE) { addFail(req.ip); return res.status(403).json({ error: "Code d'équipe incorrect." }); }
  if (!/^[\p{L}0-9_.-]{2,24}$/u.test(name || '')) return res.status(400).json({ error: 'Nom : 2 à 24 caractères (lettres, chiffres, _ . -).' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (userRow(name)) return res.status(409).json({ error: 'Ce nom est déjà pris.' });
  const salt = crypto.randomBytes(16).toString('hex');
  store.addUser({ name, salt, hash: hashPw(password, salt), created: Date.now() });
  io.emit('users', listUsers());
  res.json({ name, token: newSession(name) });
});

app.post('/api/login', json, (req, res) => {
  const { name, password } = req.body || {};
  if (limited(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 10 minutes.' });
  const u = userRow(name);
  if (!u || !passwordOk(u, password)) { addFail(req.ip); return res.status(401).json({ error: 'Nom ou mot de passe incorrect.' }); }
  res.json({ name: u.name, token: newSession(u.name) });
});

app.post('/api/logout', json, (req, res) => { store.deleteSession(bearer(req)); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const u = userOf(bearer(req));
  if (!u) return res.status(401).json({ error: 'Non connecté.' });
  const row = userRow(u);
  res.json({ name: row.name, created: row.created, messages: store.countMessages(u) });
});

app.post('/api/password', json, (req, res) => {
  const u = userOf(bearer(req));
  if (!u) return res.status(401).json({ error: 'Non connecté.' });
  if (limited(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 10 minutes.' });
  const { oldPassword, newPassword } = req.body || {};
  const row = userRow(u);
  if (!passwordOk(row, oldPassword)) { addFail(req.ip); return res.status(403).json({ error: 'Ancien mot de passe incorrect.' }); }
  if (typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum.' });
  const salt = crypto.randomBytes(16).toString('hex');
  store.setPassword(u, salt, hashPw(newPassword, salt));
  store.deleteOtherSessions(row.name, bearer(req)); // déconnecte les autres appareils
  res.json({ ok: true });
});

app.post('/api/upload', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  if (!userOf(bearer(req))) return res.status(401).json({ error: 'Non connecté.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier vide.' });
  let name = 'fichier';
  try { name = decodeURIComponent(req.headers['x-filename'] || 'fichier'); } catch {}
  name = name.replace(/[\\/\r\n]/g, '_').slice(0, 100);
  const ext = path.extname(name).toLowerCase();
  const id = crypto.randomBytes(16).toString('hex') + (/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '');
  fs.writeFileSync(path.join(UPLOADS, id), req.body);
  res.json({ name, url: '/files/' + id });
});

// Les images s'affichent dans le chat, tout le reste est téléchargé
app.get('/files/:id', (req, res) => {
  if (!/^[a-f0-9]{32}(\.[a-z0-9]{1,8})?$/.test(req.params.id)) return res.sendStatus(404);
  if (!/\.(png|jpe?g|gif|webp)$/i.test(req.params.id)) res.setHeader('Content-Disposition', 'attachment');
  res.sendFile(path.join(UPLOADS, req.params.id), err => { if (err && !res.headersSent) res.sendStatus(404); });
});

// ---------- Temps réel ----------
io.use((socket, next) => {
  const user = userOf(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('Session expirée.'));
  socket.data.name = user;
  next();
});

const onlineNames = () => [...new Set([...io.sockets.sockets.values()].map(s => s.data.name))];

io.on('connection', socket => {
  const me = socket.data.name;
  socket.join('u:' + me); // salle personnelle pour les alertes de messages privés
  socket.emit('rooms', listRooms());
  socket.emit('users', listUsers());
  io.emit('online', onlineNames());

  socket.on('join', room => {
    if (typeof room !== 'string' || !canAccess(room, me)) return;
    socket.rooms.forEach(r => { if (r !== socket.id && !r.startsWith('u:')) socket.leave(r); });
    socket.join(room);
    socket.emit('history', {
      room,
      messages: store.history(room, 100).map(m => ({ user: m.user, text: m.text, ts: m.ts, file: m.file_url ? { name: m.file_name, url: m.file_url } : null })),
    });
  });

  socket.on('message', ({ room, text, file } = {}) => {
    text = String(text || '').trim().slice(0, 2000);
    let fileName = null, fileUrl = null;
    if (file && /^\/files\/[a-f0-9]{32}(\.[a-z0-9]{1,8})?$/.test(file.url || '')) {
      fileUrl = file.url;
      fileName = String(file.name || 'fichier').slice(0, 100);
    }
    if ((!text && !fileUrl) || !socket.rooms.has(room)) return;
    const msg = { room, user: me, text, file: fileUrl ? { name: fileName, url: fileUrl } : null, ts: Date.now() };
    store.addMessage({ room, user: me, text, file_name: fileName, file_url: fileUrl, ts: msg.ts });
    io.to(room).emit('message', msg);
    const p = dmParts(room);
    if (p) {
      const other = userRow(p.find(x => !same(x, me)));
      if (other) io.to('u:' + other.name).emit('ping', { room, user: me });
    }
  });

  socket.on('create-room', raw => {
    const name = String(raw || '').trim().toLowerCase().slice(0, 30);
    if (!name || name.startsWith('dm:')) return;
    store.addRoom(name);
    io.emit('rooms', listRooms());
  });

  // Aperçu de la liste des discussions : dernier message de chaque salon / conversation privée
  socket.on('overview', ack => {
    if (typeof ack !== 'function') return;
    const last = {};
    Object.entries(store.lastByRoom()).forEach(([room, m]) => {
      if (canAccess(room, me)) last[room] = { user: m.user, text: m.text, file: m.file_name, ts: m.ts };
    });
    ack({ rooms: listRooms(), users: listUsers(), last });
  });

  socket.on('disconnect', () => io.emit('online', onlineNames()));
});

server.listen(PORT, () => console.log(`IPChat : http://localhost:${PORT}`));

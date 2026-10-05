const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const VIEWS = ['splash', 'auth', 'home', 'chat', 'profile', 'settings'];
let session = store.get('ipchat', {});            // { token, me }
let prefs = store.get('prefs', { theme: 'light', notify: false });
let blocked = store.get('blocked', []);
let socket, current = null, mode = 'login';
let rooms = [], users = [], online = [], last = {}, unread = {};

const me = () => session.me || '';
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const dmKey = (a, b) => 'dm:' + [a, b].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).join('|');
const isImg = url => /\.(png|jpe?g|gif|webp)$/i.test(url);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtTime = ts => {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};
function avatar(name, big) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const a = el('span', 'avatar' + (big ? ' big' : ''), name.slice(0, 2).toUpperCase());
  a.style.background = `hsl(${h} 45% 38%)`; a.setAttribute('aria-hidden', 'true'); return a;
}
const applyPrefs = () => { document.documentElement.dataset.theme = prefs.theme; };

// ----- Navigation -----
function show(v) {
  VIEWS.forEach(x => { $(x).hidden = x !== v; });
  closeMenus();
  if (v !== 'splash' && v !== 'auth') startSocket();
  if (v === 'home') loadHome();
  if (v === 'profile') loadProfile();
  if (v === 'settings') loadSettings();
}
function route() {
  let v = location.hash.slice(1) || 'splash';
  if (!VIEWS.includes(v)) v = 'splash';
  if (v !== 'splash' && v !== 'auth' && !session.token) v = 'auth';
  if (v === 'chat' && !current) v = 'home';
  show(v);
}
const go = v => { if (location.hash === '#' + v) route(); else location.hash = v; };
window.addEventListener('hashchange', route);
function closeMenus() { document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); }
document.addEventListener('click', e => { if (!e.target.closest('.menuwrap')) closeMenus(); });
document.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(b.dataset.go); });
document.querySelectorAll('[data-menu]').forEach(b => {
  b.onclick = () => {
    const m = $(b.dataset.menu), open = m.hidden;
    closeMenus(); m.hidden = !open;
    if (m.id === 'chatMenu') { const p = chatPeer(); $('blockBtn').hidden = !p; if (p) $('blockBtn').textContent = blocked.includes(p) ? 'Débloquer' : 'Bloquer'; }
  };
});
$('start').onclick = () => go(session.token ? 'home' : 'auth');

// ----- Compte -----
$('toggle').onclick = () => {
  mode = mode === 'login' ? 'register' : 'login';
  $('codeRow').hidden = mode === 'login';
  $('go').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('toggle').textContent = mode === 'login' ? 'Créer un compte' : "J'ai déjà un compte";
  $('err').textContent = '';
};
$('authForm').onsubmit = async e => {
  e.preventDefault(); $('err').textContent = '';
  const body = { name: $('name').value.trim(), password: $('pw').value };
  if (mode === 'register') body.code = $('code').value;
  try {
    const r = await fetch('/api/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    session = { token: d.token, me: d.name }; store.set('ipchat', session);
    $('pw').value = ''; go('home');
  } catch (err) { $('err').textContent = err.message || 'Connexion impossible.'; }
};
function logoutLocal() { store.set('ipchat', {}); location.hash = ''; location.reload(); }
document.querySelectorAll('.logout').forEach(b => {
  b.onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + session.token } }); } catch {}
    logoutLocal();
  };
});

// ----- Temps réel -----
function notify(user) {
  if (prefs.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted')
    new Notification('IPChat · ' + user, { body: 'Nouveau message privé' });
}
function startSocket() {
  if (socket || !session.token) return;
  socket = io({ auth: { token: session.token } });
  socket.on('connect_error', err => { if (err.message === 'Session expirée.') logoutLocal(); });
  socket.on('connect', () => { if (current) socket.emit('join', current); });
  socket.on('rooms', l => { rooms = l; renderList(); });
  socket.on('users', l => { users = l; renderList(); });
  socket.on('online', l => { online = l; renderList(); updateSub(); });
  socket.on('history', ({ room, messages }) => {
    if (room !== current) return;
    $('log').replaceChildren();
    const shown = messages.filter(m => !blocked.includes(m.user));
    if (!shown.length) $('log').append(el('p', 'empty', 'Aucun message. Écris le premier.'));
    shown.forEach(addMsg);
  });
  socket.on('message', m => {
    last[m.room] = { user: m.user, text: m.text, file: m.file?.name, ts: m.ts };
    if (m.room === current && !blocked.includes(m.user)) { $('log').querySelector('.empty')?.remove(); addMsg(m); }
    renderList();
  });
  socket.on('ping', ({ room, user }) => {
    if (blocked.includes(user) || room === current) return;
    unread[room] = (unread[room] || 0) + 1; renderList(); notify(user);
  });
}

// ----- Liste des discussions -----
function loadHome() {
  socket?.emit('overview', d => { rooms = d.rooms; users = d.users; last = d.last; renderList(); });
  renderList();
}
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const items = [
    ...rooms.map(r => ({ key: r, name: '# ' + r, base: r, room: true })),
    ...users.filter(u => !same(u, me())).map(u => ({ key: dmKey(me(), u), name: u, base: u, on: online.includes(u), blocked: blocked.includes(u) })),
  ].filter(i => i.name.toLowerCase().includes(q));
  items.forEach(i => { i.l = last[i.key]; });
  items.sort((a, b) => (b.l?.ts || 0) - (a.l?.ts || 0) || a.name.localeCompare(b.name));
  $('list').replaceChildren(...items.map(rowFor));
  if (!items.length) $('list').append(el('li', 'empty', 'Aucune discussion.'));
}
function rowFor(i) {
  const li = el('li'), b = el('button', 'row'), body = el('div', 'body'), nm = el('div', 'nm', i.name), meta = el('div', 'meta');
  b.type = 'button';
  if (i.on) nm.append(el('span', 'dot'));
  const pv = i.l ? (i.room ? i.l.user + ' : ' : i.l.user === me() ? 'Toi : ' : '') + (i.l.text || 'Fichier : ' + i.l.file) : 'Aucun message';
  body.append(nm, el('div', 'pv', i.blocked ? 'Contact bloqué' : pv));
  if (i.l) meta.append(el('span', '', fmtTime(i.l.ts)));
  if (unread[i.key]) meta.append(el('span', 'badge', unread[i.key]));
  b.append(avatar(i.base), body, meta);
  b.onclick = () => openChat(i.key);
  li.append(b); return li;
}
$('search').oninput = renderList;
$('addRoom').onclick = () => { $('roomForm').hidden = !$('roomForm').hidden; if (!$('roomForm').hidden) $('roomName').focus(); };
$('roomForm').onsubmit = e => {
  e.preventDefault();
  const n = $('roomName').value.trim().toLowerCase(); if (!n) return;
  socket.emit('create-room', n); $('roomName').value = ''; $('roomForm').hidden = true;
  setTimeout(() => openChat(n), 200);
};

// ----- Conversation -----
const chatPeer = () => current?.startsWith('dm:') ? current.slice(3).split('|').find(x => !same(x, me())) : null;
function updateSub() { const p = chatPeer(); if (p) $('chatSub').textContent = online.includes(p) ? 'en ligne' : 'hors ligne'; }
function openChat(key) {
  current = key; delete unread[key];
  const p = chatPeer();
  $('chatTitle').textContent = p || '# ' + key;
  $('chatSub').textContent = p ? '' : 'salon'; updateSub();
  $('chatAvatar').replaceChildren(avatar(p || key));
  $('log').replaceChildren();
  socket.emit('join', key);
  go('chat');
}
function addMsg({ user, text, ts, file }) {
  const d = el('div', 'msg' + (user === me() ? ' me' : ''));
  d.append(el('div', 'meta2', user + ' · ' + fmtTime(ts)));
  if (text) d.append(el('div', '', text));
  if (file) {
    if (isImg(file.url)) { const img = el('img'); img.src = file.url; img.alt = file.name; img.loading = 'lazy'; d.append(img); }
    const a = el('a', '', file.name); a.href = file.url; a.download = file.name; d.append(a);
  }
  $('log').append(d); $('log').scrollTop = $('log').scrollHeight;
}
$('send').onsubmit = e => {
  e.preventDefault();
  const t = $('text').value.trim(); if (!t) return;
  socket.emit('message', { room: current, text: t }); $('text').value = '';
};
$('file').onchange = async () => {
  const f = $('file').files[0]; $('file').value = '';
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) return alert('Fichier trop lourd (10 Mo maximum).');
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'x-filename': encodeURIComponent(f.name) }, body: f });
    if (!r.ok) throw new Error();
    socket.emit('message', { room: current, text: '', file: await r.json() });
  } catch { alert('Envoi impossible. Réessaie.'); }
};
$('clearBtn').onclick = () => { $('log').replaceChildren(el('p', 'empty', 'Écran effacé (les messages restent dans l\'historique).')); closeMenus(); };
$('blockBtn').onclick = () => {
  const p = chatPeer(); if (!p) return;
  blocked = blocked.includes(p) ? blocked.filter(x => x !== p) : [...blocked, p];
  store.set('blocked', blocked); openChat(current);
};

// ----- Profil et réglages -----
async function loadProfile() {
  $('pAvatar').replaceChildren(avatar(me(), true)); $('pName').textContent = me();
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + session.token } });
    const d = await r.json(); if (!r.ok) throw new Error();
    $('pSince').textContent = d.created ? 'Membre depuis le ' + new Date(d.created).toLocaleDateString('fr-FR') : '';
    $('pCount').textContent = d.messages + (d.messages > 1 ? ' messages envoyés' : ' message envoyé');
  } catch { $('pSince').textContent = ''; $('pCount').textContent = ''; }
}
function loadSettings() { $('theme').value = prefs.theme; $('notify').checked = prefs.notify; $('pwMsg').textContent = ''; }
$('theme').onchange = () => { prefs.theme = $('theme').value; store.set('prefs', prefs); applyPrefs(); };
$('notify').onchange = async () => {
  if ($('notify').checked && 'Notification' in window && Notification.permission !== 'granted') {
    if (await Notification.requestPermission() !== 'granted') $('notify').checked = false;
  }
  prefs.notify = $('notify').checked; store.set('prefs', prefs);
};
$('pwForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const r = await fetch('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ oldPassword: $('oldPw').value, newPassword: $('newPw').value }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    $('pwMsg').textContent = 'Mot de passe mis à jour.'; $('oldPw').value = $('newPw').value = '';
  } catch (err) { $('pwMsg').textContent = err.message || 'Erreur.'; }
};

applyPrefs(); route();

// Stockage dans un simple fichier JSON : aucune dépendance native, fonctionne sur les vieux Node.
const fs = require('fs');

module.exports = function createStore(file) {
  const data = { users: [], sessions: {}, rooms: ['général'], messages: [], nextId: 1 };
  try { Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}

  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  };
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { flush(); } catch (e) { console.error('Sauvegarde impossible :', e.message); }
    }, 300);
  };
  const lc = s => String(s || '').toLowerCase();

  return {
    flush,
    // Comptes
    findUser: name => data.users.find(u => lc(u.name) === lc(name)),
    addUser(u) { data.users.push(u); save(); },
    setPassword(name, salt, hash) { const u = this.findUser(name); if (u) { u.salt = salt; u.hash = hash; save(); } },
    listUsers: () => data.users.map(u => u.name).sort((a, b) => a.localeCompare(b)),
    // Sessions
    createSession(token, user) { data.sessions[token] = user; save(); },
    sessionUser: token => data.sessions[token || ''],
    deleteSession(token) { delete data.sessions[token]; save(); },
    deleteOtherSessions(user, keep) {
      Object.keys(data.sessions).forEach(t => { if (data.sessions[t] === user && t !== keep) delete data.sessions[t]; });
      save();
    },
    // Salons
    listRooms: () => [...data.rooms].sort((a, b) => a.localeCompare(b)),
    addRoom(name) { if (data.rooms.includes(name)) return false; data.rooms.push(name); save(); return true; },
    // Messages
    addMessage(m) { data.messages.push({ id: data.nextId++, ...m }); save(); },
    history(room, limit) {
      const out = [];
      for (let i = data.messages.length - 1; i >= 0 && out.length < limit; i--) if (data.messages[i].room === room) out.push(data.messages[i]);
      return out.reverse();
    },
    lastByRoom() { const l = {}; data.messages.forEach(m => { l[m.room] = m; }); return l; },
    countMessages: user => data.messages.filter(m => m.user === user).length,
  };
};

// Service en ligne de Sono Mobile : mêmes règles et mêmes routes que le serveur de l’app de bureau, sans ordinateur.
// Tout tourne dans un seul Durable Object : sessions en mémoire, enregistrées dans son stockage.
// La musique, elle, est jouée par l’iPhone de l’hôte, qui suit l’état de la session par WebSocket.
import crypto from 'node:crypto';
import { MiniApp, SocketAdapter } from './mini-express.js';

let sessions = new Map();
let storage = null;
let deezerApiBaseUrl = 'https://api.deezer.com';
const app = new MiniApp();
const clients = new Map();
const WebSocket = { OPEN: 1 };

const HOST_VIEW = { role: 'host' };
const memberKey = (session, clientId) => crypto.createHash('sha256').update(`${session.code}:${clientId}`).digest('hex').slice(0, 12);
// Quand la validation est active, un invité n’accède à la session qu’après l’accord de l’hôte.
// Une fois accepté, il le reste même s’il se déconnecte (écran verrouillé) ; seul l’hôte peut le retirer.
const admissionOf = (session, viewer) => {
  if (!viewer || viewer.role === 'host') return 'accepted';
  const member = session.members?.[viewer.clientId];
  if (member?.status === 'removed') return 'removed';
  if (member?.status === 'left') return 'accepted';
  // Un invité retiré qui demande à revenir passe toujours par l’hôte.
  if (!session.requireApproval && !member?.mustAsk) return 'accepted';
  return member?.status === 'accepted' || member?.status === 'refused' ? member.status : 'pending';
};
// Un admin est un invité de confiance désigné par l’hôte. Il reste sur sa page d’invité ; quand il prend la main
// (une seule personne à la fois), sa clé personnelle ouvre quelques commandes : lecture, nouveaux arrivants, file d’attente.
const adminByKey = (session, key) => {
  if (!key) return null;
  for (const [clientId, member] of Object.entries(session.members || {})) if (member.admin && member.adminKey && member.adminKey === key) return { clientId, member };
  return null;
};
const hostAccess = (session, key) => {
  if (!key) return null;
  if (key === session.hostToken) return { owner: true };
  const admin = adminByKey(session, key);
  return admin ? { owner: false, admin } : null;
};
const viewerFromRequest = (req, session) => ({
  role: hostAccess(session, req.get('x-host-token'))?.owner ? 'host' : 'guest',
  clientId: text(req.get('x-sono-client'), 64),
});
// Reçoit les demandes d’arrivée, le titre précédent et le prochain titre de fond : l’hôte et les admins.
const isController = (session, viewer) => viewer?.role === 'host' || Boolean(viewer?.clientId && session.members?.[viewer.clientId]?.admin);
// L’hôte est-il connecté ?
const hostOnline = (session) => [...(clients.get(session.code) || [])].some((socket) => socket.readyState === WebSocket.OPEN && socket.sono?.role === 'host');
const requestsOf = (session) => {
  const byClient = new Map();
  for (const socket of clients.get(session.code) || []) {
    const meta = socket.sono;
    if (!meta?.greeted || meta.role === 'host' || !meta.name || admissionOf(session, meta) !== 'pending') continue;
    byClient.set(meta.clientId, { id: memberKey(session, meta.clientId), name: meta.name || 'Invité', since: session.members?.[meta.clientId]?.since || meta.since });
  }
  return [...byClient.values()].sort((a, b) => a.since.localeCompare(b.since));
};
// Tous les invités admis, connectés ou non, pour que l’hôte voie qui fait partie de la session.
const participantsOf = (session) => {
  const online = new Set();
  for (const socket of clients.get(session.code) || []) if (socket.sono?.greeted && socket.readyState === WebSocket.OPEN) online.add(socket.sono.clientId);
  const guests = Object.entries(session.members || {})
    .filter(([clientId, member]) => member.name && member.status !== 'left' && admissionOf(session, { role: 'guest', clientId }) === 'accepted')
    .map(([clientId, member]) => ({ id: memberKey(session, clientId), name: member.name, role: 'guest', admin: Boolean(member.admin), since: member.since, online: online.has(clientId) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || String(a.since).localeCompare(String(b.since)));
  return [{ id: 'host', name: session.host, role: 'host', online: true }, ...guests];
};
// Musique de fond : une playlist, un album ou un artiste qui prend le relais quand la file est vide.
const shuffled = (length) => {
  const order = [...Array(length).keys()];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
};
const fallbackOrder = (fallback) => (fallback.type === 'album' ? [...Array(fallback.tracks.length).keys()] : shuffled(fallback.tracks.length));
// Les titres de fond à venir : une liste d’index, rechargée (et remélangée) quand elle est épuisée.
const fallbackUpcoming = (session) => {
  const fallback = session.fallback;
  if (!fallback?.tracks?.length) return [];
  if (!Array.isArray(fallback.upcoming)) fallback.upcoming = [];
  const blocked = new Set(Array.isArray(fallback.blocked) ? fallback.blocked : []);
  const playable = (index) => Number.isInteger(index) && index >= 0 && index < fallback.tracks.length && !blocked.has(index);
  fallback.upcoming = fallback.upcoming.filter(playable);
  if (!fallback.upcoming.length) fallback.upcoming = fallbackOrder(fallback).filter(playable);
  return fallback.upcoming;
};
const fallbackItem = (session, index) => ({ ...session.fallback.tracks[index], id: `fond-${index}`, addedBy: session.fallback.name, fromFallback: true, fallbackIndex: index });
const peekFallback = (session) => {
  const upcoming = fallbackUpcoming(session);
  return upcoming.length ? fallbackItem(session, upcoming[0]) : null;
};
const takeFallback = (session) => {
  const upcoming = fallbackUpcoming(session);
  if (!upcoming.length) return null;
  return { ...fallbackItem(session, upcoming.shift()), id: crypto.randomUUID() };
};
// La suite complète reste disponible sur /fallback/upcoming : chaque diffusion reste légère.
const FALLBACK_VISIBLE = 15;
const fallbackQueueOf = (session) => {
  const upcoming = fallbackUpcoming(session);
  return { tracks: upcoming.slice(0, FALLBACK_VISIBLE).map((index) => fallbackItem(session, index)), total: upcoming.length };
};
const fallbackSummary = (session, viewer) => {
  const fallback = session.fallback;
  if (!fallback) return null;
  const summary = { type: fallback.type, name: fallback.name, subtitle: fallback.subtitle, cover: fallback.cover, source: fallback.source, count: fallback.tracks.length };
  return isController(session, viewer) ? { ...summary, next: peekFallback(session) } : summary;
};
// Couleurs choisies par l’hôte (fond, accent, Liquid Glass), reprises sur les écrans des invités.
const THEME_BACKGROUNDS = ['black', 'white', 'auto', 'cover'];
const cleanTheme = (theme) => (theme && typeof theme === 'object' ? {
  background: THEME_BACKGROUNDS.includes(theme.background) ? theme.background : 'black',
  accent: /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent.toLowerCase() : '#d7f75b',
  glass: theme.glass === true,
  lang: theme.lang === 'en' ? 'en' : 'fr',
} : null);
const publicSession = (session, viewer = HOST_VIEW) => {
  const source = session.playbackSource || 'Deezer';
  const apps = Array.isArray(session.apps) ? session.apps : [source];
  const base = { code: session.code, name: session.name, host: session.host, active: session.active, requireApproval: Boolean(session.requireApproval), source, apps, theme: cleanTheme(session.theme), hostOnline: hostOnline(session) };
  if (admissionOf(session, viewer) !== 'accepted') return { ...base, guests: 0, participants: [] };
  const participants = participantsOf(session);
  return { ...base, fallback: fallbackSummary(session, viewer), guests: participants.filter((item) => item.role !== 'host' && item.online).length, participants, ...(isController(session, viewer) ? { requests: requestsOf(session) } : {}) };
};
const payload = (session, viewer = HOST_VIEW) => {
  const admission = admissionOf(session, viewer);
  const member = viewer.role !== 'host' && viewer.clientId ? session.members?.[viewer.clientId] : null;
  // Un admin reçoit sa clé personnelle (pour les commandes), et seulement lui.
  const you = viewer.role !== 'host' && viewer.clientId ? { you: member?.name || null, ...(member?.admin && member.adminKey ? { admin: { key: member.adminKey, id: memberKey(session, viewer.clientId) } } : {}) } : {};
  if (admission !== 'accepted') return { session: publicSession(session, viewer), admission, ...you };
  const host = isController(session, viewer) ? { previous: session.history?.[0] || null, history: (session.history || []).slice(0, 5) } : {};
  return { session: publicSession(session, viewer), admission, ...you, queue: session.queue, fallbackQueue: session.fallback ? fallbackQueueOf(session) : null, ...host, current: session.current, playing: session.playing, activity: session.activity };
};
// Enregistrement sur disque : JSON compact, et plusieurs demandes rapprochées (un titre ajouté, un invité qui arrive…)
// ne font qu’une seule écriture de plus au lieu d’une par demande.
const saved = new Map();
let writing = null;
let writeAgain = false;
// Une entrée par session (limite de taille du stockage) ; seules les sessions modifiées sont réécrites.
const writeStore = async () => {
  const puts = {};
  for (const [code, session] of sessions) {
    const json = JSON.stringify(session);
    if (saved.get(code) !== json) { saved.set(code, json); puts[`session:${code}`] = json; }
  }
  const entries = Object.entries(puts);
  for (let index = 0; index < entries.length; index += 100) await storage.put(Object.fromEntries(entries.slice(index, index + 100)));
  const gone = [...saved.keys()].filter((code) => !sessions.has(code));
  for (const code of gone) { saved.delete(code); await storage.delete(`session:${code}`); }
};
// Regroupé et différé : une action n’attend pas l’écriture pour répondre, et plusieurs changements n’en font qu’une.
let saveTimer = null;
const persist = () => {
  for (const code of clients.keys()) if (clients.get(code).size && sessions.has(code)) sessions.get(code).updatedAt = Date.now();
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    if (writing) { writeAgain = true; return; }
    writing = (async () => {
      do { writeAgain = false; await writeStore(); } while (writeAgain);
    })().catch((error) => console.error(error)).finally(() => { writing = null; });
  }, 300);
  return Promise.resolve();
};
// Plusieurs changements rapprochés ne font qu’une diffusion, et personne ne reçoit un message identique au précédent.
const pendingBroadcasts = new Set();
let broadcastTimer = null;
const sendPayload = (client, session) => {
  const message = JSON.stringify(payload(session, client.sono));
  if (client.sono.lastSent === message) return;
  client.sono.lastSent = message;
  client.send(message);
};
const broadcast = (session) => {
  pendingBroadcasts.add(session);
  broadcastTimer ??= setTimeout(() => {
    broadcastTimer = null;
    for (const pending of pendingBroadcasts) for (const client of clients.get(pending.code) || []) if (client.readyState === WebSocket.OPEN) sendPayload(client, pending);
    pendingBroadcasts.clear();
  }, 15);
};
const findSession = (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) { res.status(404).json({ error: 'Cette session n’existe pas ou a expiré.' }); return null; }
  return session;
};
// Réservé à l’hôte : réglages, apparence, connexions, invités retirés, suppression, activité…
const authorizeHost = (req, res, session) => {
  if (!hostAccess(session, req.get('x-host-token'))?.owner) {
    res.status(403).json({ error: 'Seul l’hôte peut effectuer cette action.' });
    return false;
  }
  return true;
};
// Commandes ouvertes aux admins : lecture, nouveaux arrivants, file d’attente.
const authorizeControl = (req, res, session) => {
  const access = hostAccess(session, req.get('x-host-token'));
  if (!access) {
    res.status(403).json({ error: 'Seul l’hôte ou un admin peut effectuer cette action.' });
    return false;
  }
  req.access = access;
  return true;
};
const text = (value, max = 160) => String(value || '').trim().slice(0, max);
const addActivity = (session, icon, message) => {
  session.activity.unshift({ icon, text: message, at: new Date().toISOString() });
  session.activity = session.activity.slice(0, 40);
};

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Sono' }));
app.get('/api/config', (req, res) => res.json({ networkUrl: null, publicUrl: null }));
app.get('/api/sessions/:code', (req, res) => {
  const session = findSession(req, res);
  if (session) res.json(payload(session, viewerFromRequest(req, session)));
});
app.post('/api/host/resume', (req, res) => {
  const session = sessions.get(text(req.body.code, 20));
  if (!session) return res.status(404).json({ error: 'Cette session n’existe pas ou a expiré.' });
  if (!authorizeHost(req, res, session)) return;
  res.json(payload(session, viewerFromRequest(req, session)));
});
// Sur Internet, aucune session n’est ouverte sans sa clé d’hôte.
app.post('/api/sessions', async (req, res) => {
  const previous = sessions.get(text(req.body.previousCode, 20));
  const trustedPrevious = previous && req.get('x-host-token') === previous.hostToken ? previous : null;
  const name = text(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Donnez un nom à votre session.' });
  let code;
  do { code = `SONO-${crypto.randomInt(1000, 10000)}`; } while (sessions.has(code));
  const host = text(req.body.host, 30) || trustedPrevious?.host || 'Hôte';
  const requireApproval = typeof req.body.requireApproval === 'boolean' ? req.body.requireApproval : Boolean(trustedPrevious?.requireApproval);
  const session = { code, name, host, active: true, requireApproval, playbackSource: 'Deezer', updatedAt: Date.now(), members: {}, hostToken: crypto.randomUUID(), queue: [], history: [], playing: false, current: null, activity: [{ icon: 'music', text: 'La session est prête', at: new Date().toISOString() }] };
  sessions.set(code, session);
  pruneSessions();
  await persist();
  res.status(201).json({ hostToken: session.hostToken, ...payload(session) });
});
app.post('/api/sessions/:code/tracks', async (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const viewer = viewerFromRequest(req, session);
  const memberName = session.members?.[viewer.clientId]?.name;
  if (viewer.role !== 'host' && !memberName) return res.status(403).json({ error: 'Indiquez votre prénom pour rejoindre la session.' });
  if (admissionOf(session, viewer) !== 'accepted') return res.status(403).json({ error: 'L’hôte doit d’abord accepter votre demande.' });
  const track = req.body.track || {};
  const title = text(track.title, 180);
  const artist = text(track.artist, 180);
  if (!title || !artist) return res.status(400).json({ error: 'Ce titre est incomplet. Essayez un autre résultat.' });
  if (session.queue.some((item) => item.title.toLowerCase() === title.toLowerCase() && item.artist.toLowerCase() === artist.toLowerCase())) return res.status(409).json({ error: 'Ce titre figure déjà dans la file.' });
  // Le nom affiché vient du serveur : un invité ne peut pas se faire passer pour quelqu’un d’autre.
  const addedBy = viewer.role === 'host' ? session.host : memberName;
  const item = { id: crypto.randomUUID(), providerId: text(track.providerId || track.id, 120), title, artist, album: text(track.album, 180), duration: text(track.duration, 12), durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0, cover: text(track.cover, 700), addedBy, source: text(track.source, 40) || 'Recherche' };
  session.queue.push(item);
  addActivity(session, 'plus', `${addedBy} a ajouté « ${title} »`);
  await persist(); broadcast(session);
  res.status(201).json({ track: item, ...payload(session, viewer) });
});
app.delete('/api/sessions/:code/tracks/:id', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  const track = session.queue.find((item) => item.id === req.params.id);
  session.queue = session.queue.filter((item) => item.id !== req.params.id);
  if (track) addActivity(session, 'music', `L’hôte a retiré « ${track.title} »`);
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.patch('/api/sessions/:code/queue', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const byId = new Map(session.queue.map((item) => [item.id, item]));
  if (ids.length !== session.queue.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return res.status(400).json({ error: 'Le nouvel ordre de la file est invalide.' });
  session.queue = ids.map((id) => byId.get(id));
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.post('/api/sessions/:code/playback', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  if (!['next', 'previous', 'toggle', 'ended'].includes(req.body.action)) return res.status(400).json({ error: 'Cette commande de lecture est invalide.' });
  if (req.body.action === 'toggle' && !session.current) return res.status(400).json({ error: 'Aucun titre n’est en cours de lecture.' });
  // Passage automatique : si un autre appareil hôte a déjà avancé, on ne saute pas un deuxième titre.
  const expected = req.body.expected;
  if (expected !== undefined && (session.current?.id || null) !== (expected || null)) return res.json(payload(session, viewerFromRequest(req, session)));
  session.history = Array.isArray(session.history) ? session.history : [];
  // Plusieurs titres passés d’un coup : le moteur ne reçoit que le dernier, celui qui doit vraiment jouer.
  const count = Math.max(1, Math.min(100, Math.round(Number(req.body.count)) || 1));
  if (req.body.action === 'next') {
    for (let step = 0; step < count; step += 1) {
      const track = session.queue.shift() || takeFallback(session);
      if (!track) {
        if (step) break;
        return res.status(400).json({ error: 'La file est vide. Ajoutez un titre ou choisissez une musique de fond.' });
      }
      if (session.current) session.history = [session.current, ...session.history].slice(0, 30);
      session.current = track;
    }
    session.playing = true;
  } else if (req.body.action === 'previous') {
    for (let step = 0; step < count; step += 1) {
      const previous = session.history.shift();
      if (!previous) {
        if (step) break;
        return res.status(400).json({ error: 'Aucun titre précédent.' });
      }
      // Le titre en cours retourne en tête : dans la musique de fond s’il en venait, sinon dans la file.
      const current = session.current;
      if (current?.fromFallback && session.fallback?.tracks?.[current.fallbackIndex]) fallbackUpcoming(session).unshift(current.fallbackIndex);
      else if (current) session.queue.unshift(current);
      session.current = previous;
    }
    session.playing = true;
  } else if (req.body.action === 'ended') session.playing = false;
  else session.playing = !session.playing;
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.patch('/api/sessions/:code', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  if (req.body.name !== undefined) {
    const name = text(req.body.name, 80);
    if (!name) return res.status(400).json({ error: 'Le nom de la session ne peut pas être vide.' });
    session.name = name;
  }
  if (req.body.host !== undefined) {
    const host = text(req.body.host, 30);
    if (!host) return res.status(400).json({ error: 'Indiquez le nom affiché aux invités.' });
    session.host = host;
  }
  if (['Deezer', 'Apple Music'].includes(req.body.playbackSource)) session.playbackSource = req.body.playbackSource;
  if (Array.isArray(req.body.apps)) session.apps = req.body.apps.filter((app) => ['Deezer', 'Apple Music'].includes(app));
  if (req.body.theme !== undefined) session.theme = cleanTheme(req.body.theme);
  if (typeof req.body.requireApproval === 'boolean') {
    if (req.body.requireApproval && !session.requireApproval) {
      // Les invités déjà présents, connectés ou non, restent dans la session.
      session.members = session.members || {};
      for (const member of Object.values(session.members)) if (member.name && !member.status) member.status = 'accepted';
    }
    session.requireApproval = req.body.requireApproval;
  }
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.post('/api/sessions/:code/admissions', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  if (!['accept', 'refuse'].includes(req.body.decision)) return res.status(400).json({ error: 'Cette décision est invalide.' });
  const id = text(req.body.id, 20);
  const sockets = [...(clients.get(session.code) || [])].filter((socket) => socket.sono?.role === 'guest');
  const clientIds = new Set([...Object.keys(session.members || {}), ...sockets.map((socket) => socket.sono.clientId)]);
  const clientId = [...clientIds].find((candidate) => memberKey(session, candidate) === id);
  if (!clientId) return res.status(404).json({ error: 'Cette demande n’existe plus.' });
  session.members = session.members || {};
  const live = sockets.find((socket) => socket.sono.clientId === clientId)?.sono;
  const name = session.members[clientId]?.name || live?.name || 'Un invité';
  const accepted = req.body.decision === 'accept';
  session.members[clientId] = { ...session.members[clientId], status: accepted ? 'accepted' : 'refused', name, since: session.members[clientId]?.since || live?.since || new Date().toISOString() };
  if (accepted) delete session.members[clientId].mustAsk;
  if (accepted) {
    session.knownGuests = [...(Array.isArray(session.knownGuests) ? session.knownGuests : []), clientId].slice(-200);
    addActivity(session, 'user', `${name} a rejoint la session`);
  } else addActivity(session, 'user', `La demande de ${name} a été refusée`);
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.delete('/api/sessions/:code/members/:id', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  const id = text(req.params.id, 20);
  const clientId = Object.keys(session.members || {}).find((candidate) => memberKey(session, candidate) === id);
  if (!clientId) return res.status(404).json({ error: 'Cet invité ne fait plus partie de la session.' });
  const member = session.members[clientId];
  delete member.admin; delete member.adminKey;
  member.status = 'removed';
  member.mustAsk = true;
  addActivity(session, 'user', `${member.name} a été retiré de la session`);
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
// L’hôte nomme (ou retire) un admin parmi les invités admis.
app.patch('/api/sessions/:code/admins', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  const id = text(req.body.id, 20);
  const clientId = Object.keys(session.members || {}).find((candidate) => memberKey(session, candidate) === id);
  const member = clientId && session.members[clientId];
  if (!member?.name || member.status === 'removed' || member.status === 'left') return res.status(404).json({ error: 'Cet invité ne fait plus partie de la session.' });
  const admin = Boolean(req.body.admin);
  if (admin && !member.admin) {
    member.admin = true;
    member.adminKey = crypto.randomBytes(24).toString('hex');
    addActivity(session, 'user', `${member.name} est maintenant admin`);
  } else if (!admin && member.admin) {
    delete member.admin; delete member.adminKey;
    addActivity(session, 'user', `${member.name} n’est plus admin`);
  }
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
// Quand l’hôte quitte sa session, la musique s’arrête.
const stopSessionMusic = async (session, reason) => {
  if (!session.playing) return;
  session.playing = false;
  addActivity(session, 'music', reason);
  await persist();
  broadcast(session);
};
app.post('/api/sessions/:code/stop', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  await stopSessionMusic(session, 'Musique coupée : l’hôte a quitté la session');
  res.json(payload(session, viewerFromRequest(req, session)));
});
// L’hôte a déconnecté son app de musique : la session repart de zéro (lecture, file, historique, musique de fond),
// avec les mêmes invités et le même code.
app.post('/api/sessions/:code/reset', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  session.playing = false;
  session.current = null;
  session.queue = [];
  session.history = [];
  session.fallback = null;
  addActivity(session, 'music', 'App de musique déconnectée : la file repart de zéro');
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.delete('/api/sessions/:code', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  await stopSessionMusic(session, 'Musique coupée : session supprimée');
  for (const client of clients.get(session.code) || []) client.close(4004, 'Session supprimée');
  clients.delete(session.code);
  sessions.delete(session.code);
  await persist();
  res.json({ ok: true });
});

const appleWebBaseUrl = 'https://beta.music.apple.com';
const appleApiBaseUrl = 'https://amp-api.music.apple.com';
let applePublicToken = null;
let appleTokenPromise = null;
const appleFetchText = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Apple Music a répondu avec le code ${response.status}.`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error('La réponse publique d’Apple Music est trop volumineuse.');
  return body;
};
const getApplePublicToken = async () => {
  if (applePublicToken?.expiresAt > Date.now() + 60000) return applePublicToken.value;
  if (appleTokenPromise) return appleTokenPromise;
  appleTokenPromise = (async () => {
    const html = await appleFetchText(appleWebBaseUrl);
    const scriptPath = html.match(/<script[^>]+src=["'](\/assets\/index[^"']+\.js)["']/)?.[1];
    if (!scriptPath || !/^\/assets\/index[A-Za-z0-9_.~-]+\.js$/.test(scriptPath)) throw new Error('Le script public Apple Music est introuvable.');
    const javascript = await appleFetchText(`${appleWebBaseUrl}${scriptPath}`);
    const value = javascript.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
    if (!value) throw new Error('Le jeton public Apple Music est introuvable.');
    let payload;
    try { payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
    catch { throw new Error('Le jeton public Apple Music est illisible.'); }
    if (!payload.exp || payload.exp * 1000 <= Date.now() + 60000) throw new Error('Le jeton public Apple Music est expiré.');
    applePublicToken = { value, expiresAt: payload.exp * 1000 };
    return value;
  })();
  try { return await appleTokenPromise; }
  finally { appleTokenPromise = null; }
};
const appleSearch = async (query, limit = 10) => {
  const token = await getApplePublicToken();
  const parameters = new URLSearchParams({ term: query, types: 'songs', limit: String(limit) });
  const response = await fetch(`${appleApiBaseUrl}/v1/catalog/fr/search?${parameters}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) applePublicToken = null;
    throw new Error(`Le catalogue Apple Music a répondu avec le code ${response.status}.`);
  }
  const data = await response.json();
  return data.results?.songs?.data || [];
};
const normalizeAppleTrack = (track) => {
  const details = track.attributes || {};
  return {
    providerId: String(track.id),
    title: details.name,
    artist: details.artistName || 'Artiste inconnu',
    album: details.albumName || '',
    duration: details.durationInMillis,
    cover: details.artwork?.url?.replace('{w}', '400').replace('{h}', '400') || '',
    previewUrl: details.previews?.[0]?.url || '',
    url: details.url || '',
  };
};
app.get('/api/integrations/apple/search', async (req, res) => {
  const query = text(req.query.q, 120);
  if (!query) return res.json({ tracks: [] });
  try { res.json({ tracks: (await appleSearch(query)).map(normalizeAppleTrack) }); }
  catch (error) { res.status(502).json({ error: `Recherche Apple Music impossible : ${error.message}` }); }
});

// Catalogue pour la musique de fond (playlists, albums, artistes) sur l’app de lecture.
// Toute la playlist est chargée (limite de sécurité très haute).
const FALLBACK_MAX_TRACKS = 2000;
const deezerApi = async (pathname) => {
  const response = await fetch(`${deezerApiBaseUrl}${pathname}`, { signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || `Deezer a répondu avec le code ${response.status}.`);
  return data;
};
const appleCatalog = async (pathname) => {
  const token = await getApplePublicToken();
  const ask = () => fetch(`${appleApiBaseUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  // Apple limite par moments les demandes venant des serveurs : on réessaie un peu plus tard.
  let response = await ask();
  for (let attempt = 1; attempt <= 3 && response.status === 429; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    response = await ask();
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) applePublicToken = null;
    throw new Error(`Le catalogue Apple Music a répondu avec le code ${response.status}.`);
  }
  return response.json();
};
const appleArtwork = (artwork) => artwork?.url?.replace('{w}', '400').replace('{h}', '400') || '';
const deezerItem = (type, item) => ({
  type,
  id: String(item.id),
  name: item.title || item.name || '',
  subtitle: type === 'playlist' ? `${item.nb_tracks || 0} titres${item.user?.name ? ` · ${item.user.name}` : ''}` : type === 'album' ? item.artist?.name || '' : `${item.nb_fan ? `${item.nb_fan.toLocaleString('fr-FR')} fans` : 'Artiste'}`,
  cover: item.picture_xl || item.picture_big || item.cover_xl || item.cover_big || item.picture_medium || item.cover_medium || '',
});
const appleItem = (type, item) => {
  const details = item.attributes || {};
  return { type, id: String(item.id), name: details.name || '', subtitle: type === 'playlist' ? details.curatorName || 'Playlist' : type === 'album' ? details.artistName || '' : (details.genreNames || [])[0] || 'Artiste', cover: appleArtwork(details.artwork) };
};
const deezerTrack = (track, album) => ({
  providerId: String(track.id),
  title: track.title,
  artist: track.artist?.name || 'Artiste inconnu',
  album: track.album?.title || album?.title || '',
  durationMs: (track.duration || 0) * 1000,
  cover: track.album?.cover_xl || track.album?.cover_big || album?.cover_xl || '',
  source: 'Deezer',
});
const appleTrack = (track) => {
  const normalized = normalizeAppleTrack(track);
  return { providerId: normalized.providerId, title: normalized.title, artist: normalized.artist, album: normalized.album, durationMs: normalized.duration || 0, cover: normalized.cover, source: 'Apple Music' };
};
const catalogSearch = async (source, query) => {
  if (source === 'Deezer') {
    const q = encodeURIComponent(query);
    const [playlists, albums, artists] = await Promise.all(['playlist', 'album', 'artist'].map((type) => deezerApi(`/search/${type}?q=${q}&limit=8`)));
    return { playlists: playlists.data.map((item) => deezerItem('playlist', item)), albums: albums.data.map((item) => deezerItem('album', item)), artists: artists.data.map((item) => deezerItem('artist', item)) };
  }
  const parameters = new URLSearchParams({ term: query, types: 'playlists,albums,artists', limit: '8' });
  const results = (await appleCatalog(`/v1/catalog/fr/search?${parameters}`)).results || {};
  return { playlists: (results.playlists?.data || []).map((item) => appleItem('playlist', item)), albums: (results.albums?.data || []).map((item) => appleItem('album', item)), artists: (results.artists?.data || []).map((item) => appleItem('artist', item)) };
};
const catalogTracks = async (source, type, id) => {
  const safeId = encodeURIComponent(id);
  if (source === 'Deezer') {
    if (type === 'artist') return (await deezerApi(`/artist/${safeId}/top?limit=50`)).data.map((track) => deezerTrack(track));
    if (type === 'album') {
      const album = await deezerApi(`/album/${safeId}`);
      return (album.tracks?.data || []).map((track) => deezerTrack(track, album));
    }
    const tracks = [];
    for (let index = 0; tracks.length < FALLBACK_MAX_TRACKS;) {
      const page = await deezerApi(`/playlist/${safeId}/tracks?index=${index}&limit=1000`);
      const items = page.data || [];
      tracks.push(...items.map((track) => deezerTrack(track)));
      index += items.length;
      if (!items.length || index >= (page.total ?? index)) break;
    }
    return tracks;
  }
  if (type === 'artist') return ((await appleCatalog(`/v1/catalog/fr/artists/${safeId}/view/top-songs?limit=30`)).data || []).map(appleTrack);
  const tracks = [];
  let next = `/v1/catalog/fr/${type === 'album' ? 'albums' : 'playlists'}/${safeId}/tracks?limit=100`;
  while (next && tracks.length < FALLBACK_MAX_TRACKS) {
    const page = await appleCatalog(next);
    tracks.push(...(page.data || []).filter((item) => item.type === 'songs' || !item.type).map(appleTrack));
    next = page.next || null;
  }
  return tracks;
};
const cleanTrack = (track) => ({
  providerId: text(track.providerId, 80),
  title: text(track.title, 200),
  artist: text(track.artist, 200) || 'Artiste inconnu',
  album: text(track.album, 200),
  durationMs: Math.max(0, Math.min(Number(track.durationMs) || 0, 3600000)),
  cover: /^https:\/\//.test(String(track.cover || '')) ? text(track.cover, 500) : '',
  source: track.source === 'Apple Music' ? 'Apple Music' : 'Deezer',
});
const catalogSource = (session, req, res) => {
  const source = req.query.source || req.body?.source || session.playbackSource || 'Deezer';
  if (!['Deezer', 'Apple Music'].includes(source)) { res.status(400).json({ error: 'Cette source de lecture est inconnue.' }); return null; }
  return source;
};
app.get('/api/sessions/:code/catalog/search', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  const source = catalogSource(session, req, res);
  const query = text(req.query.q, 120);
  if (!source) return;
  if (!query) return res.json({ playlists: [], albums: [], artists: [] });
  try { res.json(await catalogSearch(source, query)); }
  catch (error) { res.status(502).json({ error: `Recherche ${source} impossible : ${error.message}` }); }
});
app.get('/api/sessions/:code/catalog/mine', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  const userId = text(req.query.user, 30);
  if (!/^\d+$/.test(userId)) return res.json({ playlists: [] });
  try { res.json({ playlists: (await deezerApi(`/user/${userId}/playlists?limit=50`)).data.map((item) => deezerItem('playlist', item)) }); }
  catch (error) { res.status(502).json({ error: `Vos playlists Deezer sont indisponibles : ${error.message}` }); }
});
app.put('/api/sessions/:code/fallback', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  const source = catalogSource(session, req, res);
  if (!source) return;
  const type = ['playlist', 'album', 'artist'].includes(req.body.type) ? req.body.type : null;
  const id = text(req.body.id, 80);
  if (!type || !id) return res.status(400).json({ error: 'Choisissez une playlist, un album ou un artiste.' });
  try {
    // Les playlists de la bibliothèque Apple Music ne sont lisibles que depuis l’appareil de l’hôte, qui envoie leurs titres.
    const fromDevice = Array.isArray(req.body.tracks);
    const tracks = (fromDevice ? req.body.tracks.slice(0, FALLBACK_MAX_TRACKS).map(cleanTrack) : (await catalogTracks(source, type, id)).slice(0, FALLBACK_MAX_TRACKS)).filter((track) => track.providerId && track.title);
    if (!tracks.length) return res.status(400).json({ error: 'Aucun titre lisible n’a été trouvé dans cette sélection.' });
    session.fallback = { type, id, source, name: text(req.body.name, 120) || 'Musique de fond', subtitle: text(req.body.subtitle, 160), cover: /^https:\/\//.test(String(req.body.cover || '')) ? text(req.body.cover, 500) : '', tracks };
    session.fallback.upcoming = fallbackOrder(session.fallback);
    addActivity(session, 'music', `Musique de fond : ${session.fallback.name}`);
    await persist(); broadcast(session);
    res.json(payload(session, viewerFromRequest(req, session)));
  } catch (error) { res.status(502).json({ error: `Impossible de charger cette sélection : ${error.message}` }); }
});
app.get('/api/sessions/:code/fallback/upcoming', (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  if (admissionOf(session, viewerFromRequest(req, session)) !== 'accepted') return res.status(403).json({ error: 'Vous n’avez pas encore accès à cette session.' });
  const upcoming = session.fallback ? fallbackUpcoming(session) : [];
  res.json({ tracks: upcoming.map((index) => fallbackItem(session, index)), total: upcoming.length });
});
// Réordonne les titres de fond à venir : le titre d’index donné passe à la position voulue.
app.patch('/api/sessions/:code/fallback/order', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  const upcoming = fallbackUpcoming(session);
  const from = upcoming.indexOf(Number(req.body.index));
  if (from < 0) return res.status(404).json({ error: 'Ce titre n’est plus dans la musique de fond à venir.' });
  const to = Math.max(0, Math.min(upcoming.length - 1, Math.round(Number(req.body.to) || 0)));
  upcoming.splice(to, 0, upcoming.splice(from, 1)[0]);
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.delete('/api/sessions/:code/fallback/tracks/:index', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeControl(req, res, session)) return;
  const index = Number(req.params.index);
  const upcoming = fallbackUpcoming(session);
  const position = upcoming.indexOf(index);
  if (position < 0) return res.status(404).json({ error: 'Ce titre n’est plus dans la musique de fond à venir.' });
  upcoming.splice(position, 1);
  // Titre que le compte ne peut pas lire : il ne reviendra plus aux tours suivants.
  if (req.query.unavailable) session.fallback.blocked = [...new Set([...(session.fallback.blocked || []), index])];
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});
app.delete('/api/sessions/:code/fallback', async (req, res) => {
  const session = findSession(req, res);
  if (!session || !authorizeHost(req, res, session)) return;
  session.fallback = null;
  await persist(); broadcast(session);
  res.json(payload(session, viewerFromRequest(req, session)));
});

// Recherche de titres pour tous (invités compris), par l’API publique de Deezer.
app.get('/api/integrations/opendeezer/search', async (req, res) => {
  const query = text(req.query.q, 120);
  if (!query) return res.json({ data: [] });
  try { res.json({ data: (await deezerApi(`/search?q=${encodeURIComponent(query)}&limit=25`)).data || [] }); }
  catch (error) { res.status(502).json({ error: `Recherche Deezer impossible : ${error.message}` }); }
});
// Réglages du son : gardés avec la session, appliqués au moteur par l’iPhone de l’hôte.
const cleanSound = (value) => {
  const db = (v) => Math.max(-12, Math.min(12, Math.round((Number(v) || 0) * 2) / 2));
  return { bass: db(value?.bass), mid: db(value?.mid), treble: db(value?.treble) };
};
app.get('/api/sound', (req, res) => {
  const session = sessions.get(text(req.query.code, 20));
  if (!session || !authorizeHost(req, res, session)) return;
  res.json({ sound: cleanSound(session.sound), engine: true });
});
app.put('/api/sound', async (req, res) => {
  const session = sessions.get(text(req.body.code, 20));
  if (!session || !authorizeHost(req, res, session)) return;
  session.sound = cleanSound(req.body.sound);
  await persist();
  res.json({ sound: session.sound, engine: true });
});

const HOST_LEAVE_GRACE_MS = 20000;
// « Quitter la session » : l’invité sort de la liste et pourra revenir librement.
const markGuestLeft = async (session, meta) => {
  const member = session.members?.[meta.clientId];
  if (meta.role !== 'guest' || !member?.name || admissionOf(session, meta) !== 'accepted') return;
  member.status = 'left';
  addActivity(session, 'user', `${member.name} a quitté la session`);
  await persist();
  broadcast(session);
};
// L’hôte hors ligne (réseau perdu, app fermée) : la session reste ouverte et un admin peut prendre la main.
const reviewHostAbsence = async (session) => {
  const online = [...(clients.get(session.code) || [])].filter((socket) => socket.readyState === WebSocket.OPEN);
  if (online.some((socket) => socket.sono?.role === 'host')) return;
  if (!session.activity?.[0]?.text?.includes('s’est absenté')) { addActivity(session, 'user', 'L’hôte s’est absenté'); await persist(); broadcast(session); }
};
const onConnection = (socket, code) => {
  if (!clients.has(code)) clients.set(code, new Set());
  clients.get(code).add(socket);
  const session = sessions.get(code);
  socket.sono = { clientId: crypto.randomUUID(), name: '', role: 'guest', since: new Date().toISOString(), greeted: false };
  sendPayload(socket, session);
  broadcast(session);
  socket.on('message', async (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    const meta = socket.sono;
    if (message?.type === 'leave') { await markGuestLeft(session, meta); socket.close(1000, 'Invité parti'); return; }
    if (message?.type !== 'hello') return;
    meta.clientId = text(message.clientId, 64) || meta.clientId;
    meta.role = hostAccess(session, text(message.hostToken, 80))?.owner ? 'host' : 'guest';
    meta.greeted = true;
    session.knownGuests = Array.isArray(session.knownGuests) ? session.knownGuests : [];
    session.members = session.members || {};
    if (meta.role === 'host') { meta.name = ''; broadcast(session); return; }
    const member = session.members[meta.clientId];
    // Le prénom est choisi une seule fois par appareil et ne change plus pendant la session.
    const lockedName = member?.name || text(message.name, 30);
    meta.name = lockedName;
    if (!lockedName) { broadcast(session); return; }
    const now = new Date().toISOString();
    if (!member?.name) session.members[meta.clientId] = { ...member, name: lockedName, since: member?.since || now };
    const current = session.members[meta.clientId];
    if (current.status === 'removed') {
      if (message.retry) {
        current.status = 'pending';
        current.since = now;
        addActivity(session, 'user', `${lockedName} demande à revenir`);
      }
    } else if (current.status === 'left') {
      current.status = 'accepted';
      addActivity(session, 'user', `${lockedName} est de retour`);
    } else if (session.requireApproval || current.mustAsk) {
      if (!current.status || (current.status === 'refused' && message.retry)) {
        current.status = 'pending';
        current.since = now;
        addActivity(session, 'user', `${lockedName} demande à rejoindre`);
      }
    } else if (!session.knownGuests.includes(meta.clientId)) {
      session.knownGuests = [...session.knownGuests, meta.clientId].slice(-200);
      addActivity(session, 'user', `${lockedName} a rejoint la session`);
    }
    await persist();
    broadcast(session);
  });
  socket.on('close', () => {
    clients.get(code)?.delete(socket);
    broadcast(session);
    const { role } = socket.sono;
    if (role === 'host') setTimeout(() => { if (sessions.get(code) === session) reviewHostAbsence(session); }, HOST_LEAVE_GRACE_MS);
  });
};

// Sessions inutilisées depuis 7 jours supprimées ; 200 au plus (les plus anciennes partent d’abord).
const pruneSessions = () => {
  const limit = Date.now() - 7 * 24 * 3600 * 1000;
  for (const [code, session] of sessions) if ((session.updatedAt || 0) < limit && !clients.get(code)?.size) sessions.delete(code);
  const oldest = [...sessions.values()].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  while (oldest.length > 200) sessions.delete(oldest.shift().code);
};
const DAY_MS = 24 * 3600 * 1000;
export class SonoHub {
  constructor(ctx, env) {
    storage = ctx.storage;
    if (env.DEEZER_API_BASE_URL) deezerApiBaseUrl = env.DEEZER_API_BASE_URL.replace(/\/$/, '');
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list({ prefix: 'session:' });
      sessions = new Map();
      for (const [key, json] of stored) { sessions.set(key.slice(8), JSON.parse(json)); saved.set(key.slice(8), json); }
      // Le ménage passe une fois par jour, même si personne ne crée de session.
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }
  async alarm() {
    pruneSessions();
    await persist();
    await storage.setAlarm(Date.now() + DAY_MS);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const code = url.searchParams.get('session')?.toUpperCase();
      if (!sessions.has(code)) return new Response('Session inconnue', { status: 404 });
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const adapter = new SocketAdapter(server);
      sessions.get(code).updatedAt = Date.now();
      onConnection(adapter, code);
      return new Response(null, { status: 101, webSocket: client });
    }
    return app.handle(request);
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path === '/ws') return env.SONO_HUB.get(env.SONO_HUB.idFromName('sono')).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

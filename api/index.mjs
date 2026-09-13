import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};

const defaultAdmins = [
  { username: 'MotorniczyKuba', email: 'admin@mpk.test', password: 'admin123', role: 'Właściciel', activity: 'Teraz', initials: 'MK', color: 'coral' },
  { username: 'Olek_Tramwaj', email: 'moderator@mpk.test', password: 'mod1234', role: 'Moderator', activity: 'Dzisiaj, 09:18', initials: 'OT', color: 'blue' },
  { username: 'Zarzad_MPK', email: 'zarzad@mpk.test', password: 'zarzad123', role: 'Moderator', activity: 'Wczoraj, 21:42', initials: 'ZM', color: 'green' }
];
const officialFeeds = {
  mpk: 'https://www.mpk.poznan.pl/feed/',
  ztm: 'https://www.ztm.poznan.pl/feed/'
};
const ownerEmails = new Set(['admin@mpk.test', 'filip@gmail.com']);

let memoryState;
const localStatePath = join(process.cwd(), '.local-data', 'app-state.json');

const response = (res, status, body) => {
  res.statusCode = status;
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(body));
};
const hash = password => createHash('sha256').update(password).digest('hex');

function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Brak konfiguracji Supabase');
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...options.headers
    }
  });
}

function createInitialState() {
  return {
    admins: defaultAdmins.map(admin => ({ ...admin, password: hash(admin.password) })),
    messages: [],
    mpkAnnouncements: [],
    ztmAnnouncements: [],
    online: true,
    offlineMessage: '',
    sessions: {}
  };
}

function normalizeOwners(state) {
  state.admins.forEach(admin => {
    if (ownerEmails.has(String(admin.email).trim().toLowerCase())) admin.role = 'Właściciel';
  });
  state.mpkAnnouncements ||= [];
  state.ztmAnnouncements ||= [];
  return state;
}

function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).trim();
}

async function getOfficialAnnouncements(source) {
  const result = await fetch(officialFeeds[source], { cache: 'no-store', headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'MPK-Poznan-Official-Feed/1.0' } });
  if (!result.ok) throw new Error(`Oficjalny kanał ${source} jest niedostępny`);
  const xml = await result.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 4).map(match => {
    const item = match[1];
    const read = tag => decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
    const publishedAt = read('pubDate');
    const content = read('description').replace(/\s*Artykuł[\s\S]*?pochodzi z serwisu[^.]*\.?$/i, '').trim();
    return { title: read('title'), content, date: publishedAt ? new Date(publishedAt).toLocaleDateString('pl-PL') : '', link: read('link') };
  }).filter(item => item.title && item.content);
}

async function getState() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!memoryState && existsSync(localStatePath)) {
      try { memoryState = JSON.parse(readFileSync(localStatePath, 'utf8')); } catch { memoryState = null; }
    }
    memoryState ||= createInitialState();
    return normalizeOwners(memoryState);
  }
  const result = await supabaseRequest('app_state?key=eq.main&select=value');
  if (!result.ok) throw new Error('Nie udało się odczytać danych Supabase');
  const rows = await result.json();
  if (rows[0]?.value) return normalizeOwners(rows[0].value);
  const state = createInitialState();
  await saveState(state);
  return state;
}

async function saveState(state) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    memoryState = state;
    mkdirSync(dirname(localStatePath), { recursive: true });
    writeFileSync(localStatePath, JSON.stringify(state), 'utf8');
    return;
  }
  const result = await supabaseRequest('app_state', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'main', value: state, updated_at: new Date().toISOString() })
  });
  if (!result.ok) throw new Error('Nie udało się zapisać danych Supabase');
}

async function getSession(request, state) {
  const authorization = request.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const session = token ? state.sessions[token] : null;
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

export default async function handler(request, res) {
  if (request.method === 'OPTIONS') {
    res.statusCode = 204;
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    return res.end();
  }
  try {
    const state = await getState();
    const body = request.method === 'POST' ? await new Promise((resolve, reject) => {
      let raw = '';
      request.on('data', chunk => { raw += chunk; });
      request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
      request.on('error', reject);
    }) : {};
    const action = body.action || new URL(request.url, `https://${request.headers.host || 'localhost'}`).searchParams.get('action') || 'status';
    if (action === 'status') return response(res, 200, { online: state.online !== false, message: state.offlineMessage || '' });
    if (action === 'login') {
      const admin = state.admins.find(item => item.email.toLowerCase() === String(body.email).trim().toLowerCase() && item.password === hash(String(body.password)));
      if (!admin) return response(res, 401, { error: 'Błędny e-mail lub hasło' });
      const token = randomUUID();
      state.sessions[token] = { username: admin.username, role: admin.role, expiresAt: Date.now() + 86400000 };
      await saveState(state);
      return response(res, 200, { token, admin: { username: admin.username, role: admin.role } });
    }
    if (action === 'public-message') return response(res, 200, { message: state.messages[0] || null });
    if (action === 'mpk-announcements') {
      try {
        const announcements = await getOfficialAnnouncements('mpk');
        state.mpkAnnouncements = announcements;
        await saveState(state);
        return response(res, 200, { announcements, source: officialFeeds.mpk });
      } catch { return response(res, 503, { announcements: [], source: officialFeeds.mpk, error: 'Oficjalny kanał MPK jest chwilowo niedostępny' }); }
    }
    if (action === 'ztm-announcements') {
      try {
        const announcements = await getOfficialAnnouncements('ztm');
        state.ztmAnnouncements = announcements;
        await saveState(state);
        return response(res, 200, { announcements, source: officialFeeds.ztm });
      } catch { return response(res, 503, { announcements: [], source: officialFeeds.ztm, error: 'Oficjalny kanał ZTM jest chwilowo niedostępny' }); }
    }
    const session = await getSession(request, state);
    if (!session) return response(res, 401, { error: 'Wymagane logowanie administratora' });
    if (action === 'admins') return response(res, 200, { admins: state.admins.map(({ password, ...admin }) => admin) });
    if (action === 'messages') return response(res, 200, { messages: state.messages });
    if (action === 'create-message') {
      if (!['Moderator', 'Administrator', 'Właściciel'].includes(session.role)) return response(res, 403, { error: 'Ta rola nie może wysyłać wiadomości' });
      const title = String(body.title || '').trim().slice(0, 70);
      const content = String(body.content || '').trim().slice(0, 300);
      if (!title || !content) return response(res, 400, { error: 'Tytuł i treść wiadomości są wymagane' });
      const displayMode = body.displayMode === 'modal' ? 'modal' : 'bar';
      const message = { title, content, displayMode, author: session.username, date: new Date().toLocaleString('pl-PL') };
      state.messages.unshift(message);
      state.messages = state.messages.slice(0, 50);
      await saveState(state);
      return response(res, 200, { message });
    }
    if (action === 'create-mpk-announcement') {
      if (!['Moderator', 'Administrator', 'Właściciel'].includes(session.role)) return response(res, 403, { error: 'Ta rola nie może publikować ogłoszeń MPK' });
      const title = String(body.title || '').trim().slice(0, 90);
      const content = String(body.content || '').trim().slice(0, 500);
      if (!title || !content) return response(res, 400, { error: 'Tytuł i treść ogłoszenia są wymagane' });
      const announcement = { title, content, author: session.username, date: new Date().toLocaleString('pl-PL') };
      state.mpkAnnouncements = [announcement, ...(state.mpkAnnouncements || [])].slice(0, 30);
      await saveState(state);
      return response(res, 200, { announcement });
    }
    if (action === 'create-ztm-announcement') {
      if (!['Moderator', 'Administrator', 'Właściciel'].includes(session.role)) return response(res, 403, { error: 'Ta rola nie może publikować ogłoszeń ZTM' });
      const title = String(body.title || '').trim().slice(0, 90);
      const content = String(body.content || '').trim().slice(0, 500);
      if (!title || !content) return response(res, 400, { error: 'Tytuł i treść ogłoszenia są wymagane' });
      const announcement = { title, content, date: new Date().toLocaleString('pl-PL') };
      state.ztmAnnouncements = [announcement, ...(state.ztmAnnouncements || [])].slice(0, 30);
      await saveState(state);
      return response(res, 200, { announcement });
    }
    if (action === 'create-admin') {
      const email = String(body.email || '').trim().toLowerCase();
      const username = String(body.username || '').trim();
      if (state.admins.some(item => item.email.toLowerCase() === email || item.username.toLowerCase() === username.toLowerCase())) return response(res, 409, { error: 'Ten użytkownik lub e-mail już istnieje' });
      state.admins.push({ username, email, password: hash(String(body.password)), role: ownerEmails.has(email) ? 'Właściciel' : body.role, activity: 'Przed chwilą', initials: username.slice(0, 2).toUpperCase(), color: 'blue' });
      await saveState(state);
      return response(res, 200, { ok: true });
    }
    if (action === 'delete-admin') {
      if (session.role !== 'Właściciel') return response(res, 403, { error: 'Tylko właściciel może usuwać konta' });
      const email = String(body.email || '').trim().toLowerCase();
      const target = state.admins.find(item => item.email.toLowerCase() === email);
      if (!target) return response(res, 404, { error: 'Nie znaleziono użytkownika' });
      if (target.username.toLowerCase() === session.username.toLowerCase()) return response(res, 400, { error: 'Nie możesz usunąć własnego konta' });
      state.admins = state.admins.filter(item => item.email.toLowerCase() !== email);
      await saveState(state);
      return response(res, 200, { ok: true });
    }
    if (action === 'set-status') {
      state.online = Boolean(body.online);
      await saveState(state);
      return response(res, 200, { online: state.online });
    }
    if (action === 'set-offline-message') {
      state.offlineMessage = String(body.message || '').trim().slice(0, 180);
      await saveState(state);
      return response(res, 200, { message: state.offlineMessage });
    }
    return response(res, 400, { error: 'Nieznana operacja' });
  } catch (error) {
    console.error(error);
    return response(res, 500, { error: 'Błąd serwera' });
  }
}
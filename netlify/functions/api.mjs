import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';

const store = getStore({ name: 'mpk-shared-state', consistency: 'strong' });
const defaultAdmins = [
  { username: 'MotorniczyKuba', email: 'admin@mpk.test', password: 'admin123', role: 'Administrator', activity: 'Teraz', initials: 'MK', color: 'coral' },
  { username: 'Olek_Tramwaj', email: 'moderator@mpk.test', password: 'mod1234', role: 'Moderator', activity: 'Dzisiaj, 09:18', initials: 'OT', color: 'blue' },
  { username: 'Zarzad_MPK', email: 'zarzad@mpk.test', password: 'zarzad123', role: 'Moderator', activity: 'Wczoraj, 21:42', initials: 'ZM', color: 'green' }
];

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const response = (statusCode, body) => new Response(JSON.stringify(body), { status: statusCode, headers });
const hash = password => createHash('sha256').update(password).digest('hex');

async function getAdmins() {
  const admins = await store.get('admins', { type: 'json' });
  if (admins) return admins;
  const seededAdmins = defaultAdmins.map(admin => ({ ...admin, password: hash(admin.password) }));
  await store.setJSON('admins', seededAdmins);
  return seededAdmins;
}

async function getSession(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return token ? store.get(`session:${token}`, { type: 'json' }) : null;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const body = request.method === 'POST' ? await request.json() : {};
    const action = body.action || new URL(request.url).searchParams.get('action') || 'status';
    if (action === 'status') {
      const storedStatus = await store.get('site-status');
      const message = await store.get('offline-message');
      return response(200, { online: storedStatus !== 'false' && storedStatus !== false, message: message || '' });
    }
    if (action === 'login') {
      const admins = await getAdmins();
      const admin = admins.find(item => item.email.toLowerCase() === String(body.email).trim().toLowerCase() && item.password === hash(String(body.password)));
      if (!admin) return response(401, { error: 'Błędny e-mail lub hasło' });
      const token = randomUUID();
      await store.setJSON(`session:${token}`, { username: admin.username, role: admin.role }, { expiration: Date.now() + 86400000 });
      return response(200, { token, admin: { username: admin.username, role: admin.role } });
    }
    const session = await getSession(request);
    if (!session) return response(401, { error: 'Wymagane logowanie administratora' });
    if (action === 'admins') {
      const admins = await getAdmins();
      return response(200, { admins: admins.map(({ password, ...admin }) => admin) });
    }
    if (action === 'messages') {
      return response(200, { messages: (await store.get('messages', { type: 'json' })) || [] });
    }
    if (action === 'create-message') {
      const title = String(body.title || '').trim().slice(0, 70);
      const content = String(body.content || '').trim().slice(0, 300);
      if (!title || !content) return response(400, { error: 'Tytuł i treść wiadomości są wymagane' });
      const messages = (await store.get('messages', { type: 'json' })) || [];
      const message = { title, content, author: session.username, date: new Date().toLocaleString('pl-PL') };
      messages.unshift(message);
      await store.setJSON('messages', messages.slice(0, 50));
      return response(200, { message });
    }
    if (action === 'create-admin') {
      const admins = await getAdmins();
      const email = String(body.email).trim().toLowerCase();
      const username = String(body.username).trim();
      if (admins.some(item => item.email.toLowerCase() === email || item.username.toLowerCase() === username.toLowerCase())) return response(409, { error: 'Ten użytkownik lub e-mail już istnieje' });
      admins.push({ username, email, password: hash(String(body.password)), role: body.role, activity: 'Przed chwilą', initials: username.slice(0, 2).toUpperCase(), color: 'blue' });
      await store.setJSON('admins', admins);
      return response(200, { ok: true });
    }
    if (action === 'delete-admin') {
      const email = String(body.email || '').trim().toLowerCase();
      const admins = await getAdmins();
      const target = admins.find(item => item.email.toLowerCase() === email);
      if (!target) return response(404, { error: 'Nie znaleziono użytkownika' });
      if (target.username.toLowerCase() === session.username.toLowerCase()) return response(400, { error: 'Nie możesz usunąć własnego konta' });
      await store.setJSON('admins', admins.filter(item => item.email.toLowerCase() !== email));
      return response(200, { ok: true });
    }
    if (action === 'set-status') {
      await store.set('site-status', body.online ? 'true' : 'false');
      return response(200, { online: Boolean(body.online) });
    }
    if (action === 'set-offline-message') {
      const message = String(body.message || '').trim().slice(0, 180);
      await store.set('offline-message', message);
      return response(200, { message });
    }
    return response(400, { error: 'Nieznana operacja' });
  } catch (error) {
    return response(500, { error: 'Błąd serwera' });
  }
}

const defaultAnnouncements = [];
const demoAnnouncementTitles = new Set([
  'Wieczorny przejazd linią 201',
  'Aktualizacja rozkładu jazdy',
  'Poranny kurs tramwajem T2',
  'Nowe zasady serwera'
]);

function readStorage(key) {
  try { return window.localStorage.getItem(key); } catch (error) { return null; }
}

function writeStorage(key, value) {
  try { window.localStorage.setItem(key, value); } catch (error) { return false; }
  return true;
}

function readJsonStorage(key, fallback = null) {
  const value = readStorage(key);
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (error) {
    writeStorage(key, '');
    return fallback;
  }
}

function getLocalAdminSession() {
  const stored = readJsonStorage('mpkAdminSession');
  return currentAdmin || stored || null;
}

function localApiRequest(action, payload = {}) {
  const session = getLocalAdminSession();
  if (action === 'status') {
    return { online: readStorage('mpkSiteOnline') !== 'false', message: readStorage('mpkOfflineMessage') || '' };
  }
  if (action === 'public-message') {
    const message = readJsonStorage('mpkPublicMessage') || readJsonStorage('mpkMessages', [])[0] || null;
    return { message };
  }
  if (action === 'admins') {
    return { admins: (readJsonStorage('mpkAdmins', admins) || []).map(({ password, ...admin }) => admin) };
  }
  if (action === 'messages') {
    return { messages: readJsonStorage('mpkMessages', []) };
  }
  if (action === 'create-message') {
    if (!session || !['Moderator', 'Administrator', 'Właściciel'].includes(session.role)) {
      throw new Error('Tylko administracja może wysyłać wiadomości');
    }
    const title = String(payload.title || '').trim().slice(0, 70);
    const content = String(payload.content || '').trim().slice(0, 300);
    if (!title || !content) throw new Error('Tytuł i treść wiadomości są wymagane');
    const displayMode = payload.displayMode === 'modal' ? 'modal' : 'bar';
    const message = { title, content, displayMode, author: session.username, date: new Date().toLocaleString('pl-PL') };
    const nextMessages = [message, ...(readJsonStorage('mpkMessages', []) || [])].slice(0, 50);
    writeStorage('mpkMessages', JSON.stringify(nextMessages));
    writeStorage('mpkPublicMessage', JSON.stringify(message));
    return { message };
  }
  if (action === 'set-offline-message') {
    const message = String(payload.message || '').trim().slice(0, 180);
    writeStorage('mpkOfflineMessage', message);
    return { message };
  }
  if (action === 'set-status') {
    const online = Boolean(payload.online);
    writeStorage('mpkSiteOnline', String(online));
    return { online };
  }
  throw new Error('Nieznana operacja');
}

const saved = readJsonStorage('mpkAnnouncements');
let announcements = (saved || defaultAnnouncements).filter(item => !demoAnnouncementTitles.has(item.title));
writeStorage('mpkAnnouncements', JSON.stringify(announcements));
const defaultAdmins = [
  { username: 'MotorniczyKuba', email: 'admin@mpk.test', password: 'admin123', role: 'Właściciel', activity: 'Teraz', initials: 'MK', color: 'coral' },
  { username: 'Olek_Tramwaj', email: 'moderator@mpk.test', password: 'mod1234', role: 'Moderator', activity: 'Dzisiaj, 09:18', initials: 'OT', color: 'blue' },
  { username: 'Zarzad_MPK', email: 'zarzad@mpk.test', password: 'zarzad123', role: 'Moderator', activity: 'Wczoraj, 21:42', initials: 'ZM', color: 'green' }
];
const savedAdmins = readJsonStorage('mpkAdmins');
let admins = (savedAdmins || defaultAdmins).map(admin => admin.email?.toLowerCase() === 'filip@gmail.com' ? { ...admin, role: 'Właściciel' } : admin);
const labels = { overview: 'Pulpit', sessions: 'Sesje Roblox', mpk: 'MPK Poznań', administration: 'Administracja' };
const typeLabels = { session: 'SESJA ROBLOX', notice: 'KOMUNIKAT' };
const savedTheme = readStorage('mpkTheme') || 'ocean';
const savedAdminSession = readJsonStorage('mpkAdminSession');
let currentAdmin = savedAdminSession;
let siteOnline = readStorage('mpkSiteOnline') !== 'false';
let adminOfflineAccess = Boolean(currentAdmin);
let apiToken = readStorage('mpkApiToken') || '';
let offlineMessage = readStorage('mpkOfflineMessage') || '';
let adminMessages = readJsonStorage('mpkMessages', []);
let mpkAnnouncements = readJsonStorage('mpkAnnouncementsShared', []);
let ztmAnnouncements = readJsonStorage('ztmAnnouncementsShared', []);
let mpkAnnouncementsKey = '';
let publicMessageKey = '';
let savedPublicMessage = readJsonStorage('mpkPublicMessage');

async function apiRequest(action, payload = {}) {
  if (String(apiToken).startsWith('local-')) {
    return localApiRequest(action, payload);
  }
  const endpoint = action === 'status' ? `/api?statusCheck=${Date.now()}` : '/api';
  const response = await fetch(endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}) },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Błąd połączenia z serwerem');
  return result;
}

async function syncSharedState() {
  try {
    const publicResult = await apiRequest('public-message');
    if (publicResult.message) {
      savedPublicMessage = publicResult.message;
      writeStorage('mpkPublicMessage', JSON.stringify(savedPublicMessage));
      showPublicMessage(publicResult.message);
    } else if (savedPublicMessage || adminMessages[0]) showPublicMessage(savedPublicMessage || adminMessages[0]);
  } catch (error) {
    if (savedPublicMessage || adminMessages[0]) showPublicMessage(savedPublicMessage || adminMessages[0]);
  }
  try {
    const result = await apiRequest('mpk-announcements');
    mpkAnnouncements = result.announcements || [];
    writeStorage('mpkAnnouncementsShared', JSON.stringify(mpkAnnouncements));
    renderMpkAnnouncements();
  } catch (error) {
    mpkAnnouncements = [];
    renderMpkAnnouncements();
  }
  try {
    const result = await apiRequest('ztm-announcements');
    ztmAnnouncements = result.announcements || [];
    writeStorage('ztmAnnouncementsShared', JSON.stringify(ztmAnnouncements));
    renderZtmAnnouncements();
  } catch (error) {
    ztmAnnouncements = [];
    renderZtmAnnouncements();
  }
  try {
    const status = await apiRequest('status');
    const savedOfflineStatus = readStorage('mpkSiteOnline') === 'false';
    siteOnline = savedOfflineStatus && status.online ? false : status.online;
    if (!siteOnline && currentAdmin) adminOfflineAccess = true;
    offlineMessage = status.message || readStorage('mpkOfflineMessage') || '';
    writeStorage('mpkSiteOnline', String(siteOnline));
    updateSiteStatus();
  } catch (error) {
    updateSiteStatus();
  }
  if (!apiToken) return;
  const [adminsResult, messagesResult] = await Promise.allSettled([apiRequest('admins'), apiRequest('messages')]);
  if (adminsResult.status === 'fulfilled') {
    admins = adminsResult.value.admins;
    renderAdmins();
  }
  if (messagesResult.status === 'fulfilled') {
    adminMessages = messagesResult.value.messages;
    renderAdminMessages();
  }
}

function renderMpkAnnouncements() {
  const list = document.querySelector('#mpk-announcement-list');
  if (!list) return;
  list.innerHTML = mpkAnnouncements.length ? mpkAnnouncements.slice(0, 4).map(item => `<article class="mpk-announcement"><p class="eyebrow">OFICJALNY KOMUNIKAT MPK POZNAŃ</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.date)} ${item.link ? `· <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Źródło MPK</a>` : ''}</small></article>`).join('') : '<p class="empty-state">Brak aktualnych ogłoszeń MPK Poznań.</p>';
}

function renderZtmAnnouncements() {
  const list = document.querySelector('#ztm-announcement-list');
  if (!list) return;
  list.innerHTML = ztmAnnouncements.length ? ztmAnnouncements.slice(0, 4).map(item => `<article class="mpk-announcement ztm-announcement"><p class="eyebrow">OFICJALNY KOMUNIKAT ZTM</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.date)} ${item.link ? `· <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Źródło ZTM</a>` : ''}</small></article>`).join('') : '<p class="empty-state">Brak aktualnych ogłoszeń ZTM.</p>';
}

function showPublicMessage(message) {
  const key = `${message.date}-${message.title}-${message.content}`;
  if (key === publicMessageKey) return;
  publicMessageKey = key;
  const messageBar = document.querySelector('#public-message-bar');
  const messageModal = document.querySelector('#public-message-modal');
  if (messageBar) messageBar.hidden = message.displayMode === 'modal';
  if (messageModal) messageModal.hidden = message.displayMode !== 'modal';
  if (message.displayMode === 'modal') {
    document.querySelector('#public-message-title').textContent = message.title;
    document.querySelector('#public-message-content').textContent = message.content;
    document.querySelector('#public-message-meta').textContent = `${message.date} · ${message.author}`;
    if (messageModal) messageModal.setAttribute('aria-hidden', 'false');
    return;
  }
  if (messageBar) {
    document.querySelector('#public-message-bar-title').textContent = message.title;
    document.querySelector('#public-message-bar-content').textContent = message.content;
    document.querySelector('#public-message-bar-meta').textContent = `${message.date} · ${message.author}`;
    messageBar.hidden = false;
  }
}

function renderAdminMessages() {
  const list = document.querySelector('#message-list');
  if (!list) return;
  list.innerHTML = adminMessages.length ? adminMessages.map(message => `<article class="message-item"><strong>${escapeHtml(message.title)}</strong><p>${escapeHtml(message.content)}</p><small>${escapeHtml(message.date)} · ${escapeHtml(message.author)}</small></article>`).join('') : '<p class="empty-state">Nie wysłano jeszcze żadnych wiadomości.</p>';
}

function updateOfflineMessage() {
  const message = document.querySelector('#offline-message');
  const input = document.querySelector('#offline-message-input');
  if (message) {
    message.textContent = offlineMessage;
    message.hidden = !offlineMessage;
  }
  if (input && document.activeElement !== input) input.value = offlineMessage;
}

function cardTemplate(item, index) {
  const label = item.type === 'session' ? 'Usuń sesję' : 'Usuń ogłoszenie';
  const deleteButton = `<button class="delete-announcement" data-announcement-index="${index}" aria-label="${label}: ${escapeHtml(item.title)}">${label}</button>`;
  const details = item.spots ? `◉ <strong>${escapeHtml(item.spots)}</strong>` : '';
  return `<article class="announcement-card" data-type="${item.type}"><span class="tag ${item.type}">${typeLabels[item.type]}</span>${deleteButton}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="announcement-bottom"><span>${escapeHtml(item.date)}</span><span>${details} Od: <strong>${escapeHtml(item.author || 'Administrator')}</strong></span></div></article>`;
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function renderAnnouncements() {
  const sessionCount = announcements.filter(item => item.type === 'session').length;
  const noticeCount = announcements.filter(item => item.type === 'notice').length;
  document.querySelector('.nav-item[data-view="sessions"] .nav-badge').textContent = sessionCount;
  document.querySelector('.filter-tab[data-filter="all"] b').textContent = announcements.length;
  document.querySelector('.filter-tab[data-filter="session"] b').textContent = sessionCount;
  document.querySelector('.filter-tab[data-filter="notice"] b').textContent = noticeCount;
  const cards = announcements.map(cardTemplate).join('');
  document.querySelector('#announcement-list').innerHTML = cards || '<p class="empty-state">Nie ma jeszcze żadnych ogłoszeń.</p>';
  document.querySelector('#all-announcements').innerHTML = cards || '<p class="empty-state">Nie ma jeszcze żadnych ogłoszeń.</p>';
  document.querySelector('#next-session-card').hidden = !announcements.some(item => item.type === 'session');
  document.querySelectorAll('.delete-announcement').forEach(button => button.addEventListener('click', () => removeAnnouncement(Number(button.dataset.announcementIndex))));
  applyFilters();
}

function removeAnnouncement(index) {
  const removed = announcements[index];
  if (!removed) return;
  const label = removed.type === 'session' ? 'sesję' : 'ogłoszenie';
  if (!window.confirm(`Usunąć ${label} „${removed.title}”?`)) return;
  announcements.splice(index, 1);
  writeStorage('mpkAnnouncements', JSON.stringify(announcements));
  renderAnnouncements();
  showToast(`${label[0].toUpperCase()}${label.slice(1)} zostało usunięte`);
}

function renderAdmins() {
  document.querySelector('#admin-count').textContent = admins.length;
  document.querySelector('.admin-badge').textContent = admins.length;
  document.querySelector('#admin-list').innerHTML = admins.map((admin, index) => `<div class="admin-row"><div class="admin-user"><div class="avatar ${admin.color}">${escapeHtml(admin.initials)}</div><strong>${escapeHtml(admin.username)}</strong></div><span class="role-pill ${admin.role === 'Administrator' || admin.role === 'Właściciel' ? 'administrator' : ''}">${escapeHtml(admin.role)}</span><span class="activity-time">${escapeHtml(admin.activity)}</span><span class="online-status"><i></i> Aktywny</span>${currentAdmin?.role === 'Właściciel' ? `<button class="remove-admin" data-admin-index="${index}" aria-label="Usuń użytkownika ${escapeHtml(admin.username)}">×</button>` : ''}</div>`).join('');
  document.querySelectorAll('.remove-admin').forEach(button => button.addEventListener('click', async () => {
    const removed = admins[Number(button.dataset.adminIndex)];
    if (!removed) return;
    if (currentAdmin && removed.username.toLowerCase() === currentAdmin.username.toLowerCase()) {
      showToast('Nie możesz usunąć własnego konta');
      return;
    }
    if (!window.confirm(`Usunąć użytkownika ${removed.username} z administracji?`)) return;
    try {
      if (apiToken) await apiRequest('delete-admin', { email: removed.email });
      admins = admins.filter(admin => admin.email !== removed.email);
      writeStorage('mpkAdmins', JSON.stringify(admins));
      renderAdmins();
      showToast(`Usunięto ${removed.username} z administracji`);
    } catch (error) {
      showToast(error.message || 'Nie udało się usunąć użytkownika');
    }
  }));
}

function applyFilters() {
  const activeTab = document.querySelector('.filter-tab.active');
  const searchInput = document.querySelector('#search-input');
  const active = activeTab ? activeTab.dataset.filter : 'all';
  const search = searchInput ? searchInput.value.toLowerCase() : '';
  document.querySelectorAll('#all-announcements .announcement-card').forEach(card => {
    const matchesType = active === 'all' || card.dataset.type === active;
    const matchesSearch = card.textContent.toLowerCase().includes(search);
    card.style.display = matchesType && matchesSearch ? '' : 'none';
  });
}

function updateAdminLoginButton() {
  const trigger = document.querySelector('#admin-login-trigger');
  if (!trigger) return;
  trigger.textContent = currentAdmin ? `Wyloguj (${currentAdmin.username})` : 'Zaloguj admin';
}

function updateAnnouncementControls() {
  document.querySelectorAll('[data-open-composer]').forEach(button => {
    button.hidden = !currentAdmin;
  });
  document.querySelectorAll('[data-admin-only]').forEach(element => {
    element.hidden = !currentAdmin;
  });
}

function updateSiteStatus() {
  const offlineScreen = document.querySelector('#offline-screen');
  const appShell = document.querySelector('.app-shell');
  const toggle = document.querySelector('#site-status-toggle');
  const label = document.querySelector('#site-status-label');
  const offlinePanel = document.querySelector('#offline-admin-panel');
  const offlineAdminName = document.querySelector('#offline-admin-name');
  document.body.classList.toggle('site-offline-admin', !siteOnline && adminOfflineAccess);
  document.body.classList.toggle('site-offline-public', !siteOnline && !adminOfflineAccess);
  offlineScreen.hidden = siteOnline;
  appShell.hidden = !siteOnline;
  if (offlinePanel) offlinePanel.hidden = !(adminOfflineAccess && currentAdmin);
  if (offlineAdminName && currentAdmin) offlineAdminName.textContent = currentAdmin.username;
  updateOfflineMessage();
  if (!siteOnline && !adminOfflineAccess && window.scrollTo) window.scrollTo(0, 0);
  if (toggle) toggle.checked = siteOnline;
  if (label) label.textContent = siteOnline ? 'Strona online' : 'Strona offline';
}

function updateAdminProfile() {
  const name = currentAdmin ? currentAdmin.username : 'Gość';
  const role = currentAdmin ? currentAdmin.role : 'Brak logowania';
  const initials = currentAdmin ? currentAdmin.username.slice(0, 2).toUpperCase() : '??';
  document.querySelector('#profile-name').textContent = name;
  document.querySelector('#profile-role').textContent = role;
  document.querySelector('#profile-avatar').textContent = initials;
  document.querySelector('#welcome-name').textContent = currentAdmin ? currentAdmin.username : 'Gość';
}

function toggleLoginModal(open) {
  const modal = document.querySelector('#login-modal');
  if (!modal) return;
  modal.classList.toggle('open', open);
  modal.setAttribute('aria-hidden', String(!open));
  if (open) modal.querySelector('input[name="login-email"]').focus();
}

function openView(view) {
  if (view === 'administration' && !currentAdmin) {
    toggleLoginModal(true);
    return;
  }
  document.querySelectorAll('.view').forEach(section => section.classList.remove('active-view'));
  document.querySelector(`#${view}-view`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-label').textContent = labels[view];
  if (window.scrollTo) window.scrollTo(0, 0);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  writeStorage('mpkTheme', theme);
  document.querySelectorAll('[data-theme]').forEach(button => button.classList.toggle('selected', button.dataset.theme === theme));
}

function toggleComposer(open) {
  const modal = document.querySelector('#composer-modal');
  modal.classList.toggle('open', open);
  modal.setAttribute('aria-hidden', String(!open));
  if (open) modal.querySelector('input[name="title"]').focus();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => openView(button.dataset.viewTarget)));
document.addEventListener('keydown', event => {
  const reloadShortcut = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
  if (!siteOnline && reloadShortcut) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast('Odświeżanie jest wyłączone podczas przerwy technicznej');
  }
}, true);
window.addEventListener('beforeunload', event => {
  if (!siteOnline) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.querySelectorAll('[data-open-composer]').forEach(button => button.addEventListener('click', () => {
  if (currentAdmin) toggleComposer(true);
}));
document.querySelectorAll('[data-close-composer]').forEach(button => button.addEventListener('click', () => toggleComposer(false)));
document.querySelector('#composer-modal').addEventListener('click', event => { if (event.target.id === 'composer-modal') toggleComposer(false); });
document.querySelector('#admin-login-trigger').addEventListener('click', () => {
  if (currentAdmin) {
    if (window.confirm('Czy chcesz się wylogować z panelu administracyjnego?')) {
      currentAdmin = null;
      adminOfflineAccess = false;
      apiToken = '';
      writeStorage('mpkAdminSession', '');
      writeStorage('mpkApiToken', '');
      updateAdminLoginButton();
      updateAdminProfile();
      updateAnnouncementControls();
      updateSiteStatus();
      showToast('Wylogowano z panelu administracyjnego');
      openView('overview');
    }
    return;
  }
  toggleLoginModal(true);
});
document.querySelector('#offline-admin-login').addEventListener('click', () => toggleLoginModal(true));
document.querySelector('#offline-message-send').addEventListener('click', async () => {
  const input = document.querySelector('#offline-message-input');
  const message = input.value.trim();
  try {
    const result = await apiRequest('set-offline-message', { message });
    offlineMessage = result.message;
    writeStorage('mpkOfflineMessage', offlineMessage);
    updateOfflineMessage();
    showToast('Wiadomość została wysłana');
  } catch (error) {
    if (currentAdmin || readJsonStorage('mpkAdminSession')) {
      apiToken = '';
      writeStorage('mpkApiToken', '');
      offlineMessage = message;
      writeStorage('mpkOfflineMessage', offlineMessage);
      updateOfflineMessage();
      showToast('Wiadomość została wysłana');
      return;
    }
    showToast(error.message || 'Nie udało się wysłać wiadomości');
  }
});
document.querySelector('#offline-enable-site').addEventListener('click', async () => {
  siteOnline = true;
  adminOfflineAccess = false;
  writeStorage('mpkSiteOnline', 'true');
  updateSiteStatus();
  try { await apiRequest('set-status', { online: true }); } catch {}
  openView('administration');
  showToast('Strona jest teraz online');
});
document.querySelector('#site-status-toggle').addEventListener('change', event => {
  siteOnline = event.currentTarget.checked;
  writeStorage('mpkSiteOnline', String(siteOnline));
  updateSiteStatus();
  apiRequest('set-status', { online: siteOnline }).then(() => {
    showToast(siteOnline ? 'Strona jest teraz online dla wszystkich' : 'Strona została wyłączona dla wszystkich (błąd 501)');
  }).catch(() => {
    siteOnline = !siteOnline;
    event.currentTarget.checked = siteOnline;
    updateSiteStatus();
    showToast('Nie udało się zmienić statusu strony');
  });
});
document.querySelectorAll('[data-close-login]').forEach(button => button.addEventListener('click', () => toggleLoginModal(false)));
document.querySelector('#login-modal').addEventListener('click', event => { if (event.target.id === 'login-modal') toggleLoginModal(false); });
document.querySelectorAll('[data-open-admin-composer]').forEach(button => button.addEventListener('click', () => toggleAdminComposer(true)));
document.querySelectorAll('[data-close-admin-composer]').forEach(button => button.addEventListener('click', () => toggleAdminComposer(false)));
document.querySelector('#admin-composer-modal').addEventListener('click', event => { if (event.target.id === 'admin-composer-modal') toggleAdminComposer(false); });
document.querySelector('#theme-trigger').addEventListener('click', event => {
  const picker = event.currentTarget.closest('.theme-picker');
  const expanded = picker.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
});
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
  applyTheme(button.dataset.theme);
  document.querySelector('.theme-picker').classList.remove('open');
  document.querySelector('#theme-trigger').setAttribute('aria-expanded', 'false');
  showToast(`Motyw zmieniony na: ${button.textContent.trim()}`);
}));
document.addEventListener('click', event => {
  if (!event.target.closest('.theme-picker')) {
    document.querySelector('.theme-picker').classList.remove('open');
    document.querySelector('#theme-trigger').setAttribute('aria-expanded', 'false');
  }
});
document.querySelectorAll('[data-toggle-password], [data-toggle-login-password]').forEach(button => button.addEventListener('click', event => {
  const input = event.currentTarget.previousElementSibling;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  event.currentTarget.textContent = visible ? 'Pokaż' : 'Ukryj';
  event.currentTarget.setAttribute('aria-label', visible ? 'Pokaż hasło' : 'Ukryj hasło');
}));
document.querySelectorAll('.filter-tab').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active')); button.classList.add('active'); applyFilters(); }));
document.querySelector('#search-input').addEventListener('input', applyFilters);
document.querySelector('#refresh-data').addEventListener('click', event => { document.querySelector('#last-update').textContent = new Date().toLocaleTimeString('pl-PL'); if (event.currentTarget.animate) event.currentTarget.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 450 }); else event.currentTarget.style.transform = 'rotate(360deg)'; showToast('Dane sieci zostały odświeżone'); });
document.querySelector('#refresh-mpk').addEventListener('click', () => showToast('Dane MPK zostały odświeżone'));
document.querySelector('#announcement-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!currentAdmin) {
    toggleComposer(false);
    toggleLoginModal(true);
    return;
  }
  const form = new FormData(event.currentTarget);
  const date = new Date(form.get('date'));
  announcements.unshift({ type: form.get('type'), title: form.get('title'), description: form.get('description'), date: date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) + ', ' + date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), spots: form.get('type') === 'session' ? `0 / ${form.get('spots')} miejsc` : '', author: currentAdmin.username });
  writeStorage('mpkAnnouncements', JSON.stringify(announcements));
  renderAnnouncements(); toggleComposer(false); event.currentTarget.reset(); showToast('Ogłoszenie opublikowane'); openView('sessions');
});

function toggleAdminComposer(open) {
  const modal = document.querySelector('#admin-composer-modal');
  modal.classList.toggle('open', open);
  modal.setAttribute('aria-hidden', String(!open));
  if (open) modal.querySelector('input[name="username"]').focus();
}

document.querySelector('#admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = form.get('username').trim();
  const email = String(form.get('email')).trim().toLowerCase();
  if (admins.some(admin => admin.username.toLowerCase() === username.toLowerCase() || (admin.email && admin.email.toLowerCase() === email))) {
    showToast('Ten użytkownik lub e-mail jest już w administracji');
    return;
  }
  let savedRemotely = false;
  try {
    await apiRequest('create-admin', { username, email, password: String(form.get('password')), role: form.get('role') });
    const result = await apiRequest('admins');
    admins = result.admins;
    savedRemotely = true;
  } catch (error) {
    if (apiToken) {
      showToast(error.message);
      return;
    }
  }
  if (!savedRemotely) admins.push({ username, email, password: String(form.get('password')), role: form.get('role'), activity: 'Przed chwilą', initials: username.slice(0, 2).toUpperCase(), color: 'blue' });
  writeStorage('mpkAdmins', JSON.stringify(admins));
  renderAdmins();
  toggleAdminComposer(false);
  event.currentTarget.reset();
  showToast(`Konto ${username} zostało utworzone`);
});

document.querySelector('#message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const rememberedAdmin = currentAdmin || readJsonStorage('mpkAdminSession');
  if (rememberedAdmin && !currentAdmin) {
    currentAdmin = rememberedAdmin;
    updateAdminLoginButton();
    updateAdminProfile();
  }
  const canSendMessage = rememberedAdmin && ['Moderator', 'Administrator', 'Właściciel'].includes(rememberedAdmin.role);
  if (!canSendMessage) {
    showToast('Tylko administracja może wysyłać wiadomości');
    return;
  }
  try {
    const result = await apiRequest('create-message', { title: form.get('title'), content: form.get('content'), displayMode: form.get('displayMode') });
    adminMessages = [result.message, ...adminMessages];
    writeStorage('mpkMessages', JSON.stringify(adminMessages.slice(0, 50)));
    savedPublicMessage = result.message;
    writeStorage('mpkPublicMessage', JSON.stringify(savedPublicMessage));
    showPublicMessage(result.message);
    renderAdminMessages();
    event.currentTarget.reset();
    showToast('Wiadomość została wysłana');
  } catch (error) {
    showToast(error.message || 'Nie udało się wysłać wiadomości');
  }
});

document.querySelector('#close-public-message').addEventListener('click', () => {
  const modal = document.querySelector('#public-message-modal');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
});

document.querySelector('#admin-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('login-email')).trim().toLowerCase();
  const password = String(form.get('login-password'));
  let loggedAdmin;
  try {
    const result = await apiRequest('login', { email, password });
    apiToken = result.token;
    writeStorage('mpkApiToken', apiToken);
    loggedAdmin = result.admin;
    const sharedAdmins = await apiRequest('admins');
    admins = sharedAdmins.admins;
    renderAdmins();
  } catch (error) {
    apiToken = '';
    writeStorage('mpkApiToken', '');
    const admin = admins.find(item => item.email && item.email.toLowerCase() === email && item.password === password);
    if (!admin) {
      showToast(error.message || 'Błędny e-mail lub hasło');
      return;
    }
    loggedAdmin = { username: admin.username, role: admin.role };
  }
  currentAdmin = loggedAdmin;
  adminOfflineAccess = true;
  apiToken = apiToken || `local-${Date.now()}`;
  writeStorage('mpkApiToken', apiToken);
  writeStorage('mpkAdminSession', JSON.stringify(currentAdmin));
  updateAdminLoginButton();
  updateAdminProfile();
  updateAnnouncementControls();
  updateSiteStatus();
  toggleLoginModal(false);
  event.currentTarget.reset();
  openView('administration');
  showToast(`Witaj, ${loggedAdmin.username}`);
});

function showToast(message) { const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
applyTheme(savedTheme);
updateAdminLoginButton();
updateAdminProfile();
updateAnnouncementControls();
updateSiteStatus();
renderAnnouncements();
renderAdmins();
syncSharedState();
window.setInterval(syncSharedState, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncSharedState();
});
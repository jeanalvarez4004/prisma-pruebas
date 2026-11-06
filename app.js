'use strict';

const appShell = document.getElementById('app-shell');
const authScreen = document.getElementById('auth-screen');
const pageContent = document.getElementById('page-content');
const modalRoot = document.getElementById('modal-root');
const toastElement = document.getElementById('toast');
const authFeedback = document.getElementById('auth-feedback');
const storyCamera = document.getElementById('story-camera');
const profileCamera = document.getElementById('profile-camera');

const state = {
  user: null,
  feed: { posts: [], stories: [], activities: [], unreadNotifications: 0 },
  chats: [],
  profile: null,
  profilePosts: [],
  profilePostsHasMore: false,
  profilePostsOffset: 0,
  notifications: [],
  filter: 'Todos',
  authMode: 'login',
  pendingPostImage: null,
  pendingProfileImage: undefined,
  renderToken: 0,
  sessionVersion: 0,
  backgroundRefreshing: false,
  pendingActions: new Set(),
  lastFocusedElement: null,
  toastTimer: null,
};

const POST_CATEGORIES = ['Todos', 'General', 'Académico', 'Comunidad'];
const ACTIVITY_CATEGORIES = ['Deporte', 'Juego', 'Estudio', 'Transporte', 'Ayuda', 'Otro'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function initials(name) {
  const words = String(name || 'P').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'P';
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function avatarHtml(user, className = 'avatar', id = '') {
  const safeClass = escapeHtml(className);
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : '';
  if (user && user.avatar) {
    return `<span class="${safeClass}"${idAttribute}><img src="${escapeHtml(user.avatar)}" alt="" /></span>`;
  }
  return `<span class="${safeClass}"${idAttribute}>${escapeHtml(initials(user && user.name))}</span>`;
}

function firstName() {
  return String(state.user?.name || 'estudiante').trim().split(/\s+/)[0];
}

function isCurrentSession(sessionVersion) {
  return Boolean(state.user && sessionVersion === state.sessionVersion);
}

function beginAction(key) {
  if (state.pendingActions.has(key)) return false;
  state.pendingActions.add(key);
  return true;
}

function endAction(key) {
  state.pendingActions.delete(key);
}

function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ahora';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

function formatDate(value) {
  if (!value) return '';
  let date;
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function activityIcon(category) {
  return {
    Deporte: '⚽',
    Juego: '🎮',
    Estudio: '📚',
    Transporte: '🚕',
    Ayuda: '🤝',
    Otro: '✨',
  }[category] || '✨';
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('is-error', isError);
  toastElement.hidden = false;
  state.toastTimer = setTimeout(() => {
    toastElement.hidden = true;
  }, 3600);
}

// ============================================================================
// WEBSOCKETS EN TIEMPO REAL (SOCKET.IO)
// ============================================================================
let socket = null;
function initWebSocket() {
  if (typeof io !== 'function') {
    console.warn('[WebSockets] Socket.io client no disponible.');
    return;
  }
  if (socket && socket.connected) return;

  socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('%c[PRISM WEBSOCKETS] 🟢 Conectado al campus en tiempo real (ID: ' + socket.id + ')', 'color: #228b62; font-weight: bold;');
    if (state.user && state.user.name) {
      socket.emit('user:identify', state.user);
    }
    socket.emit('chat:get_history');
  });

  socket.on('presence:update', (data) => {
    if (!data) return;
    const onlineEl = document.getElementById('chat-online-count');
    if (onlineEl) {
      onlineEl.textContent = `${data.onlineCount} alumno${data.onlineCount > 1 ? 's' : ''} conectado${data.onlineCount > 1 ? 's' : ''}`;
    }
  });

  socket.on('chat:message', (msg) => {
    const isMe = state.user && (state.user.name === msg.u);
    const item = {
      u: msg.u,
      t: msg.t,
      h: msg.h || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      img: msg.img || '',
      me: isMe,
    };
    state.chats.push(item);

    if (currentRoute() === 'chat') {
      const stream = document.getElementById('chat-stream');
      if (stream) {
        stream.insertAdjacentHTML('beforeend', chatMessageHtml(item));
        stream.scrollTop = stream.scrollHeight;
      }
    } else {
      if (!isMe) {
        showToast(`💬 ${item.u}: ${item.t.slice(0, 32)}...`);
      }
    }
  });

  socket.on('chat:history', (messages) => {
    if (Array.isArray(messages) && messages.length > 0) {
      state.chats = messages.map((m) => ({
        u: m.u,
        t: m.t,
        h: m.h,
        img: m.img,
        me: state.user && state.user.name === m.u,
      }));
      if (currentRoute() === 'chat') {
        const stream = document.getElementById('chat-stream');
        if (stream) {
          stream.innerHTML = state.chats.map(chatMessageHtml).join('');
          stream.scrollTop = stream.scrollHeight;
        }
      }
    }
  });

  socket.on('feed:new_post', (data) => {
    if (!data || !data.post) return;
    const author = data.authorName || 'Un estudiante';
    if (state.user && state.user.name !== author) {
      showToast(`📢 [En vivo] ${author} publicó en el campus`);
      refreshFeed();
      if (currentRoute() === 'inicio') renderPage();
    }
  });

  socket.on('feed:post_liked', (data) => {
    if (!data) return;
    const p = state.feed.posts.find((item) => String(item.id) === String(data.postId));
    if (p) {
      p.likes = data.likes;
      if (currentRoute() === 'inicio') renderPage();
    }
  });

  socket.on('feed:post_deleted', (data) => {
    if (!data) return;
    state.feed.posts = state.feed.posts.filter((item) => String(item.id) !== String(data.postId));
    if (currentRoute() === 'inicio') renderPage();
  });
}

function setFormBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="loading-dot"></span> Esperando…';
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function setAuthFeedback(message = '', type = 'error') {
  if (!message) {
    authFeedback.hidden = true;
    authFeedback.textContent = '';
    authFeedback.className = 'form-feedback';
    return;
  }
  authFeedback.textContent = message;
  authFeedback.className = `form-feedback ${type === 'success' ? 'success' : ''}`;
  authFeedback.hidden = false;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const login = document.getElementById('login-form');
  const register = document.getElementById('register-form');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const isLogin = mode === 'login';

  login.hidden = !isLogin;
  register.hidden = isLogin;
  title.textContent = isLogin ? 'Qué gusto verte' : 'Únete al campus';
  subtitle.textContent = isLogin
    ? 'Inicia sesión para entrar a PRISM.'
    : 'Crea tu cuenta y empieza a conectar con USMP.';
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    const active = button.dataset.authTab === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  setAuthFeedback();
}

function showAuth(mode = 'login') {
  state.sessionVersion += 1;
  state.renderToken += 1;
  state.user = null;
  state.profile = null;
  state.profilePosts = [];
  state.profilePostsHasMore = false;
  state.profilePostsOffset = 0;
  state.pendingActions.clear();
  state.notifications = [];
  state.feed = { posts: [], stories: [], activities: [], unreadNotifications: 0 };
  authScreen.hidden = false;
  appShell.hidden = true;
  const notificationPanel = document.getElementById('notification-panel');
  const notificationList = document.getElementById('notification-list');
  if (notificationPanel) notificationPanel.hidden = true;
  if (notificationList) notificationList.innerHTML = '';
  setAuthMode(mode);
  pageContent.innerHTML = '';
  closeModal();
}

function fillAvatarElement(elementId, user, className) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.outerHTML = avatarHtml(user, className, elementId);
}

function syncUserUI() {
  if (!state.user) return;
  const name = state.user.name || 'Estudiante';
  const career = state.user.career || 'Sin especificar';
  document.getElementById('sidebar-name').textContent = name;
  document.getElementById('sidebar-career').textContent = career;
  document.getElementById('topbar-name').textContent = name;
  fillAvatarElement('sidebar-avatar', state.user, 'avatar avatar-small');
  fillAvatarElement('topbar-avatar', state.user, 'avatar avatar-top');

  const count = Number(state.feed.unreadNotifications || 0);
  const notificationCount = document.getElementById('notification-count');
  notificationCount.textContent = count > 99 ? '99+' : String(count);
  notificationCount.hidden = count === 0;
}

function syncActiveRoute(route) {
  document.querySelectorAll('[data-route]').forEach((element) => {
    element.classList.toggle('is-active', element.dataset.route === route);
  });
}

function currentRoute() {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return route || 'inicio';
}

function isFeatureRoute(route) {
  return Boolean(window.PrismFeatures && window.PrismFeatures.isFeatureRoute(route));
}

function isAvailableRoute(route) {
  return route === 'inicio' || route === 'perfil' || route === 'chat' || isFeatureRoute(route);
}

async function request(path, options = {}) {
  const { timeoutMs = 15000, signal: externalSignal, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  let body = fetchOptions.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch(path, {
      ...fetchOptions,
      body,
      headers,
      signal: externalSignal || controller.signal,
      credentials: 'same-origin',
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error('El servidor tardó demasiado en responder. Inténtalo de nuevo.');
    }
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión.');
  } finally {
    window.clearTimeout(timeoutId);
  }

  // Monitoreo e indicador en vivo de Upstash Redis
  const cacheStatus = response.headers.get('x-cache');
  if (cacheStatus) {
    const cacheProvider = response.headers.get('x-cache-provider') || 'Redis';
    const feedVer = response.headers.get('x-feed-version') || '1';
    const badge = document.getElementById('redis-badge-status');
    if (badge) {
      badge.textContent = cacheStatus;
      badge.style.color = cacheStatus === 'HIT' ? '#228b62' : '#d92f61';
    }
    if (cacheStatus === 'HIT') {
      console.log(`%c[PRISM REDIS] ⚡ X-Cache: HIT | ${cacheProvider} | v${feedVer}`, 'color: #228b62; font-weight: bold;');
    } else {
      console.log(`%c[PRISM REDIS] 🔄 X-Cache: MISS | ${cacheProvider} -> Guardado en Upstash`, 'color: #d92f61; font-weight: bold;');
    }
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('La API no está disponible. Revisa que Render esté ejecutando el servidor Node.');
  }
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      showAuth('login');
    }
    throw new Error(payload.error || 'Ocurrió un error inesperado.');
  }
  return payload;
}

async function refreshFeed(sessionVersion = state.sessionVersion) {
  const data = await request('/api/feed');
  if (sessionVersion !== state.sessionVersion || !state.user) return false;
  state.feed = {
    posts: Array.isArray(data.posts) ? data.posts : [],
    stories: Array.isArray(data.stories) ? data.stories : [],
    activities: Array.isArray(data.activities) ? data.activities : [],
    unreadNotifications: Number(data.unreadNotifications || 0),
  };
  syncUserUI();
  return true;
}

async function refreshProfile(sessionVersion = state.sessionVersion) {
  const data = await request('/api/profile');
  if (sessionVersion !== state.sessionVersion || !state.user) return false;
  state.profile = data;
  if (data.user) state.user = data.user;
  syncUserUI();
  return true;
}

async function refreshProfilePosts(sessionVersion = state.sessionVersion) {
  const data = await request('/api/profile/posts?limit=30');
  if (sessionVersion !== state.sessionVersion || !state.user) return false;
  state.profilePosts = Array.isArray(data.posts) ? data.posts : [];
  state.profilePostsHasMore = Boolean(data.hasMore);
  state.profilePostsOffset = Number(data.nextOffset || state.profilePosts.length);
  return true;
}

async function refreshCurrentRoute() {
  const sessionVersion = state.sessionVersion;
  const route = currentRoute();
  if (route === 'perfil') {
    await Promise.all([refreshProfile(sessionVersion), refreshProfilePosts(sessionVersion)]);
  } else if (route === 'chat') {
    if (socket && socket.connected) {
      socket.emit('chat:get_history');
    }
  } else if (isFeatureRoute(route)) {
    // Las secciones nuevas (buscar, asistente, contacto, admin) no se refrescan solas
    // para no borrar lo que la persona está escribiendo.
  } else {
    await refreshFeed(sessionVersion);
  }
}

async function refreshProfileIfVisible() {
  if (currentRoute() !== 'perfil' || !state.user) return;
  const sessionVersion = state.sessionVersion;
  await Promise.all([refreshProfile(sessionVersion), refreshProfilePosts(sessionVersion)]);
}

async function enterApp(user) {
  state.sessionVersion += 1;
  const sessionVersion = state.sessionVersion;
  state.user = user;
  authScreen.hidden = true;
  appShell.hidden = false;
  pageContent.innerHTML = '<div class="loading-card surface-card"><div class="loading-line medium"></div><div class="loading-line short"></div></div>';
  syncUserUI();
  try {
    await Promise.all([refreshFeed(sessionVersion), refreshProfile(sessionVersion), refreshProfilePosts(sessionVersion)]);
  } catch (error) {
    showToast(error.message, true);
  }

  // Inicializar WebSockets para chat y presencia en tiempo real
  // Reconecta para que el socket quede asociado a la sesión actual (avisos personales).
  if (socket) { socket.disconnect(); socket = null; }
  initWebSocket();
  if (window.PrismFeatures && socket) window.PrismFeatures.bindSocket(socket);

  // Consumir Temp Data / Mensajes Flash
  request('/api/temp-data').then((data) => {
    if (data?.flash?.message) showToast('✨ ' + data.flash.message);
  }).catch(() => {});

  await renderPage();
}

async function refreshInBackground() {
  if (!state.user || document.hidden || state.backgroundRefreshing || state.pendingActions.size) return;
  state.backgroundRefreshing = true;
  const sessionVersion = state.sessionVersion;
  try {
    await refreshCurrentRoute();
    if (sessionVersion === state.sessionVersion && state.user) await renderPage();
  } catch (error) {
    if (state.user) showToast(error.message, true);
  } finally {
    state.backgroundRefreshing = false;
  }
}

async function handleRouteChange() {
  if (!state.user) return;
  const route = currentRoute();
  if (!isAvailableRoute(route)) {
    showToast('Esta sección estará disponible en una próxima actualización.');
    window.history.replaceState(null, '', '#/inicio');
    await renderPage();
    return;
  }
  pageContent.innerHTML = '<div class="loading-card surface-card"><div class="loading-line medium"></div><div class="loading-line short"></div></div>';
  try {
    await refreshCurrentRoute();
  } catch (error) {
    if (!state.user) return;
    showToast(error.message, true);
  }
  await renderPage();
}

async function renderPage({ profileRefreshed = false } = {}) {
  if (!state.user) return;
  const token = ++state.renderToken;
  const requestedRoute = currentRoute();
  const route = isAvailableRoute(requestedRoute) ? requestedRoute : 'inicio';
  if (!isAvailableRoute(requestedRoute)) window.history.replaceState(null, '', '#/inicio');
  syncActiveRoute(route);
  if (window.PrismFeatures) window.PrismFeatures.onUser();

  if (route === 'perfil' && (profileRefreshed || !state.profile)) {
    pageContent.innerHTML = '<div class="loading-card surface-card"><div class="loading-line medium"></div><div class="loading-line short"></div></div>';
    try {
      await Promise.all([refreshProfile(), refreshProfilePosts()]);
    } catch (error) {
      if (token !== state.renderToken || !state.user) return;
      showToast(error.message, true);
    }
  }
  if (token !== state.renderToken || !state.user) return;
  if (route === 'perfil') {
    pageContent.innerHTML = layoutProfile();
  } else if (route === 'chat') {
    pageContent.innerHTML = layoutChat();
    const stream = document.getElementById('chat-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  } else if (isFeatureRoute(route)) {
    window.PrismFeatures.renderRoute(route);
  } else {
    pageContent.innerHTML = layoutHome();
    if (window.PrismFeatures) window.PrismFeatures.afterHome();
  }
}

function chatMessageHtml(msg) {
  const isMe = state.user && (state.user.name === msg.u);
  return `
    <div class="chat-msg ${isMe ? 'me' : ''}" style="display:flex; flex-direction:column; align-self:${isMe ? 'flex-end' : 'flex-start'}; max-width:75%;">
      ${!isMe ? `<span style="font-size:11px; font-weight:700; color:#8a777f; margin-bottom:2px; margin-left:4px;">${escapeHtml(msg.u)}</span>` : ''}
      <div style="background:${isMe ? '#d92f61' : '#ffffff'}; color:${isMe ? '#ffffff' : '#302329'}; border:${isMe ? 'none' : '1px solid #eadfe3'}; padding:10px 14px; border-radius:${isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}; box-shadow:0 1px 3px rgba(0,0,0,0.04); font-size:0.92rem; line-height:1.4; word-break:break-word;">
        ${escapeHtml(msg.t)}
      </div>
      <span style="font-size:10px; color:#8a777f; margin-top:2px; align-self:${isMe ? 'flex-end' : 'flex-start'}; margin-right:${isMe ? '4px' : '0'}; margin-left:${isMe ? '0' : '4px'};">${escapeHtml(msg.h || '')}</span>
    </div>
  `;
}

function layoutChat() {
  const messages = state.chats || [];
  return `
    <section class="surface-card chat-page" style="display:flex; flex-direction:column; height:calc(100vh - 140px); min-height:500px; padding:0; overflow:hidden; border-radius:18px;">
      <div style="padding:16px 20px; border-bottom:1px solid #eadfe3; display:flex; justify-content:space-between; align-items:center; background:#ffffff;">
        <div>
          <h2 style="font-size:1.15rem; font-weight:800; color:#302329; margin:0 0 2px 0;">💬 Chat Campus USMP</h2>
          <div style="font-size:0.8rem; color:#8a777f; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#228b62; display:inline-block;"></span>
            <span id="chat-online-count">Conectado en vivo</span> · Filial Sur Arequipa
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span style="font-size:11px; font-weight:700; color:#228b62; background:#eaf8f1; padding:4px 10px; border-radius:20px;">⚡ WebSockets Activo</span>
        </div>
      </div>

      <div id="chat-stream" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; background:#faf7f8;">
        ${messages.length ? messages.map(chatMessageHtml).join('') : '<div style="text-align:center; color:#8a777f; margin:auto; font-size:0.9rem;">El chat está listo. Sé el primero en escribir un mensaje al campus.</div>'}
      </div>

      <form id="chat-form" style="padding:14px 18px; border-top:1px solid #eadfe3; display:flex; gap:10px; background:#ffffff;">
        <input id="chat-input" type="text" placeholder="Escribe un mensaje al campus..." style="flex:1; border:1px solid #eadfe3; border-radius:12px; padding:10px 14px; font-size:0.92rem; outline:none;" autocomplete="off" required />
        <button type="submit" class="primary-button" style="padding:10px 22px;">Enviar</button>
      </form>
    </section>
  `;
}

function layoutHome() {
  const stories = state.feed.stories || [];
  const activities = state.feed.activities || [];
  const posts = (state.feed.posts || []).filter((post) => state.filter === 'Todos' || post.category === state.filter);
  const userName = escapeHtml(firstName());

  return `
    <section class="home-welcome">
      <div class="home-welcome-inner">
        <div class="home-welcome-content">
          <p class="eyebrow">USMP Filial Sur · Arequipa</p>
          <h1>Hola, ${userName} <span aria-hidden="true">👋</span></h1>
          <p>Comparte lo que estás haciendo o encuentra gente para lo que tienes en mente.</p>
          <div class="home-actions">
            <button class="primary-button" type="button" data-action="create-post">＋ Publicar</button>
            <button class="secondary-button" type="button" data-action="create-activity">Crear actividad</button>
            <button class="outline-button" type="button" data-action="story-camera">Subir historia</button>
          </div>
        </div>
        <div id="home-weather-widget" class="home-weather-slot"></div>
      </div>
    </section>

    <section class="surface-card stories-section" aria-labelledby="stories-title">
      <div class="section-heading">
        <div><h2 id="stories-title">Historias del campus</h2><p>Un vistazo a lo que está pasando.</p></div>
        <span class="status-label">24 h</span>
      </div>
      <div class="stories">
        <button class="story story-add" type="button" data-action="story-camera" aria-label="Subir una historia con la cámara">
          <span class="story-visual">＋</span><span class="story-name">Tu historia</span>
        </button>
        ${stories.map((story) => `
          <button class="story" type="button" data-action="view-story" data-id="${story.id}" aria-label="Ver historia de ${escapeHtml(story.author.name)}">
            <span class="story-visual"><img src="${escapeHtml(story.image)}" alt="Historia de ${escapeHtml(story.author.name)}" loading="lazy" decoding="async" /></span>
            <span class="story-name">${escapeHtml(story.author.id === state.user.id ? 'Tu historia' : firstNameOf(story.author.name))}</span>
          </button>`).join('')}
      </div>
    </section>

    <section id="reco-slot" class="surface-card f-reco-section" hidden></section>

    <div class="home-grid">
      <section class="surface-card composer" aria-label="Crear publicación">
        <div class="composer-top">
          ${avatarHtml(state.user, 'avatar composer-avatar')}
          <button type="button" data-action="create-post">¿Qué está pasando en tu campus?</button>
        </div>
        <div class="composer-options">
          <button class="outline-button" type="button" data-action="create-post">▣ Publicación</button>
          <button class="outline-button" type="button" data-action="post-camera">◉ Foto con cámara</button>
          <button class="outline-button" type="button" data-action="create-activity">⌁ Actividad</button>
        </div>
      </section>

      <section class="surface-card activity-section" aria-labelledby="activities-title">
        <div class="section-heading">
          <div><h2 id="activities-title">Actividades para ti</h2><p>Encuentra companyía o suma a los que quieren participar.</p></div>
          <button class="section-link" type="button" data-action="create-activity">Crear una →</button>
        </div>
        <div class="activity-list">
          ${activities.length ? activities.map(layoutActivity).join('') : `
            <div class="empty-state">
              <span class="empty-icon">⌁</span>
              <strong>Todavía no hay actividades</strong>
              <p>Sé la primera persona en organizar algo para la comunidad.</p>
              <button class="ghost-button" type="button" data-action="create-activity">Crear actividad</button>
            </div>`}
        </div>
      </section>

      <section class="posts-section" aria-labelledby="posts-title">
        <div class="posts-toolbar">
          <h2 id="posts-title">Publicaciones</h2>
          <select id="post-filter" class="filter-select" aria-label="Filtrar publicaciones">
            ${POST_CATEGORIES.map((category) => `<option value="${category}" ${state.filter === category ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
        </div>
        <div class="post-list">
          ${posts.length ? posts.map(layoutPost).join('') : `
            <div class="empty-state">
              <span class="empty-icon">✎</span>
              <strong>No hay publicaciones todavía</strong>
              <p>Cuando alguien comparta algo, aparecerá aquí.</p>
              <button class="ghost-button" type="button" data-action="create-post">Crear la primera</button>
            </div>`}
        </div>
      </section>
    </div>`;
}

function firstNameOf(name) {
  return String(name || 'Estudiante').trim().split(/\s+/)[0] || 'Estudiante';
}

function layoutActivity(activity) {
  const progress = Math.min(100, Math.round((activity.joined / Math.max(activity.total, 1)) * 100));
  const full = activity.remaining <= 0;
  const buttonText = activity.isOwner
    ? 'Tu actividad'
    : activity.joinedByMe
      ? '✓ Conectado'
      : full
        ? 'Completa'
        : 'Conectar';
  const buttonClass = activity.isOwner || (full && !activity.joinedByMe) ? 'is-full' : activity.joinedByMe ? 'is-connected' : '';
  const buttonDisabled = activity.isOwner || (full && !activity.joinedByMe);
  return `
    <article class="activity-card">
      <div class="activity-card-top">
        <span class="activity-icon">${activityIcon(activity.category)}</span>
        <div>
          <span class="category-tag">${escapeHtml(activity.category)}</span>
          <h3>${escapeHtml(activity.title)}</h3>
          ${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}
        </div>
      </div>
      <div class="activity-meta">
        <span>⌖ ${escapeHtml(activity.location || 'Por definir')}</span>
        ${activity.eventDate ? `<span>▣ ${escapeHtml(formatDate(activity.eventDate))}</span>` : ''}
        <span>◎ ${escapeHtml(activity.owner.name)}</span>
      </div>
      <div class="activity-bottom">
        <div class="activity-progress-wrap">
          <div class="activity-progress" role="progressbar" aria-valuenow="${activity.joined}" aria-valuemin="0" aria-valuemax="${activity.total}"><span style="width:${progress}%"></span></div>
          <div class="activity-count">${activity.joined} de ${activity.total} personas · ${activity.remaining > 0 ? `faltan ${activity.remaining}` : 'completa'}</div>
        </div>
        <button class="outline-button activity-join ${buttonClass}" type="button" data-action="join-activity" data-id="${activity.id}" ${buttonDisabled ? 'disabled' : ''}>${buttonText}</button>
      </div>
    </article>`;
}

function layoutPost(post) {
  const isMine = state.user && (String(state.user.id) === String(post.author?.id) || state.user.name === post.author?.name);
  return `
    <article class="surface-card post-card">
      <div class="post-meta">
        ${avatarHtml(post.author, 'avatar composer-avatar')}
        <div class="post-meta-copy"><strong>${escapeHtml(post.author.name)}</strong><small>${escapeHtml(post.author.career || 'Estudiante USMP')} · ${escapeHtml(timeAgo(post.createdAt))}</small></div>
        <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
          <span class="category-tag">${escapeHtml(post.category)}</span>
          ${isMine ? `<button class="icon-button" type="button" data-action="delete-post" data-id="${post.id}" title="Eliminar publicación" style="color:#d92f61; font-size:13px; padding:2px 6px; border:none; background:transparent; cursor:pointer;">🗑️</button>` : ''}
        </div>
      </div>
      <p class="post-body">${escapeHtml(post.body)}</p>
      ${post.image ? `<img class="post-image" src="${escapeHtml(post.image)}" alt="Publicación de ${escapeHtml(post.author.name)}" loading="lazy" decoding="async" />` : ''}
      <div class="post-actions">
        <button class="post-action ${post.liked ? 'is-liked' : ''}" type="button" data-action="like-post" data-id="${post.id}">♡ Me gusta · ${post.likes}</button>
      </div>
    </article>`;
}

function layoutProfile() {
  const profile = state.profile || { user: state.user, stats: { posts: 0, stories: 0, activities: 0 } };
  const user = profile.user || state.user;
  const posts = state.profilePosts || [];
  return `
    <section class="surface-card profile-card">
      <div class="profile-cover"></div>
      <div class="profile-intro">
        <div class="profile-avatar-wrap">
          ${avatarHtml(user, 'avatar profile-avatar')}
          <button class="camera-button" type="button" data-action="profile-camera" aria-label="Tomar una foto para el perfil">📷</button>
        </div>
        <div class="profile-intro-copy">
          <h1>${escapeHtml(user.name)}</h1>
          <p>${escapeHtml(user.email)}</p>
        </div>
        <button class="secondary-button profile-edit" type="button" data-action="edit-profile">Editar perfil</button>
      </div>
      <div class="profile-info">
        <div class="profile-info-row"><span class="info-icon">⌖</span><span>${escapeHtml(user.career || 'Carrera por definir')} · USMP Filial Sur</span></div>
        <div class="profile-info-row"><span class="info-icon">◷</span><span>Miembro desde ${escapeHtml(formatDate(user.createdAt))}</span></div>
        <div class="profile-info-row"><span class="info-icon">⌁</span><span>${profile.stats.activities || 0} actividades creadas</span></div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><strong>${profile.stats.posts || 0}</strong><small>Publicaciones</small></div>
        <div class="profile-stat"><strong>${profile.stats.stories || 0}</strong><small>Historias</small></div>
        <div class="profile-stat"><strong>${profile.stats.activities || 0}</strong><small>Actividades</small></div>
      </div>
    </section>
    <div class="profile-content">
      <div>
        <div class="profile-posts-title"><h2>Mis publicaciones</h2><button class="section-link" type="button" data-action="create-post">＋ Publicar</button></div>
        <div class="post-list">
          ${posts.length ? posts.map(layoutPost).join('') : '<div class="empty-state"><span class="empty-icon">✎</span><strong>Todavía no publicas</strong><p>Tu primera publicación aparecerá aquí.</p></div>'}
          ${state.profilePostsHasMore ? '<button class="secondary-button full-width" type="button" data-action="load-more-posts">Cargar más publicaciones</button>' : ''}
        </div>
      </div>
    </div>`;
}

function openModal(content, small = false) {
  if (document.activeElement instanceof HTMLElement) state.lastFocusedElement = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal ${small ? 'small' : ''}" role="dialog" aria-modal="true" aria-label="Formulario" data-modal-content>${content}</div></div>`;
  document.body.classList.add('modal-open');
  const focusTarget = modalRoot.querySelector('textarea, input:not([type="file"]), select') || modalRoot.querySelector('button');
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 30);
}

function closeModal(clearPending = true) {
  const focusTarget = state.lastFocusedElement;
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  state.lastFocusedElement = null;
  if (focusTarget && document.contains(focusTarget)) window.setTimeout(() => focusTarget.focus(), 0);
  if (clearPending) {
    state.pendingPostImage = null;
    state.pendingProfileImage = undefined;
  }
}

function modalHead(eyebrow, title, subtitle = '') {
  return `<div class="modal-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="icon-button" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div>`;
}

function openPostModal(openCamera = false) {
  state.pendingPostImage = null;
  openModal(`
    ${modalHead('Compartir', 'Nueva publicación', 'Tu publicación aparecerá en el inicio de la comunidad.')}
    <form id="post-form" class="modal-form">
      <label for="post-body">¿Qué quieres compartir?</label>
      <textarea id="post-body" name="body" maxlength="1200" placeholder="Escribe aquí… (el modelo ML analizará el tema y tono en vivo)"></textarea>

      <!-- Asistente de Machine Learning en vivo -->
      <div id="ml-post-panel" class="ml-post-panel" hidden>
        <div class="ml-post-header">
          <span class="ml-chip-tag">✦ ML Campus Classifier</span>
          <span id="ml-sentiment-tag" class="ml-sentiment-tag is-neutral">😊 Tono: Neutro</span>
        </div>
        <div class="ml-prediction-row">
          <div class="ml-pred-info">
            <small>Sugerencia de categoría:</small>
            <div class="ml-pred-val">
              <strong id="ml-cat-val">Comunidad</strong>
              <span id="ml-conf-val" class="ml-conf-badge">94%</span>
            </div>
          </div>
          <button id="ml-btn-apply" type="button" class="ml-apply-button" title="Asignar automáticamente esta categoría">
            ✓ Aplicar categoría
          </button>
        </div>
        <p id="ml-toxic-warning" class="ml-warning-text" hidden></p>
      </div>

      <label for="post-category">Categoría</label>
      <select id="post-category" name="category">
        ${POST_CATEGORIES.filter((category) => category !== 'Todos').map((category) => `<option value="${category}">${category}</option>`).join('')}
      </select>
      <div class="photo-choice"><span>◉ Añadir una foto tomada con la cámara</span><button class="outline-button" type="button" data-action="choose-post-photo">Cámara</button></div>
      <input id="post-photo" class="visually-hidden" type="file" accept="image/*" capture="environment" />
      <img id="post-photo-preview" class="photo-preview" alt="Vista previa de la foto" hidden />
      <button class="primary-button" type="submit">Publicar ahora <span>→</span></button>
    </form>`);

  const postBody = document.getElementById('post-body');
  if (postBody) {
    let mlTimer = null;
    postBody.addEventListener('input', () => {
      const text = postBody.value.trim();
      const panel = document.getElementById('ml-post-panel');
      if (!panel) return;
      if (text.length < 5) {
        panel.hidden = true;
        return;
      }
      clearTimeout(mlTimer);
      mlTimer = setTimeout(async () => {
        try {
          const res = await request(`/api/ml/predict?text=${encodeURIComponent(text)}`);
          if (!document.getElementById('ml-post-panel')) return;
          panel.hidden = false;

          const catVal = document.getElementById('ml-cat-val');
          const confVal = document.getElementById('ml-conf-val');
          const sentTag = document.getElementById('ml-sentiment-tag');
          const toxicWarn = document.getElementById('ml-toxic-warning');

          if (catVal && res.category) {
            catVal.textContent = res.category.label;
            const pct = Math.round((res.category.probability || 0.5) * 100);
            confVal.textContent = `${pct}% conf.`;
          }

          if (sentTag && res.sentiment) {
            sentTag.textContent = res.sentiment.tone || 'Neutro';
            sentTag.className = 'ml-sentiment-tag ' + (
              res.isToxic ? 'is-danger' :
              res.sentiment.label === 'positivo' ? 'is-positive' :
              res.sentiment.label === 'negativo' ? 'is-negative' : 'is-neutral'
            );
          }

          if (toxicWarn) {
            if (res.isToxic && res.warning) {
              toxicWarn.textContent = `⚠️ ${res.warning}`;
              toxicWarn.hidden = false;
            } else {
              toxicWarn.hidden = true;
            }
          }
        } catch {}
      }, 160);
    });

    const applyBtn = document.getElementById('ml-btn-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const catVal = document.getElementById('ml-cat-val')?.textContent;
        const select = document.getElementById('post-category');
        if (catVal && select) {
          select.value = catVal;
          select.classList.add('pulse-highlight');
          setTimeout(() => select.classList.remove('pulse-highlight'), 800);
          showToast(`Categoría "${catVal}" asignada por el modelo ML`);
        }
      });
    }
  }

  if (openCamera) document.getElementById('post-photo')?.click();
}

function openActivityModal() {
  openModal(`
    ${modalHead('Comunidad', 'Crear una actividad', 'Define cuántos lugares necesitas y deja que otros se conecten contigo.')}
    <form id="activity-form" class="modal-form">
      <label for="activity-title">¿Qué quieres organizar?</label>
      <input id="activity-title" name="title" maxlength="120" placeholder="Ej. Fútbol el jueves" required />
      <label for="activity-description">Detalles</label>
      <textarea id="activity-description" name="description" maxlength="800" placeholder="Cuéntales a los demás qué van a hacer…"></textarea>
      <div class="form-two-columns">
        <div><label for="activity-category">Tipo</label><select id="activity-category" name="category">${ACTIVITY_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join('')}</select></div>
        <div><label for="activity-needed">Personas que faltan</label><input id="activity-needed" name="peopleNeeded" type="number" min="1" max="50" value="1" required /></div>
      </div>
      <div class="form-two-columns">
        <div><label for="activity-location">Lugar</label><input id="activity-location" name="location" maxlength="120" placeholder="Ej. Cancha del campus" /></div>
        <div><label for="activity-date">Fecha <span class="optional">opcional</span></label><input id="activity-date" name="eventDate" type="date" /></div>
      </div>
      <button class="primary-button" type="submit">Publicar actividad <span>→</span></button>
    </form>`);
}

function openProfileModal() {
  const user = state.user;
  openModal(`
    ${modalHead('Tu espacio', 'Editar perfil', 'La foto se toma con la cámara del celular.')}
    <form id="profile-form" class="modal-form">
      <label for="profile-name">Nombre para mostrar</label>
      <input id="profile-name" name="name" maxlength="80" value="${escapeHtml(user.name || '')}" required />
      <label for="profile-career">Carrera</label>
      <input id="profile-career" name="career" maxlength="100" value="${escapeHtml(user.career || '')}" placeholder="Ej. Ingeniería de Sistemas" />
      <div class="photo-choice"><span>◉ Foto de perfil</span><button class="outline-button" type="button" data-action="choose-profile-photo">Cámara</button>${user.avatar ? '<button class="text-button" type="button" data-action="remove-profile-photo">Quitar</button>' : ''}</div>
      <input id="profile-photo" class="visually-hidden" type="file" accept="image/*" capture="user" />
      <img id="profile-photo-preview" class="photo-preview" src="${escapeHtml(state.pendingProfileImage || user.avatar || '')}" alt="Vista previa de la foto de perfil" ${state.pendingProfileImage || user.avatar ? '' : 'hidden'} />
      <button class="primary-button" type="submit">Guardar cambios <span>→</span></button>
    </form>`);
}

function openStoryView(story) {
  if (!story) return;
  const canDelete = story.author.id === state.user.id;
  openModal(`
    ${modalHead('Historia', `${firstNameOf(story.author.name)}`, timeAgo(story.createdAt))}
    <img class="story-view-image" src="${escapeHtml(story.image)}" alt="Historia de ${escapeHtml(story.author.name)}" />
    ${canDelete ? '<button class="ghost-button full-width" type="button" data-action="delete-story" data-id="' + story.id + '">Eliminar mi historia</button>' : ''}
  `, true);
}

function compressImage(dataUrl, maxDimension = 1600) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const pixels = image.naturalWidth * image.naturalHeight;
      if (!image.naturalWidth || !image.naturalHeight || pixels > 20000000) {
        reject(new Error('La imagen tiene dimensiones demasiado grandes.'));
        return;
      }
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('No se pudo procesar la imagen.'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('No se pudo comprimir la imagen.'));
          return;
        }
        const output = new FileReader();
        output.onload = () => resolve(output.result);
        output.onerror = () => reject(new Error('No se pudo leer la imagen procesada.'));
        output.readAsDataURL(blob);
      }, 'image/jpeg', 0.82);
    };
    image.onerror = () => reject(new Error('El navegador no pudo abrir la imagen.'));
    image.src = dataUrl;
  });
}

function readImageFile(file, callback, errorCallback, maxDimension = 1600) {
  const supportedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif']);
  if (!file || !supportedTypes.has(file.type.toLowerCase())) {
    errorCallback('Selecciona una imagen válida.');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    errorCallback('La imagen no puede superar 4 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      callback(await compressImage(reader.result, maxDimension));
    } catch (error) {
      errorCallback(error.message || 'No se pudo procesar la imagen.');
    }
  };
  reader.onerror = () => errorCallback('No se pudo leer la imagen.');
  reader.readAsDataURL(file);
}

function updateImagePreview(inputId, previewId, image, stateKey) {
  state[stateKey] = image || null;
  const preview = document.getElementById(previewId);
  if (!preview) return;
  if (image) {
    preview.src = image;
    preview.hidden = false;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
  }
  const input = document.getElementById(inputId);
  if (input) input.value = '';
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const mode = form.id === 'register-form' ? 'register' : 'login';
  setAuthFeedback();
  setFormBusy(form, true);
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const data = await request(`/api/auth/${mode}`, { method: 'POST', body: values });
    form.reset();
    setAuthFeedback('Sesión iniciada correctamente.', 'success');
    await enterApp(data.user);
    showToast(`¡Bienvenido, ${firstName()}!`);
  } catch (error) {
    setAuthFeedback(error.message);
  } finally {
    setFormBusy(form, false);
  }
}

async function handleLogout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    if (socket) { socket.disconnect(); socket = null; }
    showAuth('login');
    showToast('Cerraste sesión correctamente.');
  } catch {
    showAuth('login');
    showToast('La sesión se ocultó, pero no se pudo confirmar el cierre. Revisa tu conexión.', true);
  }
}

async function handleJoinActivity(id) {
  const actionKey = `join:${id}`;
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  const known = (state.feed.activities || []).find((item) => String(item.id) === String(id));
  try {
    if (known && !known.joinedByMe && !known.isOwner && window.PrismFeatures) {
      // Unirse: la inscripción se registra al instante y se avisa con un mensaje.
      await window.PrismFeatures.enroll(id);
      return;
    }
    await request(`/api/activities/${id}/join`, { method: 'POST' });
    if (!isCurrentSession(sessionVersion)) return;
    await refreshFeed(sessionVersion);
    if (!isCurrentSession(sessionVersion)) return;
    await refreshProfileIfVisible();
    await renderPage();
    const activity = state.feed.activities.find((item) => String(item.id) === String(id));
    showToast(activity?.joinedByMe ? 'Te conectaste a la actividad.' : 'Saliste de la actividad.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    endAction(actionKey);
  }
}

async function handleLikePost(id) {
  const actionKey = `like:${id}`;
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  try {
    const result = await request(`/api/posts/${id}/like`, { method: 'POST' });
    if (!isCurrentSession(sessionVersion)) return;
    const post = state.feed.posts.find((item) => String(item.id) === String(id));
    if (post) Object.assign(post, result.post);
    const profilePost = state.profilePosts.find((item) => String(item.id) === String(id));
    if (profilePost) Object.assign(profilePost, result.post);
    await renderPage();
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    endAction(actionKey);
  }
}

async function handleStoryUpload(file) {
  const actionKey = 'story:upload';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  readImageFile(file, async (image) => {
    try {
      if (!isCurrentSession(sessionVersion)) return;
      await request('/api/stories', { method: 'POST', body: { image } });
      if (!isCurrentSession(sessionVersion)) return;
      await refreshFeed(sessionVersion);
      if (!isCurrentSession(sessionVersion)) return;
      await refreshProfileIfVisible();
      await renderPage();
      showToast('Tu historia ya está disponible por 24 horas.');
    } catch (error) {
      if (isCurrentSession(sessionVersion)) showToast(error.message, true);
    } finally {
      endAction(actionKey);
    }
  }, (error) => {
    if (isCurrentSession(sessionVersion)) showToast(error, true);
    endAction(actionKey);
  }, 1200);
}

async function handlePostSubmit(form) {
  const actionKey = 'post:create';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  const body = new FormData(form).get('body') || '';
  const category = new FormData(form).get('category') || 'General';
  if (!String(body).trim() && !state.pendingPostImage) {
    endAction(actionKey);
    showToast('Escribe algo o toma una foto antes de publicar.', true);
    return;
  }
  setFormBusy(form, true);
  try {
    await request('/api/posts', { method: 'POST', body: { body, category, image: state.pendingPostImage } });
    if (!isCurrentSession(sessionVersion)) return;
    closeModal();
    await refreshFeed(sessionVersion);
    if (!isCurrentSession(sessionVersion)) return;
    await refreshProfileIfVisible();
    await renderPage();
    showToast('Tu publicación ya está en el inicio.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    setFormBusy(form, false);
    endAction(actionKey);
  }
}

async function handleActivitySubmit(form) {
  const actionKey = 'activity:create';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  const values = Object.fromEntries(new FormData(form).entries());
  setFormBusy(form, true);
  try {
    await request('/api/activities', { method: 'POST', body: values });
    if (!isCurrentSession(sessionVersion)) return;
    closeModal();
    await refreshFeed(sessionVersion);
    if (!isCurrentSession(sessionVersion)) return;
    await refreshProfileIfVisible();
    await renderPage();
    showToast('Tu actividad fue publicada.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    setFormBusy(form, false);
    endAction(actionKey);
  }
}

async function loadMoreProfilePosts() {
  if (!state.profilePostsHasMore) return;
  const actionKey = 'profile:load-more';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  try {
    const data = await request(`/api/profile/posts?limit=30&offset=${state.profilePostsOffset}`);
    if (!isCurrentSession(sessionVersion)) return;
    const nextPosts = Array.isArray(data.posts) ? data.posts : [];
    const existingIds = new Set(state.profilePosts.map((post) => post.id));
    state.profilePosts.push(...nextPosts.filter((post) => !existingIds.has(post.id)));
    state.profilePostsHasMore = Boolean(data.hasMore);
    state.profilePostsOffset = Number(data.nextOffset || state.profilePosts.length);
    await renderPage();
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    endAction(actionKey);
  }
}

async function handleProfileSubmit(form) {
  const actionKey = 'profile:update';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  const values = Object.fromEntries(new FormData(form).entries());
  setFormBusy(form, true);
  try {
    const data = await request('/api/profile', {
      method: 'PATCH',
      body: {
        name: values.name,
        career: values.career,
        avatar: state.pendingProfileImage === undefined ? (state.user.avatar || null) : state.pendingProfileImage,
      },
    });
    if (!isCurrentSession(sessionVersion)) return;
    state.user = data.user;
    state.profile = null;
    closeModal();
    await Promise.all([refreshProfile(sessionVersion), refreshProfilePosts(sessionVersion), refreshFeed(sessionVersion)]);
    if (!isCurrentSession(sessionVersion)) return;
    await renderPage();
    showToast('Tu perfil se actualizó.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    setFormBusy(form, false);
    endAction(actionKey);
  }
}

async function handleDeleteStory(id) {
  const actionKey = `story:delete:${id}`;
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  try {
    await request(`/api/stories/${id}`, { method: 'DELETE' });
    if (!isCurrentSession(sessionVersion)) return;
    closeModal();
    await refreshFeed(sessionVersion);
    if (!isCurrentSession(sessionVersion)) return;
    await refreshProfileIfVisible();
    await renderPage();
    showToast('Historia eliminada.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    endAction(actionKey);
  }
}

async function toggleNotifications(force) {
  const panel = document.getElementById('notification-panel');
  const shouldOpen = typeof force === 'boolean' ? force : panel.hidden;
  if (!shouldOpen) {
    panel.hidden = true;
    document.getElementById('notification-toggle').setAttribute('aria-expanded', 'false');
    return;
  }
  panel.hidden = false;
  document.getElementById('notification-toggle').setAttribute('aria-expanded', 'true');
  const list = document.getElementById('notification-list');
  const sessionVersion = state.sessionVersion;
  list.innerHTML = '<div class="loading-line medium"></div><div class="loading-line short"></div>';
  try {
    const data = await request('/api/notifications');
    if (!isCurrentSession(sessionVersion)) return;
    state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    state.feed.unreadNotifications = Number(data.unreadNotifications || 0);
    syncUserUI();
    renderNotifications();
  } catch (error) {
    if (!isCurrentSession(sessionVersion)) return;
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">!</span><strong>No se pudieron cargar</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderNotifications() {
  const list = document.getElementById('notification-list');
  if (!state.notifications.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">♢</span><strong>Todo tranquilo por aquí</strong><p>Cuando alguien interactúe con tu contenido, lo verás aquí.</p></div>';
    return;
  }
  list.innerHTML = state.notifications.map((notification) => `
    <div class="notification-item ${notification.isRead ? '' : 'is-unread'}">
      <span class="notification-item-icon">⌁</span>
      <div><p>${escapeHtml(notification.message)}</p><time>${escapeHtml(timeAgo(notification.createdAt))}</time></div>
    </div>`).join('');
}

async function markNotificationsRead() {
  const actionKey = 'notifications:read';
  if (!beginAction(actionKey)) return;
  const sessionVersion = state.sessionVersion;
  try {
    await request('/api/notifications/read', { method: 'POST' });
    if (!isCurrentSession(sessionVersion)) return;
    state.notifications.forEach((notification) => { notification.isRead = true; });
    state.feed.unreadNotifications = 0;
    syncUserUI();
    renderNotifications();
    showToast('Notificaciones marcadas como leídas.');
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showToast(error.message, true);
  } finally {
    endAction(actionKey);
  }
}

async function handleClick(event) {
  const authTab = event.target.closest('[data-auth-tab]');
  if (authTab) {
    setAuthMode(authTab.dataset.authTab);
    return;
  }

  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget) {
    event.preventDefault();
    const route = routeTarget.dataset.route;
    if (route === currentRoute()) renderPage();
    else window.location.hash = `#/${route}`;
    return;
  }

  const soonTarget = event.target.closest('[data-soon]');
  if (soonTarget) {
    event.preventDefault();
    showToast(`${soonTarget.dataset.soon} estará disponible en una próxima actualización.`);
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) {
    const panel = document.getElementById('notification-panel');
    const toggle = document.getElementById('notification-toggle');
    if (panel && !panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) toggleNotifications(false);
    return;
  }
  const action = target.dataset.action;

  if (action === 'close-modal') {
    if (target.classList.contains('modal-backdrop') && event.target !== target) return;
    closeModal();
  } else if (action === 'create-post') {
    openPostModal();
  } else if (action === 'post-camera') {
    openPostModal(true);
  } else if (action === 'create-activity') {
    openActivityModal();
  } else if (action === 'story-camera') {
    storyCamera.click();
  } else if (action === 'view-story') {
    const story = state.feed.stories.find((item) => String(item.id) === String(target.dataset.id));
    openStoryView(story);
  } else if (action === 'like-post') {
    handleLikePost(target.dataset.id);
  } else if (action === 'join-activity') {
    handleJoinActivity(target.dataset.id);
  } else if (action === 'logout') {
    handleLogout();
  } else if (action === 'edit-profile') {
    state.pendingProfileImage = undefined;
    openProfileModal();
  } else if (action === 'profile-camera') {
    profileCamera.click();
  } else if (action === 'choose-post-photo') {
    document.getElementById('post-photo')?.click();
  } else if (action === 'choose-profile-photo') {
    document.getElementById('profile-photo')?.click();
  } else if (action === 'remove-profile-photo') {
    updateImagePreview('profile-photo', 'profile-photo-preview', null, 'pendingProfileImage');
  } else if (action === 'delete-story') {
    handleDeleteStory(target.dataset.id);
  } else if (action === 'load-more-posts') {
    loadMoreProfilePosts();
  } else if (action === 'open-notifications' || target.id === 'notification-toggle') {
    toggleNotifications();
  } else if (action === 'close-notifications') {
    toggleNotifications(false);
  } else if (action === 'read-notifications') {
    markNotificationsRead();
  } else if (action === 'delete-post') {
    const id = target.dataset.id;
    if (!id || !confirm('¿Deseas eliminar esta publicación?')) return;
    try {
      await request(`/api/posts/${id}`, { method: 'DELETE' });
      showToast('🗑️ Publicación eliminada');
      await refreshFeed();
      await refreshProfileIfVisible();
      await renderPage();
    } catch (e) {
      showToast(e.message, true);
    }
  }
}

function handleChange(event) {
  if (event.target.id === 'post-filter') {
    state.filter = event.target.value;
    renderPage();
    return;
  }
  if (event.target.id === 'post-photo') {
    const sessionVersion = state.sessionVersion;
    readImageFile(event.target.files[0], (image) => {
      if (isCurrentSession(sessionVersion)) updateImagePreview('post-photo', 'post-photo-preview', image, 'pendingPostImage');
    }, (error) => {
      if (isCurrentSession(sessionVersion)) showToast(error, true);
    }, 1600);
    return;
  }
  if (event.target.id === 'profile-photo') {
    const sessionVersion = state.sessionVersion;
    readImageFile(event.target.files[0], (image) => {
      if (isCurrentSession(sessionVersion)) updateImagePreview('profile-photo', 'profile-photo-preview', image, 'pendingProfileImage');
    }, (error) => {
      if (isCurrentSession(sessionVersion)) showToast(error, true);
    }, 800);
  }
}

function handleSubmit(event) {
  if (event.target.id === 'login-form' || event.target.id === 'register-form') {
    handleAuthSubmit(event);
    return;
  }
  if (event.target.id === 'chat-form') {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    if (socket && socket.connected) {
      socket.emit('chat:send', { text, user: state.user });
    } else {
      const item = {
        u: state.user?.name || 'Estudiante',
        t: text,
        h: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        me: true,
      };
      state.chats.push(item);
      const stream = document.getElementById('chat-stream');
      if (stream) {
        stream.insertAdjacentHTML('beforeend', chatMessageHtml(item));
        stream.scrollTop = stream.scrollHeight;
      }
    }
    return;
  }
  if (event.target.id === 'post-form') {
    event.preventDefault();
    handlePostSubmit(event.target);
  } else if (event.target.id === 'activity-form') {
    event.preventDefault();
    handleActivitySubmit(event.target);
  } else if (event.target.id === 'profile-form') {
    event.preventDefault();
    handleProfileSubmit(event.target);
  }
}

function handleFileInput(event) {
  if (event.target === storyCamera && event.target.files[0]) {
    handleStoryUpload(event.target.files[0]);
    event.target.value = '';
  } else if (event.target === profileCamera && event.target.files[0]) {
    const sessionVersion = state.sessionVersion;
    readImageFile(event.target.files[0], (image) => {
      if (!isCurrentSession(sessionVersion)) return;
      state.pendingProfileImage = image;
      openProfileModal();
      const preview = document.getElementById('profile-photo-preview');
      if (preview) {
        preview.src = image;
        preview.hidden = false;
      }
    }, (error) => {
      if (isCurrentSession(sessionVersion)) showToast(error, true);
    }, 800);
    event.target.value = '';
  }
}

document.addEventListener('click', handleClick);
document.addEventListener('change', handleChange);
document.addEventListener('submit', handleSubmit);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (modalRoot.innerHTML) closeModal();
  else if (!document.getElementById('notification-panel').hidden) toggleNotifications(false);
});
storyCamera.addEventListener('change', handleFileInput);
profileCamera.addEventListener('change', handleFileInput);
window.addEventListener('hashchange', handleRouteChange);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshInBackground();
});
window.setInterval(() => refreshInBackground(), 30000);

setAuthMode('login');

(async function bootstrap() {
  try {
    const data = await request('/api/me');
    if (data.user) await enterApp(data.user);
    else showAuth('login');
  } catch (error) {
    showAuth('login');
    if (error && error.message) setAuthFeedback(error.message);
  }
})();

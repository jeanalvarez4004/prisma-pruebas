const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { Server: SocketIOServer } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});
const ROOT = __dirname;

// Cargar variables de entorno locales (.env o .env.mis_servicios)
function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadLocalEnv(path.join(ROOT, '.env'));
loadLocalEnv(path.join(ROOT, '.env.mis_servicios'));

const redis = require('./redis-client');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const USMP_EMAIL_ONLY = process.env.USMP_EMAIL_ONLY === 'true';
const SESSION_DAYS = 30;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PASSWORD_MAX_BYTES = 512;
const rateBuckets = new Map();

const configuredDatabase = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'prisma.sqlite');
const databaseFile = path.isAbsolute(configuredDatabase)
  ? configuredDatabase
  : path.resolve(ROOT, configuredDatabase);

fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

// Base de datos: con TURSO_DATABASE_URL + TURSO_AUTH_TOKEN los datos viven en Turso (réplica
// embebida con la misma API que better-sqlite3), así no se pierden en cada reinicio de Render.
// Sin esas variables se usa un archivo SQLite local (útil en desarrollo).
let databaseMode = 'sqlite-local';
function openDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (url && token) {
    try {
      const Libsql = require('libsql');
      const replica = path.join(path.dirname(databaseFile), 'turso-replica.sqlite');
      for (const suffix of ['', '-wal', '-shm', '-info', '-client_wal_index']) fs.rmSync(replica + suffix, { force: true });
      const connection = new Libsql(replica, { syncUrl: url, authToken: token, syncPeriod: 30 });
      try {
        const syncing = connection.sync();
        if (syncing && typeof syncing.catch === 'function') syncing.catch((error) => console.warn('[Turso] sync:', error.message));
      } catch (error) {
        console.warn('[Turso] sync inicial:', error.message);
      }
      databaseMode = 'turso';
      console.log('[DB] Usando Turso (réplica embebida):', url);
      return connection;
    } catch (error) {
      console.error('[DB] No se pudo abrir Turso, se usa SQLite local:', error.message);
    }
  }
  return new Database(databaseFile);
}
const db = openDatabase();
for (const pragma of ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000']) {
  try { db.pragma(pragma); } catch (error) { console.warn(`[DB] pragma ${pragma}:`, error.message); }
}

// Ejecuta una transacción inmediata (compatible con better-sqlite3 y libsql).
function runImmediate(fn) {
  const tx = db.transaction(fn);
  return typeof tx.immediate === 'function' ? tx.immediate() : tx();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    career TEXT NOT NULL DEFAULT 'Sin especificar',
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    image TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Ayuda',
    people_needed INTEGER NOT NULL DEFAULT 1,
    location TEXT NOT NULL DEFAULT 'Por definir',
    event_date TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_members (
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (activity_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    user_career TEXT NOT NULL DEFAULT 'USMP',
    user_avatar TEXT,
    message TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT 'global',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(expires_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(room, created_at DESC);
`);

// ---------------------------------------------------------------------------
// Servicios añadidos (equivalentes a los del proyecto de referencia):
// búsqueda (Algolia), asistente (Groq + Qdrant), cola (CloudAMQP), ML y Admin.
// ---------------------------------------------------------------------------
try {
  if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
} catch (error) {
  if (!/duplicate column/i.test(error.message)) console.warn('[DB] migración role:', error.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'en_cola',
    detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    sentiment TEXT,
    probability REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'sqlite',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    vec TEXT NOT NULL,
    provider TEXT NOT NULL,
    dim INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assistant_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 0,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assistant_user ON assistant_logs(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_enrollments_activity ON enrollments(activity_id, status);
  CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON knowledge_chunks(doc_id);
`);

const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
);
function syncAdminRoles() {
  for (const email of ADMIN_EMAILS) {
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ? AND role <> 'admin'").run(email);
  }
}
syncAdminRoles();

const searchService = require('./services/search');
const knowledgeService = require('./services/knowledge');
const documentsService = require('./services/documents');
const assistantService = require('./services/assistant');
const queueService = require('./services/queue');
const mlService = require('./services/ml');
const memoryService = require('./services/memory');

const POST_CATEGORIES = new Set(['General', 'Académico', 'Comunidad']);
const ACTIVITY_CATEGORIES = new Set(['Deporte', 'Juego', 'Estudio', 'Transporte', 'Ayuda', 'Otro']);

function now() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 254).trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAllowedEmail(email) {
  return !USMP_EMAIL_ONLY || email.endsWith('@usmp.edu.pe');
}

function isValidImage(value) {
  if (!value) return true;
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:(image\/(?:jpe?g|png|webp|gif|heic|heif|avif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return false;

  try {
    const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return false;
    const mime = match[1].toLowerCase();
    if (mime === 'image/jpeg' || mime === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/gif') return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
    if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (mime === 'image/heic' || mime === 'image/heif' || mime === 'image/avif') {
      return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    return false;
  } catch {
    return false;
  }
}

function passwordForHash(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function rateLimit(windowMs, maxRequests, scope) {
  return (req, res, next) => {
    const client = req.user ? `user:${req.user.id}` : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const key = `${scope}:${client}`;
    const currentTime = Date.now();
    const current = rateBuckets.get(key);
    const bucket = !current || current.resetAt <= currentTime
      ? { count: 0, resetAt: currentTime + windowMs }
      : current;

    bucket.count += 1;
    rateBuckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - currentTime) / 1000)));
      return res.status(429).json({ error: 'Demasiados intentos. Espera un momento y vuelve a intentar.' });
    }
    return next();
  };
}

function sameOriginGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
  }

  const origin = req.get('origin');
  const referer = req.get('referer');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expectedOrigin) {
    return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
  }
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    } catch {
      return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }
  }
  return next();
}

const authRateLimit = rateLimit(15 * 60 * 1000, 30, 'auth');
const postRateLimit = rateLimit(60 * 60 * 1000, 30, 'post');
const storyRateLimit = rateLimit(60 * 60 * 1000, 20, 'story');
const activityRateLimit = rateLimit(60 * 60 * 1000, 20, 'activity');
const joinRateLimit = rateLimit(60 * 60 * 1000, 80, 'join');
const likeRateLimit = rateLimit(60 * 60 * 1000, 120, 'like');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    career: user.career,
    avatar: user.avatar || null,
    role: user.role || 'user',
    createdAt: user.created_at,
  };
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), userId, expiresAt, createdAt);

  res.cookie('prism_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: SESSION_DAYS * 86400000,
  });
}

function clearSession(req, res) {
  const token = req.cookies && req.cookies.prism_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie('prism_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
  });
}

function currentUser(req) {
  const token = req.cookies && req.cookies.prism_session;
  if (!token) return null;

  const user = db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), now());

  if (!user) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return user;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Tu sesión no está activa. Inicia sesión nuevamente.' });
  }
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Esta sección es solo para administradores.' });
    }
    return next();
  });
}

const searchRateLimit = rateLimit(60 * 1000, 60, 'search');
const assistantRateLimit = rateLimit(60 * 1000, 12, 'assistant');
const enrollRateLimit = rateLimit(60 * 60 * 1000, 80, 'enroll');
const contactRateLimit = rateLimit(60 * 60 * 1000, 10, 'contact');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getPost(postId, userId) {
  return db.prepare(`
    SELECT
      p.id,
      p.body,
      p.category,
      p.image,
      p.created_at,
      u.id AS user_id,
      u.name,
      u.career,
      u.avatar,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
      EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = @userId) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = @postId
  `).get({ postId, userId });
}

function getPostsForUser(ownerId, viewerId, limit, offset = 0) {
  return db.prepare(`
    SELECT
      p.id,
      p.body,
      p.category,
      p.image,
      p.created_at,
      u.id AS user_id,
      u.name,
      u.career,
      u.avatar,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
      EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = @viewerId) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = @ownerId
    ORDER BY p.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ownerId, viewerId, limit, offset });
}

function getActivity(activityId, userId) {
  const activity = db.prepare(`
    SELECT
      a.id,
      a.owner_id,
      a.title,
      a.description,
      a.category,
      a.people_needed,
      a.location,
      a.event_date,
      a.created_at,
      u.id AS owner_user_id,
      u.name AS owner_name,
      u.career AS owner_career,
      u.avatar AS owner_avatar,
      COUNT(am.user_id) AS joined,
      EXISTS(SELECT 1 FROM activity_members am2 WHERE am2.activity_id = a.id AND am2.user_id = @userId) AS joined_by_me
    FROM activities a
    JOIN users u ON u.id = a.owner_id
    LEFT JOIN activity_members am ON am.activity_id = a.id
    WHERE a.id = @activityId
    GROUP BY a.id
  `).get({ activityId, userId });

  if (!activity) return null;
  const total = 1 + activity.people_needed;
  return {
    id: activity.id,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    peopleNeeded: activity.people_needed,
    location: activity.location,
    eventDate: activity.event_date,
    createdAt: activity.created_at,
    owner: {
      id: activity.owner_user_id,
      name: activity.owner_name,
      career: activity.owner_career,
      avatar: activity.owner_avatar,
    },
    joined: activity.joined,
    total,
    remaining: Math.max(total - activity.joined, 0),
    joinedByMe: Boolean(activity.joined_by_me),
    isOwner: activity.owner_id === userId,
  };
}

function serializePost(post) {
  return {
    id: post.id,
    body: post.body,
    category: post.category,
    image: post.image || null,
    createdAt: post.created_at,
    author: {
      id: post.user_id,
      name: post.name,
      career: post.career,
      avatar: post.avatar || null,
    },
    likes: post.likes,
    liked: Boolean(post.liked),
  };
}

function serializeStory(story) {
  return {
    id: story.id,
    image: story.image,
    createdAt: story.created_at,
    author: {
      id: story.user_id,
      name: story.name,
      career: story.career,
      avatar: story.avatar || null,
    },
  };
}

function serializeActivity(activity) {
  return activity;
}

function serializeNotification(notification) {
  return {
    id: notification.id,
    type: notification.type,
    message: notification.message,
    isRead: Boolean(notification.is_read),
    createdAt: notification.created_at,
  };
}

function validationError(res, message) {
  return res.status(400).json({ error: message });
}

function boundedLimit(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

async function getFeedVersion() {
  try {
    const ver = await redis.get('prism:feed:ver');
    return Number(ver) || 1;
  } catch {
    return 1;
  }
}

async function invalidateFeedCache() {
  try {
    const currentVer = await getFeedVersion();
    await redis.set('prism:feed:ver', currentVer + 1, 86400);
  } catch (err) {
    console.warn('[Redis Invalidate Error]', err.message);
  }
}


app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com https://*.unsplash.com https://i.pravatar.cc; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.socket.io; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Los documentos del asistente (hasta 10 MB) viajan en base64: necesitan un límite mayor.
app.use('/api/admin/conocimiento', express.json({ limit: '16mb' }));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', sameOriginGuard);

// HTTP HEAD (Tópico HTTP Methods: Metadatos sin cuerpo de respuesta)
app.head('/api/health', (req, res) => {
  res.setHeader('X-Service', 'prism-usmp');
  res.setHeader('X-Database', databaseMode);
  res.setHeader('X-Cache-Backend', redis.isConfigured() ? 'Upstash-Redis' : 'Memory-Fallback');
  res.status(200).end();
});

// HTTP GET /api/health (Diagnóstico de infraestructura)
app.get('/api/health', asyncRoute(async (req, res) => {
  const ping = await redis.ping();
  res.json({
    ok: true,
    service: 'prism',
    database: databaseMode,
    redis: {
      connected: redis.isConfigured(),
      provider: ping.provider,
      latencyMs: ping.latencyMs,
    },
  });
}));

// Tópico View Data: Proporciona metadatos del campus USMP para las vistas de la aplicación
app.get('/api/view-data', (req, res) => {
  res.json({
    campus: 'USMP Filial Sur Arequipa',
    academicPeriod: '2026-I',
    platform: 'PRISM Social Campus',
    version: '1.2.0',
    serverTime: now(),
    infrastructure: {
      database: 'SQLite 3 (WAL mode)',
      cache: redis.isConfigured() ? 'Upstash Redis Cloud' : 'In-Memory Fallback',
      pwaReady: true,
      serviceWorker: true,
    },
    faculties: [
      'Facultad de Ingeniería y Arquitectura',
      'Facultad de Ciencias de la Comunicación, Turismo y Psicología',
      'Facultad de Derecho',
      'Facultad de Ciencias Administrativas y Recursos Humanos',
      'Facultad de Medicina Humana',
    ],
  });
});

// Tópico Temp Data / Flash Messages (Mensajes temporales de consumo único almacenados en Redis)
app.post('/api/temp-data', requireAuth, asyncRoute(async (req, res) => {
  const message = cleanText(req.body && req.body.message, 250);
  const type = cleanText(req.body && req.body.type, 20) || 'success';
  if (!message) return validationError(res, 'El mensaje temporal no puede estar vacío.');

  const keyId = req.cookies?.prism_session ? hashToken(req.cookies.prism_session) : String(req.user.id);
  await redis.setTempData(keyId, { message, type, createdAt: now() }, 60);
  res.status(201).json({ ok: true, stored: true });
}));

app.get('/api/temp-data', requireAuth, asyncRoute(async (req, res) => {
  const keyId = req.cookies?.prism_session ? hashToken(req.cookies.prism_session) : String(req.user.id);
  const flash = await redis.getTempData(keyId);
  res.json({ flash: flash || null });
}));

// Tópico Redis: Estadísticas en vivo y latencia para evaluación docente
app.get('/api/redis/stats', asyncRoute(async (req, res) => {
  const ping = await redis.ping();
  const stats = redis.getStats();
  const feedVer = await getFeedVersion();
  res.json({
    status: ping.ok ? 'ONLINE' : 'FALLBACK',
    ...stats,
    ping,
    currentFeedVersion: feedVer,
  });
}));

// Tópico Redis: Vaciado/invalidación forzada de caché para pruebas de HIT/MISS
app.post('/api/redis/clear', requireAuth, asyncRoute(async (req, res) => {
  await invalidateFeedCache();
  res.json({ ok: true, message: 'Caché de Redis invalidado exitosamente.' });
}));

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.post('/api/auth/register', authRateLimit, asyncRoute(async (req, res) => {
  const name = cleanText(req.body && req.body.name, 80);
  const email = normalizeEmail(req.body && req.body.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const career = cleanText(req.body && req.body.career, 100) || 'Sin especificar';

  if (name.length < 2) return validationError(res, 'Escribe un nombre de al menos 2 caracteres.');
  if (!isValidEmail(email)) return validationError(res, 'Escribe un correo electrónico válido.');
  if (!isAllowedEmail(email)) return validationError(res, 'Por ahora solo se admiten correos de la USMP.');
  if (password.length < 8) return validationError(res, 'La contraseña debe tener al menos 8 caracteres.');
  if (password.length > 128 || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return validationError(res, 'La contraseña es demasiado larga.');
  }
  if (password !== confirmPassword) return validationError(res, 'Las contraseñas no coinciden.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });

  const passwordHash = await bcrypt.hash(passwordForHash(password), 12);
  let userId;
  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, career, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, passwordHash, career, now());
    userId = result.lastInsertRowid;
  } catch (error) {
    if (String(error.code).includes('CONSTRAINT')) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
    }
    throw error;
  }

  syncAdminRoles();
  const user = getUserById(userId);
  createSession(res, user.id);
  return res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', authRateLimit, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!isValidEmail(email) || !isAllowedEmail(email) || !password || password.length > 128 || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return validationError(res, 'Ingresa tu correo y contraseña.');
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  let valid = user ? await bcrypt.compare(passwordForHash(password), user.password_hash) : false;
  // Permite recuperar cuentas creadas por una versión anterior del prototipo.
  if (user && !valid) valid = await bcrypt.compare(password, user.password_hash);
  if (!user || !valid) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos. Verifica tus datos.' });
  }

  createSession(res, user.id);
  return res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

// HTTP GET /api/feed con Cache Aside en Redis (Tópicos: Redis, HTTP GET, Base de Datos SQLite)
app.get('/api/feed', requireAuth, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const postLimit = boundedLimit(req.query.posts, 40, 50);
  const storyLimit = boundedLimit(req.query.stories, 20, 30);
  const activityLimit = boundedLimit(req.query.activities, 30, 50);

  const feedVer = await getFeedVersion();
  const cacheKey = `prism:feed:v${feedVer}:u${userId}:p${postLimit}`;

  // Intento de Cache Aside desde Redis
  const cachedFeed = await redis.get(cacheKey);
  if (cachedFeed) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Provider', redis.isConfigured() ? 'Upstash-Redis' : 'Memory-Fallback');
    res.setHeader('X-Feed-Version', String(feedVer));
    return res.json(cachedFeed);
  }

  // En caso de MISS: consulta a SQLite WAL
  db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now());
  const posts = db.prepare(`
    SELECT
      p.id,
      p.body,
      p.category,
      p.image,
      p.created_at,
      u.id AS user_id,
      u.name,
      u.career,
      u.avatar,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
      EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = @userId) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT @postLimit
  `).all({ userId, postLimit });

  const stories = db.prepare(`
    SELECT s.id, s.user_id, s.image, s.created_at, u.name, u.career, u.avatar
    FROM stories s
    JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(now(), storyLimit);

  const activities = db.prepare(`
    SELECT a.id
    FROM activities a
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(activityLimit).map((row) => getActivity(row.id, userId)).filter(Boolean);

  const unreadNotifications = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(userId).count;

  const payload = {
    posts: posts.map(serializePost),
    stories: stories.map(serializeStory),
    activities: activities.map(serializeActivity),
    unreadNotifications,
  };

  // Guardamos en Redis con TTL de 60 segundos
  await redis.set(cacheKey, payload, 60);

  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Cache-Provider', 'SQLite-Primary');
  res.setHeader('X-Feed-Version', String(feedVer));
  return res.json(payload);
}));

// HTTP OPTIONS /api/posts (Tópico HTTP Methods: Detección de verbos soportados)
app.options('/api/posts', (req, res) => {
  res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});

// HTTP POST /api/posts (Tópicos: HTTP POST, SQLite WAL, Redis Cache Invalidation)
app.post('/api/posts', requireAuth, postRateLimit, asyncRoute(async (req, res) => {
  const body = cleanText(req.body && req.body.body, 1200);
  const category = POST_CATEGORIES.has(req.body?.category) ? req.body.category : 'General';
  const image = req.body?.image || null;

  if (!body && !image) return validationError(res, 'Escribe algo o toma una foto para publicar.');
  if (!isValidImage(image)) return validationError(res, 'La imagen no es válida o supera 4 MB.');
  const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(req.user.id).count;
  if (postCount >= 100) return res.status(429).json({ error: 'Alcanzaste el límite de publicaciones. Inténtalo más tarde.' });

  const result = db.prepare(`
    INSERT INTO posts (user_id, body, category, image, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, body, category, image, now());
  const post = getPost(result.lastInsertRowid, req.user.id);
  searchService.indexRecord(db, 'post', Number(result.lastInsertRowid));

  // Invalida atómicamente la caché del feed en Redis
  await invalidateFeedCache();

  const serialized = serializePost(post);
  // Emisión en tiempo real vía WebSocket
  io.emit('feed:new_post', { post: serialized, authorName: req.user.name });

  res.status(201).json({ post: serialized });
}));

// HTTP DELETE /api/posts/:id (Tópicos: HTTP DELETE, SQLite WAL, Redis Cache Invalidation)
app.delete('/api/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return validationError(res, 'ID de publicación no válido.');
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'La publicación ya no existe.' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para eliminar esta publicación.' });

  db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  searchService.removeRecord('post', postId);
  await invalidateFeedCache();

  // Emisión en tiempo real vía WebSocket
  io.emit('feed:post_deleted', { postId });

  res.json({ ok: true, message: 'Publicación eliminada correctamente.' });
}));

// HTTP POST /api/posts/:id/like (Tópicos: HTTP POST, SQLite, Redis Invalidation)
app.post('/api/posts/:id/like', requireAuth, likeRateLimit, asyncRoute(async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return validationError(res, 'Publicación no válida.');
  const postOwner = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (!postOwner) return res.status(404).json({ error: 'La publicación ya no existe.' });

  const exists = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);
  if (!exists) {
    db.prepare(`
      INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)
    `).run(postId, req.user.id, now());
    if (postOwner.user_id !== req.user.id) {
      const message = `${req.user.name} le dio me gusta a tu publicación.`;
      db.prepare('DELETE FROM notifications WHERE user_id = ? AND type = ? AND message = ?')
        .run(postOwner.user_id, 'like', message);
      db.prepare(`INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, 'like', ?, ?)`)
        .run(postOwner.user_id, message, now());
    }
  } else {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, req.user.id);
  }

  // Invalida la versión de caché para refrescar contadores de likes
  await invalidateFeedCache();

  const post = getPost(postId, req.user.id);
  if (!post) return res.status(404).json({ error: 'La publicación ya no existe.' });

  // Emisión en tiempo real vía WebSocket
  io.emit('feed:post_liked', { postId, likes: post.likes });

  res.json({ post: serializePost(post) });
}));

app.post('/api/activities', requireAuth, activityRateLimit, (req, res) => {
  const title = cleanText(req.body && req.body.title, 120);
  const description = cleanText(req.body && req.body.description, 800);
  const category = ACTIVITY_CATEGORIES.has(req.body?.category) ? req.body.category : 'Ayuda';
  const peopleNeeded = Number(req.body && req.body.peopleNeeded);
  const location = cleanText(req.body && req.body.location, 120) || 'Por definir';
  const eventDate = cleanText(req.body && req.body.eventDate, 40) || null;
  if (eventDate && !isValidDateOnly(eventDate)) return validationError(res, 'La fecha de la actividad no es válida.');

  if (title.length < 4) return validationError(res, 'Ponle un título a la actividad.');
  if (!Number.isInteger(peopleNeeded) || peopleNeeded < 1 || peopleNeeded > 50) {
    return validationError(res, 'Indica cuántas personas necesitas, entre 1 y 50.');
  }
  const activityCount = db.prepare(`
    SELECT COUNT(*) AS count FROM activities WHERE owner_id = ? AND created_at >= ?
  `).get(req.user.id, new Date(Date.now() - 86400000).toISOString()).count;
  if (activityCount >= 20) return res.status(429).json({ error: 'Alcanzaste el límite diario de actividades.' });

  const createActivity = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO activities
        (owner_id, title, description, category, people_needed, location, event_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, title, description, category, peopleNeeded, location, eventDate, now());
    db.prepare(`
      INSERT INTO activity_members (activity_id, user_id, joined_at) VALUES (?, ?, ?)
    `).run(result.lastInsertRowid, req.user.id, now());
    return result.lastInsertRowid;
  });
  const activityId = createActivity();
  searchService.indexRecord(db, 'activity', Number(activityId));
  invalidateFeedCache();

  const activity = getActivity(activityId, req.user.id);
  res.status(201).json({ activity });
});

app.post('/api/activities/:id/join', requireAuth, joinRateLimit, (req, res) => {
  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId)) return validationError(res, 'Actividad no válida.');

  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activity) return res.status(404).json({ error: 'La actividad ya no existe.' });

  const toggleMembership = () => {
    const alreadyJoined = db.prepare(`
      SELECT 1 FROM activity_members WHERE activity_id = ? AND user_id = ?
    `).get(activityId, req.user.id);

    if (alreadyJoined) {
      if (activity.owner_id === req.user.id) {
        return { status: 400, error: 'Eres quien creó la actividad; no puedes salir de ella.' };
      }
      db.prepare('DELETE FROM activity_members WHERE activity_id = ? AND user_id = ?').run(activityId, req.user.id);
      return { joined: false };
    }

    const count = db.prepare('SELECT COUNT(*) AS count FROM activity_members WHERE activity_id = ?').get(activityId).count;
    if (count >= 1 + activity.people_needed) {
      return { status: 409, error: 'Esta actividad ya alcanzó el número de participantes.' };
    }

    db.prepare(`
      INSERT INTO activity_members (activity_id, user_id, joined_at) VALUES (?, ?, ?)
    `).run(activityId, req.user.id, now());

    if (activity.owner_id !== req.user.id) {
      const message = `${req.user.name} se conectó a “${activity.title}”.`;
      db.prepare(`
        DELETE FROM notifications
        WHERE user_id = ? AND type = 'activity' AND message = ?
      `).run(activity.owner_id, message);
      db.prepare(`
        INSERT INTO notifications (user_id, type, message, created_at)
        VALUES (?, 'activity', ?, ?)
      `).run(activity.owner_id, message, now());
    }
    return { joined: true };
  };

  let outcome;
  try {
    outcome = runImmediate(toggleMembership);
  } catch {
    return res.status(409).json({ error: 'La actividad se está actualizando. Inténtalo de nuevo.' });
  }
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  invalidateFeedCache();

  const updated = getActivity(activityId, req.user.id);
  res.json({ activity: updated });
});

app.post('/api/stories', requireAuth, storyRateLimit, (req, res) => {
  const image = req.body && req.body.image;
  if (!isValidImage(image) || !image) return validationError(res, 'Toma una foto para subir tu historia.');
  const activeStories = db.prepare(`
    SELECT COUNT(*) AS count FROM stories WHERE user_id = ? AND expires_at > ?
  `).get(req.user.id, now()).count;
  if (activeStories >= 5) return res.status(429).json({ error: 'Ya tienes demasiadas historias activas. Espera a que expiren.' });

  const createdAt = now();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    INSERT INTO stories (user_id, image, created_at, expires_at) VALUES (?, ?, ?, ?)
  `).run(req.user.id, image, createdAt, expiresAt);
  const story = db.prepare(`
    SELECT s.id, s.user_id, s.image, s.created_at, u.name, u.career, u.avatar
    FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ story: serializeStory(story) });
});

app.delete('/api/stories/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = db.prepare('DELETE FROM stories WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'La historia no existe.' });
  await invalidateFeedCache();
  res.json({ ok: true });
}));

app.get('/api/profile', requireAuth, (req, res) => {
  const user = req.user;
  const postCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(user.id).count;
  const storyCount = db.prepare(`
    SELECT COUNT(*) AS count FROM stories WHERE user_id = ? AND expires_at > ?
  `).get(user.id, now()).count;
  const activityCount = db.prepare('SELECT COUNT(*) AS count FROM activities WHERE owner_id = ?').get(user.id).count;

  res.json({
    user: publicUser(user),
    stats: { posts: postCount, stories: storyCount, activities: activityCount },
  });
});

app.get('/api/profile/posts', requireAuth, (req, res) => {
  const limit = boundedLimit(req.query.limit, 20, 50);
  const offsetValue = Number.parseInt(req.query.offset, 10);
  const offset = Number.isInteger(offsetValue) && offsetValue > 0 ? Math.min(offsetValue, 10000) : 0;
  const rows = getPostsForUser(req.user.id, req.user.id, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(req.user.id).count;
  res.json({
    posts: rows.map(serializePost),
    hasMore: offset + rows.length < total,
    nextOffset: offset + rows.length,
  });
});

// HTTP PUT /api/profile (Tópico HTTP Methods: Reemplazo completo del recurso perfil)
app.put('/api/profile', requireAuth, (req, res) => {
  const name = cleanText(req.body && req.body.name, 80);
  const career = cleanText(req.body && req.body.career, 100);
  const avatar = req.body && Object.prototype.hasOwnProperty.call(req.body, 'avatar')
    ? (req.body.avatar || null)
    : null;

  if (name.length < 2) return validationError(res, 'El nombre debe tener al menos 2 caracteres.');
  if (!career) return validationError(res, 'La carrera es obligatoria en reemplazo total (PUT).');
  if (!isValidImage(avatar)) return validationError(res, 'La foto no es válida o supera 4 MB.');

  db.prepare('UPDATE users SET name = ?, career = ?, avatar = ? WHERE id = ?')
    .run(name, career, avatar, req.user.id);
  const user = getUserById(req.user.id);
  res.json({ user: publicUser(user), method: 'HTTP PUT (Reemplazo total completado)' });
});

// HTTP PATCH /api/profile (Tópico HTTP Methods: Modificación parcial del recurso perfil)
app.patch('/api/profile', requireAuth, (req, res) => {
  const name = cleanText(req.body && req.body.name, 80);
  const career = cleanText(req.body && req.body.career, 100) || 'Sin especificar';
  const avatar = req.body && Object.prototype.hasOwnProperty.call(req.body, 'avatar')
    ? (req.body.avatar || null)
    : req.user.avatar;

  if (name.length < 2) return validationError(res, 'El nombre debe tener al menos 2 caracteres.');
  if (!isValidImage(avatar)) return validationError(res, 'La foto no es válida o supera 4 MB.');

  db.prepare('UPDATE users SET name = ?, career = ?, avatar = ? WHERE id = ?')
    .run(name, career, avatar, req.user.id);
  const user = getUserById(req.user.id);
  res.json({ user: publicUser(user), method: 'HTTP PATCH (Modificación parcial completada)' });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT id, type, message, is_read, created_at
    FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  const unreadNotifications = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(req.user.id).count;
  res.json({ notifications: notifications.map(serializeNotification), unreadNotifications });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ============================================================================
// BÚSQUEDA, ASISTENTE IA, INSCRIPCIONES EN COLA, ML, CONTACTO Y ADMINISTRACIÓN
// ============================================================================
function userRoom(userId) {
  return `user:${userId}`;
}

function readSessionCookie(header) {
  const match = String(header || '').match(/(?:^|;\s*)prism_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Cada socket autenticado entra a su sala privada para recibir avisos personales.
io.use((socket, next) => {
  try {
    const token = readSessionCookie(socket.handshake.headers.cookie);
    if (token) {
      const row = db.prepare(`
        SELECT s.user_id FROM sessions s WHERE s.token_hash = ? AND s.expires_at > ?
      `).get(hashToken(token), now());
      if (row) {
        socket.data.userId = row.user_id;
        socket.join(userRoom(row.user_id));
      }
    }
  } catch (error) {
    console.warn('[Sockets] No se pudo asociar la sesión:', error.message);
  }
  next();
});

// --- Búsqueda (Algolia o SQLite) ------------------------------------------------
app.get('/api/search', requireAuth, searchRateLimit, asyncRoute(async (req, res) => {
  const q = cleanText(req.query.q, 100);
  const type = ['post', 'activity'].includes(req.query.type) ? req.query.type : 'all';
  res.json(await searchService.search(db, q, { type, limit: 20 }));
}));

// Conocimiento propio de PRISM: la guía de funciones se indexa para el asistente (y se actualiza sola).
async function seedAppGuide() {
  try {
    const guide = assistantService.appGuide();
    if (!guide) return;
    const hash = crypto.createHash('sha1').update(guide).digest('hex').slice(0, 8);
    const filename = `guia-prism-${hash}.md`;
    const existing = db.prepare("SELECT id, filename FROM knowledge_docs WHERE filename LIKE 'guia-prism-%'").all();
    if (existing.some((doc) => doc.filename === filename)) return;
    for (const doc of existing) await knowledgeService.deleteDocument(db, doc.id);
    await knowledgeService.addDocument(db, { title: 'Guía de PRISM', filename, text: guide, userId: null });
    console.log('[Asistente] Guía de PRISM indexada.');
  } catch (error) {
    console.warn('[Asistente] No se pudo indexar la guía:', error.message);
  }
}
seedAppGuide()
  .then(() => knowledgeService.syncToQdrant(db))
  .then((r) => { if (r.synced) console.log(`[Conocimiento] ${r.synced} documento(s) sincronizados con Qdrant.`); })
  .catch((error) => console.warn('[Conocimiento] Sincronización con Qdrant:', error.message));

// --- Asistente con respuesta progresiva (SSE) ------------------------------------
app.post('/api/asistente', requireAuth, assistantRateLimit, asyncRoute(async (req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  let answer = '';
  const send = (event) => {
    if (event.type === 'delta') answer += event.text;
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string');
  const question = cleanText(lastUser && lastUser.content, 500);
  let userContext = '';
  try { userContext = memoryService.contextFor(db, req.user); } catch (error) { console.warn('[Memoria]', error.message); }
  await assistantService.respond({ db, messages, send, signal: controller.signal, userContext });
  if (question && answer.trim() && !controller.signal.aborted) {
    try { send({ type: 'logged', id: memoryService.logExchange(db, { userId: req.user.id, question, answer }) }); }
    catch (error) { console.warn('[Memoria] no se pudo guardar el intercambio:', error.message); }
  }
  res.end();
}));

// Votos 👍/👎 por id de respuesta (el texto vive en el servidor). Lo valorado 👍 queda pendiente
// hasta que un administrador lo apruebe como conocimiento.
app.post('/api/asistente/feedback', requireAuth, rateLimit(60 * 1000, 40, 'feedback'), (req, res) => {
  const id = Number(req.body && req.body.id);
  const rating = Number(req.body && req.body.rating);
  if (!Number.isInteger(id) || ![1, -1, 0].includes(rating)) return validationError(res, 'Valoración no válida.');
  if (!memoryService.rate(db, { id, userId: req.user.id, rating })) return res.status(404).json({ error: 'No encontré esa respuesta.' });
  return res.json({ ok: true });
});

app.get('/api/asistente/memoria', requireAuth, (req, res) => {
  res.json({ memoria: memoryService.summary(db, req.user) });
});

app.delete('/api/asistente/memoria', requireAuth, (req, res) => {
  memoryService.forget(db, req.user.id);
  res.json({ ok: true });
});

app.get('/api/admin/aprendizaje', requireAdmin, (req, res) => {
  res.json(memoryService.report(db));
});

app.post('/api/admin/aprendizaje/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM assistant_logs WHERE id = ? AND rating = 1 AND approved = 0').get(id) : null;
  if (!row) return res.status(404).json({ error: 'Esa respuesta ya no está pendiente.' });
  if (req.body && req.body.action === 'aprobar') {
    await knowledgeService.addDocument(db, {
      title: `Aprendido: ${row.question.slice(0, 70)}`,
      filename: 'aprendido.md',
      text: `Pregunta: ${row.question}\nRespuesta: ${row.answer}`,
      userId: req.user.id,
    });
    db.prepare('UPDATE assistant_logs SET approved = 1 WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE assistant_logs SET approved = -1 WHERE id = ?').run(id);
  }
  res.json({ ok: true });
}));

// --- Inscripciones en cola (en_cola -> registrado) --------------------------------
function serializeEnrollment(row) {
  return {
    id: row.id,
    activityId: row.activity_id,
    activityTitle: row.title,
    status: row.status,
    detail: row.detail || null,
    createdAt: row.created_at,
  };
}

function getEnrollment(id) {
  return db.prepare(`
    SELECT e.*, a.title FROM enrollments e JOIN activities a ON a.id = e.activity_id WHERE e.id = ?
  `).get(id);
}

app.post('/api/inscripciones', requireAuth, enrollRateLimit, asyncRoute(async (req, res) => {
  const activityId = Number(req.body && req.body.activityId);
  if (!Number.isInteger(activityId)) return validationError(res, 'Actividad no válida.');
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activity) return res.status(404).json({ error: 'La actividad ya no existe.' });

  const member = db.prepare('SELECT 1 FROM activity_members WHERE activity_id = ? AND user_id = ?').get(activityId, req.user.id);
  if (member) return res.status(409).json({ error: 'Ya participas en esta actividad.' });
  const waiting = db.prepare("SELECT 1 FROM enrollments WHERE activity_id = ? AND user_id = ? AND status = 'en_cola'").get(activityId, req.user.id);
  if (waiting) return res.status(409).json({ error: 'Tu inscripción a esta actividad ya está en cola.' });
  const joined = db.prepare('SELECT COUNT(*) AS count FROM activity_members WHERE activity_id = ?').get(activityId).count;
  if (joined >= 1 + activity.people_needed) return res.status(409).json({ error: 'Esta actividad ya alcanzó el número de participantes.' });

  const stamp = now();
  const result = db.prepare(`
    INSERT INTO enrollments (activity_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'en_cola', ?, ?)
  `).run(activityId, req.user.id, stamp, stamp);
  const enrollmentId = Number(result.lastInsertRowid);

  const transport = await queueService.publish({ type: 'enrollment', enrollmentId });
  res.status(202).json({ inscripcion: serializeEnrollment(getEnrollment(enrollmentId)), cola: transport });
}));

app.get('/api/inscripciones/mias', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, a.title FROM enrollments e JOIN activities a ON a.id = e.activity_id
    WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 30
  `).all(req.user.id);
  res.json({ inscripciones: rows.map(serializeEnrollment) });
});

function finishEnrollment(row, status, detail) {
  db.prepare('UPDATE enrollments SET status = ?, detail = ?, updated_at = ? WHERE id = ?').run(status, detail || null, now(), row.id);
  io.to(userRoom(row.user_id)).emit('inscripcion:update', {
    id: row.id, activityId: row.activity_id, title: row.title, status, detail: detail || null,
  });
}

// Consumidor de la cola: corre en el mismo proceso que el servidor web.
async function processEnrollment(message) {
  if (!message || message.type !== 'enrollment') return;
  const row = getEnrollment(message.enrollmentId);
  if (!row || row.status !== 'en_cola') return;
  try {
    const outcome = runImmediate(() => {
      const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(row.activity_id);
      if (!activity) return { status: 'rechazado', detail: 'La actividad ya no existe.' };
      const already = db.prepare('SELECT 1 FROM activity_members WHERE activity_id = ? AND user_id = ?').get(row.activity_id, row.user_id);
      if (already) return { status: 'registrado', detail: 'Ya participabas en la actividad.' };
      const count = db.prepare('SELECT COUNT(*) AS count FROM activity_members WHERE activity_id = ?').get(row.activity_id).count;
      if (count >= 1 + activity.people_needed) return { status: 'rechazado', detail: 'La actividad ya alcanzó el número de participantes.' };
      db.prepare('INSERT INTO activity_members (activity_id, user_id, joined_at) VALUES (?, ?, ?)').run(row.activity_id, row.user_id, now());
      if (activity.owner_id !== row.user_id) {
        const person = getUserById(row.user_id);
        const text = `${person ? person.name : 'Un estudiante'} se conectó a “${activity.title}”.`;
        db.prepare("DELETE FROM notifications WHERE user_id = ? AND type = 'activity' AND message = ?").run(activity.owner_id, text);
        db.prepare("INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, 'activity', ?, ?)").run(activity.owner_id, text, now());
        return { status: 'registrado', notifyOwner: activity.owner_id };
      }
      return { status: 'registrado' };
    });

    finishEnrollment(row, outcome.status, outcome.detail);
    if (outcome.notifyOwner) io.to(userRoom(outcome.notifyOwner)).emit('notification:new', { type: 'activity' });
    await invalidateFeedCache();
  } catch (error) {
    if ((message.attempts || 1) >= 3) finishEnrollment(row, 'rechazado', 'No se pudo procesar la inscripción. Inténtalo de nuevo.');
    throw error;
  }
}
queueService.startConsumer(processEnrollment);

// --- Recomendaciones (ML: factorización de matrices) -------------------------------
app.get('/api/recomendaciones', requireAuth, (req, res) => {
  const limit = boundedLimit(req.query.limit, 4, 10);
  const interactions = db.prepare('SELECT user_id AS u, activity_id AS a FROM activity_members').all();
  const activities = db.prepare(`
    SELECT a.id, a.owner_id AS ownerId, a.category, a.event_date AS eventDate, a.people_needed,
           (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id) AS joined
    FROM activities a
  `).all().map((a) => ({ id: a.id, ownerId: a.ownerId, category: a.category, eventDate: a.eventDate, joined: a.joined, total: 1 + a.people_needed }));
  const ranked = mlService.recommendActivities({ userId: req.user.id, interactions, activities, limit });
  const recomendaciones = ranked
    .map((item) => ({ activity: getActivity(item.activityId, req.user.id), reason: item.reason, score: item.score }))
    .filter((item) => item.activity);
  res.json({ recomendaciones });
});

// --- Contacto con análisis de sentimiento (ML) ------------------------------------
app.post('/api/contacto', requireAuth, contactRateLimit, (req, res) => {
  const subject = cleanText(req.body && req.body.subject, 120);
  const message = cleanText(req.body && req.body.message, 1500);
  if (message.length < 10) return validationError(res, 'Escribe un mensaje de al menos 10 caracteres.');
  const verdict = mlService.analyzeSentiment(`${subject} ${message}`);
  db.prepare(`
    INSERT INTO contact_messages (user_id, subject, message, sentiment, probability, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, subject, message, verdict ? verdict.label : null, verdict ? verdict.probability : null, now());
  res.status(201).json({ ok: true, message: 'Mensaje enviado. ¡Gracias por escribirnos!' });
});

// --- Administración ---------------------------------------------------------------
app.get('/api/admin/estado', requireAdmin, asyncRoute(async (req, res) => {
  const ping = await redis.ping();
  const queue = queueService.status();
  const documents = knowledgeService.listDocuments(db).length;
  const servicios = [
    { nombre: databaseMode === 'turso' ? 'Base de datos (Turso)' : 'Base de datos (SQLite local)', activo: databaseMode === 'turso', detalle: databaseMode === 'turso' ? 'Datos persistentes en Turso' : 'Archivo local: se borra en cada reinicio de Render' },
    { nombre: 'Redis (Upstash)', activo: redis.isConfigured() && ping.ok !== false, detalle: redis.isConfigured() ? `Caché del feed · ${ping.latencyMs ?? '—'} ms` : 'Sin configurar: caché en memoria' },
    { nombre: 'Búsqueda (Algolia)', activo: searchService.isConfigured(), detalle: searchService.isConfigured() ? 'Índice de publicaciones y actividades' : 'Sin configurar: se busca directamente en SQLite' },
    { nombre: 'Asistente (Groq)', activo: assistantService.isConfigured(), detalle: assistantService.isConfigured() ? 'Respuestas redactadas por IA con herramientas' : 'Sin GROQ_API_KEY: modo básico de recuperación' },
    { nombre: 'Conocimiento (Qdrant)', activo: knowledgeService.isQdrantConfigured(), detalle: `${documents} documento(s) · embeddings: ${knowledgeService.embeddingsMode()}` },
    { nombre: 'Cola de inscripciones (CloudAMQP)', activo: queue.mode === 'cloudamqp', detalle: queue.lastError ? `Error: ${queue.lastError}` : `Modo ${queue.mode} · cola ${queue.queue}` },
    { nombre: 'Notificaciones en vivo (Socket.IO)', activo: true, detalle: `${io.engine.clientsCount} cliente(s) conectado(s)` },
    { nombre: 'Machine Learning', activo: true, detalle: 'Sentimiento (Naive Bayes) y recomendaciones (factorización de matrices)' },
  ];
  res.json({ servicios });
}));

app.get('/api/admin/conocimiento', requireAdmin, (req, res) => {
  res.json({ documentos: knowledgeService.listDocuments(db) });
});

app.post('/api/admin/conocimiento', requireAdmin, asyncRoute(async (req, res) => {
  const filename = cleanText(req.body && req.body.filename, 200);
  const contentBase64 = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
  if (!filename || !contentBase64) return validationError(res, 'Selecciona un archivo para subir.');
  const buffer = Buffer.from(contentBase64, 'base64');
  const text = documentsService.extractText(filename, buffer);
  const title = cleanText(req.body.title, 120) || filename.replace(/\.[^.]+$/, '');
  const documento = await knowledgeService.addDocument(db, { title, filename, text, userId: req.user.id });
  res.status(201).json({ documento });
}));

app.delete('/api/admin/conocimiento/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return validationError(res, 'Documento no válido.');
  const removed = await knowledgeService.deleteDocument(db, id);
  if (!removed) return res.status(404).json({ error: 'El documento ya no existe.' });
  res.json({ ok: true });
}));

app.post('/api/admin/search/sync', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await searchService.syncAll(db));
}));

app.get('/api/admin/reportes', requireAdmin, (req, res) => {
  const counts = db.prepare("SELECT sentiment, COUNT(*) AS n FROM contact_messages GROUP BY sentiment").all();
  const summary = { total: 0, positivo: 0, neutral: 0, negativo: 0 };
  for (const row of counts) {
    summary.total += row.n;
    if (row.sentiment in summary) summary[row.sentiment] += row.n;
  }
  const porDia = db.prepare(`
    SELECT substr(created_at, 1, 10) AS date,
           COALESCE(SUM(sentiment = 'positivo'), 0) AS positivo,
           COALESCE(SUM(sentiment = 'neutral'), 0) AS neutral,
           COALESCE(SUM(sentiment = 'negativo'), 0) AS negativo
    FROM contact_messages GROUP BY date ORDER BY date DESC LIMIT 14
  `).all();
  const mensajes = db.prepare(`
    SELECT c.subject, c.message, c.sentiment, c.probability, c.created_at AS createdAt, u.name AS author
    FROM contact_messages c LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC LIMIT 50
  `).all();
  res.json({ summary, porDia, mensajes });
});

// Keep the repository files usable as a single Render web service without
// exposing the SQLite file or the Node entry point as public assets.
app.use((req, res, next) => {
  if (/^\/(?:\.git|data|node_modules|services|scripts|ml)(?:\/|$)/i.test(req.path) || /^\/(?:server\.js|package(?:-lock)?\.json|requirements\.txt|\.env)/i.test(req.path)) {
    return res.status(404).end();
  }
  return next();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(ROOT, 'sw.js'));
});
app.use(express.static(ROOT, { index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && (error.status === 400 || error.type === 'entity.parse.failed')) {
    return res.status(400).json({ error: 'El servidor recibió datos inválidos.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Inténtalo de nuevo.' });
});

const cleanupTask = db.transaction(() => {
  const currentTime = now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(currentTime);
  db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(currentTime);
  db.prepare('DELETE FROM notifications WHERE created_at <= ?').run(new Date(Date.now() - 90 * 86400000).toISOString());
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= Date.now()) rateBuckets.delete(key);
  }
});
function runCleanup() {
  try {
    cleanupTask();
  } catch (error) {
    console.error('No se pudo ejecutar la limpieza periódica:', error.message);
  }
}
runCleanup();
setInterval(runCleanup, 60 * 60 * 1000).unref();

// ============================================================================
// WEBSOCKETS (SOCKET.IO) - GESTIÓN DE TIEMPO REAL: CHAT Y PRESENCIA DE ALUMNOS
// ============================================================================
const connectedStudents = new Map();

io.on('connection', (socket) => {
  let student = {
    id: `estudiante-${socket.id.slice(0, 5)}`,
    name: 'Estudiante USMP',
    career: 'Filial Sur',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80&q=70',
  };
  connectedStudents.set(socket.id, student);

  function broadcastPresence() {
    io.emit('presence:update', {
      onlineCount: Math.max(connectedStudents.size, 1),
      students: Array.from(connectedStudents.values()).slice(0, 10),
    });
  }

  broadcastPresence();

  socket.on('user:identify', (data) => {
    if (data && data.name) {
      student = {
        id: data.id || student.id,
        name: data.name,
        career: data.career || 'USMP Arequipa',
        avatar: data.avatar || student.avatar,
      };
      connectedStudents.set(socket.id, student);
      broadcastPresence();
    }
  });

  socket.on('chat:get_history', () => {
    const history = db.prepare(`
      SELECT id, user_name AS u, message AS t, user_avatar AS img, created_at,
             strftime('%H:%M', created_at) AS h
      FROM chat_messages
      ORDER BY id DESC
      LIMIT 40
    `).all().reverse();

    socket.emit('chat:history', history);
  });

  socket.on('chat:send', (data) => {
    const text = cleanText(data && data.text, 500);
    if (!text) return;

    const senderName = (data.user && data.user.name) || student.name;
    const senderCareer = (data.user && data.user.career) || student.career;
    const senderAvatar = (data.user && data.user.avatar) || student.avatar;
    const createdAt = now();
    const timeFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const result = db.prepare(`
      INSERT INTO chat_messages (user_name, user_career, user_avatar, message, room, created_at)
      VALUES (?, ?, ?, ?, 'global', ?)
    `).run(senderName, senderCareer, senderAvatar, text, createdAt);

    const messagePayload = {
      id: result.lastInsertRowid,
      u: senderName,
      t: text,
      h: timeFormatted,
      img: senderAvatar,
    };

    io.emit('chat:message', messagePayload);
  });

  socket.on('disconnect', () => {
    connectedStudents.delete(socket.id);
    broadcastPresence();
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`PRISM escuchando en http://${HOST}:${PORT} (WebSockets Socket.io habilitados)`);
  });
}

module.exports = { app, server, io };

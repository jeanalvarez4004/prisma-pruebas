# 🔮 PRISM — Red Social Universitaria USMP 


[![Render Deploy](https://img.shields.io/badge/Render-Live%20App-00ff88?style=for-the-badge&logo=render&logoColor=white)](https://prismaa.onrender.com/)
[![Figma Prototype](https://img.shields.io/badge/Figma-Prototipo%201%3A1-F24E1E?style=for-the-badge&logo=figma&logoColor=white)]()
[![GitHub Repository](https://img.shields.io/badge/GitHub-Diogojuve%2Fprisma-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Diogojuve/prisma)

---

##  Enlaces

- **RENDER URL (App en vivo):** [https://prismaa.onrender.com/](https://prismaa.onrender.com/)
- **FIGMA URL (Prototipo UI/UX):** []
- **CÓDIGO URL (GitHub):** [https://github.com/Diogojuve/prisma](https://github.com/Diogojuve/prisma)

---

##  Flujo de Ramas en GitHub (`Git Flow`)

Para cumplir con la exigencia docente de desarrollo modular por ramas de características, el repositorio cuenta con las siguientes ramas temáticas:

| Rama | Descripción del Módulo | Estado |
| :--- | :--- | :--- |
| **`main`** | Versión de producción unificada con despliegue continuo en Render. | ✅ En producción |
| **`feature/rediseño-ui-figma`** | Rediseño de UI fiel al prototipo Figma (Dark Wine `#0e0207` & Neón `#ff2e63`), PWA móvil, Service Worker v12 y avatares 1:1. | ✅ Fusionado |
| **`feature/redis-cache-upstash`** | Integración de Upstash Redis (Cache-Aside en `/api/feed`), invalidación atómica de versión, HTTP HEAD/OPTIONS/PUT/DELETE, Temp Data (Flash) y View Data. | ✅ Fusionado |
| **`feature/websockets-socketio`** | Servidor y cliente Socket.IO en tiempo real: Chat global del campus, presencia de alumnos conectados en vivo y notificaciones reactivas. | ✅ Fusionado |

---

## 🎓 Cobertura de los 10 Tópicos Evaluados

| # | Tópico Académico | Implementación en PRISM | Archivos Clave |
| :-: | :--- | :--- | :--- |
| **1** | **Base de Datos** | SQLite 3 en modo **WAL** (`data/prisma.sqlite`), transacciones ACID, claves foráneas activas, tablas relacionales (`users`, `posts`, `post_likes`, `chat_messages`, `stories`, `notifications`) y script de siembra automática. | `server.js`, `scripts/seed.js` |
| **2** | **HTTP Methods** | Implementación estricta de métodos RESTful: `GET` (con caché), `POST` (con invalidación de caché), `PUT` (reemplazo completo de perfil), `PATCH` (modificación parcial), `DELETE` (eliminación de posts/historias), `HEAD` (verificación rápida en `/api/health` sin cuerpo) y `OPTIONS` (`Allow: GET, POST, DELETE, OPTIONS, HEAD` en `/api/posts`). | `server.js` |
| **3** | **Aplicaciones Web / PWA** | Web App Progresiva instalable con soporte offline, Service Worker (`sw.js` v12) con estrategia Cache-First/Network-Fallback, `manifest.webmanifest` y diseño adaptativo mobile-first. | `sw.js`, `manifest.webmanifest`, `styles.css` |
| **4** | **Sesiones** | Generación de tokens criptográficos de 256 bits (`crypto.randomBytes(32)`), persistidos en BD y sincronizados en caché distribuida. Middleware de autenticación y renovación automática. | `server.js` (`createSession`, `requireAuth`) |
| **5** | **Cookies** | Cookie de sesión `prism_session` protegida contra XSS y CSRF mediante banderas `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (en producción) y tiempo de vida configurable. | `server.js` |
| **6** | **Temp Data (Flash)** | Mensajes efímeros de consumo destructivo único (Flash notifications) almacenados en Redis / sesión temporal con TTL de 60s mediante endpoints `/api/temp-data`. | `server.js`, `redis-client.js` |
| **7** | **View Data** | Endpoint `/api/view-data` que provee datos y metadatos estructurados del campus universitario (periodo 2026-I, facultades, estado de infraestructura) para inicialización de vistas. | `server.js` (`/api/view-data`) |
| **8** | **Redis** | Integración con **Upstash Redis Cloud** mediante REST API: Caché de alto rendimiento para el feed con cabeceras `X-Cache: HIT` / `X-Cache: MISS`, invalidación atómica por versionado (`prism:feed:ver`) y métricas en `/api/redis/stats`. | `redis-client.js`, `server.js` |
| **9** | **APIs** | API RESTful estandarizada bajo `/api/*` con respuestas estructuradas en JSON, control de errores HTTP semánticos (200, 201, 204, 400, 401, 403, 404, 429), Rate Limiting por IP/usuario y sanitización contra inyecciones. | `server.js` |
| **10** | **WebSockets** | Conexión bidireccional en tiempo real con **Socket.IO**: Chat general del campus, historial persistente, presencia y contador de estudiantes conectados, y difusión de notificaciones al publicar. | `server.js`, `app.js`, `scripts/test-sockets.js` |

---

## 🧩 Servicios de la arquitectura de referencia (equivalencias)

PRISM replica los flujos de la solución de referencia (tienda "Mundo Mascota"), cambiando el dominio: **producto → actividad**, **pedido → inscripción**. Cada servicio externo es opcional: si no está configurado, se usa un respaldo local y el estado se ve en **Administración → Servicios**.

| Capacidad (referencia) | En PRISM | Servicio externo (opcional) | Respaldo local | Archivos |
| :--- | :--- | :--- | :--- | :--- |
| Catálogo + caché | Feed de publicaciones y actividades | Redis (Upstash) | Memoria | `redis-client.js`, `server.js` |
| Búsqueda de productos | **Buscar** (publicaciones y actividades) | Algolia | Filtro en SQLite | `services/search.js` |
| Pedido asíncrono | **Unirme** → `en_cola` → `registrado` | CloudAMQP (RabbitMQ) | Cola en memoria | `services/queue.js` |
| Notificación al navegador | Aviso en vivo de la inscripción | Socket.IO (equivale a PieSocket) | — | `server.js`, `features.js` |
| Asistente con fuentes | **Asistente IA** (streaming, fuentes y fichas) | Groq + Qdrant | Recuperación local en SQLite | `services/assistant.js`, `services/knowledge.js` |
| Tipo de cambio | Herramienta del asistente | Frankfurter | — | `services/assistant.js` |
| ML.NET sentimiento | **Contacto** clasifica el mensaje (Naive Bayes) | — | — | `services/ml.js`, `ml/sentimiento.csv` |
| ML.NET recomendaciones | **Recomendado para ti** (factorización de matrices) | — | — | `services/ml.js` |
| Administración | Panel: servicios, documentos, índice, reportes | — | — | `features.js`, `server.js` |

### Variables de entorno
Ver `.env.example`. Para tener el panel de **Administración** define `ADMIN_EMAILS` con tu correo (luego inicia sesión con esa cuenta). En Render configura las claves como variables de entorno (`render.yaml` ya las declara).

### Probar
```bash
npm run test:ml   # sentimiento y recomendaciones
npm run check     # sintaxis de server.js, app.js, features.js y sw.js
```
Documento de ejemplo para el asistente: `docs-ejemplo/reglamento-ejemplo.md` (súbelo en Administración → Conocimiento).

---

## 🚀 Ejecución y Pruebas Locales

### 1. Clonar e instalar dependencias
```bash
git clone https://github.com/Diogojuve/prisma.git
cd prisma
npm install
```

### 2. Sembrar datos iniciales (Usuarios, posts y chat del campus)
```bash
npm run seed
```

### 3. Probar WebSockets en tiempo real
```bash
npm run test:sockets
```

### 4. Iniciar servidor local
```bash
npm start
# o en modo desarrollo:
npm run dev
```

Abre tu navegador en `http://localhost:3000`.

---

## 👥 Equipo de Desarrollo

- **Proyecto:** PRISM (Plataforma de Red e Interacción Social para la USMP)
- **Curso:** Programacion I
- **Sede:** USMP Filial Sur, Arequipa - 2026

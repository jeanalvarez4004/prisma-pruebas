# 🔮 PRISM — Red Social Universitaria USMP

[![Render Deploy](https://img.shields.io/badge/Render-Pruebas%20Live-00ff88?style=for-the-badge&logo=render&logoColor=white)](https://prisma-pruebas-99uj.onrender.com)
[![GitHub Repository](https://img.shields.io/badge/GitHub-jeanalvarez4004%2Fprisma--pruebas-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/jeanalvarez4004/prisma-pruebas)
[![Figma Prototype](https://img.shields.io/badge/Figma-Prototipo%201%3A1-F24E1E?style=for-the-badge&logo=figma&logoColor=white)]()

---

## 📌 Enlaces del Proyecto

- **App en vivo (Copia de Pruebas Render):** [https://prisma-pruebas-99uj.onrender.com](https://prisma-pruebas-99uj.onrender.com)
- **Repositorio de Pruebas:** [https://github.com/jeanalvarez4004/prisma-pruebas](https://github.com/jeanalvarez4004/prisma-pruebas)
- **Repositorio Original:** [https://github.com/Diogojuve/prisma](https://github.com/Diogojuve/prisma) *(conservado intacto)*
- **Servicio Original Render:** `prismaa` *(conservado intacto)*

---

## 📖 Resumen y Contexto del Proyecto

**PRISM** es la red social universitaria desarrollada para la **USMP Filial Sur (Arequipa)**. Esta copia de pruebas implementa la totalidad de los servicios requeridos basados en el proyecto de referencia docente (*"Mundo Mascota"*), aplicando la adaptación de dominio correspondiente:

$$\text{Producto} \longrightarrow \text{Actividad} \qquad\mid\qquad \text{Pedido} \longrightarrow \text{Inscripción}$$

Todos los módulos han sido verificados en el entorno de pruebas `prisma-pruebas` sin afectar la versión base original.

---

## 🧩 Requisitos y Estado de Componentes (12 Módulos)

De los 12 componentes de la arquitectura, **todos se encuentran activos**. La cola de inscripciones (CloudAMQP) se retiró: las inscripciones ahora se procesan al instante.

| # | Requisito | Estado | Dónde está | Cómo se implementó |
| :-: | :--- | :---: | :--- | :--- |
| **1** | **Render** | ✅ Activo | Servicio `prisma-pruebas`, `render.yaml` | Despliegue continuo desde GitHub mediante `npm ci` y `npm start`. Gestión segura de credenciales vía variables de entorno. |
| **2** | **Base de Datos (SQLite + Turso)** | ✅ Activo | `server.js` (`openDatabase()`), `data/prisma.sqlite` | SQLite 3 local sincronizada con **Turso** mediante `@libsql/client`, garantizando persistencia ante reinicios del contenedor en Render. |
| **3** | **Login y Sesiones** | ✅ Activo | `server.js` (`/api/auth/register`, `/login`, `/logout`) | Hash seguro de contraseñas, cookie `prism_session` (`httpOnly`, `sameSite: 'lax'`) y validación estricta de registro exclusivo para dominios `@usmp.pe`. |
| **4** | **Redis (Upstash)** | ⚡ Conectado | `redis-client.js`, `server.js` (`/api/feed`) | Estrategia Cache-Aside en Upstash Redis Cloud vía REST API con invalidación atómica de versión (`prism:feed:ver`). Si falla, activa failover automático a SQLite. |
| **5** | **Algolia** | ✅ Activo | `services/search.js`, `/api/search` | Sincronización automática del índice `prism_contenido` al arrancar. Búsqueda instantánea de publicaciones y actividades (fallback a SQL si no está configurado). |
| **6** | **IA / LLM** | ✅ Activo | `services/assistant.js`, `/api/asistente` | Integración con **Groq** (`openai/gpt-oss-120b`) con streaming en tiempo real y function calling / tools (`buscar_conocimiento`, `consultar_actividades`, `clima_actual`). |
| **7** | **Base Vectorial (Qdrant)** | ✅ Activo | `services/knowledge.js` | Indexación de embeddings vectoriales en **Qdrant Cloud** para búsqueda semántica del reglamento y guías, con respaldo relacional en SQLite. |
| **8** | **Aprendizaje de la IA** | ✅ Activo | `services/memory.js`, `/api/asistente/feedback`, `/memoria` | Registro de preguntas, memoria contextual por estudiante, retroalimentación con votos 👍/👎 y panel de aprobación docente (*Enseñar*) antes de convertirlo en conocimiento. |
| **9** | **Machine Learning** | ✅ Activo | `services/ml.js`, `ml/sentimiento.csv` | Clasificador Naive Bayes entrenado en frío para análisis de sentimiento en formulario de Contacto, y recomendador de actividades basado en factorización de matrices. |
| **10** | **Tiempo Real (WebSockets)** | ✅ Activo | `server.js`, `app.js` (Socket.IO) | Conexión bidireccional Socket.IO autenticada por sesión, con salas individuales (`user:<id>`), chat en vivo del campus y notificaciones push reactivas. |
| **11** | **Ramas en GitHub** | ✅ Hecho | Repositorio GitHub | Implementación de Git Flow con rama `main` y múltiples ramas `feature/*` temáticas. |
| **12** | **Panel de Administración** | ✅ Hecho | `features.js`, `/api/admin/*` | Monitor en vivo de estado de servicios externos, carga de conocimiento RAG, sincronización de Algolia, reporte ML y moderación de aprendizaje. |

---

## 🔍 Detalle Técnico por Componente y Resiliencia (Failover)

Cada servicio externo está diseñado con **tolerancia a fallos**: si no existen credenciales o la API externa no responde, la aplicación degrada suavemente a una alternativa local sin interrumpir la experiencia de usuario:

* **Base de datos y persistencia:**  
  `openDatabase()` inicializa SQLite. Si se definen `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`, sincroniza réplicas embebidas con Turso. El registro restringe la creación de cuentas a correos institucionales `@usmp.pe`, protegiendo la integridad del campus.
* **Caché distribuida (Upstash Redis):**  
  `redis-client.js` consume los endpoints REST con `UPSTASH_REDIS_REST_URL`. La cabecera HTTP `X-Cache: HIT` o `X-Cache: MISS` audita cada petición al feed. En caso de corte, la consola reporta `[Redis Failover]` y consulta SQLite de forma transparente.
* **Búsqueda e indexación (Algolia):**  
  Al iniciar el servidor se auto-sincronizan los registros en el índice `prism_contenido`. Ante la ausencia de llaves administrativas, el motor conmuta automáticamente a consultas `LIKE` indexadas sobre SQLite.
* **Asistente Inteligente (Groq + RAG):**  
  El asistente consulta `docs-ejemplo/guia-prism.md` mediante RAG. Si la API de Groq presenta latencia o caída, el asistente responde en modo de contingencia estructurada.
* **Memoria y Aprendizaje supervisado:**  
  Las respuestas con 👍 entran a una bandeja de espera en *Administración → Aprendizaje*. Ningún dato entra al contexto permanente sin la aprobación explícita del docente/administrador.
* **Diseño e Interfaz v2:**  
  Paleta institucional Dark Wine / Carmesí y Blanco, tipografía editorial de alto impacto, iconos SVG puros, acceso en dos paneles y diseño responsive optimizado para dispositivos móviles en [styles.css](file:///c:/Users/User/Documents/Gemini%20cli%20proyects/AminiApps/prisma-pruebas/styles.css).

---

## 🎯 Guía Paso a Paso para la Presentación / Sustentación

Para demostrar la funcionalidad ante el docente durante la evaluación, seguir esta secuencia:

1. **Despliegue Render:** Abrir el panel de Render del servicio `prisma-pruebas` y verificar el estado *Live* con build automático por commit.
2. **Validación de Login:** Intentar crear un usuario con `@gmail.com` (debe ser rechazado por la validación institucional) y luego registrarse con `@usmp.pe`.
3. **Caché Redis en Vivo:** Realizar dos peticiones al feed. Inspeccionar la consola de red del navegador (F12) para constatar la transición de `X-Cache: MISS` a `X-Cache: HIT`, y verificar las claves creadas en el *Data Browser* de Upstash.
4. **Búsqueda Algolia:** Ingresar un término en el buscador global y mostrar la coincidencia inmediata en el índice `prism_contenido` de Algolia.
5. **Asistente IA y Vectores:** Formular la pregunta *"¿Cómo me inscribo a una actividad?"* en el chat y mostrar la recuperación del fragmento vectorial en la colección de Qdrant Cloud.
6. **Aprendizaje Supervisado:** Calificar con 👍 una respuesta del asistente, acceder a *Administración → Aprendizaje* y pulsar **"Enseñar"** para incorporarla a la base de conocimiento.
7. **Machine Learning:** Enviar una consulta en el módulo de *Contacto* y visualizar la clasificación de sentimiento (Positivo / Neutro / Negativo) en los reportes de administración.
8. **Ramas y Git Flow:** Proyectar la vista de ramas y el gráfico interactivo de *Insights > Network* en GitHub.

---

## 🌿 Flujo de Ramas en GitHub (`Git Flow`)

| Rama | Propósito y Módulo | Estado |
| :--- | :--- | :---: |
| **`main`** | Versión principal de producción con despliegue continuo en Render. | ✅ Producción |
| **`feature/servicios-ia-cola-ml`** | Integración de IA con Groq, Qdrant, búsqueda Algolia y modelos ML. | ✅ Integrado |
| **`feature/redis-cache-upstash`** | Implementación de caché REST con Upstash, cabeceras HTTP y versionado. | ✅ Integrado |
| **`feature/websockets-socketio`** | Servidor Socket.IO, chat del campus y presencia multiusuario. | ✅ Integrado |
| **`feature/rediseño-ui-figma`** | Adaptación del prototipo Figma a interfaz web PWA. | ✅ Integrado |
| **`feature/white-design`** | Estilos visuales complementarios y temas de interfaz. | ✅ Integrado |
| **`docs/guia-implementacion-prism`** | Guía exhaustiva de arquitectura, estado de módulos y pauta de sustentación. | 🚀 Activa |

---

## 🎓 Cobertura de los 10 Tópicos Académicos Evaluados

| # | Tópico Académico | Implementación en PRISM | Archivos Clave |
| :-: | :--- | :--- | :--- |
| **1** | **Base de Datos** | SQLite 3 en modo **WAL** (`data/prisma.sqlite`), transacciones ACID, claves foráneas activas, tablas relacionales (`users`, `posts`, `post_likes`, `chat_messages`, `stories`, `notifications`) y réplica Turso. | `server.js`, `scripts/seed.js` |
| **2** | **HTTP Methods** | Implementación estricta de métodos RESTful: `GET` (con caché), `POST` (con invalidación de caché), `PUT` (reemplazo completo de perfil), `PATCH` (modificación parcial), `DELETE` (eliminación de posts/historias), `HEAD` (`/api/health`) y `OPTIONS` (`/api/posts`). | `server.js` |
| **3** | **Aplicaciones Web / PWA** | Web App Progresiva instalable con soporte offline, Service Worker (`sw.js` v12) con estrategia Cache-First/Network-Fallback, `manifest.webmanifest` y diseño adaptativo mobile-first. | `sw.js`, `manifest.webmanifest`, `styles.css` |
| **4** | **Sesiones** | Generación de tokens criptográficos de 256 bits (`crypto.randomBytes(32)`), persistidos en BD y sincronizados en caché distribuida. Middleware de autenticación y renovación automática. | `server.js` (`createSession`, `requireAuth`) |
| **5** | **Cookies** | Cookie de sesión `prism_session` protegida contra XSS y CSRF mediante banderas `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (en producción) y tiempo de vida configurable. | `server.js` |
| **6** | **Temp Data (Flash)** | Mensajes efímeros de consumo destructivo único (Flash notifications) almacenados en Redis / sesión temporal con TTL de 60s mediante endpoints `/api/temp-data`. | `server.js`, `redis-client.js` |
| **7** | **View Data** | Endpoint `/api/view-data` que provee datos y metadatos estructurados del campus universitario (periodo 2026-I, facultades, estado de infraestructura) para inicialización de vistas. | `server.js` (`/api/view-data`) |
| **8** | **Redis** | Integración con **Upstash Redis Cloud** mediante REST API: Caché de alto rendimiento para el feed con cabeceras `X-Cache: HIT` / `X-Cache: MISS`, invalidación atómica por versionado (`prism:feed:ver`) y métricas en `/api/redis/stats`. | `redis-client.js`, `server.js` |
| **9** | **APIs** | API RESTful estandarizada bajo `/api/*` con respuestas estructuradas en JSON, control de errores HTTP semánticos (200, 201, 204, 400, 401, 403, 404, 429), Rate Limiting por IP/usuario y sanitización contra inyecciones. | `server.js` |
| **10** | **WebSockets** | Conexión bidireccional en tiempo real con **Socket.IO**: Chat general del campus, historial persistente, presencia y contador de estudiantes conectados, y difusión de notificaciones al publicar. | `server.js`, `app.js`, `scripts/test-sockets.js` |

---

## 🚀 Ejecución y Pruebas Locales

### 1. Clonar e instalar dependencias
```bash
git clone https://github.com/jeanalvarez4004/prisma-pruebas.git
cd prisma-pruebas
npm install
```

### 2. Sembrar datos iniciales (Usuarios, posts y chat del campus)
```bash
npm run seed
```

### 3. Ejecutar pruebas automatizadas
```bash
npm run check       # Valida sintaxis de server.js, app.js, features.js y sw.js
npm run test:ml     # Evalúa clasificador de sentimiento y matriz de recomendación
npm run test:sockets # Prueba conectividad y difusión de eventos Socket.IO
```

### 4. Iniciar servidor local
```bash
npm start
# o en modo desarrollo con recarga:
npm run dev
```
Abre tu navegador en `http://localhost:3000`.

---

## ⚠️ Advertencias y Pendientes de Entrega

* **Comprobación de Redis:** Abrir el feed en el despliegue y verificar que Upstash almacene las claves de caché.
* **Configuración del Administrador:** Definir la variable de entorno `ADMIN_EMAILS` en Render con el correo del evaluador para habilitar el panel de administración.
* **Modelo LLM:** Groq no se re-entrena en el servidor; el aprendizaje se inyecta dinámicamente en tiempo de ejecución a través de fragmentos RAG aprobados.
* **Validación de Correo:** La verificación valida el dominio `@usmp.pe`; para producción plena se contempla validación mediante enlace SMTP transaccional.

---

## 👥 Equipo de Desarrollo

- **Proyecto:** PRISM (Plataforma de Red e Interacción Social para la USMP)
- **Curso:** Programación Web / Desarrollo de Aplicaciones
- **Sede:** USMP Filial Sur, Arequipa — 2026

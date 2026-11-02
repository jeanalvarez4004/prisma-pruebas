# 🏛️ PRISM — PLAN MAESTRO DE INGENIERÍA Y DISTRIBUCIÓN INTEGRAL

> **Proyecto:** Red Social Universitaria USMP Filial Sur (Arequipa)  
> **Arquitectura base:** Basado en [`pris.md`](./pris.md) (React PWA, Node.js en Docker/Render, Supabase + PostGIS, Upstash Redis y Resend)  
> **Metodología:** Scrumban / Kanban con GitHub Projects  
> **Equipo:** 3 Desarrolladores asistidos por IA  

---

## 🌟 1. LOS 5 PILARES FUNDAMENTALES DE PRISM (TODOS AL MISMO NIVEL)

PRISM no es solo un mapa ni solo un chat; es un **ecosistema universitario completo** con 5 pilares de igual jerarquía:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ECOSISTEMA PRISM USMP                             │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│  📰 PILAR 1  │  💬 PILAR 2  │  🎲 PILAR 3  │  🏪 PILAR 4  │   🛡️ PILAR 5    │
│  Feed Social │  Chat en     │  Randomly    │  Negocios    │   Identidad,    │
│  e Historias │  Tiempo Real │  (Speed-Chat │  del Campus  │   Auth USMP     │
│  del Campus  │  Global USMP │   de 2 min)  │  (PostGIS)   │   y Perfil      │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘
```

1. **Pilar Social (Feed & Historias):** Vida universitaria, dudas de clases, historias efímeras, confesiones, eventos y tendencias (#ExamenesFinales, #ProyectoGrupal).
2. **Pilar Comunicación (Chat Global):** Canal instantáneo abierto entre facultades con presencia online en vivo.
3. **Pilar Lúdico (Randomly):** Dinámica de emparejamiento aleatorio con filtro de facultad/carrera y reloj estricto de 2 minutos.
4. **Pilar Comercial (Negocios del Campus):** Directorio geolocalizado de locales cercanos (comidas, fotocopias, dulces, ropa) con distancias en metros y pedido por WhatsApp.
5. **Pilar Identidad & Plataforma (Auth & Perfil):** Seguridad institucional exclusiva `@usmp.pe`, tokens JWT, perfiles de alumnos y app PWA instalable.

---

## 🤝 2. PROTOCOLO DE TRABAJO EN EQUIPO

* **Separación física de código:**
  * `frontend/` ➔ Propiedad exclusiva del **Integrante 1**.
  * `backend/` ➔ Propiedad exclusiva del **Integrante 2**.
  * `database/` (SQL, scripts de Auth y PostGIS) ➔ Propiedad exclusiva del **Integrante 3**.
* **Convención de Git:**
  * Crear ramas por tarea: `feature/T1.2-feed-social`, `feature/T2.3-randomly-redis`, `feature/T3.1-auth-resend`.
  * Los Pull Requests deben vincular el número de issue: `Closes #12`.
* **Uso con Inteligencia Artificial:** Cada desarrollador copia el contexto de su tarea junto a [`pris.md`](./pris.md) a su asistente de IA (Cursor / Claude / ChatGPT) para generar implementaciones limpias y compatibles.

---

# 👥 3. ESPECIFICACIÓN DETALLADA DE TAREAS POR INTEGRANTE

---

## 🎨 INTEGRANTE 1: Frontend Lead & Diseñador PWA
> **Misión:** Toda la experiencia visual, interactividad en el teléfono, estados reactivos y experiencia PWA instalable.  
> **Tecnologías:** Vite, React, CSS Modules / Tailwind, PWA Service Worker, WebSockets Client, Browser Geolocation API.  
> **Directorio:** `/frontend`

---

### T1.1 — Arquitectura Base PWA y Shell Móvil
* **Descripción:** Montar el proyecto React con Vite configurado como Progressive Web App (PWA).
* **Entregables técnicos:**
  * `manifest.webmanifest` completo (iconos 192px/512px, tema `#160609`, modo `standalone`, orientación vertical).
  * `sw.js` con estrategia *Stale-While-Revalidate* para la interfaz gráfica (la app debe abrir instantáneamente sin conexión).
  * Soporte para iOS y Android con *Safe Area Insets* (evitar que el notch o la barra de gestos tapen botones).
  * Shell responsive: Barra de navegación fija (*sticky*) superior en móvil, barra inferior (*tabbar*) con etiquetas e indicadores de badge, y sidebar lateral para monitores grandes (>900px).
* **Criterio de Aceptación:** La app pasa la auditoría de Lighthouse PWA con 100% y se instala como app en el escritorio/celular.
* **Prompt sugerido para su IA:**  
  > *"Actúa como Senior Frontend Engineer. Lee pris.md y configura un proyecto Vite + React con PWA nativa, meta tags de iOS/Android (viewport-fit=cover, theme-color #160609) y un layout responsive con Tabbar inferior ergonómica de 52px con active states."*

---

### T1.2 — Pilar Social: Feed de Inicio, Historias y Tendencias
* **Descripción:** Construir la interfaz de la vida universitaria con historias, creador de publicaciones y filtros temáticos.
* **Entregables técnicos:**
  * **Historias:** Carrusel horizontal con desplazamiento magnético (*scroll-snap*), aro de gradiente neón en historias no leídas y modal para visualizar historias a pantalla completa.
  * **Compositor de publicaciones:** Input expandible con selector de categoría (*General, Académico, Eventos, Confesiones*), botón para adjuntar imagen (preview local) y contador de caracteres.
  * **Tarjetas de Post:** Componente con avatar, nombre, insignia de carrera, tiempo transcurrido (*"hace 15m"*), botón de like con animación de rebote y contador en vivo, comentarios y botón compartir.
  * **Sidebar de tendencias:** Lista de hashtags (#ExamenesFinales, etc.) y contador de alumnos conectados en el campus.
* **Criterio de Aceptación:** Se pueden crear posts localmente, filtrar por categorías y reaccionar con feedback visual inmediato.

---

### T1.3 — Pilar Comunicación: Interfaz del Chat Global
* **Descripción:** Desarrollar la sala de chat en vivo con diseño conversacional fluido.
* **Entregables técnicos:**
  * Contenedor de mensajes con scroll automático anclado abajo al entrar un nuevo mensaje.
  * Burbujas diferenciadas: mensajes propios alineados a la derecha con degradado rosa/vino (`--acc`), mensajes de otros alumnos a la izquierda con avatar y nombre en color institucional.
  * Input de texto con botón de envío al presionar `Enter` y animación de botón pulsante.
  * Indicador de "Escribiendo..." y banner superior con estado de conexión en vivo (*"🟢 Conectado al campus USMP"*).
* **Criterio de Aceptación:** La lista de chat soporta cientos de mensajes sin lag y maneja reconexiones visuales si se pierde internet.

---

### T1.4 — Pilar Lúdico: Interfaz de "Randomly" (Match 2 min)
* **Descripción:** Pantalla interactiva del juego de emparejamiento con temporizador sincronizado.
* **Entregables técnicos:**
  * Selector de preferencia antes de buscar: `Cualquiera` / `Mi universidad (USMP)` / `Mi carrera`.
  * Estado de búsqueda: animación circular de radar / pulsaciones buscando un alumno activo.
  * **Pantalla de duelo / chat activo:**
    * Encabezado con información del rival anónimo o revelado.
    * **Reloj regresivo en tiempo real de 2:00 minutos:** Barra de progreso decreciente que cambia de color verde a amarillo y finalmente rojo cuando quedan menos de 30 segundos.
    * Botón de "Rendirse / Salir".
  * Modal de fin de partida: muestra si fue Victoria (respondieron ambos), Derrota (se agotó el tiempo) y actualiza la racha de partidas.
* **Criterio de Aceptación:** El temporizador descuenta segundo a segundo con precisión y emite advertencia sonora o háptica a los 10 segundos finales.

---

### T1.5 — Pilar Comercial: Negocios del Campus (Directorio Geolocalizado)
* **Descripción:** Reemplazo completo del antiguo Market por un catálogo de tiendas físicas cercanas al campus.
* **Entregables técnicos:**
  * Botón destacado de cabecera: *"📍 Usar mi ubicación actual"*, con llamada a la Geolocation API (`navigator.geolocation`).
  * Barra de filtros por chips con iconos: 🍔 Comidas, 🍬 Snacks/Golosinas, 👕 Merch/Ropa, 🖨️ Fotocopiadoras/Librería, 💻 Servicios.
  * Tarjetas de comercio:
    * Foto de portada con badge de estado en tiempo real (**Abierto ahora** en verde / **Cerrado** en rojo).
    * Nombre del local, horario de atención y dirección de referencia (*"Frente a puerta 2"*).
    * **Insignia de distancia en metros:** *"A 65 m del campus"*.
    * Botón directo con enlace dinámico a WhatsApp (`https://wa.me/51...`).
  * Buscador reactivo que filtra por nombre o producto en tiempo real.
* **Criterio de Aceptación:** Si el usuario no otorga permiso de GPS, la app muestra un fallback con la ubicación predeterminada del campus central USMP Arequipa.

---

### T1.6 — Pilar Identidad: Perfil de Estudiante y Notificaciones
* **Descripción:** Vista del perfil personal y bandeja centralizada de notificaciones.
* **Entregables técnicos:**
  * **Perfil:** Foto de portada universitaria, avatar circular, nombre del alumno, `@usuario`, insignia de carrera, ciclo actual, bio y tarjeta de estadísticas (Seguidores, Posts, Victorias/Rachas en Randomly).
  * **Notificaciones:** Lista con filtros (*Todo, Social, Mensajes, Randomly*) con punto indicador de "No leída" y botón de *"Marcar todo como leído"*.
* **Criterio de Aceptación:** El perfil permite editar la biografía y refleja la sesión actual del alumno.

---

### T1.7 — Integración Final con APIs y WebSockets
* **Descripción:** Reemplazar los datos simulados (*mocks*) por las conexiones reales con los servicios del Integrante 2 y 3.
* **Entregables técnicos:**
  * Cliente HTTP configurado (`axios` o `fetch` centralizado con interceptor de JWT).
  * Conexión con `socket.io-client` para escuchar y emitir eventos de chat y Randomly.
  * Manejo de pantallas de carga (*skeletons*) y banners de error amigables.
* **Criterio de Aceptación:** La app funciona conectada al backend en Render sin lanzar errores de consola.

---

## ⚙️ INTEGRANTE 2: Backend Lead & Motor de Tiempo Real
> **Misión:** Toda la lógica del servidor, el motor de WebSockets para el chat, el matchmaking de alta velocidad en Redis y la estabilidad en Render.  
> **Tecnologías:** Node.js, Express / Fastify, Socket.io, Upstash Redis, Docker, Render.  
> **Directorio:** `/backend`

---

### T2.1 — Servidor Base Modular y Dockerización para Render
* **Descripción:** Estructurar el servidor Node.js preparado para producción en contenedor Docker.
* **Entregables técnicos:**
  * Arquitectura desacoplada en carpetas: `/routes`, `/controllers`, `/services`, `/sockets`, `/middlewares`.
  * `Dockerfile` multi-stage optimizado (imagen ligera Alpine, instalación de dependencias de producción, puerto configurable).
  * Script de Healthcheck (`GET /health`) que valide el estado del servidor, Redis y la base de datos.
  * Configuración de CORS estricto habilitando solo el dominio de Vercel del Integrante 1 y `localhost`.
* **Criterio de Aceptación:** El contenedor compila localmente y responde `HTTP 200 { status: "ok" }`.

---

### T2.2 — Pilar Comunicación: Servidor de Chat Global con WebSockets
* **Descripción:** Implementar la infraestructura de mensajería instantánea bidireccional mediante Socket.io.
* **Entregables técnicos:**
  * Middleware de autenticación de sockets: verificar el JWT emitido por Supabase antes de permitir la conexión.
  * Sala `campus:usmp:global`:
    * Evento `chat:send`: recibe el mensaje, lo sanitiza contra inyecciones XSS, le asigna timestamp del servidor y emite `chat:receive` a todos los clientes conectados.
  * Gestión de usuarios activos: registrar sockets en Redis para mantener el número exacto de alumnos online y emitir evento `presence:update`.
* **Criterio de Aceptación:** Dos pestañas de navegador intercambian mensajes en menos de 50ms sin perder la conexión.

---

### T2.3 — Pilar Lúdico: Motor Algorítmico de "Randomly" con Redis
* **Descripción:** Desarrollar el sistema de emparejamiento ultra rápido de 2 minutos utilizando la memoria RAM de Upstash Redis.
* **Entregables técnicos:**
  * **Cola de espera (Matchmaking):**
    * Alumno emite `randomly:join`: su ID entra a un Set de espera en Redis (`SADD randomly:queue`).
    * Motor atómico: extrae 2 usuarios simultáneos (`SPOP randomly:queue 2`), genera un `roomId` único y emite `randomly:matched` a ambos jugadores.
  * **Gestor de vida de la partida (TTL 120s):**
    * Guardar la clave en Redis `randomly:room:{id}` con expiración de 120 segundos.
    * Cada mensaje cruzado entre los dos alumnos ejecuta `EXPIRE randomly:room:{id} 120` (resetea el contador a 2 minutos).
    * Monitoreo o cron de latido: si transcurren los 120s sin mensajes, el servidor emite `randomly:timeout` y destruye la sala.
  * **Abandono anticipado:** Si un alumno cierra la pestaña, emitir evento `randomly:partner_left` al rival.
* **Criterio de Aceptación:** El emparejamiento no genera duplicados ni usuarios bloqueados en la cola y el tiempo expira exactamente a los 120 segundos de inactividad.

---

### T2.4 — Pilar Social: Endpoints REST del Feed con Caché en Memoria
* **Descripción:** Construir la API del Feed universitario optimizada con Upstash Redis para soportar miles de lecturas masivas.
* **Entregables técnicos:**
  * `GET /api/feed`:
    1. Verifica si existe la clave en Redis `cache:feed:global`.
    2. Si existe (*Cache Hit*), la entrega en <5ms.
    3. Si no existe (*Cache Miss*), consulta las publicaciones a Supabase, las guarda en Redis con TTL de 5 minutos y las retorna.
  * `POST /api/feed`:
    * Inserta la nueva publicación en la base de datos y ejecuta de forma atómica `DEL cache:feed:global` para invalidar la caché y mostrar el nuevo post al instante.
  * Paginación por cursor para scroll infinito (`?cursor=timestamp&limit=10`).
* **Criterio de Aceptación:** La lectura masiva del feed no genera consultas repetitivas a la base de datos relacional.

---

### T2.5 — Seguridad, Moderación y Rate Limiting
* **Descripción:** Blindar el servidor contra abusos, spam y contenido inadecuado.
* **Entregables técnicos:**
  * Rate Limiter con Redis (`express-rate-limit` con store de Redis): máximo 15 mensajes por minuto en el chat para evitar spam.
  * Endpoint `POST /api/reportes`: recibe denuncias de posts o mensajes ofensivos y los registra para revisión.
  * Filtro de palabras ofensivas básico para el canal público.
* **Criterio de Aceptación:** Un usuario que intente spamear recibe un error `HTTP 429 Too Many Requests`.

---

## 🔐 INTEGRANTE 3: Data, Auth & Geolocation Architect
> **Misión:** Seguridad universitaria estricta, estructura de base de datos, almacenamiento de multimedia y geolocalización PostGIS para las tiendas del campus.  
> **Tecnologías:** Supabase (PostgreSQL, PostGIS, Storage, Auth), Resend (SMTP), SQL.  
> **Directorio:** `/database` y controladores de datos.

---

### 🔑 FASE 1: Autenticación Universitaria & Seguridad (PRIMERO)

#### T3.1 — Configuración de Supabase Auth con Dominio `@usmp.pe`
* **Descripción:** Garantizar que la red social sea exclusiva para estudiantes de la USMP.
* **Entregables técnicos:**
  * Crear el proyecto en Supabase y activar el proveedor de correo electrónico.
  * Configurar regla de validación de dominios institucionales: rechazar cualquier registro que no pertenezca a `@usmp.pe` (o dominios autorizados de la universidad).
  * Crear trigger en PostgreSQL para crear automáticamente el registro en la tabla `usuarios` cuando una cuenta se confirma exitosamente.
* **Criterio de Aceptación:** Un correo `@gmail.com` es rechazado con mensaje de error; un correo `@usmp.pe` pasa a la fase de verificación.

#### T3.2 — Integración de Resend SMTP (Garantía Cero Spam)
* **Descripción:** Conectar la pasarela de correos profesionales para el despacho de Magic Links y códigos OTP.
* **Entregables técnicos:**
  * Crear cuenta en **Resend** y generar API Keys.
  * Configurar en Supabase Auth los parámetros SMTP personalizados de Resend (Host, Puerto 587, Usuario, Contraseña).
  * Personalizar la plantilla HTML del correo con la marca de **PRISM USMP Arequipa** (logo oficial y botón de acceso seguro).
* **Criterio de Aceptación:** El correo de verificación llega a la bandeja de entrada principal del alumno en menos de 10 segundos.

#### T3.3 — Políticas de Seguridad JWT y Middleware de Autenticación
* **Descripción:** Implementar el control de acceso en las peticiones HTTP del sistema.
* **Entregables técnicos:**
  * Configurar la firma y expiración de tokens JWT en Supabase.
  * Crear la función middleware para Node.js que extrae el token del header `Authorization: Bearer <token>`, lo valida con la clave pública de Supabase e inyecta el `req.user`.
* **Criterio de Aceptación:** Cualquier petición a endpoints protegidos sin token válido retorna `HTTP 401 Unauthorized`.

---

### 🗄️ FASE 2: Estructura de Datos y Fotos en la Nube (EN MEDIO)

#### T3.4 — Modelo Relacional en PostgreSQL
* **Descripción:** Diseñar y ejecutar las migraciones de las tablas fundamentales del ecosistema.
* **Entregables técnicos:**
  * Tabla `usuarios`: `id (UUID)`, `email`, `nombre`, `carrera`, `ciclo`, `avatar_url`, `bio`, `victorias_randomly`, `creado_en`.
  * Tabla `publicaciones`: `id`, `usuario_id (FK)`, `categoria`, `texto`, `imagen_url`, `likes_count`, `creado_en`.
  * Tabla `comentarios`: `id`, `publicacion_id (FK)`, `usuario_id (FK)`, `texto`, `creado_en`.
  * Tabla `reacciones`: `usuario_id`, `publicacion_id`, `tipo` (con clave primaria compuesta para evitar likes dobles).
  * Tabla `reportes`: `id`, `reportador_id`, `publicacion_id`, `motivo`, `estado`.
* **Criterio de Aceptación:** Todas las tablas cuentan con claves foráneas, restricciones `ON DELETE CASCADE` y campos indexados para búsqueda rápida.

#### T3.5 — Supabase Storage & Políticas RLS
* **Descripción:** Almacenamiento seguro de imágenes y archivos multimedia.
* **Entregables técnicos:**
  * Buckets públicos: `avatares`, `publicaciones_img`, `negocios_img`.
  * Configurar políticas RLS (*Row Level Security*):
    * Lectura: Pública para todos los usuarios autenticados.
    * Escritura: Solo el usuario dueño puede subir a su propia carpeta (`storage.foldername(name)[1] = auth.uid()`).
    * Tamaño máximo: 5 MB por imagen; formatos permitidos: JPEG, PNG, WEBP.
* **Criterio de Aceptación:** Un usuario no puede borrar ni sobreescribir fotos subidas por otro alumno.

---

### 📍 FASE 3: Pilar Comercial & Geolocalización PostGIS (AL FINAL)

#### T3.6 — Tablas de Negocios del Campus y Productos
* **Descripción:** Estructura de datos para el directorio comercial local.
* **Entregables técnicos:**
  * Tabla `negocios`: `id`, `nombre`, `categoria` (*Comida, Snacks, Ropa, Fotocopias, Servicios*), `descripcion`, `whatsapp`, `horario_apertura`, `horario_cierre`, `imagen_url`, `activo (boolean)`.
  * Tabla `productos_negocio`: `id`, `negocio_id (FK)`, `nombre`, `precio (decimal S/)`, `descripcion`, `imagen_url`.
* **Criterio de Aceptación:** Las tablas permiten consultar un negocio junto con su carta o lista de servicios.

#### T3.7 — Activación de PostGIS y Columna Cartográfica
* **Descripción:** Habilitar el motor de coordenadas geoespaciales en PostgreSQL.
* **Entregables técnicos:**
  * Ejecutar `CREATE EXTENSION IF NOT EXISTS postgis;`.
  * Agregar la columna espacial a la tabla:
    ```sql
    ALTER TABLE negocios ADD COLUMN ubicacion geography(Point, 4326);
    ```
  * Crear un índice espacial GIST para cálculos de alta velocidad:
    ```sql
    CREATE INDEX idx_negocios_ubicacion ON negocios USING GIST(ubicacion);
    ```
* **Criterio de Aceptación:** La base de datos es capaz de almacenar pares de latitud y longitud como puntos geográficos de la Tierra (WGS 84).

#### T3.8 — Función SQL Espacial de Cálculo de Distancias
* **Descripción:** Crear la función que calcula las distancias esféricas en metros entre el alumno y cada tienda.
* **Entregables técnicos:**
  * Función RPC en PostgreSQL:
    ```sql
    CREATE OR REPLACE FUNCTION buscar_negocios_cercanos(
      lat_usuario double precision,
      lng_usuario double precision,
      radio_metros integer DEFAULT 1000,
      categoria_filtro text DEFAULT NULL
    )
    RETURNS TABLE (
      id bigint,
      nombre text,
      categoria text,
      whatsapp text,
      imagen_url text,
      distancia_metros integer,
      abierto boolean
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        n.id,
        n.nombre,
        n.categoria,
        n.whatsapp,
        n.imagen_url,
        ROUND(ST_Distance(n.ubicacion, ST_SetSRID(ST_MakePoint(lng_usuario, lat_usuario), 4326)::geography))::integer AS distancia_metros,
        (CURRENT_TIME BETWEEN n.horario_apertura AND n.horario_cierre) AS abierto
      FROM negocios n
      WHERE ST_DWithin(n.ubicacion, ST_SetSRID(ST_MakePoint(lng_usuario, lat_usuario), 4326)::geography, radio_metros)
        AND (categoria_filtro IS NULL OR n.categoria = categoria_filtro)
      ORDER BY distancia_metros ASC;
    END;
    $$ LANGUAGE plpgsql;
    ```
* **Criterio de Aceptación:** La función recibe las coordenadas del usuario y devuelve únicamente los comercios dentro del radio solicitado, ordenados estrictamente del más cercano al más lejano.

#### T3.9 — Endpoints de Negocios y Carga de Datos Semilla (Campus USMP Arequipa)
* **Descripción:** Endpoint HTTP y poblado de comercios reales/típicos para pruebas de campo.
* **Entregables técnicos:**
  * Endpoint `GET /api/negocios?lat=-16.4045&lng=-71.5255&categoria=Comida` que invoca la función `buscar_negocios_cercanos`.
  * Script SQL de datos semilla con 8 a 10 locales situados en los alrededores reales de la **USMP Filial Sur Arequipa** (fotocopiadoras, restaurantes, tiendas de snacks, librerías) con coordenadas GPS reales de Google Maps.
* **Criterio de Aceptación:** Al hacer una petición con las coordenadas del campus, el endpoint responde con los locales ordenados con su distancia real en metros (*ej: 35m, 80m, 140m*).

---

## 📊 4. MATRIZ DE INTEGRACIÓN Y FLUJO DE DATOS ENTRE ROLES

Para que no existan dudas de cómo se comunican las tareas entre los 3 integrantes:

| Módulo / Función | 🎨 Integrante 1 (Frontend) | ⚙️ Integrante 2 (Backend) | 🔐 Integrante 3 (Data & Auth) |
| :--- | :--- | :--- | :--- |
| **Auth USMP** | Formulario login y captura de código OTP (`T1.1`) | Valida token JWT en cada request (`T2.1`) | Configura Supabase Auth + Resend SMTP (`T3.1`, `T3.2`) |
| **Feed Social** | Componente de posts e historias (`T1.2`) | API REST con caché de alta velocidad en Redis (`T2.4`) | Tablas `publicaciones` y Storage de fotos (`T3.4`, `T3.5`) |
| **Chat Global** | Interfaz conversacional y auto-scroll (`T1.3`) | Servidor Socket.io y presencia online (`T2.2`) | Almacenamiento opcional de historial y perfil (`T3.4`) |
| **Randomly** | UI de búsqueda y temporizador 2:00 (`T1.4`) | Matchmaking atómico y TTL 120s en Redis (`T2.3`) | Registro de victorias en tabla `usuarios` (`T3.4`) |
| **Negocios Locales** | Tarjetas de tienda, chips y GPS (`T1.5`) | Endpoint proxy y orquestación (`T2.1`) | PostGIS, función SQL y datos semilla (`T3.6`, `T3.8`, `T3.9`) |

---

## 📋 5. GUÍA PRÁCTICA PARA GITHUB PROJECTS

1. Entra a tu repositorio: `https://github.com/Diogojuve/prisma`.
2. En la pestaña **Projects**, presiona **New Project** y selecciona la plantilla **Board**.
3. Configura 4 columnas:
   * 📋 **Todo (Por hacer):** Cargar las tareas de esta guía (`T1.1` al `T3.9`).
   * ⏳ **In Progress (En progreso):** Máximo 1 tarea activa por desarrollador.
   * 🔍 **Review (En revisión / PR):** Cuando el código está listo y esperando visto bueno.
   * ✅ **Done (Terminado):** Tarea probada que cumple al 100% sus Criterios de Aceptación.
4. Cada vez que alguien termine una tarea, crea un Pull Request con el texto `Closes #numero_tarea`. GitHub la moverá automáticamente a **Done**.

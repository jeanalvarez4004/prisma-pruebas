# PRISM — Red Social Universitaria USMP
> **Especificación Funcional y de Producto**  
> **Versión:** 3.5 (Ecosistema Integral: Social, Tiempo Real, Randomly, Negocios PostGIS y PWA)  
> **Ámbito:** Universidad San Martín de Porres (Filial Sur Arequipa)  

---

## 1. Concepto General y Misión

**PRISM** es una plataforma digital exclusiva e hiperlocal para la comunidad universitaria de la **USMP**. Resuelve la fragmentación de la vida estudiantil centralizando en un único ecosistema:

1. **Vida Social y Campus:** Feed con publicaciones categorizadas, historias efímeras (24h) y tendencias (#Hashtags).
2. **Comunicación Instantánea:** Chat global universitario en tiempo real y canales por facultad.
3. **Interacción Lúdica (Randomly):** Dinámica de emparejamiento aleatorio de 2 minutos con preguntas rompehielos y sistema de rachas.
4. **Comercio Local (Negocios del Campus):** Directorio geolocalizado con PostGIS de locales y tiendas cercanas (comida, fotocopias, dulces, ropa) con cálculo de distancia en metros y pedidos directos por WhatsApp, junto con compra/venta C2C de artículos académicos (libros, calculadoras).
5. **Identidad Universitaria Verificada:** Autenticación institucional obligatoria con dominio `@usmp.pe` mediante Magic Links/OTP (vía Resend) y perfiles académicos (carrera, ciclo, bio).

---

## 2. Inicio / Feed Social y Nuevas Funciones

El feed es el pulso dinámico de lo que ocurre en el campus día a día.

### 2.1. Historias Efímeras del Campus (Stories 24h) — *¡Nueva Función!*
Inspiradas en el formato móvil moderno, permiten a los estudiantes y delegados compartir avisos rápidos del día:

``` text
HISTORIAS
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│  +   │  │ (👤) │  │ (👤) │  │ (👤) │  │ (👤) │
│ Tu   │  │ María│  │ José │  │ Ana  │  │ Luis │
│story │  │Medici│  │Derec │  │ Arqui│  │Sistem│
└──────┘  └──────┘  └──────┘  └──────┘  └──────┘
```

* **Duración:** Desaparecen automáticamente tras 24 horas.
* **Tipos de contenido:** Fotos con texto superpuesto, avisos de suspensión/cambio de aula, convocatorias a grupos de estudio o fotos del día a día.
* **Navegación:** Desplazamiento horizontal fluido con *scroll-snap* y visualizador modal a pantalla completa con barras de progreso temporizadas.

---

### 2.2. Compositor y Publicaciones
Diseñado para incentivar la conversación universitaria:

``` text
┌────────────────────────────────────────────────────────┐
│  (👤)  Hola Carlos, ¿qué está pasando en el campus?    │
│  [📷 Foto] [🏷️ Categoría ▼]          [ Publicar → ]     │
└────────────────────────────────────────────────────────┘
```

* **Categorías Oficiales:**
  * 🌐 **General:** Dudas cotidianas, avisos y vida estudiantil.
  * 📚 **Académico:** Consultas sobre cursos, profesores, exámenes y materiales de estudio.
  * 🎉 **Eventos:** Talleres extracurriculares, torneos deportivos universitarios y conferencias.
  * 🎭 **Confesiones:** Anécdotas universitarias anónimas moderadas.
  * 📢 **Avisos Oficiales / Delegados:** Comunicados importantes del aula o facultad.

---

### 2.3. Tendencias y Hashtags en Vivo — *¡Nueva Función!*
Panel lateral (en escritorio) o pestaña superior (en móvil) que detecta los temas más candentes:

``` text
TENDENCIAS DEL CAMPUS
#ExamenesFinales       142 posts
#ProyectoGrupal         89 posts
#FeriadoUniversitario   74 posts
#BibliotecaLlena        61 posts
```

* **Interactividad:** Al hacer clic en un hashtag, el feed se filtra automáticamente mostrando únicamente las publicaciones vinculadas a esa etiqueta.

---

## 3. Chat Global y Canales por Facultad

El espacio de conversación comunitaria en vivo con presencia simultánea.

``` text
CHAT UNIVERSITARIO
🟢 247 alumnos en línea · USMP Arequipa

[ 🌍 Global ] [ 💻 Sistemas ] [ ⚖️ Derecho ] [ 🩺 Medicina ]
────────────────────────────────────────────────────────────
Carlos (Sistemas):
¿Alguien sabe si la biblioteca de la sede central está llena?

María (Medicina):
Yo acabo de salir de ahí 👋 Quedan pocas mesas en el 2do piso.

José (Derecho):
Gracias por el dato! Salgo de procesal civil y voy para allá.
────────────────────────────────────────────────────────────
[ Escribe un mensaje para todo el campus...         ] [ → ]
```

### Funciones Principales:
* **Tiempo real de baja latencia:** Impulsado por WebSockets (Socket.io) sin necesidad de recargar la página.
* **Canales por Carrera/Facultad:** Selector de salas para charlar sobre temas específicos de la especialidad.
* **Presencia online:** Contador dinámico de alumnos conectados y estado de conexión ("Escribiendo...").
* **Seguridad y Moderación:** Sanitización anti-XSS y botón de reporte rápido para comentarios que violen el reglamento universitario.

---

## 4. Randomly — Speed-Chat Gamificado (2 Minutos)

El sello característico de PRISM: rompe el hielo entre estudiantes de distintas carreras de forma divertida y controlada.

``` text
RANDOMLY 🎲
"Conoce a alguien del campus en 2 minutos"

        👥 247 alumnos buscando rival
               [ ENCONTRAR MATCH ]

Filtro:  (•) Cualquier carrera   ( ) Mi misma carrera
```

### 4.1. Mecánica de los 2 Minutos y Temporizador Regresivo
* **La Regla:** Cada turno de conversación tiene un contador estricto de **120 segundos** sincronizado con el servidor.
* **Barra de Vida/Tiempo:** Un indicador visual que cambia de color:
  * 🟢 **120s – 60s:** Verde (Tiempo suficiente).
  * 🟡 **59s – 20s:** Amarillo (Advertencia).
  * 🔴 **19s – 0s:** Rojo parpadeante (¡Tiempo crítico!).
* **Reinicio de reloj:** Cada respuesta válida resetea el reloj a 2:00 para el interlocutor. Si un usuario no responde antes de que el reloj llegue a 00:00, **pierde la partida por inactividad**.

### 4.2. Preguntas Rompehielos Automáticas — *¡Nueva Función!*
Para evitar los silencios incómodos iniciales, la app sugiere preguntas rápidas al iniciar el match:
* *¿Qué es lo más difícil que te ha pasado en el ciclo hasta ahora?*
* *¿Cuál es el mejor lugar para almorzar cerca de la universidad?*
* *¿Prefieres clases a las 7:00 am o turno noche?*

### 4.3. Gamificación: Rachas y Revelación de Identidad — *¡Nueva Función!*
* **Rachas de Victorias (🔥 Streak):** El perfil acumula victorias consecutivas.
* **Botón de «Revelar Identidad» (🤝 Amistad):** Durante el chat, ambos usuarios son anónimos (*"Estudiante de Derecho #412"*). Si durante la conversación ambos presionan "Revelar", el sistema desbloquea sus nombres y perfiles reales para agregarse como amigos.

---

## 5. Negocios del Campus & Comercio Universitario (PostGIS)

Reemplazo y evolución del antiguo Market estático a un **directorio geolocalizado de comercios reales** y compras entre alumnos.

``` text
NEGOCIOS DEL CAMPUS
📍 Ubicación: Campus Filial Sur Arequipa (Detectado por GPS)

[ Todos ] [ 🍔 Comida ] [ 🍬 Snacks ] [ 🖨️ Copias ] [ 👕 Ropa ] [ 💻 Servicios ]
──────────────────────────────────────────────────────────────────────────────
┌───────────────────────────┐  ┌───────────────────────────┐
│ [ FOTO DEL LOCAL ]        │  │ [ FOTO DEL LOCAL ]        │
│ 🟢 Abierto ahora (Hasta 9pm)│  │ 🟢 Abierto ahora (Hasta 6pm)│
│ Tía Veneno & Jugos San Martín│  │ Multicopias & Librería Sur │
│ Menús universitarios S/ 10│  │ Impresiones, anillados, útiles│
│ 📍 A 45 metros del campus │  │ 📍 A 80 metros del campus │
│ [ 💬 Pedir por WhatsApp ] │  │ [ 💬 Pedir por WhatsApp ] │
└───────────────────────────┘  └───────────────────────────┘
```

### 5.1. Geolocalización Inteligente con PostGIS
* **Detección GPS:** El navegador solicita permiso de ubicación con la Geolocation API (`navigator.geolocation`).
* **Cálculo de Distancias Esféricas:** El motor PostGIS en PostgreSQL ejecuta `ST_Distance` y `ST_DWithin` para calcular la distancia en metros entre las coordenadas del alumno y cada negocio.
* **Ordenamiento por Proximidad:** Los locales se muestran ordenados de menor a mayor distancia (*ej: 30m, 50m, 120m, 350m*).

### 5.2. Ficha de Comercio y Pedidos por WhatsApp
Cada local cuenta con:
* **Estado en vivo (Abierto / Cerrado):** Se calcula automáticamente según el horario de atención (`horario_apertura` y `horario_cierre`).
* **Botón Directo de WhatsApp:** Enlace con mensaje formateado:  
  `https://wa.me/519XXXXXXXX?text=Hola,%20te%20contacto%20desde%20PRISM%20USMP.%20Deseo%20hacer%20un%20pedido.`
* **Menú / Catálogo de Productos:** Fotos, nombres y precios de los platos del día o servicios disponibles.

### 5.3. Submódulo C2C: Venta entre Estudiantes (Bazaar Académico)
Los estudiantes pueden publicar artículos de segunda mano típicos del campus:
* Calculadoras científicas / gráficas (Casio FX, etc.).
* Libros de cálculo, anatomía, leyes o algoritmos.
* Maquetas, tableros de dibujo o mandiles de laboratorio.

---

## 6. Identidad y Autenticación Universitaria (Supabase + Resend)

PRISM garantiza una comunidad segura y libre de perfiles ajenos mediante validación institucional.

``` text
ACCESO EXCLUSIVO USMP
Escribe tu correo institucional:

[ usuario@usmp.pe                    ]
[ Enviar enlace de acceso mágico →   ]

🔒 Solo correos @usmp.pe autorizados
```

### 6.1. Flujo de Autenticación sin Contraseña (Magic Links / OTP)
1. **Validación de Dominio:** El sistema rechaza cualquier correo que no termine en `@usmp.pe` (o dominios universitarios válidos).
2. **Despacho por Resend SMTP:** Se envía un correo con un enlace mágico o código de 6 dígitos que garantiza entrega inmediata en la bandeja principal (sin caer en Spam).
3. **Generación de Token JWT:** Una vez confirmado, Supabase Auth emite un token de seguridad que mantiene la sesión activa en el teléfono de forma cifrada.

---

## 7. Perfil del Estudiante y Reputación

El perfil representa la trayectoria académica y social del alumno en la USMP:

* **Cabecera Institucional:** Foto de portada con distintivo de la facultad y avatar personalizado.
* **Datos Académicos:** Nombre completo, carrera profesional, ciclo actual y año de ingreso.
* **Insignias y Logros de Campus:**
  * 🎲 *Maestro de Randomly:* Rachas de victorias alcanzadas.
  * 📚 *Colaborador Académico:* Alumnos con respuestas votadas positivamente en el feed académico.
* **Pestañas del Perfil:**
  * `Mis Publicaciones`: Historial de posts e imágenes compartidas.
  * `Mis Artículos`: Si tiene productos o libros en venta.
  * `Estadísticas`: Seguidores, seguidos y nivel de racha.

---

## 8. Notificaciones y Alertas Universitarias

Centro de notificaciones centralizado clasificado por tipo:

* 🔔 **Social:** Likes, comentarios y menciones en publicaciones.
* 💬 **Mensajes:** Nuevos chats recibidos.
* 🎲 **Randomly:** Notificación de que un rival aceptó el duelo o la revelación de perfil.
* 🏪 **Negocios:** Notificaciones de ofertas especiales o menús del día cerca del campus.

---

## 9. Experiencia Móvil y Capacidades PWA

Diseñado siguiendo las pautas de accesibilidad y ergonomía móvil:

* **Instalable sin tiendas:** Agregable a la pantalla de inicio desde Chrome, Safari o Edge con su propio icono e interfaz a pantalla completa sin barra de navegación del navegador (`standalone`).
* **Soporte de Safe Area:** Compatible con el *notch* y barras de gestos de iPhone y Android (`env(safe-area-inset-bottom)`).
* **Tamaño táctil accesible:** Todos los botones interactivos tienen un área de toque mínima de **44px** a **52px** para evitar toques accidentales.
* **Caché Offline:** Los assets esenciales (estilos, logos, scripts) se almacenan en el dispositivo mediante el Service Worker (`sw.js`).

---

## 10. Matriz del MVP vs. Fases Posteriores

| Módulo | Versión Actual (MVP) | Fase Siguiente (v1.5) | Versión 2.0 (Futuro) |
| :--- | :--- | :--- | :--- |
| **Feed** | Posts con categorías, likes e imágenes | Comentarios anidados y menciones `@` | Historias en video de 15 segundos |
| **Chat** | Chat global de campus | Canales por facultad / carrera | Notas de voz y fotos efímeras |
| **Randomly** | Match aleatorio con reloj de 120s | Filtro por carrera y revelación mutua | Torneo universitario mensual de Randomly |
| **Negocios** | PostGIS GPS, tarjetas y WhatsApp | Subida de cartas diarias por dueños | Pasarela de pagos con Yape/Plin |
| **Auth** | Correo `@usmp.pe` con Resend OTP | Perfil con verificación de carné universitario | Integración directa con intranet universitaria |

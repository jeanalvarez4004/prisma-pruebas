ARQUITECTURA DE SOFTWARE DEFINITIVA: PRISM (RED SOCIAL UNIVERSITARIA)
Versión: 3.0 (Producción / Multi-Cloud Desacoplada / PWA Ready)
Enfoque: Alta concurrencia, Tiempo Real, Localización y Bajo Costo.
1. VISTA GENERAL DE LA ARQUITECTURA (TOPOLOGÍA)
PRISM opera bajo una Arquitectura Híbrida Desacoplada. El cliente (frontend) se distribuye globalmente como una aplicación web progresiva independiente, mientras que la lógica de negocio, el tiempo real y los datos se delegan a servicios especializados en la nube que se comunican de forma asíncrona mediante APIs REST, WebSockets y conexiones de memoria.
text
                               ┌──────────────────────────────────┐
                               │     PWA CLIENT (Vite + React)     │
                               │        Desplegado en Vercel      │
                               └───────┬──────────────────┬───────┘
                                       │                  │
                Peticiones HTTP / REST │                  │ Conexión WebSocket
                & Flujo de Auth        │                  │ (Chat / Randomly)
                                       ▼                  ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────┐
  │                                   RENDER PLATFORM                                    │
  │                                                                                      │
  │  ┌────────────────────────────────────────────────────────────────────────────────┐  │
  │  │                     WEB SERVICE (Contenedor Docker - Node.js)                  │  │
  │  │                                                                                │  │
  │  │   ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐  │  │
  │  │   │     MÓDULO HTTP     │   │   MÓDULO REALTIME   │   │   MOTORES INTERNOS  │  │  │
  │  │   │     (API REST)      │   │     (Socket.io)     │   │ (PostGIS / Crypto)  │  │  │
  │  │   └──────────┬──────────┘   └──────────┬──────────┘   └──────────┬──────────┘  │  │
  │  └──────────────┼─────────────────────────┼─────────────────────────┼─────────────┘  │
  └─────────────────┼─────────────────────────┼─────────────────────────┼────────────────┘
                    │                         │                         │
                    │ Querys SQL / Transac.   │ Invalidation / Match    │ Almacenamiento CDN
                    ▼                         ▼                         ▼
  ┌──────────────────────────────────┐ ┌──────────────────────────────────┐ ┌──────────────────────────────────┐
  │         SUPABASE HUB             │ │          UPSTASH REDIS           │ │         SUPABASE STORAGE         │
  │   - Base de Datos (PostGIS)      │ │   (In-Memory Key-Value Store)    │ │   (Object Storage / Assets)      │
  │   - Autenticación Universitaria  │ │                                  │ │                                  │
  └─────────────────┬────────────────┘ └──────────────────────────────────┘ └──────────────────────────────────┘
                    │
                    │ Envío de Enlaces Mágicos / OTP
                    ▼
  ┌──────────────────────────────────┐
  │           RESEND SMTP            │
  │   (Servicio de Correo Emisor)    │
  └──────────────────────────────────┘
Usa el código con precaución.
2. DESGLOSE COMPONENTE POR COMPONENTE
2.1. El Cliente: Progressive Web App (PWA)
• Alojamiento y Distribución: Desplegado en Vercel. El código del frontend se sirve a través de una red de optimización global (CDN), lo que garantiza que la interfaz cargue en milisegundos sin importar la calidad del Internet del campus.
• Capacidades PWA: Mediante archivos de manifiesto y scripts de servicio en segundo plano (Service Workers), la aplicación se vuelve instalable en Android e iOS sin pasar por las tiendas de aplicaciones. Permite almacenar en la memoria interna del teléfono la estructura visual de la red social para que abra instantáneamente.
• Hardware y Sistema: Utiliza las API nativas del navegador para solicitar acceso al GPS del teléfono (necesario para ubicar los negocios locales cercanos) y gestionar notificaciones integradas en el sistema operativo.
2.2. Servidor Principal: El Web Service Monolítico
• Entorno: Ejecutado dentro de un contenedor Docker aislado en la plataforma Render.
• Submódulo HTTP (API REST): Atiende las peticiones tradicionales que no requieren tiempo real, como registrar una nueva publicación, editar el perfil o listar los productos de un negocio específico.
• Submódulo Realtime (WebSockets): Mantiene canales de comunicación bidireccional abiertos con los teléfonos de los estudiantes utilizando la tecnología de Socket.io. Esto permite que los mensajes de los chats aparezcan al instante y gestiona los eventos del juego de emparejamiento rápido.
2.3. Capa de Datos y Localización Inteligente
• Persistencia (Base de Datos): Servido por Supabase (PostgreSQL). Almacena de manera segura la información estructural del sistema: perfiles de alumnos, registros de los negocios autorizados, cartas de productos, logs de moderación e historial de mensajes privados.
• Motor de Geolocalización (PostGIS): Extensión espacial activada directamente dentro de la base de datos PostgreSQL. Transforma las direcciones de los negocios locales en puntos cartográficos (coordenadas geográficas estrictas) para calcular distancias en metros respecto a la ubicación del estudiante en tiempo real.
2.4. Capa de Alta Velocidad (En memoria con Redis)
• Proveedor: Upstash (Redis en la nube con arquitectura sin servidor y capa gratuita).
• Función: Actúa como la primera línea de defensa del sistema. En lugar de saturar la base de datos con consultas repetitivas, Redis guarda en la memoria RAM del servidor los datos que cambian constantemente o que requieren velocidad extrema.
2.5. Autenticación y Verificación de Identidad Universitaria
• Gestor de Sesión: Supabase Auth. Es el encargado de emitir los tokens de seguridad cifrados (JWT) para mantener las sesiones abiertas en el teléfono del alumno de manera segura.
• Pasarela de Correo (SMTP): Resend. Se conecta de forma directa con Supabase Auth. Su única misión en la arquitectura es recibir las peticiones de creación de cuenta y despachar los correos institucionales de verificación (@universidad.edu) con enlaces de validación o códigos únicos, garantizando que el mensaje llegue a la bandeja principal y no a la carpeta de correo no deseado.
3. ARQUITECTURA DE FLUJOS CLAVE DEL SISTEMA
3.1. Flujo de Acceso Exclusivo Universitario
Para blindar la red social y evitar usuarios ajenos a la comunidad, el sistema opera bajo el siguiente control:
1. El frontend envía la solicitud de registro con el correo del estudiante.
2. Supabase Auth evalúa si el dominio del correo cumple con las reglas institucionales permitidas.
3. Si es válido, se delega el envío a Resend SMTP, bloqueando el acceso al menú principal en la PWA hasta que el estudiante interactúe con el correo recibido.
3.2. Mecánica en Memoria de "Randomly"
Para evitar sobrecargar los discos duros de la base de datos con emparejamientos continuos, el flujo de "Randomly" se procesa en la memoria ultrarrápida de Redis:
• Sala de Espera: Cuando un alumno presiona "Buscar", su ID entra a una lista dinámica en memoria (Set).
• Algoritmo de Match: El servidor evalúa la lista, extrae de manera atómica a dos usuarios disponibles y destruye sus registros de la lista de espera para que nadie más los intente emparejar.
• Control del Temporizador: Se crea un registro de sesión con un tiempo de vida (TTL) estricto de 120 segundos. Cada mensaje mutuo resetea este contador en la memoria. Si el contador llega a cero, Redis destruye la sesión de forma automática y el servidor notifica instantáneamente al frontend el fin de la partida por inactividad.
3.3. Consumo y Caché del Feed Principal
• Publicación: Cuando un alumno sube un nuevo post al Feed, el dato se escribe en la base de datos de Supabase y de inmediato se borra la memoria caché del Feed en Redis.
• Lectura masiva: Cuando los miles de alumnos entran al inicio de la app, el servidor lee el Feed directamente desde la memoria RAM de Redis en microsegundos, sin necesidad de hacer trabajar a la base de datos relacional.
3.4. Geolocalización de Negocios Cercanos
• El dispositivo móvil del alumno comparte sus coordenadas actuales de forma interna a través de la PWA.
• El backend recibe las coordenadas e interroga a la extensión PostGIS de la base de datos.
• PostGIS realiza un cálculo matemático de geometría esférica y devuelve únicamente los negocios que se encuentran dentro del radio de metros establecido (por ejemplo, a menos de 500 metros del campus), ordenándolos automáticamente del más cercano al más lejano.
4. ESTRATEGIA DE SEGURIDAD Y RESTRICCIONES DE RED
• Aislamiento de Origen (CORS): El servidor en Render tiene una política estricta que rechaza cualquier petición HTTP o intento de conexión por WebSockets que no provenga explícitamente del dominio seguro asignado a la PWA en Vercel o del entorno local de desarrollo del programador.
• Manejo de Desconexión de Red (Efecto Túnel Universitario): Al ser una PWA, si el estudiante entra a un sótano, laboratorio o pabellón con mala cobertura y los WebSockets se desconectan, la interfaz de React se bloquea amigablemente mostrando el estado local guardado en caché y reintenta de forma automática la reconexión al backend de Render apenas detecte señal de red.

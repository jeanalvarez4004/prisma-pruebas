# 🔮 PRISM — Red Social Universitaria USMP

[![App en vivo](https://img.shields.io/badge/Render-App%20en%20vivo-00ff88?style=for-the-badge&logo=render&logoColor=white)](https://prisma-pruebas-99uj.onrender.com)
[![GitHub](https://img.shields.io/badge/GitHub-prisma--pruebas-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/jeanalvarez4004/prisma-pruebas)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-Documentación-0B6E4F?style=for-the-badge)](https://deepwiki.com/jeanalvarez4004/prisma-pruebas/1-overview)

**PRISM** es la red social universitaria de la **USMP Filial Sur (Arequipa)**. Reúne en una sola aplicación web instalable (PWA) el feed del campus, la inscripción a actividades en tiempo real, un chat entre estudiantes y un asistente con inteligencia artificial. El acceso es exclusivo para correos institucionales **@usmp.pe**.

---

## 📌 Enlaces

| | |
| :-- | :-- |
| 🌐 **App en vivo** | https://prisma-pruebas-99uj.onrender.com |
| 💻 **Repositorio** | https://github.com/jeanalvarez4004/prisma-pruebas |
| 📚 **Documentación** | https://deepwiki.com/jeanalvarez4004/prisma-pruebas/1-overview |

---

## ✨ Funcionalidades

- **Acceso institucional:** registro solo con correo `@usmp.pe` y sesiones seguras con cookies `httpOnly`.
- **Feed del campus:** publicaciones por categoría, reacciones e historias que duran 24 horas.
- **Búsqueda instantánea** de publicaciones y actividades.
- **Actividades en tiempo real:** inscripción inmediata con control de cupos, que se actualiza al instante para todos los conectados.
- **Chat del campus** y notificaciones en vivo.
- **Asistente con IA** que responde con información del reglamento y las guías del campus (RAG), las actividades disponibles y el clima de Arequipa.
- **Machine learning:** análisis de sentimiento de los mensajes de contacto y recomendación de actividades.
- **Panel de administración:** carga de documentos para el asistente, aprendizaje supervisado de la IA, reportes y estado de los servicios.
- **Tolerancia a fallos:** si un servicio externo no responde, la app sigue funcionando con su respaldo local en SQLite.

---

## 🛠️ Tecnologías usadas

| Área | Tecnología |
| :-- | :-- |
| Diseño | Figma |
| Frontend | HTML, CSS y JavaScript · PWA (Service Worker + Web Manifest) |
| Backend | Node.js + Express |
| Base de datos | SQLite + Turso (réplica en la nube) |
| Caché | Upstash Redis |
| Búsqueda | Algolia |
| Inteligencia artificial | Groq (modelo de lenguaje) |
| Base vectorial (RAG) | Qdrant |
| Tiempo real | Socket.IO |
| Machine learning | Naive Bayes y factorización de matrices (implementación propia) |
| Mapas y clima | Mapbox · Open-Meteo |
| Despliegue | Render |
| Control de versiones | Git + GitHub |

---

## 📁 Estructura del proyecto

```
├── server.js          # Servidor Express: API REST, sesiones y Socket.IO
├── redis-client.js    # Cliente de Upstash Redis
├── services/          # Asistente IA, RAG, búsqueda, ML, clima y moderación
├── index.html         # Aplicación web (PWA)
├── app.js             # Lógica principal del cliente
├── features.js        # Módulos: chat, búsqueda, inscripciones y administración
├── styles.css         # Estilos e identidad visual
├── sw.js              # Service Worker
├── ml/                # Datos de entrenamiento de los modelos
└── render.yaml        # Configuración de despliegue en Render
```

---

## 🚀 Ejecutar en local

```bash
npm ci
cp .env.example .env   # completar las variables necesarias
npm start
```

La aplicación queda disponible en `http://localhost:3000`. Los servicios externos son opcionales: sin sus credenciales, PRISM funciona con el respaldo local.

---

## 👥 Equipo · Grupo Esmeralda

- Diogo Juvenal Ticona
- David Abrigo Jaquis
- Jean Carlo Alvarez Meza

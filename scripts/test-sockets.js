'use strict';

const { io } = require('socket.io-client');

async function testWebSockets() {
  console.log('--- Iniciando prueba de WebSockets (Socket.IO) ---');
  const URL = 'http://localhost:3000';

  const clientA = io(URL, { transports: ['websocket'] });
  const clientB = io(URL, { transports: ['websocket'] });

  await new Promise((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    clientA.on('connect', check);
    clientB.on('connect', check);
  });

  console.log('✅ Cliente A y Cliente B conectados por WebSocket.');

  // Identificar
  clientA.emit('user:identify', { name: 'Carlos Ríos', career: 'Ingeniería de Sistemas' });
  clientB.emit('user:identify', { name: 'Haina Rodríguez', career: 'Ingeniería de Sistemas' });

  // Escuchar presencia
  clientA.on('presence:update', (data) => {
    console.log(`[Presencia] Alumnos conectados: ${data.onlineCount}`);
  });

  // Client B escucha mensajes de chat
  const messagePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout esperando mensaje')), 5000);
    clientB.on('chat:message', (msg) => {
      console.log(`[Cliente B recibió en tiempo real] ${msg.u}: "${msg.t}" (${msg.h})`);
      if (msg.t === '¡Hola Haina! Probando WebSockets en vivo para el campus') {
        clearTimeout(timeout);
        resolve(msg);
      }
    });
  });

  // Client A envía un mensaje
  console.log('Cliente A enviando mensaje de chat...');
  clientA.emit('chat:send', {
    text: '¡Hola Haina! Probando WebSockets en vivo para el campus',
    user: { name: 'Carlos Ríos', career: 'Ingeniería de Sistemas' },
  });

  await messagePromise;
  console.log('✅ Mensaje transmitido bidireccionalmente con éxito en tiempo real.');

  clientA.disconnect();
  clientB.disconnect();
  console.log('--- Prueba de WebSockets completada con éxito ---\n');
}

testWebSockets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error en prueba de WebSockets:', err);
    process.exit(1);
  });

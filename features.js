'use strict';

/**
 * Funciones añadidas a PRISM (se carga después de app.js y reutiliza sus helpers globales):
 *  - Buscar (Algolia / SQLite)
 *  - Asistente IA con respuesta progresiva, fuentes y fichas de actividades
 *  - Inscripciones en cola (en cola -> registrado) con aviso en vivo
 *  - Recomendaciones de actividades (ML) en Inicio
 *  - Contacto con análisis de sentimiento
 *  - Panel de Administración (servicios, documentos, índice de búsqueda, reportes)
 */
(function () {
  const ROUTES = new Set(['buscar', 'asistente', 'contacto', 'admin']);
  const SENTIMENT = {
    positivo: { label: 'Positivo', cls: 'is-green' },
    negativo: { label: 'Negativo', cls: 'is-red' },
    neutral: { label: 'Neutral', cls: 'is-gray' },
  };
  const SUGGESTIONS = [
    '¿Qué actividades de deporte hay?',
    '¿Cuál es el horario de la biblioteca?',
    '¿Cuántos soles son 50 dólares?',
  ];

  const f = {
    chat: [],
    streaming: false,
    searchType: 'all',
    searchQuery: '',
    searchTimer: null,
    searchSeq: 0,
    adminTab: 'estado',
    pending: new Map(), // id -> { title }
    pollTimer: null,
  };

  const esc = (value) => escapeHtml(value);
  const isAdmin = () => state.user && state.user.role === 'admin';
  const page = () => document.getElementById('page-content');

  function isFeatureRoute(route) {
    return ROUTES.has(route);
  }

  function head(eyebrow, title, subtitle) {
    return `<section class="surface-card f-head"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></section>`;
  }

  /* ----------------------------- Buscar ----------------------------- */
  function renderSearch() {
    const chips = [['all', 'Todo'], ['post', 'Publicaciones'], ['activity', 'Actividades']]
      .map(([value, label]) => `<button type="button" class="f-chip ${f.searchType === value ? 'is-active' : ''}" data-f="search-type" data-v="${value}">${label}</button>`)
      .join('');
    page().innerHTML = `
      <div class="f-page">
        <section class="surface-card f-head">
          <p class="eyebrow">Explora el campus</p>
          <h1>Buscar</h1>
          <p>Encuentra publicaciones y actividades por palabra clave.</p>
          <form id="f-search-form" class="f-row" style="margin-top:14px" role="search">
            <input id="f-search-q" class="f-input f-grow" type="search" maxlength="100" placeholder="Ej.: fútbol, cálculo, transporte…" value="${esc(f.searchQuery)}" autocomplete="off" />
            <button class="primary-button" type="submit">Buscar</button>
          </form>
          <div class="f-chips">${chips}</div>
        </section>
        <section id="f-search-out" aria-live="polite"></section>
      </div>`;
    if (f.searchQuery) runSearch();
  }

  function resultHtml(item) {
    const icon = item.type === 'activity' ? activityIcon(item.category) : '▣';
    const meta = [item.category, item.author, item.location, item.eventDate ? formatDate(item.eventDate) : ''].filter(Boolean).map(esc).join(' · ');
    const action = item.type === 'activity'
      ? `<div><button class="outline-button" type="button" data-f="enroll" data-id="${item.id}">Unirme</button></div>` : '';
    return `<article class="f-result">
      <div class="f-row"><span class="f-badge ${item.type === 'activity' ? 'is-orange' : ''}">${icon} ${item.type === 'activity' ? 'Actividad' : 'Publicación'}</span><small class="f-muted">${esc(timeAgo(item.createdAt))}</small></div>
      <strong>${esc(item.title)}</strong>
      ${item.snippet && item.snippet !== item.title ? `<p>${esc(item.snippet)}</p>` : ''}
      <small class="f-muted">${meta}</small>${action}
    </article>`;
  }

  async function runSearch() {
    const out = document.getElementById('f-search-out');
    if (!out) return;
    const q = f.searchQuery.trim();
    if (!q) { out.innerHTML = ''; return; }
    const seq = ++f.searchSeq;
    out.innerHTML = '<div class="surface-card f-card f-muted">Buscando…</div>';
    try {
      const data = await request(`/api/search?q=${encodeURIComponent(q)}&type=${f.searchType}`);
      if (seq !== f.searchSeq || !document.getElementById('f-search-out')) return;
      const engine = data.engine === 'algolia' ? '<span class="f-badge is-green">Algolia</span>' : '<span class="f-badge">SQLite</span>';
      out.innerHTML = `<div class="surface-card f-card">
        <div class="f-row"><h2 class="f-grow">${data.results.length} resultado${data.results.length === 1 ? '' : 's'} para “${esc(q)}”</h2>${engine}</div>
        ${data.warning ? `<p class="f-muted">${esc(data.warning)}</p>` : ''}
        ${data.results.length ? `<div class="f-result-list">${data.results.map(resultHtml).join('')}</div>`
          : '<div class="empty-state"><span class="empty-icon">⌕</span><strong>Sin resultados</strong><p>Prueba con otra palabra o quita el filtro.</p></div>'}
      </div>`;
    } catch (error) {
      if (seq === f.searchSeq) out.innerHTML = `<div class="surface-card f-card f-muted">${esc(error.message)}</div>`;
    }
  }

  /* ----------------------------- Asistente ----------------------------- */
  function renderMarkdown(raw) {
    if (!raw) return '';
    let text = esc(raw);

    // Tablas Markdown
    const tableRegex = /((?:^[ \t]*\|.+?\|[ \t]*(?:\r?\n|$))+)/gm;
    text = text.replace(tableRegex, (match) => {
      const rows = match.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      if (rows.length < 2) return match;
      let sepIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        if (/^\|[ \t]*(?::?-+:?[ \t]*\|)+$/.test(rows[i])) {
          sepIndex = i;
          break;
        }
      }
      if (sepIndex === -1 && rows.length >= 2 && /^\|[- :|]+\|$/.test(rows[1])) {
        sepIndex = 1;
      }
      if (sepIndex === -1) return match;

      const parseCells = (row) =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headerRows = rows.slice(0, sepIndex);
      const bodyRows = rows.slice(sepIndex + 1);

      let html = '<div class="f-table-wrap"><table class="f-chat-table">';
      if (headerRows.length) {
        html += '<thead>';
        headerRows.forEach((hr) => {
          const cells = parseCells(hr);
          html += '<tr>' + cells.map((c) => `<th>${c}</th>`).join('') + '</tr>';
        });
        html += '</thead>';
      }
      if (bodyRows.length) {
        html += '<tbody>';
        bodyRows.forEach((br) => {
          const cells = parseCells(br);
          html += '<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>';
        });
        html += '</tbody>';
      }
      html += '</table></div>';
      return html;
    });

    // Negrita
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Cursiva
    text = text.replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');

    // Código inline
    text = text.replace(/`([^`]+)`/g, '<code class="f-inline-code">$1</code>');

    // Listas desordenadas
    text = text.replace(/((?:^[ \t]*[-*][ \t]+.+$(?:\r?\n)?)+)/gm, (match) => {
      const items = match.trim().split(/\r?\n/).map((line) => {
        return `<li>${line.replace(/^[ \t]*[-*][ \t]+/, '')}</li>`;
      }).join('');
      return `<ul class="f-chat-list">${items}</ul>`;
    });

    // Listas ordenadas
    text = text.replace(/((?:^[ \t]*\d+\.[ \t]+.+$(?:\r?\n)?)+)/gm, (match) => {
      const items = match.trim().split(/\r?\n/).map((line) => {
        return `<li>${line.replace(/^[ \t]*\d+\.[ \t]+/, '')}</li>`;
      }).join('');
      return `<ol class="f-chat-list is-ordered">${items}</ol>`;
    });

    // Citas
    text = text.replace(/^>[ \t]*(.+)$/gm, '<blockquote class="f-quote">$1</blockquote>');

    // Enlaces
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="f-chat-link">$1</a>');

    // Párrafos limpios
    const blocks = text.split(/(?:\r?\n){2,}/);
    const formattedBlocks = blocks.map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (b.startsWith('<div class="f-table-wrap"') || b.startsWith('<ul') || b.startsWith('<ol') || b.startsWith('<blockquote')) {
        return b;
      }
      return `<p class="f-paragraph">${b.replace(/\r?\n/g, '<br>')}</p>`;
    });

    return formattedBlocks.join('');
  }

  function botExtras(message) {
    const parts = [];
    if (message.cards && message.cards.length) {
      parts.push(`<div class="f-result-list">${message.cards.map((a) => {
        const spotsClass = a.remaining > 5 ? 'is-green' : (a.remaining > 0 ? 'is-orange' : 'is-red');
        const spotsText = a.remaining > 0 ? `${a.remaining} cupo${a.remaining === 1 ? '' : 's'} disponible${a.remaining === 1 ? '' : 's'}` : 'Sin cupos';
        return `
        <div class="f-result f-activity-card">
          <div class="f-card-top">
            <span class="f-badge ${spotsClass}">${activityIcon(a.category)} ${esc(a.category)}</span>
            <span class="f-badge ${spotsClass} f-spots-badge">🎟️ ${spotsText}</span>
          </div>
          <h4 class="f-card-title">${esc(a.title)}</h4>
          <div class="f-card-meta">
            <span class="f-meta-item">📍 ${esc(a.location)}</span>
            ${a.eventDate ? `<span class="f-meta-item">📅 ${esc(formatDate(a.eventDate))}</span>` : ''}
          </div>
          ${a.remaining > 0 ? `
            <div class="f-card-action">
              <button class="primary-button f-enroll-btn" type="button" data-f="enroll" data-id="${a.id}">
                <span>⚡ Unirme a esta actividad</span>
              </button>
            </div>` : `
            <div class="f-card-action">
              <span class="f-muted" style="font-size:0.85rem;">🚫 Cupos agotados</span>
            </div>`}
        </div>`;
      }).join('')}</div>`);
    }
    if (message.sources && message.sources.length) {
      parts.push(`<div class="f-msg-meta">${message.sources.map((s) => `<span class="f-badge">📄 ${esc(s.title)}</span>`).join('')}</div>`);
    }
    return parts.join('');
  }

  function rateHtml(message, index) {
    if (!message.content || message.failed || !message.logId) return '';
    const mark = (v) => (message.rating === v ? 'is-on' : '');
    return `<div class="f-rate"><span>¿Te sirvió?</span>
      <button type="button" class="f-rate-btn ${mark(1)}" data-f="rate" data-i="${index}" data-v="1" aria-label="Me sirvió" aria-pressed="${message.rating === 1}">👍</button>
      <button type="button" class="f-rate-btn ${mark(-1)}" data-f="rate" data-i="${index}" data-v="-1" aria-label="No me sirvió" aria-pressed="${message.rating === -1}">👎</button>
      ${message.rating === 1 ? '<span class="f-muted">¡Gracias! El equipo revisará esta respuesta para enseñársela al asistente.</span>' : ''}
      ${message.rating === -1 ? '<span class="f-muted">Gracias, la revisaremos.</span>' : ''}</div>`;
  }

  async function rateAnswer(index, value) {
    const answer = f.chat[index];
    if (!answer || !answer.logId) return;
    const next = answer.rating === value ? 0 : value;
    try {
      await request('/api/asistente/feedback', { method: 'POST', body: { id: answer.logId, rating: next } });
      answer.rating = next;
      if (currentRoute() === 'asistente') renderAssistant();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function messageHtml(message, index) {
    if (message.role === 'user') return `<div class="f-msg is-user">${esc(message.content)}</div>`;
    const typing = f.streaming && index === f.chat.length - 1 ? ' f-typing' : '';
    const streamingNow = f.streaming && index === f.chat.length - 1;
    return `
      <div class="f-msg is-bot">
        <div class="f-bot-tag">
          <span class="f-bot-icon">🤖</span>
          <span class="f-bot-title">PRISM Bot</span>
          <span class="f-bot-pill">IA Campus</span>
        </div>
        <div class="f-text${typing}" data-i="${index}">${renderMarkdown(message.content)}</div>
        <div class="f-extras">${botExtras(message)}</div>
        ${streamingNow ? '' : rateHtml(message, index)}
      </div>`;
  }

  function renderAssistant() {
    const empty = !f.chat.length;
    page().innerHTML = `
      <div class="f-page">
        ${head('Inteligencia artificial', 'Asistente PRISM', 'Pregunta sobre reglamentos, trámites, actividades o tipo de cambio.')}
        <section id="f-memory" class="surface-card f-memory" aria-live="polite"></section>
        <section class="surface-card f-chat">
          <div id="f-chat-stream" class="f-chat-stream">
            ${empty ? '<div class="f-muted" style="margin:auto;text-align:center">¡Hola! Soy PRISM Bot. ¿En qué te ayudo?</div>' : f.chat.map(messageHtml).join('')}
          </div>
          ${empty ? `<div class="f-suggest">${SUGGESTIONS.map((s) => `<button type="button" class="f-chip" data-f="suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
          <form id="f-chat-form" class="f-chat-form">
            <input id="f-chat-input" class="f-input f-grow" type="text" maxlength="500" placeholder="Escribe tu pregunta…" autocomplete="off" required ${f.streaming ? 'disabled' : ''} />
            <button class="primary-button" type="submit" ${f.streaming ? 'disabled' : ''}>Enviar</button>
          </form>
        </section>
      </div>`;
    scrollChat();
    loadMemory();
  }

  async function loadMemory() {
    const box = document.getElementById('f-memory');
    if (!box) return;
    try {
      const { memoria } = await request('/api/asistente/memoria');
      if (!document.getElementById('f-memory')) return;
      const chips = [
        ...memoria.actividades.map((a) => `<span class="f-badge is-orange">${activityIcon(a.categoria)} ${esc(a.categoria)} ×${a.n}</span>`),
        ...memoria.temas.map((t) => `<span class="f-badge">#${esc(t.texto)}</span>`),
      ];
      box.innerHTML = chips.length
        ? `<div class="f-row"><strong class="f-grow">🧠 Lo que recuerdo de ti</strong><button type="button" class="text-button" data-f="forget">Olvidar</button></div><div class="f-chips">${chips.join('')}</div>`
        : '<span class="f-muted">🧠 Aún te estoy conociendo: mientras más uses PRISM y valores mis respuestas, mejor te ayudo.</span>';
    } catch { box.hidden = true; }
  }

  function scrollChat() {
    const stream = document.getElementById('f-chat-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  function refreshBotBubble(index) {
    const stream = document.getElementById('f-chat-stream');
    const text = stream && stream.querySelector(`.f-text[data-i="${index}"]`);
    if (!text) return;
    const message = f.chat[index];
    text.innerHTML = renderMarkdown(message.content);
    text.classList.toggle('f-typing', f.streaming && index === f.chat.length - 1);
    text.parentElement.querySelector('.f-extras').innerHTML = botExtras(message);
    scrollChat();
  }

  async function askAssistant(question) {
    if (f.streaming || !question.trim()) return;
    f.chat.push({ role: 'user', content: question.trim() });
    f.chat.push({ role: 'assistant', content: '' });
    const index = f.chat.length - 1;
    f.streaming = true;
    if (currentRoute() === 'asistente') renderAssistant();

    const history = f.chat.slice(0, -1).slice(-8).map((m) => ({ role: m.role, content: m.content })).filter((m) => m.content);
    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ messages: history }),
      });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('text/event-stream')) {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) showAuth('login');
        throw new Error(payload.error || 'El asistente no está disponible.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 2);
          if (!line.startsWith('data:')) continue;
          let event;
          try { event = JSON.parse(line.slice(5)); } catch { continue; }
          const message = f.chat[index];
          if (event.type === 'delta') message.content += event.text;
          else if (event.type === 'sources') message.sources = event.sources;
          else if (event.type === 'cards') message.cards = event.activities;
          else if (event.type === 'logged') message.logId = event.id;
          else if (event.type === 'error') message.content = message.content || event.message;
          refreshBotBubble(index);
        }
      }
      if (!f.chat[index].content) f.chat[index].content = 'No obtuve respuesta. Inténtalo de nuevo.';
    } catch (error) {
      if (!f.chat[index].content) { f.chat[index].content = error.message; f.chat[index].failed = true; }
    } finally {
      f.streaming = false;
      if (currentRoute() === 'asistente') {
        renderAssistant();
        const input = document.getElementById('f-chat-input');
        if (input) input.focus();
      }
    }
  }

  /* ------------------------- Inscripciones en cola ------------------------- */
  function renderPending() {
    let box = document.getElementById('f-pending');
    if (!f.pending.size) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'f-pending';
      box.className = 'f-pending';
      document.body.appendChild(box);
    }
    box.innerHTML = [...f.pending.values()].map((p) => `<div class="f-pending-item">⏳ En cola: ${esc(p.title)}</div>`).join('');
  }

  async function resolveEnrollment(update) {
    if (!f.pending.has(update.id) && update.status === 'en_cola') return;
    if (update.status === 'en_cola') return;
    const known = f.pending.get(update.id);
    f.pending.delete(update.id);
    renderPending();
    if (!known && !update.title) return;
    const title = update.title || (known && known.title) || 'la actividad';
    if (update.status === 'registrado') showToast(`✅ Registrado en “${title}”`);
    else showToast(`⚠️ No se pudo registrar en “${title}”${update.detail ? `: ${update.detail}` : ''}`, true);
    try {
      await refreshFeed();
      if (currentRoute() === 'inicio') await renderPage();
    } catch { /* se actualizará en el siguiente refresco */ }
  }

  async function pollPending() {
    clearTimeout(f.pollTimer);
    if (!f.pending.size || !state.user) return;
    try {
      const data = await request('/api/inscripciones/mias');
      for (const item of data.inscripciones) {
        if (f.pending.has(item.id) && item.status !== 'en_cola') {
          await resolveEnrollment({ id: item.id, title: item.activityTitle, status: item.status, detail: item.detail });
        }
      }
    } catch { /* se reintenta */ }
    if (f.pending.size) f.pollTimer = setTimeout(pollPending, 3000);
  }

  async function enroll(activityId) {
    try {
      const data = await request('/api/inscripciones', { method: 'POST', body: { activityId: Number(activityId) } });
      const item = data.inscripcion;
      if (item.status === 'en_cola') {
        f.pending.set(item.id, { title: item.activityTitle || 'la actividad' });
        renderPending();
        showToast(`⏳ Tu inscripción${item.activityTitle ? ` a “${item.activityTitle}”` : ''} está en cola`);
        clearTimeout(f.pollTimer);
        f.pollTimer = setTimeout(pollPending, 3000);
      }
    } catch (error) {
      showToast(error.message, true);
    }
  }

  const boundSockets = new WeakSet();
  function bindSocket(socket) {
    if (boundSockets.has(socket)) return;
    boundSockets.add(socket);
    socket.on('inscripcion:update', (update) => { resolveEnrollment(update); });
    socket.on('notification:new', () => {
      refreshFeed().then(() => { if (typeof syncUserUI === 'function') syncUserUI(); }).catch(() => {});
    });
  }

  /* ----------------------------- Clima Campus Arequipa (Open-Meteo) ----------------------------- */
  let weatherData = null;
  let weatherFetched = 0;

  function updateWeatherUI(data) {
    if (!data) return;
    const c = data.current || {};
    const d = data.daily || {};
    const uv = d.uvIndex !== undefined ? d.uvIndex : 10.8;
    const hours = new Date().getHours();
    const isNight = hours >= 18 || hours < 6;
    const icon = isNight ? '🌙' : (uv > 7 ? '☀️' : '⛅');

    // 1. Barra superior
    const tempEl = document.getElementById('topbar-weather-temp');
    if (tempEl && c.temp !== undefined) {
      tempEl.textContent = `${c.temp}°C`;
    }

    // 2. Pantalla de login / portada
    const authTemp = document.getElementById('auth-w-temp');
    const authIcon = document.getElementById('auth-w-icon');
    if (authTemp && c.temp !== undefined) {
      authTemp.textContent = `${c.temp}°C`;
      if (authIcon) authIcon.textContent = icon;
    }

    // 3. Tarjeta en Inicio
    renderHomeWeather(data);
  }

  async function fetchCampusWeather() {
    const now = Date.now();
    if (weatherData && now - weatherFetched < 5 * 60 * 1000) {
      updateWeatherUI(weatherData);
      return weatherData;
    }

    // Intento 1: Servidor propio /api/weather
    try {
      const res = await fetch('/api/weather');
      if (res.ok) {
        const data = await res.json();
        if (data && !data.fallback) {
          weatherData = data;
          weatherFetched = now;
          updateWeatherUI(weatherData);
          return weatherData;
        }
      }
    } catch {}

    // Intento 2: Consulta directa desde el navegador a Open-Meteo (CORS abierto y gratuito)
    try {
      const omUrl = 'https://api.open-meteo.com/v1/forecast?latitude=-16.399&longitude=-71.5375&daily=temperature_2m_max,temperature_2m_min,uv_index_clear_sky_max,moonrise,moonset,moon_phase&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,rain,snowfall&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto';
      const omRes = await fetch(omUrl);
      if (omRes.ok) {
        const d = await omRes.json();
        weatherData = {
          location: 'Arequipa, Perú (Campus USMP)',
          elevation: d.elevation || 2342,
          current: {
            temp: d.current ? Math.round(d.current.temperature_2m * 10) / 10 : 19.6,
            unit: '°C',
            pressure: d.current ? d.current.pressure_msl : 1016,
            windSpeed: d.current ? d.current.wind_speed_10m : 3,
            windUnit: 'km/h',
          },
          daily: {
            minTemp: d.daily ? d.daily.temperature_2m_min[0] : 12.4,
            maxTemp: d.daily ? d.daily.temperature_2m_max[0] : 22.3,
            uvIndex: d.daily ? d.daily.uv_index_clear_sky_max[0] : 10.75,
          },
          updatedAt: new Date().toISOString(),
        };
        weatherFetched = now;
        updateWeatherUI(weatherData);
        return weatherData;
      }
    } catch {}

    return weatherData;
  }

  function updateTopbarWeather(data) {
    updateWeatherUI(data);
  }

  function renderHomeWeather(cached) {
    const slot = document.getElementById('home-weather-widget');
    if (!slot) return;
    const data = cached || weatherData;
    if (!data) return;

    const c = data.current || {};
    const d = data.daily || {};
    const uv = d.uvIndex !== undefined ? d.uvIndex : 10.8;
    const uvHigh = uv >= 8;
    const hours = new Date().getHours();
    const isNight = hours >= 18 || hours < 6;
    const icon = isNight ? '🌙' : (uv > 7 ? '☀️' : '⛅');

    slot.innerHTML = `
      <div class="weather-card">
        <div class="weather-card-head">
          <span class="weather-tag">📍 Arequipa · 2,342m</span>
          <span class="weather-live-dot" title="Datos en tiempo real Open-Meteo">● En vivo</span>
        </div>
        <div class="weather-card-body">
          <div class="weather-icon-temp">
            <span class="weather-big-icon">${icon}</span>
            <div class="weather-temp-group">
              <span class="weather-temp-number">${c.temp !== undefined ? c.temp : 15}°</span>
              <span class="weather-temp-unit">${c.unit || '°C'}</span>
            </div>
          </div>
          <div class="weather-status-text">
            <strong>Campus USMP Sur</strong>
            <small>Cielo despejado · Radiación alta</small>
          </div>
        </div>
        <div class="weather-card-footer">
          <div class="weather-stat-pill">
            <span class="w-label">Mín / Máx</span>
            <span class="w-val">${d.minTemp ?? 12.4}° / ${d.maxTemp ?? 22.3}°</span>
          </div>
          <div class="weather-stat-pill ${uvHigh ? 'is-uv-warning' : ''}">
            <span class="w-label">UV Máx</span>
            <span class="w-val">☀️ ${uv}</span>
          </div>
          <div class="weather-stat-pill">
            <span class="w-label">Viento</span>
            <span class="w-val">💨 ${c.windSpeed ?? 3} ${c.windUnit || 'km/h'}</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------ Recomendaciones (ML) ------------------------ */
  async function afterHome() {
    renderHomeWeather();
    const slot = document.getElementById('reco-slot');
    if (!slot || !state.user) return;
    try {
      const data = await request('/api/recomendaciones?limit=4');
      const current = document.getElementById('reco-slot');
      if (!current || !data.recomendaciones.length) return;
      current.innerHTML = `
        <div class="section-heading">
          <div><h2>Recomendado para ti</h2><p>Actividades sugeridas según lo que haces en el campus.</p></div>
          <span class="f-badge">✦ ML · factorización de matrices</span>
        </div>
        <div class="f-reco-list">${data.recomendaciones.map(({ activity, reason }) => `
          <div class="f-reco">
            <strong>${activityIcon(activity.category)} ${esc(activity.title)}</strong>
            <small>${esc(activity.category)} · ${esc(activity.location)} · ${activity.remaining} cupo${activity.remaining === 1 ? '' : 's'}</small>
            <small>${esc(reason)}</small>
            <div><button class="outline-button" type="button" data-f="enroll" data-id="${activity.id}">Unirme</button></div>
          </div>`).join('')}</div>`;
      current.hidden = false;
    } catch { /* las recomendaciones son opcionales */ }
  }

  /* ------------------------------ Contacto ------------------------------ */
  function renderContact() {
    page().innerHTML = `
      <div class="f-page">
        ${head('Ayuda', 'Contacto', 'Cuéntanos tu consulta, sugerencia o reclamo. El equipo la revisa desde Administración.')}
        <section class="surface-card f-card">
          <form id="f-contact-form">
            <label class="f-label" for="f-contact-subject">Asunto (opcional)</label>
            <input id="f-contact-subject" class="f-input" maxlength="120" />
            <label class="f-label" for="f-contact-message">Mensaje</label>
            <textarea id="f-contact-message" class="f-textarea" minlength="10" maxlength="1500" required placeholder="Escribe aquí tu mensaje…"></textarea>
            <div class="f-row" style="margin-top:14px"><button class="primary-button" type="submit">Enviar mensaje</button></div>
          </form>
        </section>
      </div>`;
  }

  async function submitContact(form) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await request('/api/contacto', {
        method: 'POST',
        body: { subject: form.querySelector('#f-contact-subject').value, message: form.querySelector('#f-contact-message').value },
      });
      showToast(`✉️ ${data.message}`);
      form.reset();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  /* --------------------------- Administración --------------------------- */
  const ADMIN_TABS = [['estado', 'Servicios'], ['conocimiento', 'Conocimiento'], ['busqueda', 'Índice de búsqueda'], ['reportes', 'Reportes'], ['aprendizaje', 'Aprendizaje']];

  function renderAdmin() {
    if (!isAdmin()) {
      page().innerHTML = `<div class="f-page">${head('Administración', 'Acceso restringido', 'Esta sección es solo para administradores.')}</div>`;
      return;
    }
    page().innerHTML = `
      <div class="f-page">
        ${head('Administración', 'Panel de control', 'Servicios, documentos del asistente, índice de búsqueda y reportes.')}
        <div class="f-tabs">${ADMIN_TABS.map(([id, label]) => `<button type="button" class="f-chip ${f.adminTab === id ? 'is-active' : ''}" data-f="admin-tab" data-v="${id}">${label}</button>`).join('')}</div>
        <section id="f-admin-body" class="surface-card f-card"><span class="f-muted">Cargando…</span></section>
      </div>`;
    loadAdminTab();
  }

  async function loadAdminTab() {
    const body = () => document.getElementById('f-admin-body');
    try {
      if (f.adminTab === 'estado') {
        const data = await request('/api/admin/estado');
        if (!body()) return;
        body().innerHTML = `<h2>Estado de los servicios</h2>${data.servicios.map((s) => `
          <div class="f-service"><span class="f-dot ${s.activo ? '' : 'is-off'}"></span>
            <div class="f-grow"><strong>${esc(s.nombre)}</strong><div class="f-muted">${esc(s.detalle)}</div></div>
            <span class="f-badge ${s.activo ? 'is-green' : 'is-gray'}">${s.activo ? 'Conectado' : 'Respaldo local'}</span></div>`).join('')}`;
      } else if (f.adminTab === 'conocimiento') {
        const data = await request('/api/admin/conocimiento');
        if (!body()) return;
        body().innerHTML = `
          <h2>Documentos del asistente</h2>
          <p class="f-muted">Sube reglamentos o guías (.md, .txt o .pdf, hasta 10 MB). Se dividen en fragmentos y se indexan para que el asistente los consulte.</p>
          <div class="f-drop">
            <input id="f-doc-file" type="file" accept=".md,.markdown,.txt,.pdf" />
            <input id="f-doc-title" class="f-input" maxlength="120" placeholder="Título (opcional)" />
            <div><button class="primary-button" type="button" data-f="upload-doc">Subir e indexar</button></div>
            <small id="f-doc-status" class="f-muted"></small>
          </div>
          ${data.documentos.length ? `<div class="f-scroll"><table class="f-table"><thead><tr><th>Título</th><th>Fragmentos</th><th>Índice</th><th>Subido</th><th></th></tr></thead><tbody>
            ${data.documentos.map((d) => `<tr><td><strong>${esc(d.title)}</strong><div class="f-muted">${esc(d.filename)}</div></td><td>${d.chunks}</td>
              <td><span class="f-badge ${d.engine === 'qdrant' ? 'is-green' : ''}">${d.engine === 'qdrant' ? 'Qdrant' : 'SQLite'}</span></td>
              <td>${esc(timeAgo(d.createdAt))}<div class="f-muted">${esc(d.uploadedBy || '')}</div></td>
              <td><button class="text-button" type="button" data-f="delete-doc" data-id="${d.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`
            : '<p class="f-muted" style="margin-top:14px">Aún no hay documentos.</p>'}`;
      } else if (f.adminTab === 'busqueda') {
        if (!body()) return;
        body().innerHTML = `
          <h2>Índice de búsqueda</h2>
          <p class="f-muted">Reenvía todas las publicaciones y actividades al índice de Algolia. Las altas nuevas se indexan solas; usa esta sincronización completa tras cambios masivos. Sin Algolia configurado, la búsqueda consulta SQLite directamente.</p>
          <div class="f-row"><button class="primary-button" type="button" data-f="sync-index">Sincronizar ahora</button><span id="f-sync-status" class="f-muted"></span></div>`;
      } else if (f.adminTab === 'aprendizaje') {
        const data = await request('/api/admin/aprendizaje');
        if (!body()) return;
        const r = data.resumen;
        const rows = (list, withActions) => `<div class="f-scroll"><table class="f-table"><thead><tr><th>Pregunta</th><th>Respuesta</th><th>De</th>${withActions ? '<th></th>' : ''}</tr></thead><tbody>
          ${list.map((n) => `<tr><td>${esc(n.question)}</td><td>${esc(n.answer.slice(0, 240))}${n.answer.length > 240 ? '…' : ''}</td><td>${esc(n.author || '—')}<div class="f-muted">${esc(timeAgo(n.createdAt))}</div></td>
            ${withActions ? `<td class="f-actions"><button class="primary-button" type="button" data-f="learn" data-v="aprobar" data-id="${n.id}">Enseñar</button> <button class="text-button" type="button" data-f="learn" data-v="descartar" data-id="${n.id}">Descartar</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
        body().innerHTML = `
          <h2>Aprendizaje del asistente</h2>
          <div class="f-stats">
            <div class="f-stat"><b>${r.total}</b><span>Respuestas</span></div>
            <div class="f-stat"><b>${r.positivas}</b><span>👍 Útiles</span></div>
            <div class="f-stat"><b>${r.negativas}</b><span>👎 A mejorar</span></div>
            <div class="f-stat"><b>${r.sinValorar}</b><span>Sin valorar</span></div>
          </div>
          ${data.frecuentes.length ? `<h3>Temas más preguntados</h3><div class="f-chips">${data.frecuentes.map((t) => `<span class="f-badge">#${esc(t.texto)} · ${t.n}</span>`).join('')}</div>` : ''}
          <h3 style="margin-top:18px">Pendientes de enseñar (👍)</h3>
          <p class="f-muted">Revisa que la respuesta sea correcta antes de enseñársela al asistente.</p>
          ${data.pendientes.length ? rows(data.pendientes, true) : '<p class="f-muted">No hay respuestas pendientes.</p>'}
          <h3 style="margin-top:18px">Marcadas como mejorables (👎)</h3>
          ${data.negativas.length ? rows(data.negativas, false) + '<p class="f-muted">Sube un documento en “Conocimiento” con la información que falta.</p>' : '<p class="f-muted">Todavía no hay respuestas marcadas como mejorables.</p>'}`;
      } else if (f.adminTab === 'reportes') {
        const data = await request('/api/admin/reportes');
        if (!body()) return;
        const s = data.summary;
        body().innerHTML = `
          <h2>Mensajes de contacto por sentimiento</h2>
          <div class="f-stats">
            <div class="f-stat"><b>${s.total}</b><span>Total</span></div>
            <div class="f-stat"><b>${s.positivo}</b><span>Positivos</span></div>
            <div class="f-stat"><b>${s.neutral}</b><span>Neutrales</span></div>
            <div class="f-stat"><b>${s.negativo}</b><span>Negativos</span></div>
          </div>
          ${data.porDia.length ? `<div class="f-scroll"><table class="f-table"><thead><tr><th>Fecha</th><th>Positivo</th><th>Neutral</th><th>Negativo</th></tr></thead><tbody>
            ${data.porDia.map((d) => `<tr><td>${esc(formatDate(d.date))}</td><td>${d.positivo}</td><td>${d.neutral}</td><td>${d.negativo}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${data.mensajes.length ? `<div class="f-scroll"><table class="f-table"><thead><tr><th>Mensaje</th><th>Sentimiento</th><th>De</th><th>Cuándo</th></tr></thead><tbody>
            ${data.mensajes.map((m) => {
              const tag = SENTIMENT[m.sentiment];
              return `<tr><td>${m.subject ? `<strong>${esc(m.subject)}</strong><br>` : ''}${esc(m.message)}</td>
                <td>${tag ? `<span class="f-badge ${tag.cls}">${tag.label}</span><div class="f-muted">${Math.round((m.probability || 0) * 100)}%</div>` : '<span class="f-badge is-gray">Sin clasificar</span>'}</td>
                <td>${esc(m.author || '—')}</td><td>${esc(timeAgo(m.createdAt))}</td></tr>`;
            }).join('')}</tbody></table></div>` : '<p class="f-muted" style="margin-top:14px">Todavía no hay mensajes de contacto.</p>'}`;
      }
    } catch (error) {
      if (body()) body().innerHTML = `<p class="f-muted">${esc(error.message)}</p>`;
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadDocument(button) {
    const input = document.getElementById('f-doc-file');
    const status = document.getElementById('f-doc-status');
    const file = input && input.files[0];
    if (!file) { if (status) status.textContent = 'Selecciona un archivo primero.'; return; }
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'El archivo supera los 10 MB.'; return; }
    button.disabled = true;
    status.textContent = 'Procesando e indexando…';
    try {
      const contentBase64 = await readFileAsBase64(file);
      const data = await request('/api/admin/conocimiento', {
        method: 'POST',
        timeoutMs: 120000,
        body: { filename: file.name, title: document.getElementById('f-doc-title').value, contentBase64 },
      });
      showToast(`📄 “${data.documento.title}” indexado (${data.documento.chunks} fragmentos)`);
      if (data.documento.warning) showToast(data.documento.warning, true);
      await loadAdminTab();
    } catch (error) {
      if (status) status.textContent = error.message;
      button.disabled = false;
    }
  }

  async function syncIndex(button) {
    const status = document.getElementById('f-sync-status');
    button.disabled = true;
    status.textContent = 'Sincronizando…';
    try {
      const data = await request('/api/admin/search/sync', { method: 'POST', timeoutMs: 60000 });
      status.textContent = data.message || `Listo: ${data.synced} registros enviados a ${data.engine === 'algolia' ? 'Algolia' : 'el índice'} (${data.posts} publicaciones, ${data.activities} actividades).`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------ Enrutado ------------------------------ */
  function renderRoute(route) {
    if (route === 'buscar') renderSearch();
    else if (route === 'asistente') renderAssistant();
    else if (route === 'contacto') renderContact();
    else if (route === 'admin') renderAdmin();
  }

  function onUser() {
    const show = Boolean(isAdmin());
    for (const id of ['nav-admin', 'topbar-admin']) {
      const element = document.getElementById(id);
      if (element) element.hidden = !show;
    }
    if (!state.user) {
      f.chat = [];
      f.pending.clear();
      renderPending();
    }
  }

  /* ------------------------------ Eventos ------------------------------ */
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-f]');
    if (!target) return;
    const action = target.dataset.f;
    if (action === 'search-type') {
      f.searchType = target.dataset.v;
      renderSearch();
    } else if (action === 'enroll') {
      target.disabled = true;
      await enroll(target.dataset.id);
      target.disabled = false;
    } else if (action === 'suggest') {
      askAssistant(target.dataset.text);
    } else if (action === 'rate') {
      rateAnswer(Number(target.dataset.i), Number(target.dataset.v));
    } else if (action === 'forget') {
      if (!confirm('¿Borrar lo que el asistente recuerda de ti?')) return;
      try {
        await request('/api/asistente/memoria', { method: 'DELETE' });
        f.chat.forEach((m) => { delete m.logId; });
        showToast('Listo: ya no recuerdo tus conversaciones anteriores.');
        loadMemory();
      } catch (error) { showToast(error.message, true); }
    } else if (action === 'learn') {
      target.disabled = true;
      try {
        await request(`/api/admin/aprendizaje/${target.dataset.id}`, { method: 'POST', body: { action: target.dataset.v } });
        showToast(target.dataset.v === 'aprobar' ? '✅ El asistente aprendió esta respuesta' : 'Respuesta descartada');
        loadAdminTab();
      } catch (error) { showToast(error.message, true); target.disabled = false; }
    } else if (action === 'admin-tab') {
      f.adminTab = target.dataset.v;
      renderAdmin();
    } else if (action === 'upload-doc') {
      uploadDocument(target);
    } else if (action === 'sync-index') {
      syncIndex(target);
    } else if (action === 'delete-doc') {
      if (!confirm('¿Eliminar este documento del asistente?')) return;
      try {
        await request(`/api/admin/conocimiento/${target.dataset.id}`, { method: 'DELETE' });
        showToast('Documento eliminado');
        loadAdminTab();
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });

  document.addEventListener('submit', (event) => {
    const id = event.target.id;
    if (id === 'f-search-form') {
      event.preventDefault();
      f.searchQuery = document.getElementById('f-search-q').value;
      runSearch();
    } else if (id === 'f-chat-form') {
      event.preventDefault();
      const input = document.getElementById('f-chat-input');
      const text = input.value;
      input.value = '';
      askAssistant(text);
    } else if (id === 'f-contact-form') {
      event.preventDefault();
      submitContact(event.target);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id !== 'f-search-q') return;
    f.searchQuery = event.target.value;
    clearTimeout(f.searchTimer);
    f.searchTimer = setTimeout(runSearch, 350);
  });

  window.PrismFeatures = { isFeatureRoute, renderRoute, afterHome, enroll, bindSocket, onUser, fetchCampusWeather };
  setTimeout(() => { fetchCampusWeather().catch(() => {}); }, 300);
}());

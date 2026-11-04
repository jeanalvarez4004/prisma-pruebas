'use strict';

/**
 * Experiencia de uso de PRISM: sonidos suaves (WebAudio, sin archivos), efecto ripple,
 * animaciones de entrada por sección y avisos con campana. Todo se puede silenciar con el
 * botón de volumen de la barra superior; respeta "reducir movimiento" del sistema.
 */
(function () {
  const STORE = 'prism-sound';
  let enabled = true;
  try { enabled = localStorage.getItem(STORE) !== 'off'; } catch { /* sin almacenamiento */ }

  /* ------------------------------ Sonidos ------------------------------ */
  let ctx = null;
  function audio() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, duration, type = 'sine', volume = 0.05) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  const SOUNDS = {
    tap: () => tone(520, 0, 0.06, 'triangle', 0.03),
    nav: () => { tone(392, 0, 0.07, 'sine', 0.04); tone(587, 0.05, 0.1, 'sine', 0.04); },
    ok: () => { tone(659, 0, 0.1, 'sine', 0.055); tone(880, 0.09, 0.18, 'sine', 0.055); },
    err: () => { tone(247, 0, 0.14, 'sawtooth', 0.03); tone(185, 0.1, 0.2, 'sawtooth', 0.03); },
    send: () => { tone(440, 0, 0.05, 'triangle', 0.045); tone(720, 0.04, 0.09, 'triangle', 0.045); },
    pop: () => { tone(300, 0, 0.05, 'sine', 0.06); tone(640, 0.03, 0.08, 'sine', 0.05); },
    bell: () => { tone(988, 0, 0.18, 'sine', 0.055); tone(1319, 0.12, 0.3, 'sine', 0.05); },
    recv: () => tone(740, 0, 0.1, 'sine', 0.035),
  };

  function play(name) {
    if (!enabled) return;
    try { if (SOUNDS[name]) SOUNDS[name](); } catch { /* el audio es opcional */ }
  }

  /* ---------------------- Botón de sonido (barra) ---------------------- */
  function paintToggle() {
    const button = document.getElementById('sound-toggle');
    if (!button) return;
    button.textContent = enabled ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Silenciar sonidos' : 'Activar sonidos';
    button.setAttribute('aria-label', button.title);
  }

  function toggleSound() {
    enabled = !enabled;
    try { localStorage.setItem(STORE, enabled ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
    paintToggle();
    play('ok');
  }

  /* ----------------------------- Ripple + sonidos ----------------------------- */
  const RIPPLE = '.primary-button, .secondary-button, .outline-button, .ghost-button, .f-chip, .nav-item, .mobile-nav-item, .icon-button, .auth-tab';

  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest(RIPPLE);
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const ripple = document.createElement('span');
    ripple.className = 'ux-ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.classList.add('ux-ripple-host');
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  }, { passive: true });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#sound-toggle')) { toggleSound(); return; }
    const target = event.target.closest('button, a, .story');
    if (!target || target.disabled) return;
    if (target.matches('[data-action="like-post"]')) {
      target.classList.add('ux-pop');
      setTimeout(() => target.classList.remove('ux-pop'), 450);
      play('pop');
    } else if (target.matches('[data-route], [data-f="admin-tab"], [data-f="search-type"], .auth-tab')) {
      play('nav');
    } else if (target.matches('[data-f="rate"]')) {
      play(target.dataset.v === 'up' ? 'ok' : 'tap');
    } else {
      play('tap');
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.matches('#f-chat-form, #chat-form')) play('send');
  });

  /* ----------------------- Entrada animada por sección ----------------------- */
  const content = document.getElementById('page-content');
  let enterTimer = null;
  let lastEnter = 0;

  function animateEnter() {
    if (!content) return;
    lastEnter = Date.now();
    content.classList.remove('ux-enter');
    void content.offsetWidth; // reinicia la animación
    content.classList.add('ux-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => content.classList.remove('ux-enter'), 1100);
    setTimeout(countUp, 120);
  }

  function countUp() {
    document.querySelectorAll('.profile-stat strong, .f-stat b').forEach((node) => {
      const end = Number(node.textContent);
      if (!Number.isFinite(end) || end <= 0 || node.dataset.counted) return;
      node.dataset.counted = '1';
      const started = performance.now();
      const tick = (now) => {
        const progress = Math.min((now - started) / 700, 1);
        node.textContent = String(Math.round(end * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  window.addEventListener('hashchange', animateEnter);
  document.addEventListener('DOMContentLoaded', () => { paintToggle(); animateEnter(); });
  if (document.readyState !== 'loading') { paintToggle(); animateEnter(); }

  // Después de iniciar sesión la app se muestra de golpe: también se anima.
  const shell = document.getElementById('app-shell');
  if (shell) new MutationObserver(() => { if (!shell.hidden) animateEnter(); }).observe(shell, { attributes: true, attributeFilter: ['hidden'] });

  /* ------------------------------- Avisos ------------------------------- */
  const toast = document.getElementById('toast');
  if (toast) {
    let lastText = '';
    new MutationObserver(() => {
      if (toast.hidden) { lastText = ''; return; }
      const text = toast.textContent;
      if (text === lastText) return;
      lastText = text;
      play(toast.classList.contains('is-error') ? 'err' : 'ok');
    }).observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  }

  const counter = document.getElementById('notification-count');
  if (counter) {
    let previous = Number(counter.textContent) || 0;
    new MutationObserver(() => {
      const current = counter.hidden ? 0 : Number(counter.textContent) || 0;
      if (current > previous) {
        play('bell');
        const bell = document.getElementById('notification-toggle');
        if (bell) { bell.classList.remove('bell-ring'); void bell.offsetWidth; bell.classList.add('bell-ring'); }
      }
      previous = current;
    }).observe(counter, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  // Mensajes nuevos del chat (no los del historial inicial).
  if (content) {
    new MutationObserver((mutations) => {
      if (Date.now() - lastEnter < 1500) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('chat-msg') && !node.classList.contains('me')) {
            play('recv');
            return;
          }
        }
      }
    }).observe(content, { childList: true, subtree: true });
  }

  window.PrismUX = { play };
}());

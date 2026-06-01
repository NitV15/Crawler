// Shared auth utilities: theme toggle, inactivity timer, auth-check redirect
(function () {
  'use strict';

  // ── Theme ────────────────────────────────────────────────────────────────────
  const THEME_KEY = 'cm_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const moon = document.getElementById('btn-moon');
    const sun = document.getElementById('btn-sun');
    if (moon) moon.style.background = theme === 'dark' ? 'var(--accent)' : 'var(--toggle-inactive)';
    if (sun) sun.style.background = theme === 'light' ? 'var(--accent)' : 'var(--toggle-inactive)';
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  // ── Auth check redirect ───────────────────────────────────────────────────────
  async function requirePortalAuth(expectedType, loginUrl) {
    // When browser restores this page from bfcache (back button after logout),
    // re-verify auth and kick out immediately if the session is gone.
    window.addEventListener('pageshow', function(evt) {
      if (evt.persisted) {
        fetch('/api/auth/me').then(function(r) {
          if (!r.ok) window.location.replace(loginUrl);
          else r.json().then(function(u) { if (u.type !== expectedType) window.location.replace(loginUrl); });
        }).catch(function() { window.location.replace(loginUrl); });
      }
    });
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { window.location.replace(loginUrl); return null; }
      const user = await res.json();
      if (user.type !== expectedType) { window.location.replace(loginUrl); return null; }
      return user;
    } catch {
      window.location.replace(loginUrl);
      return null;
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────────
  async function logout(loginUrl) {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.replace(loginUrl);
  }

  // ── Inactivity timer ─────────────────────────────────────────────────────────
  const IDLE_MS = 15 * 60 * 1000;
  const WARN_S = 60;
  let idleTimer;
  let countdownInterval;

  function resetIdleTimer(loginUrl) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => showCountdown(loginUrl), IDLE_MS);
  }

  function initIdleTimer(loginUrl) {
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(e =>
      document.addEventListener(e, () => resetIdleTimer(loginUrl), { passive: true })
    );
    resetIdleTimer(loginUrl);
  }

  function showCountdown(loginUrl) {
    const overlay = document.getElementById('idle-overlay');
    const ring = document.getElementById('idle-ring-fill');
    const seconds = document.getElementById('idle-seconds');
    if (!overlay) return;
    overlay.style.display = 'flex';
    let remaining = WARN_S;
    function tick() {
      remaining--;
      if (seconds) seconds.textContent = remaining;
      const warnEl = document.getElementById('idle-warn-s');
      if (warnEl) warnEl.textContent = remaining;
      if (ring) {
        const pct = (remaining / WARN_S) * 100;
        ring.style.background = `conic-gradient(var(--warn) ${pct}%, var(--border) ${pct}%)`;
      }
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        logout(loginUrl);
      }
    }
    if (seconds) seconds.textContent = remaining;
    countdownInterval = setInterval(tick, 1000);
  }

  function dismissCountdown(loginUrl) {
    const overlay = document.getElementById('idle-overlay');
    if (overlay) overlay.style.display = 'none';
    clearInterval(countdownInterval);
    resetIdleTimer(loginUrl);
  }

  // ── OTP input helpers ────────────────────────────────────────────────────────
  function initOtpInputs() {
    const boxes = document.querySelectorAll('.otp-box');
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(0, 1);
        if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        syncOtpHidden();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
      });
      box.addEventListener('paste', e => {
        e.preventDefault();
        const digits = (e.clipboardData.getData('text').replace(/\D/g, '')).slice(0, 6);
        digits.split('').forEach((d, j) => { if (boxes[j]) boxes[j].value = d; });
        syncOtpHidden();
        if (boxes[digits.length - 1]) boxes[digits.length - 1].focus();
      });
    });
  }

  function syncOtpHidden() {
    const boxes = document.querySelectorAll('.otp-box');
    const hidden = document.getElementById('otp-hidden');
    if (hidden) hidden.value = Array.from(boxes).map(b => b.value).join('');
  }

  function getOtpValue() {
    return Array.from(document.querySelectorAll('.otp-box')).map(b => b.value).join('');
  }

  // ── Expose ───────────────────────────────────────────────────────────────────
  window.CmAuth = {
    initTheme,
    toggleTheme,
    requirePortalAuth,
    logout,
    initIdleTimer,
    dismissCountdown,
    initOtpInputs,
    getOtpValue,
  };
})();

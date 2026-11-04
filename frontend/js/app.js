/* ============================================================
   app.js - Shared UI behaviour
   - Mobile hamburger menu
   - Active navigation state
   - Dark/Light Theme Switcher
   - Global Quick Search Bar
   ============================================================ */

(function () {
  'use strict';

  const nav = document.getElementById('mainNav');
  const toggle = document.getElementById('navToggle');

  /* ---- Dark/Light Mode Theme Switcher ---- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    if (document.body) {
      document.body.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem('apix_theme', theme);
    } catch (e) {
      console.warn('localStorage access denied');
    }

    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
      const isDark = theme === 'dark';
      themeToggleBtn.innerHTML = isDark
        ? '<span class="theme-icon">&#9728;</span><span>Light</span>'
        : '<span class="theme-icon">&#9790;</span><span>Dark</span>';
      themeToggleBtn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }

    try {
      window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: theme } }));
    } catch (e) {}
  }

  function initTheme() {
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('apix_theme');
    } catch (e) {}

    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = document.documentElement.getAttribute('data-theme') || savedTheme || (prefersDark ? 'dark' : 'light');

    setTheme(initialTheme);

    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', function () {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
      });
    }
  }

  /* ---- Global Search Bar ---- */
  function initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const dropdown = document.getElementById('globalSearchResults');
    if (!input || !dropdown) return;

    let metaCache = null;
    let debounceTimer = null;

    input.addEventListener('focus', async () => {
      if (!metaCache && window.apiFetch) {
        try {
          const res = await window.apiFetch('/meta');
          metaCache = res || {};
        } catch (e) {
          metaCache = {};
        }
      }
    });

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = input.value.trim().toUpperCase();
        if (query.length < 2) {
          dropdown.classList.remove('open');
          dropdown.innerHTML = '';
          return;
        }

        renderSearchResults(query, metaCache || {}, dropdown);
      }, 200);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }

  function renderSearchResults(q, meta, dropdown) {
    let html = '';
    const origins = meta.origins || ['DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA'];
    const airlines = meta.airlines || ['Air India', 'IndiGo', 'Akasa Air', 'SpiceJet', 'Air India Express'];

    const matchedAirports = origins.filter(a => a.includes(q));
    const matchedAirlines = airlines.filter(a => a.toUpperCase().includes(q));

    let count = 0;

    if (matchedAirports.length) {
      html += '<div class="search-group__title">Airports & Routes</div>';
      matchedAirports.forEach(a => {
        if (count++ < 5) {
          html += `<a href="routes.html?origin=${a}" class="search-item">` +
            `<span>✈️ Origin: <strong>${a}</strong></span>` +
            `<span style="font-size:0.75rem; color:#2563eb;">Filter Route &rarr;</span>` +
          `</a>`;
        }
      });
    }

    if (matchedAirlines.length) {
      html += '<div class="search-group__title">Airline Carriers</div>';
      matchedAirlines.forEach(a => {
        if (count++ < 8) {
          html += `<a href="routes.html?airline=${encodeURIComponent(a)}" class="search-item">` +
            `<span>🛫 <strong>${a}</strong></span>` +
            `<span style="font-size:0.75rem; color:#2563eb;">View Fares &rarr;</span>` +
          `</a>`;
        }
      });
    }

    if (q.includes('-') || q.length >= 6) {
      const parts = q.split('-');
      const orig = parts[0] || q.slice(0, 3);
      const dest = parts[1] || q.slice(3, 6);
      html += '<div class="search-group__title">Sector Analysis</div>';
      html += `<a href="routes.html?origin=${orig}&destination=${dest}" class="search-item">` +
        `<span>🗺️ Sector: <strong>${orig} &rarr; ${dest}</strong></span>` +
        `<span style="font-size:0.75rem; color:#2563eb; font-weight:700;">Open &rarr;</span>` +
      `</a>`;
    }

    if (!html) {
      html = '<div class="search-item" style="color:#64748b;">No matching airports or carriers found.</div>';
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('open');
  }

  /* ---- Mobile hamburger menu ---- */
  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openNav() {
    if (!nav || !toggle) return;
    nav.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') &&
          !nav.contains(e.target) &&
          !toggle.contains(e.target)) {
        closeNav();
      }
    });
  }

  /* ---- Active navigation state ---- */
  function setActiveNav() {
    if (!nav) return;
    const current = window.location.pathname.split('/').pop() || 'index.html';
    nav.querySelectorAll('a').forEach(function (link) {
      const href = link.getAttribute('href');
      if (href === current) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
  }

  /* ---- Real-Time SSE Stream Listener ---- */
  function initLiveStream() {
    if (!window.EventSource) return;

    try {
      const source = new EventSource('/api/stream');

      source.onmessage = function (event) {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'connected') {
            console.log('⚡ SSE Stream Connected:', payload.message);
          } else if (payload.type === 'quote_update') {
            // Dispatch custom event for other modules (e.g. data monitor terminal log)
            window.dispatchEvent(new CustomEvent('apix_quote_update', { detail: payload.data }));
          }
        } catch (err) {
          console.warn('SSE message parse error:', err);
        }
      };
    } catch (e) {
      console.warn('EventSource error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initGlobalSearch();
    setActiveNav();
    initLiveStream();
  });
})();

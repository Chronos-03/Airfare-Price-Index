/* ============================================================
   api.js - Shared API helper
   Provides window.API_BASE_URL and window.apiFetch().
   The base URL is same-origin by default (the Express backend serves
   both the static frontend and the /api routes). Override by defining
   window.AIRFARE_API_URL BEFORE this script is loaded.
   ============================================================ */
(function () {
  'use strict';

  window.API_BASE_URL = window.AIRFARE_API_URL || (window.location.origin + '/api');

  window.apiFetch = function (path, options) {
    options = options || {};
    if (options.body && (!options.headers || !options.headers['Content-Type'])) {
      options.headers = options.headers || {};
      options.headers['Content-Type'] = 'application/json';
    }

    return fetch(window.API_BASE_URL + path, options).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var msg = (body && body.error && body.error.message) ||
                    ('Request failed (' + res.status + ')');
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  };
})();

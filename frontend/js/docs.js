/**
 * Documentation Portal Interactive Logic (docs.js)
 * Handles live REST API requests, code snippet generation, and tab switching.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Render Math with KaTeX if available
  function triggerKaTeX() {
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(document.body, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\[', right: '\\]', display: true},
            {left: '\\(', right: '\\)', display: false},
            {left: '$', right: '$', display: false}
          ],
          throwOnError: false
        });
      } catch (e) {
        console.warn('KaTeX render error:', e);
      }
    }
  }

  triggerKaTeX();
  setTimeout(triggerKaTeX, 500);
  setTimeout(triggerKaTeX, 1500);

  const endpointSelect = document.getElementById('apiEndpointSelect');
  const btnRunTest = document.getElementById('btnRunApiTest');
  const codeDisplay = document.getElementById('apiCodeDisplay');
  const tabBtns = document.querySelectorAll('.api-tab');
  const navLinks = document.querySelectorAll('.docs-nav__item a');

  let currentTab = 'response';
  let lastResponseData = null;

  // Add Copy to Clipboard button to IDE console body
  const consoleBody = document.querySelector('.api-console__body');
  if (consoleBody) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '&#128203; Copy';
    copyBtn.title = 'Copy code snippet';
    copyBtn.addEventListener('click', () => {
      const textToCopy = codeDisplay.textContent;
      navigator.clipboard.writeText(textToCopy).then(() => {
        copyBtn.innerHTML = '&#10003; Copied!';
        setTimeout(() => { copyBtn.innerHTML = '&#128203; Copy'; }, 2000);
      }).catch(err => {
        console.error('Copy failed', err);
      });
    });
    consoleBody.appendChild(copyBtn);
  }

  // Tab Switching (Response JSON / cURL / JS Fetch / Python)
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderCodeView();
    });
  });

  // Sidebar Scroll Spy Highlight
  window.addEventListener('scroll', () => {
    let current = '';
    const sections = document.querySelectorAll('.docs-section');
    sections.forEach((sec) => {
      const sectionTop = sec.offsetTop - 120;
      if (window.scrollY >= sectionTop) {
        current = sec.getAttribute('id');
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });

  // Run API Test Button Click
  async function fetchEndpointData() {
    const endpoint = endpointSelect.value;
    codeDisplay.textContent = `[FETCHING] Requesting ${endpoint} live from server...`;
    
    try {
      const res = await fetch(endpoint);
      if (endpoint.includes('format=csv')) {
        const text = await res.text();
        lastResponseData = text;
      } else {
        const json = await res.json();
        lastResponseData = json;
      }
      renderCodeView();
    } catch (err) {
      lastResponseData = { error: `Failed to connect to ${endpoint}`, details: err.message };
      renderCodeView();
    }
  }

  btnRunTest.addEventListener('click', fetchEndpointData);
  endpointSelect.addEventListener('change', fetchEndpointData);

  // Render view based on active tab
  function renderCodeView() {
    const endpoint = endpointSelect.value;
    const origin = window.location.origin;
    const fullUrl = `${origin}${endpoint}`;

    if (currentTab === 'response') {
      if (typeof lastResponseData === 'string') {
        codeDisplay.textContent = lastResponseData;
      } else if (lastResponseData) {
        codeDisplay.textContent = JSON.stringify(lastResponseData, null, 2);
      } else {
        codeDisplay.textContent = `Click 'Execute Endpoint' to fetch live data from ${endpoint}`;
      }
    } else if (currentTab === 'curl') {
      codeDisplay.textContent = `curl -X GET "${fullUrl}" \\\n  -H "Accept: application/json"`;
    } else if (currentTab === 'js') {
      codeDisplay.textContent = `fetch("${fullUrl}")\n  .then(res => res.json())\n  .then(data => console.log(data))\n  .catch(err => console.error(err));`;
    } else if (currentTab === 'python') {
      codeDisplay.textContent = `import requests\n\nurl = "${fullUrl}"\nresponse = requests.get(url)\ndata = response.json()\nprint(data)`;
    }
  }

  // Auto-run first API test on load
  btnRunTest.click();
});

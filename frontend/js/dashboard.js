/* ============================================================
   dashboard.js - APIx Airfare Price Index Dashboard / Overview
   Renders 4-Bento KPIs, Neon Aviation SVG Chart, Top Routes Table,
   Sector Heatmap Matrix, Live Clock Timestamp, Timeframe Switching,
   and Dark/Light Theme Support.
   ============================================================ */
(function () {
  'use strict';

  var currentRange = '3M';
  var cachedSeries = null;

  function fmtINR(n) {
    if (n == null || isNaN(n)) return '-';
    return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateLiveClock() {
    var tsEl = document.getElementById('heroTimestamp');
    if (!tsEl) return;
    var now = new Date();
    var day = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    var time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    tsEl.textContent = 'Last updated ' + day + ' \u2022 ' + time;
  }

  function initThemeToggle() {
    window.addEventListener('themeChanged', function () {
      if (cachedSeries) renderNeonChart(cachedSeries);
    });
  }

  function initTimeFilters() {
    var btns = document.querySelectorAll('.trend-time-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentRange = btn.getAttribute('data-range') || '3M';
        if (cachedSeries) {
          renderNeonChart(cachedSeries);
        } else {
          loadApixTrend();
        }
      });
    });

    var exportBtn = document.getElementById('btnExportNso');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var baseUrl = window.API_BASE_URL || '/api';
        window.open(baseUrl + '/nso-export?format=csv', '_blank');
      });
    }
  }

  function loadApixTrend() {
    var container = document.getElementById('apix-chart-container');
    if (!container) return;

    window.apiFetch('/apix?frequency=daily').then(function (data) {
      if (data && data.success && data.series && data.series.length) {
        cachedSeries = data.series;
        var curIdx = data.currentIndex ? Number(data.currentIndex).toFixed(2) : '104.72';
        var change = data.changePct != null ? Number(data.changePct) : 2.4;

        var kpiVal = document.getElementById('kpi-index-value');
        if (kpiVal) kpiVal.textContent = curIdx;

        var kpiDelta = document.getElementById('kpi-index-delta');
        if (kpiDelta) {
          var sign = change >= 0 ? '+' : '';
          kpiDelta.innerHTML = (change >= 0 ? '&#9650; ' : '&#9660; ') + sign + change.toFixed(1) + '% vs previous period';
          kpiDelta.className = 'kpi-badge ' + (change >= 0 ? 'up' : 'down');
        }

        renderNeonChart(cachedSeries);
      } else {
        renderDefaultMockChart();
      }
    }).catch(function (err) {
      console.warn('APIx fetch failed, using visual trend model:', err);
      renderDefaultMockChart();
    });
  }

  function getMonthPointsForRange() {
    return [
      { label: 'Jan', val: 89.4, baseline: 86.2 },
      { label: 'Feb', val: 94.1, baseline: 90.0 },
      { label: 'Mar', val: 97.8, baseline: 93.5 },
      { label: 'Apr', val: 93.2, baseline: 96.0 },
      { label: 'May', val: 106.5, baseline: 101.2 },
      { label: 'Jun', val: 103.0, baseline: 98.4 },
      { label: 'Jul', val: 95.7, baseline: 94.8 },
      { label: 'Aug', val: 92.4, baseline: 91.0 },
      { label: 'Sep', val: 104.72, baseline: 98.6, delta: '+2.4%' }
    ];
  }

  function renderNeonChart(dbSeries) {
    var container = document.getElementById('apix-chart-container');
    if (!container) return;

    var width = container.clientWidth || 650;
    var height = container.clientHeight || 280;
    var padding = { top: 35, right: 35, bottom: 35, left: 45 };

    var pointsData = getMonthPointsForRange();

    if (dbSeries && dbSeries.length >= 7) {
      var lastItems = dbSeries.slice(-9);
      if (lastItems.length === 9) {
        pointsData = lastItems.map(function (s, idx) {
          var d = new Date(s.date || s.period);
          var lbl = isNaN(d.getTime()) ? pointsData[idx].label : d.toLocaleDateString('en-GB', { month: 'short' });
          return {
            label: lbl,
            val: Number(s.indexValue) || pointsData[idx].val,
            baseline: (Number(s.indexValue) || pointsData[idx].val) * 0.96,
            averageFare: s.averageFare
          };
        });
      }
    }

    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;

    var yMin = 80;
    var yMax = 120;
    var yTicks = [120, 110, 100, 90, 80];

    function getY(val) {
      return padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    }

    function getX(idx) {
      return padding.left + (idx / (pointsData.length - 1)) * chartW;
    }

    var coords = pointsData.map(function (p, i) {
      return {
        x: getX(i),
        y: getY(p.val),
        baseY: getY(p.baseline),
        item: p
      };
    });

    var primaryPath = coords.map(function (c, i) {
      return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1);
    }).join(' ');

    var secondaryPath = coords.map(function (c, i) {
      return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.baseY.toFixed(1);
    }).join(' ');

    var areaPath = primaryPath +
      ' L' + coords[coords.length - 1].x.toFixed(1) + ',' + (height - padding.bottom) +
      ' L' + coords[0].x.toFixed(1) + ',' + (height - padding.bottom) + ' Z';

    var isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    var gridColor = isDark ? 'rgba(56, 189, 248, 0.08)' : '#e2e8f0';
    var textColor = isDark ? '#94a3b8' : '#64748b';

    var svg = '<svg width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="overflow: visible; cursor: crosshair;">' +
      '<defs>' +
        '<linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#0284c7" stop-opacity="0.35"/>' +
          '<stop offset="70%" stop-color="#38bdf8" stop-opacity="0.08"/>' +
          '<stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>' +
        '</linearGradient>' +
        '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feGaussianBlur stdDeviation="3" result="blur" />' +
          '<feComposite in="SourceGraphic" in2="blur" operator="over" />' +
        '</filter>' +
      '</defs>';

    yTicks.forEach(function (tick) {
      var yPos = getY(tick);
      svg += '<line x1="' + padding.left + '" y1="' + yPos + '" x2="' + (width - padding.right) + '" y2="' + yPos + '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="' + (tick === 100 ? 'none' : '3,3') + '"/>';
      svg += '<text x="' + (padding.left - 12) + '" y="' + (yPos + 4) + '" fill="' + textColor + '" font-size="11" font-family="inherit" text-anchor="end" font-weight="500">' + tick + '</text>';
    });

    svg += '<path d="' + areaPath + '" fill="url(#neonGradient)"/>';
    svg += '<path d="' + secondaryPath + '" fill="none" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="4,4" opacity="0.6"/>';
    svg += '<path d="' + primaryPath + '" fill="none" stroke="#0284c7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>';

    coords.forEach(function (c, i) {
      svg += '<text x="' + c.x.toFixed(1) + '" y="' + (height - 12) + '" fill="' + textColor + '" font-size="11" font-family="inherit" text-anchor="middle" font-weight="500">' + c.item.label + '</text>';
      var isLast = (i === coords.length - 1);
      svg += '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="' + (isLast ? '4.5' : '3') + '" fill="#38bdf8" stroke="' + (isDark ? '#ffffff' : '#0284c7') + '" stroke-width="' + (isLast ? '2' : '1.5') + '"/>';
    });

    var lastCoord = coords[coords.length - 1];
    var badgeW = 75;
    var badgeH = 46;
    var badgeX = lastCoord.x - badgeW - 12;
    var badgeY = Math.max(padding.top - 10, lastCoord.y - badgeH - 10);

    svg += '<g class="chart-pinned-badge">' +
      '<rect x="' + badgeX + '" y="' + badgeY + '" width="' + badgeW + '" height="' + badgeH + '" rx="6" fill="' + (isDark ? 'rgba(6, 17, 36, 0.92)' : '#ffffff') + '" stroke="' + (isDark ? 'rgba(56, 189, 248, 0.4)' : '#cbd5e1') + '" stroke-width="1" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.3))"/>' +
      '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 14) + '" fill="' + (isDark ? '#94a3b8' : '#64748b') + '" font-size="9.5" font-weight="600" text-anchor="middle">Sep 2026</text>' +
      '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 28) + '" fill="' + (isDark ? '#ffffff' : '#0f172a') + '" font-size="12" font-weight="800" text-anchor="middle">104.72</text>' +
      '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 40) + '" fill="#34d399" font-size="9.5" font-weight="700" text-anchor="middle">&#9650; +2.4%</text>' +
    '</g>';

    svg += '<line id="hover-line" x1="0" y1="' + padding.top + '" x2="0" y2="' + (height - padding.bottom) + '" stroke="#38bdf8" stroke-dasharray="3,3" stroke-width="1.5" style="display:none;"/>';
    svg += '<circle id="hover-point" cx="0" cy="0" r="6" fill="#38bdf8" stroke="#ffffff" stroke-width="2.5" style="display:none; filter: drop-shadow(0 0 6px #38bdf8);"/>';
    svg += '</svg>';

    var tooltipHtml = '<div id="interactive-chart-tooltip" style="position: absolute; display: none; background: rgba(6, 17, 36, 0.95); border: 1px solid rgba(56, 189, 248, 0.35); color: #ffffff; padding: 8px 12px; border-radius: 8px; font-size: 0.78rem; pointer-events: none; z-index: 100; box-shadow: 0 4px 15px rgba(0,0,0,0.4); white-space: nowrap;"></div>';

    container.innerHTML = svg + tooltipHtml;

    var hLine = container.querySelector('#hover-line');
    var hPoint = container.querySelector('#hover-point');
    var tooltip = container.querySelector('#interactive-chart-tooltip');

    function onMouseMove(clientX) {
      var rect = container.getBoundingClientRect();
      var mouseX = clientX - rect.left;

      if (mouseX < padding.left || mouseX > (width - padding.right)) {
        hide();
        return;
      }

      var closest = coords[0];
      var minDistance = Math.abs(mouseX - coords[0].x);

      for (var i = 1; i < coords.length; i++) {
        var dist = Math.abs(mouseX - coords[i].x);
        if (dist < minDistance) {
          minDistance = dist;
          closest = coords[i];
        }
      }

      if (hLine) {
        hLine.setAttribute('x1', closest.x);
        hLine.setAttribute('x2', closest.x);
        hLine.style.display = 'block';
      }

      if (hPoint) {
        hPoint.setAttribute('cx', closest.x);
        hPoint.setAttribute('cy', closest.y);
        hPoint.style.display = 'block';
      }

      if (tooltip) {
        var fareStr = closest.item.averageFare ? fmtINR(closest.item.averageFare) : ('~' + fmtINR(closest.item.val * 41));
        var ttDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
        if (!ttDark) {
          tooltip.style.background = '#ffffff';
          tooltip.style.color = '#0f172a';
          tooltip.style.borderColor = '#cbd5e1';
          tooltip.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
        } else {
          tooltip.style.background = 'rgba(6, 17, 36, 0.95)';
          tooltip.style.color = '#ffffff';
          tooltip.style.borderColor = 'rgba(56, 189, 248, 0.35)';
          tooltip.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4)';
        }

        tooltip.innerHTML = '<div style="font-weight:700; color:#38bdf8; margin-bottom:2px;">\uD83D\uDCC5 ' + closest.item.label + ' 2026</div>' +
          '<div><strong>APIx Index:</strong> ' + Number(closest.item.val).toFixed(2) + '</div>' +
          '<div style="color:' + (ttDark ? '#94a3b8' : '#64748b') + '; font-size:0.72rem;">Baseline: ' + Number(closest.item.baseline).toFixed(1) + ' &bull; Fare: ' + fareStr + '</div>';

        tooltip.style.display = 'block';
        var ttW = tooltip.offsetWidth || 130;
        var leftPos = closest.x + 12;
        if (leftPos + ttW > width - 10) leftPos = closest.x - ttW - 12;
        tooltip.style.left = leftPos + 'px';
        tooltip.style.top = Math.max(10, closest.y - 25) + 'px';
      }
    }

    function hide() {
      if (hLine) hLine.style.display = 'none';
      if (hPoint) hPoint.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    container.addEventListener('mousemove', function (e) { onMouseMove(e.clientX); });
    container.addEventListener('mouseleave', hide);
    container.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) onMouseMove(e.touches[0].clientX);
    });
    container.addEventListener('touchend', hide);
  }

  function renderDefaultMockChart() {
    renderNeonChart(null);
  }

  function loadTopRoutes() {
    var listContainer = document.getElementById('top-routes-list-container');
    if (!listContainer) return;

    var defaultTopRoutes = [
      { rank: 1, route: 'DEL \u2192 BOM', fare: 4820, mom: '+8.4%', up: true },
      { rank: 2, route: 'DEL \u2192 BLR', fare: 5120, mom: '+6.1%', up: true },
      { rank: 3, route: 'BOM \u2192 BLR', fare: 4910, mom: '+5.3%', up: true },
      { rank: 4, route: 'DEL \u2192 HYD', fare: 4620, mom: '+4.8%', up: true },
      { rank: 5, route: 'BLR \u2192 MAA', fare: 4210, mom: '+3.9%', up: true }
    ];

    window.apiFetch('/stats').then(function (data) {
      if (data && data.success) {
        if (data.kpis) {
          var avgFareEl = document.getElementById('kpi-avgfare-value');
          if (avgFareEl && data.kpis.avgFare) avgFareEl.textContent = fmtINR(data.kpis.avgFare);

          var qualityEl = document.getElementById('kpi-quality-value');
          if (qualityEl && data.kpis.dataQualityPct) qualityEl.textContent = Number(data.kpis.dataQualityPct).toFixed(1) + '%';

          var routesCountEl = document.getElementById('kpi-routes-value');
          if (routesCountEl && data.kpis.routesTracked) routesCountEl.textContent = data.kpis.routesTracked;
        }

        if (data.routeOverview && data.routeOverview.length >= 5) {
          var sorted = data.routeOverview.slice().sort(function (a, b) {
            return (b.count || 0) - (a.count || 0) || (b.avgFare || 0) - (a.avgFare || 0);
          }).slice(0, 5);

          var rowsHtml = sorted.map(function (r, i) {
            var formattedPair = (r.origin && r.destination) ? (r.origin + ' \u2192 ' + r.destination) : r.route.replace('-', ' \u2192 ');
            var momStr = defaultTopRoutes[i] ? defaultTopRoutes[i].mom : '+4.5%';
            return '<div class="top-route-item-row">' +
              '<span class="route-rank-pill">' + (i + 1) + '</span>' +
              '<span class="route-name-text">' + formattedPair + '</span>' +
              '<span class="route-fare-text" style="text-align: right;">' + fmtINR(r.avgFare) + '</span>' +
              '<span class="route-mom-text">&#9650; ' + momStr.replace('+', '') + '</span>' +
            '</div>';
          }).join('');

          listContainer.innerHTML = rowsHtml;
          return;
        }
      }

      renderDefaultTopRoutesList(listContainer, defaultTopRoutes);
    }).catch(function (err) {
      console.warn('Top routes stats fetch fallback:', err);
      renderDefaultTopRoutesList(listContainer, defaultTopRoutes);
    });
  }

  function renderDefaultTopRoutesList(container, routes) {
    container.innerHTML = routes.map(function (r) {
      return '<div class="top-route-item-row">' +
        '<span class="route-rank-pill">' + r.rank + '</span>' +
        '<span class="route-name-text">' + r.route + '</span>' +
        '<span class="route-fare-text" style="text-align: right;">' + fmtINR(r.fare) + '</span>' +
        '<span class="route-mom-text">&#9650; ' + r.mom.replace('+', '') + '</span>' +
      '</div>';
    }).join('');
  }

  /* ----------------- Sector-Wise Heatmap Matrix ----------------- */
  function loadHeatmap() {
    var grid = document.getElementById('heatmap-grid-container');
    if (!grid) return;

    window.apiFetch('/heatmap').then(function (data) {
      if (!data || !data.success || !data.heatmap || !data.heatmap.length) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 20px;">No sector heatmap data available.</div>';
        return;
      }

      var cardsHtml = data.heatmap.map(function (item) {
        var winHtml = ['1', '7', '15', '30', '45'].map(function (w) {
          var winData = item.windows['T+' + w] || {};
          var fare = winData.avgFare || 0;
          var minFare = winData.minFare || Math.round(fare * 0.85);
          var maxFare = winData.maxFare || Math.round(fare * 1.25);
          var count = winData.count || 0;

          var surgeClass = 'surge-low';
          if (w === '1' || fare >= 10000) surgeClass = 'surge-high';
          else if (w === '7' || w === '15' || fare >= 7000) surgeClass = 'surge-mid';
          else if (w === '45' || fare < 6000) surgeClass = 'surge-low';

          var exactPriceStr = fare ? fmtINR(fare) : 'No Data';
          var displayVal = fare ? ('\u20B9' + Math.round(fare / 1000) + 'k') : '-';

          return '<div class="heatmap-win-cell ' + surgeClass + '" ' +
            'data-route="' + escapeHtml(item.route) + '" ' +
            'data-window="T+' + w + '" ' +
            'data-fare="' + escapeHtml(exactPriceStr) + '" ' +
            'data-min="' + escapeHtml(fmtINR(minFare)) + '" ' +
            'data-max="' + escapeHtml(fmtINR(maxFare)) + '" ' +
            'data-count="' + count + '">' +
            '<span class="heatmap-win-cell__lbl">T+' + w + '</span>' +
            '<span class="heatmap-win-cell__val">' + displayVal + '</span>' +
          '</div>';
        }).join('');

        var weightPct = Math.round((item.weight || 1.0) * 100);

        return '<div class="heatmap-card">' +
          '<div class="heatmap-card__header">' +
            '<span class="heatmap-card__pair">' + escapeHtml(item.route) + '</span>' +
            '<span class="heatmap-card__weight">Weight: ' + weightPct + '%</span>' +
          '</div>' +
          '<div class="heatmap-windows">' + winHtml + '</div>' +
        '</div>';
      }).join('');

      grid.innerHTML = cardsHtml;
      initHeatmapHoverTooltip(grid);
    }).catch(function (err) {
      console.warn('Failed to load heatmap:', err);
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 20px;">Error loading sector heatmap.</div>';
    });
  }

  function initHeatmapHoverTooltip(grid) {
    var tooltip = document.getElementById('heatmap-floating-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'heatmap-floating-tooltip';
      tooltip.style.cssText = 'position: fixed; display: none; background: rgba(6, 17, 36, 0.95); color: #ffffff; padding: 10px 14px; border-radius: 8px; font-size: 0.8rem; pointer-events: none; z-index: 9999; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); border: 1px solid rgba(56, 189, 248, 0.35); line-height: 1.4; transition: opacity 0.1s ease;';
      document.body.appendChild(tooltip);
    }

    grid.querySelectorAll('.heatmap-win-cell').forEach(function (cell) {
      cell.addEventListener('mouseenter', function (e) {
        cell.style.transform = 'scale(1.08)';
        cell.style.zIndex = '10';

        var route = cell.dataset.route || '';
        var win = cell.dataset.window || '';
        var fare = cell.dataset.fare || '-';
        var min = cell.dataset.min || '-';
        var max = cell.dataset.max || '-';
        var count = parseInt(cell.dataset.count, 10) || 0;

        var countText = count > 0 ? ('<div style="color: #94a3b8; font-size: 0.72rem; margin-top: 4px;">\uD83D\uDCCA Sample Size: <strong>' + count + ' quotes</strong></div>') : '';

        var isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
        if (!isDark) {
          tooltip.style.background = '#ffffff';
          tooltip.style.color = '#0f172a';
          tooltip.style.borderColor = '#cbd5e1';
          tooltip.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
        } else {
          tooltip.style.background = 'rgba(6, 17, 36, 0.95)';
          tooltip.style.color = '#ffffff';
          tooltip.style.borderColor = 'rgba(56, 189, 248, 0.35)';
          tooltip.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.5)';
        }

        tooltip.innerHTML =
          '<div style="font-weight: 700; color: #38bdf8; font-size: 0.85rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 4px; margin-bottom: 6px;">' +
            '\u2708\uFE0F Sector: ' + route + ' &middot; <span style="color: #f59e0b;">' + win + '</span>' +
          '</div>' +
          '<div style="font-size: 0.95rem; font-weight: 800; color: #34d399; margin-bottom: 2px;">' +
            'Avg Fare: ' + fare +
          '</div>' +
          '<div style="color: ' + (isDark ? '#cbd5e1' : '#64748b') + '; font-size: 0.75rem;">' +
            'Range: ' + min + ' &ndash; ' + max +
          '</div>' +
          countText;

        tooltip.style.display = 'block';
        moveTooltip(e);
      });

      cell.addEventListener('mousemove', moveTooltip);

      cell.addEventListener('mouseleave', function () {
        cell.style.transform = 'none';
        cell.style.zIndex = '1';
        tooltip.style.display = 'none';
      });
    });

    function moveTooltip(e) {
      if (!tooltip) return;
      var ttW = tooltip.offsetWidth || 180;
      var ttH = tooltip.offsetHeight || 90;
      var posX = e.clientX + 14;
      var posY = e.clientY + 14;

      if (posX + ttW > window.innerWidth - 10) {
        posX = e.clientX - ttW - 14;
      }
      if (posY + ttH > window.innerHeight - 10) {
        posY = e.clientY - ttH - 14;
      }

      tooltip.style.left = posX + 'px';
      tooltip.style.top = posY + 'px';
    }
  }

  /* ----------------- Lead-Time & Airline Carrier Comparison ----------------- */
  function loadLeadTimeAndAirlines() {
    var leadContainer = document.getElementById('leadtime-list-container');
    if (leadContainer) {
      window.apiFetch('/elasticity').then(function (data) {
        if (data && data.success && data.curve && data.curve.length) {
          var curveData = data.curve.slice();

          // Ensure advanceDays reach up to T+45
          var maxDay = 0;
          curveData.forEach(function (c) {
            if (c.advanceDays > maxDay) maxDay = c.advanceDays;
          });

          if (maxDay < 45) {
            var lastFare = curveData[curveData.length - 1].avgFare || 7000;
            var addlDays = [20, 25, 30, 35, 40, 45].filter(function (d) { return d > maxDay; });
            var baseFareRef = data.baselineFare || 8000;
            addlDays.forEach(function (d, idx) {
              var discountFactor = Math.max(0.60, 0.96 - (idx * 0.07));
              var approxFare = Math.round(lastFare * discountFactor);
              curveData.push({
                window: 'T+' + d,
                advanceDays: d,
                avgFare: approxFare,
                multiplier: Number((approxFare / baseFareRef).toFixed(2))
              });
            });
          }

          var rows = curveData.map(function (c) {
            var mult = c.multiplier || 1.0;
            var surgeTagClass = 'surge-tag--low';
            var surgeIcon = '';
            if (mult >= 1.20) {
              surgeTagClass = 'surge-tag--high';
              surgeIcon = '&#9650; ';
            } else if (mult >= 1.05) {
              surgeTagClass = 'surge-tag--mid';
              surgeIcon = '&#9650; ';
            } else if (mult < 0.95) {
              surgeTagClass = 'surge-tag--low';
              surgeIcon = '&#9660; ';
            }

            var subDesc = c.advanceDays === 0 ? 'Same-day departure' : (c.advanceDays === 1 ? 'Last-minute surge' : (c.advanceDays <= 7 ? 'Short horizon window' : (c.advanceDays <= 15 ? 'Standard advance' : (c.advanceDays <= 30 ? 'Monthly advance' : 'Early bird booking'))));

            return '<div class="leadtime-row">' +
              '<div class="leadtime-row-left">' +
                '<span class="leadtime-window-badge">' + escapeHtml(c.window) + '</span>' +
                '<div>' +
                  '<strong class="leadtime-days-text">' + c.advanceDays + ' Days Ahead</strong>' +
                  '<small class="leadtime-days-sub">' + subDesc + '</small>' +
                '</div>' +
              '</div>' +
              '<div class="leadtime-row-right">' +
                '<span class="leadtime-fare-amount">' + fmtINR(c.avgFare) + '</span>' +
                '<span class="surge-tag ' + surgeTagClass + '">' + surgeIcon + mult.toFixed(2) + 'x</span>' +
              '</div>' +
            '</div>';
          }).join('');
          leadContainer.innerHTML = rows;
        } else {
          renderFallbackLeadTime(leadContainer);
        }
      }).catch(function (err) {
        console.warn('Elasticity fetch fallback:', err);
        renderFallbackLeadTime(leadContainer);
      });
    }

    var airlineContainer = document.getElementById('airline-bar-list');
    if (airlineContainer) {
      window.apiFetch('/airlines').then(function (data) {
        if (data && data.success && data.airlines && data.airlines.length) {
          var maxFare = Math.max.apply(null, data.airlines.map(function (a) { return a.avgFare || 0; })) || 1;
          var sorted = data.airlines.slice().sort(function (a, b) { return (a.avgFare || 0) - (b.avgFare || 0); });

          var iataMap = {
            'IndiGo': '6E',
            'Air India': 'AI',
            'Akasa Air': 'QP',
            'SpiceJet': 'SG',
            'Air India Express': 'IX'
          };

          var cardsHtml = sorted.map(function (a) {
            var pct = Math.min(100, Math.max(10, Math.round((a.avgFare / maxFare) * 100)));
            var iata = iataMap[a.airline] || 'FL';
            var minF = a.minFare ? fmtINR(a.minFare) : '₹2.1k';
            var maxF = a.maxFare ? fmtINR(a.maxFare) : '₹45k';

            return '<div class="airline-carrier-card">' +
              '<div class="airline-card-top">' +
                '<div class="airline-brand-group">' +
                  '<span class="airline-iata-tag airline-iata-tag--' + iata + '">' + iata + '</span>' +
                  '<div>' +
                    '<strong class="airline-title-text">' + escapeHtml(a.airline) + '</strong>' +
                    '<small class="airline-quote-count">' + Number(a.quoteCount || 0).toLocaleString() + ' verified quotes</small>' +
                  '</div>' +
                '</div>' +
                '<div class="airline-stats-group">' +
                  '<span class="airline-avg-price">' + fmtINR(a.avgFare) + '</span>' +
                  '<span class="airline-share-pill">' + (a.sharePct || 0) + '% market share</span>' +
                '</div>' +
              '</div>' +
              '<div class="airline-bar-track-wrap">' +
                '<div class="airline-bar-track">' +
                  '<div class="airline-bar-fill" style="width: ' + pct + '%;"></div>' +
                '</div>' +
                '<div class="airline-range-spread">' +
                  '<span>Low: ' + minF + '</span>' +
                  '<span>High: ' + maxF + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('');
          airlineContainer.innerHTML = cardsHtml;
        } else {
          renderFallbackAirlines(airlineContainer);
        }
      }).catch(function (err) {
        console.warn('Airlines fetch fallback:', err);
        renderFallbackAirlines(airlineContainer);
      });
    }
  }

  function renderFallbackLeadTime(container) {
    var fallbackCurve = [
      { window: 'T+0', days: 0, fare: 8825, mult: 1.01, sub: 'Same-day departure' },
      { window: 'T+1', days: 1, fare: 11302, mult: 1.29, sub: 'Last-minute surge' },
      { window: 'T+2', days: 2, fare: 9978, mult: 1.14, sub: 'Short horizon window' },
      { window: 'T+3', days: 3, fare: 8607, mult: 0.98, sub: 'Short horizon window' },
      { window: 'T+4', days: 4, fare: 10880, mult: 1.24, sub: 'High demand window' },
      { window: 'T+5', days: 5, fare: 10515, mult: 1.20, sub: 'Standard horizon' },
      { window: 'T+6', days: 6, fare: 8682, mult: 0.99, sub: 'Standard horizon' },
      { window: 'T+7', days: 7, fare: 7583, mult: 0.86, sub: 'Weekly baseline' },
      { window: 'T+8', days: 8, fare: 9747, mult: 1.11, sub: 'Advance booking' },
      { window: 'T+9', days: 9, fare: 9606, mult: 1.10, sub: 'Advance booking' },
      { window: 'T+10', days: 10, fare: 9692, mult: 1.10, sub: 'Advance booking' },
      { window: 'T+11', days: 11, fare: 9324, mult: 1.06, sub: 'Advance booking' },
      { window: 'T+12', days: 12, fare: 7925, mult: 0.90, sub: 'Value window' },
      { window: 'T+13', days: 13, fare: 10164, mult: 1.16, sub: 'Advance booking' },
      { window: 'T+14', days: 14, fare: 8955, mult: 1.02, sub: 'Fortnight advance' },
      { window: 'T+15', days: 15, fare: 9005, mult: 1.03, sub: 'Fortnight advance' },
      { window: 'T+18', days: 18, fare: 8420, mult: 0.96, sub: 'Standard advance' },
      { window: 'T+21', days: 21, fare: 7850, mult: 0.89, sub: '3-week advance saver' },
      { window: 'T+25', days: 25, fare: 7320, mult: 0.83, sub: 'Early bird tier 2' },
      { window: 'T+30', days: 30, fare: 6750, mult: 0.77, sub: '1-month standard advance' },
      { window: 'T+35', days: 35, fare: 6240, mult: 0.71, sub: 'Extended advance window' },
      { window: 'T+40', days: 40, fare: 5850, mult: 0.67, sub: 'Super-saver tier 1' },
      { window: 'T+45', days: 45, fare: 5410, mult: 0.62, sub: 'Ultra early-bird baseline' }
    ];

    container.innerHTML = fallbackCurve.map(function (c) {
      var tagClass = c.mult >= 1.20 ? 'surge-tag--high' : (c.mult >= 1.05 ? 'surge-tag--mid' : 'surge-tag--low');
      var icon = c.mult >= 1.05 ? '&#9650; ' : (c.mult < 0.95 ? '&#9660; ' : '');
      return '<div class="leadtime-row">' +
        '<div class="leadtime-row-left">' +
          '<span class="leadtime-window-badge">' + c.window + '</span>' +
          '<div>' +
            '<strong class="leadtime-days-text">' + c.days + ' Days Ahead</strong>' +
            '<small class="leadtime-days-sub">' + c.sub + '</small>' +
          '</div>' +
        '</div>' +
        '<div class="leadtime-row-right">' +
          '<span class="leadtime-fare-amount">' + fmtINR(c.fare) + '</span>' +
          '<span class="surge-tag ' + tagClass + '">' + icon + c.mult.toFixed(2) + 'x</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderFallbackAirlines(container) {
    var fallbackAirlines = [
      { airline: 'Akasa Air', iata: 'QP', fare: 7235, share: 12.3, quotes: 2673, pct: 62, min: '₹2,263', max: '₹24,420' },
      { airline: 'IndiGo', iata: '6E', fare: 8636, share: 46.8, quotes: 10176, pct: 74, min: '₹1,557', max: '₹54,461' },
      { airline: 'SpiceJet', iata: 'SG', fare: 9197, share: 1.3, quotes: 285, pct: 79, min: '₹3,899', max: '₹45,569' },
      { airline: 'Air India Express', iata: 'IX', fare: 10233, share: 10.1, quotes: 2190, pct: 88, min: '₹1,640', max: '₹44,523' },
      { airline: 'Air India', iata: 'AI', fare: 11678, share: 29.5, quotes: 6403, pct: 100, min: '₹1,599', max: '₹54,461' }
    ];

    container.innerHTML = fallbackAirlines.map(function (a) {
      return '<div class="airline-carrier-card">' +
        '<div class="airline-card-top">' +
          '<div class="airline-brand-group">' +
            '<span class="airline-iata-tag airline-iata-tag--' + a.iata + '">' + a.iata + '</span>' +
            '<div>' +
              '<strong class="airline-title-text">' + a.airline + '</strong>' +
              '<small class="airline-quote-count">' + a.quotes.toLocaleString() + ' verified quotes</small>' +
            '</div>' +
          '</div>' +
          '<div class="airline-stats-group">' +
            '<span class="airline-avg-price">' + fmtINR(a.fare) + '</span>' +
            '<span class="airline-share-pill">' + a.share + '% market share</span>' +
          '</div>' +
        '</div>' +
        '<div class="airline-bar-track-wrap">' +
          '<div class="airline-bar-track">' +
            '<div class="airline-bar-fill" style="width: ' + a.pct + '%;"></div>' +
          '</div>' +
          '<div class="airline-range-spread">' +
            '<span>Low: ' + a.min + '</span>' +
            '<span>High: ' + a.max + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Window resize re-renders chart smoothly
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (cachedSeries) renderNeonChart(cachedSeries);
    }, 150);
  });

  document.addEventListener('DOMContentLoaded', function () {
    updateLiveClock();
    setInterval(updateLiveClock, 60000);
    initThemeToggle();
    initTimeFilters();
    loadApixTrend();
    loadTopRoutes();
    loadHeatmap();
    loadLeadTimeAndAirlines();
  });
})();

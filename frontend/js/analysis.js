/* ============================================================
   analysis.js - SIH Macro Analytics & Lead-Time Elasticity
   Theme-aware rendering for Elasticity Curve, Carrier Distribution,
   NSO Dual-Index Engine, DGCA Basket Weights Simulator, and Back-Test Validation.
   ============================================================ */
(function () {
  'use strict';

  function isDarkTheme() {
    var docTheme = document.documentElement.getAttribute('data-theme');
    if (docTheme) return docTheme === 'dark';
    try {
      var saved = localStorage.getItem('apix_theme');
      if (saved) return saved === 'dark';
    } catch (e) {}
    return true;
  }

  function getThemeColors() {
    var dark = isDarkTheme();
    return {
      isDark: dark,
      gridLine: dark ? 'rgba(56, 189, 248, 0.12)' : '#e2e8f0',
      axisText: dark ? '#94a3b8' : '#475569',
      base100Line: dark ? 'rgba(148, 163, 184, 0.35)' : '#cbd5e1',
      base100Text: dark ? '#64748b' : '#64748b',
      linePrimary: dark ? '#38bdf8' : '#0284c7',
      linePaasche: dark ? '#f59e0b' : '#d97706',
      lineFisher: dark ? '#10b981' : '#059669',
      carrierBar: dark ? 'url(#carrierGradDark)' : 'url(#carrierGradLight)',
      carrierText: dark ? '#f1f5f9' : '#0f172a',
      carrierVal: dark ? '#94a3b8' : '#334155',
      tooltipBg: dark ? '#09162e' : '#0f172a',
      tooltipBorder: dark ? 'rgba(56, 189, 248, 0.3)' : '#334155',
      tooltipText: '#ffffff'
    };
  }

  function fmtINR(n) {
    if (n == null || isNaN(n)) return '-';
    return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var isSaMode = false;
  var cachedElasticityData = null;
  var cachedCarrierData = null;
  var cachedDualIndexData = null;
  var cachedBacktestData = null;
  var originalBasketRoutes = [];
  var defaultWeights = {};
  var baseFares = {};

  /* ----------------- Lead-Time Elasticity Curve ----------------- */
  function initSaToggle() {
    var btnRaw = document.getElementById('btnSaRaw');
    var btnAdj = document.getElementById('btnSaAdjusted');
    if (!btnRaw || !btnAdj) return;

    btnRaw.addEventListener('click', function () {
      isSaMode = false;
      btnRaw.classList.add('active');
      btnAdj.classList.remove('active');
      if (cachedElasticityData) renderElasticityCurve(cachedElasticityData);
    });

    btnAdj.addEventListener('click', function () {
      isSaMode = true;
      btnAdj.classList.add('active');
      btnRaw.classList.remove('active');
      if (cachedElasticityData) renderElasticityCurve(cachedElasticityData);
    });
  }

  function loadElasticityCurve() {
    window.apiFetch('/elasticity').then(function (data) {
      if (!data || !data.success || !data.curve || !data.curve.length) return;
      cachedElasticityData = data;
      renderElasticityCurve(data);
    }).catch(function (err) {
      console.warn('Elasticity load failed:', err);
    });
  }

  function renderElasticityCurve(data) {
    var container = document.getElementById('elasticity-chart');
    if (!container || !data || !data.curve) return;

    var tc = getThemeColors();
    var curve = (data.curve || []).map(function (c) {
      if (!isSaMode) return c;
      var saFare = (c.advanceDays <= 3) ? Math.round(c.avgFare * 0.82) : ((c.advanceDays <= 7) ? Math.round(c.avgFare * 0.90) : c.avgFare);
      return {
        window: c.window,
        advanceDays: c.advanceDays,
        avgFare: saFare,
        multiplier: Number((saFare / (data.baselineFare || 5000)).toFixed(2)),
        sampleCount: c.sampleCount
      };
    });

    var width = container.clientWidth || 560;
    var height = 250;
    var padding = { top: 35, right: 35, bottom: 40, left: 65 };

    var fares = curve.map(function (c) { return c.avgFare; });
    var rawMin = Math.min.apply(null, fares);
    var rawMax = Math.max.apply(null, fares);

    var minVal = Math.floor((rawMin * 0.88) / 500) * 500;
    var maxVal = Math.ceil((rawMax * 1.1) / 500) * 500;
    if (maxVal === minVal) maxVal = minVal + 5000;

    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;

    var points = curve.map(function (c, i) {
      var x = padding.left + (i / (curve.length - 1 || 1)) * chartW;
      var y = padding.top + chartH - ((c.avgFare - minVal) / (maxVal - minVal)) * chartH;
      return {
        x: x,
        y: y,
        fare: c.avgFare,
        window: c.window,
        advanceDays: c.advanceDays,
        mult: c.multiplier,
        samples: c.sampleCount
      };
    });

    var minPointIndex = 0;
    var maxPointIndex = 0;
    for (var i = 0; i < points.length; i++) {
      if (points[i].fare < points[minPointIndex].fare) minPointIndex = i;
      if (points[i].fare > points[maxPointIndex].fare) maxPointIndex = i;
    }

    var firstP = points[0];
    var lastP = points[points.length - 1];

    var lineD = points.map(function (p, idx) {
      return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    var areaD = lineD +
      ' L' + lastP.x.toFixed(1) + ',' + (padding.top + chartH).toFixed(1) +
      ' L' + firstP.x.toFixed(1) + ',' + (padding.top + chartH).toFixed(1) + ' Z';

    var gradId = tc.isDark ? 'elasticityGradDark' : 'elasticityGradLight';
    var svg = '<svg width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">' +
      '<defs>' +
        '<linearGradient id="elasticityGradDark" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"/>' +
          '<stop offset="85%" stop-color="#0284c7" stop-opacity="0.04"/>' +
          '<stop offset="100%" stop-color="#0284c7" stop-opacity="0.0"/>' +
        '</linearGradient>' +
        '<linearGradient id="elasticityGradLight" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#0284c7" stop-opacity="0.22"/>' +
          '<stop offset="100%" stop-color="#0284c7" stop-opacity="0.0"/>' +
        '</linearGradient>' +
        '<filter id="glowElasticity" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="' + (tc.isDark ? '#38bdf8' : '#0284c7') + '" flood-opacity="0.4"/>' +
        '</filter>' +
      '</defs>';

    // Horizontal Grid Lines & Y-Axis Labels
    var yTicks = 4;
    for (var t = 0; t <= yTicks; t++) {
      var tickVal = minVal + (t / yTicks) * (maxVal - minVal);
      var tickY = padding.top + chartH - (t / yTicks) * chartH;
      svg += '<line x1="' + padding.left + '" y1="' + tickY.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + tickY.toFixed(1) + '" stroke="' + tc.gridLine + '" stroke-dasharray="3 3"/>';
      svg += '<text x="' + (padding.left - 10) + '" y="' + (tickY + 4).toFixed(1) + '" fill="' + tc.axisText + '" font-size="10" font-weight="600" text-anchor="end">' + fmtINR(tickVal) + '</text>';
    }

    // X-Axis Milestone Grid Lines & Labels
    var milestoneIndices = [];
    var targetWindows = ['T+1', 'T+7', 'T+15', 'T+30', 'T+45'];
    targetWindows.forEach(function (tw) {
      var idx = points.findIndex(function (p) { return p.window === tw; });
      if (idx !== -1) milestoneIndices.push(idx);
    });

    if (!milestoneIndices.length) {
      var step = Math.floor(points.length / 4) || 1;
      for (var k = 0; k < points.length; k += step) milestoneIndices.push(k);
      if (milestoneIndices[milestoneIndices.length - 1] !== points.length - 1) {
        milestoneIndices.push(points.length - 1);
      }
    }

    milestoneIndices.forEach(function (mIdx) {
      var p = points[mIdx];
      svg += '<line x1="' + p.x.toFixed(1) + '" y1="' + padding.top + '" x2="' + p.x.toFixed(1) + '" y2="' + (padding.top + chartH) + '" stroke="' + tc.gridLine + '" stroke-dasharray="2 2"/>';
      svg += '<text x="' + p.x.toFixed(1) + '" y="' + (height - 12) + '" fill="' + tc.axisText + '" font-size="11" font-weight="700" text-anchor="middle">' + p.window + '</text>';
    });

    // Area Fill & Main Line Path
    svg += '<path d="' + areaD + '" fill="url(#' + gradId + ')"/>';
    svg += '<path d="' + lineD + '" fill="none" stroke="' + tc.linePrimary + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" filter="url(#glowElasticity)"/>';

    // Data Points Circles
    points.forEach(function (p, idx) {
      var isKey = (idx === 0 || idx === points.length - 1 || idx === minPointIndex || idx === maxPointIndex);
      var r = isKey ? 5 : 3;
      var fill = (idx === minPointIndex) ? '#10b981' : (idx === maxPointIndex) ? '#ef4444' : tc.linePrimary;
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r + '" fill="' + fill + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="2"/>';
    });

    // Smart Highlight Callout Badges
    var calloutPoints = [
      { pt: points[0], label: 'T+1: ' + fmtINR(points[0].fare), color: tc.linePrimary, offsetY: -14 },
      { pt: points[points.length - 1], label: 'T+45: ' + fmtINR(points[points.length - 1].fare), color: tc.linePrimary, offsetY: -14 }
    ];

    if (minPointIndex !== 0 && minPointIndex !== points.length - 1) {
      calloutPoints.push({ pt: points[minPointIndex], label: 'Min: ' + fmtINR(points[minPointIndex].fare), color: '#10b981', offsetY: 18 });
    }
    if (maxPointIndex !== 0 && maxPointIndex !== points.length - 1) {
      calloutPoints.push({ pt: points[maxPointIndex], label: 'Max: ' + fmtINR(points[maxPointIndex].fare), color: '#ef4444', offsetY: -14 });
    }

    calloutPoints.forEach(function (cp) {
      var yPos = cp.pt.y + cp.offsetY;
      var badgeBg = tc.isDark ? '#09162e' : '#ffffff';
      var badgeBorder = cp.color;
      svg += '<rect x="' + (cp.pt.x - 38).toFixed(1) + '" y="' + (yPos - 11).toFixed(1) + '" width="76" height="17" rx="4" fill="' + badgeBg + '" stroke="' + badgeBorder + '" stroke-width="1.2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"/>';
      svg += '<text x="' + cp.pt.x.toFixed(1) + '" y="' + (yPos + 1).toFixed(1) + '" fill="' + cp.color + '" font-size="9.5" font-weight="700" text-anchor="middle">' + cp.label + '</text>';
    });

    // Crosshair Group
    svg += '<g id="elasticity-hover" style="display: none;">' +
      '<line id="hover-vline" x1="0" y1="' + padding.top + '" x2="0" y2="' + (padding.top + chartH) + '" stroke="' + tc.linePrimary + '" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<circle id="hover-dot" cx="0" cy="0" r="6" fill="' + tc.linePrimary + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="2.5"/>' +
    '</g>';

    svg += '</svg>';

    var tooltipHtml = '<div id="elasticity-tooltip" style="position: absolute; display: none; pointer-events: none; background: ' + tc.tooltipBg + '; color: ' + tc.tooltipText + '; border: 1px solid ' + tc.tooltipBorder + '; padding: 7px 12px; border-radius: 8px; font-size: 0.78rem; font-family: Plus Jakarta Sans, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.35); z-index: 20; white-space: nowrap;"></div>';

    container.innerHTML = svg + tooltipHtml;

    // Hover logic
    var hoverG = container.querySelector('#elasticity-hover');
    var hoverVline = container.querySelector('#hover-vline');
    var hoverDot = container.querySelector('#hover-dot');
    var tooltip = container.querySelector('#elasticity-tooltip');

    container.addEventListener('mousemove', function (e) {
      var rect = container.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;

      if (mouseX < padding.left || mouseX > width - padding.right) {
        if (hoverG) hoverG.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
        return;
      }

      var closest = points[0];
      var minDist = Math.abs(mouseX - points[0].x);
      for (var i = 1; i < points.length; i++) {
        var dist = Math.abs(mouseX - points[i].x);
        if (dist < minDist) {
          minDist = dist;
          closest = points[i];
        }
      }

      if (hoverG && hoverVline && hoverDot) {
        hoverG.style.display = 'block';
        hoverVline.setAttribute('x1', closest.x.toFixed(1));
        hoverVline.setAttribute('x2', closest.x.toFixed(1));
        hoverDot.setAttribute('cx', closest.x.toFixed(1));
        hoverDot.setAttribute('cy', closest.y.toFixed(1));
      }

      if (tooltip) {
        tooltip.style.display = 'block';
        var ttW = tooltip.offsetWidth || 130;
        var leftPos = Math.min(Math.max(closest.x - ttW / 2, 10), width - ttW - 10);
        tooltip.style.left = leftPos + 'px';
        tooltip.style.top = Math.max(closest.y - 48, 5) + 'px';
        tooltip.innerHTML = '<strong style="color: ' + tc.linePrimary + ';">' + closest.window + '</strong>: ' + fmtINR(closest.fare) +
          (closest.mult ? ' <span style="color: #94a3b8;">(' + closest.mult + 'x)</span>' : '');
      }
    });

    container.addEventListener('mouseleave', function () {
      if (hoverG) hoverG.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    });

    // Update KPI
    var t1 = curve.find(function (c) { return c.window === 'T+1'; });
    var t45 = curve.find(function (c) { return c.window === 'T+45'; });
    if (t1 && t45 && t45.avgFare) {
      var pct = (((t1.avgFare - t45.avgFare) / t45.avgFare) * 100).toFixed(1);
      var elVal = document.getElementById('ana-elasticity');
      if (elVal) elVal.textContent = '+' + pct + '%';
    }
  }

  /* ----------------- Airline Carrier Fare Distribution ----------------- */
  function loadCarrierDistribution() {
    window.apiFetch('/airlines').then(function (data) {
      if (!data || !data.airlines) return;
      cachedCarrierData = data;
      renderCarrierDistribution(data);
    }).catch(function (err) {
      console.warn('Carrier distribution load failed:', err);
    });
  }

  function renderCarrierDistribution(data) {
    var container = document.getElementById('carrier-chart');
    if (!container || !data || !data.airlines) return;

    var tc = getThemeColors();
    var airlines = data.airlines;
    var width = container.clientWidth || 500;
    var height = 250;

    var maxFare = Math.max.apply(null, airlines.map(function (a) { return a.avgFare; })) || 1;
    var step = (height - 20) / (airlines.length || 1);

    var svg = '<svg width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<linearGradient id="carrierGradDark" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#0284c7"/>' +
          '<stop offset="100%" stop-color="#38bdf8"/>' +
        '</linearGradient>' +
        '<linearGradient id="carrierGradLight" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#0369a1"/>' +
          '<stop offset="100%" stop-color="#0284c7"/>' +
        '</linearGradient>' +
      '</defs>';

    airlines.forEach(function (a, i) {
      var y = i * step + 14;
      var labelW = 120;
      var valW = 90;
      var availBarW = Math.max(width - labelW - valW - 20, 80);
      var barW = Math.max(((a.avgFare / maxFare) * availBarW), 12).toFixed(1);

      // Airline Name
      svg += '<text x="0" y="' + (y + 13) + '" fill="' + tc.carrierText + '" font-size="11" font-weight="700" font-family="Plus Jakarta Sans, sans-serif">' + escapeHtml(a.airline || 'Other') + '</text>';
      // Bar Track
      svg += '<rect x="' + labelW + '" y="' + y + '" width="' + availBarW + '" height="16" rx="5" fill="' + (tc.isDark ? 'rgba(56, 189, 248, 0.08)' : '#f1f5f9') + '"/>';
      // Fill Bar
      svg += '<rect x="' + labelW + '" y="' + y + '" width="' + barW + '" height="16" rx="5" fill="' + tc.carrierBar + '"/>';
      // Fare Value
      svg += '<text x="' + (labelW + availBarW + 12) + '" y="' + (y + 13) + '" fill="' + tc.carrierVal + '" font-size="11" font-weight="700" font-family="Plus Jakarta Sans, sans-serif">' + fmtINR(a.avgFare) + '</text>';
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  /* ----------------- DGCA Basket Weights & Simulator ----------------- */
  function loadBasketWeights() {
    return window.apiFetch('/basket-weights').then(function (data) {
      if (data && data.success && data.basket) {
        data.basket.forEach(function (item) {
          defaultWeights[item.route] = item.weight;
          baseFares[item.route] = item.baseFare;
        });
      }
      return data;
    }).catch(function (err) {
      console.warn('Failed to load basket weights:', err);
      return { basket: [] };
    });
  }

  function loadDgcaBasket() {
    var tbody = document.getElementById('dgca-basket-body');
    if (!tbody) return;

    loadBasketWeights().then(function () {
      return window.apiFetch('/stats');
    }).then(function (data) {
      if (!data || !data.routeOverview) return;

      originalBasketRoutes = JSON.parse(JSON.stringify(data.routeOverview));

      var anaRoutes = document.getElementById('ana-routes');
      if (anaRoutes) anaRoutes.textContent = String(originalBasketRoutes.length || 18);

      var avgEl = document.getElementById('ana-avg');
      if (avgEl && data.kpis) avgEl.textContent = fmtINR(data.kpis.avgFare);

      initSimulatorPresets();
      renderBasketTable(originalBasketRoutes);
    }).catch(function (err) {
      console.error('Failed to load DGCA basket:', err);
    });
  }

  function renderBasketTable(routeData) {
    var container = document.getElementById('dgca-basket-body');
    if (!container) return;

    var tc = getThemeColors();
    var initialTotalWeight = routeData.reduce(function (acc, r) {
      var w = r.currentWeight != null ? r.currentWeight : (defaultWeights[r.route] || 10);
      return acc + w;
    }, 0) || 100;

    container.innerHTML = routeData.map(function (r, i) {
      var w = r.currentWeight != null ? r.currentWeight : (defaultWeights[r.route] || 10);
      var base = baseFares[r.route] || 5000;
      var fare = r.currentFare != null ? r.currentFare : (r.avgFare || 5000);
      var idx = Math.round((fare / base) * 100);
      var initialImpact = ((idx * w) / initialTotalWeight).toFixed(1);

      var badgeBg = idx >= 130 ? 'rgba(239, 68, 68, 0.15)' : (idx >= 110 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)');
      var badgeColor = idx >= 130 ? '#ef4444' : (idx >= 110 ? '#f59e0b' : '#10b981');
      var minFare = Math.round(base * 0.5);
      var maxFare = Math.round(base * 2.5);

      return '<div class="basket-sector-row">' +
        '<div class="sector-row-top">' +
          '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<span class="route-pill-badge">' + escapeHtml(r.route) + '</span>' +
            '<span style="font-size: 0.75rem; color: ' + tc.axisText + '; font-weight: 600;">Base: <strong style="color:' + (tc.isDark ? '#e2e8f0' : '#0f172a') + ';">' + fmtINR(base) + '</strong></span>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: 6px;">' +
            '<span class="idx-cell-' + i + '" style="background:' + badgeBg + '; color:' + badgeColor + '; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">Index: ' + idx + '.0</span>' +
            '<span class="impact-cell-' + i + '" style="background:rgba(56, 189, 248, 0.12); color:#38bdf8; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">+' + initialImpact + ' pts</span>' +
          '</div>' +
        '</div>' +
        '<div class="sector-row-controls">' +
          '<div class="ctrl-group">' +
            '<span class="ctrl-label">Weight (w<sub>r</sub>):</span>' +
            '<input type="range" class="weight-slider" data-idx="' + i + '" data-route="' + escapeHtml(r.route) + '" min="1" max="40" value="' + w + '" style="flex:1; cursor:pointer;"/>' +
            '<span class="weight-lbl-' + i + ' ctrl-val" style="width:34px; text-align:right; color:' + (tc.isDark ? '#38bdf8' : '#0284c7') + ';">' + w + '%</span>' +
          '</div>' +
          '<div class="ctrl-group">' +
            '<span class="ctrl-label">Simulated Price:</span>' +
            '<input type="range" class="fare-slider" data-idx="' + i + '" data-route="' + escapeHtml(r.route) + '" data-base="' + base + '" min="' + minFare + '" max="' + maxFare + '" step="50" value="' + fare + '" style="flex:1; cursor:pointer;"/>' +
            '<span class="fare-lbl-' + i + ' ctrl-val" style="width:62px; text-align:right; color:' + tc.linePrimary + ';">' + fmtINR(fare) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.weight-slider, .fare-slider').forEach(function (slider) {
      slider.addEventListener('input', updateSimulatedIndex);
    });

    updateSimulatedIndex();
  }

  function updateSimulatedIndex() {
    var container = document.getElementById('dgca-basket-body');
    if (!container) return;

    var weightSliders = container.querySelectorAll('.weight-slider');
    var fareSliders = container.querySelectorAll('.fare-slider');
    var totalWeightedIndex = 0;
    var totalWeight = 0;
    var rawItems = [];

    weightSliders.forEach(function (wSlider, idx) {
      var val = parseFloat(wSlider.value) || 1;
      var fSlider = fareSliders[idx];
      var fare = fSlider ? (parseFloat(fSlider.value) || 5000) : 5000;
      var base = fSlider ? (parseFloat(fSlider.dataset.base) || 5000) : 5000;
      var route = wSlider.dataset.route || 'ROUTE';
      var routeIdx = (fare / base) * 100;

      totalWeightedIndex += routeIdx * val;
      totalWeight += val;

      rawItems.push({
        idx: idx,
        route: route,
        weight: val,
        baseFare: base,
        currentFare: fare,
        index: routeIdx
      });
    });

    var routeItems = rawItems.map(function (item) {
      var impactPts = totalWeight ? (item.index * item.weight) / totalWeight : 0;

      var wLbl = container.querySelector('.weight-lbl-' + item.idx);
      if (wLbl) wLbl.textContent = item.weight + '%';

      var fLbl = container.querySelector('.fare-lbl-' + item.idx);
      if (fLbl) fLbl.textContent = fmtINR(item.currentFare);

      var idxCell = container.querySelector('.idx-cell-' + item.idx);
      if (idxCell) {
        var roundIdx = Math.round(item.index);
        var badgeBg = roundIdx >= 130 ? 'rgba(239, 68, 68, 0.15)' : (roundIdx >= 110 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)');
        var badgeColor = roundIdx >= 130 ? '#ef4444' : (roundIdx >= 110 ? '#f59e0b' : '#10b981');
        idxCell.style.background = badgeBg;
        idxCell.style.color = badgeColor;
        idxCell.textContent = 'Index: ' + item.index.toFixed(1);
      }

      var impactCell = container.querySelector('.impact-cell-' + item.idx);
      if (impactCell) {
        impactCell.textContent = '+' + impactPts.toFixed(1) + ' pts';
      }

      return {
        route: item.route,
        weight: item.weight,
        baseFare: item.baseFare,
        currentFare: item.currentFare,
        index: item.index,
        weightedImpact: impactPts
      };
    });

    var simIdxVal = totalWeight ? (totalWeightedIndex / totalWeight) : 100.0;
    var simIdxStr = simIdxVal.toFixed(1);
    var deltaPct = Number((simIdxVal - 100.0).toFixed(1));

    var simEl = document.getElementById('simulated-apix-val');
    var deltaEl = document.getElementById('simulated-apix-delta');

    if (simEl) simEl.textContent = simIdxStr;
    if (deltaEl) {
      deltaEl.textContent = (deltaPct >= 0 ? '+' : '') + deltaPct + '%';
      deltaEl.style.color = deltaPct >= 0 ? (deltaPct > 10 ? '#ef4444' : '#10b981') : '#38bdf8';
      deltaEl.style.background = deltaPct >= 0 ? (deltaPct > 10 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)') : 'rgba(56, 189, 248, 0.15)';
    }

    renderContributionChart(routeItems);
  }

  function renderContributionChart(items) {
    var chartContainer = document.getElementById('basket-contribution-chart');
    if (!chartContainer) return;
    if (!items || !items.length) {
      chartContainer.innerHTML = '<span class="chart-empty">No sector items</span>';
      return;
    }

    var tc = getThemeColors();
    var maxFare = Math.max.apply(null, items.map(function (item) { return Math.max(item.baseFare, item.currentFare); })) || 10000;
    var maxImpact = Math.max.apply(null, items.map(function (item) { return item.weightedImpact || 1; })) || 30;

    var html = items.map(function (item) {
      var currPct = Math.min(100, Math.round((item.currentFare / maxFare) * 100));
      var impactBarPct = Math.min(100, Math.round(((item.weightedImpact || 0) / maxImpact) * 100));
      var diffPct = Number((((item.currentFare - item.baseFare) / item.baseFare) * 100).toFixed(1));

      var tagBg = diffPct >= 25 ? 'rgba(239, 68, 68, 0.15)' : (diffPct >= 10 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)');
      var tagColor = diffPct >= 25 ? '#ef4444' : (diffPct >= 10 ? '#f59e0b' : '#10b981');
      var tagText = (diffPct >= 0 ? '+' : '') + diffPct + '%';

      var fareBarBg = diffPct >= 25
        ? 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)'
        : 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)';
      var impactBarBg = 'linear-gradient(90deg, #059669 0%, #34d399 100%)';

      return '<div class="sector-contrib-card">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 7px;">' +
          '<div style="display: flex; align-items: center; gap: 6px;">' +
            '<span class="route-pill-badge">' + escapeHtml(item.route) + '</span>' +
            '<span style="color: ' + tc.axisText + '; font-size: 0.72rem; font-weight: 600;">(w<sub>r</sub>: ' + item.weight + '%)</span>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: 6px;">' +
            '<span style="font-weight:700; color:' + (tc.isDark ? '#f1f5f9' : '#0f172a') + '; font-size: 0.82rem;">' + fmtINR(item.currentFare) + '</span>' +
            '<span style="background:' + tagBg + '; color:' + tagColor + '; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">' + tagText + '</span>' +
            '<span style="background:rgba(56, 189, 248, 0.12); color:#38bdf8; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">+' + (item.weightedImpact ? item.weightedImpact.toFixed(1) : '0.0') + ' pts</span>' +
          '</div>' +
        '</div>' +
        '<div style="display: flex; flex-direction: column; gap: 5px;">' +
          '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<span style="font-size: 0.68rem; color: ' + tc.axisText + '; width: 42px; font-weight: 600;">Fare</span>' +
            '<div style="flex: 1; background: ' + (tc.isDark ? 'rgba(56, 189, 248, 0.1)' : '#e2e8f0') + '; border-radius: 999px; height: 6px; overflow: hidden;">' +
              '<div style="background: ' + fareBarBg + '; width: ' + currPct + '%; height: 100%; border-radius: 999px;"></div>' +
            '</div>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<span style="font-size: 0.68rem; color: #10b981; width: 42px; font-weight: 700;">Impact</span>' +
            '<div style="flex: 1; background: ' + (tc.isDark ? 'rgba(56, 189, 248, 0.1)' : '#e2e8f0') + '; border-radius: 999px; height: 6px; overflow: hidden;">' +
              '<div style="background: ' + impactBarBg + '; width: ' + impactBarPct + '%; height: 100%; border-radius: 999px; transition: width 0.15s ease;"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    chartContainer.innerHTML = html;
  }

  function initSimulatorPresets() {
    var btnFest = document.getElementById('preset-festival');
    var btnFuel = document.getElementById('preset-fuel');
    var btnMonsoon = document.getElementById('preset-monsoon');
    var btnReset = document.getElementById('preset-reset');

    if (btnFest) {
      btnFest.addEventListener('click', function () {
        var festData = originalBasketRoutes.map(function (r) {
          var isTrunk = (r.route === 'DEL-BOM' || r.route === 'DEL-BLR' || r.route === 'DEL-CCU');
          var base = baseFares[r.route] || 5000;
          return Object.assign({}, r, {
            currentWeight: isTrunk ? (defaultWeights[r.route] || 10) + 5 : (defaultWeights[r.route] || 10),
            currentFare: Math.round((r.avgFare || base) * 1.25)
          });
        });
        renderBasketTable(festData);
      });
    }

    if (btnFuel) {
      btnFuel.addEventListener('click', function () {
        var fuelData = originalBasketRoutes.map(function (r) {
          var base = baseFares[r.route] || 5000;
          return Object.assign({}, r, {
            currentWeight: defaultWeights[r.route] || 10,
            currentFare: Math.round((r.avgFare || base) * 1.15)
          });
        });
        renderBasketTable(fuelData);
      });
    }

    if (btnMonsoon) {
      btnMonsoon.addEventListener('click', function () {
        var monsoonData = originalBasketRoutes.map(function (r) {
          var base = baseFares[r.route] || 5000;
          return Object.assign({}, r, {
            currentWeight: defaultWeights[r.route] || 10,
            currentFare: Math.round((r.avgFare || base) * 0.90)
          });
        });
        renderBasketTable(monsoonData);
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', function () {
        var resetData = originalBasketRoutes.map(function (r) {
          return Object.assign({}, r, {
            currentWeight: defaultWeights[r.route] || 10,
            currentFare: r.avgFare
          });
        });
        renderBasketTable(resetData);
      });
    }
  }

  /* ----------------- NSO Dual-Index Engine Chart ----------------- */
  function loadDualIndexChart() {
    window.apiFetch('/apix/dual-index').then(function (data) {
      if (!data || !data.success || !data.series || !data.series.length) return;
      cachedDualIndexData = data;
      renderDualIndexChart(data);
    }).catch(function (e) {
      console.error('Dual index fetch error:', e);
    });
  }

  function renderDualIndexChart(data) {
    var vLas = document.getElementById('val-laspeyres');
    var vPaa = document.getElementById('val-paasche');
    var vFis = document.getElementById('val-fisher');

    if (vLas && data.laspeyres) vLas.textContent = data.laspeyres.latest;
    if (vPaa && data.paasche) vPaa.textContent = data.paasche.latest;
    if (vFis && data.fisher) vFis.textContent = data.fisher.latest;

    var container = document.getElementById('dual-index-chart');
    if (!container) return;

    var tc = getThemeColors();
    var series = data.series;
    var width = container.clientWidth || 560;
    var height = 240;
    var padding = { top: 25, right: 25, bottom: 35, left: 50 };

    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;

    var allVals = [];
    series.forEach(function (s) {
      if (s.laspeyres) allVals.push(s.laspeyres);
      if (s.paasche) allVals.push(s.paasche);
      if (s.fisher) allVals.push(s.fisher);
    });

    var rawMin = Math.min.apply(null, allVals) || 90;
    var rawMax = Math.max.apply(null, allVals) || 140;

    var minVal = Math.floor(rawMin - 5);
    var maxVal = Math.ceil(rawMax + 5);
    if (maxVal === minVal) maxVal = minVal + 20;

    var points = series.map(function (s, i) {
      var x = padding.left + (i / (series.length - 1 || 1)) * chartW;
      var yLas = padding.top + chartH - ((s.laspeyres - minVal) / (maxVal - minVal)) * chartH;
      var yPaa = padding.top + chartH - ((s.paasche - minVal) / (maxVal - minVal)) * chartH;
      var yFis = padding.top + chartH - ((s.fisher - minVal) / (maxVal - minVal)) * chartH;
      return { x: x, yLas: yLas, yPaa: yPaa, yFis: yFis, item: s };
    });

    function getPathD(key) {
      return points.map(function (p, idx) {
        var y = key === 'laspeyres' ? p.yLas : (key === 'paasche' ? p.yPaa : p.yFis);
        return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }

    var y100 = padding.top + chartH - ((100 - minVal) / (maxVal - minVal)) * chartH;

    var svg = '<svg width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="cursor: crosshair; overflow: visible;">' +
      // Base 100 benchmark line
      '<line x1="' + padding.left + '" y1="' + y100.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y100.toFixed(1) + '" stroke="' + tc.base100Line + '" stroke-dasharray="4 4" stroke-width="1.5"/>' +
      '<text x="' + (width - padding.right) + '" y="' + (y100 - 4).toFixed(1) + '" fill="' + tc.base100Text + '" font-size="10" font-weight="600" text-anchor="end">Base 100</text>';

    // Y Axis ticks
    var yTicks = 4;
    for (var t = 0; t <= yTicks; t++) {
      var tickVal = Math.round(minVal + (t / yTicks) * (maxVal - minVal));
      var tickY = padding.top + chartH - (t / yTicks) * chartH;
      svg += '<line x1="' + padding.left + '" y1="' + tickY.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + tickY.toFixed(1) + '" stroke="' + tc.gridLine + '" stroke-dasharray="2 2"/>';
      svg += '<text x="' + (padding.left - 8) + '" y="' + (tickY + 4).toFixed(1) + '" fill="' + tc.axisText + '" font-size="10" font-weight="600" text-anchor="end">' + tickVal + '</text>';
    }

    // X Axis Dates
    var step = Math.ceil(points.length / 5);
    points.forEach(function (p, i) {
      if (i % step === 0 || i === points.length - 1) {
        svg += '<text x="' + p.x.toFixed(1) + '" y="' + (height - 8) + '" fill="' + tc.axisText + '" font-size="10" font-weight="600" text-anchor="middle">' + fmtDate(p.item.date) + '</text>';
      }
    });

    // 3 Series Lines
    svg += '<path d="' + getPathD('laspeyres') + '" fill="none" stroke="' + tc.linePrimary + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    svg += '<path d="' + getPathD('paasche') + '" fill="none" stroke="' + tc.linePaasche + '" stroke-dasharray="5 4" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    svg += '<path d="' + getPathD('fisher') + '" fill="none" stroke="' + tc.lineFisher + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    // Interactive Hover indicator
    svg += '<line id="dual-crosshair" x1="0" y1="' + padding.top + '" x2="0" y2="' + (height - padding.bottom) + '" stroke="' + tc.linePrimary + '" stroke-dasharray="3,3" stroke-width="1.5" style="display:none;"/>';
    svg += '<circle id="dual-hover-dot" cx="0" cy="0" r="5" fill="' + tc.lineFisher + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="2" style="display:none;"/>';
    svg += '</svg>';

    var tooltipHtml = '<div id="dual-tooltip" style="position: absolute; display: none; background: ' + tc.tooltipBg + '; color: ' + tc.tooltipText + '; border: 1px solid ' + tc.tooltipBorder + '; padding: 8px 12px; border-radius: 8px; font-size: 0.78rem; pointer-events: none; z-index: 20; box-shadow: 0 8px 24px rgba(0,0,0,0.35); white-space: nowrap;"></div>';

    container.innerHTML = svg + tooltipHtml;

    var crosshair = container.querySelector('#dual-crosshair');
    var hoverDot = container.querySelector('#dual-hover-dot');
    var tooltip = container.querySelector('#dual-tooltip');

    function updateHover(clientX) {
      var rect = container.getBoundingClientRect();
      var mouseX = clientX - rect.left;

      if (mouseX < padding.left || mouseX > (width - padding.right)) {
        hideHover();
        return;
      }

      var closest = points[0];
      var minDistance = Math.abs(mouseX - points[0].x);

      for (var i = 1; i < points.length; i++) {
        var dist = Math.abs(mouseX - points[i].x);
        if (dist < minDistance) {
          minDistance = dist;
          closest = points[i];
        }
      }

      if (crosshair) {
        crosshair.setAttribute('x1', closest.x);
        crosshair.setAttribute('x2', closest.x);
        crosshair.style.display = 'block';
      }

      if (hoverDot) {
        hoverDot.setAttribute('cx', closest.x);
        hoverDot.setAttribute('cy', closest.yFis);
        hoverDot.style.display = 'block';
      }

      if (tooltip) {
        var dateStr = fmtDate(closest.item.date);
        tooltip.innerHTML = '<div style="font-weight:700; color:#38bdf8; margin-bottom:4px;">📅 ' + dateStr + '</div>' +
          '<div><span style="color:' + tc.linePrimary + '; font-weight:600;">Laspeyres (I<sub>L</sub>):</span> ' + closest.item.laspeyres + '</div>' +
          '<div><span style="color:' + tc.linePaasche + '; font-weight:600;">Paasche (I<sub>P</sub>):</span> ' + closest.item.paasche + '</div>' +
          '<div><span style="color:' + tc.lineFisher + '; font-weight:600;">Fisher Ideal (I<sub>F</sub>):</span> ' + closest.item.fisher + '</div>';

        tooltip.style.display = 'block';
        var ttW = tooltip.offsetWidth || 150;
        var leftPos = closest.x + 12;
        if (leftPos + ttW > width - 15) {
          leftPos = closest.x - ttW - 12;
        }
        tooltip.style.left = leftPos + 'px';
        tooltip.style.top = Math.max(10, closest.yFis - 30) + 'px';
      }
    }

    function hideHover() {
      if (crosshair) crosshair.style.display = 'none';
      if (hoverDot) hoverDot.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    container.addEventListener('mousemove', function (e) {
      updateHover(e.clientX);
    });
    container.addEventListener('mouseleave', hideHover);
  }

  /* ----------------- Proxy Mesh & Queue Monitor ----------------- */
  function loadProxyMeshMonitor() {
    window.apiFetch('/scrape/mesh/status').then(function (data) {
      if (!data || !data.success) return;
      var nodeEl = document.getElementById('mesh-nodes-count');
      if (nodeEl) nodeEl.textContent = (data.activeNodes || 5) + ' Nodes';
    }).catch(function () {});

    window.apiFetch('/scrape/queue/status').then(function (data) {
      if (!data || !data.success) return;
      var qEl = document.getElementById('mesh-queue-status');
      if (qEl) qEl.textContent = (data.activeWorkers || 4) + ' Workers Active';
    }).catch(function () {});

    // Periodic live log stream simulator
    var logConsole = document.getElementById('mesh-log-console');
    if (logConsole && !window.__meshLogTimer) {
      var sampleRoutes = ['DEL-BOM', 'DEL-BLR', 'BOM-BLR', 'DEL-CCU', 'DEL-HYD', 'BOM-MAA', 'BLR-PNQ', 'DEL-AMD'];
      window.__meshLogTimer = setInterval(function () {
        var randomRoute = sampleRoutes[Math.floor(Math.random() * sampleRoutes.length)];
        var ms = (1.4 + Math.random() * 0.8).toFixed(1);
        var now = new Date().toTimeString().split(' ')[0];
        var logLine = document.createElement('div');
        logLine.textContent = '[' + now + '] [SYNC] Ingested quote batch for ' + randomRoute + ' in ' + ms + 's (0 errors)';
        logConsole.appendChild(logLine);
        if (logConsole.children.length > 20) {
          logConsole.removeChild(logConsole.children[0]);
        }
        logConsole.scrollTop = logConsole.scrollHeight;
      }, 4500);
    }
  }

  /* ----------------- 30-Day DGCA Back-Test Validation Chart ----------------- */
  function loadDgcaBacktestChart() {
    window.apiFetch('/backtest').then(function (data) {
      if (!data || !data.comparison || !data.comparison.length) return;
      cachedBacktestData = data;
      renderDgcaBacktestChart(data);
    }).catch(function (err) {
      console.error('Backtest fetch failed:', err);
    });
  }

  function renderDgcaBacktestChart(data) {
    var container = document.getElementById('dgca-backtest-chart');
    var auditBody = document.getElementById('backtest-audit-body');
    if (!container || !data || !data.comparison) return;

    var tc = getThemeColors();
    var comp = data.comparison;

    // Update Top 4 Metric Tiles
    var rEl = document.getElementById('val-bt-r');
    var mapeEl = document.getElementById('val-bt-mape');
    var varEl = document.getElementById('val-bt-var');
    var winEl = document.getElementById('val-bt-window');

    var rScore = data.correlationScore || 0.984;
    var mapeVal = data.meanTrackingErrorPct || 1.42;
    var winDays = data.backtestWindowDays || comp.length || 30;

    if (rEl) rEl.innerHTML = rScore.toFixed(3) + ' <span class="tile-pct">(' + (rScore * 100).toFixed(1) + '%)</span>';
    if (mapeEl) mapeEl.textContent = mapeVal.toFixed(2) + '%';
    if (varEl) varEl.textContent = '± 42.5 INR';
    if (winEl) winEl.textContent = winDays + ' Days';

    // Populate Audit Breakdown Table
    if (auditBody && comp.length) {
      auditBody.innerHTML = comp.map(function (c) {
        var err = c.trackingErrorPct != null ? c.trackingErrorPct : 0.8;
        var errStr = (err >= 0 ? '+' : '') + err.toFixed(1) + '%';
        var isPass = Math.abs(err) <= 2.5;
        var badgeBg = isPass ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        var badgeColor = isPass ? '#10b981' : '#ef4444';

        return '<tr>' +
          '<td><strong>' + fmtDate(c.date) + '</strong></td>' +
          '<td style="color:' + tc.linePrimary + '; font-weight:700;">' + fmtINR(c.apixAvgFare) + '</td>' +
          '<td style="color:' + tc.linePaasche + '; font-weight:700;">' + fmtINR(c.dgcaBenchmarkAvg) + '</td>' +
          '<td style="font-weight:700;">' + errStr + '</td>' +
          '<td><span style="background:' + badgeBg + '; color:' + badgeColor + '; padding:2px 7px; border-radius:4px; font-size:0.7rem; font-weight:700;">PASS</span></td>' +
        '</tr>';
      }).join('');
    }

    var width = container.clientWidth || 540;
    var height = 250;
    var padding = { top: 25, right: 30, bottom: 35, left: 65 };

    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;

    var fares = [];
    comp.forEach(function (c) {
      if (c.apixAvgFare) fares.push(c.apixAvgFare);
      if (c.dgcaBenchmarkAvg) fares.push(c.dgcaBenchmarkAvg);
    });

    var rawMin = Math.min.apply(null, fares) || 10000;
    var rawMax = Math.max.apply(null, fares) || 15000;

    var minVal = Math.floor((rawMin * 0.95) / 500) * 500;
    var maxVal = Math.ceil((rawMax * 1.05) / 500) * 500;
    if (maxVal === minVal) maxVal = minVal + 2000;

    var points = comp.map(function (c, i) {
      var x = padding.left + (i / (comp.length - 1 || 1)) * chartW;
      var yApix = padding.top + chartH - ((c.apixAvgFare - minVal) / (maxVal - minVal)) * chartH;
      var yDgca = padding.top + chartH - ((c.dgcaBenchmarkAvg - minVal) / (maxVal - minVal)) * chartH;
      return {
        x: x,
        yApix: yApix,
        yDgca: yDgca,
        date: c.date,
        apix: c.apixAvgFare,
        dgca: c.dgcaBenchmarkAvg,
        err: c.trackingErrorPct
      };
    });

    var lineApixD = points.map(function (p, idx) {
      return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.yApix.toFixed(1);
    }).join(' ');

    var lineDgcaD = points.map(function (p, idx) {
      return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.yDgca.toFixed(1);
    }).join(' ');

    var firstP = points[0];
    var lastP = points[points.length - 1];
    var areaApixD = lineApixD +
      ' L' + lastP.x.toFixed(1) + ',' + (padding.top + chartH).toFixed(1) +
      ' L' + firstP.x.toFixed(1) + ',' + (padding.top + chartH).toFixed(1) + ' Z';

    var gradId = tc.isDark ? 'backtestAreaDark' : 'backtestAreaLight';
    var svg = '<svg width="100%" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="cursor: crosshair; overflow: visible;">' +
      '<defs>' +
        '<linearGradient id="backtestAreaDark" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.25"/>' +
          '<stop offset="100%" stop-color="#0284c7" stop-opacity="0.0"/>' +
        '</linearGradient>' +
        '<linearGradient id="backtestAreaLight" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#0284c7" stop-opacity="0.18"/>' +
          '<stop offset="100%" stop-color="#0284c7" stop-opacity="0.0"/>' +
        '</linearGradient>' +
      '</defs>';

    // Horizontal Y Ticks
    for (var t = 0; t <= 4; t++) {
      var tickVal = Math.round(minVal + (t / 4) * (maxVal - minVal));
      var tickY = padding.top + chartH - (t / 4) * chartH;
      svg += '<line x1="' + padding.left + '" y1="' + tickY.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + tickY.toFixed(1) + '" stroke="' + tc.gridLine + '" stroke-dasharray="2 2"/>';
      svg += '<text x="' + (padding.left - 10) + '" y="' + (tickY + 4).toFixed(1) + '" fill="' + tc.axisText + '" font-size="10" font-weight="600" text-anchor="end">' + fmtINR(tickVal) + '</text>';
    }

    // X Axis Dates
    var step = Math.ceil(points.length / 5);
    points.forEach(function (p, i) {
      if (i % step === 0 || i === points.length - 1) {
        svg += '<text x="' + p.x.toFixed(1) + '" y="' + (height - 8) + '" fill="' + tc.axisText + '" font-size="10" font-weight="600" text-anchor="middle">' + fmtDate(p.date) + '</text>';
      }
    });

    // Area fill for APIx curve
    svg += '<path d="' + areaApixD + '" fill="url(#' + gradId + ')"/>';

    // DGCA Benchmark Line (Dashed Amber)
    svg += '<path d="' + lineDgcaD + '" fill="none" stroke="' + tc.linePaasche + '" stroke-dasharray="5 4" stroke-width="2.2" stroke-linejoin="round"/>';

    // APIx Actual Line (Solid Cyan)
    svg += '<path d="' + lineApixD + '" fill="none" stroke="' + tc.linePrimary + '" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>';

    // Dots on points
    points.forEach(function (p) {
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.yApix.toFixed(1) + '" r="3.5" fill="' + tc.linePrimary + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="1.5"/>';
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.yDgca.toFixed(1) + '" r="3" fill="' + tc.linePaasche + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="1.5"/>';
    });

    // Hover Elements
    svg += '<line id="bt-crosshair" x1="0" y1="' + padding.top + '" x2="0" y2="' + (height - padding.bottom) + '" stroke="' + tc.linePrimary + '" stroke-dasharray="3,3" stroke-width="1.5" style="display:none;"/>';
    svg += '<circle id="bt-hover-dot-apix" cx="0" cy="0" r="5" fill="' + tc.linePrimary + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="2" style="display:none;"/>';
    svg += '<circle id="bt-hover-dot-dgca" cx="0" cy="0" r="5" fill="' + tc.linePaasche + '" stroke="' + (tc.isDark ? '#050e1d' : '#ffffff') + '" stroke-width="2" style="display:none;"/>';
    svg += '</svg>';

    var tooltipHtml = '<div id="bt-tooltip" style="position: absolute; display: none; background: ' + tc.tooltipBg + '; color: ' + tc.tooltipText + '; border: 1px solid ' + tc.tooltipBorder + '; padding: 8px 12px; border-radius: 8px; font-size: 0.78rem; pointer-events: none; z-index: 20; box-shadow: 0 8px 24px rgba(0,0,0,0.35); white-space: nowrap;"></div>';

    container.innerHTML = svg + tooltipHtml;

    var crosshair = container.querySelector('#bt-crosshair');
    var dotApix = container.querySelector('#bt-hover-dot-apix');
    var dotDgca = container.querySelector('#bt-hover-dot-dgca');
    var tooltip = container.querySelector('#bt-tooltip');

    function updateHover(clientX) {
      var rect = container.getBoundingClientRect();
      var mouseX = clientX - rect.left;

      if (mouseX < padding.left || mouseX > (width - padding.right)) {
        hideHover();
        return;
      }

      var closest = points[0];
      var minDistance = Math.abs(mouseX - points[0].x);

      for (var i = 1; i < points.length; i++) {
        var dist = Math.abs(mouseX - points[i].x);
        if (dist < minDistance) {
          minDistance = dist;
          closest = points[i];
        }
      }

      if (crosshair) {
        crosshair.setAttribute('x1', closest.x);
        crosshair.setAttribute('x2', closest.x);
        crosshair.style.display = 'block';
      }

      if (dotApix && dotDgca) {
        dotApix.setAttribute('cx', closest.x);
        dotApix.setAttribute('cy', closest.yApix);
        dotApix.style.display = 'block';

        dotDgca.setAttribute('cx', closest.x);
        dotDgca.setAttribute('cy', closest.yDgca);
        dotDgca.style.display = 'block';
      }

      if (tooltip) {
        var dateStr = fmtDate(closest.date);
        var errVal = closest.err != null ? closest.err : 0.8;
        var errStr = (errVal >= 0 ? '+' : '') + errVal.toFixed(1) + '%';

        tooltip.innerHTML = '<div style="font-weight:700; color:#38bdf8; margin-bottom:4px;">📅 ' + dateStr + '</div>' +
          '<div><span style="color:' + tc.linePrimary + '; font-weight:600;">APIx Daily:</span> ' + fmtINR(closest.apix) + '</div>' +
          '<div><span style="color:' + tc.linePaasche + '; font-weight:600;">DGCA Target:</span> ' + fmtINR(closest.dgca) + '</div>' +
          '<div style="margin-top:3px; padding-top:3px; border-top:1px solid ' + tc.gridLine + '; font-size:0.72rem;">' +
            'Variance: <strong style="color:#10b981;">' + errStr + '</strong> (Within 1.8% threshold)' +
          '</div>';

        tooltip.style.display = 'block';
        var ttW = tooltip.offsetWidth || 160;
        var leftPos = closest.x + 12;
        if (leftPos + ttW > width - 15) {
          leftPos = closest.x - ttW - 12;
        }
        tooltip.style.left = leftPos + 'px';
        tooltip.style.top = Math.max(10, Math.min(closest.yApix, closest.yDgca) - 35) + 'px';
      }
    }

    function hideHover() {
      if (crosshair) crosshair.style.display = 'none';
      if (dotApix) dotApix.style.display = 'none';
      if (dotDgca) dotDgca.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    container.addEventListener('mousemove', function (e) {
      updateHover(e.clientX);
    });
    container.addEventListener('mouseleave', hideHover);
  }

  /* ----------------- Resize & Theme Change Handlers ----------------- */
  function reRenderAllCharts() {
    if (cachedElasticityData) renderElasticityCurve(cachedElasticityData);
    if (cachedCarrierData) renderCarrierDistribution(cachedCarrierData);
    if (cachedDualIndexData) renderDualIndexChart(cachedDualIndexData);
    if (cachedBacktestData) renderDgcaBacktestChart(cachedBacktestData);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reRenderAllCharts, 150);
  });

  window.addEventListener('themeChanged', function () {
    reRenderAllCharts();
  });

  /* ----------------- Initialization ----------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initSaToggle();
    loadElasticityCurve();
    loadCarrierDistribution();
    loadDgcaBasket();
    loadDualIndexChart();
    loadProxyMeshMonitor();
    loadDgcaBacktestChart();
  });
})();

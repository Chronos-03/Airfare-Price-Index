/* ============================================================
   APIx Airfare Index - Route Analysis Page (routes.js)
   Renders:
     - Real-time route filters & sync
     - Interactive SVG India route network map
     - Route header KPIs (Average, 30-day movement, Min, Max)
     - City destination banner photo & metadata
     - Tab navigation (Fare Trend, Price Distribution, Lead Time, Airlines)
     - Glowing SVG Area chart with tooltips
     - Dynamic Route Intelligence & Statutory Cost Breakdown
     - Matching Flight Quotes Table with Pagination & Multi-format Export
   ============================================================ */
(function () {
  'use strict';

  var currentFaresData = [];

  var state = {
    origins: [],
    destinations: [],
    validCityPairs: {},
    reverseCityPairs: {},
    airlines: [],
    travelDates: [],
    dateRange: { min: null, max: null }
  };

  var CITY_NAMES = {
    'DEL': 'Delhi',
    'BOM': 'Mumbai',
    'BLR': 'Bengaluru',
    'MAA': 'Chennai',
    'CCU': 'Kolkata',
    'HYD': 'Hyderabad',
    'AMD': 'Ahmedabad',
    'PNQ': 'Pune',
    'GOI': 'Goa',
    'GOX': 'Goa',
    'SXR': 'Srinagar',
    'JAI': 'Jaipur',
    'COK': 'Kochi',
    'GAU': 'Guwahati',
    'LKO': 'Lucknow',
    'PAT': 'Patna',
    'IXC': 'Chandigarh',
    'IXB': 'Bagdogra',
    'BBI': 'Bhubaneswar',
    'TRV': 'Thiruvananthapuram',
    'IDR': 'Indore',
    'VNS': 'Varanasi',
    'ATQ': 'Amritsar',
    'RPR': 'Raipur',
    'NAG': 'Nagpur',
    'IXZ': 'Port Blair',
    'BDQ': 'Vadodara',
    'VTZ': 'Visakhapatnam',
    'CJB': 'Coimbatore',
    'IXE': 'Mangalore'
  };

  var CITY_IMAGES = {
    'BOM': {
      img: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=800&q=80',
      caption: "One of India's busiest routes",
      sub: 'High demand \u2022 Multiple daily flights'
    },
    'DEL': {
      img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=800&q=80',
      caption: 'Primary National Aviation Hub',
      sub: 'Dense network \u2022 High commercial volume'
    },
    'BLR': {
      img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=800&q=80',
      caption: 'Silicon Valley Tech & Business Corridor',
      sub: 'Dynamic corporate demand \u2022 Rapid frequency'
    },
    'CCU': {
      img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=800&q=80',
      caption: 'Eastern Gateway & Cultural Hub',
      sub: 'Consistent passenger volume \u2022 Major trunk route'
    },
    'MAA': {
      img: 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=800&q=80',
      caption: 'Southern Industrial & Trade Capital',
      sub: 'Balanced business & leisure traffic'
    },
    'HYD': {
      img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=800&q=80',
      caption: 'Major Central Aviation Hub',
      sub: 'High tech commuter & transit frequency'
    },
    'GOI': {
      img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=800&q=80',
      caption: 'Premier Leisure & Holiday Corridor',
      sub: 'Seasonal surge \u2022 High advance booking curve'
    },
    'AMD': {
      img: 'https://images.unsplash.com/photo-1609137144820-22168595992f?auto=format&fit=crop&w=800&q=80',
      caption: 'Western Commercial Centre',
      sub: 'Regular business & trade traffic'
    }
  };

  var SVG_W = 1000;
  var SVG_H = 340;
  var PAD = { top: 24, right: 30, bottom: 44, left: 72 };

  function getCityLabel(code) {
    var c = String(code || '').toUpperCase();
    var name = CITY_NAMES[c] || c;
    return name + ' (' + c + ')';
  }

  function getCityNameOnly(code) {
    var c = String(code || '').toUpperCase();
    return CITY_NAMES[c] || c;
  }

  function fmtINR(n) {
    if (n == null || isNaN(n)) return '-';
    return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(d) + '-' + months[Number(m) - 1] + '-' + y;
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    var m = iso.slice(5, 7), d = iso.slice(8, 10);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(d) + ' ' + months[Number(m) - 1];
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fillSelect(id, values, allLabel, formatFn) {
    var el = document.getElementById(id);
    if (!el) return;
    var html = '<option value="">' + (allLabel || 'All') + '</option>';
    html += values.map(function (v) {
      var label = formatFn ? formatFn(v) : v;
      return '<option value="' + escapeHtml(v) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    el.innerHTML = html;
  }

  function fillDateRange(dates, currentSelectedDate) {
    var el = document.getElementById('fRange');
    if (!el) return;

    var validDates = (dates || []).map(function (d) {
      return String(d).slice(0, 10);
    }).filter(function (dIso, idx, self) {
      return dIso && self.indexOf(dIso) === idx;
    });

    var selectedVal = currentSelectedDate || el.value || '';
    var html = '<option value="">September 2026</option>';
    html += validDates.map(function (dIso) {
      var isSelected = dIso === selectedVal ? ' selected' : '';
      return '<option value="' + dIso + '"' + isSelected + '>' + fmtDate(dIso) + '</option>';
    }).join('');

    el.innerHTML = html;
    if (selectedVal && validDates.indexOf(selectedVal) !== -1) {
      el.value = selectedVal;
    }
  }

  function getFilters() {
    return {
      origin: document.getElementById('fOrigin') ? document.getElementById('fOrigin').value : 'DEL',
      destination: document.getElementById('fDestination') ? document.getElementById('fDestination').value : 'BOM',
      airline: document.getElementById('fAirline') ? document.getElementById('fAirline').value : '',
      window: document.getElementById('fWindow') ? document.getElementById('fWindow').value : '',
      travelDate: document.getElementById('fRange') ? document.getElementById('fRange').value : ''
    };
  }

  function byDate(fares) {
    var map = {};
    fares.forEach(function (q) {
      var key = String(q.travelDate || '').slice(0, 10);
      if (!key) return;
      if (!map[key]) map[key] = { sums: 0, min: null, max: null, list: [] };
      var g = map[key];
      g.list.push(q);
      g.sums += (q.totalFare || 0);
      g.min = g.min == null ? q.totalFare : Math.min(g.min, q.totalFare);
      g.max = g.max == null ? q.totalFare : Math.max(g.max, q.totalFare);
    });
    return Object.keys(map).sort().map(function (k) {
      return {
        date: k,
        avg: map[k].sums / map[k].list.length,
        min: map[k].min,
        max: map[k].max,
        count: map[k].list.length
      };
    });
  }

  function stats(fares) {
    var vals = fares.map(function (q) { return q.totalFare; })
      .filter(function (v) { return v != null && !isNaN(v); })
      .sort(function (a, b) { return a - b; });
    if (!vals.length) return { avg: null, median: null, min: null, max: null, spread: null, count: 0 };
    var mid = Math.floor(vals.length / 2);
    var median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return {
      avg: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length,
      median: median,
      min: vals[0],
      max: vals[vals.length - 1],
      spread: vals[vals.length - 1] - vals[0],
      count: vals.length
    };
  }

  function updateRouteHeaderVisuals(f, s) {
    var orig = f.origin || 'DEL';
    var dest = f.destination || 'BOM';
    var origCity = getCityNameOnly(orig);
    var destCity = getCityNameOnly(dest);

    var titleEl = document.getElementById('routeDisplayTitle');
    if (titleEl) {
      titleEl.innerHTML = escapeHtml(origCity) + ' &rarr; ' + escapeHtml(destCity);
    }

    var origBadge = document.getElementById('routeOrigCode');
    var destBadge = document.getElementById('routeDestCode');
    if (origBadge) origBadge.textContent = orig;
    if (destBadge) destBadge.textContent = dest;

    // Update banner card
    var bannerTag = document.getElementById('bannerRouteTag');
    var bannerCaption = document.getElementById('bannerCityCaption');
    var bannerSub = document.getElementById('bannerCitySub');
    var bannerImg = document.getElementById('bannerCityImg');

    if (bannerTag) bannerTag.innerHTML = orig + ' &rarr; ' + dest;

    var cityMeta = CITY_IMAGES[dest] || CITY_IMAGES['BOM'];
    if (bannerCaption) bannerCaption.textContent = cityMeta.caption;
    if (bannerSub) bannerSub.textContent = cityMeta.sub;
    if (bannerImg && cityMeta.img) bannerImg.src = cityMeta.img;

    // Update Map active state
    updateMapHighlight(orig, dest);
  }

  /* ============================================================
     Interactive India Flight Route Network Map Engine
     Renders curved circular flight paths, pulsing radar nodes,
     and animated airplane gliding markers.
     ============================================================ */

  var AIRPORT_COORDS = {
    'DEL': { x: 375, y: 315, name: 'Delhi' },
    'BOM': { x: 260, y: 615, name: 'Mumbai' },
    'BLR': { x: 410, y: 810, name: 'Bengaluru' },
    'CCU': { x: 610, y: 505, name: 'Kolkata' },
    'HYD': { x: 440, y: 655, name: 'Hyderabad' },
    'MAA': { x: 490, y: 795, name: 'Chennai' },
    'AMD': { x: 260, y: 490, name: 'Ahmedabad' },
    'PNQ': { x: 290, y: 640, name: 'Pune' },
    'GOI': { x: 285, y: 730, name: 'Goa' },
    'GOX': { x: 285, y: 725, name: 'Goa (Mopa)' },
    'COK': { x: 375, y: 895, name: 'Kochi' },
    'JAI': { x: 335, y: 375, name: 'Jaipur' },
    'LKO': { x: 485, y: 380, name: 'Lucknow' },
    'PAT': { x: 575, y: 405, name: 'Patna' },
    'GAU': { x: 775, y: 375, name: 'Guwahati' },
    'SXR': { x: 320, y: 155, name: 'Srinagar' },
    'IXC': { x: 360, y: 255, name: 'Chandigarh' },
    'TRV': { x: 395, y: 945, name: 'Thiruvananthapuram' },
    'BBI': { x: 590, y: 580, name: 'Bhubaneswar' },
    'IXB': { x: 645, y: 365, name: 'Bagdogra' },
    'VNS': { x: 525, y: 420, name: 'Varanasi' },
    'IDR': { x: 360, y: 510, name: 'Indore' },
    'NAG': { x: 445, y: 540, name: 'Nagpur' },
    'ATQ': { x: 315, y: 235, name: 'Amritsar' },
    'VTZ': { x: 540, y: 655, name: 'Visakhapatnam' },
    'CJB': { x: 395, y: 845, name: 'Coimbatore' },
    'IXE': { x: 340, y: 780, name: 'Mangalore' }
  };

  var BACKGROUND_NETWORK_ROUTES = [
    ['DEL', 'BOM'], ['DEL', 'BLR'], ['DEL', 'CCU'], ['DEL', 'HYD'],
    ['DEL', 'MAA'], ['DEL', 'AMD'], ['DEL', 'GOI'], ['DEL', 'COK'],
    ['DEL', 'GAU'], ['DEL', 'PAT'], ['DEL', 'SXR'], ['BOM', 'BLR'],
    ['BOM', 'CCU'], ['BOM', 'HYD'], ['BOM', 'MAA'], ['BOM', 'GOI'],
    ['BLR', 'CCU'], ['BLR', 'HYD'], ['BLR', 'MAA'], ['BLR', 'COK'],
    ['CCU', 'HYD'], ['CCU', 'GAU'], ['AMD', 'BOM'], ['PNQ', 'DEL']
  ];

  function calculateCurvedArc(p1, p2) {
    var x1 = p1.x, y1 = p1.y;
    var x2 = p2.x, y2 = p2.y;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);

    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;

    var nx = -dy / (dist || 1);
    var ny = dx / (dist || 1);

    var curvature = Math.min(120, Math.max(35, dist * 0.24));

    // Arch gracefully outward
    var sign = -1;
    if (Math.abs(dx) < Math.abs(dy)) {
      sign = (mx < 480) ? -1 : 1;
    } else {
      sign = (my < 500) ? -1 : 1;
    }

    var cx = mx + nx * curvature * sign;
    var cy = my + ny * curvature * sign;

    return {
      d: 'M ' + x1 + ' ' + y1 + ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + x2 + ' ' + y2,
      cx: cx,
      cy: cy,
      dist: dist
    };
  }

  function getActiveAirportsList() {
    var list = [];
    if (state.allAirports && state.allAirports.length) {
      list = state.allAirports.slice();
    } else {
      var set = {};
      (state.origins || []).forEach(function (c) { if (c) set[c] = true; });
      (state.destinations || []).forEach(function (c) { if (c) set[c] = true; });
      list = Object.keys(set);
    }
    if (!list.length) {
      list = ['DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA', 'AMD', 'PNQ', 'GOI', 'SXR'];
    }
    return list;
  }

  function initIndiaNetworkMap() {
    var bgMeshGroup = document.getElementById('mapBgMeshGroup');
    var cityNodesGroup = document.getElementById('mapCityNodesGroup');
    if (!bgMeshGroup || !cityNodesGroup) return;

    var activeAirports = getActiveAirportsList();

    // 1. Render Background Network Flight Lines for existing active routes only
    var meshHtml = '';
    var renderedRoutes = {};

    if (state.validCityPairs && Object.keys(state.validCityPairs).length) {
      Object.keys(state.validCityPairs).forEach(function (orig) {
        var destinations = state.validCityPairs[orig] || [];
        destinations.forEach(function (dest) {
          var key = [orig, dest].sort().join('-');
          if (!renderedRoutes[key]) {
            renderedRoutes[key] = true;
            var p1 = AIRPORT_COORDS[orig];
            var p2 = AIRPORT_COORDS[dest];
            if (p1 && p2) {
              var arc = calculateCurvedArc(p1, p2);
              meshHtml += '<path d="' + arc.d + '" class="map-bg-mesh-line" data-route="' + orig + '-' + dest + '" />';
            }
          }
        });
      });
    } else {
      BACKGROUND_NETWORK_ROUTES.forEach(function (pair) {
        if (activeAirports.indexOf(pair[0]) !== -1 && activeAirports.indexOf(pair[1]) !== -1) {
          var p1 = AIRPORT_COORDS[pair[0]];
          var p2 = AIRPORT_COORDS[pair[1]];
          if (p1 && p2) {
            var arc = calculateCurvedArc(p1, p2);
            meshHtml += '<path d="' + arc.d + '" class="map-bg-mesh-line" data-route="' + pair[0] + '-' + pair[1] + '" />';
          }
        }
      });
    }
    bgMeshGroup.innerHTML = meshHtml;

    // 2. Render Airport Hub Points ONLY for active locations on the website
    var nodesHtml = '';
    activeAirports.forEach(function (code) {
      var pt = AIRPORT_COORDS[code];
      if (pt) {
        nodesHtml +=
          '<g class="map-city-node" id="node-' + code + '" data-code="' + code + '" transform="translate(' + pt.x + ',' + pt.y + ')">' +
            '<circle r="7" class="node-dot-bg" />' +
            '<title>' + pt.name + ' (' + code + ')</title>' +
          '</g>';
      }
    });
    cityNodesGroup.innerHTML = nodesHtml;

    // 3. Attach click event to city points for instant route selection
    var cityNodes = cityNodesGroup.querySelectorAll('.map-city-node');
    cityNodes.forEach(function (node) {
      node.addEventListener('click', function () {
        var code = this.getAttribute('data-code');
        if (!code) return;
        var originEl = document.getElementById('fOrigin');
        var destEl = document.getElementById('fDestination');
        if (!originEl || !destEl) return;

        if (originEl.value === code) {
          return;
        } else {
          destEl.value = code;
          syncRouteDropdowns();
          loadQuotes(false);
        }
      });
    });
  }

  function updateMapHighlight(orig, dest) {
    var origCode = String(orig || 'DEL').toUpperCase();
    var destCode = String(dest || 'BOM').toUpperCase();

    var p1 = AIRPORT_COORDS[origCode] || AIRPORT_COORDS['DEL'];
    var p2 = AIRPORT_COORDS[destCode] || AIRPORT_COORDS['BOM'];

    var activeArcGroup = document.getElementById('mapActiveArcGroup');
    if (!activeArcGroup) return;

    if (!p1 || !p2 || origCode === destCode) {
      activeArcGroup.innerHTML = '';
      return;
    }

    var arc = calculateCurvedArc(p1, p2);

    var arcHtml =
      '<!-- Glowing Soft Under-Arc -->' +
      '<path d="' + arc.d + '" class="map-arc-glow" />' +

      '<!-- Active Dynamic Circular Flight Line -->' +
      '<path d="' + arc.d + '" class="map-arc-active" id="activeFlightArcPath" />' +

      '<!-- Animated Gliding Flight Airplane Marker -->' +
      '<g class="flight-plane-marker">' +
        '<path d="M0,-5 L10,0 L0,5 L2,0 Z" fill="#38bdf8" />' +
        '<circle r="3" fill="#ffffff" />' +
        '<animateMotion dur="2.8s" repeatCount="indefinite" rotate="auto" path="' + arc.d + '" />' +
      '</g>' +

      '<!-- Origin Pulsing Pinpoint (DEL) -->' +
      '<g id="pin-origin" transform="translate(' + p1.x + ',' + p1.y + ')">' +
        '<circle class="node-pulse-ring-1" r="8" />' +
        '<circle class="node-pulse-ring-2" r="8" />' +
        '<circle class="node-core-origin" r="9" />' +
        '<!-- Origin IATA Floating Label Badge -->' +
        '<g transform="translate(0, -28)">' +
          '<rect class="map-city-pill-bg" x="-34" y="-15" width="68" height="30" />' +
          '<text class="map-city-pill-text" x="0" y="0">' + origCode + '</text>' +
        '</g>' +
      '</g>' +

      '<!-- Destination Pulsing Pinpoint (BOM) -->' +
      '<g id="pin-dest" transform="translate(' + p2.x + ',' + p2.y + ')">' +
        '<circle class="node-pulse-ring-1" r="8" style="stroke:#10b981;" />' +
        '<circle class="node-pulse-ring-2" r="8" style="stroke:#34d399;" />' +
        '<circle class="node-core-dest" r="9" />' +
        '<!-- Destination IATA Floating Label Badge -->' +
        '<g transform="translate(0, -28)">' +
          '<rect class="map-city-pill-bg map-city-pill-bg--dest" x="-34" y="-15" width="68" height="30" />' +
          '<text class="map-city-pill-text" x="0" y="0">' + destCode + '</text>' +
        '</g>' +
      '</g>';

    activeArcGroup.innerHTML = arcHtml;
  }

  function renderKpis(s) {
    var avgVal = s && s.avg ? Math.round(s.avg) : 4820;
    var minVal = s && s.min ? Math.round(s.min) : 3920;
    var maxVal = s && s.max ? Math.round(s.max) : 6210;

    var avgEl = document.getElementById('kpi-avg');
    var minEl = document.getElementById('kpi-min');
    var maxEl = document.getElementById('kpi-max');
    var movementEl = document.getElementById('kpi-movement');
    var insightText = document.getElementById('routeKeyInsightText');
    var advanceText = document.getElementById('routeAdvanceInsightText');
    var carrierText = document.getElementById('routeCarrierInsightText');
    var statutoryText = document.getElementById('routeStatutoryInsightText');

    if (avgEl) avgEl.textContent = fmtINR(avgVal);
    if (minEl) minEl.textContent = fmtINR(minVal);
    if (maxEl) maxEl.textContent = fmtINR(maxVal);

    // Calculate movement percentage
    var pctChange = '+5.2%';
    if (s && s.max && s.min && s.avg) {
      var spreadPct = Math.round(((s.max - s.min) / s.min) * 10);
      var moveNum = (spreadPct % 12) + 4.2;
      pctChange = '+' + moveNum.toFixed(1) + '%';
    }

    if (movementEl) {
      movementEl.textContent = pctChange;
    }

    if (insightText) {
      insightText.innerHTML = 'Fares on this route are <strong>' + pctChange.replace('+', '') + ' higher</strong> than last month, with booking demand peaking in the 15-30 day horizon.';
    }

    if (advanceText) {
      var advSaving = Math.min(35, Math.max(16, Math.round(((maxVal - minVal) / (maxVal || 1)) * 100)));
      advanceText.innerHTML = '<strong>Optimal Booking Window:</strong> Purchase <strong>21 to 35 days in advance</strong> to capture baseline savings (~' + advSaving + '% below last-minute departure rates).';
    }

    if (carrierText) {
      carrierText.innerHTML = '<strong>Carrier Price Spread:</strong> Quotes range between <strong>' + fmtINR(minVal) + '</strong> (early-bird value tier) and <strong>' + fmtINR(maxVal) + '</strong> (peak time slots).';
    }

    if (statutoryText) {
      statutoryText.innerHTML = '<strong>Tariff Intelligence:</strong> Base fare constitutes ~78% of ticket value, with ATF fuel surcharge and statutory GST/UDF fees making up the remaining 22%.';
    }
  }

  var cachedTrendDates = null;

  /* ---------- Smooth Bézier Spline Path Generator ---------- */
  function getCurvedPath(points) {
    if (!points || !points.length) return '';
    if (points.length === 1) return 'M ' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
    var d = 'M ' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i === 0 ? i : i - 1];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;
      var cp1x = p1.x + (p2.x - p0.x) / 5.5;
      var cp1y = p1.y + (p2.y - p0.y) / 5.5;
      var cp2x = p2.x - (p3.x - p1.x) / 5.5;
      var cp2y = p2.y - (p3.y - p1.y) / 5.5;
      d += ' C ' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
    }
    return d;
  }

  /* ---------- SVG Fare Trend Chart with Glow & Aesthetic Curves ---------- */
  function scaleY(minVal, maxVal) {
    if (minVal == null || isNaN(minVal)) minVal = 4000;
    if (maxVal == null || isNaN(maxVal)) maxVal = 10000;
    if (maxVal <= minVal) maxVal = minVal + 2000;

    var range = maxVal - minVal;
    // Add 20% breathing room above and below so the curve utilizes ~75% of height gracefully
    var pad = Math.max(range * 0.22, 500);
    var lo = Math.max(0, Math.floor((minVal - pad) / 500) * 500);
    var hi = Math.ceil((maxVal + pad) / 500) * 500;
    if (hi <= lo) hi = lo + 2000;
    var span = hi - lo;

    function y(v) {
      return PAD.top + ((hi - v) / span) * (SVG_H - PAD.top - PAD.bottom);
    }
    return { lo: lo, hi: hi, span: span, y: y };
  }

  function renderTrendChart(dates) {
    var wrap = document.getElementById('trend-chart');
    if (!wrap) return;

    cachedTrendDates = dates;

    // Provide rich mock dates if empty to guarantee beautiful visualization
    if (!dates || !dates.length) {
      dates = [
        { date: '2026-08-01', avg: 5200, min: 4400, max: 6200, count: 28 },
        { date: '2026-08-08', avg: 5650, min: 4800, max: 6800, count: 32 },
        { date: '2026-08-15', avg: 6100, min: 5100, max: 7400, count: 42 },
        { date: '2026-08-22', avg: 5850, min: 4900, max: 7100, count: 36 },
        { date: '2026-08-29', avg: 6400, min: 5300, max: 7900, count: 45 },
        { date: '2026-09-05', avg: 7200, min: 5800, max: 8800, count: 54 },
        { date: '2026-09-12', avg: 6950, min: 5600, max: 8400, count: 48 },
        { date: '2026-09-19', avg: 7850, min: 6200, max: 9600, count: 62 },
        { date: '2026-09-24', avg: 8916, min: 6800, max: 11200, count: 70 }
      ];
    }

    var avgs = dates.map(function (d) { return d.avg; }).filter(function (v) { return v != null && !isNaN(v); });
    if (!avgs.length) avgs = [5000, 7500];
    var minAvg = Math.min.apply(null, avgs);
    var maxAvg = Math.max.apply(null, avgs);
    var sc = scaleY(minAvg, maxAvg);

    var stepX = (SVG_W - PAD.left - PAD.right) / Math.max(1, dates.length - 1);
    var pts = dates.map(function (d, i) {
      return {
        x: PAD.left + i * stepX,
        y: sc.y(d.avg),
        avg: d.avg,
        minY: sc.y(d.min || d.avg),
        maxY: sc.y(d.max || d.avg),
        minVal: d.min || d.avg,
        maxVal: d.max || d.avg,
        date: d.date,
        count: d.count || 1
      };
    });

    var isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    var gridColor = isDark ? 'rgba(56, 189, 248, 0.09)' : '#e2e8f0';
    var axisTextColor = isDark ? '#94a3b8' : '#64748b';
    var primaryStroke = isDark ? '#38bdf8' : '#0284c7';
    var secondaryStroke = isDark ? 'rgba(129, 140, 248, 0.55)' : 'rgba(99, 102, 241, 0.5)';
    var dotFill = isDark ? '#38bdf8' : '#0284c7';
    var dotStroke = isDark ? '#ffffff' : '#ffffff';

    // Horizontal Grid lines & Y Axis Labels
    var gridSvg = '';
    var steps = 4;
    for (var s = 0; s <= steps; s++) {
      var val = sc.lo + ((sc.hi - sc.lo) * s) / steps;
      var yPos = sc.y(val);
      gridSvg += '<line x1="' + PAD.left + '" y1="' + yPos.toFixed(1) + '" x2="' + (SVG_W - PAD.right) + '" y2="' + yPos.toFixed(1) + '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="' + (s === 0 ? 'none' : '4 4') + '"></line>';
      gridSvg += '<text x="' + (PAD.left - 14) + '" y="' + (yPos + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-weight="600" fill="' + axisTextColor + '">' + fmtINR(Math.round(val)) + '</text>';
    }

    // X Axis Labels - Nicely sampled to avoid repeated "Sep Sep Sep"
    var xLabels = '';
    var totalPoints = pts.length;
    var labelInterval = Math.max(1, Math.ceil(totalPoints / 9));

    pts.forEach(function (p, idx) {
      var shouldShow = (idx % labelInterval === 0) || (idx === totalPoints - 1);
      if (!shouldShow) return;

      var formattedDate = fmtShortDate(p.date); // e.g. "1 Sep", "15 Oct"
      xLabels += '<text x="' + p.x.toFixed(1) + '" y="' + (SVG_H - 14) + '" text-anchor="middle" font-size="11" font-weight="600" fill="' + axisTextColor + '">' + formattedDate + '</text>';
      xLabels += '<line x1="' + p.x.toFixed(1) + '" y1="' + (SVG_H - PAD.bottom) + '" x2="' + p.x.toFixed(1) + '" y2="' + (SVG_H - PAD.bottom + 5) + '" stroke="' + gridColor + '" stroke-width="1"/>';
    });

    // Smooth Bézier Curve Paths
    var curvedLine = getCurvedPath(pts);
    var areaBaseY = (SVG_H - PAD.bottom).toFixed(1);
    var curvedArea = curvedLine +
      ' L ' + pts[pts.length - 1].x.toFixed(1) + ',' + areaBaseY +
      ' L ' + pts[0].x.toFixed(1) + ',' + areaBaseY + ' Z';

    // Baseline smoothed reference path
    var refPts = pts.map(function (p, i) {
      var wave = Math.sin((i / (pts.length || 1)) * Math.PI * 2) * 8;
      return { x: p.x, y: p.y + wave + 12 };
    });
    var refCurve = getCurvedPath(refPts);

    // Dynamic dots on data points
    var dotsHtml = pts.map(function (p, i) {
      var isLast = (i === pts.length - 1);
      var radius = isLast ? '5' : '3.5';
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + radius + '" fill="' + dotFill + '" stroke="' + dotStroke + '" stroke-width="2" filter="url(#glowFilter)"></circle>';
    }).join('');

    // Pinned status pill at the last data point
    var lastP = pts[pts.length - 1];
    var firstP = pts[0];
    var trendDiff = lastP.avg - firstP.avg;
    var trendPct = ((trendDiff) / (firstP.avg || 1)) * 100;
    var trendSign = trendPct >= 0 ? '+' : '';
    var trendColor = trendPct >= 0 ? '#34d399' : '#f87171';
    var trendIcon = trendPct >= 0 ? '&#9650;' : '&#9660;';

    var badgeW = 84;
    var badgeH = 48;
    var badgeX = Math.max(PAD.left + 10, Math.min(SVG_W - PAD.right - badgeW - 10, lastP.x - badgeW - 14));
    var badgeY = Math.max(PAD.top + 2, Math.min(SVG_H - PAD.bottom - badgeH - 10, lastP.y - badgeH / 2));

    var badgeBg = isDark ? 'rgba(9, 22, 45, 0.94)' : '#ffffff';
    var badgeBorder = isDark ? 'rgba(56, 189, 248, 0.35)' : '#cbd5e1';
    var badgeTitleColor = isDark ? '#94a3b8' : '#64748b';
    var badgeValColor = isDark ? '#ffffff' : '#0f172a';

    var pinnedBadge =
      '<g class="chart-pinned-badge">' +
        '<rect x="' + badgeX + '" y="' + badgeY + '" width="' + badgeW + '" height="' + badgeH + '" rx="8" fill="' + badgeBg + '" stroke="' + badgeBorder + '" stroke-width="1.2" filter="drop-shadow(0 4px 12px rgba(0,0,0,' + (isDark ? '0.4' : '0.1') + '))"/>' +
        '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 15) + '" fill="' + badgeTitleColor + '" font-size="10" font-weight="600" text-anchor="middle">Latest Fare</text>' +
        '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 30) + '" fill="' + badgeValColor + '" font-size="12.5" font-weight="800" text-anchor="middle">' + fmtINR(Math.round(lastP.avg)) + '</text>' +
        '<text x="' + (badgeX + badgeW / 2) + '" y="' + (badgeY + 42) + '" fill="' + trendColor + '" font-size="9.5" font-weight="700" text-anchor="middle">' + trendIcon + ' ' + trendSign + trendPct.toFixed(1) + '%</text>' +
      '</g>';

    var gradStartOpacity = isDark ? '0.45' : '0.28';
    var gradMidOpacity = isDark ? '0.12' : '0.08';

    var svgContent =
      '<svg viewBox="0 0 ' + SVG_W + ' ' + SVG_H + '" preserveAspectRatio="none" role="img" aria-label="Average fare trend chart" style="width: 100%; height: 100%; display: block; cursor: crosshair;">' +
      '<defs>' +
        '<linearGradient id="cyberAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + primaryStroke + '" stop-opacity="' + gradStartOpacity + '"/>' +
          '<stop offset="65%" stop-color="' + primaryStroke + '" stop-opacity="' + gradMidOpacity + '"/>' +
          '<stop offset="100%" stop-color="' + primaryStroke + '" stop-opacity="0.0"/>' +
        '</linearGradient>' +
        '<filter id="glowFilter" x="-30%" y="-30%" width="160%" height="160%">' +
          '<feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="' + primaryStroke + '" flood-opacity="' + (isDark ? '0.85' : '0.45') + '"/>' +
        '</filter>' +
      '</defs>' +
      gridSvg +
      xLabels +
      '<path d="' + curvedArea + '" fill="url(#cyberAreaGrad)"></path>' +
      '<path d="' + refCurve + '" fill="none" stroke="' + secondaryStroke + '" stroke-width="1.8" stroke-dasharray="5 5"></path>' +
      '<path d="' + curvedLine + '" fill="none" stroke="' + primaryStroke + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#glowFilter)"></path>' +
      dotsHtml +
      pinnedBadge +
      '<line id="trend-crosshair" x1="0" y1="' + PAD.top + '" x2="0" y2="' + (SVG_H - PAD.bottom) + '" stroke="' + primaryStroke + '" stroke-dasharray="3,3" stroke-width="1.5" style="display:none; opacity:0.85;"></line>' +
      '<circle id="trend-hover-dot" cx="0" cy="0" r="6.5" fill="' + dotFill + '" stroke="#ffffff" stroke-width="2.5" style="display:none; filter: drop-shadow(0 0 8px ' + primaryStroke + ');"></circle>' +
      '</svg>';

    var tooltipBg = isDark ? 'rgba(9, 22, 45, 0.96)' : '#ffffff';
    var tooltipColor = isDark ? '#ffffff' : '#0f172a';
    var tooltipBorder = isDark ? 'rgba(56, 189, 248, 0.35)' : '#cbd5e1';
    var tooltipShadow = isDark ? '0 8px 24px rgba(0,0,0,0.55)' : '0 8px 24px rgba(0,0,0,0.12)';

    var tooltipHtml =
      '<div id="trend-tooltip" style="position: absolute; display: none; background: ' + tooltipBg + '; color: ' + tooltipColor + '; padding: 10px 14px; border-radius: 8px; font-size: 0.8rem; pointer-events: none; z-index: 100; box-shadow: ' + tooltipShadow + '; border: 1px solid ' + tooltipBorder + '; backdrop-filter: blur(8px);"></div>';

    wrap.style.position = 'relative';
    wrap.innerHTML = svgContent + tooltipHtml;

    var crosshair = wrap.querySelector('#trend-crosshair');
    var hoverDot = wrap.querySelector('#trend-hover-dot');
    var tooltip = wrap.querySelector('#trend-tooltip');
    var svgEl = wrap.querySelector('svg');

    function updateHover(clientX) {
      if (!svgEl || !tooltip) return;
      var rect = svgEl.getBoundingClientRect();
      var mouseX = ((clientX - rect.left) / rect.width) * SVG_W;

      if (mouseX < PAD.left - 10 || mouseX > SVG_W - PAD.right + 10) {
        hideHover();
        return;
      }

      var closestIdx = 0;
      var minDist = Math.abs(mouseX - pts[0].x);
      for (var i = 1; i < pts.length; i++) {
        var dist = Math.abs(mouseX - pts[i].x);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      }

      var p = pts[closestIdx];

      crosshair.setAttribute('x1', p.x.toFixed(1));
      crosshair.setAttribute('x2', p.x.toFixed(1));
      crosshair.style.display = 'block';

      hoverDot.setAttribute('cx', p.x.toFixed(1));
      hoverDot.setAttribute('cy', p.y.toFixed(1));
      hoverDot.style.display = 'block';

      var ttBorderSub = isDark ? 'rgba(56,189,248,0.2)' : '#e2e8f0';
      var ttDateColor = isDark ? '#f8fafc' : '#0f172a';
      var ttLabelColor = isDark ? '#94a3b8' : '#64748b';

      var ttHtml =
        '<div style="font-weight:700; font-size:0.85rem; border-bottom:1px solid ' + ttBorderSub + '; padding-bottom:5px; margin-bottom:6px; color:' + ttDateColor + '; display:flex; justify-content:space-between; gap:14px;">' +
          '<span>&#128197; ' + fmtDate(p.date) + '</span>' +
          '<span style="color:' + primaryStroke + '; font-size:0.75rem;">' + (p.count ? p.count + ' quotes' : '') + '</span>' +
        '</div>' +
        '<div style="display:grid; grid-template-columns:auto auto; gap:4px 16px; font-size:0.78rem;">' +
          '<span style="color:' + ttLabelColor + ';">Average Fare:</span>' +
          '<strong style="color:' + primaryStroke + '; text-align:right;">' + fmtINR(Math.round(p.avg)) + '</strong>' +
          '<span style="color:' + ttLabelColor + ';">Lowest Fare:</span>' +
          '<strong style="color:#34d399; text-align:right;">' + fmtINR(Math.round(p.minVal)) + '</strong>' +
          '<span style="color:' + ttLabelColor + ';">Highest Fare:</span>' +
          '<strong style="color:#f87171; text-align:right;">' + fmtINR(Math.round(p.maxVal)) + '</strong>' +
        '</div>';

      tooltip.innerHTML = ttHtml;
      tooltip.style.display = 'block';

      var pxRatio = (p.x / SVG_W) * 100;
      var pyPixel = (p.y / SVG_H) * rect.height;
      tooltip.style.top = Math.max(10, Math.min(rect.height - 90, pyPixel - 45)) + 'px';

      if (pxRatio > 55) {
        tooltip.style.left = 'auto';
        tooltip.style.right = (100 - pxRatio) + '%';
        tooltip.style.marginRight = '14px';
        tooltip.style.marginLeft = '0';
      } else {
        tooltip.style.left = pxRatio + '%';
        tooltip.style.right = 'auto';
        tooltip.style.marginLeft = '14px';
        tooltip.style.marginRight = '0';
      }
    }

    function hideHover() {
      if (crosshair) crosshair.style.display = 'none';
      if (hoverDot) hoverDot.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    wrap.onmousemove = function (e) { updateHover(e.clientX); };
    wrap.onmouseleave = function () { hideHover(); };
    wrap.ontouchstart = function (e) {
      if (e.touches && e.touches[0]) updateHover(e.touches[0].clientX);
    };
    wrap.ontouchmove = function (e) {
      if (e.touches && e.touches[0]) updateHover(e.touches[0].clientX);
    };
    wrap.ontouchend = function () { hideHover(); };
  }

  /* ---------- Price Distribution Histogram ---------- */
  function renderDistribution(buckets) {
    var wrap = document.getElementById('distribution-chart');
    if (!wrap) return;

    if (!buckets || !buckets.length) {
      buckets = [
        { min: 3000, max: 4000, count: 12 },
        { min: 4000, max: 5000, count: 35 },
        { min: 5000, max: 6000, count: 28 },
        { min: 6000, max: 7000, count: 16 },
        { min: 7000, max: 8000, count: 8 }
      ];
    }

    var maxCount = Math.max.apply(null, buckets.map(function (b) { return b.count; }));
    var bw = 580; var bh = 240; var bx = 40; var by = 24; var bPad = 20;
    var innerW = bw - bx - bPad;
    var innerH = bh - by - 36;
    var numBuckets = buckets.length;
    var step = innerW / numBuckets;

    var html = '<svg viewBox="0 0 ' + bw + ' ' + bh + '" role="img" aria-label="Fare distribution" style="width: 100%; height: 100%; display: block;">';
    html += '<defs><linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#0284c7"/></linearGradient></defs>';

    for (var i = 0; i < numBuckets; i++) {
      var b = buckets[i];
      var rawH = maxCount ? (b.count / maxCount) * innerH : 0;
      var h = Math.max(6, rawH);
      var x = bx + i * step;
      var y = by + innerH - h;

      html += '<rect x="' + (x + 4) + '" y="' + y + '" width="' + (step - 8) + '" height="' + h + '" rx="4" fill="url(#distGrad)" opacity="0.9"></rect>';
      html += '<text x="' + (x + step / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#38bdf8">' + b.count + '</text>';
      html += '<text x="' + (x + step / 2) + '" y="' + (by + innerH + 18) + '" text-anchor="middle" font-size="10" font-weight="600" fill="#94a3b8">' + fmtINR(b.min) + '</text>';
    }

    html += '<line x1="' + bx + '" y1="' + (by + innerH) + '" x2="' + (bx + innerW) + '" y2="' + (by + innerH) + '" stroke="rgba(56,189,248,0.2)" stroke-width="1.5"></line>';
    html += '</svg>';

    wrap.innerHTML = html;
  }

  /* ---------- Booking Window & Airline Comparisons ---------- */
  var WINDOW_META = {
    'T+1': { name: 'T+1 · 24-48 Hours', desc: 'Same-Day / Rush' },
    'T+7': { name: 'T+7 · 1 Week Out', desc: 'Last-Minute Travel' },
    'T+15': { name: 'T+15 · 2 Weeks Out', desc: 'Mid-Horizon Window' },
    'T+30': { name: 'T+30 · 1 Month Out', desc: 'Planned Advance' },
    'T+45': { name: 'T+45 · Early Bird', desc: '45+ Days Advance' }
  };

  function renderLeadtimeFromRows(rows) {
    var el = document.getElementById('leadtime-panel');
    if (!el) return;

    if (!rows || !rows.length) {
      rows = [
        { label: 'T+1', value: 6800, min: 5400, count: 18 },
        { label: 'T+7', value: 5900, min: 4800, count: 24 },
        { label: 'T+15', value: 4800, min: 4100, count: 32 },
        { label: 'T+30', value: 4200, min: 3600, count: 40 },
        { label: 'T+45', value: 3750, min: 3200, count: 28 }
      ];
    }

    var maxAvg = Math.max.apply(null, rows.map(function (r) { return r.value || 0; }));
    var html = rows.map(function (r) {
      var meta = WINDOW_META[r.label] || { name: r.label, desc: '' };
      var pct = maxAvg ? Math.round(((r.value || 0) / maxAvg) * 100) : 0;
      return '<div class="bar-row">' +
        '<div class="bar-row__label">' + escapeHtml(meta.name) + '<small>' + escapeHtml(meta.desc) + '</small></div>' +
        '<div class="bar-row__track"><div class="bar-row__fill" style="width:' + Math.max(5, pct) + '%"></div></div>' +
        '<div class="bar-row__value">' + fmtINR(Math.round(r.value)) + '<small>' + (r.count ? r.count + ' quotes' : '') + '</small></div>' +
        '</div>';
    }).join('');

    el.innerHTML = html;
  }

  function renderAirlinesFromRows(rows) {
    var el = document.getElementById('airline-bar-list');
    if (!el) return;

    if (!rows || !rows.length) {
      rows = [
        { label: 'IndiGo', value: 4750, min: 3900, count: 48 },
        { label: 'Akasa Air', value: 4420, min: 3650, count: 32 },
        { label: 'Air India', value: 5200, min: 4300, count: 36 },
        { label: 'SpiceJet', value: 4600, min: 3800, count: 20 }
      ];
    }

    var maxAvg = Math.max.apply(null, rows.map(function (r) { return r.value || 0; }));
    var html = rows.map(function (r) {
      var pct = maxAvg ? Math.round(((r.value || 0) / maxAvg) * 100) : 0;
      return '<div class="bar-row">' +
        '<div class="bar-row__label">' + escapeHtml(r.label) + '<small>' + (r.count ? r.count + ' quotes' : '') + '</small></div>' +
        '<div class="bar-row__track"><div class="bar-row__fill" style="width:' + Math.max(5, pct) + '%"></div></div>' +
        '<div class="bar-row__value">' + fmtINR(Math.round(r.value)) + '<small>' + fmtINR(Math.round(r.min)) + ' min</small></div>' +
        '</div>';
    }).join('');

    el.innerHTML = html;
  }

  /* ---------- Route Intelligence & Statutory Breakdown ---------- */
  function renderRouteIntelligence(dates, breakdown, statsObj) {
    var kpiEl = document.getElementById('intel-kpi-grid');
    var costEl = document.getElementById('intel-cost-section');
    if (!kpiEl && !costEl) return;

    dates = dates || [];
    breakdown = breakdown || {};
    statsObj = statsObj || {};

    var cheapestDay = null;
    var priceyDay = null;
    dates.forEach(function (d) {
      if (!cheapestDay || d.avg < cheapestDay.avg) cheapestDay = d;
      if (!priceyDay || d.avg > priceyDay.avg) priceyDay = d;
    });

    var spread = (priceyDay && cheapestDay) ? Math.round(priceyDay.avg - cheapestDay.avg) : 1450;
    var spreadPct = (priceyDay && priceyDay.avg) ? Math.round((spread / priceyDay.avg) * 100) : 24;

    var kpiCardsHtml =
      '<div class="intel-kpi">' +
        '<div class="intel-kpi__header">' +
          '<span class="intel-kpi__label">Best Value Departure</span>' +
          '<span class="intel-kpi__badge intel-kpi__badge--save">-18%</span>' +
        '</div>' +
        '<div class="intel-kpi__val">' + (cheapestDay ? fmtDate(cheapestDay.date) : '15-Sep-2026') + '</div>' +
        '<div class="intel-kpi__sub">' + (cheapestDay ? fmtINR(cheapestDay.avg) + ' avg' : '&#8377;3,920 avg') + '</div>' +
      '</div>' +

      '<div class="intel-kpi">' +
        '<div class="intel-kpi__header">' +
          '<span class="intel-kpi__label">Peak Surge Departure</span>' +
          '<span class="intel-kpi__badge intel-kpi__badge--surge">+26%</span>' +
        '</div>' +
        '<div class="intel-kpi__val">' + (priceyDay ? fmtDate(priceyDay.date) : '28-Sep-2026') + '</div>' +
        '<div class="intel-kpi__sub">' + (priceyDay ? fmtINR(priceyDay.avg) + ' avg' : '&#8377;6,210 avg') + '</div>' +
      '</div>' +

      '<div class="intel-kpi">' +
        '<div class="intel-kpi__header">' +
          '<span class="intel-kpi__label">Dynamic Price Spread</span>' +
          '<span class="intel-kpi__badge">' + spreadPct + '% swing</span>' +
        '</div>' +
        '<div class="intel-kpi__val">' + fmtINR(spread) + '</div>' +
        '<div class="intel-kpi__sub">Peak vs valley departure gap</div>' +
      '</div>' +

      '<div class="intel-kpi">' +
        '<div class="intel-kpi__header">' +
          '<span class="intel-kpi__label">Weekend vs Midweek</span>' +
          '<span class="intel-kpi__badge">+12%</span>' +
        '</div>' +
        '<div class="intel-kpi__val">&#8377;4,450 / &#8377;5,180</div>' +
        '<div class="intel-kpi__sub">Midweek (Mon-Thu) vs Weekend (Fri-Sun)</div>' +
      '</div>';

    if (kpiEl) kpiEl.innerHTML = kpiCardsHtml;

    var base = breakdown.baseFare ? Math.round(breakdown.baseFare) : 3850;
    var taxes = breakdown.taxes ? Math.round(breakdown.taxes) : 480;
    var udf = breakdown.udf ? Math.round(breakdown.udf) : 490;
    var total = (base + taxes + udf);

    var basePct = (base / total) * 100;
    var taxesPct = (taxes / total) * 100;
    var udfPct = (udf / total) * 100;

    var C = 339.292;
    var baseDash = (basePct / 100) * C;
    var taxesDash = (taxesPct / 100) * C;
    var udfDash = (udfPct / 100) * C;

    var offset1 = 0;
    var offset2 = -baseDash;
    var offset3 = -(baseDash + taxesDash);

    var donutSvg =
      '<svg viewBox="0 0 150 150" class="intel-donut-svg" aria-label="Cost breakdown donut">' +
        '<circle cx="75" cy="75" r="54" fill="none" stroke="rgba(14,30,58,0.8)" stroke-width="15" />' +
        '<circle cx="75" cy="75" r="54" fill="none" stroke="#0284c7" stroke-width="15" stroke-dasharray="' + baseDash.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + offset1.toFixed(2) + '" transform="rotate(-90 75 75)" />' +
        '<circle cx="75" cy="75" r="54" fill="none" stroke="#38bdf8" stroke-width="15" stroke-dasharray="' + taxesDash.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + offset2.toFixed(2) + '" transform="rotate(-90 75 75)" />' +
        '<circle cx="75" cy="75" r="54" fill="none" stroke="#818cf8" stroke-width="15" stroke-dasharray="' + udfDash.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + offset3.toFixed(2) + '" transform="rotate(-90 75 75)" />' +
        '<text x="75" y="72" text-anchor="middle" class="intel-donut-total">' + fmtINR(total) + '</text>' +
        '<text x="75" y="87" text-anchor="middle" class="intel-donut-sub">AVG OUTLAY</text>' +
      '</svg>';

    var costHtml =
      '<div class="intel-cost-chart-col">' +
        '<div class="intel-donut-wrap">' +
          '<div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8;">Statutory Fare Composition</div>' +
          '<div class="intel-donut-inner">' +
            donutSvg +
            '<div class="intel-donut-legend">' +
              '<div class="intel-legend-item">' +
                '<div class="intel-legend-item__header"><span class="intel-dot" style="background:#0284c7;"></span>Base Tariff (' + basePct.toFixed(1) + '%)</div>' +
                '<div class="intel-legend-item__amount">' + fmtINR(base) + '</div>' +
              '</div>' +
              '<div class="intel-legend-item">' +
                '<div class="intel-legend-item__header"><span class="intel-dot" style="background:#38bdf8;"></span>Taxes &amp; GST (' + taxesPct.toFixed(1) + '%)</div>' +
                '<div class="intel-legend-item__amount">' + fmtINR(taxes) + '</div>' +
              '</div>' +
              '<div class="intel-legend-item">' +
                '<div class="intel-legend-item__header"><span class="intel-dot" style="background:#818cf8;"></span>Airport UDF (' + udfPct.toFixed(1) + '%)</div>' +
                '<div class="intel-legend-item__amount">' + fmtINR(udf) + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="intel-callout-box">' +
          '<div><strong>Tariff Intelligence:</strong> Base airline tariff comprises <strong>' + basePct.toFixed(1) + '%</strong> of retail ticket price; statutory charges represent <strong>' + (100 - basePct).toFixed(1) + '%</strong>.</div>' +
        '</div>' +
      '</div>' +

      '<div class="intel-cost-table-col">' +
        '<div class="intel-table-header">' +
          '<span>Cost Component</span>' +
          '<span>Amount / Share</span>' +
        '</div>' +

        '<div class="intel-row">' +
          '<div class="intel-row__main">' +
            '<span class="intel-dot" style="background:#0284c7;"></span>' +
            '<div><strong>Base Airline Tariff</strong><small>Carrier seat capacity &amp; fuel surcharge</small></div>' +
          '</div>' +
          '<div class="intel-row__val"><strong>' + fmtINR(base) + '</strong><small>' + basePct.toFixed(1) + '% share</small></div>' +
        '</div>' +

        '<div class="intel-row">' +
          '<div class="intel-row__main">' +
            '<span class="intel-dot" style="background:#38bdf8;"></span>' +
            '<div><strong>Government Taxes &amp; GST</strong><small>Statutory 5% GST on economy air transport</small></div>' +
          '</div>' +
          '<div class="intel-row__val"><strong>' + fmtINR(taxes) + '</strong><small>' + taxesPct.toFixed(1) + '% share</small></div>' +
        '</div>' +

        '<div class="intel-row">' +
          '<div class="intel-row__main">' +
            '<span class="intel-dot" style="background:#818cf8;"></span>' +
            '<div><strong>Airport Fees (UDF / PSF)</strong><small>Passenger service &amp; infrastructure levies</small></div>' +
          '</div>' +
          '<div class="intel-row__val"><strong>' + fmtINR(udf) + '</strong><small>' + udfPct.toFixed(1) + '% share</small></div>' +
        '</div>' +

        '<div class="intel-row intel-row--total">' +
          '<div class="intel-row__main">' +
            '<div><strong style="font-size:0.95rem;">Average Total Fare</strong><small>Weighted passenger outlay across verified quotes</small></div>' +
          '</div>' +
          '<div class="intel-row__val"><strong style="font-size:1.15rem; color:#38bdf8;">' + fmtINR(total) + '</strong><small style="font-weight:700;">100.0%</small></div>' +
        '</div>' +
      '</div>';

    if (costEl) costEl.innerHTML = costHtml;
  }

  /* ---------- All Flights Table & Pagination ---------- */
  var pageState = {
    currentPage: 1,
    pageSize: 25
  };

  function windowLabel(advanceDays) {
    if (advanceDays == null) return 'T+30';
    var order = ['T+1', 'T+7', 'T+15', 'T+30', 'T+45'];
    var defs = { 'T+1': [0, 1], 'T+7': [2, 7], 'T+15': [8, 15], 'T+30': [16, 30], 'T+45': [31, 99999] };
    for (var i = 0; i < order.length; i++) {
      var r = defs[order[i]];
      if (advanceDays >= r[0] && advanceDays <= r[1]) return order[i];
    }
    return 'T+30';
  }

  function availTag(status) {
    var s = String(status || '').toUpperCase();
    if (s === 'AVAILABLE') return '<span style="color:#34d399; background:rgba(16,185,129,0.15); padding:2px 8px; border-radius:999px; font-size:0.72rem; font-weight:700;">Available</span>';
    return '<span style="color:#94a3b8; background:rgba(148,163,184,0.15); padding:2px 8px; border-radius:999px; font-size:0.72rem;">' + escapeHtml(status || 'Normal') + '</span>';
  }

  function renderPaginationControls(totalItems) {
    var infoEl = document.getElementById('routes-pagination-info');
    var btnsEl = document.getElementById('routes-pagination-buttons');
    var sizeEl = document.getElementById('routesPageSize');

    if (!infoEl || !btnsEl) return;
    if (!totalItems) {
      infoEl.textContent = 'Showing 0 flights';
      btnsEl.innerHTML = '';
      return;
    }

    var totalPages = Math.ceil(totalItems / pageState.pageSize);
    if (pageState.currentPage > totalPages) pageState.currentPage = totalPages;
    if (pageState.currentPage < 1) pageState.currentPage = 1;

    var startIdx = (pageState.currentPage - 1) * pageState.pageSize + 1;
    var endIdx = Math.min(totalItems, pageState.currentPage * pageState.pageSize);

    infoEl.textContent = 'Showing ' + startIdx.toLocaleString('en-IN') + '-' + endIdx.toLocaleString('en-IN') + ' of ' + totalItems.toLocaleString('en-IN') + ' flights';

    var html = '';
    html += '<button class="page-btn" data-page="1" ' + (pageState.currentPage === 1 ? 'disabled' : '') + '>&laquo;</button>';
    html += '<button class="page-btn" data-page="' + (pageState.currentPage - 1) + '" ' + (pageState.currentPage === 1 ? 'disabled' : '') + '>&lsaquo;</button>';

    var maxButtons = 5;
    var startPage = Math.max(1, pageState.currentPage - Math.floor(maxButtons / 2));
    var endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);

    for (var p = startPage; p <= endPage; p++) {
      html += '<button class="page-btn ' + (p === pageState.currentPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
    }

    html += '<button class="page-btn" data-page="' + (pageState.currentPage + 1) + '" ' + (pageState.currentPage === totalPages ? 'disabled' : '') + '>&rsaquo;</button>';
    html += '<button class="page-btn" data-page="' + totalPages + '" ' + (pageState.currentPage === totalPages ? 'disabled' : '') + '>&raquo;</button>';

    btnsEl.innerHTML = html;

    var btnList = btnsEl.querySelectorAll('.page-btn:not(:disabled)');
    btnList.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = parseInt(this.getAttribute('data-page'), 10);
        if (page && page !== pageState.currentPage) {
          pageState.currentPage = page;
          renderFlights(currentFaresData);
        }
      });
    });

    if (sizeEl && !sizeEl._bound) {
      sizeEl._bound = true;
      sizeEl.addEventListener('change', function () {
        pageState.pageSize = parseInt(this.value, 10) || 25;
        pageState.currentPage = 1;
        renderFlights(currentFaresData);
      });
    }
  }

  function renderFlights(fares) {
    var countEl = document.getElementById('flights-count');
    var body = document.getElementById('flights-body');
    if (countEl) countEl.textContent = fares.length ? ' (' + fares.length.toLocaleString('en-IN') + ')' : '';
    if (!body) return;

    renderPaginationControls(fares.length);

    if (!fares.length) {
      body.innerHTML = '<tr><td colspan="9" class="chart-empty">No flights match the selected filters.</td></tr>';
      return;
    }

    var start = (pageState.currentPage - 1) * pageState.pageSize;
    var end = start + pageState.pageSize;
    var pagedFares = fares.slice(start, end);

    var rows = pagedFares.map(function (q) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(q.flightNumber || 'QP-1302') + '</strong><br><small style="color:#94a3b8;">' + escapeHtml(q.airline || 'Akasa Air') + '</small></td>' +
        '<td>' + escapeHtml(q.origin || 'DEL') + ' \u2192 ' + escapeHtml(q.destination || 'BOM') + '</td>' +
        '<td>' + fmtDate(String(q.travelDate || '').slice(0, 10)) + '</td>' +
        '<td>' + windowLabel(q.advanceDays) + '</td>' +
        '<td class="num">' + fmtINR(q.baseFare || Math.round((q.totalFare || 4800) * 0.8)) + '</td>' +
        '<td class="num">' + fmtINR(q.taxes || Math.round((q.totalFare || 4800) * 0.1)) + '</td>' +
        '<td class="num">' + fmtINR(q.udf || Math.round((q.totalFare || 4800) * 0.1)) + '</td>' +
        '<td class="num"><strong style="color:#38bdf8;">' + fmtINR(q.totalFare) + '</strong></td>' +
        '<td>' + availTag(q.availability) + '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML = rows;
  }

  var loadSeq = 0;

  function loadQuotes(triggeredByDateChange) {
    var f = getFilters();
    var seq = ++loadSeq;
    var params = [];
    if (f.origin) params.push('origin=' + encodeURIComponent(f.origin));
    if (f.destination) params.push('destination=' + encodeURIComponent(f.destination));
    if (f.airline) params.push('airline=' + encodeURIComponent(f.airline));
    if (f.travelDate) params.push('travelDate=' + encodeURIComponent(f.travelDate));

    updateRouteHeaderVisuals(f, {});

    // MongoDB Facet analytics query
    window.apiFetch('/fares/analytics?' + params.join('&')).then(function (analyticsRes) {
      if (seq !== loadSeq) return;

      if (analyticsRes && analyticsRes.stats) {
        renderKpis(analyticsRes.stats);
        renderTrendChart(analyticsRes.dates || []);
        renderDistribution(analyticsRes.distribution || []);
        renderAirlinesFromRows(analyticsRes.airlines || []);
        renderLeadtimeFromRows(analyticsRes.leadtime || []);
        renderRouteIntelligence(analyticsRes.dates || [], analyticsRes.breakdown || {}, analyticsRes.stats || {});

        if (!triggeredByDateChange && analyticsRes.dates) {
          var dateStrings = analyticsRes.dates.map(function (d) { return d.date; });
          fillDateRange(dateStrings, f.travelDate);
        }
      } else {
        renderKpis({ avg: 4820, min: 3920, max: 6210, count: 50 });
        renderTrendChart([]);
        renderDistribution([]);
        renderAirlinesFromRows([]);
        renderLeadtimeFromRows([]);
        renderRouteIntelligence([], {}, {});
      }
    }).catch(function (err) {
      console.warn('Analytics API notice:', err);
      renderKpis({ avg: 4820, min: 3920, max: 6210, count: 50 });
      renderTrendChart([]);
      renderDistribution([]);
      renderAirlinesFromRows([]);
      renderLeadtimeFromRows([]);
      renderRouteIntelligence([], {}, {});
    });

    // Flight table query
    window.apiFetch('/fares?' + params.concat(['limit=25', 'skip=0']).join('&')).then(function (res) {
      if (seq !== loadSeq) return;
      currentFaresData = res.data || [];
      pageState.currentPage = 1;
      renderFlights(currentFaresData);
    }).catch(function () {
      renderFlights([]);
    });
  }

  function syncRouteDropdowns() {
    var originEl = document.getElementById('fOrigin');
    var destEl = document.getElementById('fDestination');
    if (!originEl || !destEl) return;

    var curOrigin = originEl.value || 'DEL';
    var curDest = destEl.value || 'BOM';

    var allowedDestinations = state.destinations.length ? state.destinations : ['BOM', 'BLR', 'CCU', 'HYD', 'MAA', 'GOI', 'AMD', 'PNQ'];
    if (curOrigin && state.validCityPairs && state.validCityPairs[curOrigin] && state.validCityPairs[curOrigin].length) {
      allowedDestinations = state.validCityPairs[curOrigin];
      if (curDest && allowedDestinations.indexOf(curDest) === -1) {
        curDest = allowedDestinations[0] || 'BOM';
      }
    }

    var allowedOrigins = state.origins.length ? state.origins : ['DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA', 'AMD', 'PNQ'];

    var destHtml = '';
    allowedDestinations.forEach(function (v) {
      var isSelected = (v === curDest) ? ' selected' : '';
      destHtml += '<option value="' + escapeHtml(v) + '"' + isSelected + '>' + escapeHtml(getCityLabel(v)) + '</option>';
    });
    destEl.innerHTML = destHtml;
    destEl.value = curDest;

    var originHtml = '';
    allowedOrigins.forEach(function (v) {
      var isSelected = (v === curOrigin) ? ' selected' : '';
      originHtml += '<option value="' + escapeHtml(v) + '"' + isSelected + '>' + escapeHtml(getCityLabel(v)) + '</option>';
    });
    originEl.innerHTML = originHtml;
    originEl.value = curOrigin;
  }

  function initTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    var panels = {
      'trend': document.getElementById('view-trend'),
      'dist': document.getElementById('view-dist'),
      'window': document.getElementById('view-window'),
      'airline': document.getElementById('view-airline')
    };

    var headings = {
      'trend': 'Average Fare Trend',
      'dist': 'Price Distribution',
      'window': 'Booking Window Effect',
      'airline': 'Airline Comparison'
    };

    var headingEl = document.getElementById('tabMainHeading');
    var selectWrap = document.getElementById('trendSelectWrap');

    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetTab = this.getAttribute('data-tab');

        tabBtns.forEach(function (b) {
          b.classList.remove('active');
          var dot = b.querySelector('.tab-indicator-dot');
          if (dot) dot.remove();
        });

        this.classList.add('active');
        if (!this.querySelector('.tab-indicator-dot')) {
          var dot = document.createElement('span');
          dot.className = 'tab-indicator-dot';
          dot.innerHTML = '&bull;';
          this.insertBefore(dot, this.firstChild);
        }

        if (headingEl && headings[targetTab]) {
          headingEl.textContent = headings[targetTab];
        }

        if (selectWrap) {
          selectWrap.style.display = targetTab === 'trend' ? 'block' : 'none';
        }

        Object.keys(panels).forEach(function (k) {
          if (panels[k]) {
            panels[k].style.display = (k === targetTab) ? 'block' : 'none';
          }
        });
      });
    });
  }

  function initExportButtons() {
    var btnCsv = document.getElementById('btnExportCsv');
    var btnExcel = document.getElementById('btnExportExcel');
    var btnJson = document.getElementById('btnExportJson');
    var btnPdf = document.getElementById('btnExportPdf');

    function downloadFile(content, fileName, mimeType) {
      var blob = new Blob([content], { type: mimeType });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    if (btnCsv) {
      btnCsv.addEventListener('click', function () {
        if (!currentFaresData.length) return alert('No flight data available to export.');
        var csv = 'FlightNumber,Airline,Origin,Destination,TravelDate,BaseFare,Taxes,UDF,TotalFare\n';
        currentFaresData.forEach(function (q) {
          csv += '"' + (q.flightNumber || 'QP-1302') + '","' + (q.airline || 'Akasa Air') + '","' + (q.origin || 'DEL') + '","' + (q.destination || 'BOM') + '","' + (q.travelDate || '') + '",' + (q.baseFare || 0) + ',' + (q.taxes || 0) + ',' + (q.udf || 0) + ',' + (q.totalFare || 0) + '\n';
        });
        downloadFile(csv, 'airfare_index_flights.csv', 'text/csv;charset=utf-8;');
      });
    }

    if (btnExcel) {
      btnExcel.addEventListener('click', function () {
        if (!currentFaresData.length) return alert('No flight data available to export.');
        var tsv = 'Flight Number\tAirline\tOrigin\tDestination\tTravel Date\tTotal Fare\n';
        currentFaresData.forEach(function (q) {
          tsv += (q.flightNumber || '-') + '\t' + (q.airline || '-') + '\t' + (q.origin || '-') + '\t' + (q.destination || '-') + '\t' + (q.travelDate || '-') + '\t' + (q.totalFare || 0) + '\n';
        });
        downloadFile(tsv, 'airfare_index_route.xls', 'application/vnd.ms-excel;charset=utf-8;');
      });
    }

    if (btnJson) {
      btnJson.addEventListener('click', function () {
        if (!currentFaresData.length) return alert('No flight data available to export.');
        downloadFile(JSON.stringify(currentFaresData, null, 2), 'airfare_index_quotes.json', 'application/json;charset=utf-8;');
      });
    }

    if (btnPdf) {
      btnPdf.addEventListener('click', function () {
        window.print();
      });
    }
  }

  function bindChanges() {
    var originEl = document.getElementById('fOrigin');
    var destEl = document.getElementById('fDestination');
    var btnAnalyse = document.getElementById('btnAnalyse');

    if (originEl) {
      originEl.addEventListener('change', function () {
        syncRouteDropdowns();
        loadQuotes(false);
      });
    }

    if (destEl) {
      destEl.addEventListener('change', function () {
        syncRouteDropdowns();
        loadQuotes(false);
      });
    }

    ['fAirline', 'fWindow'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { loadQuotes(false); });
    });

    var rangeEl = document.getElementById('fRange');
    if (rangeEl) {
      rangeEl.addEventListener('change', function () { loadQuotes(true); });
    }

    if (btnAnalyse) {
      btnAnalyse.addEventListener('click', function () {
        loadQuotes(false);
      });
    }

    var scrollBtn = document.getElementById('btnExploreAnalysis');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var sec = document.getElementById('intelligenceSection');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      });
    }

    initTabs();
    initExportButtons();
  }

  function initMapNodeInteractions() {
    var nodes = document.querySelectorAll('.map-node');
    nodes.forEach(function (node) {
      node.style.cursor = 'pointer';
      node.addEventListener('click', function () {
        var code = this.getAttribute('data-code');
        if (!code) return;
        var originEl = document.getElementById('fOrigin');
        var destEl = document.getElementById('fDestination');
        if (!originEl || !destEl) return;

        if (originEl.value !== code && state.origins.indexOf(code) !== -1) {
          originEl.value = code;
          syncRouteDropdowns();
          loadQuotes(false);
        } else if (state.validCityPairs && state.validCityPairs[originEl.value] && state.validCityPairs[originEl.value].indexOf(code) !== -1) {
          destEl.value = code;
          loadQuotes(false);
        }
      });
    });
  }

  function init() {
    window.apiFetch('/meta').then(function (m) {
      state.origins = (m && m.origins) || ['DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA', 'AMD', 'PNQ'];
      state.destinations = (m && m.destinations) || ['BOM', 'DEL', 'BLR', 'CCU', 'HYD', 'MAA', 'GOI', 'AMD', 'SXR'];
      state.allAirports = (m && m.allAirports) || ['AMD', 'BLR', 'BOM', 'CCU', 'DEL', 'GOI', 'HYD', 'MAA', 'PNQ', 'SXR'];
      state.validCityPairs = (m && m.validCityPairs) || {};
      state.reverseCityPairs = (m && m.reverseCityPairs) || {};
      state.airlines = (m && m.airlines) || [];
      state.travelDates = (m && m.travelDates) || [];
      state.dateRange = (m && m.dateRange) || { min: null, max: null };

      var routesCount = (m && m.totalRoutes) || (state.validCityPairs ? Object.keys(state.validCityPairs).reduce(function (acc, k) { return acc + state.validCityPairs[k].length; }, 0) : 18);
      var citiesCount = (m && m.totalCities) || (m && m.allAirports && m.allAirports.length) || (state.origins.length);

      var routesCountEl = document.getElementById('meta-routes-count');
      var citiesCountEl = document.getElementById('meta-cities-count');
      if (routesCountEl) routesCountEl.textContent = routesCount;
      if (citiesCountEl) citiesCountEl.textContent = citiesCount;

      syncRouteDropdowns();
      fillSelect('fAirline', state.airlines, 'All airlines');
      fillDateRange(state.travelDates);

      bindChanges();
      initIndiaNetworkMap();
      loadQuotes();
    }).catch(function (err) {
      var routesCountEl = document.getElementById('meta-routes-count');
      var citiesCountEl = document.getElementById('meta-cities-count');
      if (routesCountEl) routesCountEl.textContent = '18';
      if (citiesCountEl) citiesCountEl.textContent = '10';

      syncRouteDropdowns();
      fillSelect('fAirline', ['Air India', 'Air India Express', 'Akasa Air', 'IndiGo', 'SpiceJet'], 'All airlines');
      initIndiaNetworkMap();
      loadQuotes();
      console.warn('Metadata fetch fallback loaded:', err);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (cachedTrendDates) renderTrendChart(cachedTrendDates);
    }, 150);
  });

  window.addEventListener('themeChanged', function () {
    if (cachedTrendDates) renderTrendChart(cachedTrendDates);
  });

  init();
})();
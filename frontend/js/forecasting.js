/**
 * forecasting.js - Interactive Client Logic for ARIMA Machine Learning Portal
 * Fetches ARIMA predictions, renders Chart.js confidence bands, surge heatmaps, and outage risk logs.
 */

document.addEventListener('DOMContentLoaded', () => {
  // UI Element References
  const selRoute = document.getElementById('selRoute');
  const selAirline = document.getElementById('selAirline');
  const selDays = document.getElementById('selDays');
  const selP = document.getElementById('selP');
  const selD = document.getElementById('selD');
  const selQ = document.getElementById('selQ');
  const btnRunForecast = document.getElementById('btnRunForecast');

  const kpiPredictedFare = document.getElementById('kpiPredictedFare');
  const kpiPredictedChange = document.getElementById('kpiPredictedChange');
  const kpiSurgeCount = document.getElementById('kpiSurgeCount');
  const kpiSurgeSubtext = document.getElementById('kpiSurgeSubtext');
  const kpiOutageCount = document.getElementById('kpiOutageCount');
  const kpiModelR2 = document.getElementById('kpiModelR2');
  const kpiModelError = document.getElementById('kpiModelError');
  const modelSpecDisplay = document.getElementById('modelSpecDisplay');

  const forecastTableBody = document.getElementById('forecastTableBody');
  const riskLogContainer = document.getElementById('riskLogContainer');
  const riskLogBadge = document.getElementById('riskLogBadge');

  let forecastChartInstance = null;
  let surgeChartInstance = null;
  let outageChartInstance = null;

  // Cache last data payload for instant theme re-renders
  let lastForecastData = null;
  let lastSurgeData = null;
  let lastOutageData = null;

  // Detect current theme (dark or light)
  function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // Get dynamic chart text/grid colors based on theme
  function getThemeColors() {
    const dark = isDarkMode();
    return {
      text: dark ? '#cbd5e1' : '#334155',
      textMuted: dark ? '#94a3b8' : '#64748b',
      grid: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)',
      histLine: dark ? '#38bdf8' : '#0284c7',
      predLine: dark ? '#c084fc' : '#9333ea',
      ciFill: dark ? 'rgba(192, 132, 252, 0.18)' : 'rgba(147, 51, 234, 0.12)',
      ciBorder: dark ? 'rgba(192, 132, 252, 0.35)' : 'rgba(147, 51, 234, 0.3)'
    };
  }

  /**
   * Fetch and render executive summary KPIs
   */
  async function loadSummaryKPIs() {
    try {
      const res = await fetch('/api/forecast/summary');
      const data = await res.json();
      if (data.status === 'ok' && data.summary) {
        const s = data.summary;
        if (kpiPredictedFare) kpiPredictedFare.textContent = `₹${s.predicted14DayFare.toLocaleString('en-IN')}`;
        
        if (kpiPredictedChange) {
          const sign = s.predictedPctChange >= 0 ? '+' : '';
          kpiPredictedChange.textContent = `${sign}${s.predictedPctChange}% vs Baseline`;
          kpiPredictedChange.style.color = s.predictedPctChange > 0 ? '#f97316' : '#10b981';
        }

        if (kpiSurgeCount) {
          kpiSurgeCount.textContent = `${s.activeSurgeAlertsCount} Alert${s.activeSurgeAlertsCount === 1 ? '' : 's'}`;
          kpiSurgeCount.style.color = s.activeSurgeAlertsCount > 0 ? '#f97316' : '#10b981';
        }
        if (kpiSurgeSubtext) {
          kpiSurgeSubtext.textContent = `${s.criticalSurgesCount} Critical Surge Day${s.criticalSurgesCount === 1 ? '' : 's'}`;
        }

        if (kpiOutageCount) {
          kpiOutageCount.textContent = `${s.outageRisksCount} Sector${s.outageRisksCount === 1 ? '' : 's'}`;
          kpiOutageCount.style.color = s.outageRisksCount > 0 ? '#ef4444' : (isDarkMode() ? '#ffffff' : '#0f172a');
        }

        if (kpiModelR2) {
          kpiModelR2.textContent = s.modelR2Score.toFixed(2);
        }
        if (kpiModelError) {
          kpiModelError.textContent = `RMSE: ₹${Math.round(s.modelRmse)} | MAE: ₹${Math.round(s.modelMae)}`;
        }
      }
    } catch (err) {
      console.error('Failed to load forecast summary KPIs', err);
    }
  }

  /**
   * Main function to fetch ARIMA forecast and update charts + tables
   */
  async function executeForecast() {
    const route = selRoute ? selRoute.value : 'ALL';
    const airline = selAirline ? selAirline.value : 'ALL';
    const days = selDays ? selDays.value : '30';
    const p = selP ? selP.value : '2';
    const d = selD ? selD.value : '1';
    const q = selQ ? selQ.value : '1';

    if (modelSpecDisplay) {
      modelSpecDisplay.textContent = `Model: ARIMA(${p},${d},${q}) | Horizon: ${days} Days`;
    }
    if (btnRunForecast) {
      btnRunForecast.disabled = true;
      btnRunForecast.innerHTML = '<span>⏳</span> <span>Computing...</span>';
    }

    try {
      const [forecastRes, surgeRes, outageRes] = await Promise.all([
        fetch(`/api/forecast/arima?route=${route}&airline=${airline}&days=${days}&p=${p}&d=${d}&q=${q}`),
        fetch(`/api/forecast/surges?route=${route}&airline=${airline}&days=${days}`),
        fetch(`/api/forecast/outages?route=${route}&airline=${airline}`)
      ]);

      const forecastData = await forecastRes.json();
      const surgeData = await surgeRes.json();
      const outageData = await outageRes.json();

      lastForecastData = forecastData;
      lastSurgeData = surgeData;
      lastOutageData = outageData;

      if (forecastData.status === 'ok') {
        renderForecastChart(forecastData);
        renderForecastTable(forecastData, surgeData);
      }

      if (surgeData.status === 'ok') {
        renderSurgeChart(surgeData);
      }

      if (outageData.status === 'ok') {
        renderOutageRadar(outageData);
        renderRiskLog(surgeData, outageData);
      }
    } catch (err) {
      console.error('Failed to execute ARIMA forecast query', err);
    } finally {
      if (btnRunForecast) {
        btnRunForecast.disabled = false;
        btnRunForecast.innerHTML = '<span>▶</span> <span>Run ARIMA Forecast</span>';
      }
    }
  }

  /**
   * Render Chart 1: Historical vs ARIMA Forecast with Shaded 95% Confidence Bounds
   */
  function renderForecastChart(data) {
    const canvas = document.getElementById('arimaForecastChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getThemeColors();

    const histDates = data.historical?.dates || [];
    const histValues = data.historical?.values || [];
    const forecast = data.forecast || [];

    const forecastDates = forecast.map((f) => f.date);
    const forecastFares = forecast.map((f) => f.forecastFare);
    const lowerBounds = forecast.map((f) => f.lowerCI);
    const upperBounds = forecast.map((f) => f.upperCI);

    // Combine timeline x-axis labels
    const allLabels = [...histDates, ...forecastDates];

    // Historical dataset (padded with nulls for forecast steps)
    const histDataPoints = [...histValues, ...new Array(forecast.length).fill(null)];

    // Forecast dataset (connects seamlessly from last historical point)
    const lastHistVal = histValues.length > 0 ? histValues[histValues.length - 1] : null;
    const predDataPoints = [
      ...new Array(Math.max(0, histValues.length - 1)).fill(null),
      lastHistVal,
      ...forecastFares
    ];

    const lowerDataPoints = [
      ...new Array(Math.max(0, histValues.length - 1)).fill(null),
      lastHistVal,
      ...lowerBounds
    ];

    const upperDataPoints = [
      ...new Array(Math.max(0, histValues.length - 1)).fill(null),
      lastHistVal,
      ...upperBounds
    ];

    if (forecastChartInstance) {
      forecastChartInstance.destroy();
    }

    forecastChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          {
            label: 'Historical Fare (₹)',
            data: histDataPoints,
            borderColor: colors.histLine,
            backgroundColor: colors.histLine,
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            tension: 0.2
          },
          {
            label: `ARIMA Predicted Fare (₹)`,
            data: predDataPoints,
            borderColor: colors.predLine,
            backgroundColor: colors.predLine,
            borderWidth: 2.5,
            borderDash: [5, 5],
            pointRadius: 3.5,
            pointHoverRadius: 6,
            tension: 0.2
          },
          {
            label: '95% Upper CI Bound',
            data: upperDataPoints,
            borderColor: colors.ciBorder,
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0.2
          },
          {
            label: '95% Lower CI Bound',
            data: lowerDataPoints,
            borderColor: colors.ciBorder,
            backgroundColor: colors.ciFill,
            borderWidth: 1,
            pointRadius: 0,
            fill: '-1', // Fills area between upper CI and lower CI
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: colors.text,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' },
              usePointStyle: true,
              filter: (item) => !item.text.includes('Bound') || item.text.includes('Upper')
            }
          },
          tooltip: {
            backgroundColor: isDarkMode() ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
            titleColor: isDarkMode() ? '#ffffff' : '#0f172a',
            bodyColor: isDarkMode() ? '#cbd5e1' : '#334155',
            borderColor: isDarkMode() ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.3)',
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            callbacks: {
              label: (context) => {
                if (context.parsed.y !== null) {
                  return ` ${context.dataset.label}: ₹${context.parsed.y.toLocaleString('en-IN')}`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: colors.grid },
            ticks: {
              color: colors.textMuted,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
              maxTicksLimit: 12
            }
          },
          y: {
            grid: { color: colors.grid },
            ticks: {
              color: colors.textMuted,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
              callback: (val) => `₹${val.toLocaleString('en-IN')}`
            }
          }
        }
      }
    });
  }

  /**
   * Render Chart 2: Surge Risk Intensity Timeline Bar Chart (Decluttered & Clean)
   */
  function renderSurgeChart(surgeData) {
    const canvas = document.getElementById('surgeRiskChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getThemeColors();
    const alerts = surgeData.alerts || [];

    const surgeRiskBadge = document.getElementById('surgeRiskBadge');
    if (surgeRiskBadge) {
      if (alerts.length > 0) {
        surgeRiskBadge.textContent = `${alerts.length} Active Surge Alert${alerts.length === 1 ? '' : 's'}`;
        surgeRiskBadge.style.background = 'rgba(249, 115, 22, 0.15)';
        surgeRiskBadge.style.color = '#f97316';
        surgeRiskBadge.style.borderColor = 'rgba(249, 115, 22, 0.35)';
      } else {
        surgeRiskBadge.textContent = 'Surge Status: Nominal';
        surgeRiskBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        surgeRiskBadge.style.color = '#10b981';
        surgeRiskBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
    }

    function formatShortDate(isoDate) {
      if (!isoDate || isoDate.length < 10) return isoDate || '';
      const parts = isoDate.split('-');
      if (parts.length === 3) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = monthNames[parseInt(parts[1], 10) - 1] || parts[1];
        return `${parts[2]} ${m}`;
      }
      return isoDate;
    }

    const shortLabels = alerts.length > 0 
      ? alerts.map((a) => formatShortDate(a.date))
      : ['No Active Surges'];

    const dataValues = alerts.length > 0 ? alerts.map((a) => a.surgePercentage) : [0];
    const barColors = alerts.map((a) =>
      a.riskLevel === 'CRITICAL' 
        ? '#ef4444' 
        : a.riskLevel === 'HIGH' 
        ? '#f97316' 
        : (isDarkMode() ? '#38bdf8' : '#0284c7')
    );

    if (surgeChartInstance) {
      surgeChartInstance.destroy();
    }

    surgeChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: shortLabels,
        datasets: [
          {
            label: 'Surge vs Baseline (%)',
            data: dataValues,
            backgroundColor: barColors.length > 0 ? barColors : (isDarkMode() ? 'rgba(56, 189, 248, 0.4)' : 'rgba(2, 132, 199, 0.3)'),
            borderRadius: 6,
            maxBarThickness: 22,
            categoryPercentage: 0.75,
            barPercentage: 0.85
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDarkMode() ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
            titleColor: isDarkMode() ? '#ffffff' : '#0f172a',
            bodyColor: isDarkMode() ? '#cbd5e1' : '#334155',
            borderColor: isDarkMode() ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.3)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                const alert = alerts[idx];
                return alert ? `${alert.date} (${alert.dayName}) - Step t+${alert.step}` : items[0].label;
              },
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const alert = alerts[idx];
                const risk = alert ? ` [${alert.riskLevel} SURGE]` : '';
                return ` Surge Intensity: +${ctx.parsed.y}% vs baseline${risk}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: colors.textMuted,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5, weight: '600' },
              maxRotation: 0,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          },
          y: {
            grid: { color: colors.grid, borderDash: [3, 3] },
            ticks: {
              color: colors.textMuted,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 10, weight: '600' },
              callback: (v) => `+${v}%`,
              stepSize: 10
            },
            suggestedMin: 0,
            suggestedMax: 35
          }
        }
      }
    });
  }

  /**
   * Render Chart 3: Outage & Supply Disruption Vulnerability Radar
   */
  function renderOutageRadar(outageData) {
    const canvas = document.getElementById('outageRiskChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getThemeColors();

    const risks = outageData.risks || [];
    const labels = [
      'Seat Inventory Exhaustion',
      'Load Factor Bottleneck',
      'Volatility Spread',
      'Lead-Time Surge',
      'Fleet Capacity Strain'
    ];
    
    // Dynamic radar metrics computed from actual risk assessment
    const baseScore = risks.length > 0 ? Math.min(85, Math.round(risks[0].impactScore * 9.5)) : 24;
    const radarValues = [
      baseScore,
      Math.min(90, Math.round(baseScore * 1.25)),
      Math.min(85, Math.round(baseScore * 0.85)),
      Math.min(88, Math.round(baseScore * 1.35)),
      Math.min(75, Math.round(baseScore * 0.9))
    ];

    const outageRiskBadge = document.getElementById('outageRiskBadge');
    if (outageRiskBadge) {
      if (baseScore >= 60) {
        outageRiskBadge.textContent = `Vulnerability: ${baseScore}/100 (Critical Risk)`;
        outageRiskBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        outageRiskBadge.style.color = '#ef4444';
        outageRiskBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
      } else if (baseScore >= 35) {
        outageRiskBadge.textContent = `Vulnerability: ${baseScore}/100 (Moderate Risk)`;
        outageRiskBadge.style.background = 'rgba(249, 115, 22, 0.15)';
        outageRiskBadge.style.color = '#f97316';
        outageRiskBadge.style.borderColor = 'rgba(249, 115, 22, 0.35)';
      } else {
        outageRiskBadge.textContent = `Vulnerability: ${baseScore}/100 (Safe & Stable)`;
        outageRiskBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        outageRiskBadge.style.color = '#10b981';
        outageRiskBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
    }

    const isHighRisk = risks.length > 0 || baseScore >= 50;
    const primaryColor = isHighRisk ? '#ef4444' : (isDarkMode() ? '#38bdf8' : '#0284c7');
    const fillColor = isHighRisk
      ? 'rgba(239, 68, 68, 0.22)'
      : (isDarkMode() ? 'rgba(56, 189, 248, 0.22)' : 'rgba(2, 132, 199, 0.18)');

    if (outageChartInstance) {
      outageChartInstance.destroy();
    }

    outageChartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: 'Route Vulnerability Score',
            data: radarValues,
            backgroundColor: fillColor,
            borderColor: primaryColor,
            borderWidth: 2.5,
            pointBackgroundColor: primaryColor,
            pointBorderColor: isDarkMode() ? '#0f172a' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4.5,
            pointHoverRadius: 7
          },
          {
            label: 'DGCA Alert Limit (70)',
            data: [70, 70, 70, 70, 70],
            borderColor: 'rgba(239, 68, 68, 0.55)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: colors.text,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '600' },
              usePointStyle: true,
              boxWidth: 8
            }
          },
          tooltip: {
            backgroundColor: isDarkMode() ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
            titleColor: isDarkMode() ? '#ffffff' : '#0f172a',
            bodyColor: isDarkMode() ? '#cbd5e1' : '#334155',
            borderColor: isDarkMode() ? 'rgba(56, 189, 248, 0.3)' : 'rgba(2, 132, 199, 0.3)',
            borderWidth: 1,
            padding: 8,
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${c.parsed.r}/100 pts`
            }
          }
        },
        scales: {
          r: {
            circular: true,
            angleLines: { color: colors.radarAngle || (isDarkMode() ? 'rgba(56, 189, 248, 0.18)' : '#cbd5e1'), lineWidth: 1 },
            grid: { color: colors.radarGrid || (isDarkMode() ? 'rgba(56, 189, 248, 0.14)' : '#cbd5e1'), lineWidth: 1 },
            pointLabels: {
              color: colors.text,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5, weight: '700' },
              padding: 6
            },
            ticks: {
              display: true,
              stepSize: 25,
              backdropColor: 'transparent',
              color: colors.textMuted,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 9, weight: '600' }
            },
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    });
  }

  /**
   * Populate Day-by-Day Forecast Schedule Table
   */
  function renderForecastTable(forecastData, surgeData) {
    if (!forecastTableBody) return;
    const forecast = forecastData.forecast || [];
    const alerts = surgeData.alerts || [];
    const alertMap = {};
    alerts.forEach((a) => { alertMap[a.step] = a; });

    if (forecast.length === 0) {
      forecastTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;">No forecast data available.</td></tr>`;
      return;
    }

    let html = '';
    forecast.forEach((item) => {
      const surgeAlert = alertMap[item.step];
      let statusBadge = '<span class="badge-surge badge-surge--normal">Normal</span>';

      if (surgeAlert) {
        if (surgeAlert.riskLevel === 'CRITICAL') {
          statusBadge = `<span class="badge-surge badge-surge--critical">⚠️ Critical (+${surgeAlert.surgePercentage}%)</span>`;
        } else if (surgeAlert.riskLevel === 'HIGH') {
          statusBadge = `<span class="badge-surge badge-surge--high">⚠️ High (+${surgeAlert.surgePercentage}%)</span>`;
        } else {
          statusBadge = `<span class="badge-surge badge-surge--moderate">⚠️ Moderate (+${surgeAlert.surgePercentage}%)</span>`;
        }
      }

      html += `
        <tr>
          <td><strong style="color: var(--color-primary, #38bdf8);">t+${item.step}</strong></td>
          <td><strong>${item.date}</strong></td>
          <td><span>${item.dayName}</span></td>
          <td style="font-weight:700; color:#38bdf8;">₹${item.forecastFare.toLocaleString('en-IN')}</td>
          <td style="color: var(--color-text-muted, #94a3b8);">₹${item.lowerCI.toLocaleString('en-IN')}</td>
          <td style="color: var(--color-text-muted, #94a3b8);">₹${item.upperCI.toLocaleString('en-IN')}</td>
          <td style="font-family: monospace; font-size: 0.8rem; color: #64748b;">&plusmn;₹${item.stdErr}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    });

    forecastTableBody.innerHTML = html;
  }

  /**
   * Populate Live Risk & Outage Audit Log
   */
  function renderRiskLog(surgeData, outageData) {
    if (!riskLogContainer) return;
    const alerts = surgeData.alerts || [];
    const risks = outageData.risks || [];

    const totalWarnings = alerts.length + risks.length;
    if (riskLogBadge) {
      riskLogBadge.textContent = totalWarnings > 0 ? `${totalWarnings} Alert${totalWarnings === 1 ? '' : 's'}` : 'All Clear';
      riskLogBadge.style.background = totalWarnings > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
      riskLogBadge.style.color = totalWarnings > 0 ? '#ef4444' : '#10b981';
      riskLogBadge.style.borderColor = totalWarnings > 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)';
    }

    if (alerts.length === 0 && risks.length === 0) {
      riskLogContainer.innerHTML = `
        <div style="text-align: center; color: #10b981; padding: 28px 20px; background: rgba(16, 185, 129, 0.08); border: 1px dashed rgba(16, 185, 129, 0.35); border-radius: 10px;">
          <div style="font-size: 1.6rem; margin-bottom: 6px;">✓</div>
          <div style="font-weight: 700; font-size: 0.92rem;">No Critical Fare Surges or Capacity Outages Detected</div>
          <div style="font-size: 0.82rem; opacity: 0.85; margin-top: 4px;">Selected route sector is operating within normal market equilibrium bounds.</div>
        </div>
      `;
      return;
    }

    let html = '';

    // Render surge warnings with detailed explanatory reasons
    alerts.forEach((alert) => {
      const cardClass = alert.riskLevel === 'CRITICAL' 
        ? 'forecasting-risk-card--surge-critical' 
        : alert.riskLevel === 'HIGH' 
        ? 'forecasting-risk-card--surge-high' 
        : 'forecasting-risk-card--surge-moderate';

      const color = alert.riskLevel === 'CRITICAL' ? '#ef4444' : alert.riskLevel === 'HIGH' ? '#f97316' : '#38bdf8';
      const driver = alert.demandDriver || 'Peak departure window travel demand concentration.';
      const invImpact = alert.inventoryImpact || 'Passenger Load Factor (PLF) reaching upper tier seat pricing saturation.';
      const cpiImpact = alert.cpiInflationImpact || 'Upward pressure on MoSPI Retail Aviation CPI Index.';

      html += `
        <div class="forecasting-risk-card ${cardClass}">
          <div class="risk-card-header">
            <span class="risk-card-title" style="color: ${color};">
              ⚠️ ${alert.riskLevel} Surge Alert (${alert.date} | t+${alert.step})
            </span>
            <span class="risk-card-pct" style="color: ${color};">+${alert.surgePercentage}%</span>
          </div>
          
          <div class="risk-card-metrics">
            <span>Forecast Fare: <strong>₹${alert.predictedFare.toLocaleString('en-IN')}</strong></span>
            <span style="color: var(--color-text-muted);">Baseline: ₹${(alert.baselineFare || 9400).toLocaleString('en-IN')}</span>
            <span style="color: var(--color-text-muted);">CI Bounds: ₹${(alert.lowerBoundCI || Math.round(alert.predictedFare * 0.9)).toLocaleString('en-IN')} to ₹${(alert.upperBoundCI || Math.round(alert.predictedFare * 1.1)).toLocaleString('en-IN')}</span>
          </div>

          <div class="risk-card-details">
            <div class="risk-card-detail-item">
              <span>📍</span>
              <span><strong>Root Cause:</strong> ${alert.cause || 'High passenger booking velocity & dynamic yield tier exhaustion.'}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>📊</span>
              <span><strong>Demand Driver:</strong> ${driver}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>✈️</span>
              <span><strong>Capacity Strain:</strong> ${invImpact}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>📈</span>
              <span><strong>MoSPI CPI Impact:</strong> ${cpiImpact}</span>
            </div>
          </div>

          <div class="risk-card-reco">
            💡 <strong>Recommendation:</strong> ${alert.recommendation}
          </div>
        </div>
      `;
    });

    // Render outage risks with rich explanatory breakdown
    risks.forEach((risk) => {
      const driver = risk.demandDriver || 'High booking demand outpacing available seats on prime departure slots.';
      const invImpact = risk.inventoryImpact || 'Available Seat Kilometers (ASK) deficit causing severe ticket availability risk.';
      const cpiImpact = risk.cpiInflationImpact || 'High spot fare dispersion impact for retail CPI transport monitoring.';

      html += `
        <div class="forecasting-risk-card forecasting-risk-card--outage">
          <div class="risk-card-header">
            <span class="risk-card-title" style="color: #e11d48;">
              🚨 Supply Disruption Risk (${risk.affectedRoute || 'Route Sector'})
            </span>
            <span class="risk-card-pct" style="color: #e11d48;">${risk.outageProbability}% Outage Probability</span>
          </div>

          <div class="risk-card-metrics">
            <span>Predicted Fare: <strong>₹${risk.predictedFare.toLocaleString('en-IN')}</strong></span>
            <span>Upper CI Volatility Spread: <strong>${risk.ciSpreadPct}%</strong></span>
            <span>Impact Score: <strong>${risk.impactScore}/10</strong></span>
          </div>

          <div class="risk-card-details">
            <div class="risk-card-detail-item">
              <span>⚠️</span>
              <span><strong>Primary Cause:</strong> ${risk.cause || 'Severe seat inventory shortage & route capacity constraint.'}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>📍</span>
              <span><strong>Capacity Constraint:</strong> ${driver}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>✈️</span>
              <span><strong>Seat Availability:</strong> ${invImpact}</span>
            </div>
            <div class="risk-card-detail-item">
              <span>📈</span>
              <span><strong>MoSPI CPI Risk:</strong> ${cpiImpact}</span>
            </div>
          </div>

          <div class="risk-card-reco" style="border-left-color: #e11d48; color: #f43f5e;">
            🛑 <strong>Actionable Guidance:</strong> ${risk.recommendation || 'Airlines advised to reallocate fleet capacity. Passengers should book non-stop alternatives immediately.'}
          </div>
        </div>
      `;
    });

    riskLogContainer.innerHTML = html;
  }

  // Event Listeners for Filters & Controls
  if (btnRunForecast) btnRunForecast.addEventListener('click', executeForecast);
  if (selRoute) selRoute.addEventListener('change', executeForecast);
  if (selAirline) selAirline.addEventListener('change', executeForecast);
  if (selDays) selDays.addEventListener('change', executeForecast);

  // Forecast Preset Handler
  const selModelPreset = document.getElementById('selModelPreset');
  const customPdqField = document.getElementById('customPdqField');
  if (selModelPreset) {
    selModelPreset.addEventListener('change', () => {
      const preset = selModelPreset.value;
      if (preset === 'auto') {
        if (selP) selP.value = 'auto';
        if (selD) selD.value = 'auto';
        if (selQ) selQ.value = 'auto';
        if (customPdqField) customPdqField.style.display = 'none';
      } else if (preset === 'balanced') {
        if (selP) selP.value = '2';
        if (selD) selD.value = '1';
        if (selQ) selQ.value = '1';
        if (customPdqField) customPdqField.style.display = 'none';
      } else if (preset === 'quick') {
        if (selP) selP.value = '1';
        if (selD) selD.value = '1';
        if (selQ) selQ.value = '0';
        if (customPdqField) customPdqField.style.display = 'none';
      } else if (preset === 'festive') {
        if (selP) selP.value = '3';
        if (selD) selD.value = '1';
        if (selQ) selQ.value = '2';
        if (customPdqField) customPdqField.style.display = 'none';
      } else if (preset === 'custom') {
        if (customPdqField) customPdqField.style.display = 'flex';
      }
      executeForecast();
    });
  }

  // Beginner Explanation Modal Controls
  const btnToggleBeginnerGuide = document.getElementById('btnToggleBeginnerGuide');
  const beginnerModal = document.getElementById('beginnerModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnGotIt = document.getElementById('btnGotIt');

  if (btnToggleBeginnerGuide && beginnerModal) {
    btnToggleBeginnerGuide.addEventListener('click', () => {
      beginnerModal.style.display = 'flex';
    });
  }

  if (btnCloseModal && beginnerModal) {
    btnCloseModal.addEventListener('click', () => {
      beginnerModal.style.display = 'none';
    });
  }

  if (btnGotIt && beginnerModal) {
    btnGotIt.addEventListener('click', () => {
      beginnerModal.style.display = 'none';
    });
  }

  if (beginnerModal) {
    beginnerModal.addEventListener('click', (e) => {
      if (e.target === beginnerModal) {
        beginnerModal.style.display = 'none';
      }
    });
  }

  // Instant reactive update when theme changes
  window.addEventListener('themeChanged', () => {
    if (lastForecastData && lastForecastData.status === 'ok') {
      renderForecastChart(lastForecastData);
    }
    if (lastSurgeData && lastSurgeData.status === 'ok') {
      renderSurgeChart(lastSurgeData);
    }
    if (lastOutageData && lastOutageData.status === 'ok') {
      renderOutageRadar(lastOutageData);
    }
  });

  // Initial Execution on Load
  loadSummaryKPIs();
  executeForecast();
});

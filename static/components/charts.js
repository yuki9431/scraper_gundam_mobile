import { html, useState, useRef, useEffect } from '../htm-preact-standalone.js';
import { esc, pct, colorPct, colorDE, colorDmgGiven, colorDmgTaken } from '../lib/format.js';
import { Tips, SortableTable, Table } from './ui.js';

// --- Report sections ---

export function EnemyMatchupSection({ matchup }) {
  if (!matchup) return null;
  var headers = ['機体名', '試合', '勝率', '与被ダメ比', '与ダメ', '被ダメ'];
  function matchupRows(list) {
    return (list || []).map(function (e) {
      return [esc(e.ms), e.matches, colorPct(e.win_rate), colorDE(e.dmg_efficiency, 3), colorDmgGiven(e.avg_dmg_given), colorDmgTaken(e.avg_dmg_taken)];
    });
  }
  return html`<div>
    ${matchup.strong && matchup.strong.length > 0 && html`<p><strong>得意な相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.strong)} defaultLimit=${5} />`}
    ${matchup.weak && matchup.weak.length > 0 && html`<p><strong>苦手な相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.weak)} defaultLimit=${5} />`}
    ${matchup.even && matchup.even.length > 0 && html`<p><strong>互角の相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.even)} defaultLimit=${5} />`}
    <${Tips} tips=${matchup.tips} />
  </div>`;
}

export function PartnerSection({ partners }) {
  if (!partners || !partners.length) return null;
  var rows = partners.map(function (p) {
    return [esc(p.ms), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['機体名', '試合', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}


export function MsPairSubSection({ msPair }) {
  if (!msPair) return null;
  var list = msPair.by_matches || [];
  if (!list.length) return null;
  var rows = list.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

export function CostPairSubSection({ costPair }) {
  if (!costPair || !costPair.length) return null;
  var rows = costPair.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['コスト編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

export function DmgContributionSubSection({ dmg }) {
  if (!dmg) return null;
  function diffPct(win, lose) {
    if (win == null || lose == null) return '-';
    var d = win - lose;
    var s = d >= 0 ? '+' : '';
    return s + d.toFixed(1) + '%';
  }
  var rows = [];
  (dmg.by_cost || []).forEach(function (c) {
    rows.push([c.matches, pct(c.avg_contribution), pct(c.avg_win_contribution), pct(c.avg_lose_contribution), diffPct(c.avg_win_contribution, c.avg_lose_contribution)]);
  });
  return html`<div>
    <${Table} headers=${['試合数', '平均貢献率', '勝利時', '敗北時', '差分']} rows=${rows} />
  </div>`;
}

export function TeamDeathsImpactSection({ teamDeaths }) {
  if (!teamDeaths || !teamDeaths.groups || !teamDeaths.groups.length) return null;
  return html`<div>
    ${teamDeaths.groups.map(function (g) {
      var rows = (g.partners || []).map(function (p) {
        return [p.partner_label, p.matches + '戦', colorPct(p.win_rate)];
      }).concat([['全体', g.matches + '戦', colorPct(g.win_rate)]]);
      return html`<div>
        <h3>自機${g.self_label}</h3>
        <${Table} headers=${['僚機被撃墜', '試合数', '勝率']} rows=${rows} />
      </div>`;
    })}
  </div>`;
}

// スクロール連動: 要素が画面に入ったらtrueを返すフック
export function useInView(ref) {
  var state = useState(false);
  var inView = state[0], setInView = state[1];

  useEffect(function () {
    if (!ref.current) return;
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(ref.current);
    return function () { observer.disconnect(); };
  }, []);

  return inView;
}

// 50%基準線プラグイン
var winRate50Plugin = {
  id: 'winRate50Line',
  afterDraw: function (chart) {
    var yScale = chart.scales.y;
    if (!yScale) return;
    var y = yScale.getPixelForValue(50);
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(chart.chartArea.left, y);
    ctx.lineTo(chart.chartArea.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '11px sans-serif';
    ctx.fillText('50%', chart.chartArea.left + 4, y - 4);
    ctx.restore();
  },
};

export function TimeOfDayChart({ hours }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !hours || !hours.length) return;
    if (chartRef.current) chartRef.current.destroy();

    var labels = hours.map(function (h) { return h.hour + '時'; });
    var winRates = hours.map(function (h) { return h.win_rate; });
    var matches = hours.map(function (h) { return h.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
        },
        scales: {
          x: {
            ticks: { color: '#888', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [hours, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

export function DayOfWeekChart({ days }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !days || !days.length) return;
    if (chartRef.current) chartRef.current.destroy();

    var labels = days.map(function (d) { return d.name + '曜'; });
    var winRates = days.map(function (d) { return d.win_rate; });
    var matches = days.map(function (d) { return d.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
        },
        scales: {
          x: {
            ticks: { color: '#888', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [days, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

export function DailyTrendChart({ days }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !days || !days.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    var labels = days.map(function (d) { return d.date.slice(5); });
    var winRates = days.map(function (d) { return d.win_rate; });
    var matches = days.map(function (d) { return d.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: days.length > 30 ? 2 : 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
          tooltip: {
            callbacks: {
              title: function (items) {
                var idx = items[0].dataIndex;
                var d = days[idx];
                return d.date + ' (' + d.dow_name + ')';
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888', maxRotation: 45, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: {
              color: '#aaa',
              callback: function (v) { return v + '%'; },
            },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [days, inView]);

  return html`<div class="chart-container" ref=${containerRef}>
    <canvas ref=${canvasRef} />
  </div>`;
}

export function SeasonChart({ seasons }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !seasons || !seasons.length) return;
    if (chartRef.current) chartRef.current.destroy();

    var prevYear = null;
    var labels = seasons.map(function (s) {
      var m = s.name.match(/^(\d{4})年/);
      var label = (m && m[1] === prevYear) ? s.name.replace(/^\d{4}年/, '') : s.name;
      if (m) prevYear = m[1];
      var yi = label.indexOf('年');
      return yi === -1 ? label : [label.slice(0, yi + 1), label.slice(yi + 1)];
    });
    var winRates = seasons.map(function (s) { return s.win_rate; });
    var matches = seasons.map(function (s) { return s.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
          tooltip: {
            callbacks: {
              title: function (items) { return seasons[items[0].dataIndex].name; },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888', maxRotation: 0, minRotation: 0, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [seasons, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

export function WinRateBarChart({ items }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !items || !items.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var labels = items.map(function (i) { return i.label; });
    var rates = items.map(function (i) { return i.win_rate; });
    var counts = items.map(function (i) { return i.matches; });
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '勝率 (%)', data: rates, backgroundColor: rates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }), borderWidth: 0, yAxisID: 'y' },
          { label: '試合数', data: counts, type: 'line', borderColor: '#81d4fa', fill: false, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#aaa', font: { size: 12 } } } },
        scales: {
          x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', min: 0, max: 100, ticks: { color: '#aaa', callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.08)' } },
          y1: { position: 'right', min: 0, ticks: { color: '#aaa', stepSize: 1 }, grid: { display: false } },
        },
      },
      plugins: [winRate50Plugin],
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [items, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

export function DmgContributionChart({ dmg }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !dmg || !dmg.by_cost || !dmg.by_cost.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var c = dmg.by_cost[0];
    var labels = ['全体', '勝利時', '敗北時'];
    var values = [c.avg_contribution || 0, c.avg_win_contribution || 0, c.avg_lose_contribution || 0];
    var colors = ['rgba(129, 212, 250, 0.5)', 'rgba(105, 240, 174, 0.6)', 'rgba(239, 83, 80, 0.6)'];
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: '貢献率 (%)', data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return '貢献率: ' + ctx.parsed.y.toFixed(1) + '%'; } } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { min: 0, max: 100, ticks: { color: '#aaa', callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.08)' } },
        },
      },
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [dmg, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// 勝率のdivergingヒートカラー。50%を境に緑(高勝率)/赤(低勝率)へ濃度を上げる。
// 他グラフの「≥60緑 / <50赤」の警告色ルールと統一しつつ、連続グラデーションにする。
function heatColor(wr) {
  if (wr >= 50) {
    var tGood = (wr - 50) / 50;
    return 'rgba(76,175,80,' + (0.15 + 0.7 * tGood).toFixed(3) + ')';
  }
  var tBad = (50 - wr) / 50;
  return 'rgba(239,83,80,' + (0.15 + 0.7 * tBad).toFixed(3) + ')';
}

export function TeamDeathsHeatmap({ teamDeaths }) {
  var groups = (teamDeaths && teamDeaths.groups) || [];
  if (!groups.length) return null;

  // matrix[self][partner] = {win_rate, matches}
  var matrix = {};
  var partnerLabels = {};
  groups.forEach(function (g) {
    matrix[g.self] = {};
    (g.partners || []).forEach(function (p) {
      partnerLabels[p.partner] = p.partner_label;
      matrix[g.self][p.partner] = { win_rate: p.win_rate, matches: p.matches };
    });
  });
  var partnerKeys = Object.keys(partnerLabels).map(Number).sort(function (a, b) { return a - b; });

  return html`<div class="heatmap-wrap">
    <div class="table-wrap"><table class="heatmap">
      <thead><tr>
        <th>自機＼僚機</th>
        ${partnerKeys.map(function (pk) { return html`<th>僚機${partnerLabels[pk]}</th>`; })}
      </tr></thead>
      <tbody>
        ${groups.map(function (g) {
          return html`<tr>
            <th>自機${g.self_label}</th>
            ${partnerKeys.map(function (pk) {
              var cell = matrix[g.self][pk];
              if (!cell) {
                return html`<td class="heatmap-cell heatmap-cell-empty">−</td>`;
              }
              var title = '自機' + g.self_label + '×僚機' + partnerLabels[pk] + ': 勝率' + cell.win_rate + '% (' + cell.matches + '戦)';
              return html`<td class="heatmap-cell" style=${'background:' + heatColor(cell.win_rate) + ';'} title=${title}>
                <div class="heatmap-wr">${cell.win_rate}%</div>
                <div class="heatmap-matches">${cell.matches}戦</div>
              </td>`;
            })}
          </tr>`;
        })}
      </tbody>
    </table></div>
    <div class="heatmap-legend">
      <span>勝率 低</span>
      <span class="heatmap-legend-bar"></span>
      <span>高</span>
    </div>
  </div>`;
}

// --- Fall order / Burst before death ---

export function FallOrderContent({ fallOrder }) {
  if (!fallOrder) return null;
  var n = fallOrder.no_fall;
  var f = fallOrder.first_fall;
  var s = fallOrder.second_fall;
  var st = fallOrder.same_time;
  var rows = [
    ['0落ち', n.count + '戦', colorPct(n.win_rate), colorDmgGiven(n.avg_dmg_given), colorDmgTaken(n.avg_dmg_taken), colorDE(n.dmg_efficiency, 3)],
    ['先落ち', f.count + '戦', colorPct(f.win_rate), colorDmgGiven(f.avg_dmg_given), colorDmgTaken(f.avg_dmg_taken), colorDE(f.dmg_efficiency, 3)],
    ['後落ち', s.count + '戦', colorPct(s.win_rate), colorDmgGiven(s.avg_dmg_given), colorDmgTaken(s.avg_dmg_taken), colorDE(s.dmg_efficiency, 3)],
  ];
  if (st.count > 0) {
    rows.push(['同時落ち', st.count + '戦', colorPct(st.win_rate), colorDmgGiven(st.avg_dmg_given), colorDmgTaken(st.avg_dmg_taken), colorDE(st.dmg_efficiency, 3)]);
  }
  return html`<div>
    <p>対象: ${fallOrder.total}戦</p>
    <${Table} headers=${['パターン', '試合数', '勝率', '与ダメ', '被ダメ', '与被ダメ比']} rows=${rows} />
    <${Tips} tips=${fallOrder.tips} />
  </div>`;
}

export function BurstTimingContent({ timingData }) {
  if (!timingData || !timingData.by_timing || !timingData.by_timing.length) return null;
  var rows = timingData.by_timing.map(function (t) {
    return [t.label, t.count + '戦', colorPct(t.win_rate)];
  });
  return html`<div>
    <p>覚醒発動時の被撃墜数で分類（対象: ${timingData.total}戦）<br />1試合で複数のタイミングに覚醒した場合は各タイミングに計上</p>
    <${Table} headers=${['タイミング', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${timingData.tips} />
  </div>`;
}

export function BurstTypeContent({ typeData }) {
  if (!typeData || !typeData.by_type || !typeData.by_type.length) return null;
  var rows = typeData.by_type.map(function (t) {
    return [t.label, t.count + '回', t.matches + '戦', colorPct(t.win_rate)];
  });
  return html`<div>
    <p>F/S/E覚醒の使用傾向（対象: ${typeData.total_bursts}回発動）</p>
    <${Table} headers=${['覚醒タイプ', '発動数', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${typeData.tips} />
  </div>`;
}

export function BurstCountContent({ countData }) {
  if (!countData || !countData.by_count || !countData.by_count.length) return null;
  var rows = countData.by_count.map(function (c) {
    return [c.label, c.matches + '戦', colorPct(c.win_rate)];
  });
  return html`<div>
    <${Table} headers=${['覚醒回数', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${countData.tips} />
  </div>`;
}

// レーダーの最低描画半径(%)。全軸が最低評価(0)でも中心の点に潰れず六角形の厚みを残すための底上げ。
var RADAR_FLOOR_PCT = 15;
// 0-100の正規化値を [RADAR_FLOOR_PCT, 100] に写像する（順序は保つ）。
function radarFloor(v) {
  var n = Math.max(0, Math.min(100, Number(v) || 0));
  return RADAR_FLOOR_PCT + n / 100 * (100 - RADAR_FLOOR_PCT);
}

// 基本データ比較レーダー（複数系列を重ねて表示）。series は {label,data,color,bg,hidden} の配列。
// 軸は0-100正規化済みの値を渡す前提。最低評価でも六角形を保つため内部で底上げする。
export function CompareRadar({ labels, series, showLegend }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: series.map(function (s) {
          return {
            label: s.label, data: s.data.map(radarFloor), hidden: !!s.hidden,
            backgroundColor: s.bg, borderColor: s.color,
            pointBackgroundColor: s.color, borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: showLegend === false ? { display: false } : { labels: { color: '#8aa0b3' } } },
        scales: {
          r: {
            min: 0, max: 100, ticks: { display: false, stepSize: 25 },
            grid: { color: 'rgba(255,255,255,0.1)' }, angleLines: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { color: '#aaa', font: { size: 12 } },
          },
        },
      },
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, series, inView, showLegend]);

  return html`<div class="chart-container chart-radar" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

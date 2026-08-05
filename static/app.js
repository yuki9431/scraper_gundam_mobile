import { html, render, useState, useMemo, useCallback, useEffect, useRef } from './htm-preact-standalone.js';
import {
  PERIOD_DAYS, filterByPlayDays,
  computeTimeOfDay, computeDayOfWeek, computeDailyTrend, computeSeason,
  computeBasicStats, computeWinLossPattern,
  computeEnemyMatchup, computePartner, computeCostPair, computeMsPair,
  computeDmgContribution, computeTeamDeathsImpact,
  computeBurstCount, computeFallOrder, computeBurstTiming, computeBurstType,
  computeFixedPartners,
  computeShareData, computeMsSummary,
  clampMetric,
} from './analysis/stats.js';
import {
  loadMatchesFromDB, saveMatchesToDB, replaceMatchesForUser, schemaMismatch,
} from './lib/db.js';
import {
  esc, pct, num, colorPct, colorDE,
  colorDmgGiven, colorDmgTaken, colorKills, colorDeaths, colorKD,
  colorExDmg, colorBursts, cellDisplay,
  buildShareText, SVG_X, SVG_BSKY, SVG_LINE, SVG_COPY, SVG_CHECK,
} from './lib/format.js';
import {
  Tips, SortableTable, Table, SubSection, RangeCalendar,
} from './components/ui.js';
import { SearchView } from './components/search.js';
import {
  useInView,
  EnemyMatchupSection, PartnerSection, MsPairSubSection, CostPairSubSection,
  DmgContributionSubSection, TeamDeathsImpactSection, TeamDeathsHeatmap,
  TimeOfDayChart, DayOfWeekChart, DailyTrendChart, SeasonChart,
  WinRateBarChart, DmgContributionChart,
  FallOrderContent, BurstTimingContent, BurstTypeContent, BurstCountContent,
  CompareRadar,
} from './components/charts.js';

// --- Constants ---
var STATUS_MESSAGES = {
  pending: '準備中...',
  refreshing: '最新データを取得中...',
  scraping: '戦績を取得中...（数分かかります）',
  analyzing: '分析中...',
  done: '完了',
  error: 'エラーが発生しました',
};

// 実行中の分析ジョブID。ログアウト時にこのジョブのスクレイピングを中断し、ポーリングを停止するために使う
var activeJobId = null;

var PERIOD_KEYS = ['all', '90d', '60d', '30d', '14d', '7d', '3d', '1d'];

// --- Time selector ---

var MINUTES_START = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
var MINUTES_END = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59];

function TimeSelector({ hour, minute, onChangeHour, onChangeMinute, isEnd }) {
  var hours = [];
  for (var h = 0; h < 24; h++) hours.push(h);
  var minutes = isEnd ? MINUTES_END : MINUTES_START;

  return html`<div class="time-sel">
    <select class="time-select" value=${hour} onChange=${function (e) { onChangeHour(parseInt(e.target.value)); }}>
      ${hours.map(function (h) { return html`<option value=${h}>${String(h).padStart(2, '0')}時</option>`; })}
    </select>
    <span class="time-colon">:</span>
    <select class="time-select" value=${minute} onChange=${function (e) { onChangeMinute(parseInt(e.target.value)); }}>
      ${minutes.map(function (m) { return html`<option value=${m}>${String(m).padStart(2, '0')}分</option>`; })}
    </select>
  </div>`;
}

// --- Period selector (GCP/AWS style dropdown) ---

function PeriodSelector({ periods, selected, onSelect, userKey, onCustomReport }) {
  var keys = PERIOD_KEYS.filter(function (k) { return periods[k]; });
  if (keys.length <= 1 && !userKey) return null;

  var openRef = useState(false);
  var isOpen = openRef[0], setIsOpen = openRef[1];
  var customRef = useState(false);
  var showCustom = customRef[0], setShowCustom = customRef[1];
  var errorRef = useState('');
  var customError = errorRef[0], setCustomError = errorRef[1];

  // カスタム日時の状態（日付文字列 + 時/分）
  var startDateRef = useState('');
  var startDate = startDateRef[0], setStartDate = startDateRef[1];
  var startHourRef = useState(0);
  var startHour = startHourRef[0], setStartHour = startHourRef[1];
  var startMinRef = useState(0);
  var startMin = startMinRef[0], setStartMin = startMinRef[1];
  var endDateRef = useState('');
  var endDate = endDateRef[0], setEndDate = endDateRef[1];
  var endHourRef = useState(23);
  var endHour = endHourRef[0], setEndHour = endHourRef[1];
  var endMinRef = useState(59);
  var endMin = endMinRef[0], setEndMin = endMinRef[1];
  var timeRef = useState(false);
  var showTime = timeRef[0], setShowTime = timeRef[1];

  var containerRef = useRef(null);
  var triggerRef = useRef(null);
  var customElRef = useRef(null);

  // 日付指定を開いたらカレンダーが見えるようドロップダウン内でスクロールする
  useEffect(function () {
    if (showCustom && customElRef.current) {
      customElRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [showCustom]);

  useEffect(function () {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return function () { document.removeEventListener('mousedown', handleClick); };
  }, []);

  useEffect(function () {
    if (isOpen && window.innerWidth <= 720) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  var dropStyle = {};
  if (isOpen && triggerRef.current && window.innerWidth <= 720) {
    dropStyle.top = triggerRef.current.getBoundingClientRect().bottom + 4 + 'px';
  }

  var currentLabel = selected === 'custom'
    ? (periods.custom ? periods.custom.label : '日付指定')
    : (periods[selected] ? periods[selected].label : '全データ');

  function selectPreset(k) {
    onSelect(k);
    setIsOpen(false);
    setShowCustom(false);
  }

  function formatDt(date, hour, min) {
    return date + ' ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  function handleCustomApply() {
    if (!startDate || !endDate) {
      setCustomError('開始日と終了日をカレンダーから選択してください');
      return;
    }
    var start = showTime ? formatDt(startDate, startHour, startMin) : startDate + ' 00:00';
    var end = showTime ? formatDt(endDate, endHour, endMin) : endDate + ' 23:59';
    setCustomError('');
    onCustomReport({ start: start, end: end });
    setIsOpen(false);
  }

  return html`<div class="period-selector" ref=${containerRef}>
    <button class="period-trigger" ref=${triggerRef} onClick=${function () { setIsOpen(!isOpen); }}>
      ${currentLabel} <span class="period-arrow">${isOpen ? '\u25B2' : '\u25BC'}</span>
    </button>
    ${isOpen && html`<div class="period-backdrop" onClick=${function () { setIsOpen(false); }} />`}
    ${isOpen && html`<div class="period-dropdown" style=${dropStyle}>
      <div class="period-dropdown-list">
        ${keys.map(function (k) {
          return html`<button class=${'period-dropdown-item' + (selected === k ? ' active' : '')}
            onClick=${function () { selectPreset(k); }}>${periods[k].label}</button>`;
        })}
        ${userKey && html`<button class=${'period-dropdown-item period-dropdown-custom' + (showCustom ? ' active' : '')}
          onClick=${function () { setShowCustom(!showCustom); }}>日付指定</button>`}
      </div>
      ${showCustom && html`<div class="period-custom" ref=${customElRef}>
        <div class="period-custom-range">
          <div class="period-custom-col">
            <span class="period-custom-title">開始: ${startDate || '未選択'}${showTime ? ' ' + String(startHour).padStart(2, '0') + ':' + String(startMin).padStart(2, '0') : ''}</span>
          </div>
          <div class="period-custom-col">
            <span class="period-custom-title">終了: ${endDate || '未選択'}${showTime ? ' ' + String(endHour).padStart(2, '0') + ':' + String(endMin).padStart(2, '0') : ''}</span>
          </div>
        </div>
        <${RangeCalendar} startDate=${startDate} endDate=${endDate} onSelectStart=${setStartDate} onSelectEnd=${setEndDate} />
        ${showTime && html`<div class="period-custom-range" style="margin-top:8px">
          <div class="period-custom-col">
            <span style="font-size:0.8em;color:var(--muted)">開始時刻</span>
            <${TimeSelector} hour=${startHour} minute=${startMin}
              onChangeHour=${setStartHour} onChangeMinute=${setStartMin} />
          </div>
          <div class="period-custom-col">
            <span style="font-size:0.8em;color:var(--muted)">終了時刻</span>
            <${TimeSelector} hour=${endHour} minute=${endMin}
              onChangeHour=${setEndHour} onChangeMinute=${setEndMin} isEnd />
          </div>
        </div>`}
        <button class="period-time-toggle" onClick=${function () { setShowTime(!showTime); }}>
          ${showTime ? '時刻指定を解除' : '時刻を指定'}</button>
        <button class="period-custom-apply" onClick=${handleCustomApply}>適用</button>
        ${customError && html`<p class="period-custom-error">${customError}</p>`}
      </div>`}
    </div>`}
  </div>`;
}

// --- Share area ---

function ShareArea({ shareData }) {
  if (!shareData || !shareData.length) return null;
  var text = buildShareText(shareData);
  var encoded = encodeURIComponent(text);
  var xUrl = 'https://x.com/intent/tweet?text=' + encoded;
  var bskyUrl = 'https://bsky.app/intent/compose?text=' + encoded;
  var lineUrl = 'https://line.me/R/share?text=' + encoded;

  function CopyButton() {
    var ref = useState(false);
    var copied = ref[0], setCopied = ref[1];
    function handleCopy() {
      navigator.clipboard.writeText(text).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      });
    }
    return html`<button class=${'share-btn share-copy' + (copied ? ' copied' : '')} onClick=${handleCopy} aria-label="テキストをコピー"
      dangerouslySetInnerHTML=${{ __html: copied ? SVG_CHECK : SVG_COPY }} />`;
  }

  return html`<div class="share-area">
    <span class="share-label">共有</span>
    <a href=${xUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-x" aria-label="Xで共有" dangerouslySetInnerHTML=${{ __html: SVG_X }} />
    <a href=${bskyUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-bsky" aria-label="Blueskyで共有" dangerouslySetInnerHTML=${{ __html: SVG_BSKY }} />
    <a href=${lineUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-line" aria-label="LINEで共有" dangerouslySetInnerHTML=${{ __html: SVG_LINE }} />
    <${CopyButton} />
  </div>`;
}

// --- Hamburger menu & topbar controls ---

function HamburgerMenu({ isOpen, onClose, shareData, onLogout, currentView, onNavigate, onRebuildCache }) {
  useEffect(function () {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;
  var view = currentView || 'report';
  function go(target) {
    if (onNavigate) onNavigate(target);
    onClose();
  }
  return html`<div>
    <div class="menu-backdrop" onClick=${onClose} />
    <div class=${'menu-drawer' + (isOpen ? ' open' : '')}>
      <div class="menu-header"><img src="logo.svg" alt="catalyzer" style="height:24px;width:auto;" /></div>
      <div class="menu-body">
        <div class="menu-section">メニュー</div>
        <button class=${'menu-item' + (view === 'report' ? ' active' : '')} onClick=${function () { go('report'); }}><span class="menu-icon">📊</span>分析レポート</button>
        <button class=${'menu-item' + (view === 'search' ? ' active' : '')} onClick=${function () { go('search'); }}><span class="menu-icon">🔍</span>試合検索</button>
        <button class="menu-item disabled"><span class="menu-icon">📈</span>モバイル総合戦歴<span class="coming-soon">coming soon</span></button>
        <button class="menu-item disabled"><span class="menu-icon">🏆</span>EXランキング<span class="coming-soon">coming soon</span></button>
        <button class="menu-item disabled"><span class="menu-icon">🤖</span>機体使用率ランキング<span class="coming-soon">coming soon</span></button>
        <div class="menu-divider" />
        <a class="menu-item" href="https://web.vsmobile.jp/exvs2ib/" target="_blank" rel="noopener noreferrer"><span class="menu-icon">🌐</span>ガンダムモバイル<span class="external-icon">↗</span></a>
        <div class="menu-divider" />
        <div style="padding: 8px 16px;">
          <${ShareArea} shareData=${shareData} />
        </div>
        <div class="menu-divider" />
        ${onRebuildCache && html`<button class="menu-item" onClick=${function () { onClose(); onRebuildCache(); }}><span class="menu-icon">🔄</span>データを再取得</button>`}
        <button class="menu-item" style="color: var(--bad)" onClick=${function () { onClose(); onLogout(); }}>ログアウト</button>
      </div>
    </div>
  </div>`;
}

function MsSelector({ entries, selected, onSelect }) {
  var ref = useState(false);
  var isOpen = ref[0], setIsOpen = ref[1];
  var containerRef = useRef(null);
  useEffect(function () {
    if (!isOpen) return;
    function handleClick(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false); }
    document.addEventListener('click', handleClick, true);
    return function () { document.removeEventListener('click', handleClick, true); };
  }, [isOpen]);
  var label = selected ? '1機選択' : '全機体';
  var isSelected = !!selected;
  var triggerRef = useRef(null);
  var dropStyle = {};
  if (isOpen && triggerRef.current && window.innerWidth <= 720) {
    dropStyle.top = triggerRef.current.getBoundingClientRect().bottom + 4 + 'px';
  }
  return html`<div class="ms-topbar-wrap" ref=${containerRef}>
    <button class=${'ms-topbar-trigger' + (isSelected ? ' selected' : '')} ref=${triggerRef} onClick=${function () { setIsOpen(!isOpen); }}>
      ${esc(label)} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="ms-topbar-backdrop" onClick=${function () { setIsOpen(false); }} />`}
    ${isOpen && html`<div class="ms-topbar-dropdown" style=${dropStyle}>
      <button class=${'ms-topbar-item' + (!selected ? ' active' : '')}
        onClick=${function () { onSelect(null); setIsOpen(false); }}>全機体</button>
      ${entries.map(function (e) {
        return html`<button class=${'ms-topbar-item' + (selected === e.name ? ' active' : '')}
          onClick=${function () { onSelect(e.name); setIsOpen(false); }}>${esc(e.name)} <span style="color:var(--muted)">(${e.matches}戦)</span></button>`;
      })}
    </div>`}
  </div>`;
}

function LensToggle({ lens, onSelect }) {
  var opts = [['all', '全体'], ['win', '勝利'], ['loss', '敗北']];
  return html`<div class="lens-toggle">
    ${opts.map(function (o) {
      return html`<button class=${'lens-btn' + (lens === o[0] ? ' active' : '')}
        onClick=${function () { onSelect(o[0]); }}>${o[1]}</button>`;
    })}
  </div>`;
}

// --- Dashboard building blocks ---

// KPIカードの色クラス。higher=trueは大きいほど良い
function kpiClass(n, great, good, terrible, higher) {
  if (n == null) return '';
  if (higher) return n >= great ? 'great' : n >= good ? 'good' : n <= terrible ? 'terrible' : 'bad';
  return n <= great ? 'great' : n <= good ? 'good' : n >= terrible ? 'terrible' : 'bad';
}

function Panel({ title, children }) {
  return html`<div class="panel">
    ${title && html`<h2><span class="dot" />${title}</h2>`}
    ${children}
  </div>`;
}

function KpiGrid({ stats }) {
  if (!stats) return null;
  var cards = [
    { label: '対戦数', value: stats.matches, cls: '', sub: stats.wins + '勝 ' + stats.losses + '敗' },
    { label: '勝率', value: pct(stats.win_rate), cls: kpiClass(stats.win_rate, 60, 50, 40, true), sub: '' },
    { label: '平均与ダメージ', value: num(stats.avg_dmg_given), cls: kpiClass(stats.avg_dmg_given, 1100, 900, 700, true), sub: '' },
    { label: '平均被ダメージ', value: num(stats.avg_dmg_taken), cls: kpiClass(stats.avg_dmg_taken, 700, 800, 900, false), sub: '' },
    { label: '平均EXダメージ', value: num(stats.avg_ex_dmg), cls: kpiClass(stats.avg_ex_dmg, 200, 160, 100, true), sub: '' },
    { label: '与被ダメ比', value: num(stats.dmg_efficiency, 2), cls: kpiClass(stats.dmg_efficiency, 1.2, 1.0, 0.8, true), sub: '' },
  ];
  return html`<div class="kpi-grid">${cards.map(function (c) {
    return html`<div class="kpi">
      <div class="kpi-label">${c.label}</div>
      <div class=${'kpi-value ' + c.cls}>${c.value}</div>
      ${c.sub && html`<div class="kpi-sub">${c.sub}</div>`}
    </div>`;
  })}</div>`;
}

// 2系列を重ねたレーダー（series: [{label, color, bg, data[]}]）
// 全体・勝利時・敗北時を下のボタンで単一選択し、レーダーとテーブルを連動して切り替える
// 軸はK/D比(頂点)→被ダメ(右)→EXダメ(下)→与ダメ(左)。勝率は分割で無意味なため含めない
function BasicLensSection({ basic, pattern, lens }) {
  if (!basic) return null;
  if (!lens) lens = 'all';
  var metrics = (pattern && pattern.metrics) || [];
  function wmVal(label) {
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }
  // 攻めを上半分・守りを下半分に固めつつ3ペアを対極配置: 与ダメ↔被ダメ, 撃墜↔被撃墜, EXダメ↔覚醒回数
  // 軸順(idx): 0=与ダメ(上), 1=撃墜(右上), 2=覚醒回数(右下), 3=被ダメ(下), 4=被撃墜(左下), 5=EXダメ(左上)
  function vec(dgv, kv, bv, dtv, dthv, exv) {
    return [clampMetric(dgv, 'dmgGiven'), clampMetric(kv, 'kills'), clampMetric(bv, 'bursts'), clampMetric(dtv, 'dmgTaken'), clampMetric(dthv, 'deaths'), clampMetric(exv, 'exDmg')];
  }
  var seriesByLens = {
    all: { label: '全体', color: '#81d4fa', bg: 'rgba(129,212,250,.2)', data: vec(basic.avg_dmg_given, basic.avg_kills, basic.avg_bursts, basic.avg_dmg_taken, basic.avg_deaths, basic.avg_ex_dmg) },
    win: { label: '勝利時', color: '#69f0ae', bg: 'rgba(105,240,174,.2)', data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
    loss: { label: '敗北時', color: '#ef5350', bg: 'rgba(239,83,80,.18)', data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
  };

  // [ラベル, 全体値, 色関数]。勝敗時はwin_loss_patternの同名metricから値を引く
  var specs = [
    ['平均与ダメージ', basic.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', basic.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', basic.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', basic.avg_kills, colorKills],
    ['平均被撃墜', basic.avg_deaths, colorDeaths],
    ['K/D比', basic.kd_ratio, colorKD],
    ['平均EXダメージ', basic.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', basic.avg_bursts, colorBursts],
  ];
  function valFor(label, allVal) {
    if (lens === 'all') return allVal;
    return wmVal(label);
  }
  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (basic.matches + '戦')
    : lens === 'win' ? (basic.wins + '戦') : (basic.losses + '戦');
  // 勝率は勝敗で割ると100%/0%の同語反復になるため、勝敗時は「ー」で行だけ維持
  var rows = [
    [matchesLabel, matchesVal],
    ['勝率', lens === 'all' ? colorPct(basic.win_rate) : '-'],
  ].concat(specs.map(function (s) {
    return [s[0], s[2](valFor(s[0], s[1]))];
  }));

  var lensLabel = seriesByLens[lens].label;
  return html`<div class="two-col">
    <div>
      <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[seriesByLens[lens]]} showLegend=${false} />
    </div>
    <div class="lens-table">
      <${Table} headers=${['項目', lensLabel]} rows=${rows} />
      <${Tips} tips=${basic.tips} />
    </div>
  </div>`;
}

// 横棒の内側に名前（左）と勝率（右）を描くプラグイン
var inBarLabel = {
  id: 'inBarLabel',
  afterDatasetsDraw: function (chart) {
    var ctx = chart.ctx;
    var meta = chart.getDatasetMeta(0);
    var x0 = chart.scales.x.getPixelForValue(0);
    var areaRight = chart.chartArea.right;
    ctx.save();
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e6edf3';
    var ellipsize = function (text, maxWidth) {
      if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
      return t + '…';
    };
    meta.data.forEach(function (bar, i) {
      var pct = chart.data.datasets[0].data[i].toFixed(1) + '%';
      var pctWidth = ctx.measureText(pct).width;
      // 描画領域から勝率ぶんの幅を確保した上で、収まらない機体名は省略（…）する
      var name = ellipsize(chart.data.labels[i], areaRight - (x0 + 8) - pctWidth - 12);
      ctx.textAlign = 'left';
      ctx.fillText(name, x0 + 8, bar.y);
      var nameRight = x0 + 8 + ctx.measureText(name).width;
      // 棒内の名前の右側に勝率が収まるなら右端内側に、収まらなければ棒の外（名前の右隣）に出す
      if (bar.x - 8 - pctWidth > nameRight + 6) {
        ctx.textAlign = 'right';
        ctx.fillText(pct, bar.x - 8, bar.y);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(pct, Math.max(bar.x + 6, nameRight + 6), bar.y);
      }
    });
    ctx.restore();
  },
};

// 機体別の勝率を横棒で比較（棒の内側に機体名と勝率）
function MsCompareChart({ entries }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !entries.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var values = entries.map(function (e) { return e.winRate; });
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: entries.map(function (e) { return e.name; }),
        datasets: [{
          data: values,
          backgroundColor: values.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.35)'; }),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 4 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 100, ticks: { color: '#888', font: { size: 11 }, callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { display: false }, grid: { display: false } },
        },
      },
      plugins: [inBarLabel],
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [entries, inView]);

  var h = Math.max(160, entries.length * 46);
  return html`<div class="chart-container" style=${'height:' + h + 'px'} ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

function PartnerDropdown({ items, idx, onSelect }) {
  var ref = useState(false);
  var isOpen = ref[0], setIsOpen = ref[1];
  var containerRef = useRef(null);
  useEffect(function () {
    if (!isOpen) return;
    function handleClick(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false); }
    document.addEventListener('click', handleClick, true);
    return function () { document.removeEventListener('click', handleClick, true); };
  }, [isOpen]);
  var current = items[idx];
  var label = current.partner_name + (current.team_name ? ' 【' + current.team_name + '】' : '');
  return html`<div class="panel-select-wrap" ref=${containerRef}>
    <button class="panel-select-trigger" onClick=${function () { setIsOpen(!isOpen); }}>
      ${esc(label)} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="panel-select-dropdown">
      ${items.map(function (item, i) {
        var itemLabel = item.partner_name + (item.team_name ? ' 【' + item.team_name + '】' : '');
        return html`<button class=${'panel-select-item' + (i === idx ? ' active' : '')}
          onClick=${function () { onSelect(i); setIsOpen(false); }}>${esc(itemLabel)}</button>`;
      })}
    </div>`}
  </div>`;
}

function FixedPartnerPanel({ fp, fpItems, lens }) {
  var idxRef = useState(0);
  var idx = idxRef[0], setIdx = idxRef[1];
  var p = fpItems[idx];
  if (!p) return null;
  if (!lens) lens = 'all';

  var myWl = (p.my_win_loss_pattern && p.my_win_loss_pattern.metrics) || [];
  var partnerWl = (p.partner_win_loss_pattern && p.partner_win_loss_pattern.metrics) || [];
  function valFor(metrics, label, allVal) {
    if (lens === 'all') return allVal;
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }

  var specs = [
    ['平均与ダメージ', p.my_stats.avg_dmg_given, p.partner_stats.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', p.my_stats.avg_dmg_taken, p.partner_stats.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', p.my_stats.dmg_efficiency, p.partner_stats.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', p.my_stats.avg_kills, p.partner_stats.avg_kills, colorKills],
    ['平均被撃墜', p.my_stats.avg_deaths, p.partner_stats.avg_deaths, colorDeaths],
    ['K/D比', p.my_stats.kd_ratio, p.partner_stats.kd_ratio, colorKD],
    ['平均EXダメージ', p.my_stats.avg_ex_dmg, p.partner_stats.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', p.my_stats.avg_bursts, p.partner_stats.avg_bursts, colorBursts],
  ];
  var statsRows = specs.map(function (s) {
    return [s[0], s[3](valFor(myWl, s[0], s[1])), s[3](valFor(partnerWl, s[0], s[2]))];
  });

  function pVec(stats, wlMetrics) {
    function v(label, allVal) { return valFor(wlMetrics, label, allVal); }
    return [
      clampMetric(v('平均与ダメージ', stats.avg_dmg_given), 'dmgGiven'),
      clampMetric(v('平均撃墜', stats.avg_kills), 'kills'),
      clampMetric(v('平均覚醒回数', stats.avg_bursts), 'bursts'),
      clampMetric(v('平均被ダメージ', stats.avg_dmg_taken), 'dmgTaken'),
      clampMetric(v('平均被撃墜', stats.avg_deaths), 'deaths'),
      clampMetric(v('平均EXダメージ', stats.avg_ex_dmg), 'exDmg'),
    ];
  }

  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (p.matches + '戦')
    : lens === 'win' ? (p.wins + '戦') : (p.losses + '戦');
  var lensLabel = lens === 'all' ? '全体' : lens === 'win' ? '勝利時' : '敗北時';

  var headerRows = [
    [matchesLabel, matchesVal, '-'],
    ['勝率', lens === 'all' ? colorPct(p.win_rate) : '-', '-'],
  ];

  var msRows = (p.partner_ms_breakdown || []).map(function (m) { return [esc(m.ms), m.matches, colorPct(m.win_rate)]; });

  return html`<${Panel} title="固定相方">
    ${fp.notice && html`<p style="margin-bottom: 12px; color: var(--muted); font-size: 0.9em;">${esc(fp.notice)}</p>`}
    ${fpItems.length > 1 ? html`<${PartnerDropdown} items=${fpItems} idx=${idx} onSelect=${setIdx} />` : html`<div class="ms-head">
      <span class="name">${esc(p.partner_name)}${p.team_name ? html` <span class="meta">【${esc(p.team_name)}】</span>` : ''}</span>
      <span>${p.matches}戦 ${cellDisplay(colorPct(p.win_rate))}</span>
    </div>`}
    <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[
      { label: '自分 (' + lensLabel + ')', color: '#4fc3f7', bg: 'rgba(79,195,247,.2)', data: pVec(p.my_stats, myWl) },
      { label: '相方 (' + lensLabel + ')', color: '#ff8a65', bg: 'rgba(255,138,101,.18)', data: pVec(p.partner_stats, partnerWl) },
    ]} />
    <${Table} headers=${['項目 (' + lensLabel + ')', '自分', '相方']} rows=${headerRows.concat(statsRows)} />
    ${msRows.length > 0 && html`<p><strong>相方の使用機体:</strong></p><${Table} headers=${['機体', '試合', '勝率']} rows=${msRows} />`}
    <${Tips} tips=${p.tips} />
  <//>`;
}

// --- Tab panes ---

function OverviewPane({ pd, selectedMs, lens, frontendData }) {
  var seasons = (frontendData && frontendData.season) || [];
  var msSummary = (frontendData && frontendData.ms_summary) || {};
  var msEntries = Object.keys(msSummary).sort(function (a, b) { return msSummary[b].matches - msSummary[a].matches; });
  var compareEntries = msEntries.map(function (name) {
    return { name: name, winRate: (msSummary[name].basic_stats && msSummary[name].basic_stats.win_rate) || 0 };
  });

  var fp = (frontendData && frontendData.fixed_partners) || {};
  var fpList = fp ? (fp.partners || fp) : [];
  var fpItems = Array.isArray(fpList) ? fpList : [];

  return html`<div class="tabpane">
    ${pd.basic_stats && html`<${Panel} title="基本データ">
      <${BasicLensSection} basic=${pd.basic_stats} pattern=${pd.win_loss_pattern} lens=${lens} />
    <//>`}

    ${seasons.length > 0 && html`<${Panel} title="シーズン別分析">
      ${seasons.length > 1 && html`<${SeasonChart} seasons=${seasons} />`}
      ${seasons.map(function (s) {
        var rows = [['全体', s.matches, colorPct(s.win_rate), colorDE(s.dmg_efficiency, 3)]];
        if (s.first_half) rows.push(['前半', s.first_half.matches, colorPct(s.first_half.win_rate), colorDE(s.first_half.dmg_efficiency, 3)]);
        if (s.second_half) rows.push(['後半', s.second_half.matches, colorPct(s.second_half.win_rate), colorDE(s.second_half.dmg_efficiency, 3)]);
        return html`<${SubSection} title=${esc(s.name)}>
          <${Table} headers=${['期間', '試合', '勝率', '与被ダメ比']} rows=${rows} />
          <${Tips} tips=${s.tips} />
        <//>`;
      })}
    <//>`}

    ${!selectedMs && compareEntries.length > 1 && html`<${Panel} title="機体別の勝率比較">
      <${MsCompareChart} entries=${compareEntries} />
    <//>`}

    ${fpItems.length > 0 && html`<${FixedPartnerPanel} fp=${fp} fpItems=${fpItems} lens=${lens} />`}

    ${!fpItems.length && fp && fp.notice && html`<${Panel} title="固定相方">
      <p>${esc(fp.notice)}</p>
    <//>`}
  </div>`;
}

function TimePane({ pd }) {
  var time = pd.time_of_day, dow = pd.day_of_week, daily = pd.daily_trend;
  var timeRows = time && time.hours ? time.hours.map(function (h) {
    return [{ sortValue: h.hour, display: h.hour + '時' }, h.matches, colorPct(h.win_rate), colorDE(h.dmg_efficiency, 3)];
  }) : [];
  var dowSummary = [];
  if (dow && dow.weekday) dowSummary.push(['平日', dow.weekday.matches, colorPct(dow.weekday.win_rate), colorDE(dow.weekday.dmg_efficiency, 3)]);
  if (dow && dow.weekend) dowSummary.push(['土日', dow.weekend.matches, colorPct(dow.weekend.win_rate), colorDE(dow.weekend.dmg_efficiency, 3)]);
  var dowDays = (dow && dow.days || []).map(function (d) {
    return [d.name + '曜', d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });
  var dailyRows = (daily && daily.days || []).map(function (d) {
    return [{ sortValue: d.date, display: d.date + ' (' + d.dow_name + ')' }, d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });

  return html`<div class="tabpane">
    ${time && time.hours && time.hours.length > 0 && html`<${Panel} title="時間帯別の勝率">
      <${TimeOfDayChart} hours=${time.hours} />
      <${Tips} tips=${time.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        <${SortableTable} headers=${['時間帯', '試合', '勝率', '与被ダメ比']} rows=${timeRows} />
      <//>
    <//>`}
    ${dow && dow.days && dow.days.length > 0 && html`<${Panel} title="曜日別の勝率">
      <${DayOfWeekChart} days=${dow.days} />
      <${Tips} tips=${dow.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        ${dowSummary.length > 0 && html`<h3>平日 vs 土日</h3><${Table} headers=${['区分', '試合', '勝率', '与被ダメ比']} rows=${dowSummary} />`}
        ${dowDays.length > 0 && html`<h3>曜日別</h3><${Table} headers=${['曜日', '試合', '勝率', '与被ダメ比']} rows=${dowDays} />`}
      <//>
    <//>`}
    ${daily && daily.days && daily.days.length > 0 && html`<${Panel} title="日別勝率">
      <${DailyTrendChart} days=${daily.days} />
      <${Tips} tips=${daily.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        <${SortableTable} headers=${['日付', '試合', '勝率', '与被ダメ比']} rows=${dailyRows} />
      <//>
    <//>`}
  </div>`;
}

// --- New tab panes ---

function PlaystylePane({ frontendData }) {
  var teamDeaths = frontendData.team_deaths;
  var dmg = frontendData.dmg_contribution;
  var fallOrder = frontendData.fall_order;

  var fallItems = [];
  if (fallOrder) {
    ['no_fall', 'first_fall', 'second_fall', 'same_time'].forEach(function (k) {
      if (fallOrder[k] && fallOrder[k].count > 0) {
        var labels = { no_fall: '0落ち', first_fall: '先落ち', second_fall: '後落ち', same_time: '同時落ち' };
        fallItems.push({ name: labels[k], winRate: fallOrder[k].win_rate });
      }
    });
  }

  return html`<div class="tabpane">
    ${teamDeaths && teamDeaths.groups.length > 0 && html`<${Panel} title="被撃墜と勝率（自機×僚機）">
      <${TeamDeathsHeatmap} teamDeaths=${teamDeaths} />
      <${TeamDeathsImpactSection} teamDeaths=${teamDeaths} />
    <//>`}

    ${fallOrder && html`<${Panel} title="先落ち/後落ち分析">
      ${fallItems.length > 0 && html`<${MsCompareChart} entries=${fallItems} />`}
      <${FallOrderContent} fallOrder=${fallOrder} />
    <//>`}

    ${dmg && html`<${Panel} title="ダメージ貢献率">
      <${DmgContributionChart} dmg=${dmg} />
      <${DmgContributionSubSection} dmg=${dmg} />
    <//>`}

    ${!(teamDeaths && teamDeaths.groups.length > 0) && !fallOrder && !dmg && html`<${Panel}><p>立ち回りデータがありません。</p><//>`}
  </div>`;
}

function BurstPane({ frontendData }) {
  var burstCount = frontendData.burst_count;
  var burstTiming = frontendData.burst_timing;
  var burstType = frontendData.burst_type;

  var countItems = burstCount && burstCount.by_count ? burstCount.by_count : [];
  var typeItems = burstType && burstType.by_type
    ? burstType.by_type.map(function (t) { return { label: t.label, matches: t.matches, win_rate: t.win_rate }; })
    : [];
  var timingItems = burstTiming && burstTiming.by_timing
    ? burstTiming.by_timing.map(function (t) { return { label: t.label, matches: t.count, win_rate: t.win_rate }; })
    : [];

  return html`<div class="tabpane">
    ${countItems.length > 0 && html`<${Panel} title="覚醒回数と勝率">
      <${WinRateBarChart} items=${countItems} />
      <${BurstCountContent} countData=${burstCount} />
    <//>`}

    ${typeItems.length > 0 && html`<${Panel} title="覚醒タイプ別傾向">
      <${WinRateBarChart} items=${typeItems} />
      <${BurstTypeContent} typeData=${burstType} />
    <//>`}

    ${timingItems.length > 0 && html`<${Panel} title="覚醒タイミング">
      <${WinRateBarChart} items=${timingItems} />
      <${BurstTimingContent} timingData=${burstTiming} />
    <//>`}

    ${!countItems.length && !typeItems.length && !timingItems.length && html`<${Panel}><p>覚醒データがありません（タイムラインデータが必要です）。</p><//>`}
  </div>`;
}

function MatchupPane({ frontendData }) {
  var enemyMatchup = frontendData.enemy_matchup;
  var partnerData = frontendData.partner;
  var costPairData = frontendData.cost_pair;
  var msPairData = frontendData.ms_pair;

  var enemyStrong = (enemyMatchup && enemyMatchup.strong || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var enemyWeak = (enemyMatchup && enemyMatchup.weak || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var partnerEntries = (partnerData || []).slice(0, 10).map(function (p) { return { name: p.ms, winRate: p.win_rate }; });
  var msPairEntries = (msPairData && msPairData.by_matches || []).slice(0, 10).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });
  var costPairEntries = (costPairData || []).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });

  return html`<div class="tabpane">
    ${enemyMatchup && html`<${Panel} title="敵機との相性">
      ${enemyStrong.length > 0 && html`<h3>得意な相手</h3><${MsCompareChart} entries=${enemyStrong} />`}
      ${enemyWeak.length > 0 && html`<h3>苦手な相手</h3><${MsCompareChart} entries=${enemyWeak} />`}
      <${EnemyMatchupSection} matchup=${enemyMatchup} />
    <//>`}

    ${partnerData && partnerData.length > 0 && html`<${Panel} title="僚機との相性">
      <${MsCompareChart} entries=${partnerEntries} />
      <${PartnerSection} partners=${partnerData} />
    <//>`}

    ${msPairData && html`<${Panel} title="編成別勝率">
      ${msPairEntries.length > 0 && html`<${MsCompareChart} entries=${msPairEntries} />`}
      <${MsPairSubSection} msPair=${msPairData} />
    <//>`}

    ${costPairData && costPairData.length > 0 && html`<${Panel} title="コスト編成別勝率">
      <${MsCompareChart} entries=${costPairEntries} />
      <${CostPairSubSection} costPair=${costPairData} />
    <//>`}
  </div>`;
}

// --- Main report ---

var TAB_DEFS = [
  ['overview', '総合'],
  ['playstyle', '立ち回り'],
  ['burst', '覚醒'],
  ['matchup', '機体相性'],
  ['time', '時間帯'],
];

function reAnalyze() {
  // セッション保持中はパスワード不要で再分析
  if (localStorage.getItem('catalyzer_has_session')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    reanalyzeWithSession();
    return;
  }
  var u = document.getElementById('username');
  var p = document.getElementById('password');
  if (u && p && u.value && p.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    analyze();
    return;
  }
  var rep = document.getElementById('report');
  if (rep) rep.style.display = 'none';
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function reanalyzeWithSession() {
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');

  var cachedKey = localStorage.getItem('catalyzer_user_key');
  var usedCache = false;
  if (cachedKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedKey);
        usedCache = true;
      }
    } catch (e) {}
  }
  if (!usedCache) showSkeleton();

  status.style.display = 'block';
  statusText.textContent = usedCache ? STATUS_MESSAGES.refreshing : STATUS_MESSAGES.pending;
  error.style.display = 'none';

  var lastPreliminaryVersion = 0;

  try {
    var res = await fetch('/reanalyze', { method: 'POST' });
    var data = await res.json();

    if (data.error) {
      if (res.status === 401) {
        localStorage.removeItem('catalyzer_user_key');
        localStorage.removeItem('catalyzer_has_session');
        // ログイン画面へ戻す。pageTitle(ロゴ)を復帰させ、その safe-area で上端の被りを防ぐ
        var rep = document.getElementById('report');
        if (rep) { render(null, rep); rep.style.display = 'none'; }
        var lf = document.getElementById('loginForm');
        if (lf) lf.style.display = 'block';
        var t = document.getElementById('pageTitle');
        if (t) t.style.display = '';
        error.style.display = 'block';
        error.textContent = data.error;
        status.style.display = 'none';
        return;
      }
      throw new Error(data.error);
    }

    var jobId = data.id;
    activeJobId = jobId;

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      // ログアウト等でジョブが中断/切り替わった場合はポーリングを停止する
      if (activeJobId !== jobId) return;

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      if (statusData.progress_total > 0) {
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (statusData.status === 'scraping') {
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (prelimData.matches && prelimData.preliminary) {
          if (prelimData.user_key) {
            saveMatchesToDB(prelimData.user_key, prelimData.matches, prelimData.schema_version);
          }
          renderReport({ matches: prelimData.matches }, prelimData.user_key);
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'cancelled') return;

      if (statusData.status === 'error') {
        if (statusData.error && statusData.error.indexOf('セッション') >= 0) {
          localStorage.removeItem('catalyzer_user_key');
          localStorage.removeItem('catalyzer_has_session');
          var lf = document.getElementById('loginForm');
          if (lf) lf.style.display = 'block';
        }
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (resultData.error) throw new Error(resultData.error);
        if (resultData.user_key && resultData.matches) {
          await saveMatchesToDB(resultData.user_key, resultData.matches, resultData.schema_version);
        }
        renderReport({ matches: resultData.matches }, resultData.user_key);
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
  } finally {
    if (activeJobId === jobId) activeJobId = null;
    status.style.display = 'none';
  }
}

async function logout() {
  // 実行中の分析ジョブがあればスクレイピングを中断し、ポーリングを停止する
  var jid = activeJobId;
  activeJobId = null;
  // キャンセルは撃ちっぱなし（await しない）。/cancel が詰まってもセッション削除・UIリセットを止めない
  if (jid) {
    try { fetch('/cancel/' + jid, { method: 'POST' }).catch(function () {}); } catch (e) {}
  }
  try {
    await fetch('/session', { method: 'DELETE' });
  } catch (e) {}
  localStorage.removeItem('catalyzer_user_key');
  localStorage.removeItem('catalyzer_has_session');
  try { sessionStorage.removeItem('catalyzer_cred'); } catch (e) {}

  var rep = document.getElementById('report');
  if (rep) { render(null, rep); rep.style.display = 'none'; }
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function Report({ data, userKey }) {
  if (!data) return null;
  var periodRef = useState('all');
  var selectedPeriod = periodRef[0], setSelectedPeriod = periodRef[1];
  var customRangeRef = useState(null);
  var customRange = customRangeRef[0], setCustomRange = customRangeRef[1];
  var tabRef = useState('overview');
  var activeTab = tabRef[0], setActiveTab = tabRef[1];
  var msRef = useState(null);
  var selectedMs = msRef[0], setSelectedMs = msRef[1];
  var lensRef = useState('all');
  var lens = lensRef[0], setLens = lensRef[1];
  var menuRef = useState(false);
  var menuOpen = menuRef[0], setMenuOpen = menuRef[1];
  // 再分析はReportを再マウントするため、view(report/search)をlocalStorageで永続化して復元する。
  var viewRef = useState(function () { try { return localStorage.getItem('catalyzer_view') || 'report'; } catch (e) { return 'report'; } });
  var view = viewRef[0], setView = viewRef[1];
  function navigate(v) {
    setView(v);
    try { localStorage.setItem('catalyzer_view', v); } catch (e) {}
    // 画面切替時に、メニューで残ったスクロールロックを確実に解除し先頭へ戻す
    // （ヘッダーが下に固定されスクロール不能になる不具合の対処）。
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);
  }
  var matchesRef = useState(data.matches || null);
  var allMatches = matchesRef[0], setAllMatches = matchesRef[1];
  var tagPartnersRef = useState(null);
  var tagPartners = tagPartnersRef[0], setTagPartners = tagPartnersRef[1];
  var msImagesRef = useState(null);
  var msImages = msImagesRef[0], setMsImages = msImagesRef[1];
  var topbarRef = useRef(null);

  // 機体名→画像URLのマップを一度だけ取得（試合検索一覧のサムネイル表示用）。
  useEffect(function () {
    fetch('/ms-list')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!list) return;
        var map = {};
        list.forEach(function (m) { if (m && m.Name) map[m.Name] = m.ImageURL; });
        setMsImages(map);
      })
      .catch(function () {});
  }, []);

  useEffect(function () {
    if (!userKey) return;
    loadMatchesFromDB(userKey).then(function (matches) {
      if (matches && matches.length > 0) setAllMatches(function (prev) {
        return prev && prev.length >= matches.length ? prev : matches;
      });
    }).catch(function () {});
    fetch('/tag-partners?user_key=' + encodeURIComponent(userKey))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.tag_partners) setTagPartners(d.tag_partners); })
      .catch(function () {});
  }, [userKey]);

  useEffect(function () {
    var row = topbarRef.current && topbarRef.current.querySelector('.controls-row');
    if (!row) return;
    function onScroll() {
      if (window.scrollY > 50) {
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.paddingTop = '0';
        row.style.overflow = 'hidden';
        row.style.pointerEvents = 'none';
      } else {
        row.style.maxHeight = '';
        row.style.opacity = '';
        row.style.paddingTop = '';
        row.style.overflow = '';
        row.style.pointerEvents = '';
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return function () { window.removeEventListener('scroll', onScroll); };
  }, []);

  // 画面(view)が変わるたびに、メニュー由来のスクロールロックを確実に解除し先頭へ戻す。
  // 再分析中はReportが再描画(再マウント)されるため、navigate内だけでなくここでも保証する
  // （切替時にヘッダーが下に固定されスクロール不能になる不具合の対処）。
  useEffect(function () {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);
  }, [view]);

  var PERIOD_LABELS = { all: '全データ', '90d': '90日', '60d': '60日', '30d': '30日', '14d': '14日', '7d': '7日', '3d': '3日', '1d': '1日' };
  var periods = {};
  PERIOD_KEYS.forEach(function (k) { periods[k] = { label: PERIOD_LABELS[k] }; });
  if (customRange) periods.custom = { label: customRange.start.substring(5, 10) + ' ~ ' + customRange.end.substring(5, 10) };

  var frontendData = useMemo(function () {
    if (!allMatches || !allMatches.length) return null;
    var periodFiltered = allMatches;
    var days = PERIOD_DAYS[selectedPeriod];
    if (days) periodFiltered = filterByPlayDays(allMatches, days);
    if (selectedPeriod === 'custom' && customRange) {
      periodFiltered = allMatches.filter(function (m) {
        return m.date >= customRange.start && m.date <= customRange.end;
      });
    }
    if (!periodFiltered.length) return null;
    var msSummary = computeMsSummary(periodFiltered);
    var shareItems = computeShareData(periodFiltered);
    var filtered = periodFiltered;
    if (selectedMs) filtered = filtered.filter(function (m) { return m.ms === selectedMs; });
    // 勝敗レンズ: 選択時はレポート全体を勝ち/負け試合のみに絞る（MS一覧・共有データは母集団のまま）
    if (lens === 'win') filtered = filtered.filter(function (m) { return m.win; });
    else if (lens === 'loss') filtered = filtered.filter(function (m) { return !m.win; });
    if (!filtered.length) return { ms_summary: msSummary, share_data: shareItems };
    return {
      ms_summary: msSummary,
      share_data: shareItems,
      time_of_day: computeTimeOfDay(filtered),
      day_of_week: computeDayOfWeek(filtered),
      daily_trend: computeDailyTrend(filtered),
      season: computeSeason(filtered),
      basic_stats: computeBasicStats(filtered),
      win_loss_pattern: computeWinLossPattern(filtered),
      enemy_matchup: computeEnemyMatchup(filtered),
      partner: computePartner(filtered),
      cost_pair: computeCostPair(filtered),
      ms_pair: computeMsPair(filtered),
      dmg_contribution: computeDmgContribution(filtered),
      team_deaths: computeTeamDeathsImpact(filtered),
      burst_count: computeBurstCount(filtered),
      fall_order: computeFallOrder(filtered),
      burst_timing: computeBurstTiming(filtered),
      burst_type: computeBurstType(filtered),
      fixed_partners: computeFixedPartners(filtered, tagPartners),
    };
  }, [allMatches, selectedPeriod, selectedMs, lens, tagPartners, customRange]);

  var msStats = (frontendData && frontendData.ms_summary) || {};
  var msEntries = useMemo(function () {
    return Object.keys(msStats).sort(function (a, b) { return msStats[b].matches - msStats[a].matches; }).map(function (name) {
      return { name: name, matches: msStats[name].matches };
    });
  }, [msStats]);

  useEffect(function () {
    if (selectedMs && !msStats[selectedMs]) setSelectedMs(null);
  }, [msStats]);

  var shareData = (frontendData && frontendData.share_data) || [];

  function handleCustomReport(range) {
    setCustomRange(range);
    setSelectedPeriod('custom');
  }

  var fePd = useMemo(function () {
    if (frontendData && frontendData.basic_stats) {
      return { basic_stats: frontendData.basic_stats, win_loss_pattern: frontendData.win_loss_pattern };
    }
    return { basic_stats: null, win_loss_pattern: null };
  }, [frontendData]);

  // 試合検索ビュー: ダッシュボードのフィルタ群とは独立した専用画面。
  // allMatches（IndexedDBキャッシュ）を共有し、フロントエンドで絞り込む。
  if (view === 'search') {
    return html`<div class="view-root">
      <div class="topbar">
        <button class="hamburger" onClick=${function () { setMenuOpen(true); }}>☰</button>
        <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
        <button class="topbar-refresh" onClick=${reAnalyze}>再分析</button>
      </div>
      <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
        shareData=${shareData} onLogout=${logout} currentView=${view} onNavigate=${navigate} onRebuildCache=${rebuildCache} />
      <${SearchView} matches=${allMatches || []} msImages=${msImages || {}} />
    </div>`;
  }

  if (!frontendData) {
    return html`<${Skeleton} />`;
  }

  var pane;
  if (activeTab === 'playstyle') {
    pane = html`<${PlaystylePane} frontendData=${frontendData} />`;
  } else if (activeTab === 'burst') {
    pane = html`<${BurstPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'matchup') {
    pane = html`<${MatchupPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'time') {
    var timePd = { time_of_day: frontendData.time_of_day, day_of_week: frontendData.day_of_week, daily_trend: frontendData.daily_trend };
    pane = html`<${TimePane} pd=${timePd} />`;
  } else {
    pane = html`<${OverviewPane} pd=${fePd} selectedMs=${selectedMs} lens=${lens} frontendData=${frontendData} />`;
  }

  return html`<div class="view-root">
    <div class="topbar" ref=${topbarRef}>
      <button class="hamburger" onClick=${function () { setMenuOpen(true); }}>☰</button>
      <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
      <button class="topbar-refresh" onClick=${reAnalyze}>再分析</button>
      <div class="controls-row">
        <${PeriodSelector} periods=${periods} selected=${selectedPeriod} onSelect=${setSelectedPeriod}
          userKey=${userKey} onCustomReport=${handleCustomReport} />
        <${MsSelector} entries=${msEntries} selected=${selectedMs} onSelect=${setSelectedMs} />
        <${LensToggle} lens=${lens} onSelect=${setLens} />
      </div>
      <div class="tabs">${TAB_DEFS.map(function (t) {
        return html`<button class=${'tab' + (activeTab === t[0] ? ' active' : '')}
          onClick=${function () { setActiveTab(t[0]); }}>${t[1]}</button>`;
      })}</div>
    </div>

    <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
      shareData=${shareData}
      onLogout=${logout} currentView=${view} onNavigate=${navigate} onRebuildCache=${rebuildCache} />

    <${KpiGrid} stats=${fePd.basic_stats} />

    ${pane}
  </div>`;
}

// --- Main app logic ---

// ログイン成功後、データ到着までのダッシュボード骨組み表示
function Skeleton() {
  var menuRef = useState(false);
  var menuOpen = menuRef[0], setMenuOpen = menuRef[1];
  function bar(w, h, mb) {
    return html`<div class="skel" style=${{ width: w, height: h + 'px', marginBottom: (mb || 0) + 'px' }}></div>`;
  }
  return html`<div class="view-root">
    <div class="topbar">
      <button class="hamburger" onClick=${function () { setMenuOpen(true); }}>☰</button>
      <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
      <div class="controls-row" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        <button class="period-trigger" disabled>全データ <span class="period-arrow">▼</span></button>
        <button class="ms-topbar-trigger" disabled>全機体 <span class="period-arrow">▼</span></button>
        <${LensToggle} lens=${'all'} onSelect=${function () {}} />
      </div>
      <div class="tabs" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        ${TAB_DEFS.map(function (t) {
          return html`<button class=${'tab' + (t[0] === 'overview' ? ' active' : '')} disabled>${t[1]}</button>`;
        })}
      </div>
    </div>
    <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
      shareData=${null} onLogout=${logout} onRebuildCache=${rebuildCache} />
    <div class="kpi-grid">
      ${[0, 1, 2, 3, 4, 5].map(function () {
        return html`<div class="kpi">${bar('50%', 12, 12)}${bar('70%', 28)}</div>`;
      })}
    </div>
    <div class="panel">
      ${bar('30%', 16, 14)}${bar('100%', 220)}
    </div>
    <div class="panel">
      ${bar('24%', 16, 14)}
      ${[0, 1, 2, 3].map(function () { return bar('100%', 14, 10); })}
    </div>
  </div>`;
}

function showSkeleton() {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  render(html`<${Skeleton} />`, reportEl);
}

function renderReport(data, userKey) {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  render(html`<${Report} data=${data} userKey=${userKey} />`, reportEl);

  try {
    if (userKey) localStorage.setItem('catalyzer_user_key', userKey);
  } catch (e) {}
}

// IndexedDBキャッシュをサーバー側の全件データで丸ごと置き換える（スクレイピング無し）。
// スキーマバージョン不一致の自動検知、またはHamburgerMenuの「データを再取得」導線から呼ばれる。
async function rebuildCacheFromServer(userKey) {
  var res = await fetch('/matches?user_key=' + encodeURIComponent(userKey));
  var data = await res.json();
  // 空配列(0件)はサーバー側の異常応答の可能性があるため再構築せず既存キャッシュを温存する
  if (!res.ok || !data.matches || !data.matches.length) return;
  await replaceMatchesForUser(userKey, data.matches, data.schema_version);
  renderReport({ matches: data.matches }, userKey);
}

// HamburgerMenuの「データを再取得」ボタンから呼ばれる明示操作版。確認ダイアログを挟む。
async function rebuildCache() {
  var userKey = null;
  try { userKey = localStorage.getItem('catalyzer_user_key'); } catch (e) {}
  if (!userKey) return;
  if (!window.confirm('試合データをサーバーから全件取得し直します。よろしいですか?')) return;
  try {
    await rebuildCacheFromServer(userKey);
  } catch (e) {}
}

async function analyze() {
  var username = document.getElementById('username').value;
  var password = document.getElementById('password').value;
  var btn = document.getElementById('analyzeBtn');
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');
  var reportEl = document.getElementById('report');

  if (!username || !password) {
    error.style.display = 'block';
    error.textContent = 'メールアドレスとパスワードを入力してください。';
    return;
  }

  try { sessionStorage.setItem('catalyzer_cred', JSON.stringify({ u: username, p: password })); } catch (e) {}

  btn.disabled = true;
  status.style.display = 'block';
  statusText.textContent = STATUS_MESSAGES.pending;
  error.style.display = 'none';
  error.style.backgroundColor = '';
  error.style.borderColor = '';
  error.style.color = '';
  reportEl.style.display = 'none';
  render(null, reportEl);

  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = '';

  document.getElementById('loginForm').style.display = 'none';
  var lastPreliminaryVersion = 0;
  var renderedReal = false;

  var cachedKey = localStorage.getItem('catalyzer_user_key');
  var usedCache = false;
  if (cachedKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedKey);
        statusText.textContent = STATUS_MESSAGES.refreshing;
        usedCache = true;
      }
    } catch (e) {}
  }
  if (!usedCache) showSkeleton();

  try {
    var rememberEl = document.getElementById('remember');
    var remember = rememberEl ? rememberEl.checked : false;

    var res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, remember: remember }),
    });

    var data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    var jobId = data.id;
    activeJobId = jobId;

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      // ログアウト等でジョブが中断/切り替わった場合はポーリングを停止する
      if (activeJobId !== jobId) return;

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      var isScraping = statusData.status === 'scraping';
      if (statusData.progress_total > 0) {
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (isScraping) {
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (prelimData.matches && prelimData.preliminary) {
          if (prelimData.user_key) {
            saveMatchesToDB(prelimData.user_key, prelimData.matches, prelimData.schema_version);
          }
          renderReport({ matches: prelimData.matches }, prelimData.user_key);
          renderedReal = true;
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'cancelled') return;

      if (statusData.status === 'error') {
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;

        if (resultData.error) {
          throw new Error(resultData.error);
        }

        if (resultData.user_key && resultData.matches) {
          await saveMatchesToDB(resultData.user_key, resultData.matches, resultData.schema_version);
        }
        renderReport({ matches: resultData.matches }, resultData.user_key);
        renderedReal = true;
        if (resultData.session_saved) {
          try { localStorage.setItem('catalyzer_has_session', '1'); } catch (e) {}
        }
        if (resultData.partial) {
          var warning = document.getElementById('error');
          warning.style.display = 'block';
          warning.style.backgroundColor = '#4a3800';
          warning.style.borderColor = '#d4a017';
          warning.style.color = '#ffd54f';
          warning.textContent = 'ガンダムモバイルからアクセスが制限されたため、一部のデータのみで分析しています。時間をおいて再度実行すると続きから取得します。';
        }
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
    if (!renderedReal) {
      render(null, reportEl);
      reportEl.style.display = 'none';
      if (pageTitle) pageTitle.style.display = '';
    }
    document.getElementById('loginForm').style.display = 'block';
  } finally {
    if (activeJobId === jobId) activeJobId = null;
    btn.disabled = false;
    status.style.display = 'none';
  }
}

var loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    analyze();
  });
  try {
    var cred = JSON.parse(sessionStorage.getItem('catalyzer_cred'));
    if (cred) {
      document.getElementById('username').value = cred.u;
      document.getElementById('password').value = cred.p;
    }
  } catch (e) {}
}

// セッション保持の説明モーダル
var rememberInfoBtn = document.getElementById('rememberInfoBtn');
var rememberModal = document.getElementById('rememberModal');
var rememberModalClose = document.getElementById('rememberModalClose');
if (rememberInfoBtn && rememberModal) {
  rememberInfoBtn.addEventListener('click', function (e) {
    e.preventDefault();
    rememberModal.style.display = 'flex';
  });
  rememberModal.addEventListener('click', function (e) {
    if (e.target === rememberModal) rememberModal.style.display = 'none';
  });
  if (rememberModalClose) {
    rememberModalClose.addEventListener('click', function () {
      rememberModal.style.display = 'none';
    });
  }
}

// ページロード時: IndexedDBにmatchesがあれば即時表示
(async function initSession() {
  var cachedUserKey = null;
  var hasSession = false;
  try {
    cachedUserKey = localStorage.getItem('catalyzer_user_key');
    hasSession = !!localStorage.getItem('catalyzer_has_session');
  } catch (e) {}

  var renderedFromCache = false;
  if (cachedUserKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedUserKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedUserKey);
        renderedFromCache = true;
      }
    } catch (e) {}
  }

  // キャッシュのスキーマバージョンをサーバーの現行版と非ブロッキングで照合し、
  // 不一致なら（Firestore再構築のみの）全件再取得でキャッシュを作り直す。
  // 一致時は/matchesを叩かない。取得不能(サーバー未応答等)なら判定不能として何もしない。
  if (renderedFromCache) {
    fetch('/schema-version').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (schemaMismatch(cachedMatches[0].schema_version, d.schema_version)) {
          rebuildCacheFromServer(cachedUserKey).catch(function () {});
        }
      })
      .catch(function () {});
  }

  // キャッシュからレポートを表示したらログイン画面を隠す。
  // セッション有無に関わらず、レポートの上にログイン画面が残るのを防ぐ
  // （ログインが必要な場合は再分析ボタン経由で reAnalyze が再表示する）。
  if (renderedFromCache && loginForm) loginForm.style.display = 'none';

  if (hasSession) {
    if (loginForm) loginForm.style.display = 'none';
    var hasLocalData = renderedFromCache;

    fetch('/session').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.valid) {
        // セッション失効時は、キャッシュから描画済みのレポートを隠さないと
        // ログイン画面の下に古いレポートが残る（reanalyzeWithSession の401経路と同じ後始末）。
        localStorage.removeItem('catalyzer_has_session');
        var rep = document.getElementById('report');
        if (rep) { render(null, rep); rep.style.display = 'none'; }
        if (loginForm) loginForm.style.display = 'block';
        var t = document.getElementById('pageTitle');
        if (t) t.style.display = '';
      } else if (!hasLocalData) {
        reanalyzeWithSession();
      }
    }).catch(function () {
      if (loginForm) loginForm.style.display = 'block';
    });
  }
})();

// preview.html用: windowにrenderReportを公開
window.renderReport = renderReport;

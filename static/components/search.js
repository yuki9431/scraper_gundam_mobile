import { html, useState, useMemo, useEffect, useRef } from '../htm-preact-standalone.js';
import {
  emptyFilters, hasActiveFilters, collectMsOptions,
  filterMatches, sortMatches, SORT_OPTIONS,
} from '../analysis/search.js';
import {
  esc, num, cellDisplay, isTimeUp,
  colorKillsInt, colorDeathsInt, colorDmgGiven, colorDmgTaken, colorExDmg,
} from '../lib/format.js';
import { CompareRadar } from './charts.js';
import { RangeCalendar, Dropdown, MultiSelect, Autocomplete } from './ui.js';
import { PERIOD_DAYS, filterByPlayDays, clampMetric } from '../analysis/stats.js';

var PAGE_SIZE = 20;

// 試合経過ガントのマッピング。lane 0=バースト行、lane 1=オーバーリミット行。
// kind: 'bar'=可能域の帯（範囲）/ 'diamond'=発動タイミングの菱形（点）。
var GANTT_BAR = {
  'ex': { lane: 0, cls: 'ex', kind: 'bar' },            // EXバースト発動可能域（グレー帯）
  'exbst-f': { lane: 0, cls: 'f', kind: 'diamond' },    // ファイティングバースト発動（橙）
  'exbst-s': { lane: 0, cls: 's', kind: 'diamond' },    // シューティングバースト発動（青）
  'exbst-e': { lane: 0, cls: 'e', kind: 'diamond' },    // エクステンドバースト発動（緑）
  'ov': { lane: 1, cls: 'ov', kind: 'bar' },            // EXオーバーリミット発動可能域（白枠帯）
  'exbst-ov': { lane: 1, cls: 'ov-on', kind: 'diamond' }, // EXオーバーリミット発動（白）
};

// ガント凡例の項目。
var GANTT_LEGEND = [
  ['ex', '覚醒可'], ['f', 'F覚醒'], ['s', 'S覚醒'], ['e', 'E覚醒'], ['death', '被撃墜'],
  ['ov', 'OLスタンバイ'], ['ov-on', 'OL発動'],
];

// 機体/タッグ/コスト編成用の複数選択（OR）。集計結果 [{name, matches}] を渡す。
// 選択後のトリガーは名前のみ（chip）、ドロップダウン内は「名前（N戦）」を出す。
function MsMulti({ values, onChange, options }) {
  var opts = options.map(function (o) { return { value: o.name, label: o.name + '（' + o.matches + '戦）', chip: o.name }; });
  return html`<${MultiSelect} values=${values} options=${opts} onChange=${onChange} placeholder="-" />`;
}

// 数値レンジ入力（最小〜最大）。
function RangeInput({ label, minVal, maxVal, onMin, onMax }) {
  return html`<div class="search-field">
    <label class="search-label">${label}</label>
    <div class="search-range">
      <input type="number" class="search-num" inputmode="numeric" aria-label=${label + ' 最小'}
        value=${minVal} onInput=${function (e) { onMin(e.target.value); }} />
      <span class="search-range-sep">〜</span>
      <input type="number" class="search-num" inputmode="numeric" aria-label=${label + ' 最大'}
        value=${maxVal} onInput=${function (e) { onMax(e.target.value); }} />
    </div>
  </div>`;
}

// フィルタフォーム。filters と個々のフィールド更新関数、リセットを受け取る。
// 詳細設定（カスタム期間・マニアックな数値レンジ）に含めるフィルタ項目。
var ADV_FIELDS = ['dateFrom', 'dateTo', 'enemyTagName',
  'dmgGivenMin', 'dmgGivenMax', 'dmgTakenMin', 'dmgTakenMax', 'killsMin', 'killsMax', 'deathsMin', 'deathsMax',
  'scoreMin', 'scoreMax', 'exDmgMin', 'exDmgMax', 'burstsMin', 'burstsMax'];
// 詳細設定内の複数選択（配列）フィルタ。
var ADV_LIST_FIELDS = ['myTagList', 'myCostList', 'partnerCostList', 'enemyCostPairList'];

// 自機コストの選択肢（固定4種）。
var COST_OPTIONS = [
  { value: '3000', label: '3000' }, { value: '2500', label: '2500' },
  { value: '2000', label: '2000' }, { value: '1500', label: '1500' },
];

function FilterForm({ filters, options, onField, onReset, resultCount }) {
  var openRef = useState(false);
  var open = openRef[0], setOpen = openRef[1];
  var active = hasActiveFilters(filters);
  // 詳細設定に条件が入っていれば初期表示は開く。
  var advActive = ADV_FIELDS.some(function (k) { return filters[k] !== '' && filters[k] != null; })
    || ADV_LIST_FIELDS.some(function (k) { return filters[k] && filters[k].length; });
  var advOpenRef = useState(advActive);
  var advOpen = advOpenRef[0], setAdvOpen = advOpenRef[1];
  // 期間カレンダーはクリックで開くプルダウン形式にする。
  var dateOpenRef = useState(false);
  var dateOpen = dateOpenRef[0], setDateOpen = dateOpenRef[1];

  return html`<div class="panel search-filter-panel">
    <button class=${'search-filter-head' + (open ? ' open' : '')}
      onClick=${function () { setOpen(!open); }} aria-expanded=${open}>
      <span class="search-filter-title"><span class="dot" />絞り込み条件${!open && active && html`<span class="search-filter-badge">適用中</span>`}</span>
      <span class="search-chevron" aria-hidden="true"></span>
    </button>
    ${open && html`<div class="search-form">
      <div class="search-field search-field-wide">
        <label class="search-label">期間</label>
        <${Dropdown} value=${filters.playDays} placeholder="全データ"
          options=${Object.keys(PERIOD_DAYS).map(function (k) { return { value: k, label: PERIOD_DAYS[k] + '日' }; })}
          onChange=${function (v) { onField('playDays', v); }} />
      </div>

      <div class="search-field">
        <label class="search-label">自機（複数選択可）</label>
        <${MsMulti} values=${filters.myMsList} options=${options.mine}
          onChange=${function (vs) { onField('myMsList', vs); }} />
      </div>
      <div class="search-field">
        <label class="search-label">僚機（複数選択可）</label>
        <${MsMulti} values=${filters.partnerMsList} options=${options.partners}
          onChange=${function (vs) { onField('partnerMsList', vs); }} />
      </div>
      <div class="search-field">
        <div class="search-label search-label-row">
          <span>敵機（複数選択可）</span>
          <span class="search-andor">
            ${['and', 'or'].map(function (mode) {
              return html`<button type="button" class=${'search-andor-btn' + (filters.enemyMsMode === mode ? ' active' : '')}
                onClick=${function () { onField('enemyMsMode', mode); }}>${mode.toUpperCase()}</button>`;
            })}
          </span>
        </div>
        <${MsMulti} values=${filters.enemyMsList} options=${options.enemies}
          onChange=${function (vs) { onField('enemyMsList', vs); }} />
      </div>

      <div class="search-field">
        <div class="search-label search-label-row">
          <span>プレイヤー名（部分一致）</span>
          <span class="search-andor">
            ${[['both', '両方'], ['ally', '相方'], ['enemy', '相手']].map(function (o) {
              return html`<button type="button" class=${'search-andor-btn' + (filters.playerNameScope === o[0] ? ' active' : '')}
                onClick=${function () { onField('playerNameScope', o[0]); }}>${o[1]}</button>`;
            })}
          </span>
        </div>
        <${Autocomplete} value=${filters.playerName} placeholder="名前の一部を入力"
          options=${options.playerNames.map(function (o) { return o.name; })}
          onChange=${function (v) { onField('playerName', v); }} />
      </div>

      <div class="search-field">
        <label class="search-label">勝敗</label>
        <div class="lens-toggle">
          ${[['all', '全て'], ['win', '勝利'], ['loss', '敗北']].map(function (o) {
            return html`<button class=${'lens-btn' + (filters.result === o[0] ? ' active' : '')}
              onClick=${function () { onField('result', o[0]); }}>${o[1]}</button>`;
          })}
        </div>
      </div>

      <div class="search-adv">
        <button type="button" class=${'search-adv-toggle' + (advOpen ? ' open' : '')}
          onClick=${function () { setAdvOpen(!advOpen); }} aria-expanded=${advOpen}>
          <span>詳細設定${!advOpen && advActive && html`<span class="search-filter-badge">適用中</span>`}</span>
          <span class="search-chevron" aria-hidden="true"></span>
        </button>
        ${advOpen && html`<div class="search-adv-grid">
          <div class="search-field search-field-wide">
            <label class="search-label">期間（カスタム指定）</label>
            <button type="button" class=${'panel-select-trigger search-date-trigger' + (dateOpen ? ' open' : '')}
              onClick=${function () { setDateOpen(!dateOpen); }} aria-expanded=${dateOpen}>
              <span class="panel-select-label">${filters.dateFrom
                ? esc(filters.dateFrom + ' 〜 ' + (filters.dateTo || '…'))
                : '-'}</span>
              <span class="period-arrow">${dateOpen ? '▲' : '▼'}</span>
            </button>
            ${dateOpen && html`<${RangeCalendar} startDate=${filters.dateFrom} endDate=${filters.dateTo}
              onSelectStart=${function (v) { onField('dateFrom', v); }}
              onSelectEnd=${function (v) { onField('dateTo', v); if (v) setDateOpen(false); }} />`}
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">味方タッグ名（複数選択可）</label>
            <${MsMulti} values=${filters.myTagList} options=${options.myTags}
              onChange=${function (vs) { onField('myTagList', vs); }} />
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">相手タッグ名（部分一致）</label>
            <${Autocomplete} value=${filters.enemyTagName} placeholder="タッグ名の一部を入力"
              options=${options.enemyTags.map(function (o) { return o.name; })}
              onChange=${function (v) { onField('enemyTagName', v); }} />
          </div>
          <div class="search-field">
            <label class="search-label">自機コスト（複数選択可）</label>
            <${MultiSelect} values=${filters.myCostList} placeholder="-" options=${COST_OPTIONS}
              onChange=${function (vs) { onField('myCostList', vs); }} />
          </div>
          <div class="search-field">
            <label class="search-label">僚機コスト（複数選択可）</label>
            <${MultiSelect} values=${filters.partnerCostList} placeholder="-" options=${COST_OPTIONS}
              onChange=${function (vs) { onField('partnerCostList', vs); }} />
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">相手コスト編成（複数選択可）</label>
            <${MsMulti} values=${filters.enemyCostPairList} options=${options.enemyCostPairs}
              onChange=${function (vs) { onField('enemyCostPairList', vs); }} />
          </div>
          <${RangeInput} label="与ダメージ" minVal=${filters.dmgGivenMin} maxVal=${filters.dmgGivenMax}
            onMin=${function (v) { onField('dmgGivenMin', v); }} onMax=${function (v) { onField('dmgGivenMax', v); }} />
          <${RangeInput} label="被ダメージ" minVal=${filters.dmgTakenMin} maxVal=${filters.dmgTakenMax}
            onMin=${function (v) { onField('dmgTakenMin', v); }} onMax=${function (v) { onField('dmgTakenMax', v); }} />
          <${RangeInput} label="撃墜数" minVal=${filters.killsMin} maxVal=${filters.killsMax}
            onMin=${function (v) { onField('killsMin', v); }} onMax=${function (v) { onField('killsMax', v); }} />
          <${RangeInput} label="被撃墜数" minVal=${filters.deathsMin} maxVal=${filters.deathsMax}
            onMin=${function (v) { onField('deathsMin', v); }} onMax=${function (v) { onField('deathsMax', v); }} />
          <${RangeInput} label="スコア" minVal=${filters.scoreMin} maxVal=${filters.scoreMax}
            onMin=${function (v) { onField('scoreMin', v); }} onMax=${function (v) { onField('scoreMax', v); }} />
          <${RangeInput} label="EXダメージ" minVal=${filters.exDmgMin} maxVal=${filters.exDmgMax}
            onMin=${function (v) { onField('exDmgMin', v); }} onMax=${function (v) { onField('exDmgMax', v); }} />
          <${RangeInput} label="覚醒回数" minVal=${filters.burstsMin} maxVal=${filters.burstsMax}
            onMin=${function (v) { onField('burstsMin', v); }} onMax=${function (v) { onField('burstsMax', v); }} />
        </div>`}
      </div>

      <div class="search-form-actions">
        <span class="search-count">${resultCount}件ヒット</span>
        ${active && html`<button class="search-reset" onClick=${onReset}>条件をクリア</button>`}
      </div>
    </div>`}
  </div>`;
}

// 並べ替え中の指標を一覧カードにも小さく出すためのラベル。SORT_OPTIONSと二重管理しないよう流用する。
var METRIC_LABELS = SORT_OPTIONS.reduce(function (m, o) { m[o.key] = o.label; return m; }, {});

// 機体サムネイル。画像URLが引ければ画像、無ければ機体名テキストにフォールバック。
// フレックスアイテムはラッパー(.search-ms-slot)側にし、画像/テキストは width:100% で内側に収める。
// img自体をフレックスアイテム＋aspect-ratioにすると iOS18 Safari が min-width:0 を無視して
// 本来サイズで min-content を算出し、カードから溢れるため（iOS26では解消）。
function MsThumb({ name, msImages }) {
  var nm = (name || '').trim();
  var url = nm && msImages ? msImages[nm] : '';
  var inner = url
    ? html`<img class="search-ms-thumb" src=${url} alt=${nm} title=${nm} loading="lazy" />`
    : html`<span class="search-ms-thumb search-ms-thumb-text" title=${nm}>${esc(nm || '?')}</span>`;
  return html`<span class="search-ms-slot">${inner}</span>`;
}

// プレイヤー名を整形（空は「—」）。名前は最大12文字。
function playerName(n) {
  return (n || '').trim() || '—';
}

// 1試合分のサマリーカード（公式戦績風）。機体は画像で並べ、詳細な数値は詳細モーダルへ寄せる。
// クリックで詳細を開く。
function ResultItem({ match, msImages, sortKey, onOpen }) {
  var metricLabel = sortKey && sortKey !== 'date' ? METRIC_LABELS[sortKey] : null;
  return html`<button class="search-item" onClick=${function () { onOpen(match); }}>
    <div class="search-item-top">
      <span class=${'badge ' + (match.win ? 'win' : 'lose')}>${match.win ? 'WIN' : 'LOSE'}</span>
      ${isTimeUp(match) && html`<span class="badge-timeup" title="制限時間切れ（勝敗はスコアで決定）">タイムアップ</span>`}
      <span class="search-item-date">${esc(match.date)}</span>
      ${metricLabel && html`<span class="search-item-metric">${metricLabel} ${num(match[sortKey])}</span>`}
    </div>
    <div class="search-item-battle">
      <div class="search-ms-imgs self">
        <${MsThumb} name=${match.ms} msImages=${msImages} />
        <${MsThumb} name=${match.partner_ms} msImages=${msImages} />
      </div>
      <span class="search-item-vs" role="img" aria-label="VS"></span>
      <div class="search-ms-imgs enemy">
        <${MsThumb} name=${match.opponent1_ms} msImages=${msImages} />
        <${MsThumb} name=${match.opponent2_ms} msImages=${msImages} />
      </div>
    </div>
    <div class="search-item-namesrow">
      <div class="search-item-names self">
        <div class="search-name-line" title=${playerName(match.name)}>${esc(playerName(match.name))}</div>
        <div class="search-name-line" title=${playerName(match.partner_name)}>${esc(playerName(match.partner_name))}</div>
      </div>
      <div class="search-item-names enemy">
        <div class="search-name-line" title=${playerName(match.opponent1_name)}>${esc(playerName(match.opponent1_name))}</div>
        <div class="search-name-line" title=${playerName(match.opponent2_name)}>${esc(playerName(match.opponent2_name))}</div>
      </div>
    </div>
  </button>`;
}

// 公式「試合経過」風のガント式タイムライン（4人分・横棒）。
// 各行に機体画像＋2レーン（バースト行/オーバーリミット行）＋被撃墜×、下に時間軸。
function Timeline({ match, msImages }) {
  var rows = [
    { ms: match.ms, actions: match.actions },
    { ms: match.partner_ms, actions: match.partner_actions },
    { ms: match.opponent1_ms, actions: match.opponent1_actions },
    { ms: match.opponent2_ms, actions: match.opponent2_actions },
  ];
  // 実時間 = GameEndSec（無ければ全アクションの最大終了秒）。
  var raw = match.game_end_sec || 0;
  rows.forEach(function (r) {
    (r.actions || []).forEach(function (a) {
      raw = Math.max(raw, a.action_end_sec || 0, a.action_start_sec || 0);
    });
  });
  if (raw <= 0) {
    return html`<p class="search-detail-empty">試合経過データがありません。</p>`;
  }
  // 終盤が詰まって見えるため末尾に余白（7%）を足して描画スケールを広げる。目盛りは実終了まで。
  var total = raw * 1.07;
  function pct(sec) { return Math.max(0, Math.min(100, (sec || 0) / total * 100)); }
  function bar(a) {
    var m = GANTT_BAR[a.action];
    var left = pct(a.action_start_sec);
    var w = Math.max(0.6, pct(a.action_end_sec) - left); // 極小でも視認できる最小幅
    var barEl = html`<span class=${'gantt-bar gantt-' + m.cls} style=${'left:' + left + '%;width:' + w + '%'}></span>`;
    // 発動系は「発動の瞬間＝菱形」＋「その後の発動中＝色付きバー」の両方を描く。
    if (m.kind === 'diamond') {
      return html`${barEl}<span class=${'gantt-diamond gantt-' + m.cls} style=${'left:' + left + '%'}></span>`;
    }
    return barEl;
  }
  // 補助線＋目盛り。30秒ごとに点線の補助線、1分ごと(major)に秒数ラベル(60/120/180)を付ける。
  // 以前は10秒刻みでラベルを出しており、隣同士が重なって判読できなかった。
  var grid = [];
  for (var t = 30; t < raw; t += 30) grid.push({ sec: t, major: t % 60 === 0 });
  var labels = grid.filter(function (g) { return g.major; });

  return html`<div class="gantt">
    <div class="gantt-rows">
      <div class="gantt-grid">
        ${grid.map(function (g) {
          return html`<span class=${'gantt-gridline' + (g.major ? ' gantt-gridline-major' : '')} style=${'left:' + pct(g.sec) + '%'}></span>`;
        })}
      </div>
      ${rows.map(function (r) {
        var acts = r.actions || [];
        var lane0 = acts.filter(function (a) { return GANTT_BAR[a.action] && GANTT_BAR[a.action].lane === 0; });
        var lane1 = acts.filter(function (a) { return GANTT_BAR[a.action] && GANTT_BAR[a.action].lane === 1; });
        var deaths = acts.filter(function (a) { return a.action === 'death'; });
        return html`<div class="gantt-row">
          <${DetailThumb} name=${r.ms} msImages=${msImages} />
          <div class="gantt-track">
            <div class="gantt-lane">
              ${lane0.map(bar)}
              ${deaths.map(function (a) {
                return html`<span class="gantt-death" style=${'left:' + pct(a.action_start_sec) + '%'}>✕</span>`;
              })}
            </div>
            <div class="gantt-lane">${lane1.map(bar)}</div>
          </div>
        </div>`;
      })}
    </div>
    <div class="gantt-axis">
      ${labels.map(function (g) {
        return html`<span class="gantt-tick" style=${'left:' + pct(g.sec) + '%'}>${g.sec}</span>`;
      })}
    </div>
    <div class="gantt-legend">
      ${GANTT_LEGEND.map(function (l) {
        // OL系の手前で改行し、2行目に「OLスタンバイ / OL発動 / 被撃墜」を並べる。
        var brk = l[0] === 'ov' ? html`<span class="gantt-legend-break"></span>` : '';
        return html`${brk}<span class="gantt-legend-item"><span class=${'gantt-legend-swatch gantt-' + l[0]}></span>${l[1]}</span>`;
      })}
    </div>
  </div>`;
}

// 基本データ比較レーダーの軸（基本データ画面と同じ6指標）。スコアは基準が無いため除外。
// 正規化の重み付け(基準レンジ)は基本データ分析と同じものを stats.js の METRIC_RANGE で共有する。
var RADAR_AXES = [
  { label: '与ダメ', key: 'dmgGiven' },
  { label: '撃墜', key: 'kills' },
  { label: '覚醒', key: 'bursts' },
  { label: '被ダメ', key: 'dmgTaken' },
  { label: '被撃墜', key: 'deaths' },
  { label: 'EXダメ', key: 'exDmg' },
];
var RADAR_LABELS = RADAR_AXES.map(function (a) { return a.label; });

// 4人分のレーダー系列を作る。各軸を基本データと同じ基準(clampMetric)で0-100に正規化（絶対評価）。
function radarPlayers(match) {
  var players = [
    { label: '自分', color: '#4fc3f7', bg: 'rgba(79,195,247,.25)', raw: [match.dmg_given, match.kills, match.bursts, match.dmg_taken, match.deaths, match.ex_dmg] },
    { label: '相方', color: '#69f0ae', bg: 'rgba(105,240,174,.25)', raw: [match.partner_dmg_given, match.partner_kills, match.partner_bursts, match.partner_dmg_taken, match.partner_deaths, match.partner_ex_dmg] },
    { label: '相手1', color: '#ef5350', bg: 'rgba(239,83,80,.22)', raw: [match.opponent1_dmg_given, match.opponent1_kills, match.opponent1_bursts, match.opponent1_dmg_taken, match.opponent1_deaths, match.opponent1_ex_dmg] },
    { label: '相手2', color: '#ffca28', bg: 'rgba(255,202,40,.22)', raw: [match.opponent2_dmg_given, match.opponent2_kills, match.opponent2_bursts, match.opponent2_dmg_taken, match.opponent2_deaths, match.opponent2_ex_dmg] },
  ];
  players.forEach(function (p) {
    p.data = p.raw.map(function (v, a) { return clampMetric(v, RADAR_AXES[a].key); });
  });
  return players;
}

// 詳細モーダルの列見出し用の機体サムネイル（固定サイズ）。画像が無ければ機体名テキスト。
function DetailThumb({ name, msImages }) {
  var nm = (name || '').trim();
  var url = nm && msImages ? msImages[nm] : '';
  if (url) {
    return html`<img class="search-detail-thumb" src=${url} alt=${nm} title=${nm} loading="lazy" />`;
  }
  return html`<span class="search-detail-thumb search-detail-thumb-text" title=${nm}>${esc(nm || '?')}</span>`;
}

// 試合詳細モーダル。
function DetailModal({ match, msImages, onClose }) {
  useEffect(function () {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    // モーダル表示中は背景（body/html）のスクロールを止める。
    var prevBody = document.body.style.overflow;
    var prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return function () {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // 試合経過は既定で畳む（スマホで閉じる×のスペースに余裕を持たせる）。
  var tlOpenRef = useState(false);
  var tlOpen = tlOpenRef[0], setTlOpen = tlOpenRef[1];

  // レーダー: 4人分の系列とトグルによる表示切替（既定は自分＋相方＝自陣）。
  var players = useMemo(function () { return radarPlayers(match); }, [match]);
  var checkedRef = useState([true, true, false, false]);
  var checked = checkedRef[0], setChecked = checkedRef[1];
  var series = useMemo(function () {
    return players.map(function (p, i) {
      return { label: p.label, data: p.data, color: p.color, bg: p.bg, hidden: !checked[i] };
    });
  }, [players, checked]);
  function toggle(i) {
    setChecked(function (prev) { var next = prev.slice(); next[i] = !next[i]; return next; });
  }

  // 4人分の機体（自分・相方・敵1・敵2）。列見出しの画像に使う。自陣/敵陣は列位置(index 2)の区切り線で示す。
  var cols = [match.ms, match.partner_ms, match.opponent1_ms, match.opponent2_ms];
  // 公式「スコア」画面と同じ項目（覚醒回数は試合経過側で表示するため含めない）。
  // color は分析画面と同じ色分け関数。スコアは基準が無いため色分けしない。
  var rows = [
    { label: 'スコア', vals: [match.score, match.partner_score, match.opponent1_score, match.opponent2_score], color: null },
    { label: '撃墜', vals: [match.kills, match.partner_kills, match.opponent1_kills, match.opponent2_kills], color: colorKillsInt },
    { label: '被撃墜', vals: [match.deaths, match.partner_deaths, match.opponent1_deaths, match.opponent2_deaths], color: colorDeathsInt },
    { label: '与ダメージ', vals: [match.dmg_given, match.partner_dmg_given, match.opponent1_dmg_given, match.opponent2_dmg_given], color: colorDmgGiven },
    { label: '被ダメージ', vals: [match.dmg_taken, match.partner_dmg_taken, match.opponent1_dmg_taken, match.opponent2_dmg_taken], color: colorDmgTaken },
    { label: 'EXダメージ', vals: [match.ex_dmg, match.partner_ex_dmg, match.opponent1_ex_dmg, match.opponent2_ex_dmg], color: colorExDmg },
  ];

  return html`<div class="modal-backdrop" onClick=${function (e) { if (e.target === e.currentTarget) onClose(); }}>
    <div class="search-detail">
      <div class="search-detail-head">
        <div>
          <span class=${'badge ' + (match.win ? 'win' : 'lose')}>${match.win ? 'WIN' : 'LOSE'}</span>
          ${isTimeUp(match) && html`<span class="badge-timeup" title="制限時間切れ（勝敗はスコアで決定）">タイムアップ</span>`}
          <span class="search-detail-date">${esc(match.date)}</span>
        </div>
        <button class="search-detail-close" onClick=${onClose} aria-label="閉じる">✕</button>
      </div>

      <div class="search-radar-toggles">
        ${players.map(function (p, i) {
          return html`<button type="button" class=${'search-radar-toggle' + (checked[i] ? '' : ' off')}
            onClick=${function () { toggle(i); }} aria-pressed=${checked[i]}>
            <span class="search-radar-swatch" style=${'background:' + p.color}></span>
            <${DetailThumb} name=${cols[i]} msImages=${msImages} />
          </button>`;
        })}
      </div>
      <${CompareRadar} labels=${RADAR_LABELS} series=${series} showLegend=${false} />

      <div class="table-wrap"><table class="search-detail-table">
        <thead><tr>
          <th></th>
          ${cols.map(function (ms, i) {
            return html`<th class=${'num search-detail-col' + (i === 2 ? ' team-sep' : '')}>
              <${DetailThumb} name=${ms} msImages=${msImages} />
            </th>`;
          })}
        </tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return html`<tr><th>${r.label}</th>${r.vals.map(function (v, i) {
              // 分析画面と同じ色分け関数を通す（cellDisplayが色付きspanを返す）。基準の無いスコアはそのまま。
              var content = r.color ? cellDisplay(r.color(v)) : num(v);
              return html`<td class=${'num' + (i === 2 ? ' team-sep' : '')}>${content}</td>`;
            })}</tr>`;
          })}
        </tbody>
      </table></div>

      <button type="button" class=${'search-detail-tl-toggle' + (tlOpen ? ' open' : '')}
        onClick=${function () { setTlOpen(!tlOpen); }} aria-expanded=${tlOpen}>
        <span class="search-detail-tl-title">試合経過</span>
        <span class="search-chevron" aria-hidden="true"></span>
      </button>
      ${tlOpen && html`<${Timeline} match=${match} msImages=${msImages} />`}
    </div>
  </div>`;
}

// 並べ替えコントロール。ソートアイコン付きのカスタムドロップダウン（項目選択）＋昇順/降順アイコン。
// native selectの浮いた見た目を避け、外側クリックで閉じる。
function SortControl({ sortKey, desc, onSortKey, onToggleDir }) {
  var openRef = useState(false);
  var open = openRef[0], setOpen = openRef[1];
  var ref = useRef(null);
  useEffect(function () {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return function () { document.removeEventListener('mousedown', onDoc); };
  }, [open]);
  var current = SORT_OPTIONS.find(function (o) { return o.key === sortKey; }) || SORT_OPTIONS[0];

  return html`<div class="search-sort" ref=${ref}>
    <div class="search-sort-dd">
      <button type="button" class=${'search-sort-trigger' + (open ? ' open' : '')}
        onClick=${function () { setOpen(!open); }} aria-expanded=${open}
        aria-label=${'並べ替え: ' + current.label} title=${'並べ替え: ' + current.label}>
        <svg class="search-sort-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h12v2H3v-2zm0 5h6v2H3v-2z"/></svg>
      </button>
      ${open && html`<div class="search-sort-menu">
        ${SORT_OPTIONS.map(function (o) {
          return html`<button type="button" class=${'search-sort-opt' + (o.key === sortKey ? ' active' : '')}
            onClick=${function () { onSortKey(o.key); setOpen(false); }}>${o.label}</button>`;
        })}
      </div>`}
    </div>
    <button type="button" class="search-dir" onClick=${onToggleDir}
      aria-label=${desc ? '降順（クリックで昇順）' : '昇順（クリックで降順）'} title=${desc ? '降順' : '昇順'}>
      <svg class="search-dir-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d=${desc ? 'M12 16l-6-6h12z' : 'M12 8l6 6H6z'} />
      </svg>
    </button>
  </div>`;
}

// 試合検索ビュー本体。matches はIndexedDBから読み込んだ全試合。
export function SearchView({ matches, msImages }) {
  var filtersRef = useState(emptyFilters);
  var filters = filtersRef[0], setFilters = filtersRef[1];
  var sortRef = useState('date');
  var sortKey = sortRef[0], setSortKey = sortRef[1];
  var descRef = useState(true);
  var desc = descRef[0], setDesc = descRef[1];
  var pageRef = useState(1);
  var page = pageRef[0], setPage = pageRef[1];
  var pageSizeRef = useState(PAGE_SIZE);
  var pageSize = pageSizeRef[0], setPageSize = pageSizeRef[1];
  var detailRef = useState(null);
  var detail = detailRef[0], setDetail = detailRef[1];

  var options = useMemo(function () { return collectMsOptions(matches); }, [matches]);

  var filtered = useMemo(function () {
    // 期間プリセット（直近Nプレイ日）はレポートと同じ filterByPlayDays で先に絞る。
    var base = filters.playDays && PERIOD_DAYS[filters.playDays]
      ? filterByPlayDays(matches, PERIOD_DAYS[filters.playDays])
      : matches;
    return sortMatches(filterMatches(base, filters), sortKey, desc);
  }, [matches, filters, sortKey, desc]);

  // 条件・並び順の変更時は1ページ目に戻す（各操作ハンドラで明示的にリセット）。
  function onField(key, value) {
    setFilters(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = value;
      return next;
    });
    setPage(1);
  }
  function onReset() { setFilters(emptyFilters()); setPage(1); }
  function onSortKey(key) { setSortKey(key); setPage(1); }
  function onToggleDir() { setDesc(!desc); setPage(1); }

  var total = filtered.length;
  var wins = filtered.reduce(function (n, m) { return n + (m.win ? 1 : 0); }, 0);
  var winRate = total ? Math.round(wins / total * 1000) / 10 : 0;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var curPage = Math.min(page, totalPages);
  var start = (curPage - 1) * pageSize;
  var pageItems = filtered.slice(start, start + pageSize);
  function onPageSize(n) { setPageSize(n); setPage(1); }

  return html`<div class="search-view">
    <${FilterForm} filters=${filters} options=${options}
      onField=${onField} onReset=${onReset} resultCount=${total} />

    <div class="panel">
      <div class="search-result-head">
        <h2><span class="dot" /><span class="search-result-label">検索結果 </span><span class="search-result-count">${total}戦（${winRate.toFixed(1)}%）</span></h2>
        <div class="search-result-tools">
          <div class="search-pagesize">
            <${Dropdown} value=${String(pageSize)} noClear=${true}
              options=${[10, 20, 50, 100, 200].map(function (n) { return { value: String(n), label: n + '件' }; })}
              onChange=${function (v) { onPageSize(Number(v)); }} />
          </div>
          <${SortControl} sortKey=${sortKey} desc=${desc} onSortKey=${onSortKey} onToggleDir=${onToggleDir} />
        </div>
      </div>

      ${total === 0
        ? html`<p class="search-empty">条件に一致する試合がありません。</p>`
        : html`<div class="search-list">
            ${pageItems.map(function (m) {
              return html`<${ResultItem} match=${m} msImages=${msImages || {}} sortKey=${sortKey} onOpen=${setDetail} />`;
            })}
          </div>`}

      ${totalPages > 1 && html`<div class="search-pager">
        <button class="search-page-btn" disabled=${curPage <= 1}
          onClick=${function () { setPage(curPage - 1); }}>← 前へ</button>
        <span class="search-page-info">${start + 1}〜${Math.min(start + pageSize, total)} / ${total}件（${curPage}/${totalPages}）</span>
        <button class="search-page-btn" disabled=${curPage >= totalPages}
          onClick=${function () { setPage(curPage + 1); }}>次へ →</button>
      </div>`}
    </div>

    ${detail && html`<${DetailModal} match=${detail} msImages=${msImages || {}} onClose=${function () { setDetail(null); }} />`}
  </div>`;
}

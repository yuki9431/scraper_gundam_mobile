import { html, useState, useMemo, useRef, useEffect } from '../htm-preact-standalone.js';
import { boldText, cellValue, cellDisplay, esc } from '../lib/format.js';

export function Tips({ tips }) {
  if (!tips || !tips.length) return null;
  return html`<blockquote><strong>💡アドバイス:</strong><br />${tips.map(function (t, i) {
    var text = typeof t === 'string' ? t : t.text;
    var details = typeof t === 'object' && t.details ? t.details : null;
    return html`${i > 0 && html`<br />`}${boldText(text)}
      ${details && html`<ul class="advice-details">${details.map(function (d) { return html`<li>${boldText(d)}</li>`; })}</ul>`}`;
  })}</blockquote>`;
}

export function SortableTable({ headers, rows, sortableColumns, defaultLimit }) {
  if (!rows || !rows.length) return null;
  var sortRef = useState({ col: -1, asc: true });
  var sortState = sortRef[0], setSortState = sortRef[1];
  var limitRef = useState(defaultLimit || 0);
  var limit = limitRef[0], setLimit = limitRef[1];

  var sortedRows = useMemo(function () {
    if (sortState.col < 0) return rows;
    var col = sortState.col;
    var sorted = rows.slice().sort(function (a, b) {
      var va = cellValue(a[col]), vb = cellValue(b[col]);
      var na = typeof va === 'number' ? va : parseFloat(String(va).replace(/[%+戦件回]/g, ''));
      var nb = typeof vb === 'number' ? vb : parseFloat(String(vb).replace(/[%+戦件回]/g, ''));
      if (!isNaN(na) && !isNaN(nb)) {
        return sortState.asc ? na - nb : nb - na;
      }
      var sa = String(cellValue(a[col])), sb = String(cellValue(b[col]));
      return sortState.asc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return sorted;
  }, [rows, sortState]);

  var displayRows = limit > 0 ? sortedRows.slice(0, limit) : sortedRows;
  var hasMore = limit > 0 && sortedRows.length > limit;

  function handleSort(colIdx) {
    if (sortState.col === colIdx) {
      if (colIdx === 0 && !sortState.asc) {
        setSortState({ col: -1, asc: true });
      } else {
        setSortState({ col: colIdx, asc: !sortState.asc });
      }
    } else {
      setSortState({ col: colIdx, asc: colIdx === 0 ? true : false });
    }
  }

  var sortable = sortableColumns || [];

  return html`<div>
    <div class="table-wrap"><table>
      <thead><tr>${headers.map(function (h, i) {
        var isSortable = h !== '' && (sortable.length === 0 || sortable.indexOf(i) >= 0);
        var indicator = sortState.col === i ? (sortState.asc ? ' ▲' : ' ▼') : (isSortable ? ' ▽' : '');
        return html`<th class=${isSortable ? 'sortable' : ''} onClick=${isSortable ? function () { handleSort(i); } : undefined}>${h}${indicator}</th>`;
      })}</tr></thead>
      <tbody>${displayRows.map(function (row) {
        return html`<tr>${row.map(function (cell) { return html`<td>${cellDisplay(cell)}</td>`; })}</tr>`;
      })}</tbody>
    </table></div>
    ${defaultLimit > 0 && sortedRows.length > defaultLimit && html`<div class="show-more-wrap">
      ${hasMore
        ? html`<button class="show-more-btn" onClick=${function () { setLimit(0); }}>もっと見る (+${sortedRows.length - limit}件)</button>`
        : html`<button class="show-more-btn" onClick=${function () { setLimit(defaultLimit); }}>折りたたむ</button>`}
    </div>`}
  </div>`;
}

export function Table({ headers, rows }) {
  if (!rows || !rows.length) return null;
  return html`<${SortableTable} headers=${headers} rows=${rows} />`;
}

export function SubSection({ title, open, children }) {
  return html`<details ...${{ open: open || false }}>
    <summary>${title}</summary>
    ${children}
  </details>`;
}

// --- 範囲カレンダー（開始日〜終了日を2クリックで選択） ---
var DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// startDate/endDate は 'YYYY-MM-DD' 文字列。onSelectStart/onSelectEnd で親に通知する。
export function RangeCalendar({ startDate, endDate, onSelectStart, onSelectEnd }) {
  var init = startDate ? new Date(startDate) : new Date();
  var viewRef = useState({ year: init.getFullYear(), month: init.getMonth() });
  var view = viewRef[0], setView = viewRef[1];
  var phaseRef = useState(startDate ? (endDate ? 'done' : 'end') : 'start');
  var phase = phaseRef[0], setPhase = phaseRef[1];

  function prevMonth() {
    setView(function (v) {
      var m = v.month - 1;
      return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
    });
  }
  function nextMonth() {
    setView(function (v) {
      var m = v.month + 1;
      return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
    });
  }

  var firstDay = new Date(view.year, view.month, 1).getDay();
  var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  var cells = [];
  for (var i = 0; i < firstDay; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  function toStr(day) {
    return view.year + '-' + String(view.month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function handleClick(day) {
    if (!day) return;
    var s = toStr(day);
    if (phase === 'start' || phase === 'done') {
      onSelectStart(s);
      onSelectEnd('');
      setPhase('end');
    } else {
      if (s < startDate) {
        onSelectStart(s);
        onSelectEnd('');
      } else {
        onSelectEnd(s);
        setPhase('done');
      }
    }
  }

  function dayClass(day) {
    if (!day) return '';
    var s = toStr(day);
    var cls = 'cal-day';
    if (s === startDate || s === endDate) cls += ' selected';
    else if (startDate && endDate && s > startDate && s < endDate) cls += ' in-range';
    return cls;
  }

  var hint = phase === 'start' || phase === 'done' ? '▶ 開始日を選択' : '▶ 終了日を選択';

  return html`<div class="cal">
    <div class="cal-header">
      <button class="cal-nav" onClick=${prevMonth}>◀</button>
      <span class="cal-title">${view.year}年${view.month + 1}月</span>
      <button class="cal-nav" onClick=${nextMonth}>▶</button>
    </div>
    <div style="text-align:center;font-size:0.8em;color:var(--accent);margin-bottom:4px">${hint}</div>
    <div class="cal-grid">
      ${DOW_LABELS.map(function (d) { return html`<span class="cal-dow">${d}</span>`; })}
      ${cells.map(function (day) {
        if (!day) return html`<span class="cal-empty" />`;
        return html`<button class=${dayClass(day)}
          onClick=${function () { handleClick(day); }}>${day}</button>`;
      })}
    </div>
  </div>`;
}

// --- 汎用カスタムドロップダウン（レポート画面の .panel-select-* スタイル） ---
// options は [{value, label}]。value===placeholder用の空値('')は先頭のクリア項目として自動追加する。
// 項目が多い(8件超)ときは検索ボックスを出し、ラベル部分一致で絞り込める。
var DROPDOWN_SEARCH_THRESHOLD = 8;

export function Dropdown({ value, options, onChange, placeholder, noClear }) {
  var openRef = useState(false);
  var isOpen = openRef[0], setIsOpen = openRef[1];
  var queryRef = useState('');
  var query = queryRef[0], setQuery = queryRef[1];
  var ref = useRef(null);
  var inputRef = useRef(null);

  function close() { setIsOpen(false); setQuery(''); }

  useEffect(function () {
    if (!isOpen) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) close(); }
    document.addEventListener('click', onDoc, true);
    if (inputRef.current) inputRef.current.focus();
    return function () { document.removeEventListener('click', onDoc, true); };
  }, [isOpen]);

  var ph = placeholder || '-';
  var current = options.find(function (o) { return o.value === value; });
  var label = current ? current.label : ph;

  function pick(v) { onChange(v); close(); }

  var showSearch = options.length > DROPDOWN_SEARCH_THRESHOLD;
  var q = query.trim().toLowerCase();
  var filtered = q ? options.filter(function (o) { return String(o.label).toLowerCase().indexOf(q) >= 0; }) : options;

  return html`<div class="panel-select-wrap" ref=${ref}>
    <button type="button" class="panel-select-trigger" aria-expanded=${isOpen}
      onClick=${function () { isOpen ? close() : setIsOpen(true); }}>
      <span class="panel-select-label">${esc(label)}</span>
      <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="panel-select-dropdown">
      ${showSearch && html`<input type="text" class="panel-select-search" ref=${inputRef}
        placeholder="絞り込み..." value=${query}
        onInput=${function (e) { setQuery(e.target.value); }} />`}
      ${!q && !noClear && html`<button type="button" class=${'panel-select-item' + (value === '' ? ' active' : '')}
        onClick=${function () { pick(''); }}>${ph}</button>`}
      ${filtered.map(function (o) {
        return html`<button type="button" class=${'panel-select-item' + (o.value === value ? ' active' : '')}
          onClick=${function () { pick(o.value); }}>${esc(o.label)}</button>`;
      })}
      ${q && !filtered.length && html`<div class="panel-select-empty">該当なし</div>`}
    </div>`}
  </div>`;
}

// --- 複数選択ドロップダウン（.panel-select-* スタイル。項目内AND/ORは呼び出し側で扱う） ---
// values は選択済み value の配列。options は [{value,label}]。トグルで追加/削除する。
export function MultiSelect({ values, options, onChange, placeholder }) {
  var openRef = useState(false);
  var isOpen = openRef[0], setIsOpen = openRef[1];
  var queryRef = useState('');
  var query = queryRef[0], setQuery = queryRef[1];
  var ref = useRef(null);
  var inputRef = useRef(null);
  var sel = values || [];

  function close() { setIsOpen(false); setQuery(''); }
  useEffect(function () {
    if (!isOpen) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) close(); }
    document.addEventListener('click', onDoc, true);
    if (inputRef.current) inputRef.current.focus();
    return function () { document.removeEventListener('click', onDoc, true); };
  }, [isOpen]);

  function toggle(v) {
    onChange(sel.indexOf(v) >= 0 ? sel.filter(function (x) { return x !== v; }) : sel.concat([v]));
  }

  // トリガー表示は chip（無ければ label）。ドロップダウン内は label（対戦数付き等）を使う。
  var chipOf = function (v) { var o = options.find(function (o) { return o.value === v; }); return o ? (o.chip || o.label) : v; };
  var triggerLabel = sel.length ? sel.map(chipOf).join('、') : (placeholder || '-');
  var showSearch = options.length > DROPDOWN_SEARCH_THRESHOLD;
  var q = query.trim().toLowerCase();
  var filtered = q ? options.filter(function (o) { return String(o.label).toLowerCase().indexOf(q) >= 0; }) : options;

  return html`<div class="panel-select-wrap" ref=${ref}>
    <button type="button" class="panel-select-trigger" aria-expanded=${isOpen}
      onClick=${function () { isOpen ? close() : setIsOpen(true); }}>
      <span class="panel-select-label">${esc(triggerLabel)}</span>
      <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="panel-select-dropdown">
      ${showSearch && html`<input type="text" class="panel-select-search" ref=${inputRef}
        placeholder="絞り込み..." value=${query} onInput=${function (e) { setQuery(e.target.value); }} />`}
      ${filtered.map(function (o) {
        var on = sel.indexOf(o.value) >= 0;
        return html`<button type="button" class=${'panel-select-item' + (on ? ' active' : '')}
          onClick=${function () { toggle(o.value); }}>
          <span>${esc(o.label)}</span><span class="panel-select-check">${on ? '✓' : ''}</span>
        </button>`;
      })}
      ${q && !filtered.length && html`<div class="panel-select-empty">該当なし</div>`}
    </div>`}
  </div>`;
}

// --- テキスト入力＋自前の候補ドロップダウン（部分一致・入力直下に表示） ---
// options は候補文字列の配列。入力が空のときは候補を出さない。
export function Autocomplete({ value, onChange, options, placeholder }) {
  var openRef = useState(false);
  var open = openRef[0], setOpen = openRef[1];
  var ref = useRef(null);
  useEffect(function () {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('click', onDoc, true);
    return function () { document.removeEventListener('click', onDoc, true); };
  }, [open]);

  var q = (value || '').trim().toLowerCase();
  var matches = q
    ? (options || []).filter(function (o) { return String(o).toLowerCase().indexOf(q) >= 0; }).slice(0, 30)
    : [];
  var showMenu = open && q && matches.length > 0;

  return html`<div class="search-ac" ref=${ref}>
    <input type="text" class="search-text" placeholder=${placeholder} value=${value}
      onInput=${function (e) { onChange(e.target.value); setOpen(true); }}
      onFocus=${function () { setOpen(true); }} />
    ${showMenu && html`<div class="search-ac-menu">
      ${matches.map(function (m) {
        return html`<button type="button" class="search-ac-item"
          onClick=${function () { onChange(m); setOpen(false); }}>${esc(m)}</button>`;
      })}
    </div>`}
  </div>`;
}

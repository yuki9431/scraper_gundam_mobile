import { html } from '../htm-preact-standalone.js';

export function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function boldText(s) {
  if (s == null) return '';
  var parts = String(s).split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map(function (part, i) {
    return i % 2 === 1 ? html`<strong class="tip-bold">${part}</strong>` : part;
  });
}

export function pct(n) { return n != null ? n.toFixed(1) + '%' : '-'; }
export function num(n, d) { return n != null ? n.toFixed(d != null ? d : 0) : '-'; }

// 試合の制限時間（秒）。この時間まで経過した試合はタイムアップとなり、勝敗はスコアで決まる。
export var TIMEUP_SEC = 240;

// タイムアップ（制限時間切れ）で決着した試合か。game_end_secが制限時間に達していれば真。
// 勝敗自体は既に正しく判定済みで、これは表示用の付加情報。
export function isTimeUp(match) {
  return !!(match && match.game_end_sec != null && match.game_end_sec >= TIMEUP_SEC);
}

function valClass4(n, great, good, bad, terrible, higherIsBetter) {
  if (n == null) return '';
  if (higherIsBetter) {
    if (n >= great) return 'val-great';
    if (n >= good) return 'val-good';
    if (n <= terrible) return 'val-terrible';
    return 'val-bad';
  } else {
    if (n <= great) return 'val-great';
    if (n <= good) return 'val-good';
    if (n >= terrible) return 'val-terrible';
    return 'val-bad';
  }
}

function colorVal(n, great, good, bad, terrible, higherIsBetter, decimals) {
  if (n == null) return '-';
  var cls = valClass4(n, great, good, bad, terrible, higherIsBetter);
  var text = n.toFixed(decimals != null ? decimals : 0);
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

export function colorPct(n) {
  if (n == null) return '-';
  var cls = valClass4(n, 60, 50, 50, 40, true);
  var text = n.toFixed(1) + '%';
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

export function colorDE(n, d) {
  if (n == null) return '-';
  var cls = valClass4(n, 1.2, 1.0, 1.0, 0.8, true);
  var text = n.toFixed(d != null ? d : 3);
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

export function colorDmgGiven(n) { return colorVal(n, 1100, 900, 900, 700, true, 0); }
export function colorDmgTaken(n) { return colorVal(n, 700, 800, 800, 900, false, 0); }
// 撃墜/被撃墜のしきい値[great,good,bad,terrible]。平均用(小数2桁)と単発試合用(整数)で共有する。
var KILLS_T = [1.8, 1.5, 1.5, 1.0];
var DEATHS_T = [1.0, 1.5, 1.5, 2.5];
export function colorKills(n) { return colorVal(n, KILLS_T[0], KILLS_T[1], KILLS_T[2], KILLS_T[3], true, 2); }
export function colorDeaths(n) { return colorVal(n, DEATHS_T[0], DEATHS_T[1], DEATHS_T[2], DEATHS_T[3], false, 2); }
// 整数表示版（単発試合のスコア表など。色分けは同じ、小数点なし）
export function colorKillsInt(n) { return colorVal(n, KILLS_T[0], KILLS_T[1], KILLS_T[2], KILLS_T[3], true, 0); }
export function colorDeathsInt(n) { return colorVal(n, DEATHS_T[0], DEATHS_T[1], DEATHS_T[2], DEATHS_T[3], false, 0); }
export function colorKD(n) { return colorVal(n, 1.5, 1.0, 1.0, 0.6, true, 2); }
export function colorExDmg(n) { return colorVal(n, 200, 160, 160, 100, true, 0); }
export function colorBursts(n) { return colorVal(n, 2.0, 1.5, 1.5, 1.0, true, 2); }

export function cellValue(cell) {
  return cell != null && typeof cell === 'object' && cell.sortValue != null ? cell.sortValue : cell;
}

export function cellDisplay(cell) {
  return cell != null && typeof cell === 'object' && cell.display != null ? cell.display : cell;
}

export var SVG_X = '<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
export var SVG_BSKY = '<svg viewBox="0 0 568 501"><path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.889-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.659 0 75.291 0 57.946 0-28.906 76.135-1.612 123.121 33.664z"/></svg>';
export var SVG_LINE = '<svg viewBox="0 0 24 24"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>';
export var SVG_COPY = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
export var SVG_CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

export function buildShareText(items) {
  var lines = ['【EXVS2IB 戦績診断】'];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.type === 'top_ms') {
      lines.push('🤖 最多使用: ' + item.ms + '（' + item.count + '戦）');
    } else if (item.type === 'strong_enemy') {
      lines.push('💪 ' + item.enemy + '相手に勝率' + item.wr + '%！');
    } else if (item.type === 'weak_enemy') {
      lines.push('😈 ' + item.enemy + 'に勝率' + item.wr + '%...天敵かも');
    } else if (item.type === 'dmg_efficiency') {
      var desc = item.value >= 1.0 ? '与ダメが上回ってます' : '被ダメが上回ってます';
      lines.push('⚔ ' + item.ms + 'の与被ダメ比: ' + item.value + '（' + desc + '）');
    }
  }
  lines.push('');
  lines.push('▶ 自分も診断してみる');
  lines.push(location.origin);
  return lines.join('\n');
}

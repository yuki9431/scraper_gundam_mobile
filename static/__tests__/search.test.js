import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  emptyFilters, hasActiveFilters, collectMsOptions,
  filterMatches, sortMatches, SORT_OPTIONS,
} from '../analysis/search.js';

function makeMatch(overrides) {
  return Object.assign({
    date: '2025-06-15 14:30',
    win: true,
    ms: 'ガンダム',
    ms_cost: 3000,
    dmg_given: 1000,
    dmg_taken: 800,
    kills: 2,
    deaths: 1,
    ex_dmg: 150,
    score: 500,
    bursts: 2,
    actions: [],
    partner_actions: [],
    partner_ms: 'ザク',
    partner_cost: 2000,
    partner_name: 'パートナー',
    opponent1_ms: 'シャアザク',
    opponent2_ms: 'ゲルググ',
  }, overrides);
}

describe('emptyFilters / hasActiveFilters', function () {
  it('empty filters are not active', function () {
    assert.equal(hasActiveFilters(emptyFilters()), false);
  });
  it('detects a set result filter', function () {
    var f = emptyFilters();
    f.result = 'win';
    assert.equal(hasActiveFilters(f), true);
  });
  it('detects a set text/number filter', function () {
    var f = emptyFilters();
    f.myMsList = ['ガンダム'];
    assert.equal(hasActiveFilters(f), true);
    var g = emptyFilters();
    g.dmgGivenMin = 500;
    assert.equal(hasActiveFilters(g), true);
  });
});

describe('collectMsOptions', function () {
  it('tallies mine/partners/enemies by frequency', function () {
    var matches = [
      makeMatch({ ms: 'A', partner_ms: 'P1', opponent1_ms: 'E1', opponent2_ms: 'E2' }),
      makeMatch({ ms: 'A', partner_ms: 'P2', opponent1_ms: 'E1', opponent2_ms: 'E3' }),
      makeMatch({ ms: 'B', partner_ms: 'P1', opponent1_ms: 'E1', opponent2_ms: '' }),
    ];
    var opts = collectMsOptions(matches);
    assert.equal(opts.mine[0].name, 'A');
    assert.equal(opts.mine[0].matches, 2);
    // E1 appears in all 3 matches → most frequent enemy
    assert.equal(opts.enemies[0].name, 'E1');
    assert.equal(opts.enemies[0].matches, 3);
    // empty opponent2 in third match is ignored
    var names = opts.enemies.map(function (e) { return e.name; });
    assert.equal(names.indexOf(''), -1);
  });
  it('counts a mirror matchup (same ms on both opponents) once per match', function () {
    var matches = [
      makeMatch({ opponent1_ms: 'ザクII', opponent2_ms: 'ザクII' }),
      makeMatch({ opponent1_ms: 'ザクII', opponent2_ms: 'グフ' }),
    ];
    var opts = collectMsOptions(matches);
    var zaku = opts.enemies.find(function (e) { return e.name === 'ザクII'; });
    // 1試合目で2回出現するが、試合数としては2（各試合1回）
    assert.equal(zaku.matches, 2);
  });
  it('handles empty input', function () {
    var opts = collectMsOptions([]);
    assert.deepEqual(opts, { mine: [], partners: [], enemies: [], myTags: [], enemyCostPairs: [], playerNames: [], enemyTags: [] });
  });
  it('orders enemyCostPairs by cost descending (not by match count)', function () {
    var matches = [
      makeMatch({ opponent1_cost: 2000, opponent2_cost: 2000 }),
      makeMatch({ opponent1_cost: 2000, opponent2_cost: 2000 }),
      makeMatch({ opponent1_cost: 3000, opponent2_cost: 2500 }),
    ];
    var opts = collectMsOptions(matches);
    // 対戦数は 2000+2000 の方が多いが、コスト降順で 3000+2500 が先
    assert.equal(opts.enemyCostPairs[0].name, '3000 + 2500');
    assert.equal(opts.enemyCostPairs[1].name, '2000 + 2000');
  });
  it('tallies own team (myTags) from team_name only', function () {
    var matches = [
      makeMatch({ team_name: 'アルファ', opponent_team_name: 'ブラボー' }),
      makeMatch({ team_name: 'アルファ', opponent_team_name: 'チャーリー' }),
      makeMatch({ team_name: '', opponent_team_name: '' }),
    ];
    var opts = collectMsOptions(matches);
    // 自陣アルファが2試合で最頻。敵陣タッグ(ブラボー等)は myTags に含まない
    assert.equal(opts.myTags[0].name, 'アルファ');
    assert.equal(opts.myTags[0].matches, 2);
    var names = opts.myTags.map(function (t) { return t.name; });
    assert.equal(names.indexOf('ブラボー'), -1);
    assert.equal(names.indexOf(''), -1);
  });
});

describe('filterMatches', function () {
  var matches = [
    makeMatch({ date: '2025-06-10 10:00', ms: 'ガンダム', win: true, dmg_given: 1200, dmg_taken: 600, kills: 3, deaths: 0, partner_ms: 'ザク', opponent1_ms: 'X', opponent2_ms: 'Y' }),
    makeMatch({ date: '2025-06-15 12:00', ms: 'ズゴック', win: false, dmg_given: 700, dmg_taken: 1100, kills: 1, deaths: 2, partner_ms: 'グフ', opponent1_ms: 'Y', opponent2_ms: 'Z' }),
    makeMatch({ date: '2025-06-20 20:00', ms: 'ガンダム', win: true, dmg_given: 900, dmg_taken: 900, kills: 2, deaths: 1, partner_ms: 'ザク', opponent1_ms: 'Z', opponent2_ms: 'X' }),
  ];

  it('returns all with empty filters', function () {
    assert.equal(filterMatches(matches, emptyFilters()).length, 3);
  });
  it('filters by date range (inclusive, date-only)', function () {
    var f = emptyFilters(); f.dateFrom = '2025-06-15'; f.dateTo = '2025-06-20';
    var r = filterMatches(matches, f);
    assert.equal(r.length, 2);
    assert.equal(r[0].date, '2025-06-15 12:00');
  });
  it('filters by my ms', function () {
    var f = emptyFilters(); f.myMsList = ['ガンダム'];
    assert.equal(filterMatches(matches, f).length, 2);
  });
  it('filters by partner ms', function () {
    var f = emptyFilters(); f.partnerMsList = ['グフ'];
    assert.equal(filterMatches(matches, f).length, 1);
  });
  it('filters by enemy ms multi-select (OR: any selected among opponents)', function () {
    var f = emptyFilters(); f.enemyMsList = ['Y']; f.enemyMsMode = 'or';
    assert.equal(filterMatches(matches, f).length, 2);
    // Y または Z のどちらかが相手にいる試合（全3件）
    var f2 = emptyFilters(); f2.enemyMsList = ['Y', 'Z']; f2.enemyMsMode = 'or';
    assert.equal(filterMatches(matches, f2).length, 3);
  });
  it('filters by enemy ms multi-select (AND: enemy composition, all present)', function () {
    var ms = [
      makeMatch({ opponent1_ms: 'ターンX', opponent2_ms: 'アリュゼウス' }),
      makeMatch({ opponent1_ms: 'アリュゼウス', opponent2_ms: 'ターンX' }), // 順不同で同編成
      makeMatch({ opponent1_ms: 'ターンX', opponent2_ms: 'ザク' }),
    ];
    var f = emptyFilters(); f.enemyMsList = ['ターンX', 'アリュゼウス']; f.enemyMsMode = 'and';
    // 両方そろっている試合のみ（順不同OK）＝2件
    assert.equal(filterMatches(ms, f).length, 2);
  });
  it('filters by player name scope (ally / enemy / both)', function () {
    var ms = [
      makeMatch({ partner_name: 'シャア', opponent1_name: '敵A', opponent2_name: '敵B' }),
      makeMatch({ partner_name: '相方X', opponent1_name: 'シャア', opponent2_name: '敵C' }),
    ];
    // both: 相方でも相手でもヒット → 2件
    var both = emptyFilters(); both.playerName = 'シャア';
    assert.equal(filterMatches(ms, both).length, 2);
    // ally: 相方名のみ → 1件目
    var ally = emptyFilters(); ally.playerName = 'シャア'; ally.playerNameScope = 'ally';
    assert.equal(filterMatches(ms, ally).length, 1);
    assert.equal(filterMatches(ms, ally)[0].partner_name, 'シャア');
    // enemy: 相手名のみ → 2件目
    var enemy = emptyFilters(); enemy.playerName = 'シャア'; enemy.playerNameScope = 'enemy';
    assert.equal(filterMatches(ms, enemy).length, 1);
    assert.equal(filterMatches(ms, enemy)[0].opponent1_name, 'シャア');
  });
  it('filters by player name (partner or enemy, partial, case-insensitive)', function () {
    var ms = [
      makeMatch({ partner_name: 'ガンダムマスター', opponent1_name: '敵A', opponent2_name: '敵B' }),
      makeMatch({ partner_name: 'Red Comet', opponent1_name: 'シャア', opponent2_name: 'ララァ' }),
      makeMatch({ partner_name: 'しゃあ専用', opponent1_name: 'アムロ', opponent2_name: 'ブライト' }),
    ];
    // 相方名にヒット
    var partial = emptyFilters(); partial.playerName = 'マスター';
    assert.equal(filterMatches(ms, partial).length, 1);
    // 大小文字無視（相方名）
    var ci = emptyFilters(); ci.playerName = 'red';
    assert.equal(filterMatches(ms, ci).length, 1);
    // 前後空白は無視
    var trimmed = emptyFilters(); trimmed.playerName = '  Comet  ';
    assert.equal(filterMatches(ms, trimmed).length, 1);
    // 敵1の名前にヒット
    var enemy1 = emptyFilters(); enemy1.playerName = 'シャア';
    assert.equal(filterMatches(ms, enemy1).length, 1);
    // 敵2の名前にヒット
    var enemy2 = emptyFilters(); enemy2.playerName = 'ブライト';
    assert.equal(filterMatches(ms, enemy2).length, 1);
    // どこにも無ければ0件
    var none = emptyFilters(); none.playerName = '存在しない';
    assert.equal(filterMatches(ms, none).length, 0);
  });
  it('player name filter treats missing names safely', function () {
    var ms = [makeMatch({ partner_name: undefined, opponent1_name: undefined, opponent2_name: undefined })];
    var f = emptyFilters(); f.playerName = 'a';
    assert.equal(filterMatches(ms, f).length, 0);
  });
  it('filters by own tag (myTagName, exact match on team_name)', function () {
    var ms = [
      makeMatch({ team_name: 'アルファ', opponent_team_name: 'ブラボー' }),
      makeMatch({ team_name: 'アルファ', opponent_team_name: 'チャーリー' }),
      makeMatch({ team_name: 'デルタ', opponent_team_name: 'アルファ' }),
    ];
    // 自陣team_nameのみ完全一致（敵陣にアルファがある3件目はヒットしない）
    var own = emptyFilters(); own.myTagList = ['アルファ'];
    assert.equal(filterMatches(ms, own).length, 2);
    // 完全一致（部分文字列では一致しない）
    var partial = emptyFilters(); partial.myTagList = ['アル'];
    assert.equal(filterMatches(ms, partial).length, 0);
  });
  it('filters by enemy tag (enemyTagName, partial match on opponent_team_name)', function () {
    var ms = [
      makeMatch({ team_name: 'アルファ', opponent_team_name: 'ブラボー団' }),
      makeMatch({ team_name: 'チャーリー', opponent_team_name: 'デルタ' }),
    ];
    // 敵陣タッグの部分一致
    var partial = emptyFilters(); partial.enemyTagName = 'ブラボー';
    assert.equal(filterMatches(ms, partial).length, 1);
    // 大小文字無視 + 前後空白無視
    var ci = emptyFilters(); ci.enemyTagName = '  デルタ ';
    assert.equal(filterMatches(ms, ci).length, 1);
    // 自陣team_nameは敵タッグ検索の対象外
    var ownOnly = emptyFilters(); ownOnly.enemyTagName = 'アルファ';
    assert.equal(filterMatches(ms, ownOnly).length, 0);
    // 空タッグ名(シャッフル)は安全にスキップ
    var missing = [makeMatch({ opponent_team_name: '' })];
    var f = emptyFilters(); f.enemyTagName = 'ブラボー';
    assert.equal(filterMatches(missing, f).length, 0);
  });
  it('filters by my cost (exact, numeric)', function () {
    var ms = [
      makeMatch({ ms_cost: 3000 }), makeMatch({ ms_cost: 2500 }), makeMatch({ ms_cost: 3000 }),
    ];
    var f = emptyFilters(); f.myCostList = ['3000'];
    assert.equal(filterMatches(ms, f).length, 2);
    var f2 = emptyFilters(); f2.myCostList = ['1500'];
    assert.equal(filterMatches(ms, f2).length, 0);
  });
  it('filters by partner cost (exact, numeric)', function () {
    var ms = [
      makeMatch({ partner_cost: 2000 }), makeMatch({ partner_cost: 1500 }),
    ];
    var f = emptyFilters(); f.partnerCostList = ['2000'];
    assert.equal(filterMatches(ms, f).length, 1);
  });
  it('filters by enemy cost pair (order-independent, normalized)', function () {
    var ms = [
      makeMatch({ opponent1_cost: 3000, opponent2_cost: 2500 }),
      makeMatch({ opponent1_cost: 2500, opponent2_cost: 3000 }), // 同編成(順不同)
      makeMatch({ opponent1_cost: 2000, opponent2_cost: 2000 }),
    ];
    var f = emptyFilters(); f.enemyCostPairList = ['3000 + 2500'];
    assert.equal(filterMatches(ms, f).length, 2);
    var f2 = emptyFilters(); f2.enemyCostPairList = ['2000 + 2000'];
    assert.equal(filterMatches(ms, f2).length, 1);
    // 未取得(0)コストは対象外
    var miss = [makeMatch({ opponent1_cost: 0, opponent2_cost: 3000 })];
    var f3 = emptyFilters(); f3.enemyCostPairList = ['3000 + 2500'];
    assert.equal(filterMatches(miss, f3).length, 0);
  });
  it('filters by score / ex_dmg / bursts ranges', function () {
    var ms = [
      makeMatch({ score: 300, ex_dmg: 100, bursts: 1 }),
      makeMatch({ score: 600, ex_dmg: 250, bursts: 3 }),
    ];
    var sc = emptyFilters(); sc.scoreMin = 500;
    assert.equal(filterMatches(ms, sc).length, 1);
    var ex = emptyFilters(); ex.exDmgMax = 150;
    assert.equal(filterMatches(ms, ex).length, 1);
    var bu = emptyFilters(); bu.burstsMin = 2; bu.burstsMax = 4;
    assert.equal(filterMatches(ms, bu).length, 1);
  });
  it('filters by result', function () {
    var win = emptyFilters(); win.result = 'win';
    assert.equal(filterMatches(matches, win).length, 2);
    var loss = emptyFilters(); loss.result = 'loss';
    assert.equal(filterMatches(matches, loss).length, 1);
  });
  it('filters by damage range', function () {
    var f = emptyFilters(); f.dmgGivenMin = 800; f.dmgGivenMax = 1000;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].dmg_given, 900);
  });
  it('filters by kills/deaths range', function () {
    var f = emptyFilters(); f.deathsMax = 0;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].deaths, 0);
  });
  it('combines multiple conditions (AND)', function () {
    var f = emptyFilters();
    f.myMsList = ['ガンダム']; f.result = 'win'; f.dmgGivenMin = 1000;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].dmg_given, 1200);
  });
  it('does not mutate the input array', function () {
    var copy = matches.slice();
    filterMatches(matches, { myMs: 'ガンダム' });
    assert.deepEqual(matches, copy);
  });
});

describe('sortMatches', function () {
  var matches = [
    makeMatch({ date: '2025-06-10 10:00', dmg_given: 1200, kills: 3 }),
    makeMatch({ date: '2025-06-20 20:00', dmg_given: 700, kills: 1 }),
    makeMatch({ date: '2025-06-15 12:00', dmg_given: 900, kills: 3 }),
  ];

  it('sorts by date descending', function () {
    var r = sortMatches(matches, 'date', true);
    assert.deepEqual(r.map(function (m) { return m.date; }),
      ['2025-06-20 20:00', '2025-06-15 12:00', '2025-06-10 10:00']);
  });
  it('sorts by date ascending', function () {
    var r = sortMatches(matches, 'date', false);
    assert.equal(r[0].date, '2025-06-10 10:00');
  });
  it('sorts by numeric field descending', function () {
    var r = sortMatches(matches, 'dmg_given', true);
    assert.deepEqual(r.map(function (m) { return m.dmg_given; }), [1200, 900, 700]);
  });
  it('breaks ties by most recent date', function () {
    var r = sortMatches(matches, 'kills', true);
    // two matches have kills=3; the newer (06-15) comes before the older (06-10)
    assert.equal(r[0].kills, 3);
    assert.equal(r[0].date, '2025-06-15 12:00');
    assert.equal(r[1].date, '2025-06-10 10:00');
  });
  it('does not mutate the input array', function () {
    var copy = matches.slice();
    sortMatches(matches, 'dmg_given', true);
    assert.deepEqual(matches, copy);
  });
});

describe('SORT_OPTIONS', function () {
  it('every option has key and label', function () {
    SORT_OPTIONS.forEach(function (o) {
      assert.ok(o.key && o.label);
    });
  });
});

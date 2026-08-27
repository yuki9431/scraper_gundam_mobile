import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIOD_DAYS,
  filterByPlayDays,
  computeTimeOfDay,
  computeDayOfWeek,
  computeDailyTrend,
  computeBasicStats,
  computeWinLossPattern,
  computeEnemyMatchup,
  computePartner,
  computeCostPair,
  computeMsPair,
  computeDmgContribution,
  computeTeamDeathsImpact,
  computeSeason,
  computeBurstCount,
  computeFallOrder,
  computeBurstTiming,
  computeBurstType,
  computeFixedPartners,
  burstKpi,
  bestWorstHour,
  partnerKpi,
} from '../analysis/stats.js';

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
    bursts: 2,
    score: 500,
    actions: [],
    partner_actions: [],
    partner_ms: 'ザク',
    partner_cost: 2000,
    partner_name: 'パートナー',
    partner_dmg_given: 900,
    partner_dmg_taken: 700,
    partner_kills: 1,
    partner_deaths: 1,
    partner_ex_dmg: 100,
    opponent1_ms: 'シャアザク',
    opponent2_ms: 'ゲルググ',
  }, overrides);
}

function makeMatches(count, overrides) {
  var result = [];
  for (var i = 0; i < count; i++) {
    result.push(makeMatch(typeof overrides === 'function' ? overrides(i) : overrides));
  }
  return result;
}

// --- PERIOD_DAYS ---

describe('PERIOD_DAYS', function () {
  it('has expected keys and values', function () {
    assert.equal(PERIOD_DAYS['90d'], 90);
    assert.equal(PERIOD_DAYS['7d'], 7);
    assert.equal(PERIOD_DAYS['1d'], 1);
  });
});

// --- filterByPlayDays ---

describe('filterByPlayDays', function () {
  it('returns empty for empty input', function () {
    assert.deepEqual(filterByPlayDays([], 3), []);
  });

  it('filters to most recent N play days', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }),
      makeMatch({ date: '2025-06-15 14:00' }),
      makeMatch({ date: '2025-06-14 10:00' }),
      makeMatch({ date: '2025-06-13 10:00' }),
    ];
    var filtered = filterByPlayDays(matches, 2);
    assert.equal(filtered.length, 3);
    assert.ok(filtered.every(function (m) { return m.date.startsWith('2025-06-15') || m.date.startsWith('2025-06-14'); }));
  });

  it('returns all when days exceeds unique dates', function () {
    var matches = [makeMatch({ date: '2025-06-15 10:00' })];
    assert.equal(filterByPlayDays(matches, 100).length, 1);
  });
});

// --- computeTimeOfDay ---

describe('computeTimeOfDay', function () {
  it('groups matches by hour', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 14:30' }),
      makeMatch({ date: '2025-06-15 14:45' }),
      makeMatch({ date: '2025-06-15 20:00', win: false }),
    ];
    var result = computeTimeOfDay(matches);
    assert.ok(Array.isArray(result.hours));
    var h14 = result.hours.find(function (h) { return h.hour === 14; });
    assert.ok(h14);
    assert.equal(h14.matches, 2);
    assert.equal(h14.win_rate, 100);
  });

  it('returns tips array', function () {
    var result = computeTimeOfDay([makeMatch()]);
    assert.ok(Array.isArray(result.tips));
  });
});

// --- computeDayOfWeek ---

describe('computeDayOfWeek', function () {
  it('separates weekday and weekend', function () {
    var matches = [
      makeMatch({ date: '2025-06-16 10:00' }), // Monday
      makeMatch({ date: '2025-06-14 10:00' }), // Saturday
    ];
    var result = computeDayOfWeek(matches);
    assert.equal(result.weekday.matches, 1);
    assert.equal(result.weekend.matches, 1);
    assert.ok(Array.isArray(result.days));
  });

  it('generates tips for large win rate diff', function () {
    var matches = [];
    for (var i = 0; i < 10; i++) matches.push(makeMatch({ date: '2025-06-16 10:00', win: true })); // Mon wins
    for (var i = 0; i < 10; i++) matches.push(makeMatch({ date: '2025-06-14 10:00', win: false })); // Sat losses
    var result = computeDayOfWeek(matches);
    assert.ok(result.tips.length > 0);
  });
});

// --- computeDailyTrend ---

describe('computeDailyTrend', function () {
  it('returns daily results sorted', function () {
    var matches = [
      makeMatch({ date: '2025-06-13 10:00', win: false }),
      makeMatch({ date: '2025-06-15 10:00', win: true }),
      makeMatch({ date: '2025-06-14 10:00', win: true }),
    ];
    var result = computeDailyTrend(matches);
    assert.ok(result.days.length >= 2);
    assert.ok(Array.isArray(result.tips));
  });
});

// --- computeBasicStats ---

describe('computeBasicStats', function () {
  it('computes basic stats correctly', function () {
    var matches = [
      makeMatch({ win: true, kills: 3, deaths: 1, dmg_given: 1200, dmg_taken: 800 }),
      makeMatch({ win: false, kills: 1, deaths: 2, dmg_given: 700, dmg_taken: 1000 }),
    ];
    var result = computeBasicStats(matches);
    assert.equal(result.matches, 2);
    assert.equal(result.wins, 1);
    assert.equal(result.losses, 1);
    assert.equal(result.win_rate, 50);
    assert.equal(result.avg_dmg_given, 950);
    assert.equal(result.avg_dmg_taken, 900);
    assert.ok(result.kd_ratio > 0);
    assert.ok(Array.isArray(result.tips));
  });

  it('handles empty matches', function () {
    var result = computeBasicStats([]);
    assert.equal(result.matches, 0);
    assert.equal(result.win_rate, 0);
  });

  it('generates tips for low efficiency', function () {
    var matches = makeMatches(5, { dmg_given: 500, dmg_taken: 1000, kills: 0, deaths: 3 });
    var result = computeBasicStats(matches);
    assert.ok(result.tips.length > 0);
  });

  it('computes avg_bursts when actions present', function () {
    var matches = [
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-f' }] }),
      makeMatch({ bursts: 1, actions: [{ action: 'exbst-s' }] }),
    ];
    var result = computeBasicStats(matches);
    assert.equal(result.avg_bursts, 1.5);
  });

  it('avg_bursts is null when no actions', function () {
    var result = computeBasicStats([makeMatch({ actions: [] })]);
    assert.equal(result.avg_bursts, null);
  });
});

// --- computeWinLossPattern ---

describe('computeWinLossPattern', function () {
  it('returns metrics comparing wins and losses', function () {
    var matches = [
      makeMatch({ win: true, dmg_given: 1200, dmg_taken: 600, kills: 3, deaths: 0, ex_dmg: 200 }),
      makeMatch({ win: false, dmg_given: 600, dmg_taken: 1100, kills: 0, deaths: 3, ex_dmg: 50 }),
    ];
    var result = computeWinLossPattern(matches);
    assert.ok(result.metrics.length >= 6);
    var dmgGiven = result.metrics.find(function (m) { return m.label === '平均与ダメージ'; });
    assert.ok(dmgGiven);
    assert.ok(dmgGiven.win_avg > dmgGiven.loss_avg);
  });

  it('includes cost patterns when data is available', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) {
      matches.push(makeMatch({ win: i < 3, ms_cost: 3000 }));
    }
    var result = computeWinLossPattern(matches);
    assert.ok(result.cost_patterns.length > 0);
    assert.equal(result.cost_patterns[0].cost, 3000);
  });
});

// --- computeEnemyMatchup ---

describe('computeEnemyMatchup', function () {
  it('categorizes enemies into strong/weak/even', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) matches.push(makeMatch({ win: true, opponent1_ms: '弱い敵', opponent2_ms: 'ザコ' }));
    for (var i = 0; i < 5; i++) matches.push(makeMatch({ win: false, opponent1_ms: '強い敵', opponent2_ms: 'ザコ' }));
    var result = computeEnemyMatchup(matches, 3);
    assert.ok(result.strong.length > 0 || result.weak.length > 0 || result.even.length > 0);
  });

  it('respects minMatches', function () {
    var matches = [
      makeMatch({ opponent1_ms: 'レア敵', opponent2_ms: '' }),
      makeMatch({ opponent1_ms: 'レア敵', opponent2_ms: '' }),
    ];
    var result = computeEnemyMatchup(matches, 5);
    assert.equal(result.strong.length + result.weak.length + result.even.length, 0);
  });

  it('generates tips for weak enemies with high damage taken', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) {
      matches.push(makeMatch({ win: false, opponent1_ms: '天敵', opponent2_ms: '', dmg_taken: 1500 }));
    }
    var result = computeEnemyMatchup(matches, 3);
    assert.ok(result.tips.length > 0);
  });
});

// --- computePartner ---

describe('computePartner', function () {
  it('groups by partner MS', function () {
    var matches = makeMatches(5, { partner_ms: 'ストライク' });
    var result = computePartner(matches, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].ms, 'ストライク');
    assert.equal(result[0].matches, 5);
  });

  it('filters below minMatches', function () {
    var matches = [makeMatch({ partner_ms: 'レア相方' })];
    assert.equal(computePartner(matches, 3).length, 0);
  });
});

// --- computeCostPair ---

describe('computeCostPair', function () {
  it('groups by MS + partner cost', function () {
    var matches = makeMatches(5, { ms: 'ガンダム', partner_cost: 2000 });
    var result = computeCostPair(matches, 3);
    assert.ok(result.length > 0);
    assert.ok(result[0].pair.includes('ガンダム'));
    assert.ok(result[0].pair.includes('2000'));
  });
});

// --- computeMsPair ---

describe('computeMsPair', function () {
  it('returns by_win_rate and by_matches', function () {
    var matches = makeMatches(5, { ms: 'ガンダム', partner_ms: 'ザク' });
    var result = computeMsPair(matches, 3);
    assert.ok(result.by_win_rate);
    assert.ok(result.by_matches);
    assert.ok(result.by_win_rate.length > 0);
  });
});

// --- computeDmgContribution ---

describe('computeDmgContribution', function () {
  it('computes average contributions', function () {
    var matches = [
      makeMatch({ dmg_given: 1000, partner_dmg_given: 1000 }),
      makeMatch({ dmg_given: 600, partner_dmg_given: 400 }),
    ];
    var result = computeDmgContribution(matches);
    assert.ok(result.avg_contribution > 0);
    assert.ok(result.avg_contribution <= 100);
  });

  it('handles zero team damage', function () {
    var matches = [makeMatch({ dmg_given: 0, partner_dmg_given: 0 })];
    var result = computeDmgContribution(matches);
    assert.equal(result.avg_contribution, 0);
  });

  it('includes cost breakdown when multiple costs', function () {
    var matches = [
      ...makeMatches(5, { ms_cost: 3000, dmg_given: 1200, partner_dmg_given: 800 }),
      ...makeMatches(5, { ms_cost: 2500, dmg_given: 800, partner_dmg_given: 1000 }),
    ];
    var result = computeDmgContribution(matches, 3);
    assert.ok(result.by_cost.length >= 2);
  });
});

// --- computeTeamDeathsImpact ---

describe('computeTeamDeathsImpact', function () {
  function findGroup(result, self) {
    return result.groups.find(function (g) { return g.self === self; });
  }
  function findPartner(group, partner) {
    return group.partners.find(function (p) { return p.partner === partner; });
  }

  it('buckets by self x partner deaths and computes matches/win_rate per cell', function () {
    var matches = [
      makeMatch({ deaths: 0, partner_deaths: 0, win: true }),
      makeMatch({ deaths: 0, partner_deaths: 0, win: true }),
      makeMatch({ deaths: 0, partner_deaths: 1, win: false }),
    ];
    var result = computeTeamDeathsImpact(matches);
    var g0 = findGroup(result, 0);
    assert.ok(g0);
    var p0 = findPartner(g0, 0);
    var p1 = findPartner(g0, 1);
    assert.equal(p0.matches, 2);
    assert.equal(p0.win_rate, 100);
    assert.equal(p1.matches, 1);
    assert.equal(p1.win_rate, 0);
  });

  it('collapses deaths >= TEAM_DEATH_MAX into the "N落ち以上" bucket on both axes', function () {
    var matches = [
      makeMatch({ deaths: 3, partner_deaths: 0 }),
      makeMatch({ deaths: 5, partner_deaths: 0 }),
      makeMatch({ deaths: 0, partner_deaths: 3 }),
      makeMatch({ deaths: 0, partner_deaths: 7 }),
    ];
    var result = computeTeamDeathsImpact(matches);
    var g3 = findGroup(result, 3);
    assert.ok(g3);
    assert.equal(g3.self_label, '3落ち以上');
    assert.equal(g3.matches, 2);
    var g0 = findGroup(result, 0);
    var p3 = findPartner(g0, 3);
    assert.ok(p3);
    assert.equal(p3.partner_label, '3落ち以上');
    assert.equal(p3.matches, 2);
  });

  it('omits cells and self groups with zero matches', function () {
    var matches = [makeMatch({ deaths: 0, partner_deaths: 1 })];
    var result = computeTeamDeathsImpact(matches);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].partners.length, 1);
    assert.equal(findGroup(result, 1), undefined);
  });

  it('computes self-level marginal matches and win_rate across partner cells', function () {
    var matches = [
      makeMatch({ deaths: 1, partner_deaths: 0, win: true }),
      makeMatch({ deaths: 1, partner_deaths: 0, win: true }),
      makeMatch({ deaths: 1, partner_deaths: 2, win: false }),
    ];
    var result = computeTeamDeathsImpact(matches);
    var g1 = findGroup(result, 1);
    var partnerTotal = g1.partners.reduce(function (sum, p) { return sum + p.matches; }, 0);
    assert.equal(g1.matches, partnerTotal);
    assert.equal(g1.matches, 3);
    assert.equal(g1.win_rate, Math.round(2 / 3 * 1000) / 10);
  });

  it('skips matches missing deaths or partner_deaths (type guard)', function () {
    var matches = [
      makeMatch({ deaths: 0, partner_deaths: 0 }),
      makeMatch({ deaths: 0, partner_deaths: undefined }),
      makeMatch({ deaths: undefined, partner_deaths: 0 }),
    ];
    var result = computeTeamDeathsImpact(matches);
    assert.equal(result.total, 1);
  });

  it('returns empty result for empty input', function () {
    var result = computeTeamDeathsImpact([]);
    assert.equal(result.total, 0);
    assert.deepEqual(result.groups, []);
  });

  it('sorts groups by self ascending and partners by partner ascending regardless of input order', function () {
    var matches = [
      makeMatch({ deaths: 2, partner_deaths: 1 }),
      makeMatch({ deaths: 0, partner_deaths: 2 }),
      makeMatch({ deaths: 1, partner_deaths: 0 }),
      makeMatch({ deaths: 0, partner_deaths: 0 }),
      makeMatch({ deaths: 2, partner_deaths: 0 }),
      makeMatch({ deaths: 0, partner_deaths: 1 }),
    ];
    var result = computeTeamDeathsImpact(matches);
    var selfOrder = result.groups.map(function (g) { return g.self; });
    assert.deepEqual(selfOrder, selfOrder.slice().sort(function (a, b) { return a - b; }));

    var g0 = findGroup(result, 0);
    var partnerOrder = g0.partners.map(function (p) { return p.partner; });
    assert.deepEqual(partnerOrder, [0, 1, 2]);

    var g2 = findGroup(result, 2);
    var g2PartnerOrder = g2.partners.map(function (p) { return p.partner; });
    assert.deepEqual(g2PartnerOrder, [0, 1]);
  });
});

// --- computeSeason ---

describe('computeSeason', function () {
  it('groups matches by 2-month seasons', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }),
      makeMatch({ date: '2025-06-20 10:00' }),
      makeMatch({ date: '2025-04-15 10:00' }),
    ];
    var result = computeSeason(matches);
    assert.ok(result.length >= 2);
    assert.ok(result[0].name.includes('年'));
  });

  it('includes half stats when both halves have data', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }), // 前半(6月)
      makeMatch({ date: '2025-07-15 10:00' }), // 後半(7月)
    ];
    var result = computeSeason(matches);
    var s = result.find(function (r) { return r.first_half && r.second_half; });
    assert.ok(s);
  });
});

// --- computeBurstCount ---

describe('computeBurstCount', function () {
  it('groups by burst count', function () {
    var matches = [
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-f' }] }),
      makeMatch({ bursts: 1, actions: [{ action: 'exbst-s' }] }),
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-e' }] }),
    ];
    var result = computeBurstCount(matches);
    assert.ok(result);
    assert.ok(result.by_count.length >= 2);
    var burst2 = result.by_count.find(function (b) { return b.count === 2; });
    assert.ok(burst2);
    assert.equal(burst2.matches, 2);
  });

  it('returns null for no action data', function () {
    var result = computeBurstCount([makeMatch({ actions: [] })]);
    assert.equal(result, null);
  });

  it('labels zero bursts correctly', function () {
    var matches = [makeMatch({ bursts: 0, actions: [{ action: 'ex' }] })];
    var result = computeBurstCount(matches);
    assert.ok(result);
    var zero = result.by_count.find(function (b) { return b.count === 0; });
    assert.ok(zero);
    assert.ok(zero.label.includes('未覚醒'));
  });
});

// --- computeFallOrder ---

describe('computeFallOrder', function () {
  it('classifies no-fall, first-fall, second-fall', function () {
    var matches = [
      makeMatch({
        actions: [{ action: 'death', action_start_sec: 60 }],
        partner_actions: [{ action: 'death', action_start_sec: 90 }],
      }),
      makeMatch({
        actions: [{ action: 'death', action_start_sec: 90 }],
        partner_actions: [{ action: 'death', action_start_sec: 30 }],
      }),
      makeMatch({
        actions: [{ action: 'ex', action_start_sec: 10 }],
        partner_actions: [{ action: 'death', action_start_sec: 60 }],
      }),
    ];
    var result = computeFallOrder(matches);
    assert.ok(result);
    assert.equal(result.first_fall.count, 1);
    assert.equal(result.second_fall.count, 1);
    assert.equal(result.no_fall.count, 1);
  });

  it('returns null for no action data', function () {
    var result = computeFallOrder([makeMatch({ actions: [], partner_actions: [] })]);
    assert.equal(result, null);
  });
});

// --- computeBurstTiming ---

describe('computeBurstTiming', function () {
  it('classifies burst before first death as 1機目', function () {
    var matches = [
      makeMatch({
        win: true,
        actions: [
          { action: 'exbst-f', action_start_sec: 30 },
          { action: 'death', action_start_sec: 60 },
        ],
      }),
    ];
    var result = computeBurstTiming(matches);
    assert.ok(result);
    assert.equal(result.total, 1);
    var pre = result.by_timing.find(function (t) { return t.label === '1機目'; });
    assert.ok(pre);
    assert.equal(pre.count, 1);
  });

  it('classifies burst after first death as 2機目', function () {
    var matches = [
      makeMatch({
        actions: [
          { action: 'death', action_start_sec: 30 },
          { action: 'exbst-s', action_start_sec: 50 },
        ],
      }),
    ];
    var result = computeBurstTiming(matches);
    assert.ok(result);
    var post = result.by_timing.find(function (t) { return t.label === '2機目'; });
    assert.ok(post);
    assert.equal(post.count, 1);
  });

  it('handles multiple bursts across deaths in one match', function () {
    var matches = [
      makeMatch({
        actions: [
          { action: 'exbst-f', action_start_sec: 20 },
          { action: 'death', action_start_sec: 40 },
          { action: 'exbst-e', action_start_sec: 60 },
        ],
      }),
    ];
    var result = computeBurstTiming(matches);
    assert.ok(result);
    assert.equal(result.total, 1);
    var pre = result.by_timing.find(function (t) { return t.label === '1機目'; });
    var post = result.by_timing.find(function (t) { return t.label === '2機目'; });
    assert.equal(pre.count, 1);
    assert.equal(post.count, 1);
  });

  it('classifies burst after 2 deaths as 3機目', function () {
    var matches = [
      makeMatch({
        actions: [
          { action: 'death', action_start_sec: 20 },
          { action: 'death', action_start_sec: 40 },
          { action: 'exbst-f', action_start_sec: 50 },
        ],
      }),
    ];
    var result = computeBurstTiming(matches);
    assert.ok(result);
    var post2 = result.by_timing.find(function (t) { return t.label === '3機目'; });
    assert.ok(post2);
    assert.equal(post2.count, 1);
  });

  it('returns null when there are no burst events', function () {
    var matches = [makeMatch({ actions: [{ action: 'death', action_start_sec: 30 }] })];
    assert.equal(computeBurstTiming(matches), null);
  });
});

// --- computeBurstType ---

describe('computeBurstType', function () {
  it('counts F/S/E usage rate and win rate', function () {
    var matches = [
      makeMatch({ win: true, actions: [{ action: 'exbst-f', action_start_sec: 30 }] }),
      makeMatch({ win: false, actions: [{ action: 'exbst-f', action_start_sec: 30 }] }),
      makeMatch({ win: true, actions: [{ action: 'exbst-s', action_start_sec: 30 }] }),
      makeMatch({ win: true, actions: [{ action: 'exbst-e', action_start_sec: 30 }] }),
    ];
    var result = computeBurstType(matches);
    assert.ok(result);
    assert.equal(result.total_bursts, 4);
    var f = result.by_type.find(function (t) { return t.key === 'F'; });
    assert.equal(f.count, 2);
    assert.equal(f.rate, 50);
    assert.equal(f.matches, 2);
    assert.equal(f.win_rate, 50);
  });

  it('counts multiple bursts of the same type in one match once per match', function () {
    var matches = [
      makeMatch({ win: true, actions: [
        { action: 'exbst-f', action_start_sec: 20 },
        { action: 'exbst-f', action_start_sec: 60 },
      ] }),
    ];
    var result = computeBurstType(matches);
    assert.ok(result);
    var f = result.by_type.find(function (t) { return t.key === 'F'; });
    assert.equal(f.count, 2);
    assert.equal(f.matches, 1);
  });

  it('returns null when there are no burst events', function () {
    var matches = [makeMatch({ actions: [{ action: 'ex', action_start_sec: 30 }] })];
    assert.equal(computeBurstType(matches), null);
  });
});

// --- computeFixedPartners ---

describe('computeFixedPartners', function () {
  it('returns notice when no tag partners', function () {
    var result = computeFixedPartners([makeMatch()], []);
    assert.ok(result.notice);
    assert.deepEqual(result.partners, []);
  });

  it('returns notice when tag partners is null', function () {
    var result = computeFixedPartners([makeMatch()], null);
    assert.ok(result.notice);
  });

  it('matches tag partners by name and labels with latest player name + team name', function () {
    var tagPartners = [{ player_name: 'パートナー', team_name: 'チームA' }];
    var matches = makeMatches(5, { partner_name: 'パートナー' });
    var result = computeFixedPartners(matches, tagPartners);
    assert.equal(result.partners.length, 1);
    assert.equal(result.partners[0].partner_name, 'パートナー');
    assert.equal(result.partners[0].team_name, 'チームA');
    assert.equal(result.partners[0].matches, 5);
    assert.ok(result.partners[0].my_stats);
    assert.ok(result.partners[0].partner_stats);
  });

  it('merges partners with the same team name and shows latest name + team name', function () {
    // 同じチーム名の別プレイヤー（名前変更などで別名になったケース）を統合し、
    // 表示は最新の試合で使われていたプレイヤー名＋チーム名にする
    var tagPartners = [
      { player_name: '旧名', team_name: 'チームA' },
      { player_name: '新名', team_name: 'チームA' },
    ];
    var matches = makeMatches(3, { partner_name: '旧名', date: '2025-01-10 10:00' })
      .concat(makeMatches(4, { partner_name: '新名', date: '2025-06-20 10:00' }));
    var result = computeFixedPartners(matches, tagPartners);
    assert.equal(result.partners.length, 1);
    assert.equal(result.partners[0].partner_name, '新名');
    assert.equal(result.partners[0].team_name, 'チームA');
    assert.equal(result.partners[0].matches, 7);
  });

  it('keeps partners with empty team name separate by player name', function () {
    var tagPartners = [
      { player_name: 'ソロA', team_name: '' },
      { player_name: 'ソロB', team_name: '' },
    ];
    var matches = makeMatches(2, { partner_name: 'ソロA' })
      .concat(makeMatches(3, { partner_name: 'ソロB' }));
    var result = computeFixedPartners(matches, tagPartners);
    assert.equal(result.partners.length, 2);
    var names = result.partners.map(function (p) { return p.partner_name; }).sort();
    assert.deepEqual(names, ['ソロA', 'ソロB']);
    // チーム未統合の相方にはデフォルトのチーム名 NO_NAME_TAG が付く
    assert.ok(result.partners.every(function (p) { return p.team_name === 'NO_NAME_TAG'; }));
  });

  it('does not merge the default NO_NAME_TAG (different partners)', function () {
    // チーム名未設定はスクレイピング上デフォルトの NO_NAME_TAG になるが、実際は別々の相方
    var tagPartners = [
      { player_name: 'ソロA', team_name: 'NO_NAME_TAG' },
      { player_name: 'ソロB', team_name: 'NO_NAME_TAG' },
    ];
    var matches = makeMatches(2, { partner_name: 'ソロA' })
      .concat(makeMatches(3, { partner_name: 'ソロB' }));
    var result = computeFixedPartners(matches, tagPartners);
    assert.equal(result.partners.length, 2);
    var names = result.partners.map(function (p) { return p.partner_name; }).sort();
    assert.deepEqual(names, ['ソロA', 'ソロB']);
    // 統合はしないが、表示用にデフォルトのチーム名 NO_NAME_TAG を付ける
    assert.ok(result.partners.every(function (p) { return p.team_name === 'NO_NAME_TAG'; }));
  });

  it('returns empty partners when no matches with tag partners', function () {
    var tagPartners = [{ player_name: '誰か', team_name: 'チームX' }];
    var matches = makeMatches(5, { partner_name: '別の人' });
    var result = computeFixedPartners(matches, tagPartners);
    assert.deepEqual(result.partners, []);
  });
});

// --- burstKpi (タブ別KPI: 覚醒) ---

describe('burstKpi', function () {
  it('returns nulls for null / empty input', function () {
    var empty = { rate2: null, winRate2: null, rate0: null, winRate0: null };
    assert.deepEqual(burstKpi(null), empty);
    assert.deepEqual(burstKpi({ by_count: [] }), empty);
    assert.deepEqual(burstKpi({}), empty);
  });

  it('computes 2覚醒以上/未覚醒 の割合と加重勝率', function () {
    // count>=2: 2回(4試合,勝率50) + 3回(1試合,勝率100) → 5/10=50%, 加重勝率=(2+1)/5=60%
    // count==0: 2試合,勝率0 → 2/10=20%, 勝率0
    var burstCount = {
      by_count: [
        { count: 0, matches: 2, win_rate: 0 },
        { count: 1, matches: 3, win_rate: 100 },
        { count: 2, matches: 4, win_rate: 50 },
        { count: 3, matches: 1, win_rate: 100 },
      ],
    };
    var r = burstKpi(burstCount);
    assert.equal(r.rate2, 50);
    assert.equal(r.winRate2, 60);
    assert.equal(r.rate0, 20);
    assert.equal(r.winRate0, 0);
  });

  it('winRate は該当試合が無ければ null（割合は 0）', function () {
    var r = burstKpi({ by_count: [{ count: 1, matches: 5, win_rate: 40 }] });
    assert.equal(r.rate2, 0);
    assert.equal(r.winRate2, null);
    assert.equal(r.rate0, 0);
    assert.equal(r.winRate0, null);
  });

  it('computeBurstCount の実出力を受け取れる', function () {
    var matches = makeMatches(3, { bursts: 2, win: true, actions: [{ event: 'x' }] });
    var r = burstKpi(computeBurstCount(matches));
    assert.equal(r.rate2, 100);
    assert.equal(r.winRate2, 100);
  });
});

// --- bestWorstHour (タブ別KPI: 時間帯) ---

describe('bestWorstHour', function () {
  it('returns nulls for null / empty', function () {
    assert.deepEqual(bestWorstHour(null), { best: null, worst: null });
    assert.deepEqual(bestWorstHour({ hours: [] }), { best: null, worst: null });
  });

  it('picks max/min win_rate among hours meeting minMatches', function () {
    var tod = { hours: [
      { hour: 10, matches: 5, win_rate: 70 },
      { hour: 14, matches: 5, win_rate: 30 },
      { hour: 20, matches: 1, win_rate: 100 }, // 閾値未満で除外
    ] };
    var r = bestWorstHour(tod, 3);
    assert.equal(r.best.hour, 10);
    assert.equal(r.worst.hour, 14);
  });

  it('falls back to all hours when none meet minMatches', function () {
    var tod = { hours: [
      { hour: 9, matches: 1, win_rate: 40 },
      { hour: 21, matches: 2, win_rate: 80 },
    ] };
    var r = bestWorstHour(tod, 5);
    assert.equal(r.best.hour, 21);
    assert.equal(r.worst.hour, 9);
  });

  it('computeTimeOfDay の実出力を受け取れる', function () {
    var matches = makeMatches(5, function (i) { return { date: '2025-06-15 14:0' + i }; });
    var r = bestWorstHour(computeTimeOfDay(matches));
    assert.equal(r.best.hour, 14);
    assert.equal(r.worst.hour, 14);
  });
});

// --- partnerKpi (タブ別KPI: 機体相性) ---

describe('partnerKpi', function () {
  it('returns zero/nulls for null / empty', function () {
    assert.deepEqual(partnerKpi(null), { count: 0, top: null, bestWinRate: null });
    assert.deepEqual(partnerKpi([]), { count: 0, top: null, bestWinRate: null });
  });

  it('top は先頭（試合数降順前提）、bestWinRate は最高勝率', function () {
    var partner = [
      { ms: 'A', matches: 10, win_rate: 40 },
      { ms: 'B', matches: 5, win_rate: 90 },
      { ms: 'C', matches: 3, win_rate: 60 },
    ];
    var r = partnerKpi(partner);
    assert.equal(r.count, 3);
    assert.equal(r.top.ms, 'A');
    assert.equal(r.bestWinRate.ms, 'B');
  });

  it('computePartner の実出力を受け取れる', function () {
    var matches = makeMatches(4, { partner_ms: 'ザク', win: true });
    var r = partnerKpi(computePartner(matches));
    assert.equal(r.count, 1);
    assert.equal(r.top.ms, 'ザク');
    assert.equal(r.bestWinRate.ms, 'ザク');
  });
});

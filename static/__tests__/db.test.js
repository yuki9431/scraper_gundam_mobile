import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecordId, needsRebuild } from '../lib/db.js';

function rec(schemaVersion) {
  return { match_id: 'm', schema_version: schemaVersion };
}

describe('matchRecordId', function () {
  it('produces distinct ids for same date but different match_id (#358 regression)', function () {
    var a = matchRecordId('user1', { date: '2026-07-04 21:30', match_id: 'match-a' });
    var b = matchRecordId('user1', { date: '2026-07-04 21:30', match_id: 'match-b' });
    assert.notEqual(a, b);
  });

  it('falls back to date when match_id is missing (legacy data)', function () {
    var id = matchRecordId('user1', { date: '2026-07-04 21:30' });
    assert.equal(id, 'user1_2026-07-04 21:30');
  });

  it('is stable for the same input (idempotent)', function () {
    var m = { date: '2026-07-04 21:30', match_id: 'match-a' };
    assert.equal(matchRecordId('user1', m), matchRecordId('user1', m));
  });
});

describe('needsRebuild', function () {
  it('does not rebuild when every record is on the current version', function () {
    assert.equal(needsRebuild([rec(1), rec(1), rec(1)], 1), false);
  });

  it('rebuilds when every record is stale', function () {
    assert.equal(needsRebuild([rec(1), rec(1)], 2), true);
  });

  // 速報バッチの部分保存が中断すると新旧が混在する。loadMatchesFromDBの並びはid辞書順なので
  // 先頭に現行版が来ることがあり、先頭1件のサンプリングでは検知漏れしていた。
  it('rebuilds when versions are mixed and the first record is current', function () {
    assert.equal(needsRebuild([rec(2), rec(2), rec(1)], 2), true);
  });

  it('rebuilds when records predate schema stamping (undefined)', function () {
    assert.equal(needsRebuild([rec(undefined), rec(undefined)], 1), true);
  });

  it('rebuilds when a record is newer than the server (rollback)', function () {
    assert.equal(needsRebuild([rec(2)], 1), true);
  });

  it('does not rebuild when the server version is unresolvable', function () {
    assert.equal(needsRebuild([rec(1)], null), false);
    assert.equal(needsRebuild([rec(1)], undefined), false);
  });

  it('does not rebuild on an empty or missing cache', function () {
    assert.equal(needsRebuild([], 1), false);
    assert.equal(needsRebuild(null, 1), false);
  });
});

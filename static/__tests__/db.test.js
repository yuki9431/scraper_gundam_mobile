import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecordId } from '../lib/db.js';

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

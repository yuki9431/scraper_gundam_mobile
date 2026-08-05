import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esc, pct, num, cellValue, cellDisplay, isTimeUp, TIMEUP_SEC } from '../lib/format.js';

// --- esc ---

describe('esc', function () {
  it('escapes HTML special characters', function () {
    assert.equal(esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersand', function () {
    assert.equal(esc('a & b'), 'a &amp; b');
  });

  it('returns empty string for null', function () {
    assert.equal(esc(null), '');
  });

  it('returns empty string for undefined', function () {
    assert.equal(esc(undefined), '');
  });

  it('converts numbers to string', function () {
    assert.equal(esc(42), '42');
  });

  it('passes through safe strings unchanged', function () {
    assert.equal(esc('hello world'), 'hello world');
  });
});

// --- pct ---

describe('pct', function () {
  it('formats number as percentage', function () {
    assert.equal(pct(50.123), '50.1%');
  });

  it('formats zero', function () {
    assert.equal(pct(0), '0.0%');
  });

  it('returns dash for null', function () {
    assert.equal(pct(null), '-');
  });

  it('returns dash for undefined', function () {
    assert.equal(pct(undefined), '-');
  });
});

// --- num ---

describe('num', function () {
  it('formats with default 0 decimals', function () {
    assert.equal(num(123.456), '123');
  });

  it('formats with specified decimals', function () {
    assert.equal(num(123.456, 2), '123.46');
  });

  it('returns dash for null', function () {
    assert.equal(num(null), '-');
  });

  it('returns dash for undefined', function () {
    assert.equal(num(undefined, 3), '-');
  });
});

// --- cellValue ---

describe('cellValue', function () {
  it('extracts sortValue from object', function () {
    assert.equal(cellValue({ sortValue: 42, display: 'formatted' }), 42);
  });

  it('returns primitive as-is', function () {
    assert.equal(cellValue(100), 100);
    assert.equal(cellValue('text'), 'text');
  });

  it('handles null', function () {
    assert.equal(cellValue(null), null);
  });

  it('handles object without sortValue', function () {
    var obj = { display: 'text' };
    assert.deepEqual(cellValue(obj), obj);
  });
});

// --- cellDisplay ---

describe('cellDisplay', function () {
  it('extracts display from object', function () {
    assert.equal(cellDisplay({ sortValue: 42, display: 'formatted' }), 'formatted');
  });

  it('returns primitive as-is', function () {
    assert.equal(cellDisplay(100), 100);
    assert.equal(cellDisplay('text'), 'text');
  });

  it('handles null', function () {
    assert.equal(cellDisplay(null), null);
  });
});

// --- isTimeUp ---

describe('isTimeUp', function () {
  it('returns true when game_end_sec reaches the time limit', function () {
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC }), true);
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC + 5 }), true);
  });

  it('returns false when the match ended before the time limit', function () {
    assert.equal(isTimeUp({ game_end_sec: 143 }), false);
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC - 1 }), false);
  });

  it('returns false when game_end_sec is missing or zero', function () {
    assert.equal(isTimeUp({ game_end_sec: 0 }), false);
    assert.equal(isTimeUp({}), false);
    assert.equal(isTimeUp(null), false);
  });
});

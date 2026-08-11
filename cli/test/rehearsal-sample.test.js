'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { tail, totalSize } = require('../../rehearsal/sample');

test('tail returns the last n entries, oldest first', () => {
  assert.deepStrictEqual(tail([1, 2, 3, 4, 5], 2), [4, 5]);
  assert.deepStrictEqual(tail(['a', 'b', 'c'], 1), ['c']);
});

test('tail returns at most n: oversized n yields the whole array, no leading holes', () => {
  assert.deepStrictEqual(tail([1, 2], 5), [1, 2]);
});

test('tail clamps fractional/negative n instead of reading fractional indices', () => {
  assert.deepStrictEqual(tail([1, 2, 3, 4], 1.5), [4]);
  assert.deepStrictEqual(tail([1, 2, 3], -1), []);
});

test('totalSize sums the size field', () => {
  assert.strictEqual(totalSize([{ size: 10 }, { size: 5 }]), 15);
});

test('totalSize tolerates a missing size field (contributes 0)', () => {
  assert.strictEqual(totalSize([{ size: 2 }, {}, { size: 3 }]), 5);
});

test('totalSize does not let NaN, strings, or null entries poison the sum', () => {
  assert.strictEqual(totalSize([{ size: 10 }, { size: NaN }, { size: 5 }]), 15);
  assert.strictEqual(totalSize([{ size: '10' }, { size: 5 }]), 15);
  assert.strictEqual(totalSize([{ size: 2 }, null, { size: 3 }]), 5);
});

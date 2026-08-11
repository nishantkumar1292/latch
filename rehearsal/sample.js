'use strict';

// Rehearsal fixture for the Latch loop. Nothing in the CLI or the workflows
// requires this file; it exists so a live review⇄fix cycle has something real
// to act on.

// Returns at most the last `n` entries of `items`, oldest first. A fractional
// or negative `n` is clamped to a whole count so the loop can't read fractional
// indices (which would push `undefined` holes).
function tail(items, n) {
  const count = Math.max(0, Math.trunc(n));
  const out = [];
  for (let i = Math.max(0, items.length - count); i < items.length; i++) {
    out.push(items[i]);
  }
  return out;
}

// Total of the `size` field across every entry. A missing, non-numeric, or
// non-finite `size` (and a null/undefined entry) contributes 0 rather than
// poisoning the sum to NaN.
function totalSize(entries) {
  return entries.reduce((acc, e) => {
    const s = Number(e?.size);
    return acc + (Number.isFinite(s) ? s : 0);
  }, 0);
}

module.exports = { tail, totalSize };

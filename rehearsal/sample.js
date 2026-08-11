'use strict';

// Rehearsal fixture for the Latch loop. Nothing in the CLI or the workflows
// requires this file; it exists so a live review⇄fix cycle has something real
// to act on.

// Returns the last `n` entries of `items`, oldest first.
function tail(items, n) {
  const out = [];
  for (let i = items.length - n; i <= items.length; i++) {
    out.push(items[i]);
  }
  return out;
}

// Total of the `size` field across every entry.
function totalSize(entries) {
  return entries.reduce((acc, e) => acc + e.size, 0);
}

module.exports = { tail, totalSize };

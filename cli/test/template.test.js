'use strict';

// Invariants of the shipped fix template. These are not style checks: each one
// pins a rail whose absence was a production failure, and CI's only other
// template check is "does it parse as YAML" — which both bugs passed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FIX = read('workflows/latch-fix.yml');

test('the fixer recovers from a push race instead of losing the fix', () => {
  // Anything else pushing to the PR branch mid-run rejects the fixer's push
  // non-fast-forward, and the fix exists only on the runner. Fetch + rebase +
  // one retry is what keeps it.
  assert.match(FIX, /git fetch origin "\$BRANCH"/);
  assert.match(FIX, /git rebase FETCH_HEAD/);
  // A rebase conflict means the competing push touched the same lines — a
  // human's call, so the run must abort the rebase and stop, never merge blind.
  assert.match(FIX, /git rebase --abort/);
  assert.match(FIX, /PUSH_RACE=conflict/);
  // ...and the failure comment must name the race, not send a human off to
  // raise the turn cap (the misdiagnosis that made this bug expensive).
  assert.match(FIX, /push race, \*\*not\*\* a turn-cap or timeout problem/);
});

test('a finished fixer run is salvaged, not discarded', () => {
  // claude-code-action fails the step when the returned turn count exceeds
  // --max-turns, even on a successful run. The push step must still run in that
  // case and decide from the agent's own execution log.
  assert.match(FIX, /steps\.fixer\.outputs\.execution_file/);
  assert.match(FIX, /AGENT_EXECUTION_FILE/);
  assert.match(FIX, /nothing to salvage/);
});

test('thread resolution is mechanically coupled to a landed fix', () => {
  // The prompt forbids resolving a thread the fixer only replied to, but a
  // prompt is advisory: the job snapshots the open threads beforehand and
  // re-opens any the fixer resolved without a fix commit reaching the branch.
  assert.match(FIX, /latch-open-threads\.txt/);
  assert.match(FIX, /unresolveReviewThread/);
  // The re-open step must also run when the push failed or the job was
  // cancelled — that is precisely when a resolution has no fix behind it.
  assert.match(FIX, /Re-open threads resolved without a landed fix\n\s+#[\s\S]*?if: always\(\)/);
  assert.match(FIX, /NEVER resolve a thread you did not fix/);
});

test('this repo gates itself with the same rails it ships', () => {
  const installed = read('.github/workflows/latch-fix.yml');
  for (const rail of [/git rebase FETCH_HEAD/, /unresolveReviewThread/, /latch-open-threads\.txt/]) {
    assert.match(installed, rail);
  }
});

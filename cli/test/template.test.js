'use strict';

// Invariants of the shipped fix template. These are not style checks: each one
// pins a rail whose absence was a production failure, and CI's only other
// template check is "does it parse as YAML" — which both bugs passed.

const { test } = require('node:test');
const { spawnSync } = require('child_process');
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

test("the salvage filter reads claude-code-action's real log shape", () => {
  // The rail hinges on one assumption about someone else's artifact: the
  // execution log is a top-level array of SDK messages whose result message
  // carries subtype/is_error/num_turns (base-action/src/execution-file.ts
  // writes `JSON.stringify(messages)`). Pin it by running the template's own
  // jq filter over that shape rather than trusting a string match.
  const filter = /jq -r '([\s\S]*?)' \\\n/.exec(FIX);
  assert.ok(filter, 'salvage jq filter found in the template');
  const jqAvailable = spawnSync('jq', ['--version']);
  if (jqAvailable.error) return; // jq absent locally — the runner always has it
  const run = (log) => {
    const r = spawnSync('jq', ['-r', filter[1]], { input: JSON.stringify(log), encoding: 'utf8' });
    return (r.stdout || '').trim();
  };
  const over = [
    { type: 'system', subtype: 'init', session_id: 's' },
    { type: 'assistant' },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 88, total_cost_usd: 4.2 },
  ];
  const errored = [{ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 12 }];
  assert.strictEqual(run(over), '88', 'a completed over-cap run is salvageable');
  assert.strictEqual(run(errored), '', 'a genuinely failed run is not');
  assert.strictEqual(run([{ type: 'assistant' }]), '', 'a log with no result message is not');
});

test('thread resolution is mechanically coupled to a landed fix', () => {
  // The agent must not resolve anything: its side effects happen mid-run and
  // would outlive a run that dies before pushing. The job owns resolution, in
  // both directions, from the snapshot it took before the agent started.
  assert.match(FIX, /latch-open-threads\.txt/);
  assert.match(FIX, /unresolveReviewThread/);
  assert.match(FIX, /Resolving \$tid: its fix is on the branch/);
  // It must also run when the push failed or the job was cancelled — that is
  // precisely when a resolution has no commit behind it.
  assert.match(FIX, /Settle review threads against what actually landed\n\s+#[\s\S]*?if: always\(\)/);
  assert.match(FIX, /do NOT resolve any of them/);
  assert.match(FIX, /NEVER resolve a thread/);
});

test('this repo gates itself with the same rails it ships', () => {
  const installed = read('.github/workflows/latch-fix.yml');
  for (const rail of [/git rebase FETCH_HEAD/, /unresolveReviewThread/, /latch-open-threads\.txt/]) {
    assert.match(installed, rail);
  }
});

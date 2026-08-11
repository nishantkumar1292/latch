'use strict';

// Invariants of the shipped fix template. These are not style checks: each one
// pins a rail whose absence was a production failure, and CI's only other
// template check is "does it parse as YAML" — which both bugs passed.

const { test } = require('node:test');
const { spawnSync } = require('child_process');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanup } = require('./helpers');

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
  // ...and the resolve direction reads the agent's structured list, never its
  // prose: a rail whose premise is "prompts are advisory" cannot decide the
  // dangerous direction by grepping wording.
  assert.match(FIX, /latch-fixed-threads\.txt/);
  assert.match(FIX, /grep -Fxq "\$tid" "\$FIXED_IDS"/);
  // It must also run when the push failed or the job was cancelled — that is
  // precisely when a resolution has no commit behind it.
  assert.match(FIX, /Settle review threads against what actually landed\n\s+#[\s\S]*?if: always\(\)/);
  assert.match(FIX, /do NOT resolve any of them/);
  assert.match(FIX, /NEVER resolve a thread/);
});

// ── The settle step's decision table, exercised for real ─────────────────────
// String matches cannot tell whether the step resolves the RIGHT threads, and
// that decision is the whole rail: a resolution is the loop's only signal that a
// finding was actioned. So run the step's own script under bash against fixture
// GraphQL responses, with `gh` stubbed to serve the fixture through the real jq
// and to record the mutations the step would have sent.
const SETTLE = (() => {
  const m = /\n {6}- name: Settle review threads against what actually landed\n[\s\S]*?\n {8}run: \|\n([\s\S]*?)\n {6}- name: /.exec(FIX);
  assert.ok(m, 'settle step script found in the template');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^ {10}/, ''))
    .join('\n');
})();

const GH_STUB = String.raw`#!/usr/bin/env bash
# Stand-in for gh: log each call on one line, answer the read query from the
# fixture through the real jq, acknowledge mutations.
set -u
args="$*"
printf '%s\n' "$(printf '%s' "$args" | tr '\n' ' ')" >> "$GH_CALLS"
case "$args" in *mutation*) echo '{}'; exit 0;; esac
filter=""
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filter="$2"; shift; done
[ -n "$filter" ] && jq -r "$filter" < "$GH_FIXTURE"
exit 0
`;

const FIX_SHA = 'abc1234def567890abcdef1234567890abcdef12'; // ${sha:0:7} = abc1234
const SHORT = FIX_SHA.slice(0, 7);

// A reviewer finding plus the fixer's reply, in the shape the settle query
// returns (GraphQL drops the "[bot]" suffix from both logins).
const thread = (id, isResolved, resolvedBy, fixerReply) => ({
  id,
  isResolved,
  resolvedBy: resolvedBy ? { login: resolvedBy } : null,
  comments: {
    nodes: [
      { author: { login: 'claude' }, body: 'This drops the error path — see line 12.' },
      { author: { login: 'github-actions' }, body: fixerReply },
    ],
  },
});

function runSettle(threads, { snapshot, fixed, pushed = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-settle-'));
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  write('fixture.json', JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: {
      pageInfo: { hasNextPage: false, endCursor: null }, nodes: threads } } } },
  }));
  write('latch-open-threads.txt', snapshot.map((t) => `${t}\n`).join(''));
  write('latch-fixed-threads.txt', fixed.map((t) => `${t}\n`).join(''));
  write('latch-fix-shas.txt', `${FIX_SHA}\n`);
  write('settle.sh', SETTLE);
  write('gh', GH_STUB);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  const res = spawnSync('bash', [path.join(dir, 'settle.sh')], {
    cwd: dir,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GH_CALLS: path.join(dir, 'calls.log'),
      GH_FIXTURE: path.join(dir, 'fixture.json'),
      OWNER: 'acme',
      REPO: 'widgets',
      PR: '7',
      PUSHED: String(pushed),
    }),
  });
  const logPath = path.join(dir, 'calls.log');
  const calls = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    : [];
  cleanup(dir);
  // Thread ids the step sent each mutation for. `unresolveReviewThread`
  // contains `resolveReviewThread`, so the resolve match excludes it.
  const acted = (kind) => calls
    .filter((c) => ({
      resolve: /(^|[^n])resolveReviewThread/,
      unresolve: /unresolveReviewThread/,
      reply: /addPullRequestReviewThreadReply/,
    }[kind]).test(c))
    .map((c) => (/-F t=(\S+)/.exec(c) || [, ''])[1]);
  return {
    status: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    prComments: calls.filter((c) => c.startsWith('pr comment')),
    acted,
  };
}

test('settle resolves only the threads whose own fix landed', () => {
  if (spawnSync('jq', ['--version']).error) return; // jq absent locally — the runner always has it
  const threads = [
    // Fixed, left open as instructed, on the agent's fixed list: settle resolves.
    thread('T_fixed', false, null, `Fixed in ${SHORT}: guards the empty case.`),
    // Handed off to a human and then wrongly resolved, with a reply that names a
    // real fix SHA for a DIFFERENT finding. The citation is not evidence THIS
    // finding was actioned, so the resolution must not stand.
    thread('T_handoff', true, 'github-actions', `Leaving this for a human — it sits next to the off-by-one I fixed in ${SHORT}.`),
    // Resolved against the prompt, but it IS on the fixed list and cites the
    // landed commit — the resolution is backed, so leave it alone.
    thread('T_listed', true, 'github-actions', `Fixed in ${SHORT}: same guard.`),
    // Open with no fix: the correct state for a hand-off.
    thread('T_open', false, null, 'Disagree: the caller already validates this. Leaving this unresolved for a human.'),
    // A HUMAN resolved this one; not the loop's business, citation or no.
    thread('T_human', true, 'octocat', `Addressed in ${SHORT}.`),
    // An earlier cycle's resolved thread — absent from this run's snapshot.
    thread('T_prior', true, 'github-actions', 'Fixed in 9f8e7d6: earlier cycle.'),
  ];
  const r = runSettle(threads, {
    snapshot: ['T_fixed', 'T_handoff', 'T_listed', 'T_open', 'T_human'],
    fixed: ['T_fixed', 'T_listed'],
  });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.acted('resolve'), ['T_fixed']);
  assert.deepStrictEqual(r.acted('unresolve'), ['T_handoff']);
  // Re-opening silently is not enough: the false claim is contradicted on the
  // thread, where a human reads it.
  assert.deepStrictEqual(r.acted('reply'), ['T_handoff']);
  assert.match(r.out, /threads settled as fixed: 1; re-opened: 1/);
  assert.strictEqual(r.prComments.length, 1, 'the re-open is announced on the PR');
});

test('settle re-opens everything the agent resolved when nothing was pushed', () => {
  if (spawnSync('jq', ['--version']).error) return;
  // The run died before its push (or changed no code), so no resolution in it
  // has a commit behind it — including the one the agent listed as fixed.
  const threads = [
    thread('T_fixed', true, 'github-actions', `Fixed in ${SHORT}: guards the empty case.`),
    thread('T_open', false, null, 'Leaving this unresolved for a human.'),
  ];
  const r = runSettle(threads, { snapshot: ['T_fixed', 'T_open'], fixed: ['T_fixed'], pushed: false });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.acted('resolve'), []);
  assert.deepStrictEqual(r.acted('unresolve'), ['T_fixed']);
});

test('this repo gates itself with the same rails it ships', () => {
  const installed = read('.github/workflows/latch-fix.yml');
  for (const rail of [/git rebase FETCH_HEAD/, /unresolveReviewThread/, /latch-open-threads\.txt/]) {
    assert.match(installed, rail);
  }
});

'use strict';

// The reply-after-push invariant, pinned. A "Fixed in <sha>" reply may exist
// only if <sha> is on the PR branch at the moment it posts — so the agent
// writes a reply PLAN and posts nothing, and the job replays that plan after a
// verified push. These tests exercise the replay step for real (its own script,
// under bash, against fixture plans) because string matches cannot tell whether
// it drops the RIGHT claims, and dropping is the whole rail.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanup } = require('./helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FIX = read('workflows/latch-fix.yml');

// Pull a step's `run:` block out of a template without a YAML dependency: find
// the step by name, then take the indented body under its `run: |`.
function extractRun(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const start = lines.findIndex((l) => l.includes(`name: ${stepName}`));
  assert.ok(start >= 0, `step not found: ${stepName}`);
  const runIdx = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  assert.ok(runIdx > start, `no run block for: ${stepName}`);
  const indent = lines[runIdx].search(/\S/) + 2;
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== '' && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const jqMissing = () => !!spawnSync('jq', ['--version']).error;

// ── Template invariants ──────────────────────────────────────────────────────

test('the agent writes a plan and posts nothing', () => {
  // The ordering IS the guarantee: an agent that can reply can reply before the
  // push, and then die before it. Both mutations must be absent from the prompt
  // and the prompt must say so in as many words.
  assert.match(FIX, /latch-fix-replies\.json/);
  assert.match(FIX, /you do NOT post anything to GitHub/);
  assert.match(FIX, /do NOT resolve any of them/);
  assert.match(FIX, /NEVER resolve a thread/);
  const prompt = /\n {10}prompt: \|\n([\s\S]*?)\n {10}(?:#|claude_args)/.exec(FIX);
  assert.ok(prompt, 'fixer prompt found');
  assert.doesNotMatch(prompt[1], /addPullRequestReviewThreadReply/);
  assert.doesNotMatch(prompt[1], /resolveReviewThread/);
});

test('the push is verified by ancestry before anything may quote it', () => {
  // "The push command exited 0" is not the same claim as "the commit is on the
  // branch". Ancestry against a FRESH fetch is, and the fetch is retried so a
  // network blip cannot decide the run.
  assert.match(FIX, /git merge-base --is-ancestor "\$HEAD_SHA" FETCH_HEAD/);
  assert.match(FIX, /for attempt in 1 2 3; do/);
  // Four states, and `unverified` must stay distinct from `failed`: their
  // remedies are opposites (do NOT re-run vs re-run).
  for (const state of ['state=none', 'state=pushed', 'state=failed', 'state=unverified']) {
    assert.match(FIX, new RegExp(state.replace('=', '=')));
  }
  assert.match(FIX, /the commit is on this branch/);
  assert.match(FIX, /a re-run would redo work that has already landed/);
});

test('the reply phase runs only behind a verified push', () => {
  const step = /- name: Post the thread replies and resolutions\n\s+id: replies\n\s+if: >-\n([\s\S]*?)\n\s+env:/.exec(FIX);
  assert.ok(step, 'reply step condition found');
  assert.match(step[1], /steps\.push\.outputs\.state == 'pushed'/);
  assert.match(step[1], /steps\.push\.outputs\.state == 'none'/);
  assert.doesNotMatch(step[1], /'failed'/);
  assert.doesNotMatch(step[1], /'unverified'/);
});

test('a run that dies after its push never claims nothing was pushed', () => {
  // The phantom-fix cost with the polarity inverted: telling a human "nothing
  // landed" when the fix is on the branch sends them to re-derive it.
  const report = extractRun(FIX, 'Report fixer failure');
  assert.match(report, /PUSH_STATE:?-?\}? = "pushed"|\[ "\$\{PUSH_STATE:-\}" = "pushed" \]/);
  assert.match(report, /is already on this branch/);
});

test('an expiring clock is not the one failure the PR never hears about', () => {
  // Exceeding timeout-minutes CANCELS the job, and a cancellation satisfies
  // neither success() nor failure(). Reply-after-push puts job-side work at the
  // very END of the run, right where the clock runs out — so a reporter on
  // failure() alone would go silent exactly when the fix is on the branch and
  // the threads are half-answered.
  const cond = /- name: Report fixer failure\n[\s\S]*?if: >-\n([\s\S]*?)\n\s+env:/.exec(FIX);
  assert.ok(cond, 'reporter condition found');
  assert.match(cond[1], /failure\(\) \|\| cancelled\(\)/);
  const report = extractRun(FIX, 'Report fixer failure');
  assert.match(report, /JOB_STATUS" = "cancelled"/);
  // ...and the cancelled branch must still lead with the push state, or it
  // tells a human nothing was pushed while the fix sits on the branch.
  const pushedBranch = report.indexOf('is already on this branch');
  const cancelledOnly = report.indexOf('cancelled before it finished');
  assert.ok(pushedBranch > 0 && cancelledOnly > pushedBranch,
    'the push-state branch must be consulted before the cancellation branch');
});

test('the burst precheck asks a narrower question than the guard', () => {
  const precheck = extractRun(FIX, 'Re-check for pending review threads');
  // Unresolved is not the same as pending: a thread the fixer already pushed
  // back on is answered. And a hand dispatch is never a burst duplicate.
  assert.match(precheck, /workflow_dispatch/);
  assert.match(precheck, /proceed=false/);
  assert.match(precheck, /GITHUB_STEP_SUMMARY/);
  // It must come before anything that COSTS anything — its whole point is
  // exiting before the checkout and the agent. Config validation is allowed to
  // precede it (one second of shell, and a configuration Latch cannot run
  // should fail loudly whether or not this event had work in it); nothing else
  // is. Asserted as a prefix rather than as "step 1" so the order of the cheap
  // steps can change without pretending that is a regression.
  const fixJob = FIX.slice(FIX.indexOf('\n  fix:'));
  const names = [...fixJob.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1].trim());
  const at = names.indexOf('Re-check for pending review threads');
  assert.ok(at >= 0, 'the precheck step exists in the fix job');
  assert.deepStrictEqual(names.slice(0, at), ['Validate Latch config'],
    'only config validation may run before the burst early-exit');
  for (const costly of ['Checkout repository', 'Fixer agent', 'Fixer agent (codex)']) {
    assert.ok(names.indexOf(costly) > at, `${costly} must run after the precheck`);
  }
});

test('this repo gates itself with the reply-after-push rails it ships', () => {
  const installed = read('.github/workflows/latch-fix.yml');
  assert.strictEqual(
    installed,
    FIX,
    'the installed copy has drifted from the template it is supposed to be',
  );
});

// ── The precheck's pending filter, exercised for real ────────────────────────

// The pending decision is now two programs: a CONSTANT jq filter that projects
// each thread to a TSV row, and an awk pass that compares the logins it was
// handed through -v. Run both, exactly as the step does, so the assertions are
// about behaviour and not about a string.
function runPending(fixture, { reviewer = 'claude', fixer = 'github-actions' } = {}) {
  const precheck = extractRun(FIX, 'Re-check for pending review threads');
  const jqFilter = /--jq '([\s\S]*?)' \\\n\s*> "\$RUNNER_TEMP\/latch-pending\.tsv"/.exec(precheck);
  assert.ok(jqFilter, 'pending jq filter found');
  const awkProg = /-v fixer="\$FIXER_LOGIN" '([\s\S]*?)' "\$RUNNER_TEMP\/latch-pending\.tsv"/.exec(precheck);
  assert.ok(awkProg, 'pending awk program found');

  const jq = spawnSync('jq', ['-r', jqFilter[1]], { input: JSON.stringify(fixture), encoding: 'utf8' });
  assert.strictEqual(jq.status, 0, jq.stderr);
  const awk = spawnSync('awk', ['-F', '\t', '-v', `rev=${reviewer}`, '-v', `fixer=${fixer}`, awkProg[1]], {
    input: jq.stdout,
    encoding: 'utf8',
  });
  assert.strictEqual(awk.status, 0, awk.stderr);
  return (awk.stdout || '').split('\n').filter(Boolean);
}

test('pending counts unresolved reviewer threads the fixer has not answered', () => {
  if (jqMissing()) return; // jq absent locally — the runner always has it

  const thread = (id, isResolved, opener, latest, body = 'a reply') => ({
    id,
    isResolved,
    opener: { nodes: [{ author: { login: opener } }] },
    latest: { nodes: [{ author: { login: latest }, body }] },
  });
  const fixture = {
    data: { repository: { pullRequest: { reviewThreads: { nodes: [
      // Waiting on a fixer: nobody has answered it.
      thread('T_pending', false, 'claude', 'claude'),
      // Answered by a fixer and left open ON PURPOSE for a human. Unresolved,
      // but not pending — re-answering it is the duplicate-reply waste the
      // whole step exists to stop.
      thread('T_answered', false, 'claude', 'github-actions'),
      // A human replied after that push-back, so it is waiting again. This edge
      // comes free from reading the LAST comment's author.
      thread('T_reopened_by_human', false, 'claude', 'octocat'),
      // Already resolved.
      thread('T_resolved', true, 'claude', 'github-actions'),
      // A human's own thread — never this loop's business.
      thread('T_human', false, 'octocat', 'octocat'),
      // Same as T_answered but with the "[bot]" suffix present on both logins.
      // The two comparisons must strip it symmetrically: an asymmetric one
      // would take pending to 0 on every PR and kill the loop silently.
      thread('T_suffixed', false, 'claude[bot]', 'github-actions[bot]'),
    ] } } } },
  };
  assert.deepStrictEqual(runPending(fixture), ['T_pending', 'T_reopened_by_human']);
});

// ── The reply replay, exercised for real ─────────────────────────────────────

const REPLIES = extractRun(FIX, 'Post the thread replies and resolutions');

const GH_STUB = String.raw`#!/usr/bin/env bash
# Stand-in for gh: record each call on one line, acknowledge the mutation, and
# fail for one nominated thread so the non-fatal path can be exercised.
set -u
args="$*"
printf '%s\n' "$(printf '%s' "$args" | tr '\n' ' ')" >> "$GH_CALLS"
if [ -n "$GH_FAIL_THREAD" ] && printf '%s' "$args" | grep -q "t=$GH_FAIL_THREAD"; then
  echo "gh: simulated API failure" >&2
  exit 1
fi
echo '{}'
exit 0
`;

const FIX_SHA = 'abc1234def567890abcdef1234567890abcdef12';
const SHORT = FIX_SHA.slice(0, 7);

function runReplies(plan, { pushState = 'pushed', failThread = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-replies-'));
  if (plan !== null) {
    fs.writeFileSync(path.join(dir, 'latch-fix-replies.json'), JSON.stringify(plan));
  }
  fs.writeFileSync(path.join(dir, 'replies.sh'), REPLIES);
  fs.writeFileSync(path.join(dir, 'gh'), GH_STUB);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  const res = spawnSync('bash', [path.join(dir, 'replies.sh')], {
    cwd: dir,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GH_CALLS: path.join(dir, 'calls.log'),
      GH_FAIL_THREAD: failThread,
      GITHUB_OUTPUT: path.join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
      PUSH_STATE: pushState,
      FIX_SHA,
      FIX_SHORT: SHORT,
    }),
  });
  const slurp = (name) => (fs.existsSync(path.join(dir, name))
    ? fs.readFileSync(path.join(dir, name), 'utf8')
    : '');
  const calls = slurp('calls.log').split('\n').filter(Boolean);
  const out = {
    status: res.status,
    log: `${res.stdout || ''}${res.stderr || ''}`,
    summary: slurp('summary.md'),
    posted: (/posted=(\d+)/.exec(slurp('output.txt')) || [, null])[1],
    resolvedList: slurp('latch-fixed-threads.txt').split('\n').filter(Boolean),
    // `unresolveReviewThread` contains `resolveReviewThread`; this step never
    // sends the former, but keep the match honest anyway.
    replies: calls
      .filter((c) => /addPullRequestReviewThreadReply/.test(c))
      .map((c) => ({
        thread: (/-f t=(\S+)/.exec(c) || [, ''])[1],
        body: (/-f b=([\s\S]*)$/.exec(c) || [, ''])[1],
      })),
    resolved: calls
      .filter((c) => /(^|[^n])resolveReviewThread/.test(c))
      .map((c) => (/-f t=(\S+)/.exec(c) || [, ''])[1]),
  };
  cleanup(dir);
  return out;
}

test('the job mints the commit claim, and only for a landed fix', () => {
  if (jqMissing()) return;
  const r = runReplies([
    { threadId: 'T_fix', status: 'fixed', body: 'guards the empty case; checks pass.' },
    { threadId: 'T_keep', status: 'kept', body: 'The caller already validates this. Leaving this unresolved for a human.' },
  ]);
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.replies.map((x) => x.thread), ['T_fix', 'T_keep']);
  // The prefix is the STEP's, built from the sha it verified — the agent never
  // wrote a sha anywhere.
  assert.match(r.replies[0].body, new RegExp(`^Fixed in \`${SHORT}\` \\(${FIX_SHA}\\): guards`));
  assert.strictEqual(r.replies[1].body.startsWith('The caller'), true);
  // Only the fixed thread is resolved, and the record the settle step reads is
  // written here — by the job that did the resolving, not by the agent.
  assert.deepStrictEqual(r.resolved, ['T_fix']);
  assert.deepStrictEqual(r.resolvedList, ['T_fix']);
  assert.strictEqual(r.posted, '2');
});

test('a fix claim with no push behind it is dropped, not posted', () => {
  if (jqMissing()) return;
  // The agent committed nothing, so every entry should have been "kept". A
  // stray "fixed" must not become a claim about a branch that never moved.
  const r = runReplies([
    { threadId: 'T_fix', status: 'fixed', body: 'guards the empty case.' },
    { threadId: 'T_keep', status: 'kept', body: 'Belongs on the migration branch, not here.' },
  ], { pushState: 'none' });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.replies.map((x) => x.thread), ['T_keep']);
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.posted, '1');
  assert.match(r.log, /Unbacked fix claim dropped/);
});

test('a body that dates its own claim to a commit is dropped on both channels', () => {
  if (jqMissing()) return;
  // The minted prefix is only half the invariant: a `kept` body is posted
  // verbatim, so an agent writing "already fixed in <sha>" into one would
  // republish the exact phantom-fix string on a run that committed nothing.
  const r = runReplies([
    { threadId: 'T_a', status: 'kept', body: `Already fixed in ${SHORT}, nothing to do here.` },
    { threadId: 'T_b', status: 'fixed', body: `same guard as the one I addressed in ${SHORT}` },
    // The preposition set has to be wide: "fixed by", "landed via", "resolved
    // with" all date a claim to a commit exactly as well as "fixed in" does.
    { threadId: 'T_c', status: 'kept', body: `Fixed by ${SHORT} on the base branch. Leaving this for a human.` },
    { threadId: 'T_d', status: 'kept', body: `superseded — resolved with ${SHORT}` },
    { threadId: 'T_e', status: 'fixed', body: 'rewrote the loop to bail on an empty bank; checks pass.' },
  ]);
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.replies.map((x) => x.thread), ['T_e']);
  assert.deepStrictEqual(r.resolved, ['T_e']);
  assert.strictEqual(r.posted, '1');
  // Dropped, but never silently: the text a human was meant to read survives in
  // the step summary.
  assert.match(r.summary, /Dropped a self-minted commit claim on thread `T_a`/);
  assert.match(r.summary, /Already fixed in/);
});

test('ordinary prose that merely contains hex-ish words still posts', () => {
  if (jqMissing()) return;
  // The guard is deliberately narrower than "any 7+ hex-ish word": English is
  // full of all-[a-f] words, and blanket-dropping legitimate replies has its
  // own cost — an unanswered thread costs a whole cycle.
  const r = runReplies([
    { threadId: 'T_ok', status: 'kept', body: 'The defaced fixture is deliberate; the parser acceded to it before this PR too.' },
  ], { pushState: 'none' });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.replies.map((x) => x.thread), ['T_ok']);
});

test('one flaky thread does not take down the replay', () => {
  if (jqMissing()) return;
  // These mutations used to live in the agent, which could see a 502 and retry.
  // Moving them job-side moved them out of anything that can, so a single
  // rate-limited response must not abort the phase and strand the fix.
  const r = runReplies([
    { threadId: 'T_a', status: 'fixed', body: 'first fix; checks pass.' },
    { threadId: 'T_flaky', status: 'kept', body: 'Disagree; leaving this for a human.' },
    { threadId: 'T_c', status: 'fixed', body: 'second fix; parse only, no toolchain here.' },
  ], { failThread: 'T_flaky' });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.resolved, ['T_a', 'T_c']);
  assert.strictEqual(r.posted, '2');
  assert.match(r.log, /Reply failed/);
  assert.match(r.summary, /left open for the next cycle/);
});

test('malformed and unknown-status entries are skipped, not guessed at', () => {
  if (jqMissing()) return;
  const r = runReplies([
    { threadId: '', status: 'fixed', body: 'no thread id' },
    { threadId: 'T_nobody', status: 'kept' },
    { threadId: 'T_weird', status: 'resolved-ish', body: 'neither fixed nor kept' },
    { threadId: 'T_ok', status: 'kept', body: 'Leaving this unresolved for a human.' },
  ], { pushState: 'none' });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.replies.map((x) => x.thread), ['T_ok']);
  assert.match(r.log, /Malformed reply skipped/);
  assert.match(r.log, /Unknown status skipped/);
});

test('a missing plan fails loudly instead of consuming a cycle quietly', () => {
  if (jqMissing()) return;
  // No plan means the agent's whole output is gone — every reply and, more
  // expensively, every case-(b) judgement it spent the run forming. Exiting
  // green here would let the next step spend a cycle, re-dispatch the review
  // and report success with not one thread answered.
  for (const plan of [null, { notAnArray: true }]) {
    const r = runReplies(plan);
    assert.strictEqual(r.status, 1, r.log);
    assert.match(r.log, /No reply plan/);
    assert.strictEqual(r.posted, '0');
    assert.deepStrictEqual(r.replies, []);
  }
});

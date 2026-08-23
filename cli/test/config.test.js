'use strict';

// Config-surface invariants of the shipped templates. Repo Variables are the
// one thing a customer can change without editing a workflow, and they land
// inside the agent's own command line — so every one of them is validated
// before use, and none of them may be interpolated raw into an argument list.
// These tests pin that, plus the silent-failure guards around it.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FIX = read('workflows/latch-fix.yml');
const REVIEW = read('workflows/latch-review.yml');

// Pull a step's `run:` block out of a template without a YAML dependency:
// find the step by name, then take the indented body under its `run: |`.
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

// Every `vars.X` in a template must be either (a) assigned to an env var, where
// the runner sets it directly and no shell or argument parser sees it, or (b)
// wrapped in fromJSON, which asserts it is JSON-numeric. A bare interpolation
// into claude_args is the flag-injection hole this pins shut.
test('no repo variable is interpolated raw into the templates', () => {
  for (const [name, text] of [['latch-fix.yml', FIX], ['latch-review.yml', REVIEW]]) {
    const offenders = text
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => /\$\{\{[^}]*vars\./.test(l))
      .filter((l) => !/^\s*[A-Za-z_][A-Za-z0-9_]*: \$\{\{ vars\.[A-Z_]+ \}\}\s*$/.test(l))
      .filter((l) => !/fromJSON\(/.test(l));
    assert.deepStrictEqual(offenders, [], `${name} interpolates a variable without validation`);
  }
});

// The stronger form of the rule above, and the one the new variables needed: a
// repo variable must never appear inside a `run:` BODY. The line-shape filter in
// the previous test allows an env assignment, which is the safe carrier; this
// one proves nothing skipped the carrier and landed in a shell script, a jq
// filter, or an awk program, where quoting is the only thing between a repo
// setting and arbitrary execution.
test('no repo variable reaches a shell script body', () => {
  for (const [name, text] of [['latch-fix.yml', FIX], ['latch-review.yml', REVIEW]]) {
    const lines = text.split('\n');
    const offenders = [];
    let indent = null; // set while inside a `run: |` block
    for (const line of lines) {
      if (indent !== null) {
        if (line.trim() !== '' && line.search(/\S/) < indent) indent = null;
        else {
          if (/vars\./.test(line) && !line.trim().startsWith('#')) offenders.push(line.trim());
          continue;
        }
      }
      const m = /^(\s*)run: \|\s*$/.exec(line);
      if (m) indent = m[1].length + 2;
    }
    assert.deepStrictEqual(offenders, [], `${name}: a repo variable reaches a run: body`);
  }
});

// Each variable in the schema must be READ somewhere (a dead variable the
// console offers is a lie about what the loop honours) and, if it is free text,
// must be validated by a config step rather than used raw.
test('every documented variable is actually consumed, and the free-text ones are validated', () => {
  const both = FIX + REVIEW;
  const consumed = [
    // kill switch + numbers: read in job `if:`/expressions, not in a shell
    ['LATCH_PAUSED', /vars\.LATCH_PAUSED != 'true'/],
    ['LATCH_MAX_TURNS', /fromJSON\(vars\.LATCH_MAX_TURNS/],
    ['LATCH_MAX_FIX_CYCLES', /fromJSON\(vars\.LATCH_MAX_FIX_CYCLES/],
    ['LATCH_TIMEOUT_MINUTES', /fromJSON\(vars\.LATCH_TIMEOUT_MINUTES/],
  ];
  for (const [name, re] of consumed) {
    assert.match(both, re, `${name} is documented but never read`);
  }
  // Free text: carried into a config step by env, then token-checked there.
  for (const name of ['LATCH_PROVIDER', 'LATCH_MODEL', 'LATCH_FIX_MODEL', 'LATCH_EFFORT',
    'LATCH_REVIEW_EFFORT', 'LATCH_VERDICT_STATUS', 'LATCH_VERDICT_CONTEXT',
    'LATCH_REVIEW_LOGIN', 'LATCH_DOCTRINE']) {
    assert.match(both, new RegExp(`^\\s+${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, 'm'),
      `${name} is never carried into a config step by env`);
    // Either the shared `reject` helper, or its own refusal with the same
    // shape — LATCH_PROVIDER is an enum, so it names the two runnable values
    // instead of describing a token.
    assert.ok(new RegExp(`reject ${name} `).test(both) || new RegExp(`title=Invalid ${name}`).test(both),
      `${name} is never validated`);
  }
  // Both templates document the whole schema, so an operator reading either one
  // sees every knob rather than half of it.
  for (const [name, text] of [['latch-fix.yml', FIX], ['latch-review.yml', REVIEW]]) {
    for (const v of ['LATCH_PAUSED', 'LATCH_PROVIDER', 'LATCH_MODEL', 'LATCH_FIX_MODEL',
      'LATCH_REVIEW_LOGIN', 'LATCH_DOCTRINE', 'LATCH_TIMEOUT_MINUTES']) {
      assert.ok(text.includes(`# ${v}`) || text.includes(`# ${v} `) || new RegExp(`#.*${v}`).test(text),
        `${name} does not document ${v}`);
    }
  }
});

test('the agent runs on validated model/effort values, never on vars directly', () => {
  for (const text of [FIX, REVIEW]) {
    assert.match(text, /--model \$\{\{ steps\.cfg\.outputs\.model \}\}/);
    assert.match(text, /--effort \$\{\{ steps\.cfg\.outputs\.effort \}\}/);
    assert.doesNotMatch(text, /--model \$\{\{ vars\./);
    assert.doesNotMatch(text, /--effort \$\{\{ vars\./);
  }
});

// The behavioural half: run the shipped validation script the way the runner
// would. The injection value is the real one found in review — a repo variable
// that would otherwise add `--dangerously-skip-permissions` to the agent's
// arguments.
test('the config step refuses a flag-injecting variable and keeps the zero-config path', () => {
  const script = extractRun(FIX, 'Validate Latch config');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-cfg-'));
  const run = (env) => {
    const out = path.join(dir, 'out.txt');
    fs.writeFileSync(out, '');
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { GITHUB_OUTPUT: out }, env),
    });
    return { status: r.status, stderr: r.stdout + r.stderr, outputs: fs.readFileSync(out, 'utf8') };
  };
  try {
    // zero config — no variables set at all — must behave exactly as documented
    const bare = run({ LATCH_MODEL: '', LATCH_EFFORT: '' });
    assert.strictEqual(bare.status, 0, bare.stderr);
    assert.match(bare.outputs, /model=claude-opus-4-8/);
    assert.match(bare.outputs, /effort=high/);

    // a legitimate override still works
    assert.strictEqual(run({ LATCH_MODEL: 'claude-sonnet-4-5', LATCH_EFFORT: 'medium' }).status, 0);

    // ...and every shape that could add an argument is refused, loudly
    for (const bad of [
      'claude-opus-4-8 --dangerously-skip-permissions', // the case found in review
      '--dangerously-skip-permissions', // all-allowed chars, but dash-led
      'opus\n--dangerously-skip-permissions',
      'foo" --bad',
      'foo;rm -rf /',
    ]) {
      const r = run({ LATCH_MODEL: bad, LATCH_EFFORT: '' });
      assert.strictEqual(r.status, 1, `should refuse: ${JSON.stringify(bad)}`);
      assert.match(r.stderr, /::error title=Invalid LATCH_MODEL/);
      assert.strictEqual(r.outputs.trim(), '', 'a refused value must publish no output');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a fixer that runs out of wall clock still reports', () => {
  // Exceeding timeout-minutes CANCELS the job, which satisfies neither
  // success() nor failure() — without cancelled() the loop stalls in silence.
  // The HANDLED gate stays on that condition: the push step still owns the
  // causes it can name, so this reporter must not double-post over it.
  // Asserted by SHAPE, not by one exact line: reply-after-push added an
  // `unverified` exclusion to this same `if:` and wrapped it across lines. What
  // must hold is the union — cancelled() is honoured, the HANDLED gate
  // survives, and the state that owns its own comment is excluded.
  const cond = /- name: Report fixer failure\n[\s\S]*?if: >-\n([\s\S]*?)\n\s+env:/.exec(FIX);
  assert.ok(cond, 'reporter condition found');
  assert.match(cond[1], /\(failure\(\) \|\| cancelled\(\)\)/);
  assert.match(cond[1], /env\.HANDLED != 'true'/);
  assert.match(cond[1], /steps\.push\.outputs\.state != 'unverified'/);
  assert.match(FIX, /JOB_STATUS: \$\{\{ job\.status \}\}/);
  assert.match(FIX, /LATCH_TIMEOUT_MINUTES/);
  // ...and the cancelled branch must say "timeout", name the variable that
  // raises it, and NOT reach for the push-race causes, which apply only to a
  // run that actually failed. It returns rather than falling through.
  assert.match(FIX, /if \[ "\$JOB_STATUS" = "cancelled" \]; then[\s\S]*?ran past the job timeout[\s\S]*?LATCH_TIMEOUT_MINUTES[\s\S]*?exit 0\n\s+fi/);
  assert.match(FIX, /exit 0\n\s+fi\n\s+# Name the ACTUAL cause[\s\S]*?case "\$\{PUSH_RACE:-\}" in/);
});

test('the fixer queues and is never cancelled mid-push', () => {
  // A workflow-level group is claimed before job ifs evaluate, so it could
  // cancel a fixer mid-push on an event the guard would have skipped.
  assert.doesNotMatch(FIX, /^concurrency:$/m);
  assert.match(FIX, /group: latch-fix-guard-\$\{\{[\s\S]*?cancel-in-progress: true/);
  assert.match(FIX, /group: latch-fix-run-\$\{\{[\s\S]*?cancel-in-progress: false/);
});

test("the guard's actionable check walks every page of threads", () => {
  // scoped to the guard's own query, so the assertion cannot be satisfied by
  // some other paginated call elsewhere in the file
  const guardCheck = FIX.slice(FIX.indexOf('Actionable check'), FIX.indexOf('unresolved review-bot threads'));
  assert.match(guardCheck, /gh api graphql --paginate/);
  assert.match(guardCheck, /pageInfo\{ hasNextPage endCursor \}/);
  // and no unpaginated thread query survives anywhere in the template
  assert.doesNotMatch(FIX, /reviewThreads\(first:100\)\{/);
});

test('this repo runs exactly the templates it ships', () => {
  // Drift here is invisible and expensive: the repo's own gate silently lags
  // the product (it once missed two guard fixes and its escalation comment
  // died on permissions).
  assert.strictEqual(read('.github/workflows/latch-fix.yml'), FIX, '.github fix copy has drifted');
  assert.strictEqual(read('.github/workflows/latch-review.yml'), REVIEW, '.github review copy has drifted');
});

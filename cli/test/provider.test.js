'use strict';

// The config surface the web console drives: the kill switch, the provider
// select, the verdict status, the model fallback, and the two codex legs'
// contract with the provider-agnostic machinery around them.
//
// Every one of these pins something whose failure mode is SILENT. A paused loop
// with one un-paused job still spends money; a provider select that gates the
// wrong step runs two agents or none; a `skipped` step read as a failure makes
// every codex fix quietly skip its push. CI's only other template check is
// "does it parse as YAML", which all of those pass. So where a rule is
// behaviour, this file executes it — the real jq, the real awk, the real shell —
// rather than matching a string that happens to be present.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLI, cleanup } = require('./helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FIX = read('workflows/latch-fix.yml');
const REVIEW = read('workflows/latch-review.yml');
const TEMPLATES = [['latch-fix.yml', FIX], ['latch-review.yml', REVIEW]];

const missing = (bin, args) => spawnSync(bin, args || ['--version']).error != null;

// ── extraction helpers ───────────────────────────────────────────────────────

// A step's `run:` body, dedented. Same approach as config.test.js: find the
// step by name, take the indented block under its `run: |`.
function extractRun(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const start = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
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

// A script lifted out of a template still carries GitHub's `${{ }}` expressions,
// which bash cannot parse. Substitute the few the runner would have expanded, so
// the test exercises the real logic instead of a rewritten copy of it.
function render(script) {
  return script
    .replace(/\$\{\{ github\.repository \}\}/g, 'acme/widgets')
    .replace(/\$\{\{ github\.server_url \}\}/g, 'https://github.com')
    .replace(/\$\{\{ github\.run_id \}\}/g, '4242');
}

// Split a template into its jobs: id -> text, taken from the `jobs:` block only
// (so 2-space keys under `on:` are not mistaken for job ids).
function jobs(yamlText) {
  const body = yamlText.slice(yamlText.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const out = {};
  const ids = [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_-]*):$/gm)];
  ids.forEach((m, i) => {
    const end = i + 1 < ids.length ? ids[i + 1].index : body.length;
    out[m[1]] = body.slice(m.index, end);
  });
  return out;
}

// Every step block in a template, split on the `- name:` boundary.
function steps(yamlText) {
  return yamlText.split(/\n(?= {6}- name: )/).slice(1);
}

// A shell stub that logs its argv one call per line and answers a few reads.
function ghStub(extra) {
  return `#!/usr/bin/env bash
set -u
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> "$GH_CALLS"
${extra || ''}
exit 0
`;
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-provider-'));
  return {
    dir,
    write(name, body, mode) {
      const abs = path.join(dir, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
      if (mode) fs.chmodSync(abs, mode);
      return abs;
    },
    calls() {
      const p = path.join(dir, 'calls.log');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    },
    done() {
      cleanup(dir);
    },
  };
}

// ── 1. the kill switch ───────────────────────────────────────────────────────

test('LATCH_PAUSED gates every job in both templates', () => {
  // The failure this exists to catch is a NEW job added without the clause: a
  // pause that skips three jobs out of four is not a pause, and nothing else in
  // CI would notice. So the assertion walks whatever jobs the file declares
  // rather than a list written here...
  const expected = { 'latch-fix.yml': ['guard', 'fix'], 'latch-review.yml': ['review', 'review-on-demand', 'dispatch-fix'] };
  for (const [name, text] of TEMPLATES) {
    const found = jobs(text);
    const ids = Object.keys(found);
    for (const id of ids) {
      const cond = /\n {4}if: (?:>-\n)?([\s\S]*?)\n {4}[a-z]/.exec(found[id]);
      assert.ok(cond, `${name}: job ${id} has no job-level if:`);
      assert.match(cond[1], /vars\.LATCH_PAUSED != 'true'/,
        `${name}: job ${id} is not gated on LATCH_PAUSED — a pause that skips some jobs is not a pause`);
    }
    // ...and this pins the SET, so adding a job is a deliberate edit here too,
    // not something that slips past because the loop above happened to be empty.
    assert.deepStrictEqual(ids, expected[name], `${name}: job list changed`);
  }
});

test('the paused loop publishes no verdict, and says so', () => {
  // The honest consequence, documented where an operator will hit it: a team
  // that made the verdict a required check finds merges blocked while paused.
  // Papering over that with a success status is the one thing we will not do.
  assert.match(REVIEW, /PAUSING IS HONEST/);
  assert.match(REVIEW, /REQUIRED check in branch protection, pausing Latch BLOCKS/);
  assert.match(REVIEW, /deliberately do NOT post a success status while paused/);
  // The switch must sit on the job `if:`, not in a step: a step gate still pays
  // for a runner to decide it had nothing to do.
  for (const [, text] of TEMPLATES) {
    assert.doesNotMatch(text, /^\s+if: .*steps\..*LATCH_PAUSED/m);
  }
});

// ── 2. the provider select ───────────────────────────────────────────────────

test('every agent step is gated on exactly one provider', () => {
  const AGENTS = /uses: (anthropics\/claude-code-action|openai\/codex-action)@/;
  let claude = 0;
  let codex = 0;
  for (const [name, text] of TEMPLATES) {
    for (const step of steps(text)) {
      const agent = AGENTS.exec(step);
      if (!agent) continue;
      const stepName = /- name: (.+)/.exec(step)[1].trim();
      const want = agent[1] === 'openai/codex-action' ? 'codex' : 'claude';
      const other = want === 'codex' ? 'claude' : 'codex';
      assert.match(step, new RegExp(`if:[^\\n]*steps\\.cfg\\.outputs\\.provider == '${want}'`),
        `${name}: agent step "${stepName}" is not gated on provider == '${want}'`);
      assert.doesNotMatch(step, new RegExp(`provider == '${other}'`),
        `${name}: agent step "${stepName}" claims both providers`);
      if (want === 'codex') codex++; else claude++;
    }
  }
  // review + on-demand + fixer for claude; review + fixer for codex. Both legs
  // covered, and no ungated agent anywhere.
  assert.strictEqual(claude, 3, 'claude agent steps');
  assert.strictEqual(codex, 2, 'codex agent steps');
});

test('an invalid provider fails loudly at config time', () => {
  for (const [name, text] of TEMPLATES) {
    const script = extractRun(text, 'Validate Latch config');
    const s = sandbox();
    try {
      const run = (env) => {
        const out = s.write('out.txt', '');
        const r = spawnSync('bash', ['-c', script], {
          encoding: 'utf8',
          env: Object.assign({}, process.env, { GITHUB_OUTPUT: out }, env),
        });
        return { status: r.status, log: (r.stdout || '') + (r.stderr || ''), outputs: fs.readFileSync(out, 'utf8') };
      };
      // Both spellings run; nothing else does, and the refusal names the value.
      assert.strictEqual(run({ LATCH_PROVIDER: '' }).status, 0, `${name}: unset provider must work`);
      assert.match(run({ LATCH_PROVIDER: '' }).outputs, /provider=claude/);
      assert.strictEqual(run({ LATCH_PROVIDER: 'codex' }).status, 0);
      assert.match(run({ LATCH_PROVIDER: 'codex' }).outputs, /provider=codex/);
      for (const bad of ['gpt', 'CLAUDE', 'claude,codex', 'claude codex', '--provider']) {
        const r = run({ LATCH_PROVIDER: bad });
        assert.strictEqual(r.status, 1, `${name}: should refuse provider ${JSON.stringify(bad)}`);
        assert.match(r.log, /::error title=Invalid LATCH_PROVIDER/);
        assert.strictEqual(r.outputs.trim(), '', 'a refused config must publish no output');
      }
    } finally {
      s.done();
    }
  }
});

// ── 3. the fixer's model fallback ────────────────────────────────────────────

test('the fixer model falls back LATCH_FIX_MODEL -> LATCH_MODEL -> provider default', () => {
  const script = extractRun(FIX, 'Validate Latch config');
  const s = sandbox();
  try {
    const cfg = (env) => {
      const out = s.write('out.txt', '');
      const r = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          GITHUB_OUTPUT: out,
          LATCH_PROVIDER: '', LATCH_MODEL: '', LATCH_FIX_MODEL: '', LATCH_EFFORT: '',
        }, env),
      });
      const outputs = fs.readFileSync(out, 'utf8');
      const m = /^model=(.*)$/m.exec(outputs);
      return { status: r.status, log: (r.stdout || '') + (r.stderr || ''), model: m ? m[1] : null };
    };

    // claude: default, then LATCH_MODEL, then LATCH_FIX_MODEL winning over it.
    assert.strictEqual(cfg({}).model, 'claude-opus-4-8');
    assert.strictEqual(cfg({ LATCH_MODEL: 'claude-sonnet-4-5' }).model, 'claude-sonnet-4-5');
    assert.strictEqual(cfg({ LATCH_MODEL: 'claude-sonnet-4-5', LATCH_FIX_MODEL: 'claude-haiku-4-5' }).model, 'claude-haiku-4-5');
    assert.strictEqual(cfg({ LATCH_FIX_MODEL: 'claude-haiku-4-5' }).model, 'claude-haiku-4-5');

    // codex: the last step of the fallback is EMPTY, so the action passes no
    // model input and the provider's own default applies. An install that sets
    // nothing must not be handed a version string this template guessed at.
    assert.strictEqual(cfg({ LATCH_PROVIDER: 'codex' }).model, '');
    assert.strictEqual(cfg({ LATCH_PROVIDER: 'codex', LATCH_MODEL: 'gpt-5-codex' }).model, 'gpt-5-codex');
    assert.strictEqual(cfg({ LATCH_PROVIDER: 'codex', LATCH_MODEL: 'gpt-5-codex', LATCH_FIX_MODEL: 'o4-mini' }).model, 'o4-mini');

    // ...and the rejection names the variable the operator actually has to fix,
    // not whichever one the fallback happened to land on.
    const bad = cfg({ LATCH_FIX_MODEL: 'claude-opus-4-8 --dangerously-skip-permissions' });
    assert.strictEqual(bad.status, 1);
    assert.match(bad.log, /::error title=Invalid LATCH_FIX_MODEL/);
  } finally {
    s.done();
  }
});

// ── 4. the verdict status ────────────────────────────────────────────────────

// Run the real publish step against a verdict file, with `gh` stubbed, and read
// back the status it would have posted.
function publish(env, verdictFile) {
  const script = render(extractRun(REVIEW, 'Publish the verdict status'));
  const s = sandbox();
  try {
    s.write('gh', ghStub(), 0o755);
    if (verdictFile !== null) s.write('latch-verdict.txt', verdictFile);
    const summary = s.write('summary.md', '');
    const r = spawnSync('bash', ['-c', script], {
      cwd: s.dir,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        PATH: `${s.dir}${path.delimiter}${process.env.PATH}`,
        RUNNER_TEMP: s.dir,
        GH_CALLS: path.join(s.dir, 'calls.log'),
        GITHUB_STEP_SUMMARY: summary,
        PR: '7',
        HEAD_SHA_EVENT: 'deadbee',
        VERDICT_CONTEXT: '',
        VERDICT_STATUS: '',
      }, env),
    });
    const calls = s.calls();
    return {
      status: r.status,
      log: (r.stdout || '') + (r.stderr || ''),
      posts: calls.filter((c) => c.includes('/statuses/')),
      summary: fs.readFileSync(summary, 'utf8'),
    };
  } finally {
    s.done();
  }
}

test('the verdict context defaults to latch/merge-gate and is configurable', () => {
  const merge = 'MERGE\nall claims held up\n';
  const dflt = publish({}, merge);
  assert.strictEqual(dflt.status, 0, dflt.log);
  assert.strictEqual(dflt.posts.length, 1);
  assert.match(dflt.posts[0], /-f context=latch\/merge-gate/);
  assert.match(dflt.posts[0], /-f state=success/);

  // A `/` is legal here precisely because the value is a quoted `-f` FIELD, not
  // an argument — so a context with a slash must survive intact.
  const custom = publish({ VERDICT_CONTEXT: 'acme/latch-gate' }, merge);
  assert.match(custom.posts[0], /-f context=acme\/latch-gate/);

  // The context must come from the validated config output, never a raw var.
  assert.match(REVIEW, /VERDICT_CONTEXT: \$\{\{ steps\.cfg\.outputs\.verdict_context \}\}/);
  assert.doesNotMatch(REVIEW, /context=\$\{\{ vars\./);
  // MERGE-WITH-FIXES must not be clipped to MERGE by the scan.
  const fixes = publish({}, 'MERGE-WITH-FIXES\ntwo producer/consumer gaps\n');
  assert.match(fixes.posts[0], /-f state=failure/);
  assert.match(fixes.posts[0], /MERGE-WITH-FIXES/);
});

test('LATCH_VERDICT_STATUS=off computes the verdict, publishes nothing, and loses nothing', () => {
  const off = publish({ VERDICT_STATUS: 'off' }, 'DO-NOT-MERGE\nunbounded query in a request handler\n');
  assert.strictEqual(off.status, 0, off.log);
  assert.deepStrictEqual(off.posts, [], 'no commit status may be published while the verdict is off');
  // Computed and said out loud...
  assert.match(off.log, /LATCH_VERDICT_STATUS=off/);
  assert.match(off.log, /was COMPUTED/);
  assert.match(off.log, /DO-NOT-MERGE/);
  // ...and kept where a human can still read it. A verdict that exists only in
  // a step that decided not to publish it is a verdict nobody has.
  assert.match(off.summary, /Latch verdict/);
  assert.match(off.summary, /failure/);
  assert.match(off.summary, /unbounded query in a request handler/);
  assert.match(off.summary, /LATCH_VERDICT_STATUS=off/);

  // On by default, and the summary carries the verdict either way.
  const on = publish({}, 'MERGE\nheld up\n');
  assert.strictEqual(on.posts.length, 1);
  assert.match(on.summary, /Latch verdict/);
});

test('a review that produced no verdict gets an honest error, not silence', () => {
  const none = publish({}, null);
  assert.strictEqual(none.posts.length, 1);
  assert.match(none.posts[0], /-f state=error/);
  assert.match(none.posts[0], /did not produce a verdict/);
});

// ── 5. the codex review leg's contract ───────────────────────────────────────

// Run the real "Post the codex review" step over a fixture codex output.
function postCodexReview(output, env) {
  const script = render(extractRun(REVIEW, 'Post the codex review'));
  const s = sandbox();
  try {
    s.write('gh', ghStub('case "$*" in *"/reviews"*) cat >/dev/null;; esac'), 0o755);
    if (output !== null) s.write('codex-review.json', JSON.stringify(output));
    const out = s.write('out.txt', '');
    const summary = s.write('summary.md', '');
    const r = spawnSync('bash', ['-c', script], {
      cwd: s.dir,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        PATH: `${s.dir}${path.delimiter}${process.env.PATH}`,
        RUNNER_TEMP: s.dir,
        GH_CALLS: path.join(s.dir, 'calls.log'),
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: summary,
        PR: '7',
        OWN_IDENTITY: 'false',
        SUMMARY_SUFFIX: 'a human merges.',
      }, env),
    });
    const verdictPath = path.join(s.dir, 'latch-verdict.txt');
    return {
      status: r.status,
      log: (r.stdout || '') + (r.stderr || ''),
      outputs: fs.readFileSync(out, 'utf8'),
      summary: fs.readFileSync(summary, 'utf8'),
      reviews: s.calls().filter((c) => c.includes('/reviews')),
      verdict: fs.existsSync(verdictPath) ? fs.readFileSync(verdictPath, 'utf8') : null,
      done: () => s.done(),
    };
  } finally {
    /* the sandbox is read back above, then dropped by the caller's finally */
    s.done();
  }
}

const CODEX_OK = {
  verdict: 'MERGE-WITH-FIXES',
  summary: 'two producer/consumer gaps; see inline threads',
  findings: [
    { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'this drops the error path' },
    { path: 'src/b.ts', line: 3, side: 'LEFT', body: 'nothing reads this field' },
  ],
};

test('the codex review posts ONE review and writes the verdict file the publish step reads', () => {
  const r = postCodexReview(CODEX_OK, {});
  assert.strictEqual(r.status, 0, r.log);
  // One review, event=COMMENT, with the inline comments in it.
  assert.strictEqual(r.reviews.length, 1, 'exactly one review call');
  assert.match(r.reviews[0], /-X POST repos\/acme\/widgets\/pulls\/7\/reviews/);
  assert.match(r.reviews[0], /--input -/);
  assert.match(r.outputs, /posted=2/);
  // THE CONTRACT: the same two-line file the claude path writes, at the same
  // path the provider-agnostic publish step reads. Asserted by round-trip, not
  // by eyeballing two literals in two steps.
  assert.strictEqual(r.verdict, 'MERGE-WITH-FIXES\ntwo producer/consumer gaps; see inline threads\n');
  const published = publish({}, r.verdict);
  assert.match(published.posts[0], /-f state=failure/);
  assert.match(published.posts[0], /MERGE-WITH-FIXES/);
});

test('malformed codex findings are skipped, never guessed at', () => {
  const r = postCodexReview({
    verdict: 'MERGE-WITH-FIXES',
    summary: 'one usable finding',
    findings: [
      { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'real finding' },
      { path: '', line: 4, side: 'RIGHT', body: 'no path' },
      { path: 'src/b.ts', line: 'twelve', side: 'RIGHT', body: 'line is not a number' },
      { path: 'src/c.ts', line: 9, side: 'RIGHT', body: '' },
    ],
  }, {});
  assert.strictEqual(r.status, 0, r.log);
  assert.match(r.outputs, /posted=1/);
  assert.match(r.log, /Malformed codex findings skipped/);
  assert.match(r.summary, /skipped 3 of 4/);
});

test('a codex verdict outside the three tokens writes no verdict file', () => {
  // Better an honest `error` gate than a status invented from a value the agent
  // was told not to return.
  const r = postCodexReview({ verdict: 'LGTM', summary: 'ship it', findings: [] }, {});
  assert.strictEqual(r.verdict, null);
  assert.match(r.log, /Codex verdict unusable/);
});

test('a codex run with no output fails instead of consuming the hop', () => {
  const r = postCodexReview(null, {});
  assert.strictEqual(r.status, 1);
  assert.match(r.log, /No codex review output/);
  assert.match(r.outputs, /dispatch_fix=false/);
});

// ── 6. the review -> fix hop cannot double-fire ──────────────────────────────

test('dispatch-fix fires only for a GITHUB_TOKEN review that posted findings', () => {
  // findings + GITHUB_TOKEN identity -> the event does NOT fire, so dispatch.
  assert.match(postCodexReview(CODEX_OK, { OWN_IDENTITY: 'false' }).outputs, /dispatch_fix=true/);
  // A distinct review identity fires `pull_request_review` naturally; dispatching
  // as well would run the fixer TWICE on one review.
  const own = postCodexReview(CODEX_OK, { OWN_IDENTITY: 'true' });
  assert.match(own.outputs, /dispatch_fix=false/);
  assert.match(own.log, /not dispatching the fixer/);
  // A clean review has nothing to fix — that is how the loop TERMINATES.
  const clean = postCodexReview({ verdict: 'MERGE', summary: 'clean', findings: [] }, {});
  assert.match(clean.outputs, /dispatch_fix=false/);

  // And the job itself is gated on that output, never on `always()`.
  const dispatch = jobs(REVIEW)['dispatch-fix'];
  const dispatchIf = /\n {4}if: (.+)/.exec(dispatch);
  assert.ok(dispatchIf, 'dispatch-fix has a job-level if:');
  assert.match(dispatchIf[1], /needs\.review\.outputs\.dispatch_fix == 'true'/);
  assert.doesNotMatch(dispatchIf[1], /always\(\)/, 'a review that did not finish has no findings to fix');
  // `actions: write` lives HERE and nowhere near an agent.
  assert.match(dispatch, /permissions:\n\s+actions: write/);
  // ...and NOT on the job that holds the reviewing agent. Scoped to the
  // permissions block: the review job's comment explains the omission, and a
  // whole-job match would read that explanation as the grant.
  const reviewPerms = /\n {4}permissions:\n((?: {6}[^\n]*\n)+)/.exec(jobs(REVIEW).review);
  assert.ok(reviewPerms, 'the review job declares permissions');
  assert.doesNotMatch(reviewPerms[1].replace(/^\s*#.*$/gm, ''), /actions: write/);
});

// ── 7. the codex fix leg's contract ──────────────────────────────────────────

// Run the real "Commit the codex fix and stage its reply plan" step in a git
// repo, so the commit and the plan file are the actual artifacts.
function stageCodexFix(output, { dirty = true } = {}) {
  const s = sandbox();
  const script = extractRun(FIX, 'Commit the codex fix and stage its reply plan');
  const repo = path.join(s.dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'seed@example.com');
  git('config', 'user.name', 'seed');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  if (dirty) fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  // Latch's own scratch dir must never reach the customer's commit.
  fs.mkdirSync(path.join(repo, '.latch-run'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.latch-run', 'threads.json'), '[]');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.latch-run/\n');

  if (output !== null) s.write('codex-fix.json', JSON.stringify(output));
  const r = spawnSync('bash', ['-c', script], {
    cwd: repo,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { RUNNER_TEMP: s.dir }),
  });
  const planPath = path.join(s.dir, 'latch-fix-replies.json');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const out = {
    status: r.status,
    log: (r.stdout || '') + (r.stderr || ''),
    plan: fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : null,
    committed: head !== before,
    subject: head === before ? null : execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim(),
    files: head === before ? [] : execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  };
  s.done();
  return out;
}

test('the codex fixer lands its plan at the path the reply step reads', () => {
  const r = stageCodexFix({
    commit_message: 'guard the empty case',
    replies: [
      { threadId: 'T_1', status: 'fixed', body: 'added the guard; checks pass' },
      { threadId: 'T_2', status: 'kept', body: 'the caller already validates this' },
    ],
  });
  assert.strictEqual(r.status, 0, r.log);
  // A plain JSON ARRAY at exactly the path the reply step opens — the same
  // contract the claude fixer writes directly, so nothing downstream changes.
  assert.ok(Array.isArray(r.plan));
  assert.deepStrictEqual(r.plan.map((e) => e.status), ['fixed', 'kept']);
  const replyStep = extractRun(FIX, 'Post the thread replies and resolutions');
  assert.match(replyStep, /PLAN="\$RUNNER_TEMP\/latch-fix-replies\.json"/);
  // ...and it commits under the fixer identity, without Latch's scratch dir.
  assert.ok(r.committed);
  assert.strictEqual(r.subject, 'guard the empty case');
  assert.deepStrictEqual(r.files, ['a.txt']);
});

test('the codex fixer makes no commit when it changed nothing', () => {
  // A clean tree is how the push step learns `state=none`, which is what keeps
  // the loop from consuming a cycle for a run that only argued.
  const r = stageCodexFix({ commit_message: 'nothing', replies: [{ threadId: 'T', status: 'kept', body: 'no' }] }, { dirty: false });
  assert.strictEqual(r.status, 0, r.log);
  assert.strictEqual(r.committed, false);
  assert.match(r.log, /changed no files/);
  assert.ok(Array.isArray(r.plan));
});

test('an unusable codex commit subject falls back instead of writing junk to history', () => {
  const r = stageCodexFix({ commit_message: '   \n\n', replies: [] });
  assert.strictEqual(r.status, 0, r.log);
  assert.strictEqual(r.subject, 'apply latch review fixes');
  // Multi-line agent text becomes ONE subject line.
  const multi = stageCodexFix({ commit_message: 'Fix the guard\n\nand a body paragraph', replies: [] });
  assert.strictEqual(multi.subject, 'fix the guard');
});

test('a codex fixer that produced no plan fails instead of consuming a cycle', () => {
  const r = stageCodexFix(null);
  assert.strictEqual(r.status, 1);
  assert.match(r.log, /No codex fix output/);
  assert.strictEqual(r.committed, false);
});

// ── 8. a SKIPPED agent step is not a failure to salvage ──────────────────────

// The one that silently kills every codex fix if it is wrong: a skipped step's
// outcome is `skipped`, and the salvage clause used to fire on "anything but
// success" — which would abort the push with "nothing to salvage" on every
// codex run. Exercise the real push step against a real remote.
function runPush(env) {
  const s = sandbox();
  const script = extractRun(FIX, 'Push the fix');
  const bare = path.join(s.dir, 'origin.git');
  const repo = path.join(s.dir, 'repo');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('config', 'user.email', 'seed@example.com');
  git('config', 'user.name', 'seed');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  git('push', '-q', 'origin', 'HEAD:refs/heads/pr-branch');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  git('add', '-A');
  git('commit', '-qm', 'fix');

  s.write('gh', ghStub('case "$*" in *headRefName*) echo pr-branch;; esac'), 0o755);
  const out = s.write('out.txt', '');
  const genv = s.write('env.txt', '');
  const r = spawnSync('bash', ['-c', script], {
    cwd: repo,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: `${s.dir}${path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: s.dir,
      GH_CALLS: path.join(s.dir, 'calls.log'),
      GITHUB_OUTPUT: out,
      GITHUB_ENV: genv,
      BASE_SHA: base,
      PR: '7',
    }, env),
  });
  const res = {
    status: r.status,
    log: (r.stdout || '') + (r.stderr || ''),
    outputs: fs.readFileSync(out, 'utf8'),
  };
  s.done();
  return res;
}

test('a SKIPPED agent step is not mistaken for a failure to salvage', () => {
  if (missing('git')) return;
  // provider=codex: the claude step was skipped, so there is no execution file
  // and no salvage rail. The push must proceed normally.
  const skipped = runPush({ AGENT_STEP_OUTCOME: 'skipped', AGENT_EXECUTION_FILE: '' });
  assert.strictEqual(skipped.status, 0, skipped.log);
  assert.match(skipped.outputs, /state=pushed/);
  assert.doesNotMatch(skipped.log, /nothing to salvage/);

  // A genuinely failed claude run with no successful result in its log still
  // fails — the salvage rail is not a way to push anything at all.
  const failed = runPush({ AGENT_STEP_OUTCOME: 'failure', AGENT_EXECUTION_FILE: '' });
  assert.strictEqual(failed.status, 1);
  assert.match(failed.log, /nothing to salvage/);

  // The expression feeding it must read the leg that actually ran.
  assert.match(FIX, /AGENT_STEP_OUTCOME: \$\{\{ steps\.cfg\.outputs\.provider == 'codex' && steps\.fixer_codex\.outcome \|\| steps\.fixer\.outcome \}\}/);
  // ...and the test must be `= "failure"`, never `!= "success"`, or `skipped`
  // takes the salvage branch again.
  assert.match(FIX, /AGENT_STEP_OUTCOME:-success\}" = "failure"/);
  assert.doesNotMatch(FIX, /AGENT_STEP_OUTCOME:-success\}" != "success"/);
  // No salvage for codex, by construction: the gate names the claude output.
  assert.match(FIX, /failure\(\) && steps\.fixer\.outputs\.execution_file != ''/);
});

// ── 9. the reviewer-identity trap, through the real jq and awk ───────────────

function pending(threads, { reviewer = 'claude', fixer = 'github-actions' } = {}) {
  const precheck = extractRun(FIX, 'Re-check for pending review threads');
  const jqFilter = /--jq '([\s\S]*?)' \\\n\s*> "\$RUNNER_TEMP\/latch-pending\.tsv"/.exec(precheck);
  assert.ok(jqFilter, 'pending jq filter found');
  const awkProg = /-v fixer="\$FIXER_LOGIN" '([\s\S]*?)' "\$RUNNER_TEMP\/latch-pending\.tsv"/.exec(precheck);
  assert.ok(awkProg, 'pending awk program found');
  const fixture = { data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } } };
  const jq = spawnSync('jq', ['-r', jqFilter[1]], { input: JSON.stringify(fixture), encoding: 'utf8' });
  assert.strictEqual(jq.status, 0, jq.stderr);
  const awk = spawnSync('awk', ['-F', '\t', '-v', `rev=${reviewer}`, '-v', `fixer=${fixer}`, awkProg[1]], {
    input: jq.stdout,
    encoding: 'utf8',
  });
  assert.strictEqual(awk.status, 0, awk.stderr);
  return (awk.stdout || '').split('\n').filter(Boolean);
}

// The marker the reply step stamps. Read out of the template so the test cannot
// drift from it — the whole point is that the two steps agree.
const MARKER = (() => {
  const m = /FIXER_MARKER='([^']+)'/.exec(FIX);
  assert.ok(m, 'the fixer marker literal is in the template');
  return m[1];
})();

const thread = (id, opener, latest, body = 'some reply') => ({
  id,
  isResolved: false,
  opener: { nodes: [{ author: { login: opener } }] },
  latest: { nodes: [{ author: { login: latest }, body }] },
});

test('the reply step and the precheck agree on one marker literal', () => {
  // One contract split across two steps. A typo in either is the silent
  // green-forever failure, so pin that they are the same string and that the
  // reply step stamps it on BOTH channels.
  assert.strictEqual(MARKER, '<!-- latch:fixer -->');
  assert.strictEqual((FIX.match(/FIXER_MARKER='<!-- latch:fixer -->'/g) || []).length, 2);
  assert.match(extractRun(FIX, 'Re-check for pending review threads'), /contains\("<!-- latch:fixer -->"\)/);
  const reply = extractRun(FIX, 'Post the thread replies and resolutions');
  // Stamped after the case that builds `reply`, so it lands on `fixed` and
  // `kept` alike, and after the commit-claim probe so the probe sees only the
  // agent's own words.
  const stamp = reply.indexOf('reply=$(printf \'%s\\n\\n%s\' "$reply" "$FIXER_MARKER")');
  assert.ok(stamp > reply.indexOf('kept)'), 'the marker is stamped after both reply channels are built');
  assert.ok(stamp > reply.indexOf('Self-minted commit claim dropped'), 'the probe must run on the agent text alone');
});

test('a fresh reviewer thread is pending when reviewer and fixer differ', () => {
  if (missing('jq')) return;
  assert.deepStrictEqual(
    pending([
      thread('T_fresh', 'claude', 'claude', 'This drops the error path.'),
      thread('T_pushed_back', 'claude', 'github-actions', `Disagree: the caller validates this.\n\n${MARKER}`),
      thread('T_human_replied', 'claude', 'octocat', 'I think the reviewer is right.'),
      thread('T_not_ours', 'octocat', 'octocat', 'unrelated'),
    ]),
    ['T_fresh', 'T_human_replied'],
  );
});

test('a fresh reviewer thread is STILL pending when the reviewer IS the fixer identity', () => {
  if (missing('jq')) return;
  // THE TRAP. With LATCH_REVIEW_LOGIN=github-actions — exactly what a codex
  // review posting under GITHUB_TOKEN needs — an author-only "already answered"
  // test would skip every thread the reviewer just opened, take pending to 0 on
  // every PR, and kill the loop green and silent. Only the marker may decide.
  const threads = [
    // Opened by the reviewer, which is also the fixer login. No marker: PENDING.
    thread('T_fresh', 'github-actions', 'github-actions', 'This drops the error path.'),
    // The fixer's own push-back, marked. Answered, so NOT pending.
    thread('T_answered', 'github-actions', 'github-actions', `Disagree: the caller validates this.\n\n${MARKER}`),
    // A human replied after that push-back: pending again.
    thread('T_human_replied', 'github-actions', 'octocat', 'I still think it is wrong.'),
  ];
  assert.deepStrictEqual(pending(threads, { reviewer: 'github-actions' }), ['T_fresh', 'T_human_replied']);

  // The marker also stands on its own with distinct identities — a reply the
  // marker claims is a fixer's is answered whatever login it wears.
  assert.deepStrictEqual(
    pending([thread('T_marked', 'claude', 'somebody-else', `answered\n\n${MARKER}`)]),
    [],
  );
});

test('the [bot] suffix is stripped symmetrically', () => {
  if (missing('jq')) return;
  // An asymmetric strip takes pending to 0 on EVERY PR: every fixer exits green
  // in ten seconds and nothing reports it.
  assert.deepStrictEqual(
    pending([
      thread('T_suffixed_fresh', 'claude[bot]', 'claude[bot]', 'finding'),
      thread('T_suffixed_answered', 'claude[bot]', 'github-actions[bot]', 'push-back'),
    ]),
    ['T_suffixed_fresh'],
  );
});

test('the reviewer identity is configurable everywhere it used to be hard-coded', () => {
  // Five places, all now reading the validated config output. The guard's event
  // filter must accept BOTH shapes, because a PAT-posting reviewer has no
  // `[bot]` suffix at all.
  const guard = jobs(FIX).guard;
  assert.match(guard, /github\.event\.review\.user\.login == \(vars\.LATCH_REVIEW_LOGIN \|\| 'claude'\)/);
  assert.match(guard, /format\('\{0\}\[bot\]', vars\.LATCH_REVIEW_LOGIN \|\| 'claude'\)/);
  // The queries and the prompt take it through env / a step output, never by
  // splicing a variable into a filter handed to another program.
  assert.match(extractRun(FIX, 'Validate Latch config'), /review_login="\$\{LATCH_REVIEW_LOGIN:-claude\}"/);
  assert.match(FIX, /REVIEW_LOGIN: \$\{\{ steps\.cfg\.outputs\.review_login \}\}/);
  assert.match(extractRun(FIX, 'Snapshot the open review threads'), /-v rev="\$\{REVIEW_LOGIN:-claude\}"/);
  assert.match(FIX, /author\.login=="\$\{\{ steps\.cfg\.outputs\.review_login \}\}"/);
  // ...and no bare `claude` login test survives in a query or a filter.
  assert.doesNotMatch(FIX, /author\.login\s*==\s*"claude"/);
  assert.doesNotMatch(FIX, /\$2=="claude"/);
});

// ── 10. the templates still parse, and the two copies still match ────────────

test('both templates parse as YAML', () => {
  // CI proves this with PyYAML; locally use whichever parser exists so the
  // check is not silently absent on a dev machine. Skips cleanly with neither.
  const files = ['workflows/latch-review.yml', 'workflows/latch-fix.yml',
    '.github/workflows/latch-review.yml', '.github/workflows/latch-fix.yml'];
  const havePy = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
  const usePy = !havePy.error && havePy.status === 0;
  const haveRb = spawnSync('ruby', ['-ryaml', '-e', '1'], { encoding: 'utf8' });
  const useRb = !haveRb.error && haveRb.status === 0;
  if (!usePy && !useRb) return; // no YAML parser here — CI always has PyYAML
  for (const f of files) {
    const abs = path.join(ROOT, f);
    const r = usePy
      ? spawnSync('python3', ['-c', 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))', abs], { encoding: 'utf8' })
      : spawnSync('ruby', ['-ryaml', '-e', 'YAML.load_file(ARGV[0])', abs], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f} is not valid YAML:\n${r.stderr}`);
  }
});

test('the shipped templates and the installed copies stay byte-identical', () => {
  // A test already pins this; it is repeated here because the provider work
  // touched both copies and drift between them is invisible and expensive.
  assert.strictEqual(read('.github/workflows/latch-fix.yml'), FIX);
  assert.strictEqual(read('.github/workflows/latch-review.yml'), REVIEW);
});

test('the template version markers moved with the schema', () => {
  // An installed copy from before the variable schema cannot be told apart from
  // a current one without this, and `latch doctor` reads exactly these markers.
  assert.match(REVIEW, /^# latch:template-version=0\.3\.0$/m);
  assert.match(FIX, /^# latch:template-version=0\.5\.0$/m);
  assert.ok(fs.existsSync(CLI), 'the CLI that reads those markers exists');
});

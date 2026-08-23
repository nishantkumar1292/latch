'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeRepo, cleanup, runLatch } = require('./helpers');

test('doctor flags a missing install as failures', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    const r = runLatch(['doctor'], dir);
    assert.strictEqual(r.status, 1, 'non-zero when workflows are missing');
    assert.match(r.stdout, /✘/);
    assert.match(r.stdout, /latch-review\.yml/);
    assert.match(r.stdout, /latch init/);
  } finally {
    cleanup(dir);
  }
});

test('doctor passes on a fresh install (secret/app unverifiable -> warnings, not failures)', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets', scripts: { test: 'jest' } }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    const r = runLatch(['doctor'], dir);
    // gh cannot read secrets for the fake remote, so the secret check is a
    // warning, not a failure -> overall exit 0.
    assert.strictEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /✔/);
    assert.match(r.stdout, /template/);
    assert.match(r.stdout, /in a git repository/);
  } finally {
    cleanup(dir);
  }
});

test('doctor detects an out-of-date template version', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    // rewrite the installed template marker to an old version
    const fs = require('fs');
    const path = require('path');
    const p = path.join(dir, '.github/workflows/latch-review.yml');
    const txt = fs.readFileSync(p, 'utf8').replace(/latch:template-version=\S+/, 'latch:template-version=0.0.1');
    fs.writeFileSync(p, txt);

    const r = runLatch(['doctor'], dir);
    assert.match(r.stdout, /latch init --force/);
    assert.match(r.stdout, /0\.0\.1/);
  } finally {
    cleanup(dir);
  }
});

test('doctor reports a broken policy file', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    const fs = require('fs');
    const path = require('path');
    // a hard tab in indentation is invalid YAML
    fs.writeFileSync(path.join(dir, '.latch/policy.yml'), 'version: 1\nchecks:\n\t- bad\n');
    const r = runLatch(['doctor'], dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /policy\.yml/);
  } finally {
    cleanup(dir);
  }
});

// ── provider awareness ───────────────────────────────────────────────────────
// `latch doctor` cannot read repo VARIABLES without `gh` (they are repo
// settings, not files), and the credential it should look for depends on one of
// them. So these tests stub `gh` on PATH and drive the real code path. A doctor
// that checks the wrong provider's secret tells a codex install to set an
// Anthropic token it does not need, and never mentions the one it does.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CLI } = require('./helpers');

// HERMETIC BY CONSTRUCTION. These tests run the CLI with a PATH containing
// NOTHING but a directory this harness built: a symlink to the real `git` (the
// CLI needs it to recognise a repo) and, when the case calls for it, a fake
// `gh`. Nothing ambient leaks in, so the result cannot depend on whether the
// machine running the tests happens to have `gh` installed or authenticated —
// which is the difference between a pin and a coin toss, and it is exactly the
// axis this CLI branches on.
//
// Three states, driven explicitly:
//   'missing'          — no gh on PATH at all      -> the cannot-verify rows
//   'unauthenticated'  — gh present, reads fail    -> the "assumed" wording
//   { vars, secrets }  — gh present and answering  -> the real per-provider rows
function ghSandbox(gh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-path-'));
  // Resolve the real git ONCE, from the ambient environment, and expose only it.
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realGit, 'these tests need a real git on PATH to symlink');
  fs.symlinkSync(realGit, path.join(dir, 'git'));

  if (gh !== 'missing') {
    const authed = gh !== 'unauthenticated';
    const varsJson = authed
      ? JSON.stringify(Object.entries(gh.vars || {}).map(([name, value]) => ({ name, value })))
      : null;
    const secrets = authed ? (gh.secrets || []) : null;
    // printf, never a heredoc: a heredoc terminator cannot share its line with
    // the `;;` that ends a case branch, and a stub that fails to PARSE looks
    // exactly like "gh is not installed" — a passing warning row. The test
    // would then go green having exercised nothing at all, which is how the
    // first version of this harness lied.
    //
    // Matched on "$1 $2" so a doctor probe added later lands in the catch-all
    // rather than silently changing what these tests prove. The catch-all exits
    // 0 with empty output: an unknown probe should read as "nothing there", not
    // as "gh is broken".
    // An ABSOLUTE shebang, not `/usr/bin/env bash`: PATH here is only this
    // directory, so `env` would search it for bash, not find one, and the stub
    // would exit 127 — which the CLI reads as "gh is not installed". That is
    // the same silent lie as the heredoc bug, arriving by a different door.
    fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
case "$1 $2" in
  "--version "*) echo "gh version 2.0.0 (test stub)"; exit 0;;
  "variable list") ${varsJson === null ? 'exit 1' : `printf '%s' '${varsJson}'; exit 0`};;
  "secret list") ${secrets === null ? 'exit 1' : `printf '%s\\n' ${secrets.length ? secrets.map((s) => `'${s}'`).join(' ') : "''"}; exit 0`};;
  *) exit 0;;
esac
`);
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
  }
  return dir;
}

// Run `latch doctor` in `dir` against one of the three gh states. `node` is
// invoked by absolute path, because PATH here deliberately does not have one.
function doctor(gh, dir) {
  const pathDir = ghSandbox(gh);
  try {
    const r = spawnSync(process.execPath, [CLI, 'doctor'], {
      cwd: dir,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { NO_COLOR: '1', PATH: pathDir }),
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } finally {
    cleanup(pathDir);
  }
}

// Kept as a thin wrapper so the assertions below read as one case each.
function withGh(gh, dir, fn) {
  return fn(doctor(gh, dir));
}

function installed() {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  assert.strictEqual(runLatch(['init'], dir).status, 0);
  return dir;
}

test('doctor checks the claude credential under the default provider', () => {
  const dir = installed();
  try {
    withGh({ vars: {}, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /provider: claude/);
      assert.match(r.stdout, /auth secret set \(CLAUDE_CODE_OAUTH_TOKEN, for provider claude\)/);
      // The Claude GitHub App line is the claude path's own requirement.
      assert.match(r.stdout, /Claude GitHub App installed/);
    });
    // ANTHROPIC_API_KEY is the other accepted claude credential.
    withGh({ vars: {}, secrets: ['ANTHROPIC_API_KEY'] }, dir, (r) => {
      assert.match(r.stdout, /auth secret set \(ANTHROPIC_API_KEY/);
    });
    // ...and OPENAI_API_KEY is not one of them: under provider=claude a codex
    // key present is not a credential, and saying otherwise would pass an
    // install that cannot authenticate.
    withGh({ vars: {}, secrets: ['OPENAI_API_KEY'] }, dir, (r) => {
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /auth secret set for provider claude/);
      assert.match(r.stdout, /gh secret set CLAUDE_CODE_OAUTH_TOKEN/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor checks OPENAI_API_KEY under provider=codex', () => {
  const dir = installed();
  try {
    withGh({ vars: { LATCH_PROVIDER: 'codex' }, secrets: ['OPENAI_API_KEY'] }, dir, (r) => {
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /provider: codex/);
      assert.match(r.stdout, /auth secret set \(OPENAI_API_KEY, for provider codex\)/);
      // The Claude App is not part of the codex picture; the identity the review
      // posts under is, because LATCH_REVIEW_LOGIN has to match it.
      assert.doesNotMatch(r.stdout, /Claude GitHub App installed/);
      assert.match(r.stdout, /LATCH_REVIEW_LOGIN matches whoever posts the review/);
    });
    // A claude token under provider=codex is not a codex credential.
    withGh({ vars: { LATCH_PROVIDER: 'codex' }, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /gh secret set OPENAI_API_KEY/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor says "assumed" when it cannot read LATCH_PROVIDER', () => {
  const dir = installed();
  try {
    // gh present but not authenticated: unknown is NOT unset. The row must not
    // claim to know which provider is configured, because acting on a wrong
    // guess is how a codex install gets told to set an Anthropic token.
    withGh('unauthenticated', dir, (r) => {
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /provider: claude \(assumed — could not read LATCH_PROVIDER\)/);
      assert.match(r.stdout, /cannot verify — gh not authenticated; assuming provider claude/);
      // Unknown must never become a failure: doctor's honesty rule is that what
      // it cannot check locally is a warning.
      assert.doesNotMatch(r.stdout, /✘/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor degrades honestly with no gh on PATH at all', () => {
  const dir = installed();
  try {
    withGh('missing', dir, (r) => {
      // Everything that is a local file still gets checked; everything that
      // needs the API says so, by name, and stays a warning.
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /in a git repository/);
      assert.match(r.stdout, /latch-fix\.yml \(template 0\.5\.0\)/);
      assert.match(r.stdout, /provider: claude \(assumed — could not read LATCH_PROVIDER\)/);
      assert.match(r.stdout, /cannot verify — gh not installed; assuming provider claude/);
      assert.match(r.stdout, /Warnings above are things Latch cannot verify locally/);
      // With no way to read the variable, there is nothing to say about pausing
      // or model coherence — and inventing a row would be worse than silence.
      assert.doesNotMatch(r.stdout, /the loop is PAUSED/);
      assert.doesNotMatch(r.stdout, /looks like a/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor fails an invalid LATCH_PROVIDER instead of quietly assuming one', () => {
  const dir = installed();
  try {
    withGh({ vars: { LATCH_PROVIDER: 'gpt' }, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      // The workflows refuse this at config time; a doctor that reported health
      // would send someone hunting for the reason no run ever starts.
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /LATCH_PROVIDER is "gpt" — not a provider Latch can run/);
      assert.match(r.stdout, /latchgate\.dev\/console/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor reports a paused loop — the trap where everything else looks fine', () => {
  const dir = installed();
  try {
    withGh({ vars: { LATCH_PAUSED: 'true' }, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      // A warning, not a failure: pausing is a legitimate thing to have done.
      // But it must be SAID, and it must say what it costs.
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /LATCH_PAUSED=true/);
      assert.match(r.stdout, /PAUSED/);
      assert.match(r.stdout, /NO verdict status/);
      assert.match(r.stdout, /LATCH_PAUSED --body false/);
    });
    // Absent, and any other value, is not paused — no row at all.
    for (const vars of [{}, { LATCH_PAUSED: 'false' }, { LATCH_PAUSED: '' }]) {
      withGh({ vars, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
        assert.doesNotMatch(r.stdout, /the loop is PAUSED/);
      });
    }
  } finally {
    cleanup(dir);
  }
});

test('doctor warns when the model belongs to the other provider', () => {
  const dir = installed();
  try {
    withGh({ vars: { LATCH_PROVIDER: 'codex', LATCH_MODEL: 'claude-opus-4-8' }, secrets: ['OPENAI_API_KEY'] }, dir, (r) => {
      // A warning, not a failure — this is a heuristic on a value that churns.
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, /LATCH_MODEL="claude-opus-4-8" looks like a claude model, but LATCH_PROVIDER is codex/);
    });
    withGh({ vars: { LATCH_FIX_MODEL: 'gpt-5-codex' }, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      assert.match(r.stdout, /LATCH_FIX_MODEL="gpt-5-codex" looks like a codex model, but LATCH_PROVIDER is claude/);
    });
    // A coherent pair says nothing, and neither does an unrecognised model: a
    // doctor that failed a valid-but-new model name would be worse than silent.
    withGh({ vars: { LATCH_PROVIDER: 'codex', LATCH_MODEL: 'gpt-5-codex' }, secrets: ['OPENAI_API_KEY'] }, dir, (r) => {
      assert.doesNotMatch(r.stdout, /looks like a/);
    });
    withGh({ vars: { LATCH_MODEL: 'some-internal-bedrock-alias' }, secrets: ['ANTHROPIC_API_KEY'] }, dir, (r) => {
      assert.doesNotMatch(r.stdout, /looks like a/);
    });
  } finally {
    cleanup(dir);
  }
});

test('doctor keeps every pre-existing row and its cannot-verify honesty', () => {
  const dir = installed();
  try {
    withGh({ vars: {}, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, dir, (r) => {
      for (const row of [
        /in a git repository/,
        /GitHub remote \(acme\/widgets\)/,
        /latch-review\.yml \(template 0\.3\.0\)/,
        /latch-fix\.yml \(template 0\.5\.0\)/,
        /policy\.yml parses/,
      ]) {
        assert.match(r.stdout, row);
      }
      assert.match(r.stdout, /Warnings above are things Latch cannot verify locally/);
    });
  } finally {
    cleanup(dir);
  }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const { makeRepo, cleanup, runLatch, read, exists } = require('./helpers');

test('init creates both workflows and a policy file', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'widgets', scripts: { lint: 'eslint .', test: 'jest' } }),
  });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);

    assert.ok(exists(dir, '.github/workflows/latch-review.yml'), 'review workflow written');
    assert.ok(exists(dir, '.github/workflows/latch-fix.yml'), 'fix workflow written');
    assert.ok(exists(dir, '.latch/policy.yml'), 'policy written');

    assert.match(read(dir, '.github/workflows/latch-review.yml'), /name: Latch Review/);
    assert.match(read(dir, '.github/workflows/latch-fix.yml'), /name: Latch Fix/);

    // Next-steps guidance is printed and never asks for the token value.
    assert.match(r.stdout, /Install the Claude GitHub App/);
    assert.match(r.stdout, /gh secret set CLAUDE_CODE_OAUTH_TOKEN --app actions/);
    assert.match(r.stdout, /never reads or stores/);
  } finally {
    cleanup(dir);
  }
});

test('init mines landmines from CLAUDE.md', () => {
  const claude = [
    '# Project context',
    '',
    '## Conventions',
    '',
    '- Migrations are keyed by numeric prefix and collide silently across branches.',
    '- Never send any child data off the device; the server accepts none by construction.',
    '- Randomize the correct answer position at creation and at render.',
    '',
    '```',
    '- this bullet is inside a code fence and must be ignored',
    '```',
  ].join('\n');
  const dir = makeRepo({ 'CLAUDE.md': claude });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const policy = read(dir, '.latch/policy.yml');
    assert.match(policy, /auto-mined from CLAUDE\.md/);
    assert.match(policy, /Migrations are keyed by numeric prefix/);
    assert.match(policy, /Never send any child data off the device/);
    // fenced bullet must not leak in
    assert.doesNotMatch(policy, /inside a code fence/);
  } finally {
    cleanup(dir);
  }
});

test('init follows a CLAUDE.md → AGENTS.md import and mines the imported file', () => {
  // The Claude Code stub pattern: CLAUDE.md is a description line plus a bare
  // `@AGENTS.md` import, with nothing mineable itself. The miner must fall
  // through to AGENTS.md rather than stopping at the first file that exists.
  const claude = ['One-line project description that is not a bullet.', '', '@AGENTS.md'].join('\n');
  const agents = [
    '# AGENTS.md',
    '',
    '## Traps',
    '',
    '- Migrations are keyed by numeric prefix and collide silently across branches.',
    '- Never send any child data off the device; the server accepts none by construction.',
  ].join('\n');
  const dir = makeRepo({ 'CLAUDE.md': claude, 'AGENTS.md': agents });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const policy = read(dir, '.latch/policy.yml');
    // named the right source (the import chain), not just CLAUDE.md
    assert.match(policy, /auto-mined from CLAUDE\.md → AGENTS\.md/);
    // real bullets from the imported file made it in
    assert.match(policy, /Migrations are keyed by numeric prefix/);
    assert.match(policy, /Never send any child data off the device/);
    // and it must NOT falsely claim nothing was found
    assert.doesNotMatch(policy, /No CLAUDE\.md\/AGENTS\.md found/);
    assert.doesNotMatch(policy, /landmines: \[\]/);
  } finally {
    cleanup(dir);
  }
});

test('init reports found-but-nothing-mineable when a file exists but is empty', () => {
  // CLAUDE.md exists but carries no mineable bullets, and there is no AGENTS.md.
  // The policy must distinguish this from "no file found at all".
  const claude = ['# Notes', '', 'Just some prose, no bullet points here.', ''].join('\n');
  const dir = makeRepo({ 'CLAUDE.md': claude });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const policy = read(dir, '.latch/policy.yml');
    assert.match(policy, /Found CLAUDE\.md but nothing mineable/);
    assert.match(policy, /landmines: \[\]/);
    // must NOT claim no file was found — the file exists
    assert.doesNotMatch(policy, /No CLAUDE\.md\/AGENTS\.md found/);
  } finally {
    cleanup(dir);
  }
});

test('init infers checks from package.json scripts', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'widgets',
      scripts: { lint: 'eslint .', test: 'jest', build: 'tsc -b' },
      devDependencies: { typescript: '^5.0.0' },
    }),
  });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const policy = read(dir, '.latch/policy.yml');
    assert.match(policy, /npm run lint/);
    assert.match(policy, /npm run test/);
    assert.match(policy, /npm run build/);
    // typescript dep, no typecheck script -> tsc --noEmit added
    assert.match(policy, /npx tsc --noEmit/);
    assert.match(policy, /\*\*\/\*\.\{js,jsx,ts,tsx,mjs,cjs\}/);
  } finally {
    cleanup(dir);
  }
});

test('init infers a cargo check from Cargo.toml in a subdirectory', () => {
  const dir = makeRepo({
    'services/api/Cargo.toml': "[package]\nname = \"api\"\nversion = \"0.1.0\"\n",
  });
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const policy = read(dir, '.latch/policy.yml');
    assert.match(policy, /services\/api\/\*\*\/\*\.rs/);
    assert.match(policy, /cd services\/api && cargo fmt/);
  } finally {
    cleanup(dir);
  }
});

test('init refuses to clobber an existing, differing workflow without --force', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);

    // simulate a local edit
    const p = '.github/workflows/latch-review.yml';
    const abs = require('path').join(dir, p);
    require('fs').writeFileSync(abs, '# locally edited\n');

    const r2 = runLatch(['init'], dir);
    assert.strictEqual(r2.status, 1, 'refuses without --force');
    assert.match(r2.stdout, /--force/);
    assert.strictEqual(read(dir, p), '# locally edited\n', 'file not clobbered');

    const r3 = runLatch(['init', '--force'], dir);
    assert.strictEqual(r3.status, 0, r3.stderr + r3.stdout);
    assert.match(read(dir, p), /name: Latch Review/, 'force overwrote it');
  } finally {
    cleanup(dir);
  }
});

test('init is idempotent when nothing changed', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    const r2 = runLatch(['init'], dir);
    assert.strictEqual(r2.status, 0, 're-run succeeds');
    assert.match(r2.stdout, /already up to date/);
    assert.match(r2.stdout, /kept existing/);
  } finally {
    cleanup(dir);
  }
});

test('init fails outside a git repo', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-nogit-'));
  try {
    const r = runLatch(['init'], dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /not a git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the generated policy is valid YAML (verified with PyYAML when available)', () => {
  const dir = makeRepo({
    'CLAUDE.md': '## Rules\n\n- Keep the API backward compatible: never remove a field in a minor release.\n',
    'package.json': JSON.stringify({ name: 'widgets', scripts: { test: 'jest' } }),
  });
  try {
    runLatch(['init'], dir);
    const policyPath = require('path').join(dir, '.latch', 'policy.yml');
    const py = spawnSync('python3', ['-c', 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))', policyPath], {
      encoding: 'utf8',
    });
    if (py.error || py.status === null) {
      // python3 not available in this environment — skip the strict check.
      return;
    }
    assert.strictEqual(py.status, 0, 'generated policy.yml must be valid YAML:\n' + py.stderr);
  } finally {
    cleanup(dir);
  }
});

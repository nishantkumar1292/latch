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

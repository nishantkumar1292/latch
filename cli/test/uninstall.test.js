'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeRepo, cleanup, runLatch, exists } = require('./helpers');

test('uninstall removes both workflows and keeps the policy with --keep-policy', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    assert.ok(exists(dir, '.github/workflows/latch-review.yml'));

    const r = runLatch(['uninstall', '--keep-policy'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(!exists(dir, '.github/workflows/latch-review.yml'), 'review workflow removed');
    assert.ok(!exists(dir, '.github/workflows/latch-fix.yml'), 'fix workflow removed');
    assert.ok(exists(dir, '.latch/policy.yml'), 'policy kept');
    assert.match(r.stdout, /kept \.latch/);
  } finally {
    cleanup(dir);
  }
});

test('uninstall removes the policy directory with --remove-policy', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    const r = runLatch(['uninstall', '--remove-policy'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(!exists(dir, '.latch/policy.yml'), 'policy removed');
    assert.ok(!exists(dir, '.latch'), '.latch directory removed');
    assert.match(r.stdout, /removed \.latch/);
  } finally {
    cleanup(dir);
  }
});

test('uninstall on a clean repo reports nothing to remove', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    const r = runLatch(['uninstall', '--keep-policy'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Nothing to remove|not present/);
  } finally {
    cleanup(dir);
  }
});

test('uninstall keeps the policy by default in a non-interactive run', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'widgets' }) });
  try {
    assert.strictEqual(runLatch(['init'], dir).status, 0);
    // no flag + no TTY -> the prompt defaults to keeping the policy
    const r = runLatch(['uninstall'], dir);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(exists(dir, '.latch/policy.yml'), 'policy kept when not confirmed');
  } finally {
    cleanup(dir);
  }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const review = read('workflows/latch-review.yml');
const fix = read('workflows/latch-fix.yml');

test('Codex subscription fallback is explicit, disabled by default, and cleaned up', () => {
  assert.match(review, /LATCH_CODEX_FALLBACK \|\| 'false'/);
  assert.match(fix, /LATCH_CODEX_FALLBACK \|\| 'false'/);
  assert.match(review, /secrets\.CODEX_AUTH_JSON/);
  assert.match(fix, /secrets\.CODEX_AUTH_JSON/);
  assert.match(review, /runner\.temp }}\/latch-codex-home/);
  assert.match(fix, /runner\.temp }}\/latch-codex-home/);
  assert.match(review, /rm -rf -- "\$CODEX_HOME_TO_REMOVE"/);
  assert.match(fix, /rm -rf -- "\$CODEX_HOME_TO_REMOVE"/);
});

test('every provider entry point rejects fork PRs before model execution', () => {
  assert.match(review, /head\.repo\.full_name == github\.repository/);
  assert.strictEqual((review.match(/Verify same-repository PR/g) || []).length, 2);
  assert.ok(review.indexOf('Verify same-repository PR') < review.indexOf('Prepare Codex subscription auth'));
  assert.match(fix, /head_repo.*GH_REPO/);
  assert.match(fix, /fork PR or draft/);
  assert.ok(fix.indexOf('head_repo=') < fix.indexOf('Prepare Codex subscription auth'));
});

test('Codex findings dispatch the scoped fixer and the loop re-reviews updates', () => {
  assert.match(review, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(review, /head_ref:.*steps\.pr_guard\.outputs\.head_ref/);
  assert.match(review, /--ref "\$HEAD_REF"/);
  assert.match(review, /-f reviewer=codex/);
  assert.match(review, /PR head moved during Codex review/);
  assert.match(fix, /Finding source: claude, codex, or auto/);
  assert.match(fix, /latch-reviewer:codex/);
});

test('fixer captures threads before Claude and validates both provider checkouts', () => {
  assert.ok(fix.indexOf('Capture starting Latch threads') < fix.indexOf('Fix findings with Claude'));
  assert.match(fix, /Validate Claude fixer state/);
  assert.match(fix, /Codex must return exactly one decision for every captured thread/);
  assert.match(fix, /protected workflows or policy/);
  assert.match(fix, /env -u GH_TOKEN -u GITHUB_TOKEN codex/);
  assert.match(fix, /unresolveReviewThread/);
  assert.match(fix, /git rev-parse HEAD.*BASE_SHA/);
  assert.match(fix, /git diff --name-only "\$BASE_SHA" -- \.github\/workflows \.latch/);
});

test('workflow templates retain the anti-tamper and human-merge boundaries', () => {
  for (const workflow of [review, fix]) {
    assert.doesNotMatch(workflow, /gh pr merge|enable-auto-merge/);
  }
  assert.match(fix, /\^\\\.github\/workflows\/\|\^\\\.latch\//);
  assert.match(fix, /human always does the merge/);
});

test('installed workflow copies match the package templates', () => {
  const installedReview = read('.github/workflows/latch-review.yml').replace(
    'This file is installed by',
    'This file is a TEMPLATE installed by'
  );
  assert.strictEqual(installedReview, review);
  assert.strictEqual(read('.github/workflows/latch-fix.yml'), fix);
});

'use strict';

// Unit tests for the console's pure logic. The console writes to a customer's
// repo — the install PR, the Actions variables the agent's command line is built
// from — so the rules that decide what it writes and what it refuses are pinned
// here, not left to a manual click-through. Node stdlib only, no dependencies.

const { test } = require('node:test');
const assert = require('node:assert');

const core = require('../latch-console-core.js');

// ─────────────────────────────────────────────────────────────────────────────
// schema
// ─────────────────────────────────────────────────────────────────────────────

test('the schema covers every documented variable, grouped and attributed', () => {
  assert.deepStrictEqual(core.varNames(), [
    'LATCH_PAUSED',
    'LATCH_PROVIDER',
    'LATCH_MODEL',
    'LATCH_FIX_MODEL',
    'LATCH_REVIEW_EFFORT',
    'LATCH_EFFORT',
    'LATCH_MAX_TURNS',
    'LATCH_TIMEOUT_MINUTES',
    'LATCH_MAX_FIX_CYCLES',
    'LATCH_VERDICT_STATUS',
    'LATCH_VERDICT_CONTEXT',
    'LATCH_REVIEW_LOGIN',
    'LATCH_DOCTRINE'
  ]);

  for (const spec of core.VARS) {
    assert.ok(spec.help && spec.help.length > 20, `${spec.name} needs real help text`);
    assert.ok(['reviewer', 'fixer', 'guards', 'killswitch'].indexOf(spec.group) >= 0, `${spec.name} group`);
    assert.ok(spec.consumedBy.length > 0, `${spec.name} consumedBy`);
    for (const half of spec.consumedBy) {
      assert.ok(half === 'review' || half === 'fix', `${spec.name} consumedBy ${half}`);
    }
    assert.strictEqual(typeof spec.default, 'string', `${spec.name} default is a string`);
  }

  assert.deepStrictEqual(core.varsInGroup('killswitch').map((s) => s.name), ['LATCH_PAUSED']);
  assert.deepStrictEqual(core.varSpec('LATCH_MAX_FIX_CYCLES').default, '3');
  assert.strictEqual(core.varSpec('LATCH_VERDICT_CONTEXT').default, 'latch/merge-gate');
  assert.strictEqual(core.varSpec('LATCH_REVIEW_LOGIN').default, 'claude');
  assert.strictEqual(core.varSpec('NOT_A_LATCH_VAR'), null);
});

test('the suggestion lists claim only what the templates document', () => {
  // Model names change and we do not invent them: claude-opus-4-8 is the
  // templates' own default; the codex list is deliberately empty.
  assert.deepStrictEqual(core.MODEL_OPTIONS.claude, ['claude-opus-4-8']);
  assert.deepStrictEqual(core.MODEL_OPTIONS.codex, []);
  // xhigh exists on the claude path only (codex effort has no xhigh).
  assert.ok(core.EFFORT_OPTIONS.claude.indexOf('xhigh') >= 0);
  assert.strictEqual(core.EFFORT_OPTIONS.codex.indexOf('xhigh'), -1);
  assert.deepStrictEqual(core.EFFORT_OPTIONS.codex, ['high', 'medium', 'low', 'minimal']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. validateVar
// ─────────────────────────────────────────────────────────────────────────────

test('validateVar accepts plain tokens', () => {
  assert.deepStrictEqual(core.validateVar('LATCH_MODEL', 'claude-opus-4-8'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_REVIEW_EFFORT', 'xhigh'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_DOCTRINE', 'skeptical-senior-engineer'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_REVIEW_LOGIN', 'github-actions'), { ok: true });
});

test('validateVar rejects the flag-injection shapes and says why', () => {
  const spliced = core.validateVar('LATCH_MODEL', 'claude-opus-4-8 --dangerously-skip-permissions');
  assert.strictEqual(spliced.ok, false);
  assert.match(spliced.error, /single token with no whitespace/);
  assert.match(spliced.error, /command-line argument/);
  assert.match(spliced.error, /splice in an extra flag/);

  const dashLed = core.validateVar('LATCH_MODEL', '-dangerously-skip-permissions');
  assert.strictEqual(dashLed.ok, false);
  assert.match(dashLed.error, /must not start with "-"/);
  assert.match(dashLed.error, /flag of its own/);

  const tabbed = core.validateVar('LATCH_EFFORT', 'high\tlow');
  assert.strictEqual(tabbed.ok, false);
  assert.match(tabbed.error, /whitespace/);

  const charset = core.validateVar('LATCH_MODEL', 'claude;evil');
  assert.strictEqual(charset.ok, false);
  assert.match(charset.error, /\[A-Za-z0-9\._-\]/);
  assert.match(charset.error, /may only contain/);

  // A slash is a token-breaker everywhere except the status context.
  const slash = core.validateVar('LATCH_MODEL', 'anthropic/claude');
  assert.strictEqual(slash.ok, false);
  assert.match(slash.error, /may only contain/);
});

test("validateVar allows '/' in the verdict context and nowhere else", () => {
  assert.deepStrictEqual(core.validateVar('LATCH_VERDICT_CONTEXT', 'latch/merge-gate'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_VERDICT_CONTEXT', 'ci/latch/gate'), { ok: true });

  const spaced = core.validateVar('LATCH_VERDICT_CONTEXT', 'latch merge gate');
  assert.strictEqual(spaced.ok, false);
  assert.match(spaced.error, /quoted API field/);

  const dashLed = core.validateVar('LATCH_VERDICT_CONTEXT', '-latch/gate');
  assert.strictEqual(dashLed.ok, false);
});

test('validateVar enforces the int ranges and explains the 0 trap', () => {
  assert.deepStrictEqual(core.validateVar('LATCH_MAX_TURNS', '80'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_MAX_TURNS', '1'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_MAX_TURNS', '500'), { ok: true });

  const zero = core.validateVar('LATCH_MAX_TURNS', '0');
  assert.strictEqual(zero.ok, false);
  assert.match(zero.error, /greater than 0/);
  assert.match(zero.error, /fall back to the default/);

  const negative = core.validateVar('LATCH_MAX_TURNS', '-5');
  assert.strictEqual(negative.ok, false);
  assert.match(negative.error, /whole number/);

  const garbage = core.validateVar('LATCH_TIMEOUT_MINUTES', '25m');
  assert.strictEqual(garbage.ok, false);
  assert.match(garbage.error, /fails the run loudly/);

  const tooBig = core.validateVar('LATCH_TIMEOUT_MINUTES', '361');
  assert.strictEqual(tooBig.ok, false);
  assert.match(tooBig.error, /between 1 and 360/);

  assert.strictEqual(core.validateVar('LATCH_MAX_FIX_CYCLES', '11').ok, false);
  assert.strictEqual(core.validateVar('LATCH_MAX_FIX_CYCLES', '10').ok, true);
  assert.strictEqual(core.validateVar('LATCH_MAX_TURNS', '501').ok, false);
});

test('validateVar enforces the enums', () => {
  assert.deepStrictEqual(core.validateVar('LATCH_PAUSED', 'true'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_PROVIDER', 'codex'), { ok: true });
  assert.deepStrictEqual(core.validateVar('LATCH_VERDICT_STATUS', 'off'), { ok: true });

  const wrong = core.validateVar('LATCH_PAUSED', 'yes');
  assert.strictEqual(wrong.ok, false);
  assert.match(wrong.error, /must be one of: true, false/);

  assert.strictEqual(core.validateVar('LATCH_PROVIDER', 'gemini').ok, false);
  assert.strictEqual(core.validateVar('LATCH_PROVIDER', 'Codex').ok, false, 'enums are case-sensitive');
});

test('an unknown variable name is refused rather than silently accepted', () => {
  const r = core.validateVar('LATCH_TURBO', 'yes');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not a Latch variable/);
});

test('empty is never a validation pass — it is isUnset, a different thing', () => {
  for (const name of core.varNames()) {
    const r = core.validateVar(name, '');
    assert.strictEqual(r.ok, false, `${name} accepted an empty value`);
    assert.match(r.error, /Delete the variable/);
  }
  assert.strictEqual(core.isUnset(''), true);
  assert.strictEqual(core.isUnset(null), true);
  assert.strictEqual(core.isUnset(undefined), true);
  assert.strictEqual(core.isUnset('0'), false);
  assert.strictEqual(core.isUnset('false'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1c. effectiveValue
// ─────────────────────────────────────────────────────────────────────────────

test('effectiveValue resolves the claude provider defaults', () => {
  const model = core.effectiveValue('LATCH_MODEL', {}, 'claude');
  assert.strictEqual(model.value, 'claude-opus-4-8');
  assert.strictEqual(model.isDefault, true);
  assert.strictEqual(model.isSet, false);
  assert.match(model.note, /provider default for claude/);

  assert.strictEqual(core.effectiveValue('LATCH_REVIEW_EFFORT', {}, 'claude').value, 'xhigh');
  assert.strictEqual(core.effectiveValue('LATCH_EFFORT', {}, 'claude').value, 'high');
  assert.strictEqual(core.effectiveValue('LATCH_MAX_TURNS', {}, 'claude').value, '80');
  assert.strictEqual(core.effectiveValue('LATCH_MAX_FIX_CYCLES', {}, 'claude').value, '3');
  assert.strictEqual(core.effectiveValue('LATCH_VERDICT_CONTEXT', {}, 'claude').value, 'latch/merge-gate');
  assert.strictEqual(core.effectiveValue('LATCH_REVIEW_LOGIN', {}, 'claude').value, 'claude');
  assert.strictEqual(core.effectiveValue('LATCH_PAUSED', {}, 'claude').value, 'false');
});

test('effectiveValue swings the provider-dependent defaults on the provider', () => {
  const claude = core.effectiveValue('LATCH_REVIEW_EFFORT', { LATCH_PROVIDER: 'claude' });
  const codex = core.effectiveValue('LATCH_REVIEW_EFFORT', { LATCH_PROVIDER: 'codex' });
  assert.strictEqual(claude.value, 'xhigh');
  assert.strictEqual(codex.value, 'high');

  // We do not invent a codex model name: unset resolves to "" plus a note.
  const codexModel = core.effectiveValue('LATCH_MODEL', { LATCH_PROVIDER: 'codex' });
  assert.strictEqual(codexModel.value, '');
  assert.strictEqual(codexModel.isDefault, true);
  assert.match(codexModel.note, /Codex action's own default model/);

  // The provider is read off the variable map when not passed explicitly, and
  // an explicit argument wins over the map.
  assert.strictEqual(core.effectiveValue('LATCH_MODEL', { LATCH_PROVIDER: 'codex' }, 'claude').value, 'claude-opus-4-8');
  assert.strictEqual(core.resolveProvider({ LATCH_PROVIDER: 'codex' }), 'codex');
  assert.strictEqual(core.resolveProvider({ LATCH_PROVIDER: 'nonsense' }), 'claude');
  assert.strictEqual(core.resolveProvider({}), 'claude');
});

test('effectiveValue walks the fix-model fallback chain', () => {
  // LATCH_FIX_MODEL wins outright.
  const explicit = core.effectiveValue('LATCH_FIX_MODEL', {
    LATCH_FIX_MODEL: 'claude-haiku-x',
    LATCH_MODEL: 'claude-opus-4-8'
  }, 'claude');
  assert.strictEqual(explicit.value, 'claude-haiku-x');
  assert.strictEqual(explicit.isSet, true);
  assert.strictEqual(explicit.isDefault, false);

  // Unset, it inherits LATCH_MODEL.
  const inherited = core.effectiveValue('LATCH_FIX_MODEL', { LATCH_MODEL: 'some-model-9' }, 'claude');
  assert.strictEqual(inherited.value, 'some-model-9');
  assert.strictEqual(inherited.isSet, false);
  assert.match(inherited.note, /inherited from LATCH_MODEL/);

  // Both unset, it lands on the provider default.
  const bare = core.effectiveValue('LATCH_FIX_MODEL', {}, 'claude');
  assert.strictEqual(bare.value, 'claude-opus-4-8');
  assert.match(bare.note, /via LATCH_MODEL/);
});

test('effectiveValue reports a set value that equals the default as the default', () => {
  const same = core.effectiveValue('LATCH_MAX_TURNS', { LATCH_MAX_TURNS: '80' }, 'claude');
  assert.strictEqual(same.value, '80');
  assert.strictEqual(same.isSet, true);
  assert.strictEqual(same.isDefault, true);

  const changed = core.effectiveValue('LATCH_MAX_TURNS', { LATCH_MAX_TURNS: '200' }, 'claude');
  assert.strictEqual(changed.isDefault, false);
});

test('effectiveValue explains the two-sided timeout default rather than inventing one', () => {
  const t = core.effectiveValue('LATCH_TIMEOUT_MINUTES', {}, 'claude');
  assert.strictEqual(t.value, '');
  assert.strictEqual(t.isDefault, true);
  assert.match(t.note, /fixer job caps at 25 minutes/);
  assert.match(t.note, /360/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1d. evaluateReadiness
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_PATH = '.github/workflows/latch-review.yml';
const FIX_PATH = '.github/workflows/latch-fix.yml';

function healthyRun(overrides) {
  return Object.assign({
    conclusion: 'success',
    status: 'completed',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:07:00Z',
    html_url: 'https://github.com/o/r/actions/runs/1'
  }, overrides || {});
}

function goodSnapshot(overrides) {
  const base = {
    defaultBranch: 'master',
    workflows: [
      { path: REVIEW_PATH, state: 'active' },
      { path: FIX_PATH, state: 'active' }
    ],
    contents: { [REVIEW_PATH]: true, [FIX_PATH]: true, '.latch/policy.yml': true },
    secretNames: ['CLAUDE_CODE_OAUTH_TOKEN'],
    variables: {},
    appInstallations: [{ app_slug: 'claude' }],
    runs: {
      'latch-review.yml': [healthyRun()],
      'latch-fix.yml': [healthyRun()]
    }
  };
  return Object.assign(base, overrides || {});
}

function byId(rows, id) {
  const found = rows.filter((r) => r.id === id);
  assert.strictEqual(found.length, 1, `expected exactly one ${id} row`);
  return found[0];
}

test('readiness returns every rule, in a fixed order, every time', () => {
  const ids = core.evaluateReadiness(goodSnapshot()).map((r) => r.id);
  assert.deepStrictEqual(ids, [
    'paused',
    'workflows',
    'policy',
    'secrets',
    'reviewer-app',
    'variables',
    'provider-coherence',
    'run-health:latch-review.yml',
    'run-health:latch-fix.yml'
  ]);
  assert.deepStrictEqual(ids, core.READINESS_IDS);
  // The same order on an empty snapshot, so the page can render stable rows.
  assert.deepStrictEqual(core.evaluateReadiness({}).map((r) => r.id), core.READINESS_IDS);
});

test('a fully configured repo passes every rule', () => {
  const rows = core.evaluateReadiness(goodSnapshot());
  for (const r of rows) {
    assert.strictEqual(r.state, 'pass', `${r.id} was ${r.state}: ${r.label}`);
    assert.strictEqual(typeof r.label, 'string');
    assert.ok(r.label.length > 0, `${r.id} needs a label`);
  }
});

test('rule 1: missing workflows fail with the install hint', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    contents: { '.latch/policy.yml': true },
    workflows: []
  }));
  const wf = byId(rows, 'workflows');
  assert.strictEqual(wf.state, 'fail');
  assert.match(wf.label, /latch-review\.yml/);
  assert.match(wf.label, /latch-fix\.yml/);
  assert.match(wf.hint, /npx github:nishantkumar1292\/latch init/);
  assert.match(wf.hint, /default branch|master/);
});

test('rule 1: an installed but disabled workflow fails, not passes', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    workflows: [
      { path: REVIEW_PATH, state: 'disabled_manually' },
      { path: FIX_PATH, state: 'active' }
    ]
  }));
  const wf = byId(rows, 'workflows');
  assert.strictEqual(wf.state, 'fail');
  assert.match(wf.label, /disabled_manually/);
  assert.match(wf.hint, /enable it in the Actions tab/);
});

test('rule 2: a missing policy is a warning, not a failure', () => {
  const contents = { [REVIEW_PATH]: true, [FIX_PATH]: true };
  const rows = core.evaluateReadiness(goodSnapshot({ contents }));
  const policy = byId(rows, 'policy');
  assert.strictEqual(policy.state, 'warn');
  assert.match(policy.hint, /generic doctrine only/);
  assert.match(policy.hint, /latch init/);
  assert.strictEqual(byId(rows, 'workflows').state, 'pass', 'a missing policy must not mask the install row');
});

test('rule 3: the credential rule follows the provider, by NAME only', () => {
  const noSecret = core.evaluateReadiness(goodSnapshot({ secretNames: [] }));
  assert.strictEqual(byId(noSecret, 'secrets').state, 'fail');
  assert.match(byId(noSecret, 'secrets').hint, /CLAUDE_CODE_OAUTH_TOKEN/);

  const apiKey = core.evaluateReadiness(goodSnapshot({ secretNames: ['ANTHROPIC_API_KEY'] }));
  assert.strictEqual(byId(apiKey, 'secrets').state, 'pass');

  const both = core.evaluateReadiness(goodSnapshot({
    secretNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
  }));
  assert.strictEqual(byId(both, 'secrets').state, 'warn');
  assert.match(byId(both, 'secrets').hint, /exactly one/);

  const codexOk = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions' },
    secretNames: ['OPENAI_API_KEY']
  }));
  assert.strictEqual(byId(codexOk, 'secrets').state, 'pass');

  const codexMissing = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions' },
    secretNames: ['CLAUDE_CODE_OAUTH_TOKEN']
  }));
  assert.strictEqual(byId(codexMissing, 'secrets').state, 'fail');
  assert.match(byId(codexMissing, 'secrets').label, /OPENAI_API_KEY/);
});

test('rule 4: the reviewer app is required on claude, unverifiable is a warning', () => {
  const missing = core.evaluateReadiness(goodSnapshot({ appInstallations: [{ app_slug: 'dependabot' }] }));
  const failRow = byId(missing, 'reviewer-app');
  assert.strictEqual(failRow.state, 'fail');
  assert.match(failRow.hint, /claude\[bot\]/);
  assert.match(failRow.hint, /fix hop never fires/);

  const blind = core.evaluateReadiness(goodSnapshot({ appInstallations: null }));
  const warnRow = byId(blind, 'reviewer-app');
  assert.strictEqual(warnRow.state, 'warn');
  assert.match(warnRow.hint, /github\.com\/apps\/claude/);

  const codex = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions' },
    secretNames: ['OPENAI_API_KEY'],
    appInstallations: []
  }));
  const codexRow = byId(codex, 'reviewer-app');
  assert.strictEqual(codexRow.state, 'pass');
  assert.match(codexRow.hint, /workflow's own token/);
});

test('rule 5: variables pass when unset and fail by name when invalid', () => {
  const bare = core.evaluateReadiness(goodSnapshot());
  const bareRow = byId(bare, 'variables');
  assert.strictEqual(bareRow.state, 'pass');
  assert.match(bareRow.label, /none set/i);
  assert.match(bareRow.label, /the supported path/);

  const valid = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_MAX_TURNS: '120', LATCH_MAX_FIX_CYCLES: '2' }
  }));
  assert.strictEqual(byId(valid, 'variables').state, 'pass');
  assert.match(byId(valid, 'variables').label, /2 set, all valid/);

  const invalid = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_MAX_TURNS: '0', LATCH_MODEL: 'claude-opus-4-8 --yolo' }
  }));
  const invalidRow = byId(invalid, 'variables');
  assert.strictEqual(invalidRow.state, 'fail');
  assert.match(invalidRow.hint, /LATCH_MAX_TURNS/);
  assert.match(invalidRow.hint, /LATCH_MODEL/);
  assert.match(invalidRow.hint, /greater than 0/);
});

test('rule 6: codex with the claude reviewer identity is incoherent and fails', () => {
  const unsetLogin = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex' },
    secretNames: ['OPENAI_API_KEY']
  }));
  const unsetRow = byId(unsetLogin, 'provider-coherence');
  assert.strictEqual(unsetRow.state, 'fail');
  assert.match(unsetRow.hint, /does not post as claude\[bot\]/);
  assert.match(unsetRow.hint, /LATCH_REVIEW_LOGIN/);
  assert.match(unsetRow.hint, /no threads/);

  const explicitClaude = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'claude' },
    secretNames: ['OPENAI_API_KEY']
  }));
  assert.strictEqual(byId(explicitClaude, 'provider-coherence').state, 'fail');

  const fixed = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions' },
    secretNames: ['OPENAI_API_KEY']
  }));
  assert.strictEqual(byId(fixed, 'provider-coherence').state, 'pass');
});

test('rule 6: an off-brand reviewer login on the claude path is only a warning', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_REVIEW_LOGIN: 'github-actions' }
  }));
  const row = byId(rows, 'provider-coherence');
  assert.strictEqual(row.state, 'warn');
  assert.match(row.hint, /LATCH_REVIEW_LOGIN is "github-actions"/);
});

test('rule 6: a model from the wrong family fails, either way round', () => {
  const codexWithClaude = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions', LATCH_MODEL: 'claude-opus-4-8' },
    secretNames: ['OPENAI_API_KEY']
  }));
  const a = byId(codexWithClaude, 'provider-coherence');
  assert.strictEqual(a.state, 'fail');
  assert.match(a.hint, /cannot run a Claude model/);

  const codexFixModel = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PROVIDER: 'codex', LATCH_REVIEW_LOGIN: 'github-actions', LATCH_FIX_MODEL: 'claude-opus-4-8' },
    secretNames: ['OPENAI_API_KEY']
  }));
  const b = byId(codexFixModel, 'provider-coherence');
  assert.strictEqual(b.state, 'fail');
  assert.match(b.hint, /LATCH_FIX_MODEL/);

  const claudeWithGpt = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_MODEL: 'gpt-9-turbo' }
  }));
  const c = byId(claudeWithGpt, 'provider-coherence');
  assert.strictEqual(c.state, 'fail');
  assert.match(c.hint, /switch the provider or the model/);
});

test('rule 7: paused warns loudly and names the required-check trap', () => {
  const rows = core.evaluateReadiness(goodSnapshot({ variables: { LATCH_PAUSED: 'true' } }));
  const row = rows[0];
  assert.strictEqual(row.id, 'paused', 'paused is rendered first');
  assert.strictEqual(row.state, 'warn');
  assert.match(row.label, /PAUSED/);
  assert.match(row.hint, /no review runs/);
  assert.match(row.hint, /no verdict status/);
  assert.match(row.hint, /latch\/merge-gate/);
  assert.match(row.hint, /un-require it while paused or merges will block/);

  const live = core.evaluateReadiness(goodSnapshot({ variables: { LATCH_PAUSED: 'false' } }));
  assert.strictEqual(byId(live, 'paused').state, 'pass');
});

test('rule 7: the paused hint names the renamed verdict context, not the default', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    variables: { LATCH_PAUSED: 'true', LATCH_VERDICT_CONTEXT: 'ci/latch' }
  }));
  assert.match(byId(rows, 'paused').hint, /ci\/latch/);
});

test('rule 8: a sub-two-minute failure is the credential hint, not a code failure', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    runs: {
      'latch-review.yml': [healthyRun({
        conclusion: 'failure',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:00:41Z'
      })],
      'latch-fix.yml': [healthyRun()]
    }
  }));
  const row = byId(rows, 'run-health:latch-review.yml');
  assert.strictEqual(row.state, 'fail');
  assert.match(row.label, /failed in 41s/);
  assert.match(row.hint, /under two minutes/);
  assert.match(row.hint, /credential is rejected or over its usage limit/);
  assert.match(row.hint, /LATCH_PROVIDER/);
  assert.strictEqual(row.url, 'https://github.com/o/r/actions/runs/1');
  // The fix workflow is judged separately.
  assert.strictEqual(byId(rows, 'run-health:latch-fix.yml').state, 'pass');
});

test('rule 8: a long failure is a warning, and no runs is a warning', () => {
  const slow = core.evaluateReadiness(goodSnapshot({
    runs: {
      'latch-review.yml': [healthyRun({
        conclusion: 'failure',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:09:00Z'
      })],
      'latch-fix.yml': []
    }
  }));
  const slowRow = byId(slow, 'run-health:latch-review.yml');
  assert.strictEqual(slowRow.state, 'warn');
  assert.match(slowRow.hint, /read the log before changing config/);

  const none = byId(slow, 'run-health:latch-fix.yml');
  assert.strictEqual(none.state, 'warn');
  assert.match(none.label, /no runs yet/);
});

test('rule 8: an in-flight run passes with a note, an odd conclusion warns', () => {
  const rows = core.evaluateReadiness(goodSnapshot({
    runs: {
      'latch-review.yml': [healthyRun({ conclusion: null, status: 'in_progress' })],
      'latch-fix.yml': [healthyRun({ conclusion: 'cancelled' })]
    }
  }));
  const running = byId(rows, 'run-health:latch-review.yml');
  assert.strictEqual(running.state, 'pass');
  assert.match(running.label, /in_progress/);
  assert.ok(running.hint.length > 0, 'an in-flight run passes WITH a note');

  const odd = byId(rows, 'run-health:latch-fix.yml');
  assert.strictEqual(odd.state, 'warn');
  assert.match(odd.label, /cancelled/);
});

test('an unreadable API response degrades to a warning row, never a crash', () => {
  const rows = core.evaluateReadiness({
    defaultBranch: 'main',
    workflows: null,
    contents: null,
    secretNames: null,
    variables: null,
    appInstallations: null,
    runs: { 'latch-review.yml': null }
  });
  assert.deepStrictEqual(rows.map((r) => r.id), core.READINESS_IDS);
  for (const r of rows) {
    assert.strictEqual(r.state, 'warn', `${r.id} should degrade to warn, got ${r.state}`);
    assert.ok(r.label.length > 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1e. agentInstructions
// ─────────────────────────────────────────────────────────────────────────────

test('agentInstructions names the claude secret and the app requirement', () => {
  const text = core.agentInstructions({ owner: 'acme', repo: 'widgets', provider: 'claude', vars: {} });
  assert.match(text, /npx github:nishantkumar1292\/latch init/);
  assert.match(text, /acme\/widgets/);
  assert.match(text, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(text, /ANTHROPIC_API_KEY/);
  assert.match(text, /github\.com\/apps\/claude/);
  assert.doesNotMatch(text, /OPENAI_API_KEY/);
  assert.match(text, /only takes effect once it is on the default branch/);
  assert.match(text, /Latch never merges/);
  assert.doesNotMatch(text, /```/, 'plain text — no markdown fences');
});

test('agentInstructions swaps to the codex secret and the identity fix', () => {
  const text = core.agentInstructions({
    owner: 'acme',
    repo: 'widgets',
    provider: 'codex',
    vars: { LATCH_PROVIDER: 'codex' }
  });
  assert.match(text, /OPENAI_API_KEY/);
  assert.doesNotMatch(text, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(text, /LATCH_REVIEW_LOGIN --body "github-actions"/);
  assert.match(text, /No GitHub App install is needed/);
});

test('agentInstructions writes a gh variable line per non-default value only', () => {
  const text = core.agentInstructions({
    owner: 'acme',
    repo: 'widgets',
    provider: 'claude',
    vars: { LATCH_MAX_TURNS: '80', LATCH_MAX_FIX_CYCLES: '5', LATCH_PAUSED: 'true' }
  });
  assert.match(text, /gh variable set LATCH_MAX_FIX_CYCLES --body "5" --repo acme\/widgets/);
  assert.match(text, /gh variable set LATCH_PAUSED --body "true" --repo acme\/widgets/);
  // 80 IS the default, so it earns no line.
  assert.doesNotMatch(text, /LATCH_MAX_TURNS/);

  const bare = core.agentInstructions({ owner: 'acme', repo: 'widgets', vars: {} });
  assert.match(bare, /Set no variables/);
  assert.doesNotMatch(bare, /gh variable set/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1f. installPlan
// ─────────────────────────────────────────────────────────────────────────────

test('installPlan pins the branch, the three files and their canonical sources', () => {
  const plan = core.installPlan();
  assert.strictEqual(plan.branch, 'latch/install');
  assert.deepStrictEqual(plan.files, [
    { path: '.github/workflows/latch-review.yml', source: 'workflows/latch-review.yml' },
    { path: '.github/workflows/latch-fix.yml', source: 'workflows/latch-fix.yml' },
    { path: '.latch/policy.yml', source: 'policy/examples/policy.yml' }
  ]);
  assert.strictEqual(plan.prTitle, plan.prTitle.toLowerCase(), 'lowercase, imperative');
  assert.match(plan.prBody, /never merges/i);
  assert.match(plan.prBody, /github\.com\/apps\/claude/);
  assert.match(plan.prBody, /once it is on the default branch/);
  assert.match(plan.prBody, /Anti-tamper/i);
  assert.match(plan.prBody, /non-blocking/);
});

test('templateUrl builds a raw.githubusercontent URL and tolerates a missing slash', () => {
  assert.strictEqual(
    core.templateUrl('workflows/latch-fix.yml'),
    'https://raw.githubusercontent.com/nishantkumar1292/latch/master/workflows/latch-fix.yml'
  );
  assert.strictEqual(core.templateUrl('a/b.yml', 'https://example.test/base'), 'https://example.test/base/a/b.yml');
  assert.strictEqual(core.templateUrl('a/b.yml', 'https://example.test/base/'), 'https://example.test/base/a/b.yml');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1g. parseRepoInput
// ─────────────────────────────────────────────────────────────────────────────

test('parseRepoInput accepts the shapes a human actually pastes', () => {
  const expected = { owner: 'nishantkumar1292', repo: 'latch' };
  const inputs = [
    'nishantkumar1292/latch',
    '  nishantkumar1292/latch  ',
    'https://github.com/nishantkumar1292/latch',
    'http://github.com/nishantkumar1292/latch',
    'https://www.github.com/nishantkumar1292/latch',
    'https://github.com/nishantkumar1292/latch.git',
    'git+https://github.com/nishantkumar1292/latch.git',
    'https://github.com/nishantkumar1292/latch/pull/12',
    'https://github.com/nishantkumar1292/latch/tree/master/site',
    'github.com/nishantkumar1292/latch',
    'nishantkumar1292/latch.git'
  ];
  for (const input of inputs) {
    assert.deepStrictEqual(core.parseRepoInput(input), expected, `failed on: ${input}`);
  }
  assert.deepStrictEqual(core.parseRepoInput('a-b_c.d/e.f-g_h'), { owner: 'a-b_c.d', repo: 'e.f-g_h' });
});

test('parseRepoInput rejects everything else', () => {
  const bad = [
    '',
    '   ',
    'latch',
    'owner/',
    '/repo',
    'owner//repo',
    'owner/repo/extra',
    'owner repo',
    'https://gitlab.com/owner/repo',
    'https://example.com/owner/repo',
    'owner/re po',
    'owner/repo;rm -rf /',
    null,
    undefined,
    42,
    {}
  ];
  for (const input of bad) {
    assert.strictEqual(core.parseRepoInput(input), null, `should reject: ${String(input)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1h. the device flow, driven by an injected fetch
// ─────────────────────────────────────────────────────────────────────────────

const OAUTH_CFG = { clientId: 'Iv1.testclientid', proxyUrl: 'https://relay.example.test' };

// A fake fetch that answers from a queue and records every call, plus a fake
// sleep that records the delay and resolves immediately — so the machine is
// tested with no real timers and no network.
function fakeDeps(responses) {
  const calls = [];
  const sleeps = [];
  const queue = responses.slice();
  return {
    calls,
    sleeps,
    deps: {
      fetch(url, init) {
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url, method: init && init.method, body });
        if (!queue.length) throw new Error('fake fetch ran out of responses');
        const next = queue.shift();
        return Promise.resolve({ status: next.status || 200, json: () => Promise.resolve(next.json) });
      },
      sleep(ms) {
        sleeps.push(ms);
        return Promise.resolve();
      }
    }
  };
}

test('requestDeviceCode posts the client id and the repo+workflow scope', async () => {
  const f = fakeDeps([{
    json: {
      device_code: 'DEV-1',
      user_code: 'WXYZ-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900
    }
  }]);
  const result = await core.requestDeviceCode(f.deps, OAUTH_CFG);

  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].url, 'https://relay.example.test/login/device/code');
  assert.strictEqual(f.calls[0].method, 'POST');
  assert.strictEqual(f.calls[0].body.client_id, 'Iv1.testclientid');
  assert.strictEqual(f.calls[0].body.scope, 'repo workflow');
  assert.strictEqual(core.DEVICE_SCOPE, 'repo workflow');

  assert.strictEqual(result.device_code, 'DEV-1');
  assert.strictEqual(result.user_code, 'WXYZ-1234');
  assert.strictEqual(result.interval, 5);
});

test('requestDeviceCode surfaces a relay error instead of pretending it worked', async () => {
  const f = fakeDeps([{ status: 401, json: { error: 'incorrect_client_credentials' } }]);
  await assert.rejects(
    core.requestDeviceCode(f.deps, OAUTH_CFG),
    /incorrect_client_credentials/
  );
});

test('pollForToken keeps polling through authorization_pending, then returns the token', async () => {
  const f = fakeDeps([
    { json: { error: 'authorization_pending' } },
    { json: { access_token: 'gho_test', scope: 'repo,workflow', token_type: 'bearer' } }
  ]);
  const result = await core.pollForToken(f.deps, OAUTH_CFG, 'DEV-1', 5);

  assert.strictEqual(result.token, 'gho_test');
  assert.deepStrictEqual(result.scopes, ['repo', 'workflow']);
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(f.calls[0].url, 'https://relay.example.test/login/oauth/access_token');
  assert.strictEqual(f.calls[0].body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.strictEqual(f.calls[0].body.device_code, 'DEV-1');
  // It waits the interval BEFORE the first poll, as the device flow requires.
  assert.deepStrictEqual(f.sleeps, [5000, 5000]);
});

test('pollForToken adds five seconds on slow_down and carries on', async () => {
  const f = fakeDeps([
    { json: { error: 'slow_down' } },
    { json: { error: 'authorization_pending' } },
    { json: { access_token: 'gho_slow', scope: 'repo workflow' } }
  ]);
  const result = await core.pollForToken(f.deps, OAUTH_CFG, 'DEV-1', 5);
  assert.strictEqual(result.token, 'gho_slow');
  assert.deepStrictEqual(f.sleeps, [5000, 10000, 10000]);
});

test('pollForToken fails cleanly on expired_token and access_denied', async () => {
  const expired = fakeDeps([{ json: { error: 'expired_token' } }]);
  await assert.rejects(core.pollForToken(expired.deps, OAUTH_CFG, 'DEV-1', 5), /expired, start again/);

  const denied = fakeDeps([{ json: { error: 'access_denied' } }]);
  await assert.rejects(core.pollForToken(denied.deps, OAUTH_CFG, 'DEV-1', 5), /you cancelled the sign-in/);

  const unknown = fakeDeps([{ json: { error: 'device_flow_disabled', error_description: 'Device Flow is not enabled' } }]);
  await assert.rejects(core.pollForToken(unknown.deps, OAUTH_CFG, 'DEV-1', 5), /Device Flow is not enabled/);
});

test('pollForToken gives up rather than looping forever', async () => {
  const pending = [];
  for (let i = 0; i < 10; i++) pending.push({ json: { error: 'authorization_pending' } });
  const f = fakeDeps(pending);
  await assert.rejects(
    core.pollForToken(f.deps, OAUTH_CFG, 'DEV-1', 5, { maxAttempts: 3 }),
    /timed out, start again/
  );
  assert.strictEqual(f.calls.length, 3);
});

test('isOAuthConfigured is false until an owner has actually deployed the relay', () => {
  assert.strictEqual(core.isOAuthConfigured(OAUTH_CFG), true);
  assert.strictEqual(core.isOAuthConfigured({ OAUTH_CLIENT_ID: 'Iv1.abc', OAUTH_PROXY_URL: 'https://relay.example.test/' }), true);
  assert.strictEqual(core.isOAuthConfigured({ clientId: 'Iv1.abc', proxyUrl: 'http://localhost:8787' }), true);

  assert.strictEqual(core.isOAuthConfigured(null), false);
  assert.strictEqual(core.isOAuthConfigured({}), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: '', proxyUrl: 'https://relay.example.test' }), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: 'Iv1.abc', proxyUrl: '' }), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: '   ', proxyUrl: '   ' }), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: 'YOUR_CLIENT_ID', proxyUrl: 'https://relay.example.test' }), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: '<client-id>', proxyUrl: 'https://relay.example.test' }), false);
  assert.strictEqual(core.isOAuthConfigured({ clientId: 'Iv1.abc', proxyUrl: 'ftp://relay.example.test' }), false);
});

test('normalizeOAuthConfig trims and drops a trailing slash so URLs never double up', () => {
  const c = core.normalizeOAuthConfig({ clientId: '  Iv1.abc ', proxyUrl: ' https://relay.example.test// ' });
  assert.deepStrictEqual(c, { clientId: 'Iv1.abc', proxyUrl: 'https://relay.example.test' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1i. storage namespacing
// ─────────────────────────────────────────────────────────────────────────────

// A Map-backed stand-in for the Storage interface (getItem/setItem/removeItem/
// length/key), which is all makeStore uses.
function fakeStorage(options) {
  const map = new Map();
  const opts = options || {};
  return {
    map,
    getItem(k) {
      if (opts.throwOnRead) throw new Error('SecurityError');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (opts.throwOnWrite) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    key(i) { return Array.from(map.keys())[i]; },
    get length() { return map.size; }
  };
}

test('storageKey namespaces by login and falls back to pat', () => {
  assert.strictEqual(core.storageKey('octocat', 'repo'), 'latch-console:octocat:repo');
  assert.strictEqual(core.storageKey('', 'repo'), 'latch-console:pat:repo');
  assert.strictEqual(core.storageKey(null, 'repo'), 'latch-console:pat:repo');
  assert.strictEqual(core.TOKEN_KEY, 'latch-console:token');
});

test('two logins in one browser never read or clear each other', () => {
  const storage = fakeStorage();
  const octo = core.makeStore(storage, 'octocat');
  const hub = core.makeStore(storage, 'hubot');

  octo.set('repo', 'octocat/one');
  hub.set('repo', 'hubot/two');
  storage.setItem(core.TOKEN_KEY, 'gho_shared');

  assert.strictEqual(octo.get('repo'), 'octocat/one');
  assert.strictEqual(hub.get('repo'), 'hubot/two');
  assert.strictEqual(storage.map.get('latch-console:octocat:repo'), 'octocat/one');
  assert.strictEqual(storage.map.get('latch-console:hubot:repo'), 'hubot/two');

  // Signing octocat out wipes octocat's keys and the shared token, and nothing
  // belonging to hubot.
  assert.strictEqual(octo.clearAll(), true);
  assert.strictEqual(octo.get('repo'), null);
  assert.strictEqual(storage.map.has(core.TOKEN_KEY), false);
  assert.strictEqual(hub.get('repo'), 'hubot/two');
});

test('clearAll leaves keys that are not the console\'s alone', () => {
  const storage = fakeStorage();
  storage.setItem('latch-theme', 'dark');
  storage.setItem('unrelated-app:state', 'keep me');
  const store = core.makeStore(storage, 'octocat');
  store.set('repo', 'octocat/one');
  store.clearAll();
  assert.strictEqual(storage.getItem('latch-theme'), 'dark');
  assert.strictEqual(storage.getItem('unrelated-app:state'), 'keep me');
  assert.strictEqual(storage.getItem('latch-console:octocat:repo'), null);
});

test('storage access survives a private window that throws on every call', () => {
  const reads = core.makeStore(fakeStorage({ throwOnRead: true }), 'octocat');
  assert.strictEqual(reads.get('repo'), null);

  const writes = core.makeStore(fakeStorage({ throwOnWrite: true }), 'octocat');
  assert.strictEqual(writes.set('repo', 'a/b'), false);

  const none = core.makeStore(null, 'octocat');
  assert.strictEqual(none.get('repo'), null);
  assert.strictEqual(none.set('repo', 'a/b'), false);
  assert.strictEqual(none.remove('repo'), false);
  assert.strictEqual(none.clearAll(), false);
});

test('remove takes out one key without touching the rest', () => {
  const storage = fakeStorage();
  const store = core.makeStore(storage, 'octocat');
  store.set('repo', 'octocat/one');
  store.set('provider', 'codex');
  store.remove('repo');
  assert.strictEqual(store.get('repo'), null);
  assert.strictEqual(store.get('provider'), 'codex');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1j. the token permission matrix and the prefilled deep links
//
// These pin values checked against GitHub's own reference. Two of them are the
// kind of detail that is silently wrong when guessed, so they get their own
// assertions: Workflows is a permission of its own (Contents:write does not
// authorize a .github/workflows/ commit), and Variables' query key is
// `actions_variables`, not `variables`.
// ─────────────────────────────────────────────────────────────────────────────

test('the permission matrix covers exactly what the console calls, and says why', () => {
  const names = core.TOKEN_PERMISSIONS.map((p) => p.name);
  assert.deepStrictEqual(names, [
    'Metadata',
    'Contents',
    'Workflows',
    'Pull requests',
    'Variables',
    'Secrets',
    'Actions'
  ]);

  for (const permission of core.TOKEN_PERMISSIONS) {
    assert.ok(permission.param, `${permission.name} needs a query-parameter key`);
    assert.match(permission.param, /^[a-z_]+$/, `${permission.name} key shape`);
    assert.ok(permission.level === 'read' || permission.level === 'write', `${permission.name} level`);
    assert.ok(permission.why && permission.why.length > 30, `${permission.name} needs a real reason`);
  }
});

test('the write permissions are exactly the four the console writes with', () => {
  const writes = core.TOKEN_PERMISSIONS.filter((p) => p.level === 'write').map((p) => p.name);
  assert.deepStrictEqual(writes, ['Contents', 'Workflows', 'Pull requests', 'Variables']);

  // Secrets is READ, and never anything more: the console reads secret NAMES to
  // check a credential exists and must never be able to read or set a value.
  const secrets = core.TOKEN_PERMISSIONS.filter((p) => p.name === 'Secrets')[0];
  assert.strictEqual(secrets.level, 'read');
  assert.match(secrets.why, /[Nn]ames only/);
});

test('Workflows is its own permission, and the matrix explains why', () => {
  const workflows = core.TOKEN_PERMISSIONS.filter((p) => p.name === 'Workflows')[0];
  assert.strictEqual(workflows.param, 'workflows');
  assert.strictEqual(workflows.level, 'write');
  assert.match(workflows.why, /\.github\/workflows\//);
  assert.match(workflows.why, /Contents write/);
});

test("Variables' query key is actions_variables, the one that breaks the naming rule", () => {
  const variables = core.TOKEN_PERMISSIONS.filter((p) => p.name === 'Variables')[0];
  assert.strictEqual(variables.param, 'actions_variables');
  assert.strictEqual(variables.level, 'write');

  // Every OTHER key is the display name lowercased with spaces underscored.
  for (const permission of core.TOKEN_PERMISSIONS) {
    if (permission.name === 'Variables') continue;
    assert.strictEqual(
      permission.param,
      permission.name.toLowerCase().replace(/ /g, '_'),
      `${permission.name} should follow the plain naming rule`
    );
  }
});

test('levelLabel reads as the words GitHub puts on the radio buttons', () => {
  assert.strictEqual(core.levelLabel('write'), 'Read and write');
  assert.strictEqual(core.levelLabel('read'), 'Read-only');
});

test('fineGrainedTokenUrl builds the documented prefill URL', () => {
  const url = core.fineGrainedTokenUrl({ owner: 'octocat', expiresIn: 90 });
  assert.ok(url.indexOf('https://github.com/settings/personal-access-tokens/new?') === 0, url);
  assert.match(url, /[?&]name=Latch\+Console(&|$)/);
  assert.match(url, /[?&]target_name=octocat(&|$)/);
  assert.match(url, /[?&]expires_in=90(&|$)/);

  // Every permission in the matrix reaches the URL at its own level.
  for (const permission of core.TOKEN_PERMISSIONS) {
    assert.match(url, new RegExp('[?&]' + permission.param + '=' + permission.level + '(&|$)'), permission.name);
  }
  assert.match(url, /[?&]actions_variables=write(&|$)/);
  assert.match(url, /[?&]workflows=write(&|$)/);
  assert.match(url, /[?&]secrets=read(&|$)/);
  // Spaces as '+', matching GitHub's own example.
  assert.doesNotMatch(url, /%20/);
});

test('fineGrainedTokenUrl omits what it does not know', () => {
  const url = core.fineGrainedTokenUrl({});
  assert.doesNotMatch(url, /target_name=/, 'no owner chosen yet');
  assert.doesNotMatch(url, /expires_in=/);
  assert.match(url, /name=Latch\+Console/);
  assert.match(url, /contents=write/);

  // Called with nothing at all it must still be a usable link.
  const bare = core.fineGrainedTokenUrl();
  assert.ok(bare.indexOf('https://github.com/settings/personal-access-tokens/new?') === 0);
});

test('classicTokenUrl asks for repo plus workflow, and nothing else', () => {
  const url = core.classicTokenUrl();
  assert.ok(url.indexOf('https://github.com/settings/tokens/new?') === 0, url);
  assert.match(url, /description=Latch\+Console/);
  assert.match(url, /scopes=repo,workflow/);
  // `workflow` is not optional: a classic token cannot push a workflow file
  // without it, exactly as the fine-grained Workflows permission is required.
  assert.deepStrictEqual(core.CLASSIC_SCOPES, ['repo', 'workflow']);
});

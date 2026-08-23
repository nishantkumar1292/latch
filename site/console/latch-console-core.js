'use strict';

/*
 * latch-console-core.js — the Latch console's pure logic.
 *
 * No DOM, no globals, no network of its own: every function here is either a
 * pure transform of plain JSON or takes its I/O as an injected dependency, so
 * the whole file is unit-testable under `node --test` and reusable verbatim in
 * the browser. The console page (latch-console.js) owns all the DOM and all the
 * real fetch calls; this file owns the rules.
 *
 * The console configures a repo's own GitHub Actions variables. GitHub is the
 * backend — there is no Latch server in the loop, and nothing here ever reads,
 * stores or transmits a secret VALUE (the secrets API is used for NAMES only).
 *
 * Dual-target export: CommonJS for node --test, a single global for the page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LatchConsoleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────────
  // Constants
  // ───────────────────────────────────────────────────────────────────────────

  var PROVIDERS = ['claude', 'codex'];

  // The provider's own fallbacks, i.e. what the workflow uses when the variable
  // is unset. `claude` mirrors latch-review.yml's shell defaults exactly
  // (model claude-opus-4-8, review effort xhigh, fix effort high). On the codex
  // path the model default is the Codex action's own — we do not invent a name
  // for it, so an unset LATCH_MODEL there resolves to "" plus a note.
  var PROVIDER_DEFAULTS = {
    claude: { model: 'claude-opus-4-8', reviewEffort: 'xhigh', fixEffort: 'high' },
    codex: { model: '', reviewEffort: 'high', fixEffort: 'high' }
  };
  var CODEX_MODEL_NOTE = 'the Codex action\'s own default model';

  // Suggestions only — never a whitelist. The workflows accept ANY single
  // [A-Za-z0-9._-] token, and model names change over time, so the console
  // offers a free-text input with a datalist of the names we can state as fact:
  // claude-opus-4-8 is the templates' documented default; for codex we list
  // nothing rather than guess.
  var MODEL_OPTIONS = {
    claude: ['claude-opus-4-8'],
    codex: []
  };

  // Effort: xhigh is the templates' documented review default on the claude
  // path. On the codex path effort maps to the Codex CLI's
  // `model_reasoning_effort`, which has no xhigh. Free text is accepted either
  // way.
  var EFFORT_OPTIONS = {
    claude: ['xhigh', 'high', 'medium', 'low'],
    codex: ['high', 'medium', 'low', 'minimal']
  };

  var REVIEW_WORKFLOW = 'latch-review.yml';
  var FIX_WORKFLOW = 'latch-fix.yml';
  var WORKFLOW_FILES = [REVIEW_WORKFLOW, FIX_WORKFLOW];
  var WORKFLOW_PATHS = ['.github/workflows/' + REVIEW_WORKFLOW, '.github/workflows/' + FIX_WORKFLOW];
  var POLICY_PATH = '.latch/policy.yml';

  var CLAUDE_SECRETS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  var CODEX_SECRET = 'OPENAI_API_KEY';

  var TEMPLATE_BASE = 'https://raw.githubusercontent.com/nishantkumar1292/latch/master/';
  var INSTALL_COMMAND = 'npx github:nishantkumar1292/latch init';
  var CLAUDE_APP_URL = 'https://github.com/apps/claude';

  // A single token, [A-Za-z0-9._-], never dash-led. This is not cosmetic: these
  // values land inside the agent's command line, where a space or a leading
  // dash turns one argument into two (`claude-opus-4-8 --dangerously-skip-
  // permissions`) and silently switches off a safety nobody agreed to.
  var TOKEN_RE = /^[A-Za-z0-9._-]+$/;
  // A commit-status context is passed as a quoted API field, never as a flag,
  // so '/' is legal there ("latch/merge-gate") and only there.
  var CONTEXT_RE = /^[A-Za-z0-9._/-]+$/;

  var FLAG_INJECTION_NOTE =
    'this value is handed to the agent as a command-line argument, where a space or a leading dash would splice in an extra flag nobody configured.';

  // ───────────────────────────────────────────────────────────────────────────
  // 1a. The LATCH_* variable schema — the contract between console and workflow
  // ───────────────────────────────────────────────────────────────────────────

  var VARS = [
    {
      name: 'LATCH_PAUSED',
      group: 'killswitch',
      type: 'enum',
      options: ['true', 'false'],
      default: 'false',
      consumedBy: ['review', 'fix'],
      help: 'Kill switch. Set to true and both workflows no-op immediately: no review runs, no fix runs, no verdict status. Nothing is uninstalled — flip it back to false to resume.'
    },
    {
      name: 'LATCH_PROVIDER',
      group: 'reviewer',
      type: 'enum',
      options: PROVIDERS,
      default: 'claude',
      consumedBy: ['review', 'fix'],
      help: 'Which agent engine runs the loop. claude uses the Claude GitHub App plus a Claude credential; codex uses an OpenAI credential and posts the review with the workflow\'s own token.'
    },
    {
      name: 'LATCH_MODEL',
      group: 'reviewer',
      type: 'token',
      default: '',
      defaultNote: 'provider default (claude: claude-opus-4-8)',
      consumedBy: ['review', 'fix'],
      help: 'The reviewer\'s model, and the fixer\'s too unless LATCH_FIX_MODEL is set. This is the independence knob: point it at a model unlike the one that wrote the PR. Any single [A-Za-z0-9._-] token your provider accepts; leave it unset for the provider default. Model names change — check your provider\'s model list. The suggestions are a datalist, not a whitelist.'
    },
    {
      name: 'LATCH_FIX_MODEL',
      group: 'fixer',
      type: 'token',
      default: '',
      defaultNote: 'falls back to LATCH_MODEL',
      consumedBy: ['fix'],
      help: 'The fixer\'s model. Unset means it uses LATCH_MODEL (and, if that is unset too, the provider default). Any single [A-Za-z0-9._-] token your provider accepts; model names change, so check your provider\'s model list.'
    },
    {
      name: 'LATCH_REVIEW_EFFORT',
      group: 'reviewer',
      type: 'token',
      default: '',
      defaultNote: 'claude: xhigh, codex: high',
      consumedBy: ['review'],
      help: 'Reasoning effort for the review pass — the high-value doctrine pass. Keep it high for stakes-heavy repos; lower it to cut cost. On the codex path this maps to the Codex CLI\'s model_reasoning_effort (no xhigh there). Free text is accepted.'
    },
    {
      name: 'LATCH_EFFORT',
      group: 'fixer',
      type: 'token',
      default: '',
      defaultNote: 'high',
      consumedBy: ['fix'],
      help: 'Reasoning effort for the fixer pass. On the codex path this maps to the Codex CLI\'s model_reasoning_effort (no xhigh there). Free text is accepted.'
    },
    {
      name: 'LATCH_MAX_TURNS',
      group: 'guards',
      type: 'int',
      min: 1,
      max: 500,
      default: '80',
      consumedBy: ['review', 'fix'],
      help: 'Agent turn budget per run (claude engine only — the codex engine has no turn cap). Raise it alongside LATCH_TIMEOUT_MINUTES: more turns need more minutes, or the job is cancelled mid-run instead of finishing.'
    },
    {
      name: 'LATCH_TIMEOUT_MINUTES',
      group: 'guards',
      type: 'int',
      min: 1,
      max: 360,
      default: '',
      defaultNote: 'fixer 25, reviewer GitHub default 360',
      consumedBy: ['review', 'fix'],
      help: 'The job\'s wall clock in minutes. Unset, the fixer job caps itself at 25 minutes and the reviewer job takes GitHub\'s 360-minute default.'
    },
    {
      name: 'LATCH_MAX_FIX_CYCLES',
      group: 'guards',
      type: 'int',
      min: 1,
      max: 10,
      default: '3',
      consumedBy: ['fix'],
      help: 'The fix-cycle cap. A cycle is consumed only when a real fix lands; on the cap the fixer @-mentions the author and stops instead of spinning.'
    },
    {
      name: 'LATCH_VERDICT_STATUS',
      group: 'reviewer',
      type: 'enum',
      options: ['on', 'off'],
      default: 'on',
      consumedBy: ['review'],
      help: 'Whether the verdict is published as a commit status. The status is non-blocking until you mark it required in branch protection yourself.'
    },
    {
      name: 'LATCH_VERDICT_CONTEXT',
      group: 'reviewer',
      type: 'status-context',
      default: 'latch/merge-gate',
      consumedBy: ['review'],
      help: 'The commit-status context name. Renaming it orphans any branch-protection rule that requires the old name, so change it before you require the check, not after.'
    },
    {
      name: 'LATCH_REVIEW_LOGIN',
      group: 'guards',
      type: 'token',
      default: 'claude',
      consumedBy: ['fix'],
      help: 'The reviewer identity the fixer\'s thread queries filter on. Use claude for the Claude GitHub App (GraphQL drops the [bot] suffix), or github-actions when a codex reviewer posts with GITHUB_TOKEN. Get this wrong and the fixer sees no threads and exits green with nothing done.'
    },
    {
      name: 'LATCH_DOCTRINE',
      group: 'reviewer',
      type: 'token',
      default: '',
      defaultNote: 'the built-in doctrine only',
      consumedBy: ['review', 'fix'],
      help: 'Selects .latch/doctrines/<name>.md when that file is present, appending it to the built-in doctrine. Unset runs the built-in doctrine alone.'
    }
  ];

  var VAR_GROUPS = [
    { id: 'killswitch', title: 'Kill switch', blurb: 'Stop the loop everywhere without uninstalling anything.' },
    { id: 'reviewer', title: 'Reviewer', blurb: 'Which engine reviews, how hard it thinks, and what it publishes.' },
    { id: 'fixer', title: 'Fixer', blurb: 'The half that patches real defects and argues with the wrong findings.' },
    { id: 'guards', title: 'Loop guards', blurb: 'The bounds that keep a probabilistic loop from spinning or overspending.' }
  ];

  var VAR_INDEX = {};
  for (var vi = 0; vi < VARS.length; vi++) VAR_INDEX[VARS[vi].name] = VARS[vi];

  function varSpec(name) {
    return Object.prototype.hasOwnProperty.call(VAR_INDEX, name) ? VAR_INDEX[name] : null;
  }

  function varNames() {
    return VARS.map(function (spec) { return spec.name; });
  }

  function varsInGroup(group) {
    return VARS.filter(function (spec) { return spec.group === group; });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1b. Validation — mirrors the workflow's own checks
  // ───────────────────────────────────────────────────────────────────────────

  // Deleting a variable is always allowed and means "use the default". That is
  // a separate concept from validation: an EMPTY value never validates, because
  // setting a variable to blank is not the same as not setting it.
  function isUnset(value) {
    return value === null || value === undefined || String(value) === '';
  }

  function optionList(spec) {
    return (spec.options || []).join(', ');
  }

  function validateVar(name, value) {
    var spec = varSpec(name);
    if (!spec) return { ok: false, error: name + ' is not a Latch variable.' };

    var raw = value === null || value === undefined ? '' : String(value);

    if (raw === '') {
      return {
        ok: false,
        error: name + ' is empty. Delete the variable to fall back to its default — a blank value is not the same as an unset one.'
      };
    }

    if (spec.type === 'enum') {
      if (spec.options.indexOf(raw) === -1) {
        return { ok: false, error: name + ' must be one of: ' + optionList(spec) + '. Got "' + raw + '".' };
      }
      return { ok: true };
    }

    if (spec.type === 'int') {
      if (!/^\d+$/.test(raw)) {
        return {
          ok: false,
          error: name + ' must be a whole number with no sign, spaces or units. Got "' + raw + '" — the workflow validates this at config time and fails the run loudly rather than guessing.'
        };
      }
      var n = parseInt(raw, 10);
      if (!(n > 0)) {
        return {
          ok: false,
          error: name + ' must be greater than 0. Zero and negatives silently fall back to the default, so set a real number between ' + spec.min + ' and ' + spec.max + ' or delete the variable.'
        };
      }
      if (n < spec.min || n > spec.max) {
        return { ok: false, error: name + ' must be between ' + spec.min + ' and ' + spec.max + '. Got ' + n + '.' };
      }
      return { ok: true };
    }

    if (spec.type === 'token' || spec.type === 'status-context') {
      var isContext = spec.type === 'status-context';
      var pattern = isContext ? CONTEXT_RE : TOKEN_RE;
      var charset = isContext ? '[A-Za-z0-9._/-]' : '[A-Za-z0-9._-]';
      var tail = isContext
        ? 'a commit-status context is sent as a quoted API field, so "/" is fine here — but whitespace is not.'
        : FLAG_INJECTION_NOTE;

      if (/\s/.test(raw)) {
        return { ok: false, error: name + ' must be a single token with no whitespace: ' + tail };
      }
      if (raw.charAt(0) === '-') {
        return {
          ok: false,
          error: name + ' must not start with "-": a dash-led value can be read as a flag of its own, and ' + tail
        };
      }
      if (!pattern.test(raw)) {
        return { ok: false, error: name + ' may only contain ' + charset + ' characters. Got "' + raw + '" — ' + tail };
      }
      return { ok: true };
    }

    return { ok: false, error: name + ' has an unknown type "' + spec.type + '".' };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1c. What the workflow will actually use
  // ───────────────────────────────────────────────────────────────────────────

  function resolveProvider(varsOrName) {
    var candidate = varsOrName;
    if (candidate && typeof candidate === 'object') candidate = candidate.LATCH_PROVIDER;
    candidate = candidate === null || candidate === undefined ? '' : String(candidate);
    return PROVIDERS.indexOf(candidate) === -1 ? 'claude' : candidate;
  }

  function providerDefaults(provider) {
    return PROVIDER_DEFAULTS[resolveProvider(provider)];
  }

  function read(vars, name) {
    if (!vars) return '';
    var value = vars[name];
    return value === null || value === undefined ? '' : String(value);
  }

  function effectiveValue(name, vars, provider) {
    var spec = varSpec(name);
    if (!spec) return { value: '', isDefault: true, isSet: false, note: name + ' is not a Latch variable.' };

    var p = provider ? resolveProvider(provider) : resolveProvider(vars);
    var defaults = PROVIDER_DEFAULTS[p];
    var raw = read(vars, name);
    var fallback = { value: spec.default, note: spec.defaultNote || '' };

    if (name === 'LATCH_MODEL') {
      fallback = defaults.model
        ? { value: defaults.model, note: 'provider default for ' + p }
        : { value: '', note: 'unset: ' + CODEX_MODEL_NOTE };
    } else if (name === 'LATCH_REVIEW_EFFORT') {
      fallback = { value: defaults.reviewEffort, note: 'provider default for ' + p };
    } else if (name === 'LATCH_EFFORT') {
      fallback = { value: defaults.fixEffort, note: 'the fixer default' };
    } else if (name === 'LATCH_FIX_MODEL') {
      // The fallback chain: LATCH_FIX_MODEL -> LATCH_MODEL -> provider default.
      var inherited = read(vars, 'LATCH_MODEL');
      fallback = inherited
        ? { value: inherited, note: 'inherited from LATCH_MODEL' }
        : defaults.model
          ? { value: defaults.model, note: 'provider default for ' + p + ', via LATCH_MODEL' }
          : { value: '', note: 'unset: ' + CODEX_MODEL_NOTE + ', via LATCH_MODEL' };
    } else if (name === 'LATCH_TIMEOUT_MINUTES') {
      fallback = {
        value: '',
        note: 'unset: the fixer job caps at 25 minutes, the reviewer job at GitHub\'s 360-minute default'
      };
    } else if (name === 'LATCH_DOCTRINE') {
      fallback = { value: '', note: 'unset: the built-in doctrine only' };
    }

    if (isUnset(raw)) {
      return { value: fallback.value, isDefault: true, isSet: false, note: fallback.note };
    }
    return {
      value: raw,
      isDefault: raw === fallback.value,
      isSet: true,
      note: raw === fallback.value ? 'set to the same value as the default' : ''
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1d. Readiness — pure rules over a snapshot of GitHub API responses
  // ───────────────────────────────────────────────────────────────────────────

  var READINESS_IDS = [
    'paused',
    'workflows',
    'policy',
    'secrets',
    'reviewer-app',
    'variables',
    'provider-coherence',
    'run-health:' + REVIEW_WORKFLOW,
    'run-health:' + FIX_WORKFLOW
  ];

  function row(id, state, label, hint, extra) {
    var out = { id: id, state: state, label: label, hint: hint || '' };
    if (extra && extra.url) out.url = extra.url;
    return out;
  }

  function worst(a, b) {
    var rank = { pass: 0, warn: 1, fail: 2 };
    return rank[b] > rank[a] ? b : a;
  }

  function readable(value) {
    return value !== null && value !== undefined;
  }

  function evaluateReadiness(snapshot) {
    var snap = snapshot || {};
    var vars = readable(snap.variables) ? snap.variables : null;
    var provider = resolveProvider(vars || {});
    var defaultBranch = snap.defaultBranch || 'the default branch';
    var results = [];

    // 7. paused — first, because it explains every quiet row under it.
    if (!vars) {
      results.push(row('paused', 'warn', 'Kill switch: unknown', 'The repo\'s Actions variables could not be read, so LATCH_PAUSED is unknown.'));
    } else if (read(vars, 'LATCH_PAUSED') === 'true') {
      results.push(row(
        'paused',
        'warn',
        'The loop is PAUSED',
        'LATCH_PAUSED is true: no review runs and no verdict status is posted. If you marked ' + effectiveValue('LATCH_VERDICT_CONTEXT', vars, provider).value + ' a required check, un-require it while paused or merges will block.'
      ));
    } else {
      results.push(row('paused', 'pass', 'The loop is live', 'LATCH_PAUSED is false — reviews run normally.'));
    }

    // 1. workflows
    var contents = readable(snap.contents) ? snap.contents : null;
    if (!contents) {
      results.push(row('workflows', 'warn', 'Workflows: unknown', 'The repo contents could not be read, so the install could not be confirmed.'));
    } else {
      var missing = WORKFLOW_PATHS.filter(function (path) { return !contents[path]; });
      if (missing.length) {
        results.push(row(
          'workflows',
          'fail',
          'Missing on ' + defaultBranch + ': ' + missing.join(', '),
          'Run ' + INSTALL_COMMAND + ' (or open the integration PR from the Install card above) and merge it. Note that latch-fix.yml only takes effect once it is on ' + defaultBranch + '.'
        ));
      } else {
        var listed = readable(snap.workflows) ? snap.workflows : [];
        var disabled = listed.filter(function (wf) {
          return WORKFLOW_PATHS.indexOf(wf.path) !== -1 && wf.state && wf.state !== 'active';
        });
        if (disabled.length) {
          results.push(row(
            'workflows',
            'fail',
            'Installed but disabled: ' + disabled.map(function (wf) { return wf.path + ' (' + wf.state + ')'; }).join(', '),
            'The workflow is disabled — enable it in the Actions tab. A disabled workflow never runs and never fails, so the loop just silently does not happen.'
          ));
        } else {
          results.push(row('workflows', 'pass', 'Both workflows installed and active on ' + defaultBranch, ''));
        }
      }
    }

    // 2. policy
    if (!contents) {
      results.push(row('policy', 'warn', 'Policy: unknown', 'The repo contents could not be read, so ' + POLICY_PATH + ' could not be checked.'));
    } else if (contents[POLICY_PATH]) {
      results.push(row('policy', 'pass', POLICY_PATH + ' present', 'The review reads your doctrine, landmines and check commands from it.'));
    } else {
      results.push(row(
        'policy',
        'warn',
        'No ' + POLICY_PATH,
        'The review runs with generic doctrine only; `latch init` mines a policy from your repo. Not fatal — the landmine list is where most of the value is.'
      ));
    }

    // 3. secrets — NAMES ONLY. A secret value is never read, shown or stored.
    var secretNames = readable(snap.secretNames) ? snap.secretNames : null;
    if (!secretNames) {
      results.push(row('secrets', 'warn', 'Credential: unknown', 'The repo\'s secret NAMES could not be read (that call needs a token with Secrets read). Values are never read by this page.'));
    } else if (provider === 'codex') {
      if (secretNames.indexOf(CODEX_SECRET) !== -1) {
        results.push(row('secrets', 'pass', CODEX_SECRET + ' is set', 'Name only — this page never reads a secret value.'));
      } else {
        results.push(row(
          'secrets',
          'fail',
          'No ' + CODEX_SECRET,
          'LATCH_PROVIDER is codex, so add the repository secret ' + CODEX_SECRET + ' under Settings -> Secrets and variables -> Actions.'
        ));
      }
    } else {
      var present = CLAUDE_SECRETS.filter(function (n) { return secretNames.indexOf(n) !== -1; });
      if (present.length === 2) {
        results.push(row(
          'secrets',
          'warn',
          'Both ' + CLAUDE_SECRETS.join(' and ') + ' are set',
          'Set exactly one. With both present it is the action, not you, that decides which credential (and which bill) the run draws on.'
        ));
      } else if (present.length === 1) {
        results.push(row('secrets', 'pass', present[0] + ' is set', 'Name only — this page never reads a secret value.'));
      } else {
        results.push(row(
          'secrets',
          'fail',
          'No Claude credential',
          'Add exactly one repository secret: CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, drawing on your Claude subscription) or ANTHROPIC_API_KEY (metered).'
        ));
      }
    }

    // 4. reviewer-app
    if (provider === 'codex') {
      results.push(row(
        'reviewer-app',
        'pass',
        'No GitHub App needed for a codex reviewer',
        'A codex review posts with the workflow\'s own token, so set LATCH_REVIEW_LOGIN to that identity (github-actions) or the fixer will look for threads that do not exist.'
      ));
    } else if (snap.appInstallations === null || snap.appInstallations === undefined) {
      results.push(row(
        'reviewer-app',
        'warn',
        'Claude GitHub App: could not check',
        'This token cannot list app installations. Verify manually at ' + CLAUDE_APP_URL + ' — the review must post as claude[bot].'
      ));
    } else {
      var hasClaude = snap.appInstallations.some(function (inst) {
        return inst && String(inst.app_slug || '').toLowerCase() === 'claude';
      });
      if (hasClaude) {
        results.push(row('reviewer-app', 'pass', 'The Claude GitHub App is installed', 'Its review fires the pull_request_review event that wakes the fixer.'));
      } else {
        results.push(row(
          'reviewer-app',
          'fail',
          'The Claude GitHub App is not installed',
          'The review must post as claude[bot] or the fix hop never fires and the loop is dead. Install it at ' + CLAUDE_APP_URL + '.'
        ));
      }
    }

    // 5. variables
    if (!vars) {
      results.push(row('variables', 'warn', 'Variables: unknown', 'The repo\'s Actions variables could not be read.'));
    } else {
      var setNames = varNames().filter(function (name) { return !isUnset(read(vars, name)); });
      var invalid = [];
      setNames.forEach(function (name) {
        var verdict = validateVar(name, read(vars, name));
        if (!verdict.ok) invalid.push(verdict.error);
      });
      if (invalid.length) {
        results.push(row('variables', 'fail', invalid.length + ' invalid variable' + (invalid.length === 1 ? '' : 's'), invalid.join(' ')));
      } else if (setNames.length === 0) {
        results.push(row('variables', 'pass', 'None set — running on defaults, the supported path', 'A fresh install works with no variables at all.'));
      } else {
        results.push(row('variables', 'pass', setNames.length + ' set, all valid', setNames.join(', ')));
      }
    }

    // 6. provider-coherence
    if (vars) {
      var problems = [];
      var state = 'pass';
      var login = read(vars, 'LATCH_REVIEW_LOGIN');
      var model = read(vars, 'LATCH_MODEL');
      var fixModel = read(vars, 'LATCH_FIX_MODEL');

      if (provider === 'codex' && (isUnset(login) || login === 'claude')) {
        state = worst(state, 'fail');
        problems.push('A codex review does not post as claude[bot]; set LATCH_REVIEW_LOGIN to the identity your reviewer actually posts under (github-actions for a workflow-token review), or the fixer will see no threads.');
      }
      if (provider === 'claude' && !isUnset(login) && login !== 'claude') {
        state = worst(state, 'warn');
        problems.push('LATCH_PROVIDER is claude but LATCH_REVIEW_LOGIN is "' + login + '". The Claude GitHub App posts as claude — unless you have a different reviewer identity in front of it, this filter matches nothing.');
      }
      if (provider === 'codex') {
        if (/^claude/i.test(model)) {
          state = worst(state, 'fail');
          problems.push('LATCH_MODEL is "' + model + '" but LATCH_PROVIDER is codex; the codex engine cannot run a Claude model.');
        }
        if (/^claude/i.test(fixModel)) {
          state = worst(state, 'fail');
          problems.push('LATCH_FIX_MODEL is "' + fixModel + '" but LATCH_PROVIDER is codex; the codex engine cannot run a Claude model.');
        }
      } else {
        if (/^gpt/i.test(model)) {
          state = worst(state, 'fail');
          problems.push('LATCH_MODEL is "' + model + '" but LATCH_PROVIDER is claude; switch the provider or the model.');
        }
        if (/^gpt/i.test(fixModel)) {
          state = worst(state, 'fail');
          problems.push('LATCH_FIX_MODEL is "' + fixModel + '" but LATCH_PROVIDER is claude; switch the provider or the model.');
        }
      }

      results.push(row(
        'provider-coherence',
        state,
        state === 'pass' ? 'Provider, model and reviewer identity agree (' + provider + ')' : problems.length + ' provider mismatch' + (problems.length === 1 ? '' : 'es'),
        problems.join(' ')
      ));
    } else {
      results.push(row('provider-coherence', 'warn', 'Provider coherence: unknown', 'The repo\'s Actions variables could not be read.'));
    }

    // 8. run-health, per workflow, review first
    WORKFLOW_FILES.forEach(function (file) {
      var id = 'run-health:' + file;
      var runs = snap.runs ? snap.runs[file] : undefined;
      if (runs === null) {
        results.push(row(id, 'warn', file + ': runs could not be read', 'The Actions runs endpoint did not answer for this workflow.'));
        return;
      }
      if (!runs || !runs.length) {
        results.push(row(id, 'warn', file + ': no runs yet', 'Nothing has triggered it. Open a pull request (or mark one ready for review) and the loop starts itself.'));
        return;
      }
      var latest = runs[0];
      var url = latest.html_url || '';
      var conclusion = latest.conclusion || '';
      var status = latest.status || '';

      if (!conclusion && (status === 'in_progress' || status === 'queued' || status === 'requested' || status === 'waiting' || status === 'pending')) {
        results.push(row(id, 'pass', file + ': a run is ' + status + ' right now', 'Nothing to judge yet — this row will settle when the run finishes.', { url: url }));
        return;
      }
      if (conclusion === 'success') {
        results.push(row(id, 'pass', file + ': latest run succeeded', '', { url: url }));
        return;
      }
      if (conclusion === 'failure') {
        var started = Date.parse(latest.created_at);
        var ended = Date.parse(latest.updated_at);
        var seconds = isNaN(started) || isNaN(ended) ? null : (ended - started) / 1000;
        if (seconds !== null && seconds < 120) {
          results.push(row(
            id,
            'fail',
            file + ': latest run failed in ' + Math.round(seconds) + 's',
            'A review that fails in under two minutes usually means the credential is rejected or over its usage limit — open the run log. You can switch LATCH_PROVIDER or pause the loop from the panel below.',
            { url: url }
          ));
        } else {
          results.push(row(
            id,
            'warn',
            file + ': latest run failed' + (seconds === null ? '' : ' after ' + Math.round(seconds) + 's'),
            'It ran long enough to be real work, so read the log before changing config.',
            { url: url }
          ));
        }
        return;
      }
      results.push(row(id, 'warn', file + ': latest run ended as ' + (conclusion || status || 'unknown'), 'Not a success and not a failure — open the run to see why.', { url: url }));
    });

    return results;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1e. Instructions for the user's own coding agent
  // ───────────────────────────────────────────────────────────────────────────

  function nonDefaultVars(vars, provider) {
    var p = provider ? resolveProvider(provider) : resolveProvider(vars);
    return varNames()
      .filter(function (name) { return !isUnset(read(vars, name)); })
      .filter(function (name) {
        var spec = varSpec(name);
        // LATCH_PROVIDER is always worth stating explicitly; everything else is
        // only worth a line when it differs from what the workflow would do.
        if (name === 'LATCH_PROVIDER') return read(vars, name) !== spec.default;
        return !effectiveValue(name, vars, p).isDefault;
      });
  }

  function agentInstructions(options) {
    var opts = options || {};
    var owner = opts.owner || 'OWNER';
    var repo = opts.repo || 'REPO';
    var slug = owner + '/' + repo;
    var vars = opts.vars || {};
    var provider = resolveProvider(opts.provider || vars);
    var lines = [];

    lines.push('Install the Latch review/fix loop in ' + slug + '. Do every step; do not skip the human ones.');
    lines.push('');
    lines.push('1. Scaffold the loop from the canonical templates:');
    lines.push('   ' + INSTALL_COMMAND);
    lines.push('   That writes .github/workflows/latch-review.yml, .github/workflows/latch-fix.yml');
    lines.push('   and a starter .latch/policy.yml. It is idempotent — safe to re-run.');
    lines.push('');

    if (provider === 'codex') {
      lines.push('2. Add the provider credential (repository secret, not an environment secret):');
      lines.push('   gh secret set ' + CODEX_SECRET + ' --repo ' + slug);
      lines.push('   LATCH_PROVIDER is codex, so ' + CODEX_SECRET + ' is the credential the loop runs on.');
      lines.push('');
      lines.push('3. A codex review posts with the workflow\'s own token, not as claude[bot], so the');
      lines.push('   fixer must be told which identity to look for:');
      lines.push('   gh variable set LATCH_REVIEW_LOGIN --body "github-actions" --repo ' + slug);
      lines.push('   No GitHub App install is needed on this path.');
    } else {
      lines.push('2. Install the Claude GitHub App on ' + slug + ': ' + CLAUDE_APP_URL);
      lines.push('   (or run: claude /install-github-app). This is mechanical, not cosmetic — the');
      lines.push('   review must post as claude[bot] so its review fires the pull_request_review');
      lines.push('   event that wakes the fixer. Post as anything else and the loop never turns.');
      lines.push('');
      lines.push('3. Add exactly ONE Claude credential as a repository secret:');
      lines.push('   gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ' + slug + '   # from: claude setup-token');
      lines.push('   or');
      lines.push('   gh secret set ANTHROPIC_API_KEY --repo ' + slug + '          # metered API key');
      lines.push('   Set one, leave the other unset. Never paste a secret value into a file or a log.');
    }

    lines.push('');
    var tuned = nonDefaultVars(vars, provider);
    if (tuned.length) {
      lines.push('4. Set the non-default tunables (Actions variables — they take effect on the next');
      lines.push('   run, no commit and no redeploy):');
      tuned.forEach(function (name) {
        lines.push('   gh variable set ' + name + ' --body "' + read(vars, name) + '" --repo ' + slug);
      });
    } else {
      lines.push('4. Set no variables. The defaults are the product and a fresh install works with');
      lines.push('   none set — that is the supported path.');
    }

    lines.push('');
    lines.push('5. Commit the scaffolded files on a branch and open a pull request against the');
    lines.push('   default branch:');
    lines.push('   git checkout -b latch/install');
    lines.push('   git add .github/workflows/latch-review.yml .github/workflows/latch-fix.yml .latch/policy.yml');
    lines.push('   git commit -m "add the latch review/fix loop"');
    lines.push('   git push -u origin latch/install');
    lines.push('   gh pr create --repo ' + slug + ' --base <default-branch> --title "add the latch review/fix loop"');
    lines.push('');
    lines.push('6. Merge it. latch-fix.yml only takes effect once it is on the default branch: the');
    lines.push('   pull_request_review trigger is read from the default branch\'s copy, so the fix');
    lines.push('   half cannot fire from its own PR. Expect the install PR itself to get a review');
    lines.push('   but no fix hop.');
    lines.push('');
    lines.push('Latch never merges. The loop converges the PR and stops; a human presses merge.');
    lines.push('Do not weaken the anti-tamper skip (the fixer never edits .github/workflows/ or');
    lines.push('.latch/), the fix-cycle cap, or the never-merges posture.');

    return lines.join('\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1f. The install PR
  // ───────────────────────────────────────────────────────────────────────────

  function templateUrl(source, base) {
    var root = base || TEMPLATE_BASE;
    if (root.charAt(root.length - 1) !== '/') root += '/';
    return root + source;
  }

  function installPlan() {
    return {
      branch: 'latch/install',
      files: [
        { path: '.github/workflows/' + REVIEW_WORKFLOW, source: 'workflows/latch-review.yml' },
        { path: '.github/workflows/' + FIX_WORKFLOW, source: 'workflows/latch-fix.yml' },
        { path: POLICY_PATH, source: 'policy/examples/policy.yml' }
      ],
      prTitle: 'add the latch review/fix loop',
      prBody: [
        '## What this is',
        '',
        'Latch is an independent review/fix loop for pull requests. A reviewer attacks the',
        'diff under an adversarial doctrine; a separate fixer patches the real defects,',
        'refuses the wrong findings with reasons, and re-dispatches the review. The loop is',
        'bounded (a fix-cycle cap, then it escalates to a human) and it **never merges** —',
        'it converges the PR and stops.',
        '',
        'This PR adds three files and changes nothing else:',
        '',
        '- `.github/workflows/latch-review.yml` — the review half',
        '- `.github/workflows/latch-fix.yml` — the fix half',
        '- `.latch/policy.yml` — this repo\'s doctrine, landmines and check commands',
        '',
        '## What a human still has to do',
        '',
        '1. **Install the Claude GitHub App** (<' + CLAUDE_APP_URL + '>). This is mechanical:',
        '   the review must post as `claude[bot]`, because that is the identity whose review',
        '   fires the `pull_request_review` event that wakes the fixer. Post as anything else',
        '   and the fix hop never happens.',
        '2. **Add the provider secret** — exactly one of `CLAUDE_CODE_OAUTH_TOKEN` (from',
        '   `claude setup-token`, drawing on an existing Claude subscription) or',
        '   `ANTHROPIC_API_KEY` (metered). For the codex provider, add `OPENAI_API_KEY`',
        '   instead.',
        '',
        '## Note on the fix half',
        '',
        '`latch-fix.yml` only takes effect **once it is on the default branch** — GitHub reads',
        'the `pull_request_review` trigger from the default branch\'s copy of a workflow. So',
        'this PR can be reviewed by Latch but cannot exercise the fix hop from its own branch.',
        'Merge it, then open a throwaway PR to watch a full loop turn.',
        '',
        '## The guarantees',
        '',
        '- **Latch never merges.** A human always merges.',
        '- The verdict ships as a **non-blocking** commit status. Mark it required yourself,',
        '  later, once you trust its false-positive rate.',
        '- **Anti-tamper:** the fixer skips any PR that touches `.github/workflows/` or',
        '  `.latch/`, so the loop cannot rewrite the rules governing itself.',
        '',
        'Every hop is an ordinary Actions run in this repo, on this repo\'s audit trail, on',
        'this repo\'s credential.'
      ].join('\n')
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1g. owner/repo parsing
  // ───────────────────────────────────────────────────────────────────────────

  var NAME_RE = /^[A-Za-z0-9._-]+$/;

  function parseRepoInput(text) {
    if (typeof text !== 'string') return null;
    var s = text.trim();
    if (!s) return null;
    s = s.replace(/^git\+/, '');

    var owner = null;
    var repo = null;

    var url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(s);
    if (url) {
      owner = url[1];
      repo = url[2];
    } else if (/^[^/\s]+\/[^/\s]+$/.test(s)) {
      var parts = s.split('/');
      owner = parts[0];
      repo = parts[1];
    } else {
      return null;
    }

    repo = repo.replace(/\.git$/i, '');
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
    if (repo === '.' || repo === '..') return null;
    return { owner: owner, repo: repo };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1h. The OAuth device-flow state machine
  // ───────────────────────────────────────────────────────────────────────────

  // 'repo workflow' on a classic-scoped OAuth app:
  //   repo      — Actions variables (read/write), secrets METADATA (names only),
  //               repo contents and pull requests. There is no narrower classic
  //               scope that reaches Actions variables.
  //   workflow  — the one scope that lets a token commit a file under
  //               .github/workflows/, which the install PR must do.
  // Nothing here ever asks for, reads or stores a secret value.
  var DEVICE_SCOPE = 'repo workflow';

  var PLACEHOLDER_RE = /^(your|xxx+|todo|tbd|changeme|placeholder|<)/i;

  function trimmed(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeOAuthConfig(cfg) {
    var c = cfg || {};
    return {
      clientId: trimmed(c.clientId !== undefined ? c.clientId : c.OAUTH_CLIENT_ID),
      proxyUrl: trimmed(c.proxyUrl !== undefined ? c.proxyUrl : c.OAUTH_PROXY_URL).replace(/\/+$/, '')
    };
  }

  function isOAuthConfigured(cfg) {
    var c = normalizeOAuthConfig(cfg);
    if (!c.clientId || !c.proxyUrl) return false;
    if (PLACEHOLDER_RE.test(c.clientId) || PLACEHOLDER_RE.test(c.proxyUrl)) return false;
    if (c.clientId.indexOf(' ') !== -1) return false;
    if (!/^https:\/\//i.test(c.proxyUrl) && !/^http:\/\/localhost(:\d+)?$/i.test(c.proxyUrl)) return false;
    return true;
  }

  function proxyEndpoint(cfg, path) {
    return normalizeOAuthConfig(cfg).proxyUrl + path;
  }

  function postJson(deps, url, body) {
    return deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res) throw new Error('the sign-in relay returned nothing.');
      return Promise.resolve(res.json ? res.json() : null).then(function (data) {
        if (!data || typeof data !== 'object') {
          throw new Error('the sign-in relay answered with something that is not JSON (HTTP ' + (res.status || '?') + ').');
        }
        return data;
      });
    });
  }

  function deviceErrorMessage(data) {
    var code = data.error || '';
    if (code === 'expired_token') return 'the code expired, start again.';
    if (code === 'access_denied') return 'you cancelled the sign-in.';
    if (code === 'incorrect_client_credentials') return 'incorrect_client_credentials: this deployment\'s OAuth client id is wrong. ' + (data.error_description || '');
    return (data.error_description || code || 'the sign-in failed for an unknown reason.');
  }

  function requestDeviceCode(deps, cfg) {
    var c = normalizeOAuthConfig(cfg);
    return postJson(deps, proxyEndpoint(c, '/login/device/code'), {
      client_id: c.clientId,
      scope: DEVICE_SCOPE
    }).then(function (data) {
      if (data.error) throw new Error(deviceErrorMessage(data));
      if (!data.device_code || !data.user_code) {
        throw new Error('the sign-in relay did not return a device code.');
      }
      return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri || 'https://github.com/login/device',
        interval: Number(data.interval) > 0 ? Number(data.interval) : 5,
        expires_in: Number(data.expires_in) > 0 ? Number(data.expires_in) : 900
      };
    });
  }

  function pollForToken(deps, cfg, deviceCode, interval, options) {
    var c = normalizeOAuthConfig(cfg);
    var wait = Number(interval) > 0 ? Number(interval) : 5;
    var opts = options || {};
    var limit = Number(opts.maxAttempts) > 0 ? Number(opts.maxAttempts) : 200;
    var attempts = 0;

    function attempt() {
      attempts += 1;
      if (attempts > limit) throw new Error('the sign-in timed out, start again.');
      return deps.sleep(wait * 1000)
        .then(function () {
          if (opts.isCancelled && opts.isCancelled()) throw new Error('the sign-in was cancelled.');
          return postJson(deps, proxyEndpoint(c, '/login/oauth/access_token'), {
            client_id: c.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          });
        })
        .then(function (data) {
          if (data.access_token) {
            return {
              token: data.access_token,
              scopes: String(data.scope || '').split(/[\s,]+/).filter(function (s) { return s !== ''; })
            };
          }
          var code = data.error || '';
          if (code === 'authorization_pending') return attempt();
          if (code === 'slow_down') {
            // GitHub asks for a longer gap; back off by 5s (and honour a larger
            // interval if it sent one) and keep polling.
            wait = Math.max(wait + 5, Number(data.interval) > 0 ? Number(data.interval) : 0);
            return attempt();
          }
          throw new Error(deviceErrorMessage(data));
        });
    }

    return Promise.resolve().then(attempt);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1i. Storage, namespaced per authenticated login
  // ───────────────────────────────────────────────────────────────────────────

  var STORAGE_PREFIX = 'latch-console:';
  // The token is shared across logins by construction: only one account is
  // signed in at a time, so signing out must clear it whichever login owned it.
  var TOKEN_KEY = STORAGE_PREFIX + 'token';

  function storageKey(login, key) {
    var who = trimmed(login) || 'pat';
    return STORAGE_PREFIX + who + ':' + key;
  }

  function makeStore(storageImpl, login) {
    var store = storageImpl || null;
    var prefix = storageKey(login, '');

    function get(key) {
      try {
        return store ? store.getItem(storageKey(login, key)) : null;
      } catch (error) {
        return null;
      }
    }

    function set(key, value) {
      try {
        if (!store) return false;
        store.setItem(storageKey(login, key), String(value));
        return true;
      } catch (error) {
        return false;
      }
    }

    function remove(key) {
      try {
        if (!store) return false;
        store.removeItem(storageKey(login, key));
        return true;
      } catch (error) {
        return false;
      }
    }

    // Only THIS login's keys, plus the shared token key. Two accounts in one
    // browser must never be able to wipe each other's config.
    function clearAll() {
      try {
        if (!store) return false;
        var doomed = [TOKEN_KEY];
        var length = typeof store.length === 'number' ? store.length : 0;
        for (var i = 0; i < length; i++) {
          var key = store.key ? store.key(i) : null;
          if (typeof key === 'string' && key.indexOf(prefix) === 0) doomed.push(key);
        }
        for (var j = 0; j < doomed.length; j++) store.removeItem(doomed[j]);
        return true;
      } catch (error) {
        return false;
      }
    }

    return { get: get, set: set, remove: remove, clearAll: clearAll };
  }

  // ───────────────────────────────────────────────────────────────────────────

  return {
    // schema
    VARS: VARS,
    VAR_GROUPS: VAR_GROUPS,
    PROVIDERS: PROVIDERS,
    PROVIDER_DEFAULTS: PROVIDER_DEFAULTS,
    MODEL_OPTIONS: MODEL_OPTIONS,
    EFFORT_OPTIONS: EFFORT_OPTIONS,
    WORKFLOW_FILES: WORKFLOW_FILES,
    WORKFLOW_PATHS: WORKFLOW_PATHS,
    POLICY_PATH: POLICY_PATH,
    CLAUDE_SECRETS: CLAUDE_SECRETS,
    CODEX_SECRET: CODEX_SECRET,
    TEMPLATE_BASE: TEMPLATE_BASE,
    INSTALL_COMMAND: INSTALL_COMMAND,
    CLAUDE_APP_URL: CLAUDE_APP_URL,
    READINESS_IDS: READINESS_IDS,
    varSpec: varSpec,
    varNames: varNames,
    varsInGroup: varsInGroup,
    // rules
    isUnset: isUnset,
    validateVar: validateVar,
    resolveProvider: resolveProvider,
    providerDefaults: providerDefaults,
    effectiveValue: effectiveValue,
    evaluateReadiness: evaluateReadiness,
    agentInstructions: agentInstructions,
    nonDefaultVars: nonDefaultVars,
    installPlan: installPlan,
    templateUrl: templateUrl,
    parseRepoInput: parseRepoInput,
    // device flow
    DEVICE_SCOPE: DEVICE_SCOPE,
    normalizeOAuthConfig: normalizeOAuthConfig,
    isOAuthConfigured: isOAuthConfigured,
    requestDeviceCode: requestDeviceCode,
    pollForToken: pollForToken,
    // storage
    STORAGE_PREFIX: STORAGE_PREFIX,
    TOKEN_KEY: TOKEN_KEY,
    storageKey: storageKey,
    makeStore: makeStore
  };
});

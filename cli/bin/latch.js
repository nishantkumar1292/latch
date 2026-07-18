#!/usr/bin/env node
'use strict';

// Latch CLI — installs and manages the independent review⇄fix merge gate in a
// GitHub repo. Zero runtime dependencies; Node >= 18.
//
// Commands:
//   latch init [--auth oauth|api-key] [--force]   install the workflows + policy
//   latch doctor                                  check the install
//   latch uninstall [--remove-policy|--keep-policy] [--yes]
//   latch help | --help | -h
//   latch version | --version | -v

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const readline = require('readline');

// ── package layout ──────────────────────────────────────────────────────────
// bin lives at <pkg>/cli/bin/latch.js, so the package root is two levels up.
// This resolves correctly under `npm install` (node_modules/latch-gate/...) and
// under `npx github:nishantkumar1292/latch` (a clone of the repo).
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_WORKFLOWS = {
  'latch-review.yml': path.join(PKG_ROOT, 'workflows', 'latch-review.yml'),
  'latch-fix.yml': path.join(PKG_ROOT, 'workflows', 'latch-fix.yml'),
};
const APP_INSTALL_URL = 'https://github.com/apps/claude';

// ── tiny ANSI (only when attached to a TTY) ────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const PASS = c.green('✔');
const FAIL = c.red('✘');
const WARN = c.yellow('⚠');

function die(msg) {
  process.stderr.write(c.red('error: ') + msg + '\n');
  process.exit(1);
}

// ── small utilities ─────────────────────────────────────────────────────────
function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function templateVersion(text) {
  const m = /#\s*latch:template-version=(\S+)/.exec(text);
  return m ? m[1] : null;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function tryGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function tryGh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(cwd) {
  return tryGit(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

function githubRemote(cwd) {
  const out = tryGit(['remote', '-v'], cwd);
  if (!out) return null;
  for (const line of out.split(/\r?\n/)) {
    if (line.includes('github.com')) {
      const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/.exec(line);
      if (m) return { owner: m[1], repo: m[2] };
      return { owner: null, repo: null };
    }
  }
  return null;
}

// ── YAML emission (tiny; we write our own so there is no dependency) ─────────
// Single-quoted YAML scalars are literal (no escape processing) except that a
// single quote is doubled. Our mined strings are collapsed to one line, so this
// safely carries colons, '#', '&&', etc.
function yq(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
// Double-quoted key: JSON string form is valid YAML and safely quotes globs.
function yk(s) {
  return JSON.stringify(String(s));
}
function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// ── policy mining ────────────────────────────────────────────────────────────
const MINE_CAP = 6;
// A line that is *only* a Claude-Code-style import, e.g. `@AGENTS.md`. This is the
// increasingly common pattern where CLAUDE.md is a 2-line stub that imports the
// real memory file — we follow it one level so those bullets are not lost.
const IMPORT_RE = /^@([A-Za-z0-9._/-]+\.md)\s*$/m;

// Pull meaningful bullet points out of one markdown blob, appending to `items`
// (deduped, bounded by MINE_CAP). Skips fenced code blocks.
function mineBullets(content, items) {
  let inFence = false;
  for (const raw of content.split(/\r?\n/)) {
    if (items.length >= MINE_CAP) break;
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^[-*]\s+(.*)$/.exec(line);
    if (!m) continue;
    // strip light markdown but PRESERVE identifiers: turn links into their text,
    // unwrap inline code and paired emphasis, but never blanket-delete '_' (it is
    // part of snake_case names like include_str!).
    let text = m[1]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
      .replace(/`([^`]+)`/g, '$1') // `code` -> code (keeps the underscores)
      .replace(/`/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** -> bold
      .replace(/\*([^*]+)\*/g, '$1') // *italic* -> italic
      .replace(/\b__([^_]+)__\b/g, '$1') // __bold__ -> bold
      .trim();
    text = oneLine(text);
    if (text.length >= 25 && text.length <= 400 && !items.includes(text)) items.push(text);
  }
}

// Landmines: pull the first meaningful bullet points out of CLAUDE.md/AGENTS.md.
// Tries every candidate in turn (not just the first that exists) and follows a
// single one-level import (CLAUDE.md's `@AGENTS.md`), so the common stub pattern
// still yields landmines. Returns the first source that actually has items; if a
// file was found but nothing was mineable, reports that distinctly from "no file".
function mineLandmines(root) {
  const candidates = ['CLAUDE.md', 'AGENTS.md', '.github/CLAUDE.md', '.github/AGENTS.md'];
  const found = []; // files that existed (candidate or followed import) but were dry so far

  for (const rel of candidates) {
    const content = readFileSafe(path.join(root, rel));
    if (content === null) continue; // not present — try the next candidate
    if (!found.includes(rel)) found.push(rel);

    const items = [];
    mineBullets(content, items);
    let source = rel;

    // Follow one-level import (e.g. CLAUDE.md → AGENTS.md) if we still have room.
    if (items.length < MINE_CAP) {
      const im = IMPORT_RE.exec(content);
      if (im) {
        const importedRel = im[1];
        const importedTxt = readFileSafe(path.join(root, importedRel));
        if (importedTxt !== null) {
          if (!found.includes(importedRel)) found.push(importedRel);
          const before = items.length;
          mineBullets(importedTxt, items);
          if (items.length > before) source = `${rel} → ${importedRel}`;
        }
      }
    }

    if (items.length) return { source, items, found };
    // file existed but had nothing mineable — keep going; another candidate might.
  }

  // Nothing mineable anywhere. `found` distinguishes "found but dry" from "no file".
  return { source: null, items: [], found };
}

// Checks: infer per-language commands from manifests at the root and one level
// deep (monorepos put manifests in subdirs).
function inferChecks(root) {
  const checks = []; // [glob, command]
  const seen = new Set();
  const add = (glob, cmd) => {
    if (seen.has(glob)) return;
    seen.add(glob);
    checks.push([glob, cmd]);
  };

  // Walk the tree (bounded depth, skipping vendored/build dirs) so we find
  // manifests in monorepo subdirs like services/api/Cargo.toml or
  // apps/web/package.json, not just at the root.
  const ignore = new Set(['node_modules', 'target', 'dist', 'build', 'vendor', '.git']);
  const scanDirs = ['.'];
  const walk = (rel, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || ignore.has(e.name)) continue;
      const childRel = rel === '.' ? e.name : `${rel}/${e.name}`;
      scanDirs.push(childRel);
      walk(childRel, depth + 1);
    }
  };
  walk('.', 1);

  const glob = (dir, pat) => (dir === '.' ? pat : `${dir}/${pat}`);
  const cd = (dir) => (dir === '.' ? '' : `cd ${dir} && `);

  for (const dir of scanDirs) {
    const abs = (name) => path.join(root, dir === '.' ? '' : dir, name);

    if (fs.existsSync(abs('Cargo.toml'))) {
      add(glob(dir, '**/*.rs'), `${cd(dir)}cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test`);
    }

    const pkgPath = abs('package.json');
    if (fs.existsSync(pkgPath)) {
      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch {
        pkg = {};
      }
      const scripts = pkg.scripts || {};
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      const parts = ['npm ci'];
      for (const s of ['lint', 'typecheck', 'test', 'build']) {
        if (scripts[s]) parts.push(`npm run ${s}`);
      }
      if (!scripts.typecheck && deps.typescript) parts.push('npx tsc --noEmit');
      if (parts.length > 1) {
        add(glob(dir, '**/*.{js,jsx,ts,tsx,mjs,cjs}'), `${cd(dir)}${parts.join(' && ')}`);
      }
    }

    const pyPath = abs('pyproject.toml');
    if (fs.existsSync(pyPath)) {
      const py = readFileSafe(pyPath) || '';
      const parts = [];
      if (/ruff/.test(py)) parts.push('ruff check .');
      parts.push('pytest -q');
      add(glob(dir, '**/*.py'), `${cd(dir)}${parts.join(' && ')}`);
    }

    if (fs.existsSync(abs('go.mod'))) {
      add(glob(dir, '**/*.go'), `${cd(dir)}go vet ./... && go test ./...`);
    }
  }

  // Makefile fallback: only if no language checks were found.
  if (checks.length === 0) {
    const mk = readFileSafe(path.join(root, 'Makefile'));
    if (mk) {
      if (/^check:/m.test(mk)) add('**', 'make check');
      else if (/^test:/m.test(mk)) add('**', 'make test');
    }
  }

  return checks;
}

function buildPolicyYaml(root) {
  const { source, items, found } = mineLandmines(root);
  const checks = inferChecks(root);
  const L = [];

  L.push('# .latch/policy.yml — Latch review policy for this repo.');
  L.push('# Generated by `latch init`. Edit freely: this is your doctrine made');
  L.push('# configurable. Latch reads it before every review (and the fixer reads');
  L.push('# `checks:`). See policy/examples/policy.yml in the Latch repo for the');
  L.push('# fully documented reference, and doctrines/README.md for landmine packs.');
  L.push('version: 1');
  L.push('');

  L.push('# Extra review rules appended to Latch\'s generic doctrine. Optional.');
  L.push('doctrine:');
  L.push('  - ' + yq('Treat every claim in the PR description as something to falsify, not to accept.'));
  L.push('  - ' + yq('Every new field, endpoint, event, or config key needs both a producer and a consumer.'));
  L.push('');

  if (items.length) {
    L.push(`# Landmines auto-mined from ${source}. These are starting points — sharpen`);
    L.push('# each `hunt` into something a reviewer can act on with only the diff.');
  } else if (found && found.length) {
    L.push(`# Found ${found.join(', ')} but nothing mineable — add this repo's known traps`);
    L.push('# here, or adopt a community pack from the Latch doctrines/ library.');
  } else {
    L.push('# No CLAUDE.md/AGENTS.md found to mine. Add this repo\'s known traps here,');
    L.push('# or adopt a community pack from the Latch doctrines/ library.');
  }
  L.push('landmines:');
  if (items.length) {
    items.forEach((text, i) => {
      L.push(`  - id: ${'mined-' + (i + 1)}`);
      L.push('    summary: ' + yq(text));
      L.push('    hunt: ' + yq('Verify this PR does not violate the rule above; treat it as a claim to falsify.'));
      L.push('    severity: warn');
    });
  } else {
    // keep the key valid YAML with an empty list
    L[L.length - 1] = 'landmines: []';
  }
  L.push('');

  if (checks.length) {
    L.push('# Checks inferred from this repo\'s manifests. The review runs the ones');
    L.push('# matching a PR\'s changed paths; the fixer runs them after a change and');
    L.push('# keeps a fix only if they pass. A missing toolchain is reported, never faked.');
  } else {
    L.push('# No manifests detected to infer checks. Add "<glob>": "<command>" entries.');
  }
  L.push('checks:');
  if (checks.length) {
    for (const [glob, cmd] of checks) {
      L.push(`  ${yk(glob)}: ${yq(cmd)}`);
    }
  } else {
    L[L.length - 1] = 'checks: {}';
  }
  L.push('');

  L.push('# Latch never merges. This records intent for humans reading the policy;');
  L.push('# the latch/merge-gate status is non-blocking until you mark it required.');
  L.push('merge_posture: converge-only');
  L.push('');

  return L.join('\n');
}

// ── argument parsing ─────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--auth') {
      flags.auth = argv[++i];
    } else if (a === '--force' || a === '-f') {
      flags.force = true;
    } else if (a === '--remove-policy' || a === '--purge') {
      flags.removePolicy = true;
    } else if (a === '--keep-policy') {
      flags.keepPolicy = true;
    } else if (a === '--yes' || a === '-y') {
      flags.yes = true;
    } else if (a === '--help' || a === '-h') {
      flags.help = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// ── writing helpers ──────────────────────────────────────────────────────────
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Returns 'created' | 'unchanged' | 'updated' | 'skipped'
function writeFileGuarded(dest, content, force) {
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest, 'utf8');
    if (existing === content) return 'unchanged';
    if (!force) return 'skipped';
    fs.writeFileSync(dest, content);
    return 'updated';
  }
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, content);
  return 'created';
}

// ── commands ─────────────────────────────────────────────────────────────────
function cmdInit(flags) {
  const cwd = process.cwd();
  const auth = flags.auth || 'oauth';
  if (auth !== 'oauth' && auth !== 'api-key') {
    die("--auth must be 'oauth' or 'api-key'");
  }

  if (!isGitRepo(cwd)) {
    die('not a git repository. Run `git init` and add a GitHub remote first.');
  }
  const remote = githubRemote(cwd);
  if (!remote) {
    if (!flags.force) {
      die(
        'no GitHub remote found. Add one, e.g.\n' +
          '  git remote add origin https://github.com/<owner>/<repo>.git\n' +
          'or re-run with --force to install the files anyway.'
      );
    }
    process.stdout.write(WARN + ' no GitHub remote — installing anyway (--force).\n');
  }

  process.stdout.write(c.bold('Latch — installing the merge gate\n\n'));

  // 1) workflows
  const results = [];
  for (const [name, src] of Object.entries(TEMPLATE_WORKFLOWS)) {
    const content = fs.readFileSync(src, 'utf8');
    const dest = path.join(cwd, '.github', 'workflows', name);
    const outcome = writeFileGuarded(dest, content, flags.force);
    results.push({ name: `.github/workflows/${name}`, outcome });
  }

  // 2) policy (mined) — never clobber a human-edited policy without --force
  const policyDest = path.join(cwd, '.latch', 'policy.yml');
  let policyOutcome;
  if (fs.existsSync(policyDest) && !flags.force) {
    policyOutcome = 'kept';
  } else {
    const policy = buildPolicyYaml(cwd);
    ensureDir(path.dirname(policyDest));
    fs.writeFileSync(policyDest, policy);
    policyOutcome = fs.existsSync(policyDest) ? 'created' : 'created';
  }
  results.push({ name: '.latch/policy.yml', outcome: policyOutcome });

  // report
  let anySkipped = false;
  for (const r of results) {
    let mark = PASS;
    let note = r.outcome;
    if (r.outcome === 'skipped') {
      mark = FAIL;
      note = 'exists and differs — re-run with --force to overwrite';
      anySkipped = true;
    } else if (r.outcome === 'unchanged' || r.outcome === 'kept') {
      mark = PASS;
      note = r.outcome === 'kept' ? 'kept existing (use --force to regenerate)' : 'already up to date';
    }
    process.stdout.write(`  ${mark} ${r.name} ${c.dim('(' + note + ')')}\n`);
  }

  if (anySkipped) {
    process.stdout.write('\n' + WARN + ' some files already exist and differ; nothing was overwritten.\n');
    process.stdout.write('  Re-run with ' + c.bold('--force') + ' to replace them.\n');
    // Refuse to complete: the install is incomplete and a human should decide.
    process.exit(1);
  }

  const secretName = auth === 'api-key' ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN';

  process.stdout.write('\n' + c.bold('NEXT STEPS') + ' (a human must do these — Latch never handles your token):\n\n');

  process.stdout.write(c.bold('  1. Install the Claude GitHub App') + ' (required — the review must post as claude[bot]\n');
  process.stdout.write('     or the fix hop never triggers):\n');
  process.stdout.write('       ' + c.cyan(APP_INSTALL_URL) + '\n');
  process.stdout.write('     ' + c.dim('or:') + '  claude /install-github-app\n\n');

  if (auth === 'api-key') {
    process.stdout.write(c.bold('  2. Set your Anthropic API key as a repo secret') + ':\n');
    process.stdout.write('       ' + c.cyan('gh secret set ANTHROPIC_API_KEY --app actions') + '\n');
    process.stdout.write('     ' + c.dim('(paste your key from https://console.anthropic.com when prompted)') + '\n\n');
  } else {
    process.stdout.write(c.bold('  2. Generate a Claude subscription token and set it as a repo secret') + ':\n');
    process.stdout.write('       ' + c.cyan('claude setup-token') + '\n');
    process.stdout.write('       ' + c.cyan('gh secret set CLAUDE_CODE_OAUTH_TOKEN --app actions') + '\n');
    process.stdout.write('     ' + c.dim('(paste the token from `claude setup-token` when prompted)') + '\n\n');
  }
  process.stdout.write('     ' + c.dim(`Latch prints these commands but never reads or stores the ${secretName} value.`) + '\n\n');

  process.stdout.write(c.bold('  3. Commit the files') + ':\n');
  process.stdout.write('       ' + c.cyan('git add .github/workflows/latch-review.yml .github/workflows/latch-fix.yml .latch/policy.yml') + '\n');
  process.stdout.write('       ' + c.cyan('git commit -m "add latch merge gate"') + '\n\n');

  process.stdout.write(c.bold('  4. Open a PR and watch the loop') + ':\n');
  process.stdout.write('     Latch reviews it, the fixer converges it, and it stops — a human merges.\n');
  process.stdout.write('     Note: latch-fix.yml only takes effect once it is on your DEFAULT branch\n');
  process.stdout.write('     (GitHub runs pull_request_review workflows from the default branch).\n\n');

  process.stdout.write('Run ' + c.cyan('latch doctor') + ' any time to check the install.\n');
}

function checkMark(state) {
  return state === 'pass' ? PASS : state === 'warn' ? WARN : FAIL;
}

function cmdDoctor() {
  const cwd = process.cwd();
  const rows = [];
  let failures = 0;

  // 1) git repo
  const gitOk = isGitRepo(cwd);
  rows.push({
    state: gitOk ? 'pass' : 'fail',
    label: 'in a git repository',
    fix: gitOk ? null : 'run `git init` and add a GitHub remote',
  });
  if (!gitOk) failures++;

  const remote = gitOk ? githubRemote(cwd) : null;
  rows.push({
    state: remote ? 'pass' : 'warn',
    label: remote ? `GitHub remote (${remote.owner || '?'}/${remote.repo || '?'})` : 'GitHub remote configured',
    fix: remote ? null : 'add one: git remote add origin https://github.com/<owner>/<repo>.git',
  });

  // 2) workflows present + version match
  const wantVersion = pkgVersion();
  for (const [name, src] of Object.entries(TEMPLATE_WORKFLOWS)) {
    const dest = path.join(cwd, '.github', 'workflows', name);
    const installed = readFileSafe(dest);
    if (!installed) {
      rows.push({ state: 'fail', label: `.github/workflows/${name} present`, fix: 'run `latch init`' });
      failures++;
      continue;
    }
    const tmplVer = templateVersion(fs.readFileSync(src, 'utf8')) || wantVersion;
    const gotVer = templateVersion(installed);
    if (gotVer === tmplVer) {
      rows.push({ state: 'pass', label: `.github/workflows/${name} (template ${gotVer})`, fix: null });
    } else {
      rows.push({
        state: 'warn',
        label: `.github/workflows/${name} template ${gotVer || 'unknown'} (latest ${tmplVer})`,
        fix: 'run `latch init --force` to update',
      });
    }
  }

  // 3) policy parses (naive)
  const policyPath = path.join(cwd, '.latch', 'policy.yml');
  const policyText = readFileSafe(policyPath);
  if (!policyText) {
    rows.push({ state: 'fail', label: '.latch/policy.yml present', fix: 'run `latch init`' });
    failures++;
  } else {
    const problems = naiveYamlProblems(policyText);
    if (problems.length === 0) {
      rows.push({ state: 'pass', label: '.latch/policy.yml parses (naive check)', fix: null });
    } else {
      rows.push({ state: 'fail', label: `.latch/policy.yml: ${problems[0]}`, fix: 'fix the YAML by hand' });
      failures++;
    }
  }

  // 4) secret set (best-effort via gh)
  const ghVersion = tryGh(['--version']);
  if (!ghVersion) {
    rows.push({
      state: 'warn',
      label: 'auth secret set (cannot verify — gh not installed)',
      fix: 'install gh, or ensure CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY is set as a repo secret',
    });
  } else {
    const list = tryGh(['secret', 'list']);
    if (list === null) {
      rows.push({
        state: 'warn',
        label: 'auth secret set (cannot verify — gh not authenticated)',
        fix: 'run `gh auth login`, then check for CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY',
      });
    } else if (/\bCLAUDE_CODE_OAUTH_TOKEN\b/.test(list) || /\bANTHROPIC_API_KEY\b/.test(list)) {
      const which = /\bCLAUDE_CODE_OAUTH_TOKEN\b/.test(list) ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
      rows.push({ state: 'pass', label: `auth secret set (${which})`, fix: null });
    } else {
      rows.push({
        state: 'fail',
        label: 'auth secret set',
        fix: 'gh secret set CLAUDE_CODE_OAUTH_TOKEN --app actions   (or ANTHROPIC_API_KEY)',
      });
      failures++;
    }
  }

  // 5) Claude GitHub App reminder (cannot verify from here)
  rows.push({
    state: 'warn',
    label: 'Claude GitHub App installed (cannot verify — required for claude[bot])',
    fix: `${APP_INSTALL_URL}  (or: claude /install-github-app)`,
  });

  process.stdout.write(c.bold('Latch doctor\n\n'));
  for (const r of rows) {
    process.stdout.write(`  ${checkMark(r.state)} ${r.label}\n`);
    if (r.fix && r.state !== 'pass') {
      process.stdout.write('      ' + c.dim('→ ' + r.fix) + '\n');
    }
  }
  process.stdout.write('\n');
  if (failures > 0) {
    process.stdout.write(FAIL + ` ${failures} check(s) failed. See remediation above.\n`);
    process.exit(1);
  }
  process.stdout.write(PASS + ' Latch looks installed. Warnings above are things Latch cannot verify locally.\n');
}

// Naive line-based YAML validation. NOT a real parser (a full parse happens on
// the runner) — it catches the mistakes a hand-edited policy actually makes: a
// hard TAB in indentation (YAML forbids tabs) and a file with no top-level keys
// at all. It deliberately does not try to validate value syntax, so it never
// false-positives on a legitimate glob key like "**/*.{js,ts}". Returns an
// array of problem strings.
function naiveYamlProblems(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  let sawKey = false;
  lines.forEach((line, idx) => {
    const code = line.replace(/#.*$/, '');
    if (/\t/.test(code)) {
      problems.push(`tab indentation on line ${idx + 1} (YAML forbids tabs)`);
    }
    // a top-level key sits at column 0: `word:` or `"quoted":`
    if (/^(?:[\w.-]+|"[^"]+"|'[^']+'):/.test(line)) sawKey = true;
  });
  if (!sawKey) problems.push('no top-level keys found');
  return problems;
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + ' [y/N] ', (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

async function cmdUninstall(flags) {
  const cwd = process.cwd();
  process.stdout.write(c.bold('Latch — uninstalling\n\n'));

  let removed = 0;
  for (const name of Object.keys(TEMPLATE_WORKFLOWS)) {
    const dest = path.join(cwd, '.github', 'workflows', name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest);
      process.stdout.write(`  ${PASS} removed .github/workflows/${name}\n`);
      removed++;
    } else {
      process.stdout.write(`  ${c.dim('·')} .github/workflows/${name} not present\n`);
    }
  }

  const policyDir = path.join(cwd, '.latch');
  if (fs.existsSync(policyDir)) {
    let doRemove;
    if (flags.removePolicy) doRemove = true;
    else if (flags.keepPolicy) doRemove = false;
    else if (flags.yes) doRemove = false; // --yes alone keeps policy (the safe default)
    else doRemove = await promptYesNo('Also remove your .latch/ policy directory?');

    if (doRemove) {
      fs.rmSync(policyDir, { recursive: true, force: true });
      process.stdout.write(`  ${PASS} removed .latch/\n`);
      removed++;
    } else {
      process.stdout.write(`  ${c.dim('·')} kept .latch/ (your policy). Remove with --remove-policy.\n`);
    }
  }

  process.stdout.write('\n');
  process.stdout.write(
    removed > 0
      ? 'Latch removed. Remember to also delete the repo secret and, if set, the required check.\n'
      : 'Nothing to remove.\n'
  );
}

function usage() {
  return `${c.bold('latch')} — the independent merge gate for the agent era

${c.bold('Usage')}
  latch init [--auth oauth|api-key] [--force]   install the review⇄fix workflows + .latch/policy.yml
  latch doctor                                  check the install and print remediation
  latch uninstall [--remove-policy|--keep-policy] [--yes]
  latch help                                    show this help
  latch version                                 print the version

${c.bold('init')}
  Verifies you are in a git repo with a GitHub remote, copies the two workflow
  templates into .github/workflows/, and seeds .latch/policy.yml by mining your
  repo (landmines from CLAUDE.md/AGENTS.md; checks from your manifests). It will
  not overwrite existing files without --force, and it never touches your token —
  it prints the commands for a human to run.

${c.dim('Docs: https://github.com/nishantkumar1292/latch')}
`;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseFlags(argv);
  const command = positional[0];

  if (!command || command === 'help' || flags.help) {
    if (command && command !== 'help' && !flags.help) {
      // unknown handled below
    } else {
      process.stdout.write(usage());
      return;
    }
  }

  switch (command) {
    case 'init':
      cmdInit(flags);
      break;
    case 'doctor':
      cmdDoctor();
      break;
    case 'uninstall':
      await cmdUninstall(flags);
      break;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(pkgVersion() + '\n');
      break;
    default:
      process.stderr.write(`unknown command: ${command}\n\n`);
      process.stdout.write(usage());
      process.exit(1);
  }
}

main().catch((err) => {
  die(err && err.stack ? err.stack : String(err));
});

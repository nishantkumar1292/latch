'use strict';

// Shared test helpers. This file is intentionally NOT named *.test.js so the
// node test runner does not execute it as a test file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'latch.js');

// Create a throwaway git repo fixture with a GitHub remote. `files` is a map of
// relative path -> contents to seed before running the CLI.
function makeRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latch-fixture-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// Run the CLI in `cwd`. Returns { status, stdout, stderr }. NO_COLOR keeps
// assertions free of ANSI escapes.
function runLatch(args, cwd, input) {
  const res = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    input: input || '',
    env: Object.assign({}, process.env, { NO_COLOR: '1' }),
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

module.exports = { CLI, makeRepo, cleanup, runLatch, read, exists };

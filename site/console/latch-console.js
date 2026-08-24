'use strict';

/*
 * latch-console.js — DOM wiring and the GitHub API calls.
 *
 * All the rules live in latch-console-core.js (and are unit-tested there). This
 * file only moves values between the page and api.github.com. There is no Latch
 * backend: the token is held in this browser, every request goes straight to
 * GitHub, and the sole hosted artifact is a stateless CORS relay for GitHub's
 * own device-flow endpoints (hosted/oauth-proxy/), which never sees repo data.
 *
 * The GitHub secrets API is used for NAMES ONLY. This file never requests,
 * renders, logs or stores a secret value.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Deployment configuration. Both OAuth fields are blank in the repo: until an
// owner registers the OAuth App and deploys the relay (see
// hosted/oauth-proxy/DEPLOY.md), device-flow sign-in renders disabled and the
// fine-grained-token path is the only way in. That is honest, not broken.
// ─────────────────────────────────────────────────────────────────────────────
var CONSOLE_CONFIG = {
  OAUTH_CLIENT_ID: '',             // set after registering the GitHub OAuth App (device flow enabled)
  OAUTH_PROXY_URL: '',             // set after deploying hosted/oauth-proxy/worker.js
  TEMPLATE_BASE: 'https://raw.githubusercontent.com/nishantkumar1292/latch/master/'
};

(function () {
  var core = window.LatchConsoleCore;
  var GH = 'https://api.github.com';
  var GITHUB_URL = 'https://github.com/nishantkumar1292/latch';

  // ── tiny DOM helpers ──────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined && textContent !== null) node.textContent = String(textContent);
    return node;
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function setStatus(node, message, tone) {
    if (!node) return;
    node.textContent = message || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  function setPill(node, label, tone) {
    if (!node) return;
    node.textContent = label;
    node.setAttribute('data-tone', tone || '');
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function copyText(value, done) {
    var finish = function (ok) { if (done) done(ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { finish(true); }, function () { fallbackCopy(value, finish); });
    } else {
      fallbackCopy(value, finish);
    }
  }

  function fallbackCopy(value, finish) {
    var area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    area.remove();
    finish(ok);
  }

  function flashCopyButton(button, ok) {
    var original = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', original);
    button.textContent = ok ? 'Copied' : 'Press ⌘C';
    button.classList.add('copied');
    setTimeout(function () {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1600);
  }

  function toBase64(text) {
    // btoa() only speaks latin1 and the templates are full of em dashes and box
    // drawing, so encode to UTF-8 bytes first.
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // ── page state ────────────────────────────────────────────────────────────
  var state = {
    token: '',
    login: '',
    store: core.makeStore(null, ''),
    owner: '',
    repo: '',
    defaultBranch: '',
    vars: {},
    varsLoaded: false,
    drafts: {},
    draftProvider: '',
    device: { running: false, cancelled: false }
  };

  var deps = {
    fetch: function (url, init) { return window.fetch(url, init); },
    sleep: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  };

  function oauthConfig() {
    return { clientId: CONSOLE_CONFIG.OAUTH_CLIENT_ID, proxyUrl: CONSOLE_CONFIG.OAUTH_PROXY_URL };
  }

  function localStore() {
    try { return window.localStorage; } catch (error) { return null; }
  }

  function slug() {
    return state.owner + '/' + state.repo;
  }

  function hasRepo() {
    return !!(state.owner && state.repo);
  }

  function currentProvider() {
    if (state.draftProvider) return state.draftProvider;
    return core.resolveProvider(state.vars);
  }

  // ── the one GitHub call site ───────────────────────────────────────────────
  // Never rejects on an HTTP error: every caller needs the status to say
  // something honest about what could not be read.
  function gh(path, options) {
    var opts = options || {};
    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    return deps.fetch(GH + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      var asJson = res.status === 204
        ? Promise.resolve(null)
        : res.json().catch(function () { return null; });
      return asJson.then(function (data) {
        return { ok: res.ok, status: res.status, data: data, error: res.ok ? '' : messageFor(res.status, data) };
      });
    }).catch(function (error) {
      // A network failure, a CORS refusal, an offline browser.
      return { ok: false, status: 0, data: null, error: 'the request did not reach GitHub (' + (error && error.message ? error.message : 'network error') + ')' };
    });
  }

  function messageFor(status, data) {
    var detail = data && data.message ? data.message : 'HTTP ' + status;
    if (status === 401) return 'GitHub rejected the token (401): ' + detail;
    if (status === 403) return 'GitHub refused this call (403): ' + detail + ' — usually a missing token permission.';
    if (status === 404) return 'not found (404): ' + detail;
    if (status === 422) return 'GitHub could not process it (422): ' + detail;
    return detail;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Chrome: theme, links, copy buttons
  // ═══════════════════════════════════════════════════════════════════════════
  var doc = document.documentElement;

  Array.prototype.forEach.call(document.querySelectorAll('[data-gh]'), function (link) { link.href = GITHUB_URL; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-license]'), function (link) {
    link.href = GITHUB_URL + '/blob/master/LICENSE.md';
  });
  $('year').textContent = String(new Date().getFullYear());

  try {
    var savedTheme = localStorage.getItem('latch-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') doc.dataset.theme = savedTheme;
  } catch (error) { /* private window: fall through to the media query */ }

  $('themeButton').addEventListener('click', function () {
    var explicit = doc.dataset.theme;
    var dark = explicit ? explicit === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    doc.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('latch-theme', doc.dataset.theme); } catch (error) {}
  });

  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-copy-target]') : null;
    if (!button) return;
    var target = $(button.getAttribute('data-copy-target'));
    if (!target) return;
    copyText(target.textContent, function (ok) { flashCopyButton(button, ok); });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Connect
  // ═══════════════════════════════════════════════════════════════════════════
  var deviceButton = $('deviceButton');
  var deviceCancel = $('deviceCancel');
  var deviceNote = $('deviceNote');
  var devicePanel = $('devicePanel');
  var deviceUserCode = $('deviceUserCode');
  var deviceStatus = $('deviceStatus');
  var deviceOpen = $('deviceOpen');

  function renderOAuthAvailability() {
    if (core.isOAuthConfigured(oauthConfig())) {
      deviceButton.disabled = false;
      deviceNote.textContent = 'Device flow: GitHub shows you a code, you approve it on github.com, and this page receives a token scoped to "' + core.DEVICE_SCOPE + '". The token is stored only in this browser.';
      return;
    }
    deviceButton.disabled = true;
    deviceNote.textContent = 'Device-flow sign-in is not configured on this deployment yet — use a fine-grained token below. (An owner enables it by registering a GitHub OAuth App with device flow and deploying the relay in hosted/oauth-proxy/, then filling in CONSOLE_CONFIG.)';
  }

  // ── "How do I get a token?" ───────────────────────────────────────────────
  // The permission matrix is rendered FROM core.TOKEN_PERMISSIONS rather than
  // written into the HTML, so the table a user trusts cannot drift from the
  // list the code actually needs.
  function renderTokenHelp() {
    var matrix = $('permMatrix');
    if (matrix && !matrix.childNodes.length) {
      core.TOKEN_PERMISSIONS.forEach(function (permission) {
        var li = el('li');
        li.setAttribute('data-level', permission.level);
        var name = el('span', 'pm-name', permission.name);
        name.appendChild(el('em', '', core.levelLabel(permission.level)));
        li.appendChild(name);
        li.appendChild(el('span', 'pm-why', permission.why));
        matrix.appendChild(li);
      });
    }
    // GitHub's documented prefill: name, owner, expiry and every permission.
    // It fills the form in; only the user can press Generate.
    var fine = core.fineGrainedTokenUrl({ owner: state.owner, expiresIn: 90 });
    $('fineGrainedLink').href = fine;
    $('fineGrainedInline').href = fine;
    $('classicLink').href = core.classicTokenUrl();
    $('fineGrainedOwnerNote').textContent = state.owner
      ? 'Prefilled for ' + state.owner + ' with a 90-day expiration. You still pick the repository and press Generate.'
      : 'Pick a repository below and this link prefills the resource owner too.';
  }

  function endDeviceFlow() {
    state.device.running = false;
    state.device.cancelled = false;
    show(devicePanel, false);
    show(deviceCancel, false);
    deviceButton.disabled = !core.isOAuthConfigured(oauthConfig());
  }

  deviceButton.addEventListener('click', function () {
    if (state.device.running) return;
    state.device = { running: true, cancelled: false };
    deviceButton.disabled = true;
    show(deviceCancel, true);
    setStatus(deviceStatus, 'asking GitHub for a device code…', 'busy');

    core.requestDeviceCode(deps, oauthConfig()).then(function (grant) {
      if (state.device.cancelled) return null;
      deviceUserCode.textContent = grant.user_code;
      deviceOpen.href = grant.verification_uri;
      show(devicePanel, true);
      setStatus(deviceStatus, 'waiting for you to authorize on ' + grant.verification_uri + ' … (the code expires in about ' + Math.round(grant.expires_in / 60) + ' minutes)', 'busy');
      return core.pollForToken(deps, oauthConfig(), grant.device_code, grant.interval, {
        isCancelled: function () { return state.device.cancelled; }
      });
    }).then(function (result) {
      if (!result) return;
      endDeviceFlow();
      setStatus(deviceStatus, 'authorized. Scopes granted: ' + (result.scopes.join(', ') || 'unknown') + '.', 'pass');
      adoptToken(result.token);
    }).catch(function (error) {
      endDeviceFlow();
      setStatus(deviceStatus, 'sign-in failed: ' + (error && error.message ? error.message : 'unknown error'), 'fail');
    });
  });

  deviceCancel.addEventListener('click', function () {
    state.device.cancelled = true;
    endDeviceFlow();
    setStatus(deviceStatus, 'sign-in cancelled.', 'warn');
  });

  $('deviceCopy').addEventListener('click', function (event) {
    copyText(deviceUserCode.textContent, function (ok) { flashCopyButton(event.currentTarget, ok); });
  });

  $('patSave').addEventListener('click', function () {
    var value = $('patInput').value.trim();
    if (!value) {
      setStatus($('patStatus'), 'paste a token first.', 'warn');
      return;
    }
    setStatus($('patStatus'), 'checking the token with GitHub…', 'busy');
    adoptToken(value, $('patStatus'));
  });

  $('signOutButton').addEventListener('click', function () {
    state.store.clearAll();
    state.token = '';
    state.login = '';
    state.owner = '';
    state.repo = '';
    state.vars = {};
    state.varsLoaded = false;
    state.drafts = {};
    state.draftProvider = '';
    state.store = core.makeStore(null, '');
    $('patInput').value = '';
    $('repoInput').value = '';
    clear($('repoList'));
    clear($('readinessRows'));
    clear($('configPanel'));
    show($('authSignedIn'), false);
    show($('authSignedOut'), true);
    setPill($('connectState'), 'Not signed in', '');
    setPill($('installState'), 'Unknown', '');
    setPill($('readinessState'), 'Not run', '');
    setPill($('configState'), 'Not loaded', '');
    setStatus(deviceStatus, 'signed out. The token and this login\'s saved config were removed from this browser.', 'pass');
    setStatus($('patStatus'), '');
    setStatus($('repoStatus'), '');
    setStatus($('installSummary'), '');
    setStatus($('readinessStatus'), '');
    setStatus($('configStatus'), '');
    $('agentInstructions').textContent = 'Sign in and choose a repository to generate the instructions.';
    renderTokenHelp();
  });

  // Adopt a token: prove it works, learn the login, then namespace storage by
  // that login so two accounts in one browser never collide.
  function adoptToken(token, statusNode) {
    state.token = token;
    return gh('/user').then(function (res) {
      if (!res.ok || !res.data || !res.data.login) {
        state.token = '';
        setStatus(statusNode || deviceStatus, 'that token did not work: ' + res.error, 'fail');
        return;
      }
      state.login = res.data.login;
      state.store = core.makeStore(localStore(), state.login);

      var shared = localStore();
      try { if (shared) shared.setItem(core.TOKEN_KEY, token); } catch (error) {}

      $('userLogin').firstChild.nodeValue = res.data.login + ' ';
      $('userScopes').textContent = 'signed in · token held in this browser only';
      var avatar = $('userAvatar');
      if (res.data.avatar_url) {
        avatar.src = res.data.avatar_url;
        avatar.alt = res.data.login + ' avatar';
      }
      show($('authSignedOut'), false);
      show($('authSignedIn'), true);
      setPill($('connectState'), 'Signed in', 'pass');
      if (statusNode) setStatus(statusNode, 'token accepted.', 'pass');

      loadRepoList();
      var remembered = state.store.get('repo');
      if (remembered) {
        $('repoInput').value = remembered;
        selectRepo(remembered);
      }
    });
  }

  function loadRepoList() {
    gh('/user/repos?per_page=100&sort=updated').then(function (res) {
      var list = $('repoList');
      clear(list);
      if (!res.ok || !Array.isArray(res.data)) return;
      res.data.forEach(function (repo) {
        var option = document.createElement('option');
        option.value = repo.full_name;
        list.appendChild(option);
      });
    });
  }

  function selectRepo(text) {
    var parsed = core.parseRepoInput(text);
    if (!parsed) {
      setStatus($('repoStatus'), 'that is not an owner/repo or a github.com repository URL.', 'fail');
      return;
    }
    state.owner = parsed.owner;
    state.repo = parsed.repo;
    renderTokenHelp();
    state.vars = {};
    state.varsLoaded = false;
    state.drafts = {};
    state.draftProvider = '';
    $('repoInput').value = slug();
    state.store.set('repo', slug());
    setStatus($('repoStatus'), 'checking ' + slug() + ' …', 'busy');
    clear($('readinessRows'));
    setPill($('readinessState'), 'Not run', '');

    gh('/repos/' + slug()).then(function (res) {
      if (!res.ok) {
        setStatus($('repoStatus'), 'could not read ' + slug() + ': ' + res.error, 'fail');
        return;
      }
      state.defaultBranch = res.data.default_branch || 'main';
      setStatus($('repoStatus'), 'using ' + slug() + ' (default branch ' + state.defaultBranch + ').', 'pass');
      renderAgentInstructions();
      checkInstalled();
      loadVariables();
    });
  }

  $('repoUse').addEventListener('click', function () { selectRepo($('repoInput').value); });
  $('repoInput').addEventListener('change', function () { selectRepo($('repoInput').value); });
  $('repoInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectRepo($('repoInput').value);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Install
  // ═══════════════════════════════════════════════════════════════════════════
  var installSteps = $('installSteps');
  var installResult = $('installResult');

  function renderAgentInstructions() {
    if (!hasRepo()) return;
    $('agentInstructions').textContent = core.agentInstructions({
      owner: state.owner,
      repo: state.repo,
      provider: currentProvider(),
      vars: state.vars
    });
  }

  function contentExists(path) {
    var ref = state.defaultBranch ? '?ref=' + encodeURIComponent(state.defaultBranch) : '';
    return gh('/repos/' + slug() + '/contents/' + path + ref).then(function (res) {
      if (res.ok) return { path: path, present: true, error: '' };
      if (res.status === 404) return { path: path, present: false, error: '' };
      return { path: path, present: false, error: res.error };
    });
  }

  function checkInstalled() {
    if (!hasRepo()) return Promise.resolve(null);
    setStatus($('installSummary'), 'looking for the workflows on ' + state.defaultBranch + ' …', 'busy');
    return Promise.all(core.WORKFLOW_PATHS.map(contentExists)).then(function (found) {
      var unreadable = found.filter(function (f) { return f.error; });
      if (unreadable.length === found.length) {
        setPill($('installState'), 'Unknown', 'warn');
        setStatus($('installSummary'), 'could not read the repo contents: ' + unreadable[0].error, 'warn');
        return null;
      }
      var missing = found.filter(function (f) { return !f.present; });
      var details = $('installPaths');
      if (!missing.length) {
        setPill($('installState'), 'Installed', 'pass');
        setStatus($('installSummary'), 'both workflows are already on ' + state.defaultBranch + ' — nothing to install. Open the panels below only if you want to reinstall or re-read the instructions.', 'pass');
        details.hidden = true;
      } else {
        setPill($('installState'), 'Not installed', 'fail');
        setStatus($('installSummary'), missing.length + ' of 2 workflows missing on ' + state.defaultBranch + ': ' + missing.map(function (f) { return f.path; }).join(', ') + '. Pick either path below.', 'fail');
        details.hidden = false;
      }
      return found;
    });
  }

  function step(label) {
    var li = el('li');
    li.appendChild(el('span', 'mark', '·'));
    li.appendChild(el('span', 'body', label));
    li.setAttribute('data-tone', 'busy');
    installSteps.appendChild(li);
    return {
      done: function (message) {
        li.setAttribute('data-tone', 'pass');
        li.firstChild.textContent = '✓';
        if (message) li.lastChild.textContent = message;
      },
      fail: function (message) {
        li.setAttribute('data-tone', 'fail');
        li.firstChild.textContent = '✘';
        if (message) li.lastChild.textContent = message;
      }
    };
  }

  $('installPrButton').addEventListener('click', function () {
    if (!hasRepo()) {
      setStatus(installResult, 'choose a repository first.', 'warn');
      return;
    }
    var button = $('installPrButton');
    button.disabled = true;
    clear(installSteps);
    setStatus(installResult, '');
    openInstallPr().catch(function (error) {
      setStatus(installResult, 'the install stopped: ' + (error && error.message ? error.message : 'unknown error'), 'fail');
    }).then(function () {
      button.disabled = false;
    });
  });

  function openInstallPr() {
    var plan = core.installPlan();
    var branchRef = 'refs/heads/' + plan.branch;
    var baseSha = '';

    var s1 = step('read the default branch head');
    return gh('/repos/' + slug() + '/git/ref/heads/' + encodeURIComponent(state.defaultBranch)).then(function (res) {
      if (!res.ok || !res.data || !res.data.object) throw new Error('could not read ' + state.defaultBranch + ': ' + res.error);
      baseSha = res.data.object.sha;
      s1.done('read ' + state.defaultBranch + ' at ' + baseSha.slice(0, 7));

      var s2 = step('create the ' + plan.branch + ' branch');
      return gh('/repos/' + slug() + '/git/refs', { method: 'POST', body: { ref: branchRef, sha: baseSha } })
        .then(function (created) {
          if (created.ok) {
            s2.done('created ' + plan.branch);
            return;
          }
          if (created.status === 422) {
            // Already there — reuse it rather than dead-ending the user.
            s2.done(plan.branch + ' already exists — reusing it');
            return;
          }
          throw new Error('could not create ' + plan.branch + ': ' + created.error);
        });
    }).then(function () {
      // Fetch each template fresh from the canonical source, so the console can
      // never commit a stale copy it embedded at build time.
      return plan.files.reduce(function (chain, file) {
        return chain.then(function () {
          var s = step('fetch ' + file.source);
          var url = core.templateUrl(file.source, CONSOLE_CONFIG.TEMPLATE_BASE);
          return deps.fetch(url).then(function (res) {
            if (!res.ok) throw new Error('could not fetch the canonical template ' + url + ' (HTTP ' + res.status + ')');
            return res.text();
          }).catch(function (error) {
            s.fail('could not fetch ' + file.source + ': ' + (error.message || 'network error'));
            throw error;
          }).then(function (text) {
            s.done('fetched ' + file.source + ' (' + text.length + ' bytes)');
            return commitFile(plan, file, text);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      var s = step('open the pull request');
      return gh('/repos/' + slug() + '/pulls', {
        method: 'POST',
        body: { title: plan.prTitle, head: plan.branch, base: state.defaultBranch, body: plan.prBody }
      }).then(function (res) {
        if (res.ok && res.data) {
          s.done('opened #' + res.data.number);
          linkPr(res.data.html_url, 'Pull request #' + res.data.number + ' is open. Latch does not merge it — you do.');
          return;
        }
        if (res.status === 422) {
          s.done('a pull request for ' + plan.branch + ' already exists — looking it up');
          return findExistingPr(plan.branch);
        }
        s.fail('could not open the pull request: ' + res.error);
        throw new Error(res.error);
      });
    });
  }

  function commitFile(plan, file, text) {
    var s = step('commit ' + file.path);
    var path = '/repos/' + slug() + '/contents/' + file.path;
    // A PUT needs the blob sha when the file already exists on the branch.
    return gh(path + '?ref=' + encodeURIComponent(plan.branch)).then(function (existing) {
      var body = {
        message: 'add ' + file.path,
        content: toBase64(text),
        branch: plan.branch
      };
      if (existing.ok && existing.data && existing.data.sha) body.sha = existing.data.sha;
      return gh(path, { method: 'PUT', body: body });
    }).then(function (res) {
      if (res.ok) {
        s.done('committed ' + file.path);
        return;
      }
      if ((res.status === 403 || res.status === 404) && file.path.indexOf('.github/workflows/') === 0) {
        s.fail('your token cannot write .github/workflows/ — use the agent-instructions path instead (a fine-grained token needs Workflows: read and write, and a device-flow token needs the workflow scope).');
      } else {
        s.fail('could not commit ' + file.path + ': ' + res.error);
      }
      throw new Error(res.error);
    });
  }

  function findExistingPr(branch) {
    return gh('/repos/' + slug() + '/pulls?state=open&head=' + encodeURIComponent(state.owner + ':' + branch)).then(function (res) {
      if (res.ok && Array.isArray(res.data) && res.data.length) {
        linkPr(res.data[0].html_url, 'Pull request #' + res.data[0].number + ' was already open for ' + branch + ' and now carries these files.');
        return;
      }
      setStatus(installResult, 'the branch ' + branch + ' exists but no open pull request was found for it — open one from the GitHub UI, or delete the branch and retry.', 'warn');
    });
  }

  function linkPr(url, message) {
    clear(installResult);
    installResult.setAttribute('data-tone', 'pass');
    installResult.appendChild(document.createTextNode(message + ' '));
    var link = el('a', '', url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.color = 'var(--brand)';
    link.style.textDecoration = 'underline';
    installResult.appendChild(link);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Readiness
  // ═══════════════════════════════════════════════════════════════════════════
  $('readinessButton').addEventListener('click', function () {
    if (!hasRepo()) {
      setStatus($('readinessStatus'), 'choose a repository first.', 'warn');
      return;
    }
    var button = $('readinessButton');
    button.disabled = true;
    setStatus($('readinessStatus'), 'reading ' + slug() + ' from GitHub…', 'busy');
    buildSnapshot().then(function (result) {
      renderReadiness(core.evaluateReadiness(result.snapshot), result.problems);
    }).then(function () {
      button.disabled = false;
    });
  });

  function buildSnapshot() {
    var problems = [];
    var snapshot = {
      defaultBranch: state.defaultBranch,
      workflows: null,
      contents: null,
      secretNames: null,
      variables: null,
      appInstallations: null,
      runs: {}
    };
    var base = '/repos/' + slug();

    var jobs = [];

    jobs.push(gh(base).then(function (res) {
      if (res.ok && res.data) {
        snapshot.defaultBranch = res.data.default_branch || snapshot.defaultBranch;
        state.defaultBranch = snapshot.defaultBranch;
      } else {
        problems.push('repository: ' + res.error);
      }
    }));

    jobs.push(gh(base + '/actions/workflows?per_page=100').then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.workflows)) {
        snapshot.workflows = res.data.workflows.map(function (wf) { return { path: wf.path, state: wf.state }; });
      } else {
        problems.push('workflow list: ' + res.error);
      }
    }));

    jobs.push(gh(base + '/actions/secrets?per_page=100').then(function (res) {
      // NAMES ONLY. The response carries no secret values, and we keep no more
      // than the names even so.
      if (res.ok && res.data && Array.isArray(res.data.secrets)) {
        snapshot.secretNames = res.data.secrets.map(function (s) { return s.name; });
      } else {
        problems.push('secret names: ' + res.error);
      }
    }));

    jobs.push(gh(base + '/actions/variables?per_page=100').then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.variables)) {
        snapshot.variables = mapVariables(res.data.variables);
        state.vars = snapshot.variables;
        state.varsLoaded = true;
      } else {
        problems.push('variables: ' + res.error);
      }
    }));

    // Best-effort: many tokens simply cannot see installations. That is a warn
    // row, not a failure.
    jobs.push(gh('/user/installations?per_page=100').then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.installations)) {
        snapshot.appInstallations = res.data.installations.map(function (i) { return { app_slug: i.app_slug }; });
      } else {
        snapshot.appInstallations = null;
      }
    }));

    core.WORKFLOW_FILES.forEach(function (file) {
      jobs.push(gh(base + '/actions/workflows/' + encodeURIComponent(file) + '/runs?per_page=5').then(function (res) {
        if (res.ok && res.data && Array.isArray(res.data.workflow_runs)) {
          snapshot.runs[file] = res.data.workflow_runs.map(function (run) {
            return {
              conclusion: run.conclusion,
              status: run.status,
              created_at: run.created_at,
              updated_at: run.updated_at,
              html_url: run.html_url
            };
          });
        } else if (res.status === 404) {
          // The workflow is not installed; the workflows rule already says so.
          snapshot.runs[file] = [];
        } else {
          snapshot.runs[file] = null;
          problems.push(file + ' runs: ' + res.error);
        }
      }));
    });

    // The contents calls need the default branch, so they queue behind it.
    var contentPaths = core.WORKFLOW_PATHS.concat([core.POLICY_PATH]);
    var contentsJob = jobs[0].then(function () {
      return Promise.all(contentPaths.map(contentExists)).then(function (found) {
        var map = {};
        var unreadable = 0;
        found.forEach(function (f) {
          map[f.path] = f.present;
          if (f.error) {
            unreadable += 1;
            problems.push(f.path + ': ' + f.error);
          }
        });
        snapshot.contents = unreadable === found.length ? null : map;
      });
    });

    return Promise.all(jobs.concat([contentsJob])).then(function () {
      return { snapshot: snapshot, problems: problems };
    });
  }

  function mapVariables(list) {
    var map = {};
    list.forEach(function (v) { map[v.name] = v.value; });
    return map;
  }

  function renderReadiness(rows, problems) {
    var host = $('readinessRows');
    clear(host);

    var counts = { pass: 0, warn: 0, fail: 0 };
    rows.forEach(function (row) {
      counts[row.state] += 1;
      var node = el('div', 'check-row');
      node.setAttribute('data-state', row.state);
      node.appendChild(el('span', 'badge', row.state === 'pass' ? '✓' : row.state === 'warn' ? '!' : '✘'));

      var body = el('div');
      body.appendChild(el('p', 'rule', row.id));
      body.appendChild(el('p', 'label', row.label));
      if (row.hint) body.appendChild(el('p', 'hint', row.hint));
      if (row.url) {
        var hint = el('p', 'hint');
        var link = el('a', '', 'open the run ↗');
        link.href = row.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        hint.appendChild(link);
        body.appendChild(hint);
      }
      node.appendChild(body);
      host.appendChild(node);
    });

    var tone = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
    setPill($('readinessState'), counts.fail ? counts.fail + ' failing' : counts.warn ? counts.warn + ' warning' + (counts.warn === 1 ? '' : 's') : 'All clear', tone);

    var summary = counts.pass + ' pass · ' + counts.warn + ' warn · ' + counts.fail + ' fail.';
    if (problems && problems.length) {
      summary += ' ' + problems.length + ' call' + (problems.length === 1 ? '' : 's') + ' could not be read: ' + problems.join('; ');
    }
    setStatus($('readinessStatus'), summary, tone);

    // The readiness pass also refreshes the config panel's idea of the world.
    if (state.varsLoaded) {
      renderConfig();
      renderAgentInstructions();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Config
  // ═══════════════════════════════════════════════════════════════════════════
  $('configReload').addEventListener('click', function () { loadVariables(); });

  function loadVariables() {
    if (!hasRepo()) {
      setStatus($('configStatus'), 'choose a repository first.', 'warn');
      return Promise.resolve();
    }
    setStatus($('configStatus'), 'reading this repo\'s Actions variables…', 'busy');
    return gh('/repos/' + slug() + '/actions/variables?per_page=100').then(function (res) {
      if (!res.ok || !res.data || !Array.isArray(res.data.variables)) {
        setPill($('configState'), 'Unreadable', 'fail');
        setStatus($('configStatus'), 'could not read the variables: ' + res.error, 'fail');
        return;
      }
      state.vars = mapVariables(res.data.variables);
      state.varsLoaded = true;
      state.drafts = {};
      state.draftProvider = '';
      var setCount = core.varNames().filter(function (name) { return !core.isUnset(state.vars[name]); }).length;
      setPill($('configState'), setCount ? setCount + ' set' : 'All defaults', 'pass');
      setStatus($('configStatus'), setCount
        ? setCount + ' Latch variable' + (setCount === 1 ? '' : 's') + ' set on ' + slug() + '. A saved value takes effect on the NEXT workflow run — no commit, no redeploy.'
        : 'No Latch variables are set on ' + slug() + ' — it is running entirely on defaults, which is the supported path.', 'pass');
      renderConfig();
      renderAgentInstructions();
    });
  }

  function collectDrafts() {
    var drafts = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-var-input]'), function (input) {
      drafts[input.getAttribute('data-var-input')] = input.value;
    });
    return drafts;
  }

  function renderConfig() {
    var host = $('configPanel');
    var drafts = state.drafts;
    clear(host);
    if (!state.varsLoaded) return;

    var provider = currentProvider();
    host.appendChild(renderKillSwitch());

    core.VAR_GROUPS.filter(function (group) { return group.id !== 'killswitch'; }).forEach(function (group) {
      var section = el('div', 'group');
      section.style.marginTop = '20px';
      var head = el('div', 'group-head');
      head.appendChild(el('h3', '', group.title));
      head.appendChild(el('span', '', group.blurb));
      section.appendChild(head);
      core.varsInGroup(group.id).forEach(function (spec) {
        section.appendChild(renderVar(spec, provider, drafts));
      });
      host.appendChild(section);
    });
  }

  function renderKillSwitch() {
    var paused = String(state.vars.LATCH_PAUSED || '') === 'true';
    var box = el('div', 'killswitch' + (paused ? ' on' : ''));
    var copy = el('div');
    copy.appendChild(el('h3', '', paused ? 'The loop is paused' : 'The loop is live'));
    copy.appendChild(el('p', 'note', paused
      ? 'LATCH_PAUSED is true: no review runs and no verdict status is posted. If you marked ' + core.effectiveValue('LATCH_VERDICT_CONTEXT', state.vars, currentProvider()).value + ' a required check, un-require it while paused or merges will block.'
      : 'Both workflows run normally. Pausing makes them no-op immediately — nothing is uninstalled, and flipping it back resumes on the next event.'));
    var statusLine = el('p', 'status');
    statusLine.id = 'killswitchStatus';
    statusLine.setAttribute('role', 'status');
    statusLine.setAttribute('aria-live', 'polite');
    copy.appendChild(statusLine);
    box.appendChild(copy);

    var actions = el('div', 'actions');
    var toggle = el('button', 'btn ' + (paused ? 'btn-primary' : 'btn-danger'), paused ? 'Resume the loop' : 'Pause the loop');
    toggle.type = 'button';
    toggle.addEventListener('click', function () {
      toggle.disabled = true;
      writeVar('LATCH_PAUSED', paused ? 'false' : 'true', statusLine).then(function () {
        toggle.disabled = false;
        renderConfig();
      });
    });
    actions.appendChild(toggle);
    box.appendChild(actions);
    return box;
  }

  function renderVar(spec, provider, drafts) {
    var raw = state.vars[spec.name];
    var effective = core.effectiveValue(spec.name, state.vars, provider);
    var isSet = !core.isUnset(raw);
    var draft = Object.prototype.hasOwnProperty.call(drafts, spec.name) ? drafts[spec.name] : (isSet ? String(raw) : '');

    var box = el('div', 'var');
    var top = el('div', 'var-top');
    var label = el('label', 'var-name', spec.name);
    var inputId = 'var-' + spec.name;
    label.setAttribute('for', inputId);
    label.style.textTransform = 'none';
    label.style.letterSpacing = '0';
    label.style.color = 'var(--ink)';
    top.appendChild(label);
    top.appendChild(el('span', 'tag ' + (isSet ? 'tag-set' : 'tag-default'), isSet ? 'set' : 'default'));
    top.appendChild(el('span', 'tag', spec.consumedBy.join(' · ')));
    box.appendChild(top);
    box.appendChild(el('p', 'var-help', spec.help));

    var controls = el('div', 'var-controls');
    var input;
    if (spec.type === 'enum') {
      input = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'default (' + spec.default + ')';
      input.appendChild(blank);
      spec.options.forEach(function (option) {
        var node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        input.appendChild(node);
      });
      input.value = draft;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.value = draft;
      input.placeholder = effective.value ? 'default: ' + effective.value : 'unset';
      var suggestions = suggestionsFor(spec, provider);
      if (suggestions.length) {
        var listId = inputId + '-list';
        var datalist = document.createElement('datalist');
        datalist.id = listId;
        suggestions.forEach(function (option) {
          var node = document.createElement('option');
          node.value = option;
          datalist.appendChild(node);
        });
        box.appendChild(datalist);
        input.setAttribute('list', listId);
      }
    }
    input.id = inputId;
    input.setAttribute('data-var-input', spec.name);
    controls.appendChild(input);

    var save = el('button', 'btn btn-small', 'Save');
    save.type = 'button';
    var reset = el('button', 'btn btn-small', 'Reset to default');
    reset.type = 'button';
    reset.disabled = !isSet;
    controls.appendChild(save);
    controls.appendChild(reset);
    box.appendChild(controls);

    var effLine = el('p', 'var-eff', effectiveLine(effective, spec));
    box.appendChild(effLine);
    var status = el('p', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    box.appendChild(status);

    function validateNow(quiet) {
      var value = input.value;
      if (value === '') {
        input.removeAttribute('aria-invalid');
        // Quiet on the first render: an unset field is the normal state, not a
        // problem to nag about.
        setStatus(status, quiet ? '' : 'empty means unset — use "Reset to default" to delete the variable.', '');
        save.disabled = true;
        return;
      }
      var verdict = core.validateVar(spec.name, value);
      if (verdict.ok) {
        input.removeAttribute('aria-invalid');
        setStatus(status, '');
        save.disabled = false;
      } else {
        input.setAttribute('aria-invalid', 'true');
        setStatus(status, verdict.error, 'fail');
        save.disabled = true;
      }
    }

    input.addEventListener('input', validateNow);
    input.addEventListener('change', function () {
      validateNow();
      if (spec.name === 'LATCH_PROVIDER') {
        // The provider swings the option lists and the defaults under it, so
        // re-render with the drafts intact.
        state.drafts = collectDrafts();
        state.draftProvider = core.resolveProvider(input.value || state.vars.LATCH_PROVIDER || '');
        renderConfig();
        renderAgentInstructions();
      }
    });
    validateNow(true);

    save.addEventListener('click', function () {
      var value = input.value;
      var verdict = core.validateVar(spec.name, value);
      if (!verdict.ok) {
        setStatus(status, verdict.error, 'fail');
        return;
      }
      save.disabled = true;
      writeVar(spec.name, value, status).then(function () {
        save.disabled = false;
        state.drafts = collectDrafts();
        renderConfig();
        renderAgentInstructions();
      });
    });

    reset.addEventListener('click', function () {
      reset.disabled = true;
      deleteVar(spec.name, status).then(function () {
        state.drafts = collectDrafts();
        delete state.drafts[spec.name];
        renderConfig();
        renderAgentInstructions();
      });
    });

    return box;
  }

  function suggestionsFor(spec, provider) {
    if (spec.name === 'LATCH_MODEL' || spec.name === 'LATCH_FIX_MODEL') return core.MODEL_OPTIONS[provider] || [];
    if (spec.name === 'LATCH_REVIEW_EFFORT' || spec.name === 'LATCH_EFFORT') return core.EFFORT_OPTIONS[provider] || [];
    return [];
  }

  function effectiveLine(effective, spec) {
    var shown = effective.value === '' ? '(none)' : effective.value;
    var line = 'the next run uses: ' + shown;
    if (effective.note) line += ' — ' + effective.note;
    else if (effective.isDefault) line += ' — default';
    if (spec.type === 'int') line += ' · allowed ' + spec.min + '–' + spec.max;
    return line;
  }

  // PATCH first, POST on 404: the console does not know whether the variable
  // already exists, and asking costs an extra round trip on the common path.
  function writeVar(name, value, statusNode) {
    setStatus(statusNode, 'saving ' + name + ' …', 'busy');
    var base = '/repos/' + slug() + '/actions/variables';
    return gh(base + '/' + encodeURIComponent(name), { method: 'PATCH', body: { name: name, value: value } })
      .then(function (res) {
        if (res.ok) return res;
        if (res.status === 404) return gh(base, { method: 'POST', body: { name: name, value: value } });
        return res;
      })
      .then(function (res) {
        if (res.ok) {
          state.vars[name] = value;
          setStatus(statusNode, name + ' = ' + value + ' saved. It takes effect on the next workflow run — no commit, no redeploy.', 'pass');
        } else {
          setStatus(statusNode, 'could not save ' + name + ': ' + res.error, 'fail');
        }
        return res;
      });
  }

  function deleteVar(name, statusNode) {
    setStatus(statusNode, 'deleting ' + name + ' …', 'busy');
    return gh('/repos/' + slug() + '/actions/variables/' + encodeURIComponent(name), { method: 'DELETE' })
      .then(function (res) {
        if (res.ok || res.status === 404) {
          delete state.vars[name];
          setStatus(statusNode, name + ' deleted — the workflow falls back to its default on the next run.', 'pass');
        } else {
          setStatus(statusNode, 'could not delete ' + name + ': ' + res.error, 'fail');
        }
        return res;
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════════════════════
  renderOAuthAvailability();
  renderTokenHelp();

  (function resume() {
    var shared = localStore();
    var saved = null;
    try { saved = shared ? shared.getItem(core.TOKEN_KEY) : null; } catch (error) { saved = null; }
    if (!saved) return;
    setStatus(deviceStatus, 'checking the token saved in this browser…', 'busy');
    adoptToken(saved).then(function () {
      if (state.login) setStatus(deviceStatus, '');
      else {
        try { if (shared) shared.removeItem(core.TOKEN_KEY); } catch (error) {}
      }
    });
  })();
})();

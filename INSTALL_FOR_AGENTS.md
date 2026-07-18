# Installing Latch (for coding agents)

This is the exact procedure for a coding agent — Claude Code, Codex, Cursor,
Devin, OpenHands — to install Latch in a repository it is working on.

**The hard rule:** an agent does the file changes; a **human** does the two steps
that touch credentials and org settings. Latch is the *independent* gate, and it
must post as `claude[bot]` (the Claude GitHub App) — installing an app and
setting a secret are human actions. Never handle, request, echo, or store the
token value. If you cannot complete a step because it needs the human, stop and
hand back with the exact commands for them to run.

---

## What the agent does

1. **Install the workflows and policy** from the repo root:

   ```sh
   npx github:nishantkumar1292/latch init
   ```

   This copies `.github/workflows/latch-review.yml` and
   `.github/workflows/latch-fix.yml` into the repo and seeds `.latch/policy.yml`
   by mining the repo (landmines from `CLAUDE.md`/`AGENTS.md`, checks from the
   manifests). It refuses to overwrite existing files without `--force`.

   - Prefer a subscription token? That is the default (`--auth oauth`).
   - Using a metered API key instead? `npx github:nishantkumar1292/latch init --auth api-key`.

2. **Review the seeded policy.** Open `.latch/policy.yml` and sharpen it: make each
   mined landmine's `hunt` concrete, confirm the inferred `checks` are the repo's
   real gate commands, and add any trap you know about. This file is the doctrine
   made specific to this repo — better policy, better gate.

3. **Commit the three files** (do not commit any secret — there is none to
   commit):

   ```sh
   git add .github/workflows/latch-review.yml .github/workflows/latch-fix.yml .latch/policy.yml
   git commit -m "add latch merge gate"
   ```

4. **Verify** the install:

   ```sh
   npx github:nishantkumar1292/latch doctor
   ```

   `doctor` will report the two human steps below as unverifiable warnings — that
   is expected; they are the human's to complete.

5. **STOP and hand back to the human.** Print the two commands in the next
   section verbatim. Do not attempt them yourself, and do not ask the human to
   paste the token to you.

---

## What the human must do (hand these back — do not run them for the human)

These require org/repo permissions and a credential. The agent must not perform
them or see the token.

1. **Install the Claude GitHub App** (required — without it the review cannot
   post as `claude[bot]`, and the fix hop never triggers):

   - <https://github.com/apps/claude>  — or run `claude /install-github-app`

2. **Set the auth secret** on the repo (pick the one matching how you installed):

   ```sh
   # subscription (default):
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --app actions

   # OR metered API key:
   gh secret set ANTHROPIC_API_KEY --app actions
   ```

Then open a pull request. Latch reviews it, the fixer converges it, and the loop
stops — **a human merges**. The `latch/merge-gate` check is **non-blocking by
default**; make it a required check in branch protection only once you trust its
false-positive rate.

---

## Copy-paste prompt for a human to give their agent

> Install Latch (the independent merge gate) in this repository. Run
> `npx github:nishantkumar1292/latch init`, then open `.latch/policy.yml` and
> tighten it for this repo — make each landmine's `hunt` concrete and confirm the
> inferred `checks` are our real CI commands. Commit the three files it created
> (`.github/workflows/latch-review.yml`, `.github/workflows/latch-fix.yml`,
> `.latch/policy.yml`). Do **not** touch any token or secret: when you are done,
> print the exact commands I need to run to install the Claude GitHub App and set
> the repo secret, and stop there. Finally, run
> `npx github:nishantkumar1292/latch doctor` and show me the output.

---

## Notes for agents

- **Idempotent:** re-running `init` when nothing changed is safe; it reports files
  as already up to date. It exits non-zero only when a file exists and differs and
  you did not pass `--force`.
- **`latch-fix.yml` only takes effect on the default branch.** GitHub runs
  `pull_request_review` workflows from the default branch, so the fix half becomes
  active once your PR adding it is merged. The review half works from the PR.
- **Anti-tamper:** the fixer refuses to touch any PR that changes
  `.github/workflows/` or `.latch/` — the rails that govern the loop are a
  human's to change, never the automated fixer's.
- **Independence knob:** set the `LATCH_MODEL` repo variable to a model *unlike*
  your author-agent. A reviewer on the same weights that wrote the code shares its
  blind spots.

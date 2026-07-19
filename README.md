# Latch

**Independent review and autofix for agent-written pull requests.**

Latch starts when a pull request opens. One agent reviews the diff, a separate
fixer judges each finding and repairs real defects, and the reviewer checks the
result again. The loop stops when the review is clean or after three fix cycles.
**Latch never merges; a human does.**

## What it does

- Posts line-level review findings and a `latch/merge-gate` verdict on the PR.
- Fixes findings it agrees with, then automatically requests another review.
- Explains disagreements and leaves those threads open for a human decision.
- Refuses to edit its own workflows or `.latch/policy.yml`.
- Runs in your GitHub Actions with your Claude subscription token or API key.

## Install

From the repository you want Latch to review:

```sh
npx @nishantkumar1292/latch init
```

Then complete the two credentialed steps yourself:

1. Install the [Claude GitHub App](https://github.com/apps/claude) on the
   repository.
2. Add one Actions secret:

   ```sh
   # Claude Pro or Max subscription
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --app actions

   # Or use an Anthropic API key
   gh secret set ANTHROPIC_API_KEY --app actions
   ```

Verify the setup:

```sh
npx @nishantkumar1292/latch doctor
```

The installer creates:

```text
.github/workflows/latch-review.yml
.github/workflows/latch-fix.yml
.latch/policy.yml
```

### Install with a coding agent

Run your coding-agent CLI in the target repository and give it this prompt:

> Install Latch in this repository. Read
> `https://raw.githubusercontent.com/nishantkumar1292/latch/master/INSTALL_FOR_AGENTS.md`
> and follow it exactly. Do not request, read, or set any secret. Stop and give
> me the human-only commands when the repository changes are ready.

The complete agent protocol is in
[`INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md).

## Effect on a pull request

```text
PR opened
  → reviewer posts inline findings and a verdict
  → fixer repairs real defects or explains why it disagrees
  → reviewer checks the new commit
  → clean review: Latch stops and waits for a human to merge

After 3 unsuccessful fix cycles
  → Latch mentions the author and stops for a human decision
```

The verdict is non-blocking by default. See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the event sequence and
guards, and [`SECURITY.md`](./SECURITY.md) for the threat model.

## License

[FSL-1.1-Apache-2.0](./LICENSE.md). Each release converts to Apache-2.0 two years
after publication.

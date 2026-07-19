# Security policy

Latch runs an automated review⇄fix loop over pull requests. Because it reads
untrusted PR content and can push commits, its security posture is part of the
product, not an afterthought. This document covers how to report a vulnerability and
the threat model in brief.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public issue for
a security bug.

- Use GitHub's **private vulnerability reporting** on
  [`nishantkumar1292/latch`](https://github.com/nishantkumar1292/latch) (the "Report a
  vulnerability" button under the Security tab), or
- email the maintainer at the address on the GitHub profile.

Include the affected version/commit, a reproduction, and the impact you observed. We
aim to acknowledge within a few business days. Please give us reasonable time to ship
a fix before any public disclosure.

## What Latch is, for threat-modeling

Latch is two GitHub Actions workflows plus a policy file that run in **your**
repository, on **your** `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. There is
no Latch-operated server in that loop.

## Threat model (in brief)

### 1. Prompt injection via PR content

A pull request's title, description, diff, or comments are attacker-controllable and
are fed to the reviewer and fixer.

- **Design guarantee.** The reviewer treats PR text as **claims to falsify**, not
  instructions to obey — the doctrine is adversarial toward the PR's own narrative.
  The worst outcome a poisoned PR can force is a **wrong comment or verdict**, never
  an unsafe **merge**, because the loop never merges.
- **What it does not guarantee.** Injection resistance is a doctrine property, not a
  cryptographic one; a sufficiently clever payload could still degrade review quality.
  Keep the verdict **non-blocking by default** so a manipulated verdict cannot block
  or force-ship a PR on its own.

### 2. Tampered workflows / self-modifying loop

An agent-authored PR could try to edit the very workflows or policy that govern the
loop, or the loop could rewrite its own rules.

- **Design guarantee.** The **anti-tamper guard** makes the fixer skip any PR that
  touches `.github/workflows/` or anything under `.latch/`. The loop cannot fix, and
  therefore cannot silently change, the rules that govern it.
- **Operational note.** Protect `.github/workflows/` and `.latch/policy.yml` with
  branch protection / CODEOWNERS as you would any privileged config; the guard stops
  the *automation* from editing them, not a human with write access.

### 3. Token scope and identity separation

The loop pushes commits and posts reviews.

- **Design guarantee.** The reviewer and fixer run under **distinct identities**, so
  nothing self-approves (GitHub blocks any identity from approving a PR it authored).
  The fixer pushes with the default `GITHUB_TOKEN`, whose push — by GitHub's recursion
  guard — **triggers no workflow**, so the automation cannot self-trigger or loop
  unboundedly. Every hop is instead an **explicit, auditable** `workflow_dispatch`
  run.
- **What it does not guarantee.** The workflow's `GITHUB_TOKEN` needs `contents:
  write` to push fixes; scope your token and branch rules accordingly.

### 4. Runaway cost / denial of wallet

The loop makes model calls on your key.

- **Design guarantee.** A hard **cycle cap (default 3)** bounds fixer runs per PR;
  on the cap the loop escalates to a human and stops. The loop only fires when there
  are findings, so clean PRs cost a single pass.

## What the design guarantees, and what it does not

**Guarantees:** the loop never merges; it never edits the workflows or policy that
govern it; nothing self-approves; the automation cannot self-trigger; it is bounded
and escalates to a human; and your code never leaves your Actions.

**Does not guarantee:** perfect resistance to prompt injection, correctness of any
individual verdict, or safety against a human with write access who removes the
guards. Treat the verdict as adversarial triage that a human ratifies — which is
exactly why a human always merges.

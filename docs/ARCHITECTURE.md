# Architecture

Latch is two GitHub Actions workflows plus a repository policy file. The review
workflow inspects a pull request; the fix workflow responds to actionable review
threads. Each hop is a separate Actions run.

## Identities

The loop uses two identities:

- **Reviewer:** posts inline findings and the verdict through the Claude GitHub
  App. Its submitted review fires GitHub's `pull_request_review` event.
- **Fixer:** replies to threads and pushes repairs with the repository's default
  `GITHUB_TOKEN`.

GitHub does not trigger new workflow runs from a `GITHUB_TOKEN` push. Latch uses
that recursion guard deliberately: the fixer cannot wake itself. When it commits
a repair, it explicitly dispatches the review workflow against the new PR head.

## Event sequence

```mermaid
sequenceDiagram
    participant Author as Human or coding agent
    participant GitHub
    participant Reviewer
    participant Fixer

    Author->>GitHub: Open or mark PR ready
    GitHub->>Reviewer: pull_request event
    Reviewer->>GitHub: Inline findings + verdict
    GitHub->>Fixer: pull_request_review event
    Fixer->>Fixer: Judge each unresolved finding

    alt Finding is a real defect
        Fixer->>GitHub: Push repair and resolve thread
        Fixer->>Reviewer: workflow_dispatch re-review
        Reviewer->>GitHub: Review the repaired PR
    else Finding is wrong or out of scope
        Fixer->>GitHub: Reply with reasoning; leave thread open
    end

    Note over Reviewer,Fixer: Clean review or cycle cap ends the loop
    Author->>GitHub: Human decides whether to merge
```

## Verdict

The reviewer publishes one of three verdicts as the `latch/merge-gate` commit
status:

- `MERGE`
- `MERGE-WITH-FIXES`
- `DO-NOT-MERGE`

The status is non-blocking by default. Repository owners can make it required in
their own branch rules after evaluating it on their codebase.

## Guards

1. **Anti-tamper:** the fixer skips any PR that changes
   `.github/workflows/` or anything under `.latch/`.
2. **Cycle cap:** the fixer can land at most three repair cycles by default. At
   the cap, Latch mentions the author and stops.
3. **Actionable-thread check:** the fixer runs only when an unresolved thread was
   opened by the reviewer identity.
4. **Checks before commit:** the fixer runs the commands selected for the changed
   paths and keeps a repair only when those checks pass.
5. **Human merge:** neither workflow contains a merge step.

## Fixer decisions

For every unresolved reviewer thread, the fixer chooses one of two outcomes:

- A defect belongs to the current PR: change the code, run checks, reply with
  the repair commit, and resolve the thread.
- The finding is incorrect or belongs elsewhere: change nothing, reply with
  specific reasoning, and leave the thread open for a human.

When a repair lands, the fixer explicitly re-dispatches the review. When every
thread is declined, it posts that a human decision is needed and pauses.

## Termination

A clean review creates no actionable review event, so the fixer does not run
again. If the loop cannot converge within the configured cycle cap, it escalates
and stops. In both cases the pull request remains for a human to merge or reject.

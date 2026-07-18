# Strategy

Condensed, judge-corrected strategy for Latch. This is the "why the product is shaped
this way" document. For the product surfaces read [PRODUCT.md](./PRODUCT.md); for the
money read [PRICING.md](./PRICING.md); for the mechanics read
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Positioning

**Latch is independent adversarial triage-and-autofix for the agent-PR firehose.**

Coding agents open PRs faster than anyone can review them — a swarm of Devins, Codex
jobs, Copilot agents, and Cursor background agents can produce 50 PRs by 7am. The one
scarce resource left is *judgment about whether a diff is safe to merge*. The market's
answer so far is "let the author-agent review or fix its own work" — the one thing
that provably does not work, because an agent reviewing its own PR runs on the same
weights, the same context, and the same blind spots that produced the bug. Its errors
are **correlated with the code's errors**. A separate reviewer — its own context, its
own adversarial doctrine, and (the knob that makes it real) a model *unlike* the
author-agent — decorrelates that error and catches the class of bug where CI is green
and the product is still wrong.

The proof, told honestly: a generated math drill sorted its answer choices so the
correct answer was always the middle tile, and a five-year-old learned to just tap the
middle every time until a parent reported it. Green CI could never see it. An
adversarial, independent reviewer with the repo's doctrine did. That is the wedge —
**Latch catches what green CI cannot** — and the loop closure (review → fix →
re-review → converge, then stop) is what makes it a *gate* rather than one more opinion
in the thread.

The segment is **teams whose acute pain is agent-authored PR volume** — the
AI-*adopted*, not the AI-curious. The first user is the senior/staff engineer
personally losing to their own agents' review queue.

## The three corrections (adopted)

These come from an adversarial review of the original plan. They are load-bearing;
do not quietly revert them.

1. **Demote the two highest-liability heroes from v1 defaults.**
   The original plan made a *required* check and a *fix-pushing* bot the product's
   heroes. Both are the fastest path to uninstall: a required check controlled by a
   probabilistic agent is a **self-DoS** (one false `DO-NOT-MERGE` on an urgent,
   correct PR blocks the team, and the VP Eng rips it out that afternoon), and a
   hosted app pushing agent-generated commits into thousands of stranger repos is an
   **uninsurable liability**. So: the verdict ships as a **non-blocking commit
   status by default**, and the enforcement (required check) and the push (vs.
   suggested change) are **per-repo opt-ins a team turns on after seeing its own
   false-positive rate.** This keeps the marketing story while removing both
   uninstall triggers.

2. **Make independence real and measured.**
   "Independence" is theater if it is the same model weights invoked twice with a
   different prompt — that decorrelates *some* error but is weaker than "independent"
   implies. Fix: ship a **model-independence knob**, default the reviewer toward a
   model family *unlike* the customer's author-agent, and recommend the mismatch.
   And build the **escaped-bug / false-negative metric as a core artifact** — a catch
   rate with a denominator, not a survivorship reel. Independence you can't prove is
   theater; confidence you can't measure is comments.

3. **The doctrine library is the moat — lead with it, not the feature table.**
   Every feature (bounded loop, fixer-that-refuses, per-hop audit) is copyable by a
   funded incumbent in a quarter. The one durable, solo-defensible asset is a
   growing, community-contributed **corpus of falsification tactics and landmine
   packs** — a data moat that lives in the policy, not the model. The OSS launch is a
   *community doctrine corpus*, not just a free copy of the loop.

## What we do NOT claim

- **We do not sell "merge confidence."** The loop never underwrites a merge. Selling
  "which of last night's 50 PRs are safe to merge?" while refusing to say anything is
  safe enough to merge is a structural contradiction. What we sell is **review-load
  reduction and triage**: clear the mechanically-verifiable debris, rank the firehose
  by risk, auto-fix the trivial, escalate the judgment calls to a human.
- **Latch is not an auto-merger.** It converges and stops. A human always merges.
- **Latch is not a PR-authoring agent.** We gate what Devin/Codex/Copilot produce;
  staying on the review/fix side is what keeps us the *independent* party.
- **Not a merge queue** (Graphite's lane — we post a status the queue can consume),
  **not a generic linter/SAST** (we catch green-CI-but-wrong via doctrine, not rules),
  **not a chat-with-your-codebase Q&A** (Greptile's lane), **not MCP-first** (the
  pre-PR inner loop is phase 3), and **not multi-forge at launch** (GitHub only).
- **We do not assert market stats as fact without a citation.** The demand narrative
  in the source corpus (review-time studies, agent-PR papers, competitor pricing) is
  plausible but must carry real citations before it goes in front of anyone who
  diligences.

## Competitive summary

No shipped product owns a **bounded, identity-separated, self-terminating
converge-to-mergeable loop with a fixer that can refuse.** CodeRabbit (Autofix +
re-review), cubic (agent fixes + auto fix-PRs), GitHub Copilot review, and Anthropic's
managed Code Review are the closest — all do **review plus a one-directional fix
handoff**, none run *review → fix → re-review → stop-when-satisfied* as a first-class,
auditable primitive with a cycle cap, human escalation, anti-tamper governance, and a
fixer with standing to disagree. Greptile, Qodo/PR-Agent, Ellipsis, Sourcery, Korbit,
Baz, and Cursor Bugbot are review-only or review-plus-suggestions.

The durable moats, in order: (1) the **doctrine corpus** as a compounding,
community-contributed data asset; (2) the **independence brand** — "the gate that is
never your author-agent and never keeps your code" — which the structurally conflicted
platform vendors (GitHub/Copilot, Cursor/Bugbot review Cursor's own code) cannot copy
without cannibalizing their author-agents; (3) speed and narrowness in the
agent-authored-PR segment before incumbents generalize into it. The honest read on
threats: if GitHub bundles a "good enough" adversarial gate for free, Latch lives in
the independence + doctrine + multi-forge / BYO-model / air-gapped tail — a smaller but
real and defensible business. A solo founder's win condition is a defensible niche or
acquisition, not beating CodeRabbit at horizontal scale. Plan to *be* that from day
one (OSS layer first, GitLab next).

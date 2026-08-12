# Operating the loop

[ARCHITECTURE.md](./ARCHITECTURE.md) says how the loop is wired. This page says what
it does when it goes wrong, and how a human drives it to a stop.

Everything here is field notes: failure modes observed while the engine ran as the
merge gate on a production monorepo, and the operating protocol that came out of them.
None of it is hypothetical, and none of it is guesswork about what *might* break — a
bounded review⇄fix loop fails in a small number of specific ways, and each one has a
tell and a remedy that are worth knowing before you meet them at 1am.

The single rule underneath all of it: **the loop's records must never outrun what is
on the branch.** Every mechanism below is that rule applied to one more surface.

---

## Reading a fixer run

A fixer run ends in exactly one of five states, and the PR comment names which. The
distinctions are not cosmetic — two of them have *opposite* remedies.

| State | What the PR says | What it means | What you do |
|---|---|---|---|
| **fix-cycle N** | "Pushed `<sha>` and re-dispatched the review" | The commit is on the branch and verified there. Threads it fixed are answered and resolved. | Nothing. Wait for the re-review. |
| **no code change** | "The fixer judged the open threads as needing a human decision" | Every finding was refused or handed off. The threads stay **open** — a reply is not a fix. | Read the refusals. Decide. |
| **could not push** | "Nothing was pushed… the fix existed only on the runner" | The push was rejected (branch protection, a token without write, or a rebase conflict with a competing push). Nothing landed. | Re-run the fixer, or redo the fix by hand on the current branch. |
| **pushed but unverified** | "The push was accepted, so **the commit is on this branch**" | The push landed but the verifying fetch never came back, so the job refused to quote a sha it had not proven. No thread was answered; no cycle was consumed. | **Check the branch first.** A blind re-run duplicates work that already landed. |
| **errored / cancelled** | "…before completing" | Something else broke: the agent, the runner, the wall clock. The comment tells you whether the push had already happened. | Read the run log. Then treat it as the state the comment names. |

The last two exist because collapsing them is a real cost, not a style preference.
Telling a human "nothing landed" when the fix is on the branch sends them to re-derive
work that already exists; telling them "it landed" when it did not sends them to review
a commit nobody can find. If you extend the fixer, keep those two states apart.

---

## Failure modes

### 1. The phantom fix

**The pattern.** The fixer replies "Fixed in `<sha>`" to every thread and resolves
them, then dies before its push lands — turn cap, timeout, cancellation, a rejected
push. What remains is a PR whose every thread reads as handled, resolved, and dated to
a commit that exists nowhere. The next agent to look at it re-derives the entire fix
from scratch, and any merge gate keyed on thread resolution reads the PR as clean.

**Why it is not a prompt bug.** The prompt already forbade it. Prompts are advisory:
they describe what should happen, and a run that dies mid-way does not read them again.
Anything an agent can do *before* the push can outlive a run that never gets there.

**The remedy, which is ordering rather than diligence.** The agent writes a reply
**plan** and posts nothing. The job pushes, verifies the commit is an ancestor of the
remote branch, and only then replays the plan into replies — minting the "Fixed in
`<sha>`" prefix itself, from the sha it actually pushed. If the push fails, not one
reply is posted.

Two details make it hold rather than merely sound good:

- **Both channels are guarded, not just the minted one.** A refusal reply is posted
  verbatim, so an agent that writes "already fixed in abc1234" into one republishes the
  exact phantom string on a run that committed nothing. Any body that dates its own
  claim to a commit is dropped and recorded in the step summary. Minting a commit claim
  is the job's privilege because only the job knows what was pushed.
- **The repair rail stays.** Prevention covers the channel it owns; the settle step
  still runs afterwards and re-opens any thread resolved without a landed fix behind
  it, with a correction posted on the thread. A rail that only fires once prevention
  has been bypassed earns its runtime on the day it fires.

It also buys turn budget back — two API calls per thread come off the agent's ledger —
which makes the turn-cap death that produces phantom fixes less likely in the first
place.

### 2. The fixer's push strands your CI in `action_required`

**The tell.** The fix lands, the re-review runs, and the PR's other checks sit
unstarted, greyed out, labelled *action required* — with no failure anywhere to explain
it.

**The cause.** GitHub gates workflow runs on pull requests from certain actors behind a
manual approval. A bot-authored push can land in that bucket, and then the repo's own
CI never starts. Nothing is broken; nothing will happen either.

**The remedy.** Approve the stranded run:

```bash
gh api --method POST repos/<owner>/<repo>/actions/runs/<run-id>/approve
```

Any subsequent human push to the branch releases it too. If you hit this often, look at
the repo's *Actions → Fork pull request workflows / approval* settings rather than
approving one run at a time.

**Why it matters beyond the annoyance:** a stranded check is not a failing check. If
you are judging "is this PR converged?" by glancing at the checks list, `action_required`
reads as *pending forever* and you will wait on something that is never coming.

### 3. The fixer cannot compile your stack

Latch is a generic gate: the runner installs no project toolchains beyond what the base
image ships. Your fixer may be editing code it cannot build.

That is a deliberate trade — a fix that is reasoned but unbuilt still beats a finding
nobody actions, and the re-dispatched review plus the human merge are the backstop —
but it is only safe if it is **declared**. A reader cannot tell the difference between
"I ran your test suite" and "this looked right to me," and will assume the stronger one.

So require the fixer to state its **verification level** in every fix reply:

- **checks pass** — the policy's check command for that path ran, and was green.
- **parse/type only** — a parser, formatter or type-checker ran; the real suite did not.
- **unverified here** — no toolchain on the runner; reasoning only.

Three words per reply, and they change how the human merging reads the PR. Never let a
reply imply a check that did not run: a fix that *sounds* verified and is not is how an
unactioned finding gets closed.

### 4. The reviewer dies at its turn cap — and looks clean

**The tell.** A review run that goes red, or even green, having posted **nothing**.

**Why it is dangerous.** The loop's termination condition is "a clean review posts no
findings, so no event fires, so the fixer does not run." A review that *died* also posts
no findings. From the outside, a reviewer that ran out of turns is indistinguishable
from a reviewer that found nothing — and it terminates the loop in exactly the same way,
silently, with the PR looking converged.

Related shape, same lesson: an agent action can return a *successful* result envelope
carrying `is_error: true` — an allowance exhausted, a first call rejected in half a
second. Anything keyed off the step's outcome reports the gate as fine.

**The remedies.**

- Publish an engine status alongside the verdict, so "the reviewer ran and said
  nothing" and "the reviewer never really ran" are different marks on the PR.
- **Never conclude "the review is done" from the checks list alone.** Read the verdict
  status, and if you are automating on top of the loop, read the review run's own
  result — not the presence or absence of comments.
- Raise the turn cap when you see it, and raise the wall clock with it (below).

### 5. Timeouts and cancellations, which are not failures

Exceeding a job's `timeout-minutes` **cancels** it, and a cancellation satisfies neither
`success()` nor `failure()`. A reporter conditioned on failure alone never runs, so a
fixer that ran out of wall clock posts nothing at all and the loop stalls with no signal
to anyone. Condition on `failure() || cancelled()`, and say which one it was.

Calibration, so the two caps stay in step: **a turn costs roughly 10-13 seconds**, plus
a minute or two of job setup. A cap of 60 turns is therefore a ~15-minute run before any
job-side work. Raising the turn cap without raising the timeout does not buy a longer
run — it moves the failure from a loud turn-cap error to a silent cancellation, which is
strictly worse. Raise them together.

The expensive moment for a cancellation is *after* the push, during the reply replay:
the fix is on the branch and the threads are half-answered. That is why the failure
reporter consults the push state before it describes what landed.

### 6. A burst of review events is a burst of fixers

Inline comments from one review arrive as several events over a minute or two. Two
levels of concurrency, and both are needed:

- The **guard** carries a burst filter (cancel-in-progress). It holds the group for the
  ~20 seconds of its API calls and then releases it, so it only collapses events that
  arrive inside that window. On its own it does **not** reduce a PR to one fixer.
- The **fix job** carries serialisation with **cancel-in-progress: false** — queue,
  never cancel. A newer review event killing a fixer mid-push is the exact failure this
  prevents, so freshness is never worth trading for it.

Queued runs then discover there is nothing left to do, which is why the fix job's first
step re-asks the question before the checkout: *pending* threads, not merely unresolved
ones. A thread the fixer already pushed back on is answered, not pending; a human's
reply after that push-back makes it pending again. A run with nothing pending exits
green in seconds, without a checkout, an agent, or a PR comment.

### 7. The cycle cap

The loop is bounded: after N fixer cycles on one PR it stops and escalates, naming the
author and saying what it could not settle. A cycle is consumed only when a fix actually
lands, so refusals and failed pushes do not burn the budget.

Reaching the cap is information, not a malfunction. It means the reviewer and the fixer
disagree in a way neither can resolve — read the open threads and decide; that is the
job the cap exists to hand you.

---

## Converging a PR: the termination protocol

A bounded loop still needs an operator's judgement about *when it is done*. Left to run,
a review⇄fix loop does not converge on its own — each round's diff is new code, new code
attracts new findings, and a sufficiently skeptical reviewer always has something to say.
Termination is a decision, and these are the rules that make it a defensible one.

**1. The severity gate belongs to you, not to the reviewer.** An adversarial reviewer is
tuned to find things; asking it to also decide which of its findings are worth blocking a
merge is asking it to mark its own homework. Take its findings as *input*, and apply the
bar yourself: what would make you revert this on Monday? Everything above that line gets
fixed this round. Everything below it goes to the ledger (rule 4).

**2. Termination rounds are minimum-diff.** Once you have decided to converge, the
remaining rounds fix *only* what is above the bar — no refactors, no drive-by cleanups,
no "while we're here". Every extra line is new surface for the next review, which is how
a two-round convergence becomes a six-round one. If a finding is real but not blocking,
it is a follow-up, not a hunk.

**3. The final round is not auto-re-reviewed.** Re-dispatching the review after the last
fix restarts the loop by construction. End it deliberately: apply the last fixes, then
**read the final diff yourself** and merge on your own judgement. The loop's job was to
get the PR to the point where that reading is short — not to grant permission.

**4. Pre-existing problems go to a ledger, not into this PR.** A good reviewer finds
things the PR did not introduce. They are worth recording and worthless to fix here:
they expand the diff, invite more findings, and hide the change under review. Write them
down where the team looks — an issue, a landmine pack, the policy file — and move on. A
finding that leaves the PR must land somewhere, or "out of scope" is just a way of
losing it.

**5. A push-back needs new evidence, not a restatement.** When the fixer refuses a
finding, the reviewer may only re-raise it with something *new*: a concrete failure
scenario, a line of code, a counterexample. Repeating the original claim more firmly is
how a loop thrashes. The same rule binds you as the operator: if you overrule a refusal,
say what you are seeing that the fixer was not.

**6. One termination round, then escalate.** If a round meant to close the PR does not
close it, stop looping and take the decision by hand. Two agents that could not agree in
N rounds will not agree in N+1, and every extra round costs a review, a fix, and a diff
that grows. The cycle cap enforces the outer bound; this is the discipline that means you
rarely reach it.

---

## An operator's checklist

Before you call a PR converged:

- [ ] The verdict status is present, and it is the *current* head's — not a stale one.
- [ ] The review that produced it actually ran; a review that died posts no findings
      and looks identical to a clean one.
- [ ] Every open reviewer thread is one you have read. Open is the honest state for a
      refusal — it is not a leftover.
- [ ] Every resolved thread names a commit that is on the branch. (The loop enforces
      this; verifying it costs one click and is the whole trust story.)
- [ ] Fix replies declare their verification level, and you have believed them
      accordingly.
- [ ] No check is sitting in *action required*, mistaken for pending.
- [ ] You have read the final diff yourself.

Then merge it. Latch never will.

# Pricing

How Latch makes money: the license that protects a solo founder, the unit economics
that keep margin honest, the packaging, and the billing rails. Ported from the
monetization brief, trimmed to the adopted decisions.

## License: FSL-1.1-Apache-2.0

Latch is **FSL-1.1-Apache-2.0** (Sentry's Functional Source License) — see
[LICENSE.md](../LICENSE.md). Every feature is public and self-hostable free; the only
thing forbidden is a competitor reselling it as a competing hosted product; and each
release **converts to Apache-2.0 after two years.**

Why FSL and not the alternatives:

- **Latch's entire product *is* the loop** — the directional identity-separated
  review⇄fix cycle, the anti-tamper guard, the bounded cycles, the fixer with standing
  to disagree, doctrine-as-policy. Under MIT/Apache, a funded competitor or a cloud
  vendor could host the exact loop and out-distribute a solo founder overnight — the
  one outcome we cannot survive.
- **AGPL is a friction moat, not a wall** — it forces source disclosure on network use
  but does *not* forbid resale, and it scares some enterprise buyers off self-hosting.
- **FSL bans exactly the one thing that kills us (a competing hosted product)** while
  keeping every feature open and auto-converting in two years — maximal community trust
  with zero enforcement bandwidth, decisive for a one-person shop. Sentry proved FSL
  doesn't suppress revenue; Redis's SSPL→Valkey-fork→AGPL-revert saga is the
  cautionary tale that heavy source-available licenses alienate.

## Unit economics — why price tracks cost

A converge loop is structurally **3–7× the cost of single-pass review**, so you cannot
copy CodeRabbit's ~$24 seat and hold a healthy margin if every PR runs a full loop on
a top-tier model. Three levers make it work, and all three are used:

1. **Prompt-cache the repo snapshot + doctrine across hops.** The stable prefix
   (repo context, landmines, doctrine) is identical across review → fix → re-review and
   cacheable even across separate runs; hops after the first pay a fraction on it, and
   the re-review of a small fix-delta is nearly free.
2. **Tier models.** Run the *doctrine review* (the differentiator — the pass that
   catches the middle-tile bug) on a strong model; run triage, the fixer, and delta
   re-reviews on a cheaper one. Roughly halves blended cost.
3. **The loop only fires when there are findings.** A clean PR is a single pass and
   terminates; most PRs are clean.

Realistic blended cost per gated PR, on your own key:

| Scenario | Blended cost / gated PR |
|---|---|
| Clean PR, single pass (cached, cheap triage model) | ~$0.30–0.60 |
| Typical dirty PR, full loop (cached + tiered) | ~$1.50–3 |
| Heavy PR (large diff, several cycles, top model throughout) | ~$8–15 |

> These are cost *ballparks* from the source analysis, sensitive to model prices and
> cache pricing; treat them as order-of-magnitude, not a quote. The cap-3 cycle limit
> is the cost circuit-breaker on the tail.

## Packaging

The headline metric is **per active repository / month with an included gated-PR
allowance, then metered per-gated-PR overage** — not per-seat (agents have no seats, so
seat pricing structurally undercharges the exact customer with the most acute pain) and
not pure per-PR (the market punishes raw usage meters — Greptile, Copilot, and Cursor
all drew backlash). Per-active-repo + allowance is a predictable unit that scales with
the customer's surface area and doesn't penalize adding agents, while overage on the
true value unit (a gated PR driven to mergeable) keeps price tracking cost on the tail.

### Free / OSS — $0 · metric: none (BYO key)

- The **complete** loop, FSL-licensed — self-host in your own GitHub Actions.
- Bring your own Claude API key or subscription OAuth token — you pay inference
  directly.
- Everything that matters: directional identity-separated loop, anti-tamper guard,
  cycle cap + human escalation, the fixer that can push back, community doctrine packs.
- No hosted dashboard, no cross-repo policy, no SLA — you run it.

### Team (hosted) — $49 / active repo / mo, incl. 25 gated PRs, then $8 / gated PR

- **Install the GitHub App — zero config.** We run reviewer + fixer on our inference;
  no token, no workflow YAML.
- **Bundled inference** (model tiering + repo-cache handled for you) — or flip to
  **BYOK for a discount** and zero inference markup (privacy/cost-sensitive teams).
- Org dashboard: per-hop loop timeline, convergence rate, the escaped-bug /
  false-negative metric, "which of last night's PRs are mergeable."
- Editable review doctrine — turn your `CLAUDE.md` landmines into per-repo policy.
- Verdict **non-blocking by default**; required-check and silent-push are opt-ins.

### Enterprise — custom

- SSO / SAML + RBAC; org-wide policy governance (one doctrine, enforced across every
  repo).
- Managed policy packs + full per-hop audit-trail export with retention (every hop is
  already a discrete, auditable run — 1:1 to a compliance record).
- Self-hosted licensed deployment (run the plane in your VPC on your own key) or a
  dedicated hosted inference pool.
- SLA + priority support; the "converge-then-a-human-always-merges" trust posture
  documented for auditors. The compliance/audit angle is the real upgrade driver.

## The free/paid boundary — the rule

> If a feature runs inside a single repo's CI on the user's own compute and their own
> inference key, it's **free/OSS**. If it requires *our* servers, *our*
> inference/billing plane, or state that spans repos or an org, it's **paid**.

This keeps the community edition genuinely complete-per-repo (no "not really open"
backlash) and guarantees the loop itself — the entire differentiator — stays free,
while everything only *we* can operate stays paid. A new reviewer heuristic is free;
org-wide enforcement of it across 200 repos with an audit trail is paid.

## Billing rails

Install as a **GitHub App** for the integration (and list on Marketplace *for
discovery*, the CodeRabbit-proven top of funnel) — but **bill through our own Stripe**,
not Marketplace billing, because per-active-repo + allowance + per-gated-PR overage +
a BYOK discount are shapes Marketplace's fixed plans can't express. Meter per hop /
per gated PR (each hop is already an auditable run, so the billing event maps 1:1 to
something countable). Wrap Stripe in a **merchant-of-record** (Polar, GitHub-native, or
Lemon Squeezy) so a solo founder never touches global VAT/sales tax; Lago is the OSS
metering fallback if we outgrow Stripe's meters. No sales team required: self-serve
install, usage grows with the customer, no seat negotiation.

> **v0 reality (2026-07-18).** The Stripe + merchant-of-record path above is the
> *scale-up* plan, not v0. The owner's chosen **v0 rail is Razorpay**, on an existing
> account: create a **Razorpay Payment Page priced in USD** and wire its URL into the
> site's gateway-agnostic `PAYMENT_LINK_URL` config. **Enable international payments
> first** — Razorpay gates cross-border collection behind an approval with real lead
> time, so start that approval early. The Stripe-metered + merchant-of-record rails
> here take over once per-gated-PR metering and automated global tax actually bite.

## First-dollar path

1. **Lead with the story.** The middle-tile-bug post paired with the "50 PRs from the
   agent by 7am — which are mergeable?" framing, on HN / Lobsters / dev.to. $0 top of
   funnel. See the launch runbook in the private ops repo
   `github.com/nishantkumar1292/latch-ops`.
2. **The OSS repo (FSL) is the funnel** — free self-hosters cost nothing and become
   the pipeline; the doctrine corpus they contribute compounds the moat.
3. **Convert the self-hosters who hate managing the token/workflow → hosted** — that
   friction is exactly what the hosted product removes. (Honest caveat: this is the
   *weakest* conversion trigger; real conversion comes from cross-org governance +
   audit + fleet-inference economics that only bite at team scale. Model the HN crowd
   as *proof*, not *revenue*.)
4. **Target teams already running coding agents** — they have the acute volume and the
   budget.
5. **List on Marketplace for discovery**, bill via Stripe.
6. **Design-partner 3–5 mid-size teams** with heavy agent-PR volume for logos and a
   hard metric (a real "PRs mergeable without a human touching them" number, with a
   denominator).
7. **Land and expand by repo, not seat** — start one busy repo cheap, prove
   convergence, expand across the org; enterprise (SSO/audit) closes once the org has
   10+ repos on it.

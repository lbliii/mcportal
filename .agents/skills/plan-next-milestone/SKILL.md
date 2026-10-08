---
name: plan-next-milestone
description: Research and replenish MCPortal's rolling milestone horizon when a milestone completes, the prepared buffer falls below two, or a planning request is pending.
---

# Plan the next milestone

Read `docs/how-to/planning-flywheel.md` from the repository root. Run `npm run planning:check`; its JSON is the current inventory, not a mandate to create a new milestone. A healthy horizon with no pending request needs no publication.

The scheduled coordinator is the sole publisher. Delivery agents dispatch the GitHub `planning-horizon.yml` workflow; do not publish in parallel. The coordinator resumes any request, ownership record and draft manifest before creating work. It may delegate code/product/UX research to a sub-agent; keep GitHub writes in the coordinator. Do not spawn a new sidebar chat on every poll.

Use current main, open PRs, completed milestone evidence and current primary web sources. Anchor journeys in developers and researchers who already use agents. Preserve the mission: a coherent content platform inside the agent, with shared reading, knowledge, documentation, content-dashboard and light social contracts. Audit what exists before proposing what is missing.

Prepare at most one milestone per pass. Refine the earliest draft before adding a later outcome. Apply the guide's readiness rubric and keep uncertainties explicit. Use research tasks when evidence is insufficient for an implementation decision. Recheck the horizon before publishing; preserve stable manifest keys across retries. Mark a milestone ready only after all issues, parents, blockers and evidence links are verified live.

If access, evidence or a decision blocks completion, checkpoint the request with the exact next step. Leave the draft unready. Report a new actionable blocker once; do not reopen the same question every hour or manufacture backlog to meet a number. When the buffer is restored, close the planning request with links to the resulting milestone and decision evidence.

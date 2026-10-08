# Working on MCPortal

Follow `CONTRIBUTING.md` for architecture conventions and required checks. GitHub Issues, native sub-issues, dependencies and milestones are the execution backlog; see `docs/how-to/track-work.md`.

## Keep the planning horizon supplied

After completing a milestone, changing its scope, or finishing its last task, run `npm run planning:check`. The earliest open managed milestone is the planning focus; parallel delivery remains allowed. Keep a minimum of one and a target of two prepared milestones ahead.

For a planning deficit or an open planning request, use `.agents/skills/plan-next-milestone/SKILL.md`. The scheduled planning coordinator owns publication; delivery agents dispatch `gh workflow run planning-horizon.yml --repo lbliii/mcportal` and leave the request for that coordinator. Do not start competing publishers. The coordinator may delegate a bounded research pass to a sub-agent, retaining issue creation itself.

Read `docs/how-to/planning-flywheel.md` for readiness, research, retries and completion. Existing authorization covers researching and filing the rolling backlog. It does not require asking again for each milestone. Close delivery milestones only after their exit evidence is satisfied; an issue count alone is insufficient.

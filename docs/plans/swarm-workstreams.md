# Main-targeting implementation workstreams

Started 3 October 2026. Each workstream uses a separate managed worktree and branch,
with a PR targeting `main`. Shared contracts require coordination before editing.
Local `main` already contains the delivery roadmap commit; the launch branch preserves
it rather than replacing or discarding it.

| Stream | Branch | Owned area | First deliverables |
|---|---|---|---|
| Privacy and data handling | `codex/swarm-data-privacy` | Account exports, auth/files/link transport, shared-source metadata | Session-bound export/import links, complete exports, least-privilege GitHub sign-in, HTTPS/private files, shared-cache privacy, HSTS |
| Reading and layouts | `codex/swarm-reading-layouts` | Room UI and browser tests | Continue Reading, docs resume/completion, inline columns/shelves controls, optional provenance rendering |
| Search | `codex/swarm-search` | Clip Postgres schema/query, docs search adapters/tools, cache | Ranked full-text clips with literal fallback; content search across fresh cached docs pages |
| Launch operations and integration | `codex/swarm-launch-readiness` | Operations probe/runbook, Railway IaC, plan reconciliation | Read-only availability probe, preserved signup/budget settings, deployment/recovery procedure, combined validation |
| Protocol readiness (following wave) | `codex/swarm-protocol-assessment` | Protocol evidence report and bounded core telemetry | Verify official specification, correct migration assumptions, observe protocol/known-host categories without logging raw client data |

The privacy stream owns server provenance changes; the UI stream handles absent
metadata; search handles its docs tool output. Search alone owns schema migration
versioning in this wave. Package/release files and shared planning status stay with
integration. A PR records actual tests and limitations rather than treating a skipped
database/browser check as successful.

`codex/swarm-integration` locally assembles the five streams and reconciles optional
docs provenance with UI rendering. It preserves the individual branches. Publication
is pending explicit approval of the repository destination after automatic approval
review rejected the first push; no branch has been pushed by this swarm yet.

## Following work

The next available workers can take these independent areas once the first contracts
are stable:

- Watches: artist resolution, user-owned watch storage, coarse location and the Shows
  source, then scheduled-agent reported-state tracking. Ticketmaster access and current
  provider requirements must be verified before a live-integration claim.
- Protocol compatibility: protocol readiness now has its own branch. Use its verified
  assessment and real observations before implementing the 2026 path; keep the existing
  protocol working. Telemetry alone does not constitute a compatibility certification.
- Public/reviewer onboarding: isolated reviewer roles, login, social sandbox and seed
  script; public invites and signup rollout after operational readiness.
- Labs: real-host certification and two weeks of reblog/frontpage/river use before
  enabling them for everyone or choosing a new default.
- Retrieval expansion: unified saved/clip/history search, collections and related
  material after the current search foundation.

Billing, licensing, domain selection, directory submissions, open-sourcing, permanent
archives and live infrastructure rollout depend on decisions or external verification.
They remain visible in the source plans; producing a branch does not mark them shipped.

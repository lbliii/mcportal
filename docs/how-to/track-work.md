# Track work with GitHub Issues

Use [issues](https://github.com/lbliii/mcportal/issues) as the live execution backlog. The repository uses native parent/sub-issue relationships, blocking dependencies, milestones and labels. A separate Projects board is intentionally deferred.

The initial backlog was reconciled against main at `75e8e24` on 8 October 2026. Read the [code audit](../research/content-platform/current-baseline.md) for implemented capabilities, verified findings and architectural priorities. The [original research](../research/content-platform/README.md) is historical context, not a list of missing features.

## Epic index

| Outcome | Tracking issue |
|---|---|
| [Validate the content platform with agent-using developers and researchers](https://github.com/lbliii/mcportal/issues/103) | #103 |
| [Make reading and agent handoffs dependable across hosts](https://github.com/lbliii/mcportal/issues/104) | #104 |
| [Preserve and retrieve attributable evidence over time](https://github.com/lbliii/mcportal/issues/105) | #105 |
| [Establish evidence for dependable hosted and plugin delivery](https://github.com/lbliii/mcportal/issues/106) | #106 |
| [Extend source archetypes through shared content contracts](https://github.com/lbliii/mcportal/issues/107) | #107 |
| [Keep personal Spaces and sharing clear and trustworthy](https://github.com/lbliii/mcportal/issues/108) | #108 |
| [Harden shared boundaries for sustainable platform growth](https://github.com/lbliii/mcportal/issues/109) | #109 |

## Choose the right issue

| Kind | Use it for | Required result |
|---|---|---|
| Bug | A reproducible difference from expected behavior | Reproduction, expected/actual behavior, environment and impact |
| Feature | A proposed user outcome | User problem, desired outcome, evidence and alternatives |
| Task | A bounded implementation or verification change | Scope, observable acceptance criteria, validation and dependencies |
| Research | An uncertainty that affects a decision | Question, evidence/hypotheses, method and a decision artifact |
| Epic | Several tasks delivering one user outcome | Current baseline, scope, exit evidence and native sub-issues |

Keep issues short enough to act on. Link relevant code, plans and existing PRs; distinguish implemented behavior from missing behavior. Do not prescribe a rewrite when an extension of an existing contract will work. For research, closure means a supported decision and follow-ups, not necessarily a new feature.

## Use milestones for outcomes

The [milestones](https://github.com/lbliii/mcportal/milestones) describe four delivery outcomes:

| Milestone | Exit direction |
|---|---|
| M1: Prove the core content loop | Developers and researchers can use and recover evidence across reading and agent interaction; host and accessibility evidence supports the claim. |
| M2: Strengthen durable evidence and retrieval | Measured search quality, robust source targets, atomic persistence and explicit shared boundaries. |
| M3: Qualify reliable public delivery | Dated operational recovery, monitoring and installation/upgrade evidence, with current directory-readiness decisions. |
| M4: Extend validated content workflows | Selected source/social workflows inherit shared contracts and have a clear user need. |

These are outcome groups, not package versions or a promise that all work happens serially. Use issue dependencies for real ordering. Dates and individual assignees remain unset until there is a commitment; claiming an issue is an explicit ownership action.

## Labels

Keep existing repository labels. The added taxonomy has three independent dimensions plus triage:

| Dimension | Labels | Rule |
|---|---|---|
| Work kind | `type:epic`, `type:task`, `type:research` | Choose the applicable kind; existing `bug`, `enhancement` and `documentation` remain useful classifications. |
| Area | `area:reading`, `area:knowledge`, `area:agent-host`, `area:sources`, `area:social`, `area:design`, `area:data`, `area:delivery` | Prefer one primary area; add another only when it aids routing. |
| Priority | `priority:high`, `priority:normal`, `priority:low` | High is next focus or a milestone gate; normal is planned; low is later exploration. These are not incident severities or due dates. |
| Intake | `needs-triage` | New forms apply this label; remove it after checking duplication, scope and routing. |

Do not duplicate open/closed state in labels. Use native blocked-by relationships instead of a manually synchronized blocked label. Do not mark work `good first issue` until it has a small, verified scope and enough starting context.

## Triage and execution

1. Check current main and open PRs. Reuse or link existing implementation before creating a new task.
2. Identify the user outcome and acceptance evidence; split an oversized issue into sub-issues.
3. Set its primary area, priority and appropriate milestone. Add a parent and real blockers where relevant.
4. Remove `needs-triage` when it is actionable. Assign only when someone takes responsibility.
5. In a PR, use `Closes #N` only when the issue's full acceptance criteria are met. Use `Related to #N` otherwise.
6. Close an epic after its sub-issues and outcome evidence are complete. A merged implementation can still need host, operational or user validation.

Link comments and evidence when a decision changes. A duplicate issue can point to the retained issue and close with an explanation; do not silently delete history. Reconcile old PR candidates explicitly rather than merging overlapping branches independently.

## Pull requests and templates

The default [PR template](../../.github/pull_request_template.md) asks for the problem/result, related work and actual validation, with an optional compatibility/rollout section. Delete irrelevant instructions and scale the prose to the change. Small changes should remain small descriptions.

Follow [CONTRIBUTING](../../CONTRIBUTING.md) for checks. Report passes, skips and limitations distinctly; a fixture is not host certification. Storage changes need the relevant Postgres/linked/export/deletion checks, and public tool changes need the compatibility policy. Screenshots or short recordings should demonstrate meaningful visible changes, not decorate every PR.

The [issue forms](../../.github/ISSUE_TEMPLATE) ask for only the information needed to act on each kind of work. Blank issues remain available for unusual cases. No default assignees, deadlines or personal contact details are imposed. Templates become active through GitHub's normal default-branch behavior after this configuration is merged.

This setup follows GitHub's documented support for [sub-issues, dependencies and a single source of truth](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects), [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms), and [PR templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository).

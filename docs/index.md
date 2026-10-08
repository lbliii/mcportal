# MCPortal documentation

Pick the kind of page that fits what you're doing: learning, getting a task done, looking something up, or understanding why.

These docs follow `main`. Features marked [Unreleased](../CHANGELOG.md#unreleased) may be ahead of your hosted deployment or plugin version; see [releases](https://github.com/lbliii/mcportal/releases). For a quick introduction, [watch the 22-second tour](https://mcportal.lol/site/launch.mp4).

## Tutorials: learn by doing

For newcomers who want to see MCPortal work.

- [Getting started](tutorials/getting-started.md): install the plugin, build a room, read, save and clip, and open a project's docs.

## How-to guides: get a task done

For people who know what they want and need the steps.

- [Install](how-to/install.md): a copyable agent setup prompt, remote and local host options (Claude Code, Cowork, Claude desktop, Codex), ghost mode vs signing in, updating and uninstalling.
- [Customize your Space](how-to/customize-space.md): cover, format, public page and RSS, audiences, discovery and automatic sections.
- [Organize reading](how-to/organize-reading.md): find kept material, make desks, compare sources, follow trails and finish a finite catch-up.
- [Watch reading and events](how-to/watch-reading.md): page changes, repository releases, public calendars and verified artists.
- [Follow stores](how-to/follow-stores.md): preview and confirm supported Shopify follows, check Shop and manage scope.
- [Self-host](how-to/self-host.md): run your own MCPortal on Railway.
- [Administer](how-to/administer.md): accounts, invites, suspension, the `/admin` page and admin CLI.
- [Operate](how-to/operate.md): deploys, rollback, restore and incidents on a hosted instance.
- [Release](how-to/release.md): cut a new version.

## Reference: look it up

For anyone who needs exact names, limits and options.

- [Tools](reference/tools.md): every MCP tool, who can call it, and what it does.
- [Configuration](reference/configuration.md): every environment variable and CLI flag.
- [Data](reference/data.md): what's stored, where, for how long; export and deletion.
- [Host compatibility](reference/host-compatibility.md): which host capabilities the room uses and how it falls back.
- [Design system](reference/design-system.md): tokens, type, color and components.

## Explanation: understand why

For contributors and curious readers who want the reasoning.

- [Architecture](explanation/architecture.md): the pieces, how a request flows, and the shape of the tool surface.
- [Local and hosted](explanation/local-and-hosted.md): ghost, local, linked and hosted modes, and how storage works.
- [Security](explanation/security.md): threat model, auth, tokens, SSRF and the access gate.
- [Reading experiences](explanation/reading-experiences.md): Recall, desks, comparisons, trails, catch-up, Changes and Upcoming.
- [Reading](explanation/reading.md): reader view, docs portals, reading state, highlights and clips.
- [Social](explanation/social.md): Spaces, shares, reblogs, follows and room layouts.

## Project

- [Roadmap](plans/README.md): open work.
- [Changelog](../CHANGELOG.md): what changed in each release.
- [Contributing](../CONTRIBUTING.md) and [security policy](../SECURITY.md).

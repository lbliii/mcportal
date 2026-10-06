<p align="center"><img src="brand/readme-hero.svg" alt="MCPortal: your liminal webspace. A reading room inside your agent." width="100%"></p>

**A reading room that lives in your agent.** MCPortal gives you a room of portals onto sources you choose: Hacker News, GitHub, YouTube channels, subreddits, Bluesky, Mastodon, documentation sites, and any site with a feed. You ask your agent to arrange it, and it does. Articles open in a clean reader view with no ads.

MCPortal is an MCP server with an [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) interface, so the room renders inline in the agent you already use: Claude (desktop, web and Claude Code), Codex, or any MCP host that supports apps.

```
you:   /portal put GitHub on the left and add Simon Willison's blog
agent: arrange_room → find_source → add_portal → open_room
       ┌──────────────┬──────────────┬──────────────┐
       │ GitHub       │ Hacker News  │ Simon W.     │
       └──────────────┴──────────────┴──────────────┘
```

## What you can do

- Build a room from starter packs, then add any site, feed, channel or repo by asking.
- Rearrange it in plain words: "put GitHub on the left", "make the blog wider".
- Read articles and documentation in a reader view.
- Save links, and clip quotes, notes, tables and images from the conversation.
- Ask your agent what's new and worth reading across everything you follow.
- Share what you read on your own Space, and follow other readers.
- Export everything in standard formats: OPML, bookmarks, Markdown.

## Three ways to use it

| Way | What it means | Start here |
|---|---|---|
| Install the plugin | Runs on your computer. No account; your room lives in `~/.mcportal`. | [Install](docs/how-to/install.md) |
| Sign in to the hosted service | The same room on every device, plus sharing and following. Sign in with GitHub. | [Ghost mode or signed in](docs/how-to/install.md#ghost-mode-or-signed-in) |
| Host your own | Run your own instance on Railway. | [Self-host](docs/how-to/self-host.md) |

New here? The [getting started tutorial](docs/tutorials/getting-started.md) takes you from install to a working room in a few minutes.

## Documentation

The [documentation index](docs/index.md) lists every page. The ones most people want:

- [Getting started](docs/tutorials/getting-started.md)
- [Install on each host](docs/how-to/install.md)
- [Tool reference](docs/reference/tools.md)
- [Configuration](docs/reference/configuration.md)
- [Architecture](docs/explanation/architecture.md)
- [Security model](docs/explanation/security.md)
- [Roadmap](docs/plans/README.md)
- [Changelog](CHANGELOG.md)

## Contributing

MCPortal runs from a checkout with no build step. See [CONTRIBUTING.md](CONTRIBUTING.md) to run it locally and send changes.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). Please don't open public issues for them.

## License

MCPortal is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

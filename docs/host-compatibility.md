# Host compatibility checklist

The room uses the MCP Apps JSON-RPC bridge. Initialization is authoritative: `hostCapabilities.serverTools`, `openLinks`, `message`, and `updateModelContext` control requests; `hostContext.availableDisplayModes` controls fullscreen. Missing capabilities reject immediately, including restored views, instead of waiting for a request timeout. Preview uses its local HTTP transport.

Unsupported chat opening falls back to the current reader. Unsupported or declined original-link opening shows a selectable address. Unsupported tool calls show the normal view/action error with an instruction to ask the agent. Context updates are optional and fail silently. Hosts that omit newer chat/context capability fields conservatively use the inline reader.

Reader and docs cards have an Open your room control. Opening a reader from a room retains the existing room DOM, horizontal lane, column/shelf positions, window position, and keyboard focus. Returning from a standalone card loads the room. Escape uses the same route.

References: [official bridge overview](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md), [current capability schema](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/generated/schema.ts), and [2026-01-26 protocol](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx). Host behavior must be observed at runtime; product names alone do not establish capabilities.

## Manual certification (pending)

No Claude desktop, ChatGPT, or Codex host session has been manually certified by this change. For each host record app version/date, bridge capability response, screenshot or reproducible observations, and failures before marking it verified.

- [ ] Initial room result, onboarding, restored view, and explicit tool error render.
- [ ] Reader card and docs card can return home; inline readers restore lane, column/shelf and page scroll plus focus.
- [ ] Original link opens with permission, or presents the address immediately when unsupported/declined.
- [ ] Supported chat messages open a reader card; absent message capability opens inline immediately.
- [ ] Fullscreen enters/exits only when advertised; theme and container changes apply.
- [ ] Missing tool proxy and context-update capabilities produce immediate useful fallbacks.
- [ ] Docs search, internal links, parent docs and empty indexes retain navigation.

Automated VM tests cover advertised/absent capability routing and room return/scroll restoration. They do not certify iframe sandbox policies, host consent dialogs, or visual layout.

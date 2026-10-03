# Host compatibility checklist

The room uses the MCP Apps JSON-RPC bridge. Initialization is authoritative: `hostCapabilities.serverTools`, `openLinks`, `message`, and `updateModelContext` control requests; `hostContext.availableDisplayModes` controls fullscreen. Missing capabilities reject immediately, including restored views, instead of waiting for a request timeout. Preview uses its local HTTP transport.

Unsupported chat opening falls back to the current reader. Unsupported or declined original-link opening shows a selectable address. Unsupported tool calls show the normal view/action error with an instruction to ask the agent. Context updates are optional and fail silently. Hosts that omit newer chat/context capability fields conservatively use the inline reader.

Sign-in works through the hosted MCPortal and a loopback callback on the computer that started it. Open the link on that same computer; another computer should start its own sign-in. Both the welcome button and Ghost mode menu use advertised `openLinks` support, or show a selectable link when opening is unsupported or declined. A failed callback replaces the room's waiting instructions with the failure message and a retry button. `account_settings` exposes the last failed attempt in the local process as `identity.signInFailure` (code, stage, reference and message); a fresh attempt clears it. Restarting MCPortal clears this transient diagnostic.

For troubleshooting, share the displayed reference and the step that failed. Local stderr logs use `signin.failed` with `reference`, `stage`, `code` and optional HTTP `status`; `signin.callback_refused` records a state mismatch without the state value. Hosted logs use `auth.github_failed` with a separate displayed reference, `step`, a safe `reason` and optional HTTP `status`. These events never log tokens, OAuth codes, callback URLs, raw provider text or filesystem paths. A failed initial import is reported separately in the browser and the next room notice: sign-in remains valid and the local files remain available for another import.

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
- [ ] Both sign-in buttons open the browser or show a selectable link; denied/expired sign-in shows a cause, reference and retry. Successful sign-in redraws the room; a failed initial import shows its warning.
- [ ] Docs search, internal links, parent docs and empty indexes retain navigation.

Automated VM tests cover advertised/absent capability routing and room return/scroll restoration. They do not certify iframe sandbox policies, host consent dialogs, or visual layout.

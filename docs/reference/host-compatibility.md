# Host compatibility

How the room behaves in each MCP host, and how to certify a host. The room is an [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md) view; what it can do depends on the capabilities the host advertises.

## Capabilities

The room reads the host's capabilities once, at initialization, and trusts only those. A missing capability fails at once, with a fallback, rather than waiting for a timeout. Product names alone never decide behavior.

| Capability | When present | When absent or declined |
|---|---|---|
| `hostCapabilities.serverTools` | Buttons in the room call MCPortal tools directly | The action shows an error that says to ask the agent instead |
| `hostCapabilities.openLinks` | Original links and sign-in links open in the browser, after the host's permission prompt | The room shows the address as selectable text |
| `hostCapabilities.message` | A story opens in a new reader card in the chat | The story opens in the reader inside the current card |
| `hostCapabilities.updateModelContext` | The reader can hand a selected passage, docs page or post to the agent as context | The option is hidden; other context updates are skipped silently |
| `hostContext.availableDisplayModes` | Fullscreen is offered when the host lists it | No fullscreen control |
| Theme variables in `hostContext.styles` | The room adopts the host's colors and fonts, repaired for contrast | The house palette (see [design system](design-system.md#theme-contract)) |

Hosts that omit the newer message and context fields get the inline reader.

## Host status

| Host | Room | Reader | Sign-in | Notes |
|---|---|---|---|---|
| Claude desktop | Works | Works | Works | Used daily by the maintainer, not formally certified |
| Codex | Works | Works | Works | Used daily by the maintainer, not formally certified |
| Claude web | Untested | Untested | Untested | Hosted connector only |
| Claude mobile | Untested | Untested | Untested | Hosted connector only |
| Claude Code | Untested | Untested | Untested | A terminal: expect text results rather than cards |
| ChatGPT | Untested | Untested | Untested | |

A host that renders no MCP Apps view still gets every tool's text result.

## Navigation

Reader and docs cards have an **Open your room** control. Opening a reader from the room keeps the room as it was: lane, column or shelf position, scroll and keyboard focus. From a standalone card, the control loads the room. Escape does the same.

## Sign-in

A local MCPortal signs in through the hosted service and a loopback callback on the computer that started it. Open the sign-in link on that same computer; another computer starts its own sign-in.

Both the welcome button and the ghost-mode menu use `openLinks`, or show a selectable link. A failed callback replaces the waiting message with the cause, a reference and a retry button. `account_settings` reports the last failed attempt as `identity.signInFailure` (code, stage, reference, message) until a new attempt or a restart.

A failed first import is reported separately, in the browser and the next room notice. The sign-in stays valid and the local files stay available to import again.

### Troubleshooting sign-in

Ask for the displayed reference and the step that failed, then search the logs:

| Where | Event | Fields |
|---|---|---|
| Local stderr | `signin.failed` | `reference`, `stage`, `code`, optional HTTP `status` |
| Local stderr | `signin.callback_refused` | State mismatch (the state value is not logged) |
| Hosted logs | `auth.github_failed` | Its own `reference`, `step`, a safe `reason`, optional HTTP `status` |

None of these log tokens, OAuth codes, callback URLs, raw provider text or file paths.

## Certifying a host

Automated tests cover capability routing and returning to the room. They can't check a host's iframe sandbox, consent dialogs or visual layout, so certify each host by hand. Record the host's app version and date, its capability response, and screenshots or notes for each check.

1. The room, onboarding, a restored view and a tool error render.
2. Reader and docs cards return to the room, which restores lane, column or shelf, scroll and focus.
3. An original link opens after permission, or shows its address at once when unsupported or declined.
4. With `message`, a story opens a reader card; without it, the inline reader opens at once.
5. Fullscreen appears only when advertised. Theme and container changes apply.
6. Without `serverTools` or `updateModelContext`, the fallbacks appear at once.
7. Both sign-in buttons open the browser or show a link. A denied or expired sign-in shows a cause, reference and retry; success redraws the room; a failed first import shows its warning.
8. Docs search, internal links, parent docs and empty indexes keep navigation working.

## References

- [MCP Apps overview](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md)
- [Capability schema](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/generated/schema.ts)
- [MCP Apps specification, 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

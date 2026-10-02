# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. The address is on the hosted service's [security page](https://mcportal-production.up.railway.app/security), and in machine-readable form at [`/.well-known/security.txt`](https://mcportal-production.up.railway.app/.well-known/security.txt). Put "security" in the subject.

Include what you found, how to reproduce it, and what someone could do with it. Don't include real tokens or other people's data.

- We'll acknowledge your report within 3 business days and keep you updated until it's fixed.
- Please give us 90 days to fix it before you share it publicly. We'll credit you when it's fixed, if you'd like.
- Test with your own accounts only. Don't access or change other people's data, degrade the service for others, or use social engineering or spam.
- We won't pursue legal action against good-faith research that follows these guidelines.

## Scope

- The hosted MCPortal service and its public pages, OAuth endpoints, MCP endpoint (`/mcp`) and state API (`/api/v1`).
- This code, including a local MCPortal and its sign-in to a hosted account.
- Out of scope: the sites MCPortal reads, the agents it runs in (Claude, ChatGPT and others), GitHub, and Railway. Report problems with those to their owners.

## Supported versions

Fixes go into the latest release. The hosted service runs the latest release; local installs should update to it (see the README on turning on plugin auto-update).

## How MCPortal is built to be safe

The [security model in the README](README.md#security-model) covers the fetch boundary (no private networks, redirects re-checked), third-party text fenced from the agent, OAuth with PKCE and hashed, short-lived tokens, and what the agent can and can't change.

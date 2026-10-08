/** Public setup guidance, generated with this instance's origin. No credentials or account state. */
export function installationPrompt(publicUrl: string): string {
  return `Help me connect MCPortal to this agent.
Read ${publicUrl}/install.md and add ${publicUrl}/mcp as a remote MCP server using this host's supported setup.
If I need to change settings or sign in with GitHub, walk me through it. Then verify the connection and help me open my room.`;
}

export function installationIndex(publicUrl: string): string {
  return `# MCPortal

> A reading room inside your agent, delivered by a remote MCP server with an MCP Apps interface.

## Setup

- [Installation guide](${publicUrl}/install.md): host-specific commands, manual connector setup, GitHub sign-in, local installation and verification.

Remote endpoint: ${publicUrl}/mcp
Transport: Streamable HTTP.
Authentication: OAuth with GitHub sign-in. The person completes sign-in in their browser.
Visual room: requires an MCP host that supports MCP Apps; other MCP hosts can use the tools as text.

## Policies and help

- [Privacy](${publicUrl}/privacy): stored data and user controls.
- [Security](${publicUrl}/security): private reporting channel and security model.
- [Support](${publicUrl}/support): help connecting and using MCPortal.
`;
}

export function installationGuide(publicUrl: string, inviteOnly: boolean): string {
  return `# Install MCPortal

MCPortal is a reading room inside your agent. Choose a hosted connection or a local installation below.

## Connection details

- Name: mcportal
- Remote endpoint: ${publicUrl}/mcp
- Transport: Streamable HTTP
- Authentication: OAuth with GitHub sign-in
- Visual room: MCP Apps; tools also work as text in other MCP hosts
- Hosted setup: no Node.js, clone or local server needed
- Access: ${inviteOnly ? 'This instance is invite-only. Use the invited GitHub account or ask the operator for access.' : 'Anyone with a GitHub account can sign in to this instance.'}

## Ask your agent

Copy this prompt into the agent you want to connect:

\`\`\`text
${installationPrompt(publicUrl)}
\`\`\`

A coding agent with access to its host's MCP configuration or command line can perform the supported setup. A chat-only agent may need to explain the manual steps. Fetching a link alone does not install a server. The person must complete any host approval and GitHub sign-in.

## Codex: hosted connection

With the Codex CLI available:

\`\`\`bash
codex mcp add mcportal --url ${publicUrl}/mcp
codex mcp login mcportal
codex mcp list
\`\`\`

Complete sign-in in the browser. If CLI setup is unavailable but the host supports MCP settings, add a remote server with the endpoint above. The equivalent Codex configuration in ~/.codex/config.toml is:

\`\`\`toml
[mcp_servers.mcportal]
url = "${publicUrl}/mcp"
\`\`\`

Preserve all other configuration. Start a new session or restart the host if the server is not loaded in the current chat.

Official guidance: https://developers.openai.com/codex/mcp

## Claude Code: hosted connection

\`\`\`bash
claude mcp add --transport http mcportal --scope user ${publicUrl}/mcp
claude mcp list
\`\`\`

User scope makes it available across your projects. In Claude Code, run /mcp, choose mcportal and complete the browser sign-in. Start a new session if needed.

Official guidance: https://code.claude.com/docs/en/mcp

## Claude web and desktop: hosted connection

1. Open Connectors, usually under Customize.
2. Choose Add custom connector and name it MCPortal.
3. Enter ${publicUrl}/mcp as the remote MCP URL.
4. Follow the host's setup and GitHub sign-in steps, then enable the connector in your conversation if needed.

Organization accounts may require an owner to add the connector first. A chat agent cannot assume it can change these settings itself.

Official guidance: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

## Other MCP hosts

Use the host's supported remote Streamable HTTP setup and OAuth sign-in with the endpoint above. If it cannot add servers, explain that limitation and offer a supported host or the local route. Do not promise the visual room unless it supports MCP Apps.

## Local plugin or source install

Choose this route when the person wants a local reading room or cannot use custom remote connectors. Local MCPortal needs Node.js 22.18 or newer. It starts in ghost mode with no account and stores data in ~/.mcportal.

Claude Code's plugin commands, entered inside a session:

\`\`\`text
/plugin marketplace add lbliii/mcportal
/plugin install mcportal@mcportal
\`\`\`

Cowork: add lbliii/mcportal as a marketplace in plugin settings, then install mcportal.

For a source install, use https://github.com/lbliii/mcportal and the host instructions in docs/how-to/install.md. Run node with the absolute path to bin/mcportal.mjs and --stdio; local runtime needs no npm install. To link that local copy to this instance, set MCPORTAL_HOSTED_URL=${publicUrl} before asking to sign in.

## Verify and open

Check the host's MCP server list and confirm mcportal is loaded. After sign-in and any needed restart, ask "open my room". The agent calls open_room; an MCP Apps host shows the room and other hosts return text. The local plugin also supports /portal.

If mcportal already exists, inspect and reuse the connection if it points here. Do not overwrite a working local or different-instance connection without asking which one the person wants. Do not remove other servers or replace whole config files. Never ask the person to paste a GitHub password, OAuth code or access token into chat, and do not claim success until the host can use the server.

If access is denied, check whether this instance requires an invite. If a network blocks this domain, consult the network administrator or use the local route. Help: ${publicUrl}/support
`;
}

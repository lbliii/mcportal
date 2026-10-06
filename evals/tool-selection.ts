/**
 * Does a model pick the right MCPortal tool for what a user says? Each case is a
 * realistic request and the tool (and key arguments) a good first call would use.
 * `tool: null` means no MCPortal tool should be called at all.
 *
 * Run them against Claude with scripts/eval-tools.ts; test/evals.test.ts checks the
 * cases themselves (the tools exist, the arguments fit their schemas) offline.
 *
 * Frozen: a case's prompt and intent never change, so results compare across versions.
 * When the interface renames or replaces a tool, declare it in evals/renames.ts; the
 * runner translates expectations through it. Add cases; don't edit them.
 */
export interface ToolCase {
  /** What the user says. */
  prompt: string;
  /** The tool a good first call uses (any of them, if several are fine), or null for none. */
  tool: string | string[] | null;
  /** Arguments that must be present with these values (strings match case-insensitively, as substrings). */
  args?: Record<string, unknown>;
  /** Which server the user is on: sharing and profiles exist only hosted; 'labs' is hosted with every lab on. Default hosted. */
  where?: 'hosted' | 'local' | 'labs';
}

export const TOOL_CASES: ToolCase[] = [
  // The room
  { prompt: 'open my portal', tool: 'open_room' },
  { prompt: "what's new across my sources this morning?", tool: 'open_room' },
  { prompt: 'I want to start over with my room, show me the starter packs again', tool: 'open_room', args: { setup: true } },
  { prompt: 'set up my room with the developer and ai packs', tool: 'build_room', args: { packs: ['developer', 'ai'] } },
  { prompt: 'move my Hacker News portal to the last column', tool: 'get_profile' },
  { prompt: 'switch my room to shelves', tool: ['get_profile', 'update_profile'] },

  // Reading and sources
  { prompt: "what's on the Hacker News front page right now?", tool: 'read_source', args: { source: 'hn' } },
  { prompt: 'add The Verge to my room', tool: 'find_source', args: { query: 'theverge.com' } },
  { prompt: 'follow r/LocalLLaMA in my portal', tool: 'find_source', args: { query: 'r/LocalLLaMA' } },
  { prompt: 'what kinds of sources can MCPortal show?', tool: 'list_sources' },
  { prompt: 'read this for me in reader view: https://simonwillison.net/2026/Sep/30/notes/', tool: 'read_article', args: { url: 'simonwillison.net' } },
  { prompt: 'export my subscriptions so I can use them in NetNewsWire', tool: 'export_data', args: { format: 'opml' } },

  // Docs
  { prompt: 'open the Stripe docs', tool: 'open_docs', args: { docs: 'stripe' } },
  { prompt: 'how do I set up webhooks? check the Stripe docs', tool: ['search_docs', 'open_docs'], args: { docs: 'stripe' } },
  { prompt: 'keep the Next.js docs in my room', tool: 'find_source', args: { query: 'nextjs' } },

  // Saving and pinning
  { prompt: 'save https://example.com/great-essay for later', tool: 'save_item', args: { url: 'example.com/great-essay' } },
  { prompt: 'bookmark this: https://lwn.net/Articles/1000000/ and note "read before Friday"', tool: 'save_item', args: { url: 'lwn.net', note: 'friday' } },
  { prompt: 'unsave https://example.com/great-essay', tool: 'remove_saved', args: { url: 'example.com/great-essay' } },

  // Clips
  { prompt: 'clip that last quote: "Simplicity is prerequisite for reliability." by Dijkstra', tool: 'clip', args: { kind: 'quote' } },
  { prompt: 'find the clip I made about Postgres indexes', tool: 'search_clips', args: { query: 'postgres' } },

  // Account and data
  { prompt: 'give me a copy of all my MCPortal data', tool: 'export_data', args: { format: 'mcportal' } },
  { prompt: 'how do I delete my MCPortal account?', tool: 'account_settings' },

  // Sharing (hosted only)
  { prompt: "show me @ada's space", tool: 'open_space', args: { handle: 'ada' } },
  { prompt: 'follow @ada', tool: 'relationship', args: { action: 'follow', handle: 'ada' } },
  { prompt: 'claim the handle @lena for my public profile', tool: ['set_public_profile', 'get_public_profile'], args: { handle: 'lena' } },

  // Reading history
  { prompt: 'what was I in the middle of reading?', tool: 'list_reading' },

  // Added 2026-10-01 (frozen from here): card reads, imports, layout edits, argument checks
  { prompt: 'show me my clip c0a1b2c3d4e5 again', tool: 'get_clip', args: { id: 'c0a1b2c3d4e5' } },
  { prompt: 'read the "Install" page of the docs at docs.example.com: https://docs.example.com/install.md', tool: ['read_doc_page', 'open_docs'], args: { docs: 'docs.example.com' } },
  { prompt: 'import these subscriptions: <?xml version="1.0"?><opml version="2.0"><body><outline text="Simon Willison" xmlUrl="https://simonwillison.net/atom/everything/"/></body></opml>', tool: 'import_opml' },
  { prompt: 'import my MCPortal export from ~/Downloads/mcportal-export.json', tool: 'import_portal', args: { path: 'mcportal-export.json' }, where: 'local' },
  { prompt: 'remove the Simon Willison portal from my room', tool: 'get_profile' },
  { prompt: 'make my GitHub column wider', tool: 'get_profile' },
  { prompt: 'rename my room to "mornings"', tool: 'get_profile' },
  // No Jira tool is connected: the right first move is to say so, not pin invented items.
  { prompt: 'pin my open Jira bugs to my room', tool: null },

  // Added 2026-10-02 (frozen from here): handoffs from the reader to a new chat
  { prompt: 'Open MCPortal handoff k7q2xm', tool: 'open_handoff', args: { code: 'k7q2xm' } },
  { prompt: 'pick up the page I just sent from MCPortal', tool: 'open_handoff' },

  // Added 2026-10-02 (frozen from here): highlights
  { prompt: "what's actually worth reading in my feeds today?", tool: 'list_new_items' },
  { prompt: 'catch me up on my sources, just the highlights', tool: 'list_new_items' },

  // Added 2026-10-02 (frozen from here): reblogging, a lab until it ships
  { prompt: 'reblog s_3f9a2c1b4d5e with the note "this is the one"', tool: 'share', args: { reblogOf: 's_3f9a2c1b4d5e', note: 'this is the one' }, where: 'labs' },
  { prompt: "reblog @ana's latest post", tool: ['list_shares', 'open_space'], args: { handle: 'ana' }, where: 'labs' },
  { prompt: 'undo my reblog s_1a2b3c4d5e6f', tool: 'unshare', args: { id: 's_1a2b3c4d5e6f' }, where: 'labs' },
  { prompt: 'nobody should be able to reblog my post s_7e8f9a0b1c2d', tool: 'share_settings', args: { id: 's_7e8f9a0b1c2d', reblogs: 'nobody' }, where: 'labs' },
  { prompt: 'take my post s_7e8f9a0b1c2d out of the reblog s_5d6e7f8a9b0c', tool: 'share_settings', args: { id: 's_7e8f9a0b1c2d', detach: 's_5d6e7f8a9b0c' }, where: 'labs' },
  { prompt: 'from now on only my followers can reblog what I post', tool: 'set_public_profile', args: { reblogs: 'followers' }, where: 'labs' },
  { prompt: 'who reblogged my post s_7e8f9a0b1c2d?', tool: 'get_share', args: { id: 's_7e8f9a0b1c2d' }, where: 'labs' },

  // Finding people (docs/plans/finding-people.md)
  { prompt: 'who should I follow on MCPortal?', tool: 'find_people' },
  { prompt: 'is anyone on MCPortal into modular synths?', tool: 'find_people', args: { about: 'synth' } },
  { prompt: 'find people who read simonwillison.net', tool: 'find_people', args: { sources: ['simonwillison.net'] } },
  { prompt: 'who else is like @ada?', tool: 'find_people', args: { like: 'ada' } },
  { prompt: 'let people with similar sources find me', tool: 'set_public_profile', args: { listed: true } },

  // Not for MCPortal
  { prompt: "what's 17 times 23?", tool: null },
  { prompt: 'write me a haiku about autumn', tool: null },
  { prompt: 'share my latest clip with my followers', tool: null, where: 'local' },
];

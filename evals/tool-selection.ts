/**
 * Does a model pick the right MCPortal tool for what a user says? Each case is a
 * realistic request and the tool (and key arguments) a good first call would use.
 * `tool: null` means no MCPortal tool should be called at all.
 *
 * Run them against Claude with scripts/eval-tools.ts; test/evals.test.ts checks the
 * cases themselves (the tools exist, the arguments fit their schemas) offline.
 */
export interface ToolCase {
  /** What the user says. */
  prompt: string;
  /** The tool a good first call uses (any of them, if several are fine), or null for none. */
  tool: string | string[] | null;
  /** Arguments that must be present with these values (strings match case-insensitively, as substrings). */
  args?: Record<string, unknown>;
  /** Which server the user is on: sharing and profiles exist only hosted. Default hosted. */
  where?: 'hosted' | 'local';
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

  // Not for MCPortal
  { prompt: "what's 17 times 23?", tool: null },
  { prompt: 'write me a haiku about autumn', tool: null },
  { prompt: 'share my latest clip with my followers', tool: null, where: 'local' },
];

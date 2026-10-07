/**
 * The structured content each tool returns to the room app: one contract for both
 * sides. Handlers check what they return against it (`satisfies ToolResults['x']`),
 * and the room's callTool() is typed by it (src/ui/ui.d.ts), so the server and the
 * UI can't drift apart without a type error. The model reads the text content;
 * this is what the app reads.
 */
import type { DocHit, DocPage, DocPageRef, DocSection, DocsToc } from '../adapters/docs.ts';
import type { Clip, ClipSummary } from '../clips.ts';
import type { FetchedSource, SourceCandidate } from '../discover.ts';
import type { Profile, ProfileDiff, SourceSettings } from '../profile.ts';
import type { FeaturedSource, PublicProfile } from '../public-profiles.ts';
import type { Intros, PersonMatch, Reblogger, SharedItem } from '../social.ts';
import type { Handoff } from '../handoffs.ts';
import type { Candidate, HighlightPick, Lead, RoomEdition } from '../highlights.ts';
import type { ReadingState } from '../reading.ts';
import type { Article, Item, PortalResult, Provenance } from '../types.ts';
import type { Identity } from './kit.ts';

/** A starter pack as the welcome screen lists it. */
export type PackSummary = { id: string; label: string; blurb: string; sources: string[] };

/** The whole room: open_room (and the first-run welcome, with onboarding). */
export type RoomResult = {
  profile: Profile;
  portals: PortalResult[];
  notice?: string | undefined;
  generatedAt: string;
  /** Signed in (and as whom) or ghost mode, for the toolbar. */
  identity: Identity;
  onboarding?: { packs: PackSummary[]; maxPacks: number; rebuilding: boolean };
  /** The agent's latest highlights still in the room (src/editions.ts). */
  edition?: RoomEdition;
  /** What the room leads with. */
  lead?: Lead;
  /** Labs this server has on (src/labs.ts), so the room can offer them. */
  labs?: string[];
  /** Space links, said once: people to offer a follow of, and newcomers who joined through the user's link. */
  intros?: Intros;
};

/** After a save or unsave: the saved list, the room, and the Saved portal redrawn. */
export type SavedResult = { saved: Profile['saved']; profile: Profile; layoutChanged: boolean; portal: PortalResult | null };

/** A docs site's contents, as open_docs shows them. */
export type DocsSiteResult = {
  site: { title: string; summary?: string | undefined; toc: DocsToc; sections: DocSection[]; symbols: number };
  docs: string;
  provenance: Provenance;
  page?: string;
};

/** One docs page, with where it sits in its site. */
export type DocsPageResult = {
  page: DocPage & { originalUrl: string };
  site: { title: string; toc: DocsToc };
  section?: string;
  prev?: DocPageRef;
  next?: DocPageRef;
  provenance: Provenance;
};

/** Someone's space: their public profile, their posts and the sources they recommend. */
export type SpaceResult = {
  space: Omit<PublicProfile, 'accountId'> & { mine: boolean; followers: number; following: boolean; posts: SharedItem[]; sources: FeaturedSource[]; link?: string };
};

export type ToolResults = {
  open_room: RoomResult;
  build_room: { profile: Profile };
  arrange_room: { profile: Profile; changes: ProfileDiff };
  remove_portal: { profile: Profile; changes: ProfileDiff };
  refresh_portal: { portal: PortalResult };
  mark_seen: { marked: number };
  list_new_items: { items: Candidate[]; signals: string[] };
  show_highlights: { highlights: { title: string; intro?: string; picks: HighlightPick[] } };
  find_source: { candidates: Array<SourceSettings<FetchedSource> & Omit<SourceCandidate, 'source' | 'config'> & { preview: Item[] }>; hint?: string | undefined };
  add_portal: { profile: Profile; portal: PortalResult; portalId: string };
  import_opml: { profile: Profile; imported: number; failed: Array<{ url: string; title: string; error?: string | undefined }>; total: number };
  read_article: { article: Article; saved: boolean };
  get_thumbnails: { images: Record<string, string | null> };
  save_item: SavedResult;
  remove_saved: SavedResult;
  open_docs: DocsSiteResult;
  read_doc_page: DocsPageResult;
  search_docs: { hits: DocHit[]; site: { title: string; toc: DocsToc } };
  open_handoff: (ToolResults['read_article'] | (DocsSiteResult & { page: string })) & { handoff: Handoff };
  create_handoff: { handoff: Handoff; prompt: string };
  get_clip: { clip: Clip };
  clip: { clip: ClipSummary; profile: Profile; layoutChanged: boolean; portals: PortalResult[] };
  open_space: SpaceResult;
  /** labs: the server's, so a card offers what the room would. */
  find_people: { people: Array<PersonMatch & { reasons: string[] }> };
  get_share: { share: SharedItem; rebloggers?: Reblogger[]; labs?: string[] };
  share: { share: SharedItem };
  share_settings: { share: SharedItem };
  unshare: { removed: boolean };
  relationship: { handle?: string; layoutChanged?: boolean; profile?: Profile };
  record_reading: { reading: ReadingState };
  account_settings: { identity: Identity; url: string | null };
  set_public_profile: { profile: PublicProfile };
  link_account: { url: string };
  unlink_account: { identity: Identity };
  get_reading: { reading: ReadingState | null };
  list_reading: { reading: ReadingState[] };
};

/** A tool the room app calls, by name. */
export type AppTool = keyof ToolResults;

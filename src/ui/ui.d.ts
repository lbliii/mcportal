/**
 * Types for the browser scripts (room.html with src/ui/room/*.js, and admin.html),
 * checked by scripts/check-ui.ts. Not shipped: the pages are plain JavaScript and
 * read these through JSDoc. Kept out of the server's tsconfig, which has no DOM.
 *
 * The data types come from the server, so the UI reads exactly what the tools return
 * (src/tools/results.ts is the contract).
 */
import type { AppTool as ServerAppTool, ToolResults as ServerToolResults } from '../tools/results.ts';
import type * as Profiles from '../profile.ts';
import type * as Types from '../types.ts';
import type * as Clips from '../clips.ts';
import type * as Social from '../social.ts';
import type * as Docs from '../adapters/docs.ts';

declare global {

  interface Window {
    /** Set by /preview: talk to /mcp directly instead of through an MCP host. */
    __MCPORTAL_DEV__?: { needsToken: boolean };
  }

  /** Every element of room.html that the script looks up by id, with its element type. */
  interface RoomElements {
    addForm: HTMLFormElement;
    addHint: HTMLDivElement;
    addInput: HTMLInputElement;
    addResults: HTMLUListElement;
    addSheet: HTMLElement;
    brandBadge: HTMLTemplateElement;
    btnAdd: HTMLButtonElement;
    btnExpand: HTMLButtonElement;
    btnImportOpml: HTMLButtonElement;
    btnOpenIn: HTMLButtonElement;
    btnRefresh: HTMLButtonElement;
    btnSources: HTMLButtonElement;
    btnSpace: HTMLButtonElement;
    grid: HTMLElement;
    opmlFile: HTMLInputElement;
    reader: HTMLElement;
    roomName: HTMLDivElement;
    status: HTMLSpanElement;
    toast: HTMLDivElement;
    welcome: HTMLElement;
  }

  /** The same for admin.html. */
  interface AdminElements {
    accounts: HTMLTableSectionElement;
    audit: HTMLTableSectionElement;
    copyShare: HTMLButtonElement;
    copyShareLink: HTMLButtonElement;
    inviteForm: HTMLFormElement;
    inviteLogin: HTMLInputElement;
    invites: HTMLTableSectionElement;
    me: HTMLSpanElement;
    msg: HTMLDivElement;
    reports: HTMLTableSectionElement;
    share: HTMLDivElement;
    shareText: HTMLTextAreaElement;
    shareTitle: HTMLDivElement;
    usageSummary: HTMLParagraphElement;
    usageTools: HTMLTableSectionElement;
    usageUsers: HTMLTableSectionElement;
  }

  /** A page's element by id: its known type, or HTMLElement for ids made at runtime. */
  type ById<Map> = <K extends string>(id: K) => K extends keyof Map ? Map[K] : HTMLElement;

  type ToolResults = ServerToolResults;
  type AppTool = ServerAppTool;

  /** What callTool resolves to: the tool's structured content (and its text, rarely needed). */
  type ToolResult<K extends AppTool> = { structuredContent: ToolResults[K]; content?: Array<{ type: string; text?: string }> };

  type Profile = Profiles.Profile;
  type PortalSpec = Profiles.PortalSpec;
  type PortalResult = Types.PortalResult;
  type Item = Types.Item;
  type Article = Types.Article;
  type ArticleBlock = Types.ArticleBlock;
  type Span = Types.Span;
  type Provenance = Types.Provenance;
  type Clip = Clips.Clip;
  type ClipSummary = Clips.ClipSummary;
  type ClipData = Clips.ClipData;
  type SharedItem = Social.SharedItem;
  type DocSection = Docs.DocSection;
  type DocPageRef = Docs.DocPageRef;
  type DocHit = Docs.DocHit;

  /** The room's state: the profile, the portals as last loaded, saved URLs, and each portal's fallback art style. */
  type RoomState = { profile: Profile | null; portals: Map<string, PortalResult>; saved: Set<string>; art: Map<string, string> };
}

export {};

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
    btnLayout: HTMLButtonElement;
    btnOpenIn: HTMLButtonElement;
    btnRefresh: HTMLButtonElement;
    btnSources: HTMLButtonElement;
    btnWho: HTMLButtonElement;
    whoMenu: HTMLDivElement;
    grid: HTMLElement;
    layoutMenu: HTMLDivElement;
    mainBar: HTMLElement;
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
  type Reblogger = Social.Reblogger;
  type DocSection = Docs.DocSection;
  type DocPageRef = Docs.DocPageRef;
  type DocHit = Docs.DocHit;
  type Handoff = import('../handoffs.ts').Handoff;
  type Identity = import('../tools/kit.ts').Identity;

  type RoomEdition = import('../highlights.ts').RoomEdition;
  type Lead = import('../highlights.ts').Lead;

  /**
   * The room's state: the profile, who it belongs to, the portals as last loaded, saved
   * URLs, each portal's fallback art style, the agent's edition and the room's lead
   * (open_room), and the labs on.
   */
  type RoomState = { profile: Profile | null; identity: Identity | null; portals: Map<string, PortalResult>; saved: Set<string>; art: Map<string, number>; edition?: RoomEdition | undefined; lead?: Lead | undefined; labs: string[]; alsoShared: Map<string, NonNullable<ToolResults['open_room']['alsoShared']>[number]> };

  // ---- Admin page data (src/admin.ts: /admin/api/state and the POST actions).
  // admin.ts builds reports and usage as `unknown`, so their shapes are spelled out here
  // from reportsView() and usageView(); the rest are the server's own types.

  type Account = import('../accounts.ts').Account;
  type Invite = import('../accounts.ts').Invite;
  type AuditEntry = import('../accounts.ts').AuditEntry;

  /** Who a report is from or about (admin.ts reportsView `who`). */
  type AdminPerson = { accountId: string; login: string | null; handle: string | null };

  /** A report with its people and target resolved (admin.ts reportsView). */
  type AdminReport = Social.Report & {
    reporter: AdminPerson;
    target: {
      kind: Social.Report['targetKind'];
      id: string;
      exists: boolean;
      account: AdminPerson | null;
      /** Only when the share still exists. */
      title?: string;
      note?: string;
      url?: string;
      hidden?: boolean;
      shareKind?: Social.Share['kind'];
    };
  };

  /** Usage on this instance (admin.ts usageView); each half is missing when that feature is off. */
  type AdminUsage = {
    budget?: Omit<import('../lib/budget.ts').BudgetSnapshot, 'today'> & { today: Array<import('../lib/budget.ts').BudgetSnapshot['today'][number] & { login: string | null }> };
    tools?: ReturnType<import('../lib/metrics.ts').ToolMetrics['snapshot']>;
  };

  /** What every admin API call returns: the POST actions send this (with ok: true). */
  type AdminUpdate = { accounts: Account[]; invites: Invite[]; audit: AuditEntry[]; reports: AdminReport[]; usage?: AdminUsage };

  /** GET /admin/api/state: the update plus who's signed in, the CSRF token and usage. */
  type AdminState = AdminUpdate & { me: { login: string; accountId: string }; csrf: string; usage: AdminUsage };
}

export {};

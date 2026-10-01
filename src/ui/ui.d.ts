/**
 * Types for the browser scripts (room.html with src/ui/room/*.js, and admin.html),
 * checked by scripts/check-ui.ts. Not shipped: the pages are plain JavaScript and
 * read these through JSDoc. Kept out of the server's tsconfig, which has no DOM.
 */

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

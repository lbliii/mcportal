/**
 * Labs: unfinished features, off unless MCPORTAL_LABS names them (comma-separated, e.g.
 * MCPORTAL_LABS=frontpage). River and reblog graduated in 0.8.0; naming them does nothing. Read once at startup. A lab that's off is never offered to
 * the model or shown in the room, but what a user already chose with it stays valid.
 */
export const LABS = ['frontpage'] as const;
export type Lab = (typeof LABS)[number];

export function labsFrom(value: string | undefined): Lab[] {
  const named = new Set((value ?? '').split(',').map((s) => s.trim().toLowerCase()));
  return LABS.filter((lab) => named.has(lab));
}

/** The labs this server runs with. */
export const ACTIVE_LABS: readonly Lab[] = labsFrom(process.env.MCPORTAL_LABS);

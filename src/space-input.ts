/** Shared state API and agent schema for named Space choices. */
import { INKS, MOTIFS, FORMATS, STAMPS } from './space-design.ts';
export const SPACE_INPUT = {
  ink: { type: 'string', enum: INKS }, motif: { type: 'string', enum: MOTIFS },
  reroll: { type: 'boolean' }, format: { type: 'string', enum: FORMATS },
  frequency: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 24 } },
  pinnedShareId: { type: 'string', maxLength: 80, description: 'Own post id; empty clears' },
  travelers: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 31 } },
  hiddenStamps: { type: 'array', maxItems: 4, items: { type: 'string', enum: STAMPS } },
  public: { type: 'boolean', description: 'Public on the web by default; false restricts to MCPortal members. Copies and feed caches cannot be recalled' },
};

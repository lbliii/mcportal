/** The server reads the exact plates that the browser uses. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
export type InkName = 'atomic' | 'space-age' | 'pulp' | 'olive-drab' | 'pink-moon' | 'mars' | 'mission' | 'harbor';
export type MotifName = 'arches' | 'orbits' | 'portal' | 'gravity' | 'doorway';
export type SpaceFormat = 'paperback' | 'magazine' | 'patch';
export type StampName = 'charter' | 'brought' | 'signal' | 'volume';
export interface Cover { ink: InkName; motif: MotifName; seed: number }
export interface SpaceStamp { name: StampName; label: string }
export const SPACE_DESIGN = runInNewContext(`${readFileSync(new URL('./ui/space-inks.js', import.meta.url), 'utf8')}; spaceInks`, {}, { timeout: 1000 }) as {
  sets: Array<{ name: InkName; colors: [string, string, string, string, string] }>;
  motifs: MotifName[]; formats: SpaceFormat[]; stamps: StampName[];
};
export const INKS = SPACE_DESIGN.sets.map((s) => s.name);
export const MOTIFS = SPACE_DESIGN.motifs;
export const FORMATS = SPACE_DESIGN.formats;
export const STAMPS = SPACE_DESIGN.stamps;
/** An old exported accent is mapped only at the import boundary. */
export function importedInk(accent: unknown): InkName {
  const old: Record<string, InkName> = { blue: 'pulp', teal: 'atomic', green: 'olive-drab', amber: 'space-age', orange: 'space-age', rose: 'mars', violet: 'pink-moon', slate: 'mission' };
  return old[String(accent)] ?? 'atomic';
}

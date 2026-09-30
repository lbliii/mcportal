// The subset of opentype.js (v2, untyped) that scripts/brand.ts uses.
declare module 'opentype.js' {
  export interface BoundingBox { x1: number; y1: number; x2: number; y2: number }
  export interface PathCommand { type: 'M' | 'L' | 'Q' | 'C' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
  export interface Path {
    commands: PathCommand[];
    getBoundingBox(): BoundingBox;
  }
  export interface Glyph {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    tables: { os2: { sCapHeight: number } };
    charToGlyph(char: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}

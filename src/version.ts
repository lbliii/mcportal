import { readFileSync } from 'node:fs';

/** Leaf dependency for runtime metadata; importing the MCP dispatcher here would create tool cycles. */
export const APP_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

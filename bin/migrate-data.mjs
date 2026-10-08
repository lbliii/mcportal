#!/usr/bin/env node
import path from 'node:path';
import { migrateData } from '../src/lib/migrate-data.ts';
const [source, destination] = process.argv.slice(2);
const target = destination || (process.env.PLUGIN_DATA && path.join(process.env.PLUGIN_DATA, 'mcportal'));
if (!source || !target) {
  console.error('Usage: node bin/migrate-data.mjs <existing data directory> <new plugin data directory>');
  process.exitCode = 1;
} else {
  try { console.log(await migrateData(source, target)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

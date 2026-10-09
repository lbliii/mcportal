/** Offline synthetic retrieval evaluation; never reads the user's room or fetches sources. */
import { writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { parseArgs } from 'node:util';
import { benchmark, corpusHash, type Backend } from '../evals/recall/run.ts';

const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'files' }, split: { type: 'string', default: 'development' }, output: { type: 'string' }, quiet: { type: 'boolean', default: false },
} });
const available: Backend[] = ['files', 'postgres', 'linked-files', 'linked-postgres'];
if (values.split !== 'development' && values.split !== 'validation') throw new Error('--split must be development or validation');
if (values.backend !== 'all' && !available.includes(values.backend as Backend)) throw new Error('--backend must be files, postgres, linked-files, linked-postgres, or all');
const results = [];
for (const backend of values.backend === 'all' ? available : [values.backend as Backend]) results.push(await benchmark(backend, values.split));
const report = { corpusHash: await corpusHash(), environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, runsPerQuery: 5 }, results };
if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
if (!values.quiet) console.log(JSON.stringify(report, null, 2));

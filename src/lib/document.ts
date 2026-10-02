/**
 * Whole-document JSON persistence (accounts, public profiles, social, OAuth state):
 * a file on disk locally, a row in Postgres when hosted. SharedDocument keeps one
 * cached in memory and changes it safely, also with more than one server instance.
 *
 * Loading never mistakes a failure for an empty document. A read that fails (a
 * database blip, a permissions error) throws, so nothing is cached and the next
 * write can't replace everyone's data with just the one change. A document that is
 * stored but unreadable throws too, and is logged: it stays where it is for an
 * operator to repair, instead of being silently overwritten.
 */
import { AppError, errorMessage } from './errors.ts';
import { KeyedMutex } from './files.ts';
import { processLogger, type Logger } from './log.ts';

/** Where a document lives. `read` returns undefined when nothing is stored yet. */
export interface DocumentPersistence {
  read(): Promise<string | undefined>;
  write(json: string): Promise<void>;
  /**
   * Read, change and write atomically across server instances (Postgres locks the
   * row). Without it, a change is atomic within this process only, which is all a
   * file on one machine needs. `change` returns json undefined to write nothing.
   */
  transact?<R>(change: (raw: string | undefined) => { json?: string; result: R }): Promise<R>;
}

/** The stored document as a plain object ({} when there is none yet). Throws when it can't be read. */
export async function readDocument<T extends object>(persistence: DocumentPersistence, name: string, log: Logger = processLogger()): Promise<Partial<T>> {
  return parseDocument<T>(await persistence.read(), name, log);
}

/** A stored document's text as a plain object ({} for none). Throws, and logs, when it's unreadable. */
export function parseDocument<T extends object>(raw: string | undefined, name: string, log: Logger = processLogger()): Partial<T> {
  if (raw === undefined || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    log.error('document.unreadable', { document: name, bytes: raw.length });
    throw new AppError('internal', `The stored ${name} document is unreadable`, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log.error('document.unreadable', { document: name, bytes: raw.length });
    throw new AppError('internal', `The stored ${name} document is not an object`);
  }
  return parsed as Partial<T>;
}

/** How stale a cached document may get by default: changes from another instance show up within this. */
export const DOCUMENT_MAX_AGE_MS = 10_000;

export interface SharedDocumentOptions<T> {
  /** How long a cached copy serves reads before the next read reloads it. */
  maxAgeMs: number;
  /** Runs on every change, before it's written (pruning expired entries, capping logs). */
  beforeWrite?: (doc: T) => void;
  now?: () => number;
  log?: Logger;
}

/**
 * One JSON document, cached for reads and changed atomically.
 *
 * Reads are served from memory for up to maxAgeMs, then reloaded; a reload that
 * fails keeps serving the last good copy (and logs) rather than failing every read.
 * A change always starts from the stored document, never the cache, so changes made
 * by another instance are kept; with a persistence that has `transact`, two
 * instances can't overwrite each other's changes either.
 */
export class SharedDocument<T extends object> {
  private persistence: DocumentPersistence;
  private name: string;
  private shape: (stored: Partial<T>) => T;
  private options: SharedDocumentOptions<T>;
  private cached: { doc: T; at: number } | undefined;
  private loading: Promise<T> | undefined;
  private mutex = new KeyedMutex();

  /** `shape` fills in what a stored (or missing) document lacks. */
  constructor(persistence: DocumentPersistence, name: string, shape: (stored: Partial<T>) => T, options: SharedDocumentOptions<T>) {
    this.persistence = persistence;
    this.name = name;
    this.shape = shape;
    this.options = options;
  }

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get log(): Logger {
    return this.options.log ?? processLogger();
  }

  /** The cached copy, however old (undefined before the first load). For synchronous checks; pair with get(). */
  peek(): T | undefined {
    return this.cached?.doc;
  }

  /**
   * The document, reloaded if the cached copy is older than `maxAgeMs` (default: the
   * configured one; 0 always reloads). Reloads that overlap share one read.
   */
  async get(maxAgeMs = this.options.maxAgeMs): Promise<T> {
    if (this.cached && this.now - this.cached.at < maxAgeMs) return this.cached.doc;
    this.loading ??= this.reload().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async reload(): Promise<T> {
    try {
      const doc = this.shape(parseDocument<T>(await this.persistence.read(), this.name, this.log));
      this.cached = { doc, at: this.now };
      return doc;
    } catch (error) {
      if (!this.cached) throw error;
      this.log.warn('document.reload_failed', { document: this.name, error: errorMessage(error) });
      return this.cached.doc;
    }
  }

  /** Change the stored document and return what `change` returns. `change` must be synchronous. */
  update<R>(change: (doc: T) => R): Promise<R> {
    return this.mutex.run(this.name, async () => {
      let next: T | undefined;
      const apply = (raw: string | undefined) => {
        const doc = this.shape(parseDocument<T>(raw, this.name, this.log));
        const result = change(doc);
        this.options.beforeWrite?.(doc);
        next = doc;
        return { json: JSON.stringify(doc), result };
      };
      let result: R;
      if (this.persistence.transact) result = await this.persistence.transact(apply);
      else {
        const applied = apply(await this.persistence.read());
        await this.persistence.write(applied.json);
        result = applied.result;
      }
      this.cached = { doc: next!, at: this.now };
      return result;
    });
  }
}

/** In memory (tests, and servers that don't persist a document). Changes are atomic, as with Postgres. */
export function memoryPersistence(initial?: string): DocumentPersistence {
  let value = initial;
  return {
    read: async () => value,
    write: async (json) => {
      value = json;
    },
    // Synchronous between reading and writing, so nothing can interleave.
    transact: async (change) => {
      const { json, result } = change(value);
      if (json !== undefined) value = json;
      return result;
    },
  };
}

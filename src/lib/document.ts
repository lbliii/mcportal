/**
 * Whole-document JSON persistence (accounts, public profiles, social, OAuth state):
 * a file on disk locally, a row in Postgres when hosted.
 *
 * Loading never mistakes a failure for an empty document. A read that fails (a
 * database blip, a permissions error) throws, so nothing is cached and the next
 * write can't replace everyone's data with just the one change. A document that is
 * stored but unreadable throws too, and is logged: it stays where it is for an
 * operator to repair, instead of being silently overwritten.
 */
import { AppError } from './errors.ts';
import { processLogger, type Logger } from './log.ts';

/** Where a document lives. `read` returns undefined when nothing is stored yet. */
export interface DocumentPersistence {
  read(): Promise<string | undefined>;
  write(json: string): Promise<void>;
}

/** The stored document as a plain object ({} when there is none yet). Throws when it can't be read. */
export async function readDocument<T extends object>(persistence: DocumentPersistence, name: string, log: Logger = processLogger()): Promise<Partial<T>> {
  const raw = await persistence.read();
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

/** In memory (tests, and servers that don't persist a document). */
export function memoryPersistence(initial?: string): DocumentPersistence {
  let value = initial;
  return {
    read: async () => value,
    write: async (json) => {
      value = json;
    },
  };
}

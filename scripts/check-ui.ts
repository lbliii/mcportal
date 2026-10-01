/**
 * Type-check the browser code: the room's script and the admin page's script.
 *
 *   node scripts/check-ui.ts
 *
 * The room's fragments (src/ui/room/*.js and the design, art and icon scripts) aren't
 * modules: the page pastes them into one closure, where they share scope. So this
 * assembles the script the way roomHtml() does, remembers which file and line every
 * assembled line came from, and type-checks the result with checkJs against the DOM.
 * Errors are reported against the original files. JSDoc in the fragments supplies
 * the types, including the server's own (`import('../../types.ts')`).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const UI = new URL('../src/ui/', import.meta.url);
const uiPath = (name: string) => fileURLToPath(new URL(name, UI));

interface Assembled {
  /** The virtual file's name (its directory makes `import('../types.ts')` in JSDoc resolve). */
  name: string;
  text: string;
  /** For each assembled line (0-based): the file and line (1-based) it came from. */
  origin: Array<{ file: string; line: number }>;
}

/** The inline script of a page, with /*include:x*\/ lines replaced by those files. */
async function assemble(page: string, name: string): Promise<Assembled> {
  const html = await readFile(uiPath(page), 'utf8');
  const start = html.indexOf('<script');
  const open = html.indexOf('>', start) + 1;
  const close = html.indexOf('</script>', open);
  const before = html.slice(0, open).split('\n').length;   // the script's first line in the page
  const text: string[] = [];
  const origin: Assembled['origin'] = [];
  const lines = html.slice(open, close).split('\n');
  for (const [i, line] of lines.entries()) {
    const include = line.match(/^\s*\/\*include:([\w./-]+)\*\/\s*$/)?.[1];
    if (!include) {
      text.push(line);
      origin.push({ file: `src/ui/${page}`, line: before + i });
      continue;
    }
    const included = (await readFile(uiPath(include), 'utf8')).replace(/\n$/, '').split('\n');
    for (const [j, l] of included.entries()) {
      text.push(l);
      origin.push({ file: `src/ui/${include}`, line: j + 1 });
    }
  }
  return { name: fileURLToPath(new URL(name, UI)), text: text.join('\n'), origin };
}

/** The pages' declarations: element ids, host-provided globals (src/ui/ui.d.ts). */
const DECLARATIONS = uiPath('ui.d.ts');

export const UI_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  // Browser globals only: Node's would hide mistakes (its setTimeout, Buffer). Server modules
  // imported for their data types may not check without them; their errors are skipped below.
  types: [],
  strict: false,
  skipLibCheck: true,
};

/**
 * Files that must also pass strict mode (strictNullChecks, noImplicitAny, …), as the
 * server does. Every file starts outside this list and moves in once it's typed; the
 * goal is all of them. A file on the list can't regress.
 */
export const STRICT_UI_FILES: readonly string[] = [
  'src/ui/room.html',
  'src/ui/room/bridge.js',
  'src/ui/room/dom.js',
  'src/ui/room/boot.js',
  'src/ui/room/add.js',
  'src/ui/room/toolbar.js',
];

export interface UiProblem {
  file: string;
  line: number;
  message: string;
}

/**
 * Every type error in the room's and the admin page's scripts, against their source
 * files: all of them in non-strict mode, plus strict errors in STRICT_UI_FILES.
 */
export async function checkUi(strictFiles: readonly string[] = STRICT_UI_FILES): Promise<UiProblem[]> {
  const loose = await diagnose(UI_COMPILER_OPTIONS);
  const strict = (await diagnose({ ...UI_COMPILER_OPTIONS, strict: true })).filter((p) => strictFiles.includes(p.file));
  const seen = new Set(loose.map((p) => `${p.file}:${p.line}:${p.message}`));
  return [...loose, ...strict.filter((p) => !seen.has(`${p.file}:${p.line}:${p.message}`))];
}

/** Type errors under `options`, mapped back to the files they came from. */
export async function diagnose(options: ts.CompilerOptions): Promise<UiProblem[]> {
  const pages = [await assemble('room.html', 'room.assembled.js'), await assemble('admin.html', 'admin.assembled.js')];
  const virtual = new Map<string, string>(pages.map((p) => [p.name, p.text]));
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language, onError, shouldCreate) => {
    const text = virtual.get(fileName);
    return text !== undefined ? ts.createSourceFile(fileName, text, language) : getSourceFile(fileName, language, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtual.has(fileName) || fileExists(fileName);
  const readFileText = host.readFile.bind(host);
  host.readFile = (fileName) => virtual.get(fileName) ?? readFileText(fileName);
  const program = ts.createProgram([DECLARATIONS, ...pages.map((p) => p.name)], options, host);
  const problems: UiProblem[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    const page = pages.find((p) => p.name === d.file?.fileName);
    // Server modules pulled in for their types are checked by the server's own tsc.
    if (d.file && !page && d.file.fileName !== DECLARATIONS) continue;
    if (!d.file || !page || d.start === undefined) {
      problems.push({ file: d.file?.fileName ?? '(options)', line: 0, message });
      continue;
    }
    const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    const from = page.origin[line] ?? { file: page.name, line: line + 1 };
    problems.push({ file: from.file, line: from.line, message });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = await checkUi();
  for (const p of problems) console.error(`${p.file}:${p.line}  ${p.message.split('\n').join('\n    ')}`);
  console.error(problems.length ? `${problems.length} type error(s) in the UI scripts` : 'UI scripts type-check');
  process.exitCode = problems.length ? 1 : 0;
}

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type Token = { $type: string; $value: unknown; $description?: string };
const ROOT = new URL('../', import.meta.url);
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[._]/g, '-').toLowerCase();

/** Deliberately bounded DTCG subset; every emitted value is safe inside CSS and HTML. */
export function compileTokens(input: unknown): { values: Record<string, string>; css: string; palettes: Record<string, Record<string, string>>; brand: Record<string, string> } {
  const tokens = new Map<string, Token>(), names = new Set<string>();
  function walk(value: unknown, path: string[] = []): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid token group ${path.join('.')}`);
    const record = value as Record<string, unknown>;
    if ('$value' in record) {
      const name = path.join('.'), cssName = kebab(name);
      if (!name || names.has(cssName)) throw new Error(`Duplicate emitted token ${name}`);
      names.add(cssName); tokens.set(name, record as Token); return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key.startsWith('$')) continue;
      if (!/^[a-zA-Z0-9_\-]+$/.test(key)) throw new Error(`Invalid token key ${key}`);
      walk(child, [...path, key]);
    }
  }
  walk(input);
  const values: Record<string, string> = {}, visiting = new Set<string>();
  function resolve(name: string): string {
    if (values[name] !== undefined) return values[name]!;
    const token = tokens.get(name);
    if (!token) throw new Error(`Missing token alias ${name}`);
    if (visiting.has(name)) throw new Error(`Token alias cycle at ${name}`);
    visiting.add(name);
    const value = token.$value;
    let out: string;
    const alias = typeof value === 'string' && /^\{([^}]+)\}$/.exec(value);
    if (alias) {
      const target = tokens.get(alias[1]!);
      if (target && target.$type !== token.$type) throw new Error(`Alias type mismatch at ${name}`);
      out = resolve(alias[1]!);
    } else if (token.$type === 'color') {
      const c = value as { colorSpace?: string; components?: number[]; alpha?: number };
      if (!c || c.colorSpace !== 'srgb' || !Array.isArray(c.components) || c.components.length !== 3 || c.components.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || (c.alpha !== undefined && c.alpha !== 1)) throw new Error(`Invalid opaque sRGB colour ${name}`);
      out = `#${c.components.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    } else if (token.$type === 'dimension' || token.$type === 'duration') {
      const d = value as { value?: number; unit?: string };
      const units = token.$type === 'dimension' ? ['px', 'rem', 'em', 'ch'] : ['ms', 's'];
      if (!d || typeof d.value !== 'number' || !Number.isFinite(d.value) || d.value < 0 || !units.includes(d.unit ?? '')) throw new Error(`Invalid ${token.$type} ${name}`);
      out = `${d.value}${d.unit}`;
    } else if (token.$type === 'number' || token.$type === 'fontWeight') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (token.$type === 'fontWeight' && (value < 1 || value > 1000))) throw new Error(`Invalid number ${name}`);
      out = String(value);
    } else if (token.$type === 'fontFamily' || token.$type === 'string') {
      if (typeof value !== 'string' || !value || /[;{}<>\\\n\r]/.test(value)) throw new Error(`Invalid string ${name}`);
      out = value;
    } else throw new Error(`Unsupported token type ${token.$type} at ${name}`);
    visiting.delete(name); values[name] = out; return out;
  }
  for (const name of [...tokens.keys()].sort()) resolve(name);
  const palettes: Record<string, Record<string, string>> = { light: {}, dark: {} }, brand: Record<string, string> = {};
  const common: string[] = [];
  for (const name of Object.keys(values).sort()) {
    const mode = /^(light|dark)\.(.+)$/.exec(name);
    if (mode) palettes[mode[1]!]![kebab(mode[2]!)] = values[name]!;
    else {
      // Keep common aliases live so preference overrides propagate through roles.
      // Palette/brand exports still need resolved values for contrast calculations.
      const value = tokens.get(name)!.$value;
      const alias = typeof value === 'string' && /^\{([^}]+)\}$/.exec(value);
      const cssValue = alias && !/^(light|dark)\./.test(alias[1]!) ? `var(--mp-${kebab(alias[1]!)})` : values[name];
      common.push(`  --mp-${kebab(name)}: ${cssValue};`);
      if (name.startsWith('brand.')) brand[name.slice(6)] = values[name]!;
    }
  }
  if (JSON.stringify(Object.keys(palettes.light!).sort()) !== JSON.stringify(Object.keys(palettes.dark!).sort())) throw new Error('Light and dark palettes must define the same roles');
  const declarations = (mode: string) => Object.entries(palettes[mode]!).map(([k, v]) => `  --mp-${k}: ${v};`).join('\n');
  const css = `/* Generated by npm run design. Edit design/tokens.json. */\n:root {\n${common.join('\n')}\n${declarations('light')}\n  color-scheme: light;\n}\n:root[data-theme="dark"] {\n${declarations('dark')}\n  color-scheme: dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n${declarations('dark')}\n    color-scheme: dark;\n  }\n}\n`;
  return { values, palettes, brand, css };
}

/** Catch misspelled/removed tokens in static CSS references, including inline styles.
 * Runtime properties must be declared in CSS or setProperty; dynamic names are not checked.
 * This checks the source inventory, not CSS scope or the visual suitability of a role.
 */
export function checkTokenUsage(sources: Record<string, string>): void {
  const defined = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const match of source.matchAll(/(--mp-[\w-]+)\s*:/g)) defined.add(match[1]!);
    for (const match of source.matchAll(/setProperty\(['"](--mp-[\w-]+)['"]/g)) defined.add(match[1]!);
  }
  const errors: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/var\(\s*(--mp-[\w-]+)\s*[,)]/g)) {
      if (!defined.has(match[1]!)) errors.push(`${file}:${source.slice(0, match.index).split('\n').length}: undefined ${match[1]}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

async function sourceStyles(): Promise<Record<string, string>> {
  const files = (await readdir(new URL('src/', ROOT), { recursive: true })).map(file => file.replaceAll('\\', '/')).filter(file => /\.(css|html|js|ts)$/.test(file) && !['design/generated.ts', 'ui/design/tokens.css', 'ui/design/primitives.css'].includes(file));
  return Object.fromEntries(await Promise.all(files.map(async file => [`src/${file}`, await readFile(new URL(`src/${file}`, ROOT), 'utf8')])));
}

export async function buildDesign(): Promise<Record<string, string>> {
  const compiled = compileTokens(JSON.parse(await readFile(new URL('design/tokens.json', ROOT), 'utf8')));
  checkTokenUsage({ ...await sourceStyles(), 'design/tokens.json (compiled)': compiled.css });
  const registry: ComponentRegistry = JSON.parse(await readFile(new URL('design/components.json', ROOT), 'utf8'));
  validateComponents(registry);
  const legacy = JSON.parse(await readFile(new URL('design/legacy-controls.json', ROOT), 'utf8')) as Record<string,{maximum:number; reason:string}>;
  const roomFiles = ['room.html', ...(await readdir(new URL('src/ui/room/', ROOT))).filter(file=>file.endsWith('.js')).map(file=>`room/${file}`)];
  checkLegacyControls(Object.fromEntries(await Promise.all(roomFiles.map(async file=>[file,await readFile(new URL(`src/ui/${file}`,ROOT),'utf8')]))),legacy);
  const unions = [['UIButtonVariant', registry.components.button!.variants!], ['UIButtonSize', registry.components.button!.sizes!], ['UIIconButtonSize', registry.components.iconButton!.sizes!], ['UIFeedbackKind', registry.components.feedback!.variants!]] as const;
  const contracts = `// Generated by npm run design. Edit design/components.json.\n${unions.map(([name, values]) => `/** @typedef {${values.map(v => JSON.stringify(v)).join('|')}} ${name} */`).join('\n')}\nconst UI_COMPONENTS = ${JSON.stringify(registry.components, null, 2)};\n`;
  const primitives = '/* Generated by npm run design. Edit the modules listed in design/components.json. */\n' + (await Promise.all(registry.styles.map(file => readFile(new URL(`src/ui/design/${file}`, ROOT), 'utf8')))).join('\n');
  const scripts = Object.fromEntries(await Promise.all(registry.scripts.map(async file => [file, file === 'design/contracts.js' ? contracts : await readFile(new URL(`src/ui/${file}`, ROOT), 'utf8')])));
  checkComponentBoundaries(scripts);
  const componentJs = await readFile(new URL('src/ui/brand/icons.js', ROOT), 'utf8') + '\n' + Object.values(scripts).join('\n');
  const catalogueJs = await readFile(new URL('src/ui/design/catalogue.js', ROOT), 'utf8');
  return {
    'src/ui/design/contracts.js': contracts,
    'src/ui/design/primitives.css': primitives,
    'src/ui/design/tokens.css': compiled.css,
    'src/ui/design/palettes.js': `// Generated by npm run design.\nconst MP_PALETTES = ${JSON.stringify(compiled.palettes, null, 2)};\n`,
    'src/design/generated.ts': `// Generated by npm run design.\nexport const BRAND = ${JSON.stringify(compiled.brand, null, 2)} as const;\nexport const PALETTES = ${JSON.stringify(compiled.palettes, null, 2)} as const;\nexport const DESIGN_CSS = ${JSON.stringify(compiled.css)};\nexport const PRIMITIVES_CSS = ${JSON.stringify(primitives)};\nexport const COMPONENT_JS = ${JSON.stringify(componentJs)};\nexport const CATALOGUE_JS = ${JSON.stringify(catalogueJs)};\nexport const COMPONENTS = ${JSON.stringify(registry.components)} as const;\n`,
  };
}

interface ComponentRegistry {
  scripts: string[]; styles: string[];
  components: Record<string, {status:'preview'|'stable'|'deprecated'; factory:string; purpose:string; example:string; variants?:string[]; sizes?:string[]; states?:string[]}>;
}
export function validateComponents(registry: ComponentRegistry): void {
  for (const [name, component] of Object.entries(registry.components)) {
    if (!['preview','stable','deprecated'].includes(component.status) || !component.factory || !component.purpose || !component.example) throw new Error(`Incomplete component contract: ${name}`);
    for (const values of [component.variants, component.sizes, component.states]) {
      if (values && (!values.length || new Set(values).size !== values.length || values.some(v => !/^[a-z][a-zA-Z]*$/.test(v)))) throw new Error(`Invalid component options: ${name}`);
    }
  }
  for (const path of [...registry.scripts, ...registry.styles]) if (!/^[\w/.-]+\.(js|css)$/.test(path) || path.includes('..')) throw new Error(`Invalid component path: ${path}`);
}

/** Shared components cannot call room state, tool transport or product navigation. */
export function checkComponentBoundaries(scripts: Record<string, string>): void {
  const forbidden = new Set(['state','callTool','hostRequest','loadRoom','toast','$','$$','$first','root']);
  for (const [file, code] of Object.entries(scripts)) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) {
        const parent = node.parent;
        if (!(ts.isPropertyAccessExpression(parent) && parent.name === node) && !(ts.isPropertyAssignment(parent) && parent.name === node) && !(ts.isBindingElement(parent) && parent.propertyName === node)) {
          throw new Error(`${file}: shared component depends on product identifier ${node.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

/** Existing product-specific controls are a bounded migration inventory, never a growing parallel library. */
export function checkLegacyControls(sources: Record<string,string>, exceptions: Record<string,{maximum:number;reason:string}>): void {
  for (const [file, source] of Object.entries(sources)) {
    const count = [...source.matchAll(file.endsWith('.html') ? /<button\b/g : /\bel\(\s*['"]button['"]/g)].length;
    const exception=exceptions[file];
    if (count > (exception?.maximum ?? 0) || exception && !exception.reason.trim()) throw new Error(`${file}: ${count} raw buttons exceed the documented migration allowance; use uiButton/iconButton/uiMetadataAction or document an intentional exception`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  for (const [name, content] of Object.entries(await buildDesign())) {
    const dest = new URL(name, ROOT);
    if (check) {
      if (await readFile(dest, 'utf8').catch(() => '') !== content) throw new Error(`Generated design file drifted: ${name}`);
    } else await writeFile(dest, content);
  }
  console.log(check ? 'design outputs are current' : 'generated design outputs');
}

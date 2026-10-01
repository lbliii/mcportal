/**
 * Checks tool arguments against the tool's inputSchema before its handler runs, so a
 * schema and its handler can't quietly disagree. Covers the JSON Schema subset the
 * tools use: type (one or a list), properties, required, additionalProperties: false,
 * enum, items, minItems/maxItems, minimum/maximum, minLength/maxLength. Anything else
 * in a schema is documentation and isn't checked. No coercion: "2" is not an integer.
 */
export type JsonSchema = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

const ARTICLE: Record<string, string> = { object: 'an object', array: 'a list', string: 'a string', integer: 'a whole number', number: 'a number', boolean: 'true or false', null: 'null' };

/** The first problem with `value`, phrased for the model (e.g. "column must be a whole number"), or undefined. */
export function schemaProblem(schema: JsonSchema, value: unknown, path = 'arguments'): string | undefined {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  if (types.length && !types.some((t) => matchesType(value, t))) return `${path} must be ${types.map((t) => ARTICLE[t] ?? t).join(' or ')}`;

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  if (typeof value === 'string') {
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) return `${path} must be at most ${schema.maxLength} characters`;
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) return `${path} must be at least ${schema.minLength} characters`;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path} can have at most ${schema.maxItems} entries`;
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} entries`;
    if (isObject(schema.items)) {
      for (let i = 0; i < value.length; i++) {
        const problem = schemaProblem(schema.items, value[i], `${path}[${i}]`);
        if (problem) return problem;
      }
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const prefix = path === 'arguments' ? '' : `${path}.`;
    for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (value[key] === undefined) return `${prefix}${key} is required`;
    }
    for (const [key, v] of Object.entries(value)) {
      const sub = properties[key];
      if (sub === undefined) {
        if (schema.additionalProperties === false) {
          const known = Object.keys(properties);
          return `${prefix}${key} isn't a known argument${known.length ? ` (expected ${known.join(', ')})` : ''}`;
        }
        continue;
      }
      if (v === undefined || !isObject(sub)) continue;
      const problem = schemaProblem(sub, v, `${prefix}${key}`);
      if (problem) return problem;
    }
  }
  return undefined;
}

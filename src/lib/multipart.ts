/**
 * Just enough multipart/form-data for our own upload forms: a few text fields and
 * one file. Dependency-free; the caller caps the body size before parsing.
 */
export interface Part {
  filename?: string;
  data: Buffer;
}

const MAX_PARTS = 10;

export function boundaryOf(contentType: string | undefined): string | undefined {
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) return undefined;
  const m = contentType.match(/boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** Parts by field name. Throws on a malformed body. */
export function parseMultipart(body: Buffer, boundary: string): Map<string, Part> {
  const parts = new Map<string, Part>();
  const open = Buffer.from(`--${boundary}`);
  const next = Buffer.from(`\r\n--${boundary}`);
  let pos = body.indexOf(open);
  if (pos === -1) throw new Error('Not multipart form data');
  while (parts.size < MAX_PARTS) {
    let start = pos + open.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;   // closing delimiter
    if (body.subarray(start, start + 2).toString('latin1') !== '\r\n') throw new Error('Malformed multipart body');
    start += 2;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) throw new Error('Malformed multipart body');
    const headers = body.subarray(start, headerEnd).toString('utf8');
    const end = body.indexOf(next, headerEnd + 4);
    if (end === -1) throw new Error('Malformed multipart body');
    const disposition = headers.match(/content-disposition:[^\r\n]*/i)?.[0] ?? '';
    const name = disposition.match(/\bname="([^"]*)"/i)?.[1];
    const filename = disposition.match(/\bfilename="([^"]*)"/i)?.[1];
    if (name !== undefined && !parts.has(name)) parts.set(name, { ...(filename !== undefined ? { filename } : {}), data: body.subarray(headerEnd + 4, end) });
    pos = end + 2;
  }
  return parts;
}

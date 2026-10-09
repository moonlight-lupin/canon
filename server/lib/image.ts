// What an uploaded file is, from its first bytes, and the pixel size of a PNG / JPEG / WebP picture from its header
// (no image library needed).

export type FileType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export const PICTURE_TYPES: readonly FileType[] = ['image/png', 'image/jpeg', 'image/webp'];
export const PICTURE_OR_PDF: readonly FileType[] = [...PICTURE_TYPES, 'application/pdf'];

/** A file's type from its first bytes — never from what the browser or the file's name says. */
export function sniffType(b: Buffer): FileType | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * The type to store an upload as: what its bytes are, when that is one of `allowed`; anything else is refused with
 * `refuse`. What the upload declared doesn't count (Daedalus Workshop study of 0.19.10: some paths stored it as
 * declared, and imported templates and library files stored any type at all).
 */
export function realType(data: Buffer, allowed: readonly FileType[], refuse: string): FileType {
  const t = Buffer.isBuffer(data) ? sniffType(data) : null;
  if (!t || !allowed.includes(t)) throw Object.assign(new Error(refuse), { status: 400 });
  return t;
}

export function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  return null;
}

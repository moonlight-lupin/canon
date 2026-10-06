// A small ZIP writer (0.15.6, Settings → Export data → Everything): deflated files with UTF-8 names, opened by
// Windows, macOS and every unzip tool. Node's zlib does the compression and the CRC-32.
import zlib from 'node:zlib';

export interface ZipFile { name: string; data: Buffer | string; date?: Date }

const dosTime = (d: Date) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
const dosDate = (d: Date) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export function zip(files: ZipFile[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const name = Buffer.from(f.name, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data) >>> 0;
    const d = f.date ?? new Date();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime(d), 10);
    local.writeUInt16LE(dosDate(d), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, deflated);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime(d), 12);
    cd.writeUInt16LE(dosDate(d), 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal and external attributes: 0
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + deflated.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

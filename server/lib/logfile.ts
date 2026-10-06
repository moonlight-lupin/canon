// Canon's log file (0.15.7): everything the server prints also goes to data/logs/canon-YYYY-MM-DD.log (next to the
// database), one file a day, the last 30 kept — so when Canon stops, the reason is on disk even though the launcher's
// window is gone. A crash (an error nothing caught) is written there before Canon exits, and the launcher restarts it.
import fs from 'node:fs';
import path from 'node:path';

const KEEP_DAYS = 30;

export function startLogFile(dir: string, version = '') {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return; // no log file, but Canon still runs
  }
  const day = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const write = (chunk: unknown) => {
    try {
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      // a time at the start of each line
      const lines = text.replace(/\n$/, '').split('\n').map((l) => `${stamp()} ${l}`).join('\n');
      fs.appendFileSync(path.join(dir, `canon-${day()}.log`), lines + '\n');
    } catch { /* never let logging stop Canon */ }
  };
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      write(chunk);
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
  }
  // a crash: write it down, then exit with an error so the launcher starts Canon again
  const crash = (kind: string) => (e: unknown) => {
    console.error(`Canon stopped: ${kind}: ${(e as Error)?.stack ?? String(e)}`);
    process.exit(1);
  };
  process.on('uncaughtException', crash('an unexpected error'));
  process.on('unhandledRejection', crash('an unhandled promise rejection'));
  // keep the last KEEP_DAYS days
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^canon-(\d{4}-\d{2}-\d{2})\.log$/);
      if (m && Date.parse(`${m[1]}T00:00:00`) < cutoff) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch { /* ignore */ }
  console.log(`Canon ${version} starting (log: ${dir})`.replace('  ', ' '));
}

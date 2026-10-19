// Checking a melody in numbered notation on the server (0.21.0), for AI assistants (canon_melody, canon_save_melody):
// jpFun compiles it and lays it out — nothing is drawn here — in a worker thread with a memory and a time limit (a
// melody that asks for too much ends that thread, not Canon). What happens around jpFun is shared/jianpu-prep.ts, as in
// the browser; problems come back by line and column, in Canon's words where it has them, with jpFun's own beside.
import { Worker } from 'node:worker_threads';
import { fillHint, jianpuHint } from '../../shared/jianpu-messages.ts';
import { normalizeJianpu, type MelodyResult } from '../../shared/jianpu-prep.ts';

export interface JianpuCheck {
  /** it can be drawn and has no errors (warnings may remain) */
  ok: boolean;
  problems: { level: 'error' | 'warning'; code: string; line: number; column: number; message: string; jpfun_message: string }[];
  summary: { key: string | null; meter: string | null; lines: number; lyric_lines: number; new_lines_added_by_canon: number };
  /** Chinese-keyboard punctuation in the notes that was read as notation (e.g. "，" as ",") */
  read_as_notation?: string[];
}

export const CHECK_TIME_LIMIT_MS = 8000;
const MEMORY_MB = 256;

/** Check (or draw) one melody in a worker thread with a memory and a time limit; what ends the thread comes back as C_TOO_SLOW. */
export function inWorker(source: string, timeLimitMs: number, draw = false): Promise<MelodyResult> {
  return new Promise((resolve) => {
    const failed = (code: string, message = ''): MelodyResult => ({ svgs: [], problems: [{ code, error: true, line: 1, column: 1, message }], changed: [], autoBreaks: 0, lineCount: 0 });
    const w = new Worker(new URL('./jianpu-worker.ts', import.meta.url), { workerData: { source, draw }, resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB, maxYoungGenerationSizeMb: 32 } });
    let settled = false;
    const end = (r: MelodyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void w.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => end(failed('C_TOO_SLOW')), timeLimitMs);
    w.once('message', (r: MelodyResult) => end(r));
    // out of memory, or anything else that ended the thread
    w.once('error', () => end(failed('C_TOO_SLOW')));
    w.once('exit', () => end(failed('C_TOO_SLOW')));
  });
}

export async function checkJianpu(source: string, o: { timeLimitMs?: number } = {}): Promise<JianpuCheck> {
  const r = await inWorker(source, o.timeLimitMs ?? CHECK_TIME_LIMIT_MS);
  const notes = normalizeJianpu(source).text;
  const problems = r.problems.map((p) => {
    const hint = jianpuHint(p.code, p.message, p.vars);
    return { level: p.error ? 'error' as const : 'warning' as const, code: p.code, line: p.line, column: p.column, message: hint ? fillHint(hint.template, hint.vars) : p.message, jpfun_message: p.message };
  });
  return {
    ok: !problems.some((p) => p.level === 'error'),
    problems,
    summary: {
      key: /@(?:1|key)\(\s*([^),\s]+)/.exec(notes)?.[1] ?? null,
      meter: (([, n, d]) => (n ? `${n}/${d}` : null))(/@meter\(\s*(\d+)\s*,\s*(\d+)/.exec(notes) ?? []),
      lines: r.lineCount,
      lyric_lines: (notes.match(/^\s*L(\([^)]*\))?\s*:/gm) ?? []).length,
      new_lines_added_by_canon: r.autoBreaks,
    },
    ...(r.changed.length ? { read_as_notation: r.changed } : {}),
  };
}

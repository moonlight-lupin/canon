// Checking a melody in numbered notation on the server (0.21.0), for AI assistants (canon_melody, canon_save_melody):
// jpFun compiles it and lays it out — nothing is drawn here — and its problems come back by line and column, in Canon's
// words where it has them (shared/jianpu-messages.ts), with jpFun's own (Chinese) message beside.
import { compileScore, ErrorDiagnostic } from 'jpfun';
import { fillHint, jianpuHint } from '../../shared/jianpu-messages.ts';

export interface JianpuCheck {
  /** it can be drawn and has no errors (warnings may remain) */
  ok: boolean;
  problems: { level: 'error' | 'warning'; code: string; line: number; column: number; message: string; jpfun_message: string }[];
  summary: { key: string | null; meter: string | null; lines: number; lyric_lines: number };
}

type Diag = { code?: string; message?: string; span?: { start: number } };

export function checkJianpu(source: string): JianpuCheck {
  const lineStarts = [0, ...[...source.matchAll(/\n/g)].map((m) => m.index! + 1)];
  const at = (offset: number) => {
    let i = lineStarts.length - 1;
    while (i > 0 && lineStarts[i] > offset) i--;
    return { line: i + 1, column: offset - lineStarts[i] + 1 };
  };
  const problem = (d: Diag, level: 'error' | 'warning') => {
    const msg = d.message ?? String(d);
    const hint = jianpuHint(d.code, msg);
    return { level, code: d.code ?? 'E_UNKNOWN', ...at(d.span?.start ?? 0), message: hint ? fillHint(hint.template, hint.vars) : msg, jpfun_message: msg };
  };
  const summary = {
    key: /@(?:1|key)\(\s*([^),\s]+)/.exec(source)?.[1] ?? null,
    meter: (([, n, d]) => (n ? `${n}/${d}` : null))(/@meter\(\s*(\d+)\s*,\s*(\d+)/.exec(source) ?? []),
    lines: 0,
    lyric_lines: (source.match(/^\s*L(\([^)]*\))?\s*:/gm) ?? []).length,
  };
  try {
    const r = compileScore(source);
    // the same problem can come from both stages: list it once
    const seen = new Set<string>();
    const problems = [...r.diagnostics, ...r.layout.diagnostics]
      .filter((d) => { const k = `${d.code} ${d.span?.start} ${d.message}`; return !seen.has(k) && !!seen.add(k); })
      .map((d) => problem(d, d instanceof ErrorDiagnostic ? 'error' : 'warning'));
    return { ok: !problems.some((p) => p.level === 'error'), problems, summary: { ...summary, lines: r.layout.lineCount } };
  } catch (e) {
    // jpFun stops at the first error it can't get past, and throws it
    return { ok: false, problems: [problem(e as Diag, 'error')], summary };
  }
}

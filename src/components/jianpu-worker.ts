// Draws melodies away from the page (0.21.0): jpFun runs here, so a melody that takes too long can be stopped
// (src/components/jianpu.ts ends this worker after a time limit) without freezing the song editor or Outputs → Sheet
// music. Everything around jpFun is shared/jianpu-prep.ts, as on the server.
import * as jp from 'jpfun';
import { runJianpu, type JpFunLike, type MelodyResult } from '../../shared/jianpu-prep.ts';

// lyrics and notes are measured with the browser's own fonts, as they are drawn
let measurer: InstanceType<typeof jp.CanvasTextMeasurer> | null = null;
try {
  const ctx = new OffscreenCanvas(8, 8).getContext('2d');
  if (ctx) measurer = new jp.CanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);
} catch { /* jpFun's own estimate then */ }

self.onmessage = (e: MessageEvent<{ id: number; source: string }>) => {
  let result: MelodyResult;
  try {
    result = runJianpu(jp as unknown as JpFunLike, e.data.source, {
      draw: true,
      compileOptions: measurer ? { textMeasurer: measurer } : {},
      svgOptions: { background: '#fff' },
    });
  } catch (err) {
    result = { svgs: [], problems: [{ code: 'E_BUG', error: true, line: 1, column: 1, message: String((err as Error)?.message ?? err) }], changed: [], autoBreaks: 0, lineCount: 0 };
  }
  (self as unknown as Worker).postMessage({ id: e.data.id, result });
};

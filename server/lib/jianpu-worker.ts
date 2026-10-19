// A worker thread that checks — or draws — one melody (0.21.0; drawing 0.21.3): jpFun runs here, with a memory limit and
// a time limit set by its caller (server/lib/jianpu-check.ts, server/lib/jianpu-image.ts), so a melody that asks for
// too much ends this thread — never Canon itself.
import { parentPort, workerData } from 'node:worker_threads';
import * as jp from 'jpfun';
import { runJianpu, type JpFunLike } from '../../shared/jianpu-prep.ts';

// No browser here to measure the words with the fonts that draw them: jpFun's own estimate, a little wider for words
// (the Chinese fonts that draw them — Microsoft YaHei, Noto Sans CJK — have wide Latin letters), so they never touch.
const estimate = new jp.DefaultTextMeasurer();
const textMeasurer = {
  measureText(text: string, style: Parameters<typeof estimate.measureText>[1]) {
    const m = estimate.measureText(text, style);
    return style.fontFamily?.toLowerCase().includes('mono') ? m : { ...m, w: m.w * 1.15 };
  },
};

const draw = !!workerData.draw;
parentPort!.postMessage(runJianpu(jp as unknown as JpFunLike, String(workerData.source), { draw, ...(draw ? { compileOptions: { textMeasurer } } : {}) }));

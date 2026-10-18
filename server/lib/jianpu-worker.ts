// A worker thread that checks one melody (0.21.0): jpFun runs here, with a memory limit and a time limit set by
// server/lib/jianpu-check.ts, so a melody that asks for too much ends this thread — never Canon itself.
import { parentPort, workerData } from 'node:worker_threads';
import * as jp from 'jpfun';
import { runJianpu, type JpFunLike } from '../../shared/jianpu-prep.ts';

parentPort!.postMessage(runJianpu(jp as unknown as JpFunLike, String(workerData.source), { draw: false }));

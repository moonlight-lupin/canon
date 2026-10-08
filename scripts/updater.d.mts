// Types for scripts/updater.mjs (plain JavaScript, shared with the launcher).
export const REPO: string;
export const RESTART_FOR_UPDATE: number;
export interface ReleaseFile { name: string; data: Buffer; mode: number }
export interface FilesRecord { added: string[]; removed: string[] }
export interface GitRecord { previous: string; branch: string | null }
export interface Pending {
  from: string;
  to: string;
  kind: 'git' | 'download';
  at: string;
  by?: string;
  status: 'installing' | 'rolled-back';
  git?: GitRecord;
  files?: FilesRecord;
  error?: string;
}
export function stateDir(root: string): string;
export function pendingFile(root: string): string;
export function versionParts(v: string): number[];
export function compareVersions(a: string, b: string): number;
export function installKind(root: string): 'git' | 'download';
export function readPending(root: string): Pending | null;
export function writePending(root: string, p: Pending): void;
export function clearPending(root: string): void;
export function readTarGz(gz: Buffer): ReleaseFile[];
export function applyFiles(root: string, files: ReleaseFile[]): FilesRecord;
export function gitProblem(root: string): string | null;
export function applyGit(root: string, tag: string, url: string): GitRecord;
export function rollback(root: string, pending?: Pending | null): boolean;

// CI on macOS: every font the "PowerPoint for Keynote (Mac)" export may name (shared/slide-fonts.ts) is installed on
// a plain Mac. Asks macOS for its font families (AppKit, through a small Swift script) and fails on any missing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SYSTEM_FONTS, SYSTEM_DEFAULT_FONT, SYSTEM_UI_FONT } from '../shared/slide-fonts.ts';

if (process.platform !== 'darwin') {
  console.log('check-mac-fonts: not a Mac, skipped');
  process.exit(0);
}
const swift = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'canon-fonts-')), 'families.swift');
fs.writeFileSync(swift, 'import AppKit\nfor f in NSFontManager.shared.availableFontFamilies { print(f) }\n');
const have = new Set(execFileSync('swift', [swift], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean));
const want = [...new Set([...SYSTEM_FONTS.mac, ...Object.values(SYSTEM_DEFAULT_FONT.mac), SYSTEM_UI_FONT.mac])];
const missing = want.filter((f) => !have.has(f));
console.log(`macOS ${os.release()}: ${have.size} font families; ${want.length} named by the Keynote export`);
if (missing.length) {
  console.error(`missing on this Mac: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('all present');

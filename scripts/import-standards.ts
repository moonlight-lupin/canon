// Import the Westminster Standards (public domain) as library texts in numbered parts.
//   npm run import:standards            -> add the Shorter Catechism (wsc), Larger Catechism (wlc) and Confession (wcf)
//   npm run import:standards -- --force -> also overwrite them if they already exist (discards church edits)
// Source files are cached in data/standards-src/ and downloaded on first use from
// https://github.com/NonlinearFruit/Creeds.json/tree/master/creeds
import { importStandards } from '../server/repo/library.ts';

const res = await importStandards({ force: process.argv.includes('--force'), log: console.log });
for (const r of res) console.log(`${r.key}: text #${r.id}, ${r.parts} parts — ${r.action}`);

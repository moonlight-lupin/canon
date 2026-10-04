// Import public-domain Bibles into the Canon database.
//   npm run import:bible                 -> the Bibles configured for the church's languages (default KJV + CUVS)
//   npm run import:bible -- KJV CUVT BSB -> specific translations from the catalog in shared/languages.ts
// Source files are cached in data/bible-src/ and downloaded on first use from
// https://github.com/scrollmapper/bible_databases/tree/master/formats/json
import { importBible } from '../server/repo/bible.ts';
import { getSettings } from '../server/repo/settings.ts';
import { BIBLE_SOURCES } from '../shared/languages.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = args.length
  ? args
  : [...new Set(getSettings().languages.map((l) => getSettings().bibles[l]).filter((c): c is string => !!c && c in BIBLE_SOURCES))];
if (process.argv.includes('--trad') && !wanted.includes('CUVT')) wanted.push('CUVT');

for (const code of wanted) {
  try {
    await importBible(code);
  } catch (e) {
    console.warn(`skip ${code}: ${(e as Error).message}`);
  }
}

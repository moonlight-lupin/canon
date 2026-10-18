// Melodies in numbered notation (jianpu, jpFun's notation — docs/JIANPU-NOTATION.md) for songs of Canon's bundled
// library, by song key (0.21.2). All public domain; each was read note by note from a public-domain source and checked
// with Canon's own check (shared/jianpu-prep.ts; tests/seed-melodies.test.ts keeps them drawing without problems):
//  - OLD HUNDREDTH and GREATOREX: the Cyber Hymnal / CCEL (ccel.org/cceh, tunes 6 and 5), MIDI and score
//  - QUAM DILECTA (George F. Root, 1820–1895): Hymnary.org's melody score; 颂主新歌 #618 sets it in D♭
//  - Threefold Amen (Danish, anonymous): Hymnary.org (marked public domain)
// A song gets its melody when the library adds it, or once when the song is already there without one (seed/index.ts):
// a melody the church typed or changed is never touched. A rest and a slurred or tied note's second note get `{}` in
// the words: in jpFun each takes a word.

export const SEED_MELODIES: Record<string, string> = {
  doxology: `% OLD HUNDREDTH (Louis Bourgeois, Genevan Psalter 1551), as in the Cyber Hymnal / CCEL (even crotchets)
@1(G4)
@meter(4, 4)
N: {
  1 1 7, 6, | 5, 1 2 3 | @br()
  3 3 3 2 | 1 4 3 2 | @br()
  1 2 3 2 | 1 6, 7, 1 | @br()
  5 3 1 2 | 4 3 2 1 ||
}
L: Praise God, from whom all bless- ings flow; Praise him, all crea- tures here be- low; Praise him a- bove, ye heaven- ly host; Praise Fa- ther, Son, and Ho- ly Ghost.
L: 赞美真神万福之根，世上万民都当颂扬，天上万军也当赞美，赞美圣父、圣子、圣灵。`,

  'gloria-patri': `% GREATOREX (Henry W. Greatorex, 1851), as in the Cyber Hymnal / CCEL
@1(Eb4)
@meter(4, 4)
N: {
  1. 1/ 1 1/ 1/ | 1 7, 0 1 | 2 - 5 - | 5 5 5 6 | 7 - 6 - | @br()
  5 - 0 5/ 5/ | 5 3 6 5 | 5 4 0 4 | 4 2 5 4 | 4 3 0 0 | @br()
  7 - 7 7 | 1' - 1 2 | 3 - 3 2 | 1 - - - ||
}
L: Glo- ry be to the Fa- ther, {} and to the Son, and to the Ho- ly Ghost; {} as it was in the be- gin- ning, {} is now, and ev- er shall be, {} {} world with- out end. A- {} men, A- {} men.`,

  'the-lord-is-in-his-holy-temple': `% QUAM DILECTA (George F. Root, 1820-1895); words Habakkuk 2:20, as Root sets them (repeated)
@1(Db4)
@meter(4, 4)
N: {
  3 | 3. 3/ 3/ 3/ 3/ 3/ | 3 4 3 3 | 5. 5/ 5/ 5/ 5/ 5/ | 5 6 5 5 | @br()
  4. 4/ 4 4 | 3 3 0 6 | 5 3 1 2 | 3 - 3 4 | 2 - - - | @br()
  1 - 0 1 | 1 1 0 1 | 1 1 0 1 | 1 - 7, - | 1 - - ||
}
L: The Lord is in His ho- ly tem- {} ple, The Lord is in His ho- ly tem- {} ple; let all the earth keep si- lence, {} let all the earth keep si- lence be- fore Him, {} keep si- lence, {} keep si- lence, {} be- fore {} Him.`,

  'threefold-amen': `% Threefold Amen (Danish, anonymous)
@1(F4)
@meter(4, 4)
N: { 3 - 2 - | 1 - 7, - | 6, 2 1 7, | 1 - - - || }
L: A- men, A- men, A- {} {} {} men.
L: 阿 们， 阿 们， 阿 {} {} {} 们。`,
};

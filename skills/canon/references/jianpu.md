# Numbered notation (jianpu) for Canon melodies

How to write a song's melody for `canon_melody` and `canon_save_melody`. Canon draws melodies with
[jpFun](https://github.com/madderscientist/jpFun) (Apache-2.0); this is a short guide, in our words, to the part of its
notation a hymn needs. jpFun's own full reference (in Chinese) is its `grammar.md`.

Check every melody with `canon_melody {"source": …}` before saving it. Its problems come back by line and column, in
plain English.

## The shape of a melody

```jianpu
@1(G4)
@meter(4, 4)
N: {
  1 - 1 7, | 6, 5, 1 2 | 3 - - - | @br()
  3 3 3 2 | 1 4 3 - | 2 - - - ||
}
L: Praise God, from whom all bless- ings flow; praise him, all crea- tures here be- low;
L: 赞美真神万福之根，世上万民都当颂扬，
```

1. `@1(G4)` is the key: "1 = G". It takes a note name, an optional `#` or `b`, and an octave: `@1(C4)`, `@1(Eb4)`,
   `@1(F#4)`. Octave 4 is the one around middle C.
2. `@meter(4, 4)` is the time signature (`@meter(3, 4)`, `@meter(6, 8)`).
3. `N: { … }` holds the notes. The braces let the notes run over several source lines. **Without them, two `N:`
   lines become two parts sung at the same time**, stacked like a choir score.
4. `L:` lines hold the words, one line per stanza or language, in the order they are printed under the music.

## Notes

| Write | Means |
|---|---|
| `1` … `7` | the notes of the scale (do re mi fa sol la ti) |
| `0` | a rest |
| `5,` `5,,` | an octave lower, two octaves lower (a comma per octave) |
| `1'` `1''` | an octave higher, two octaves higher (an apostrophe per octave) |
| `#4` `b7` `n7` | sharp, flat, natural (before the number) |

A plain note is one beat (a crotchet). Then:

| Write | Means |
|---|---|
| `1 -` | the note held one more beat (a minim); `1 - - -` is four beats. A `-` can carry a note over a bar line: `3 - | - 2` |
| `1/` | half a beat (a quaver); `1//` a quarter beat (a semiquaver) |
| `1.` | dotted: one and a half beats; `1/.` a dotted quaver |
| `5@a … 5@b` with `@tie(a, b)` after the notes | a tie: the same note held over (sung as one, so it takes one syllable) |

Bar lines: `|` a bar line, `||` a double bar (the end), `|:` and `:|` repeat signs.

Each bar should fill the time signature. The first bar may be short (an upbeat), as in `5, | 1 1 2 | 3 - - ||` in 3/4.
`canon_melody` warns about a bar that doesn't fill it.

## Lines

`@br()` starts a new line of music. **Keep the parentheses**: a bare `@br` is ignored without any warning. Break where
the hymnal breaks (usually at the end of a phrase or a line of the words), so the words have room. A whole hymn on one
line is squeezed until its words overlap.

## Words

- Each `L:` line gives one syllable to each note that is sung. Rests, `-` and the second note of a tie take none.
- **Chinese** is split into characters by itself: write the line as it is printed, punctuation included
  (`赞美真神万福之根，`).
- **English**: separate words with spaces, and split a word into syllables with a hyphen and a space: `bless- ings`,
  `crea- tures`. The hyphen is printed.
- **A syllable held over two different notes** (a slur): write `{}` for the second note, which gives it no word:
  `L: a {} b c`.
- **Two characters on one note**: wrap them in braces: `{你好}`.
- Keep each `L:` on one source line.
- Don't use `""` (it is printed as two quote marks) or `_` (it is printed as an underscore) as an empty syllable.

## A second example: 3/4 with an upbeat, quavers and a held syllable

This is a made-up tune, to show the notation:

```jianpu
@1(F4)
@meter(3, 4)
N: {
  5, | 1 1/ 2/ 3 | 2 - 1 | 3 4 5 | 6 - @br()
  5 | 6 5 4 | 3 2 1 | 2 - 7, | 1 - - ||
}
L: Glo- ry be to God our King, for his good- ness {} let us sing; our prais- es ev- er bring.
L: 荣耀尊贵都归给天上君王，{}同声歌唱赞美主圣名。
```

## What Canon checks, and the rules

- `canon_melody {"source": …}` returns `ok` (no errors), the problems (each with `line`, `column`, a `message` in
  English and `jpfun_message`, jpFun's own words in Chinese) and a summary (key, time signature, lines, lines of words).
  Fix every error. Fix the warnings too, unless one is intended (a short first bar).
- `canon_save_melody` refuses a melody with errors. It replaces a song's melody only with `"replace": true`: a
  musician may have typed it, so ask the user first.
- Only songs the administrator allows: public-domain songs, or every song when the church's licence lets it copy or
  arrange the music (Settings → AI / MCP → Library → Melodies). Write the tune the church sings, from its own
  hymnal's sheet music (`canon_sheet_music`, when shared) or from the user. Never write a melody from memory.
- The melody is for the church's musicians inside Canon. Don't pass the jianpu text on outside the conversation.
- `%` starts a comment that runs to the end of the line.

// What jpFun's problems mean, in Canon's words (0.21.0). jpFun writes its messages in Chinese, with the details inside
// the sentence; each has a stable code. For the codes someone typing a hymn meets, this gives an English sentence
// (translated like any other: t() on screen) with its details taken out of jpFun's message. Other codes keep jpFun's
// own message. Used by the song editor; English for AI assistants.

/** English templates by jpFun code; {fn} a function's name, {arg} an argument, {value} what was written, {other} what jpFun used instead, {beats}/{meter} a bar. */
export const JIANPU_HINTS: Record<string, string> = {
  E_MISSING_REQUIRED_ARG: '@{fn} is missing a value it needs ({arg}). For example: @meter(4, 4), @1(G4).',
  E_WRONG_ARG_TYPE: 'A value given to @{fn} is the wrong kind.',
  E_POSARG_AFTER_KWARG: 'In @{fn}, put the plain values before the named ones.',
  E_EMPTY_CONTENT: '@{fn} has nothing inside it.',
  W_EMPTY_CONTENT: '@{fn} has nothing inside it.',
  E_UNKNOWN_FUNCTION: 'There is no @{fn}: check the spelling (for example @meter, @1, @br()).',
  W_UNKNOWN_FUNCTION: 'There is no @{fn}: check the spelling (for example @meter, @1, @br()).',
  E_UNTERMINATED_CALL: '@{fn}( is not closed: add the ).',
  E_UNTERMINATED_String: 'A quotation mark is not closed.',
  W_UNMATCHED_BRACE: 'A { has no closing }.',
  W_TOO_MANY_POS_ARGS: '@{fn} was given too many values.',
  W_UNKNOWN_NAMED_ARG: '@{fn} doesn’t take “{value}”.',
  W_INVALID_NUMBER: '“{value}” is not a number.',
  E_INVALID_TONALITY: 'The key “{value}” can’t be read. Write a note name and an octave, e.g. @1(G4) or @1(Eb4).',
  E_KEY_TONALITY: 'The key “{value}” can’t be read. Write a note name and an octave, e.g. @1(G4) or @1(Eb4).',
  W_KEY_TONALITY: 'The key “{value}” isn’t written the usual way, so {other} is used. Write a note name and an octave, e.g. @1(G4).',
  W_METER_INVALID: 'The time signature can’t be read, so 4/4 is used. Write it as @meter(3, 4).',
  W_METER_MISMATCH: 'This bar has {beats} beats, but the time signature is {meter}.',
  E_WRONG_NOTE_NAME: 'A note can’t be read. Notes are 1 to 7, 0 is a rest; a comma after a note is an octave lower, an apostrophe an octave higher.',
  E_LYRICS_WITHOUT_VOICE_NOTES: 'An L: line has to come right after the notes it goes with (the N: line).',
  W_VOICES_TEXT_BETWEEN: 'There is something between two lines of notes. Put a melody that runs over several lines inside N: { … }.',
  W_EMPTY_LYRIC: 'A line of words is empty.',
  E_BREAK_INSIDE_EVENT: 'A line break cuts through a note that is still sounding. Move the @br() to a bar line.',
  W_BR_OFFSET: '@br() takes a whole number of lines, 1 or more.',
  E_PAGE_OVERFLOW: 'A line is too tall for the page.',
  E_BUG: 'jpFun could not read this (a fault in jpFun itself).',
  // Canon's own (shared/jianpu-prep.ts)
  C_BR_TOO_MANY: '@br({value}) asks for too many lines: use @br() for a new line (at most @br({max})).',
  C_NUMBER_TOO_LARGE: '{value} is far larger than a melody needs (at most {max}).',
  C_TOO_MANY_BARS: 'This has {value} bars: a melody here can have up to {max}.',
  C_TOO_MANY_HELD: 'This has {value} held beats (-): a melody here can have up to {max}.',
  C_TOO_DEEP: 'Brackets go more than {max} deep.',
  C_TOO_MANY_LINES: 'This would be drawn on {value} lines: a melody here can have up to {max}.',
  C_AUTO_BREAKS: 'No @br() yet, so Canon starts a new line every {bars} bars. Add @br() where the hymnal starts a new line to place them yourself.',
  C_WORDS_LEFT_OVER: 'This line of words has {count} more than there are notes for, from “{first}”: they are not shown.',
  C_TOO_SLOW: 'This melody takes too long to draw. Look for a very large number or a very long line.',
};

/** Canon's sentence for a problem (jpFun's, details read from its message; Canon's own C_ codes, details given); null when the code has none (show jpFun's message). */
export function jianpuHint(code: string | undefined, message: string, given?: Record<string, string>): { template: string; vars: Record<string, string> } | null {
  const template = code ? JIANPU_HINTS[code] : undefined;
  if (!template) return null;
  if (given) return { template, vars: given };
  const vars: Record<string, string> = {
    fn: /@([^\s(（，,:：]+)/.exec(message)?.[1] ?? '',
    value: /["“]([^"”]*)["”]/.exec(message)?.[1] ?? '',
    arg: /参数\s*(\S+)\s*$/.exec(message)?.[1]?.replace(/^"|"$/g, '') ?? '',
    beats: /([\d./]+)\s*QN/.exec(message)?.[1] ?? '?',
    meter: /(\d+\s*\/\s*\d+)\s*拍号/.exec(message)?.[1]?.replace(/\s/g, '') ?? '?',
    other: /切换到\s*(\S+)/.exec(message)?.[1] ?? '',
  };
  return { template, vars };
}

/** Fill a template's {placeholders}. */
export const fillHint = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

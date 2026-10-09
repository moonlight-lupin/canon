// The church's calendar day (0.20.0): "today" and every date boundary in the church's time zone (Settings → Church),
// not the UTC date, which is a day behind in Singapore and Malaysia (UTC+8) between midnight and 8 am. Used on the
// server (server/lib/dates.ts) and in the web app.

const DAY = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;

/** Is this a time zone the computer knows (an IANA name such as "Asia/Singapore")? */
export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The date (YYYY-MM-DD) at a moment in a time zone; without one (or an unknown one), this computer's. */
export function dayIn(zone?: string | null, at: Date = new Date()): string {
  const z = zone && validZone(zone) ? zone : undefined;
  return new Intl.DateTimeFormat('en-CA', { ...DAY, timeZone: z }).format(at);
}

/** This computer's own time zone (the TZ variable in Docker). */
export const computerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

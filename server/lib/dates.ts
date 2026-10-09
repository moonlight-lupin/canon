// The church's "today" on the server: in its time zone (Settings → Church → Time zone), else this computer's.
// Every "today" and date boundary goes through here (tests/time-zone.test.ts checks no other is worked out from UTC).
import { computerZone, dayIn } from '../../shared/dates.ts';
import { getSettings } from '../repo/settings.ts';

/** The church's time zone: the setting, or this computer's when none is set. */
export const churchZone = () => getSettings().time_zone || computerZone();

/** Today's date (YYYY-MM-DD) in the church's time zone. */
export const churchToday = (at: Date = new Date()) => dayIn(churchZone(), at);

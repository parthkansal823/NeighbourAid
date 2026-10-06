const HOUR_MS = 3_600_000
const AWARE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i
const EVENTS = new Set(['posted', 'accepted', 'started', 'done', 'cancelled'])

export function recordedTime(value) {
  if (typeof value !== 'string' || !AWARE_TIME.test(value)) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const clock = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/i)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function localTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const parts = value.split(/[-T:]/).map(Number)
  const date = new Date(value)
  // Reject rolled calendar dates and nonexistent local times at DST changes.
  const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]
  return actual.every((part, index) => part === parts[index]) ? date : null
}

/** Form values are local; API/demo values must already carry a timezone. */
export function helpSchedule(start, end, { local = false, now = Date.now() } = {}) {
  const empty = (value) => value == null || (local && value === '')
  if (empty(start) && empty(end)) return { schedule_start: null, schedule_end: null }
  if (empty(start) || empty(end)) return { error: 'help_schedule_pair' }
  const parse = local ? localTime : recordedTime
  const first = parse(start)
  const last = parse(end)
  if (!first || !last) return { error: 'help_schedule_invalid' }
  if (first.getTime() <= now) return { error: 'help_schedule_future' }
  if (last <= first) return { error: 'help_schedule_order' }
  if (last - first > 24 * HOUR_MS) return { error: 'help_schedule_duration' }
  if (last.getTime() > now + 14 * 24 * HOUR_MS) return { error: 'help_schedule_limit' }
  return { schedule_start: first.toISOString(), schedule_end: last.toISOString() }
}

/** Never invent missing events or display unparseable/unknown timestamps. */
export function helpTimeline(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && EVENTS.has(item.event) && recordedTime(item.at))
}

export function localHelpTime(value, lang = 'en') {
  const date = recordedTime(value)
  if (!date) return null
  const options = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  try { return date.toLocaleString(`${lang}-IN`, options) }
  catch { return date.toLocaleString(undefined, options) }
}

// The daily check-in: everything that asks you something (changes to approve, Related links,
// what you finished) waits for one time of day, while background updates stay quiet.
import { minutesOf } from './daily-episodes'

/** A local date as YYYY-MM-DD. */
export function dayOf(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** Whether today's check-in is due: it's past `at` (24-hour, "19:00") and it hasn't been held today. */
export function checkInDue(now: Date, at: string, lastDay: string): boolean {
  const minutes = minutesOf(at)
  if (minutes === null) return false
  return now.getHours() * 60 + now.getMinutes() >= minutes && lastDay !== dayOf(now)
}

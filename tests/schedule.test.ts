import { describe, expect, it } from 'vitest'
import { checkInDue, dayOf } from '../src/schedule'

describe('the daily check-in', () => {
  it('is due once a day, from its time on', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m)
    expect(dayOf(at(9))).toBe('2026-10-28')
    expect(checkInDue(at(18, 59), '19:00', '2026-10-27')).toBe(false)
    expect(checkInDue(at(19), '19:00', '2026-10-27')).toBe(true)
    expect(checkInDue(at(23, 30), '19:00', '')).toBe(true)
    expect(checkInDue(at(20), '19:00', '2026-10-28')).toBe(false)
    expect(checkInDue(at(8), '7', '2026-10-27')).toBe(true)
    // No time (or not a time): never; every update asks instead.
    expect(checkInDue(at(20), '', '')).toBe(false)
    expect(checkInDue(at(20), 'evening', '')).toBe(false)
  })
})

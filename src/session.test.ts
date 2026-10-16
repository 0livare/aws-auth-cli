import {describe, expect, test} from 'bun:test'
import {baseProfileName, formatRemaining, isSessionUsable} from './session'

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000)

describe('isSessionUsable', () => {
  test('accepts a session with plenty of time left', () => {
    expect(isSessionUsable(inMinutes(30))).toBe(true)
  })

  test('rejects missing, expired, and nearly expired sessions', () => {
    expect(isSessionUsable(null)).toBe(false)
    expect(isSessionUsable(inMinutes(-1))).toBe(false)
    expect(isSessionUsable(inMinutes(2))).toBe(false)
  })
})

describe('formatRemaining', () => {
  test('shows hours only when at least an hour remains', () => {
    expect(formatRemaining(new Date(Date.now() + 90 * 60_000 + 500))).toBe(
      '1h 30m',
    )
    expect(formatRemaining(new Date(Date.now() + 12 * 60_000 + 500))).toBe(
      '12m',
    )
  })
})

test('baseProfileName strips only a trailing -mfa', () => {
  expect(baseProfileName('staging-mfa')).toBe('staging')
  expect(baseProfileName('mfa-tools')).toBe('mfa-tools')
})

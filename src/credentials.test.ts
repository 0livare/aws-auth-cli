import {describe, expect, test} from 'bun:test'
import {findProfiles, type ProfileInfo} from './credentials'

const profiles: ProfileInfo[] = [
  {name: 'sandbox-mfa', accountId: '342327770208'},
  {name: 'prod-mfa', accountId: '542356736547'},
  {name: 'break-glass-mfa', accountId: '542356736547'},
  {name: 'no-account'},
]

describe('findProfiles', () => {
  test('finds a unique account match', () => {
    expect(findProfiles(profiles, '342327770208')).toEqual([profiles[0]])
  })

  test('returns all roles for a shared account in picker order', () => {
    expect(findProfiles(profiles, '542356736547')).toEqual(profiles.slice(1, 3))
  })

  test('does not match an unknown account or a partial account ID', () => {
    expect(findProfiles(profiles, '111111111111')).toEqual([])
    expect(findProfiles(profiles, '342327')).toEqual([])
  })

  test('prefers an exact profile name over account matches', () => {
    const numericProfile = {name: '542356736547', accountId: '111111111111'}
    expect(findProfiles([...profiles, numericProfile], '542356736547')).toEqual(
      [numericProfile],
    )
  })
})

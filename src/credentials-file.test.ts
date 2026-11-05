import {describe, expect, test} from 'bun:test'
import {
  SESSION_BANNER,
  SESSION_GAP_LINES,
  upsertSessionSection,
} from './credentials-file'

const gap = '\n'.repeat(SESSION_GAP_LINES + 1)
const banner = SESSION_BANNER.join('\n') + '\n'
const creds = (id: string) => ({
  aws_access_key_id: id,
  aws_secret_access_key: 'secret',
  aws_session_token: 'token',
})
const section = (name: string, id: string) =>
  [
    `[${name}]`,
    `aws_access_key_id = ${id}`,
    'aws_secret_access_key = secret',
    'aws_session_token = token',
  ].join('\n')

const userContent = [
  '[base]',
  'aws_access_key_id = AKIABASE',
  '',
  '# team role',
  '[role-a]',
  'role_arn = arn:aws:iam::111111111111:role/dev',
].join('\n')

describe('upsertSessionSection', () => {
  test('appends a new session section under the banner, below the gap', () => {
    const out = upsertSessionSection(
      userContent + '\n',
      'role-a-session',
      creds('A1'),
    )
    expect(out).toBe(
      `${userContent}${gap}${banner}${section('role-a-session', 'A1')}\n`,
    )
  })

  test('keeps session sections grouped under one banner, in first-written order', () => {
    let text = upsertSessionSection(userContent, 'role-a-session', creds('A1'))
    text = upsertSessionSection(text, 'role-b-session', creds('B1'))
    text = upsertSessionSection(text, 'role-a-session', creds('A2'))
    expect(text).toBe(
      `${userContent}${gap}${banner}${section('role-a-session', 'A2')}\n\n${section('role-b-session', 'B1')}\n`,
    )
    expect(text.split(SESSION_BANNER[0]).length).toBe(2)
  })

  test('replaces the section wholesale, dropping keys no longer given', () => {
    let text = upsertSessionSection(userContent, 'role-a-session', {
      ...creds('A1'),
      region: 'us-west-2',
    })
    text = upsertSessionSection(text, 'role-a-session', creds('A2'))
    expect(text).not.toContain('region')
  })

  test('moves a session section from the middle of the file to the bottom', () => {
    const text = [
      '[base]',
      'aws_access_key_id = AKIABASE',
      '',
      '[role-a-session]',
      'aws_access_key_id = OLD',
      '',
      '# team role',
      '[role-a]',
      'role_arn = arn:aws:iam::111111111111:role/dev',
      '',
    ].join('\n')
    const out = upsertSessionSection(text, 'role-a-session', creds('NEW'))
    expect(out).toBe(
      [
        '[base]',
        'aws_access_key_id = AKIABASE',
        '',
        '# team role',
        '[role-a]',
        'role_arn = arn:aws:iam::111111111111:role/dev',
      ].join('\n') +
        gap +
        banner +
        section('role-a-session', 'NEW') +
        '\n',
    )
  })

  test('leaves non-session sections untouched', () => {
    const text =
      '[prod]\naws_access_key_id = X\n\n\n[prod-admin]\nrole_arn = r\n'
    const out = upsertSessionSection(text, 'role-a-session', creds('A1'))
    expect(
      out.startsWith(
        '[prod]\naws_access_key_id = X\n\n\n[prod-admin]\nrole_arn = r\n',
      ),
    ).toBe(true)
  })

  test('is stable when rewritten with the same values', () => {
    const once = upsertSessionSection(
      userContent,
      'role-a-session',
      creds('A1'),
    )
    expect(upsertSessionSection(once, 'role-a-session', creds('A1'))).toBe(once)
  })

  test('writes only the banner and session section into an empty file', () => {
    expect(upsertSessionSection('', 'role-a-session', creds('A1'))).toBe(
      `${banner}${section('role-a-session', 'A1')}\n`,
    )
  })
})

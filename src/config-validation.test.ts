import {describe, expect, test} from 'bun:test'
import {validateIni} from './config-validation'

const lines = (...l: string[]) => l.join('\n')
const errors = (text: string) =>
  validateIni(text).filter((p) => p.severity === 'error')

describe('validateIni', () => {
  test('accepts a valid file with comments, blank lines and nested values', () => {
    const text = lines(
      '# top comment',
      '[base]',
      'aws_access_key_id = AKIA',
      '; another comment',
      '',
      '[profile staging]',
      'role_arn = arn:aws:iam::123456789012:role/dev',
      'region: us-east-1',
      's3 =',
      '  max_concurrent_requests = 20',
      '  multipart_threshold = 64MB',
      '',
    )
    expect(validateIni(text)).toEqual([])
  })

  test('reports a section defined twice, pointing at both lines', () => {
    const text = lines('[a]', 'x = 1', '[b]', 'y = 2', '[a]', 'x = 3')
    expect(errors(text)).toEqual([
      {
        line: 5,
        severity: 'error',
        message: '[a] appears more than once (first on line 1)',
      },
    ])
  })

  test('reports a key set twice in one section, ignoring case', () => {
    const text = lines('[a]', 'region = us-east-1', 'Region = us-west-2')
    expect(errors(text)).toEqual([
      {
        line: 3,
        severity: 'error',
        message: 'region is set twice in [a] (first on line 2)',
      },
    ])
  })

  test('allows the same key in different sections', () => {
    expect(validateIni(lines('[a]', 'x = 1', '[b]', 'x = 2'))).toEqual([])
  })

  test('reports a key before any section', () => {
    expect(errors(lines('region = us-east-1', '[a]'))[0].message).toBe(
      '"region = us-east-1" comes before any [section] header',
    )
  })

  test('reports a header missing its "]" once, without blaming the keys under it', () => {
    const text = lines(
      '[sandbox-session]',
      'aws_access_key_id = A',
      'aws_secret_access_key = B',
      '',
      '[staging-session',
      'aws_access_key_id = C',
      'aws_secret_access_key = D',
    )
    expect(errors(text)).toEqual([
      {
        line: 5,
        severity: 'error',
        message: '"[staging-session" is missing its closing "]"',
      },
    ])
  })

  test('reports a header missing its "[" once, without blaming the keys under it', () => {
    const text = lines(
      '[sandbox-session]',
      'aws_access_key_id = A',
      '',
      'staging-session]',
      'aws_access_key_id = C',
    )
    expect(errors(text)).toEqual([
      {
        line: 4,
        severity: 'error',
        message: '"staging-session]" is missing its opening "["',
      },
    ])
  })

  test('reports an empty section name', () => {
    expect(errors(lines('[]', 'x = 1'))[0].message).toBe(
      '"[]" has an empty section name',
    )
  })

  test('reports a line that is not a key/value pair', () => {
    expect(errors(lines('[a]', 'just some text'))[0]).toMatchObject({
      line: 2,
      message: `"just some text" isn't a [section], a key = value line or a comment`,
    })
  })

  test('warns, without failing, about a comment after a value', () => {
    const problems = validateIni(lines('[a]', 'duration_seconds = 14400  # 4h'))
    expect(problems).toHaveLength(1)
    expect(problems[0].severity).toBe('warning')
    expect(problems[0].message).toContain('duration_seconds in [a]')
  })

  test('does not treat # inside a value as a comment', () => {
    expect(validateIni(lines('[a]', 'one_password_item = AWS#1'))).toEqual([])
  })
})

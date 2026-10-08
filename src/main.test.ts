import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {mkdtemp, mkdir, rm, chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

let home: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aws-auth-test-'))
  await mkdir(join(home, '.aws'))
  await mkdir(join(home, 'bin'))
  await Bun.write(
    join(home, '.aws', 'credentials'),
    [
      '[sandbox-mfa]',
      'role_arn = arn:aws:iam::342327770208:role/dev',
      '[prod-mfa]',
      'role_arn = arn:aws:iam::542356736547:role/dev',
      '[break-glass-mfa]',
      'role_arn = arn:aws:iam::542356736547:role/admin',
      '[111111111111]',
      'role_arn = arn:aws:iam::542356736547:role/numeric',
    ].join('\n'),
  )
  await Bun.write(join(home, 'bin', 'aws'), '#!/bin/sh\nexit 1\n')
  await chmod(join(home, 'bin', 'aws'), 0o755)
})

afterAll(async () => {
  await rm(home, {recursive: true, force: true})
})

async function run(...args: string[]) {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'main.ts'), ...args],
    {
      env: {...process.env, HOME: home, PATH: join(home, 'bin')},
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {stdout, stderr, exitCode}
}

describe('account ID CLI selection', () => {
  test('exports the resolved profile, stripping the MFA suffix', async () => {
    const result = await run('--profile', '342327770208')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'export AWS_PROFILE=sandbox; unset AWS_DEFAULT_PROFILE\n',
    )
  })

  test('reports an unmatched account without exporting a profile', async () => {
    const result = await run('-p', '999999999999')
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      'No profiles found for AWS account 999999999999',
    )
  })

  test('lists ambiguous matches without a terminal and does not select a role', async () => {
    const result = await run('-p', '542356736547')
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('prod-mfa, break-glass-mfa, 111111111111')
    expect(result.stderr).not.toContain('sandbox-mfa')
    expect(result.stderr).not.toContain('setRawMode')
  })

  test('keeps explicit profile names working', async () => {
    const result = await run('-p', 'prod-mfa')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'export AWS_PROFILE=prod; unset AWS_DEFAULT_PROFILE\n',
    )
  })

  test('forwards a manual MFA token to the resolved profile', async () => {
    const result = await run('123456', '-p', '342327770208')
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Using manual token (bypassing 1Password)')
    expect(result.stderr).toContain('[sandbox-mfa] missing role_arn')
  })

  test('prefers an exact numeric profile name', async () => {
    const result = await run('-p', '111111111111')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'export AWS_PROFILE=111111111111; unset AWS_DEFAULT_PROFILE\n',
    )
  })
})

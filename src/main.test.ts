import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'bun:test'
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
      // Role config in the unsuffixed section, no -mfa partner
      '[staging-role]',
      'role_arn = arn:aws:iam::777777777777:role/dev',
      'source_profile = base',
      'mfa_serial = arn:aws:iam::210987654321:mfa/me',
      '[staging-role-session]',
      'aws_access_key_id = ASIAEXAMPLE',
    ].join('\n'),
  )
  await Bun.write(
    join(home, 'bin', 'aws'),
    '#!/bin/sh\necho "$@" >> "$HOME/aws-calls.log"\nexit 1\n',
  )
  await chmod(join(home, 'bin', 'aws'), 0o755)
})

afterAll(async () => {
  await rm(home, {recursive: true, force: true})
})

async function run(...args: string[]) {
  return runWithEnv({}, ...args)
}

async function runWithEnv(extraEnv: Record<string, string>, ...args: string[]) {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'main.ts'), ...args],
    {
      env: {...process.env, HOME: home, PATH: join(home, 'bin'), ...extraEnv},
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

describe('multiple signed-in profiles', () => {
  const awsCalls = () => join(home, 'aws-calls.log')
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000)

  beforeAll(async () => {
    await mkdir(join(home, '.aws', 'expiry'), {recursive: true})
    await Bun.write(
      join(home, '.aws', 'expiry', 'sandbox'),
      inMinutes(45).toISOString(),
    )
    await Bun.write(
      join(home, '.aws', 'expiry', 'prod'),
      inMinutes(-10).toISOString(),
    )
  })

  beforeEach(async () => {
    await rm(awsCalls(), {force: true})
  })

  test('switches to a profile with a valid session without calling aws', async () => {
    const result = await run('-p', 'sandbox')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'export AWS_PROFILE=sandbox; unset AWS_DEFAULT_PROFILE\n',
    )
    expect(result.stderr).toContain('Reusing existing session')
    expect(await Bun.file(awsCalls()).exists()).toBe(false)
  })

  test('reads legacy expiry timestamps without an offset as UTC', async () => {
    const legacy = inMinutes(-30)
      .toISOString()
      .replace(/\.\d+Z$/, '')
    await Bun.write(join(home, '.aws', 'expiry', 'break-glass'), legacy)
    const result = await runWithEnv({TZ: 'America/Los_Angeles'}, '--list')
    const line = result.stderr
      .split('\n')
      .find((l) => l.includes('break-glass'))
    expect(line).toContain('expired')
    await rm(join(home, '.aws', 'expiry', 'break-glass'))
  })

  test('re-authenticates an expired session', async () => {
    const result = await run('-p', 'prod')
    expect(result.stderr).not.toContain('Reusing existing session')
    expect(await Bun.file(awsCalls()).text()).toContain('op_item')
  })

  test('--force re-authenticates a valid session', async () => {
    const result = await run('-p', 'sandbox', '--force')
    expect(result.stderr).not.toContain('Reusing existing session')
    expect(await Bun.file(awsCalls()).text()).toContain('op_item')
  })

  test('a manual token always re-authenticates', async () => {
    const result = await run('123456', '-p', 'sandbox')
    expect(result.stderr).toContain('Using manual token')
    expect(result.stderr).not.toContain('Reusing existing session')
  })

  test('--list shows each profile with its session status', async () => {
    const result = await runWithEnv({AWS_PROFILE: 'sandbox'}, '--list')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    const lines = result.stderr.split('\n')
    expect(lines.find((l) => l.includes('sandbox'))).toMatch(/❯.*4\dm left/)
    expect(lines.find((l) => l.includes('prod '))).toContain('expired')
    expect(lines.find((l) => l.includes('break-glass'))).toContain('signed out')
  })
})

describe('profiles without a -mfa section', () => {
  const awsCalls = () => join(home, 'aws-calls.log')
  const expiryFile = () => join(home, '.aws', 'expiry', 'staging-role')
  const fakeBin = () => join(home, 'bin-sts')

  // A fake aws that reads values from the fixture-like table below and
  // succeeds at assume-role, so the full authentication path runs.
  beforeAll(async () => {
    await mkdir(fakeBin(), {recursive: true})
    await Bun.write(
      join(fakeBin(), 'aws'),
      [
        '#!/bin/sh',
        'echo "$@" >> "$HOME/aws-calls.log"',
        'if [ -n "$FAKE_AWS_PARSE_ERROR" ]; then',
        '  echo "aws: [ERROR]: Unable to parse config file: ~/.aws/credentials" >&2',
        '  exit 255',
        'fi',
        'case "$1 $2" in',
        '  "configure get")',
        '    case "$3 $5" in',
        '      "role_arn staging-role") echo arn:aws:iam::777777777777:role/dev ;;',
        '      "mfa_serial staging-role") echo arn:aws:iam::210987654321:mfa/me ;;',
        '      "source_profile staging-role") echo base ;;',
        '      "region staging-role") echo us-east-1 ;;',
        '      "output staging-role-session") echo yaml ;;',
        '      "output staging-role") echo json ;;',
        '      *) exit 1 ;;',
        '    esac ;;',
        '  "configure set") ;;',
        '  "sts assume-role")',
        `    printf 'ASIANEW\\tSECRET\\tTOKEN\\t2099-01-01T00:00:00+00:00\\n' ;;`,
        '  *) exit 1 ;;',
        'esac',
      ].join('\n'),
    )
    await chmod(join(fakeBin(), 'aws'), 0o755)
  })

  beforeEach(async () => {
    await rm(awsCalls(), {force: true})
    await rm(expiryFile(), {force: true})
  })

  afterAll(async () => {
    await rm(expiryFile(), {force: true})
  })

  const runSts = (extraEnv: Record<string, string>, ...args: string[]) =>
    runWithEnv({PATH: fakeBin(), ...extraEnv}, ...args)

  test('reads role config from [name] and writes credentials to [name-session]', async () => {
    const result = await runSts({}, '123456', '-p', 'staging-role')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'export AWS_PROFILE=staging-role-session; unset AWS_DEFAULT_PROFILE\n',
    )
    const calls = await Bun.file(awsCalls()).text()
    expect(calls).toContain('configure get role_arn --profile staging-role\n')
    expect(calls).not.toContain('staging-role-mfa')
    expect(calls).toContain(
      'configure set aws_access_key_id ASIANEW --profile staging-role-session',
    )
    expect(await Bun.file(expiryFile()).exists()).toBe(true)
  })

  test('copies region to the -session section without overriding its own settings', async () => {
    await runSts({}, '123456', '-p', 'staging-role')
    const calls = await Bun.file(awsCalls()).text()
    expect(calls).toContain(
      'configure set region us-east-1 --profile staging-role-session',
    )
    expect(calls).not.toContain('configure set output')
  })

  test('accepts the -session name and reuses a valid session', async () => {
    await Bun.write(
      expiryFile(),
      new Date(Date.now() + 45 * 60_000).toISOString(),
    )
    const result = await runSts({}, '-p', 'staging-role-session')
    expect(result.stdout).toBe(
      'export AWS_PROFILE=staging-role-session; unset AWS_DEFAULT_PROFILE\n',
    )
    expect(result.stderr).toContain('Reusing existing session')
  })

  test('selects these profiles by account ID', async () => {
    const result = await runSts({}, '123456', '-p', '777777777777')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('AWS_PROFILE=staging-role-session')
  })

  test('--list shows the role profile, not the generated -session section', async () => {
    const result = await runWithEnv(
      {AWS_PROFILE: 'staging-role-session'},
      '--list',
    )
    const lines = result.stderr.split('\n')
    expect(lines.find((l) => l.includes('staging-role'))).toMatch(/❯ staging-role /)
    expect(result.stderr).not.toContain('staging-role-session')
  })

  test('without op_item or a session, exports the role profile itself', async () => {
    const result = await runSts({}, '-p', 'staging-role')
    expect(result.stderr).toContain(
      'No op_item found in [staging-role] or [default]',
    )
    expect(result.stderr).not.toContain('no token')
    expect(result.stdout).toBe(
      'export AWS_PROFILE=staging-role; unset AWS_DEFAULT_PROFILE\n',
    )
  })

  test('surfaces AWS CLI config errors instead of treating values as unset', async () => {
    const result = await runSts({FAKE_AWS_PARSE_ERROR: '1'}, '-p', 'staging-role')
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unable to parse config file')
    expect(result.stderr).not.toContain('skipping MFA')
  })
})

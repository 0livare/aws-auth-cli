import {homedir} from 'os'
import {join} from 'path'
import chalk from 'chalk'
import {getConfigValue} from './credentials'

export async function assumeRoleWithMfa(
  profile: string,
  token: string,
): Promise<boolean> {
  const mfaProfile = `${profile}-mfa`

  const roleArn = await getConfigValue(mfaProfile, 'role_arn')
  if (!roleArn) {
    process.stderr.write(chalk.red(`  ✖  [${mfaProfile}] missing role_arn\n`))
    return false
  }

  const mfaSerial = await getConfigValue(mfaProfile, 'mfa_serial')
  if (!mfaSerial) {
    process.stderr.write(chalk.red(`  ✖  [${mfaProfile}] missing mfa_serial\n`))
    return false
  }

  const sourceProfile = await getConfigValue(mfaProfile, 'source_profile')
  if (!sourceProfile) {
    process.stderr.write(
      chalk.red(`  ✖  [${mfaProfile}] missing source_profile\n`),
    )
    return false
  }

  const duration =
    (await getConfigValue(mfaProfile, 'duration_seconds')) ?? '3600'
  const sessionName = `${profile.replace(/[^a-zA-Z0-9_=,.@-]/g, '-')}-${Date.now()}`

  process.stderr.write(chalk.dim(`  Assuming role for [${profile}]...\n`))

  const proc = Bun.spawn(
    [
      'aws',
      'sts',
      'assume-role',
      '--role-arn',
      roleArn,
      '--role-session-name',
      sessionName,
      '--serial-number',
      mfaSerial,
      '--token-code',
      token,
      '--duration-seconds',
      duration,
      '--profile',
      sourceProfile,
      '--query',
      '[Credentials.AccessKeyId,Credentials.SecretAccessKey,Credentials.SessionToken,Credentials.Expiration]',
      '--output',
      'text',
    ],
    {stdout: 'pipe', stderr: 'pipe'},
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text()
    process.stderr.write(
      chalk.red(`  ✖  assume-role failed: ${errText.trim()}\n`),
    )
    return false
  }

  const output = (await new Response(proc.stdout).text()).trim()
  const [accessKey, secretKey, sessionToken, expiry] = output.split('\t')

  if (!accessKey) {
    process.stderr.write(
      chalk.red('  ✖  assume-role returned empty credentials\n'),
    )
    return false
  }

  await setCredential(profile, 'aws_access_key_id', accessKey)
  await setCredential(profile, 'aws_secret_access_key', secretKey)
  await setCredential(profile, 'aws_session_token', sessionToken)

  const expiryClean = expiry.replace(/[+Z].*/, '').trim()
  const expiryDir = join(homedir(), '.aws', 'expiry')
  await Bun.spawn(['mkdir', '-p', expiryDir]).exited
  await Bun.write(join(expiryDir, profile), expiryClean)

  const expDate = new Date(expiry)
  const remaining = Math.floor((expDate.getTime() - Date.now()) / 1000)
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const timeStr = expDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  process.stderr.write(
    chalk.green(
      `  ✓  [${profile}] authenticated — expires at ${timeStr} (in ${h}h ${m}m ${s}s)\n`,
    ),
  )
  return true
}

async function setCredential(profile: string, key: string, value: string) {
  await Bun.spawn(['aws', 'configure', 'set', key, value, '--profile', profile])
    .exited
}

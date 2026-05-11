import {homedir} from 'os'
import {join} from 'path'
import chalk from './chalk'
import {getConfigValue} from './credentials'

type OpAccount = {url: string; email: string; user_uuid: string}

async function getOpAccount(): Promise<OpAccount | null> {
  const proc = Bun.spawn(['op', 'whoami', '--format', 'json'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if ((await proc.exited) !== 0) return null
  try {
    return JSON.parse(await new Response(proc.stdout).text())
  } catch {
    return null
  }
}

/**
 * Fetch a TOTP code from 1Password for the given item name/ID.
 * Returns null if op is not available, not signed in, or the item isn't found.
 */
async function getOpToken(opItem: string): Promise<string | null> {
  const proc = Bun.spawn(['op', 'item', 'get', opItem, '--otp'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const err = (await new Response(proc.stderr).text()).trim()
    if (err.includes('not found') || err.includes("isn't an item")) {
      process.stderr.write(
        chalk.red(`  ✖  1Password item "${opItem}" not found\n`),
      )
    } else if (
      err.includes('not currently signed in') ||
      err.includes('sign in')
    ) {
      process.stderr.write(
        chalk.red(`  ✖  Not signed in to 1Password — run: op signin\n`),
      )
    } else if (
      err.includes('command not found') ||
      err.includes('No such file')
    ) {
      process.stderr.write(
        chalk.red(
          `  ✖  1Password CLI not found — install it: https://developer.1password.com/docs/cli\n`,
        ),
      )
    } else {
      process.stderr.write(chalk.red(`  ✖  1Password error: ${err}\n`))
    }
    return null
  }
  return (await new Response(proc.stdout).text()).trim() || null
}

export async function assumeRoleWithMfa(
  profile: string,
  token?: string,
): Promise<'ok' | 'skip' | 'error'> {
  const mfaProfile = `${profile}-mfa`

  // Resolve token — from argument, or 1Password, or give up
  let resolvedToken = token
  if (!resolvedToken) {
    const opItemProfile = await getConfigValue(mfaProfile, 'op_item')
    const opItemDefault = await getConfigValue('default', 'op_item')
    const opItem = opItemProfile ?? opItemDefault

    if (!opItem) {
      const checked = opItemProfile === null ? `[${mfaProfile}] and [default]` : `[${mfaProfile}]`
      process.stderr.write(
        chalk.dim(`  No op_item found in ${checked} — skipping MFA\n`),
      )
      return 'skip'
    }

    const source = opItemProfile ? `[${mfaProfile}]` : '[default]'
    process.stderr.write(
      chalk.dim(`  Fetching MFA token from 1Password (item: ${chalk.white(opItem)}, config: ${source})...\n`),
    )

    const [opToken, account] = await Promise.all([
      getOpToken(opItem),
      getOpAccount(),
    ])

    if (!opToken) return 'error'
    resolvedToken = opToken

    const accountStr = account
      ? `${account.email}  id: ${account.user_uuid}`
      : 'unknown account'
    process.stderr.write(
      chalk.dim(`  Token: ${chalk.white(resolvedToken)}  ·  Account: ${accountStr}\n`),
    )
  } else {
    process.stderr.write(
      chalk.dim(`  Using manual token (bypassing 1Password): ${chalk.white(token)}\n`),
    )
  }

  const roleArn = await getConfigValue(mfaProfile, 'role_arn')
  if (!roleArn) {
    process.stderr.write(chalk.red(`  ✖  [${mfaProfile}] missing role_arn\n`))
    return 'error'
  }

  const mfaSerial = await getConfigValue(mfaProfile, 'mfa_serial')
  if (!mfaSerial) {
    process.stderr.write(chalk.red(`  ✖  [${mfaProfile}] missing mfa_serial\n`))
    return 'error'
  }

  const sourceProfile = await getConfigValue(mfaProfile, 'source_profile')
  if (!sourceProfile) {
    process.stderr.write(
      chalk.red(`  ✖  [${mfaProfile}] missing source_profile\n`),
    )
    return 'error'
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
      resolvedToken,
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
    return 'error'
  }

  const output = (await new Response(proc.stdout).text()).trim()
  const [accessKey, secretKey, sessionToken, expiry] = output.split('\t')

  if (!accessKey) {
    process.stderr.write(
      chalk.red('  ✖  assume-role returned empty credentials\n'),
    )
    return 'error'
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
  return 'ok'
}

async function setCredential(profile: string, key: string, value: string) {
  await Bun.spawn(['aws', 'configure', 'set', key, value, '--profile', profile])
    .exited
}

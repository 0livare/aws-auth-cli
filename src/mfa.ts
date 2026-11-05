import {createInterface} from 'readline/promises'
import chalk from './chalk'
import {getConfigValue, getInheritedSettings} from './credentials'
import {writeSessionCredentials} from './credentials-file'
import {
  formatExpiryTime,
  formatRemaining,
  saveSessionExpiry,
  sessionProfileName,
} from './session'

type OpAccount = {url: string; email: string; user_uuid: string}

async function getOpAccount(): Promise<OpAccount | null> {
  try {
    const proc = Bun.spawn(['op', 'whoami', '--format', 'json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if ((await proc.exited) !== 0) return null
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
  try {
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
      } else {
        process.stderr.write(chalk.red(`  ✖  1Password error: ${err}\n`))
      }
      return null
    }
    return (await new Response(proc.stdout).text()).trim() || null
  } catch {
    process.stderr.write(
      chalk.red(
        `  ✖  1Password CLI not found — install it: https://developer.1password.com/docs/cli\n`,
      ),
    )
    return null
  }
}

async function promptForToken(): Promise<string | null> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      chalk.red('  ✖  Cannot prompt for an MFA token without a terminal\n'),
    )
    return null
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    while (true) {
      const token = (
        await readline.question('  Enter MFA token manually: ')
      ).trim()
      if (/^\d{6}$/.test(token)) return token
      process.stderr.write(chalk.yellow('  MFA token must be 6 digits\n'))
    }
  } finally {
    readline.close()
  }
}

/** 1Password item name keys, in order of precedence */
const OP_ITEM_KEYS = ['one_password_item', 'op_item']

async function getOpItem(profile: string): Promise<string | null> {
  for (const key of OP_ITEM_KEYS) {
    const value = await getConfigValue(profile, key)
    if (value) return value
  }
  return null
}

export async function assumeRoleWithMfa(
  profile: string,
  token?: string,
): Promise<'ok' | 'skip' | 'error'> {
  // Resolve token — from argument, or 1Password, or give up
  let resolvedToken = token
  if (!resolvedToken) {
    const opItemProfile = await getOpItem(profile)
    const opItemDefault = await getOpItem('default')
    const opItem = opItemProfile ?? opItemDefault

    if (!opItem) {
      process.stderr.write(
        chalk.yellow(
          `  ⚠  No one_password_item / op_item found in [${profile}] or [default] — skipping MFA\n` +
            `     Add one_password_item to ~/.aws/config, or pass a token: aws-auth <token> -p ${profile}\n`,
        ),
      )
      return 'skip'
    }

    const source = opItemProfile ? `[${profile}]` : '[default]'
    process.stderr.write(
      chalk.dim(
        `  Fetching MFA token from 1Password (item: ${chalk.white(opItem)}, config: ${source})...\n`,
      ),
    )

    const [opToken, account] = await Promise.all([
      getOpToken(opItem),
      getOpAccount(),
    ])

    if (opToken) {
      resolvedToken = opToken

      const accountStr = account
        ? `${account.email}  id: ${account.user_uuid}`
        : 'unknown account'
      process.stderr.write(
        chalk.dim(
          `  Token: ${chalk.white(resolvedToken)}  ·  Account: ${accountStr}\n`,
        ),
      )
    } else {
      resolvedToken = (await promptForToken()) ?? undefined
      if (!resolvedToken) return 'error'
    }
  } else {
    process.stderr.write(
      chalk.dim(
        `  Using manual token (bypassing 1Password): ${chalk.white(token)}\n`,
      ),
    )
  }

  const roleArn = await getConfigValue(profile, 'role_arn')
  if (!roleArn) {
    process.stderr.write(chalk.red(`  ✖  [${profile}] missing role_arn\n`))
    return 'error'
  }

  const mfaSerial = await getConfigValue(profile, 'mfa_serial')
  if (!mfaSerial) {
    process.stderr.write(chalk.red(`  ✖  [${profile}] missing mfa_serial\n`))
    return 'error'
  }

  const sourceProfile = await getConfigValue(profile, 'source_profile')
  if (!sourceProfile) {
    process.stderr.write(
      chalk.red(`  ✖  [${profile}] missing source_profile\n`),
    )
    return 'error'
  }

  const duration = (await getConfigValue(profile, 'duration_seconds')) ?? '3600'
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

  // Rewritten in full each time so it always mirrors the role profile
  await writeSessionCredentials(sessionProfileName(profile), {
    aws_access_key_id: accessKey,
    aws_secret_access_key: secretKey,
    aws_session_token: sessionToken,
    ...(await getInheritedSettings(profile)),
  })

  const expDate = new Date(expiry.trim())
  await saveSessionExpiry(profile, expDate)

  process.stderr.write(
    chalk.green(
      `  ✓  [${profile}] authenticated — expires at ${formatExpiryTime(expDate)} (in ${formatRemaining(expDate)})\n`,
    ),
  )
  return 'ok'
}

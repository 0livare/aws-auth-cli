#!/usr/bin/env bun
import {parseCliArgs} from './cli'
import {help, version} from './commands'
import {AwsConfigError, findProfiles, getProfiles} from './credentials'
import {selectProfile} from './select'
import {assumeRoleWithMfa} from './mfa'
import {showTokenStatus} from './token-status'
import {printError} from './helpers'
import {
  baseProfileName,
  clearLastProfile,
  getLastProfile,
  getSessionExpiry,
  saveLastProfile,
  isSessionUsable,
  sessionProfileName,
} from './session'
import {listSessions} from './list'
import {checkAwsFiles} from './config-validation'
import chalk from './chalk'

/**
 * For ~/.zshrc: point a new shell at the last selected profile while its
 * session is still valid. Runs on every shell start, so it only reads two
 * small files (no aws calls, no validation) and never prints to stderr.
 */
async function restoreLastProfile() {
  try {
    const profile = await getLastProfile()
    // The output is eval'd, so only accept names that are safe unquoted
    if (!profile || !/^[\w.@+=,:-]+$/.test(profile)) return
    if (!isSessionUsable(await getSessionExpiry(profile))) return
    process.stdout.write(
      `export AWS_PROFILE=${sessionProfileName(profile)}; unset AWS_DEFAULT_PROFILE\n`,
    )
  } catch {
    // A broken shell startup is worse than starting without a profile
  }
}

async function main() {
  const cli = parseCliArgs()

  if (cli.values.help) {
    help()
    process.exit(0)
  }

  if (cli.values.version) {
    version()
    process.exit(0)
  }

  if (cli.values.clear) {
    await clearLastProfile()
    process.stderr.write('\x1b[2m  Cleared AWS profile\x1b[0m\n')
    process.stdout.write('unset AWS_PROFILE; unset AWS_DEFAULT_PROFILE\n')
    process.exit(0)
  }

  if (cli.values.restore) {
    await restoreLastProfile()
    process.exit(0)
  }

  // Everything below reads ~/.aws; a file the AWS CLI can't parse would
  // otherwise fail later with a vague error, or not at all (--list, reuse)
  if (!(await checkAwsFiles())) process.exit(1)

  if (cli.values.list) {
    await listSessions(await getProfiles())
    process.exit(0)
  }

  const token = cli.positionals[0]
  const profile = cli.values.profile

  async function handleProfile(raw: string) {
    const p = baseProfileName(raw)

    // Credentials for every profile live side by side in ~/.aws/credentials,
    // so switching to a profile that still has a valid session needs no MFA.
    const reuse =
      !token && !cli.values.force && isSessionUsable(await getSessionExpiry(p))

    let exportName = sessionProfileName(p)

    if (reuse) {
      process.stderr.write(chalk.dim(`  Reusing existing session\n`))
      await showTokenStatus(p)
    } else {
      const result = await assumeRoleWithMfa(p, token)
      if (result === 'error') process.exit(1)
      if (result === 'skip') {
        if (await getSessionExpiry(p)) {
          await showTokenStatus(p)
        } else {
          // No -session profile was ever written, so point at the role
          // profile itself and let the AWS CLI prompt for MFA.
          exportName = p
        }
      }
    }
    process.stdout.write(
      `export AWS_PROFILE=${exportName}; unset AWS_DEFAULT_PROFILE\n`,
    )
    await saveLastProfile(p)
  }

  if (!profile) {
    // Interactive profile selection
    const profiles = await getProfiles()
    const current = process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE
    const selected = await selectProfile(profiles, current)

    if (!selected) process.exit(0)

    process.stderr.write('\n')
    await handleProfile(selected)
    process.exit(0)
  }

  if (/^\d{12}$/.test(profile)) {
    const matches = findProfiles(await getProfiles(), profile)
    if (matches.length === 0) {
      printError(`  No profiles found for AWS account ${profile}`)
      process.exit(1)
    }

    let selected: string | null
    if (matches.length === 1) {
      selected = matches[0].name
    } else {
      if (!process.stdin.isTTY) {
        printError(
          `  Multiple profiles found for AWS account ${profile}: ${matches.map((match) => match.name).join(', ')}. Use --profile with a profile name or run in a terminal to select one.`,
        )
        process.exit(1)
      }
      const current = process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE
      selected = await selectProfile(matches, current)
      if (!selected) process.exit(0)
      process.stderr.write('\n')
    }
    await handleProfile(selected)
    process.exit(0)
  }

  // Profile specified explicitly
  await handleProfile(profile)
}

try {
  await main()
} catch (err) {
  if (!(err instanceof AwsConfigError)) throw err
  printError(
    `  ✖  The AWS CLI couldn't read your configuration:\n     ${err.message}`,
  )
  process.exit(1)
}

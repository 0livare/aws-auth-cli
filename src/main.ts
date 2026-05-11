#!/usr/bin/env bun
import {parseCliArgs} from './cli'
import {help, version} from './commands'
import {getProfiles} from './credentials'
import {selectProfile} from './select'
import {assumeRoleWithMfa} from './mfa'
import {showTokenStatus} from './token-status'

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
    process.stderr.write('\x1b[2m  Cleared AWS profile\x1b[0m\n')
    process.stdout.write('unset AWS_PROFILE; unset AWS_DEFAULT_PROFILE\n')
    process.exit(0)
  }

  const profile = cli.positionals[0]

  if (!profile) {
    // Interactive profile selection
    const profiles = await getProfiles()
    const current = process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE
    const selected = await selectProfile(profiles, current)

    if (!selected) process.exit(0)

    process.stderr.write('\n')
    await showTokenStatus(selected)
    process.stderr.write('\n')
    process.stdout.write(
      `export AWS_PROFILE=${selected}; unset AWS_DEFAULT_PROFILE\n`,
    )
    process.exit(0)
  }

  // Profile specified explicitly
  if (cli.values.token) {
    const ok = await assumeRoleWithMfa(profile, cli.values.token)
    if (!ok) process.exit(1)
  } else {
    await showTokenStatus(profile)
  }

  process.stdout.write(
    `export AWS_PROFILE=${profile}; unset AWS_DEFAULT_PROFILE\n`,
  )
}

await main()

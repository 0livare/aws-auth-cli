#!/usr/bin/env bun
import {parseCliArgs} from './cli'
import {help, version} from './commands'
import {findProfiles, getProfiles} from './credentials'
import {selectProfile} from './select'
import {assumeRoleWithMfa} from './mfa'
import {showTokenStatus} from './token-status'
import {printError} from './helpers'

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

  const token = cli.positionals[0]
  const profile = cli.values.profile

  async function handleProfile(raw: string) {
    // Strip -mfa suffix so "staging-mfa" and "staging" behave identically
    const p = raw.replace(/-mfa$/, '')
    const result = await assumeRoleWithMfa(p, token)
    if (result === 'error') process.exit(1)
    if (result === 'skip') await showTokenStatus(p)
    process.stdout.write(`export AWS_PROFILE=${p}; unset AWS_DEFAULT_PROFILE\n`)
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

await main()

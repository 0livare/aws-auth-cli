import chalk from './chalk'
import type {ProfileInfo} from './credentials'
import {baseProfileName, getSessionExpiries, sessionLabel} from './session'

// Written to stderr: stdout is eval'd by the shell wrapper
const tty = process.stderr

export async function listSessions(profiles: ProfileInfo[]) {
  if (profiles.length === 0) {
    tty.write(chalk.yellow('  No profiles found in ~/.aws/credentials\n'))
    return
  }

  const sessions = await getSessionExpiries(profiles)
  const current = process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE
  const names = profiles.map((p) => baseProfileName(p.name))
  const width = Math.max(...names.map((n) => n.length))

  for (let i = 0; i < profiles.length; i++) {
    const name = names[i]
    const isCurrent = !!current && name === baseProfileName(current)
    const marker = isCurrent ? chalk.cyan('❯') : ' '
    const account = profiles[i].accountId
      ? chalk.dim(`  (${profiles[i].accountId})`)
      : ''
    const session = sessionLabel(sessions.get(profiles[i].name) ?? null)
    const label = isCurrent
      ? chalk.cyan.bold(name.padEnd(width))
      : name.padEnd(width)
    tty.write(`  ${marker} ${label}${account}  ${session}\n`)
  }
}

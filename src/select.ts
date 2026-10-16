import chalk from './chalk'
import type {ProfileInfo} from './credentials'
import {baseProfileName, getSessionExpiries, sessionLabel} from './session'

const tty = process.stderr

const plainLabel = ({name, accountId}: ProfileInfo) =>
  accountId ? `${name}  (${accountId})` : name

const HEADER_LINES = 3 // current profile line + blank line + "Select a profile" line
const FOOTER_LINES = 2 // blank line + hint line

export async function selectProfile(
  profiles: ProfileInfo[],
  current?: string,
): Promise<string | null> {
  if (profiles.length === 0) {
    tty.write(chalk.yellow('  No profiles found in ~/.aws/credentials\n'))
    return null
  }

  const sessions = await getSessionExpiries(profiles)
  const labelWidth = Math.max(...profiles.map(plainLabel).map((l) => l.length))

  // AWS_PROFILE holds the base name ("staging") while the picker may list "staging-mfa"
  const currentIndex = profiles.findIndex(
    (p) => current && baseProfileName(p.name) === baseProfileName(current),
  )
  let cursor = Math.max(currentIndex, 0)

  const totalLines = HEADER_LINES + profiles.length + FOOTER_LINES

  const render = (first = false) => {
    if (!first) {
      tty.write(`\x1b[${totalLines}A\x1b[J`)
    }

    const currentLabel = current ? chalk.cyan(current) : chalk.dim('none')
    tty.write(`  ${chalk.dim('Current:')}  ${currentLabel}\n`)
    tty.write('\n')
    tty.write(chalk.bold('  Select a profile\n'))

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i]
      const isCurrent = i === currentIndex
      const isSelected = i === cursor

      const label = plainLabel(profile).padEnd(labelWidth)
      const session = sessionLabel(sessions.get(profile.name) ?? null)
      const active = isCurrent ? chalk.dim('  (active)') : ''

      if (isSelected) {
        tty.write(
          `${chalk.cyan(`  ❯  ${chalk.bold(label)}`)}  ${session}${active}\n`,
        )
      } else {
        tty.write(`     ${chalk.dim(label)}  ${session}${active}\n`)
      }
    }

    tty.write('\n')
    tty.write(chalk.dim('  ↑↓  navigate   ⏎  confirm   esc  cancel\n'))
  }

  tty.write('\x1b[?25l') // hide cursor
  render(true)

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.removeListener('data', onKey)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      tty.write(`\x1b[${totalLines}A\x1b[J`)
      tty.write('\x1b[?25h') // show cursor
    }

    const onKey = (key: string) => {
      switch (key) {
        case '\x1b[A': // up arrow
        case 'k':
          cursor = (cursor - 1 + profiles.length) % profiles.length
          render()
          break
        case '\x1b[B': // down arrow
        case 'j':
          cursor = (cursor + 1) % profiles.length
          render()
          break
        case '\r': // enter
          cleanup()
          resolve(profiles[cursor].name)
          break
        case '\x03': // ctrl+c
        case '\x1b': // esc
        case 'q':
          cleanup()
          resolve(null)
          break
      }
    }

    process.stdin.on('data', onKey)
  })
}

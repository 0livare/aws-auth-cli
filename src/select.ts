import chalk from 'chalk'

const tty = process.stderr

const HEADER_LINES = 2 // blank line + "Select a profile" line
const FOOTER_LINES = 2 // blank line + hint line

export async function selectProfile(
  profiles: string[],
  current?: string,
): Promise<string | null> {
  if (profiles.length === 0) {
    tty.write(chalk.yellow('  No profiles found in ~/.aws/credentials\n'))
    return null
  }

  let cursor = profiles.findIndex((p) => p === current)
  if (cursor < 0) cursor = 0

  const totalLines = HEADER_LINES + profiles.length + FOOTER_LINES

  const render = (first = false) => {
    if (!first) {
      tty.write(`\x1b[${totalLines}A\x1b[J`)
    }

    tty.write('\n')
    tty.write(chalk.bold('  Select a profile\n'))

    for (let i = 0; i < profiles.length; i++) {
      const isCurrent = profiles[i] === current
      const isSelected = i === cursor
      const label = profiles[i] + (isCurrent ? chalk.dim('  (active)') : '')

      if (isSelected) {
        tty.write(chalk.cyan(`  ❯  ${chalk.bold(label)}\n`))
      } else {
        tty.write(`     ${chalk.dim(label)}\n`)
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
          resolve(profiles[cursor])
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

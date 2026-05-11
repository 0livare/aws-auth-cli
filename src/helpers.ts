import chalk from 'chalk'

export function printError(message: string) {
  process.stderr.write(chalk.red(message) + '\n')
}

import chalk from '../chalk'
import pkg from '../../package.json'

const say = (s = '') => process.stderr.write(s + '\n')

export function help() {
  say()
  say(pkg.description)
  say()

  say(
    `${chalk.bold('Usage:')} ${chalk.bold.green('aws-auth')} ${chalk.cyan('[token]')} ${chalk.cyan('[flags]')}`,
  )

  say()
  say(chalk.bold('Examples:'))
  say(
    `  ${chalk.bold.green('aws-auth')}                              Interactive profile selector`,
  )
  say(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('<token>')}                      Select profile and assume role via MFA`,
  )
  say(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('-p')} ${chalk.cyan('<profile>')}                 Set profile and show token status`,
  )
  say(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('-p')} ${chalk.cyan('<account-id>')}              Select a profile by AWS account ID`,
  )
  say(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('<token>')} ${chalk.cyan('-p')} ${chalk.cyan('<profile>')}         Set profile and assume role via MFA`,
  )
  say(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('--clear')}                       Unset the current profile`,
  )

  say()
  say(chalk.bold('Flags:'))
  say(
    `  ${chalk.cyan('-p')}, ${chalk.cyan('--profile')} ${chalk.cyan('<profile>')}           AWS profile name or 12-digit account ID`,
  )
  say(
    `  ${chalk.cyan('--clear')}                           Unset AWS_PROFILE and AWS_DEFAULT_PROFILE`,
  )
  say(
    `  ${chalk.cyan('-v')}, ${chalk.cyan('--version')}                       Print version number`,
  )
  say(
    `  ${chalk.cyan('-h')}, ${chalk.cyan('--help')}                          Print help information`,
  )

  say()
  say(chalk.bold('Zsh setup:'))
  say(
    chalk.dim('  Add to ~/.zshrc so the profile is set in your current shell:'),
  )
  say()
  say(
    `  ${chalk.yellow('aws-auth()')} ${chalk.yellow('{')} eval ${chalk.green('"$(command aws-auth "$@")"')}${chalk.yellow('}')}`,
  )
  say()
}

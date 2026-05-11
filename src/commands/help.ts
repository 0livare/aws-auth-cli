import chalk from 'chalk'
import pkg from '../../package.json'

export function help() {
  console.info('\n' + pkg.description + '\n')

  console.info(
    `${chalk.bold('Usage:')} ${chalk.bold.green('aws-auth')} ${chalk.cyan('[profile]')} ${chalk.cyan('[flags]')}`,
  )

  // Examples
  console.info(`\n${chalk.bold('Examples:')}`)
  console.info(
    `  ${chalk.bold.green('aws-auth')}                              Show current AWS profile`,
  )
  console.info(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('<profile>')}                    Set profile and show token status`,
  )
  console.info(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('<profile>')} ${chalk.cyan('-t')} ${chalk.cyan('<token>')}          Set profile and assume role via MFA`,
  )
  console.info(
    `  ${chalk.bold.green('aws-auth')} ${chalk.cyan('--clear')}                       Unset the current profile`,
  )

  // Flags
  console.info(`\n${chalk.bold('Flags:')}`)
  console.info(
    `  ${chalk.cyan('-t')}, ${chalk.cyan('--token')} ${chalk.cyan('<code>')}               MFA token code for role assumption`,
  )
  console.info(
    `  ${chalk.cyan('--clear')}                           Unset AWS_PROFILE and AWS_DEFAULT_PROFILE`,
  )
  console.info(
    `  ${chalk.cyan('-v')}, ${chalk.cyan('--version')}                       Print version number`,
  )
  console.info(
    `  ${chalk.cyan('-h')}, ${chalk.cyan('--help')}                          Print help information`,
  )
}

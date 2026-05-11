#!/usr/bin/env bun
import chalk from 'chalk'
import {parseCliArgs} from './cli'
import {help, version} from './commands'
import {printInfo, printError, readCliFile, readCwdFile} from './helpers'

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

  // Check for subcommands
  const subcommand = cli.positionals[2] // argv[0] is bun, argv[1] is script path
}

await main()

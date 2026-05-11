import {parseArgs} from 'util'
import {printError} from './helpers'

export function parseCliArgs() {
  let args
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      options: {
        token: {type: 'string', short: 't'},
        clear: {type: 'boolean'},
        help: {type: 'boolean', short: 'h'},
        version: {type: 'boolean', short: 'v'},
      },
      strict: true,
      allowPositionals: true,
    })
  } catch (e: any) {
    printError(e.message)
    process.exit(1)
  }

  return {
    values: args.values,
    positionals: args.positionals,
  }
}

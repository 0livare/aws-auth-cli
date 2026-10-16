import {parseArgs} from 'util'
import {printError} from './helpers'

export function parseCliArgs() {
  let args
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      options: {
        profile: {type: 'string', short: 'p'},
        clear: {type: 'boolean'},
        force: {type: 'boolean', short: 'f'},
        list: {type: 'boolean', short: 'l'},
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

import {parseArgs} from 'util'
import {printError} from './helpers'

export function parseCliArgs() {
  let args
  try {
    args = parseArgs({
      args: Bun.argv,
      options: {
        'max-iterations': {type: 'string', short: 'i'},
        sequential: {type: 'boolean', short: 's'},
        help: {type: 'boolean', short: 'h'},
        version: {type: 'boolean', short: 'v'},
        message: {type: 'string', short: 'm'},
        file: {type: 'string', short: 'f'},
        sample: {type: 'boolean'},
        override: {type: 'boolean'},
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

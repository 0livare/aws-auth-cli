import path from 'node:path'
import chalk from 'chalk'

/**
 * A strongly typed version of `Object.keys()` that types
 * each returned key such that `object[key]` is typed correctly.
 */
export function objectKeys<T extends {}>(object: T): Array<keyof T> {
  return Object.keys(object) as Array<keyof T>
}

export function printInfo(message: string) {
  console.info(chalk.blueBright(message))
}

export function printError(message: string) {
  console.error(chalk.red(message))
}

export function readCliFile(filePath: string) {
  return Bun.file(path.join(import.meta.dir, filePath))
}

export function readCwdFile(filePath: string) {
  return Bun.file(path.join(process.cwd(), filePath))
}

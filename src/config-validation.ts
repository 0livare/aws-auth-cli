import {homedir} from 'os'
import chalk from './chalk'
import {configPath, credentialsPath} from './credentials'

export type Problem = {
  line: number
  message: string
  /** Errors stop the AWS CLI from reading the file; warnings are likely mistakes */
  severity: 'error' | 'warning'
}

const COMMENT = /^\s*[#;]/
const HEADER = /^\[(.+)\]/
// configparser accepts both `key = value` and `key: value`
const OPTION = /^(.*?)\s*[=:]\s*(.*)$/
const INLINE_COMMENT = /\s[#;]/

/**
 * Find the problems the AWS CLI's INI parser (Python's configparser, in
 * strict mode) rejects, so they can be reported clearly instead of surfacing
 * as "Unable to parse config file" or values silently going missing:
 * - a key/value line before any [section]
 * - a line that is neither a section, a key/value, a comment nor blank
 * - the same [section] twice in one file
 * - the same key twice in one section (keys are case-insensitive)
 *
 * Also warns about values with a trailing comment: the AWS CLI keeps
 * `14400  # note` as the whole value.
 */
export function validateIni(text: string): Problem[] {
  const problems: Problem[] = []
  const sectionLines = new Map<string, number>()
  let section: string | null = null
  let keyLines = new Map<string, number>()
  // Set while indented lines may continue the previous key's value
  let lastKey: string | null = null

  text.split('\n').forEach((raw, i) => {
    const lineNo = i + 1
    const line = raw.trimEnd()
    const stripped = line.trim()
    if (!stripped || COMMENT.test(line)) return

    const indented = /^\s/.test(line)
    if (indented && lastKey) return // continuation of a nested value

    // A line ending in "]" with no "=" can only be a header missing its "["
    // (a key/value line needs "=" or ":", and real values don't end in "]")
    const missingOpen =
      !stripped.startsWith('[') &&
      stripped.endsWith(']') &&
      !stripped.includes('=')
    if (!indented && (stripped.startsWith('[') || missingOpen)) {
      const header = stripped.match(HEADER)
      if (header) {
        section = header[1]
      } else {
        // Treat a broken header as the section it was meant to start, so the
        // keys under it aren't reported as duplicates of the section above
        section = stripped.replace(/^\[/, '').replace(/\]$/, '').trim()
        problems.push({
          line: lineNo,
          severity: 'error',
          message: !section
            ? `"${stripped}" has an empty section name`
            : missingOpen
              ? `"${stripped}" is missing its opening "["`
              : `"${stripped}" is missing its closing "]"`,
        })
      }
      const first = sectionLines.get(section)
      if (first !== undefined) {
        problems.push({
          line: lineNo,
          severity: 'error',
          message: `[${section}] appears more than once (first on line ${first})`,
        })
      } else {
        sectionLines.set(section, lineNo)
      }
      keyLines = new Map()
      lastKey = null
      return
    }

    const option = stripped.match(OPTION)
    if (!option || !option[1]) {
      problems.push({
        line: lineNo,
        severity: 'error',
        message: `"${stripped}" isn't a [section], a key = value line or a comment`,
      })
      lastKey = null
      return
    }

    const key = option[1].toLowerCase()
    if (section === null) {
      problems.push({
        line: lineNo,
        severity: 'error',
        message: `"${stripped}" comes before any [section] header`,
      })
      return
    }

    const first = keyLines.get(key)
    if (first !== undefined) {
      problems.push({
        line: lineNo,
        severity: 'error',
        message: `${key} is set twice in [${section}] (first on line ${first})`,
      })
    } else {
      keyLines.set(key, lineNo)
    }
    if (INLINE_COMMENT.test(option[2])) {
      problems.push({
        line: lineNo,
        severity: 'warning',
        message: `${key} in [${section}] has a comment after its value; the AWS CLI treats "${option[2]}" as the whole value, so move the comment to its own line`,
      })
    }
    lastKey = key
  })

  return problems
}

const displayPath = (path: string) =>
  path.startsWith(homedir()) ? '~' + path.slice(homedir().length) : path

const MAX_LISTED = 10

/**
 * Check ~/.aws/credentials and ~/.aws/config, print any problems, and return
 * false if either file has errors the AWS CLI would refuse to load.
 */
export async function checkAwsFiles(): Promise<boolean> {
  let ok = true
  for (const path of [credentialsPath(), configPath()]) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const problems = validateIni(await file.text())
    if (problems.length === 0) continue

    const errors = problems.filter((p) => p.severity === 'error')
    const out = process.stderr
    if (errors.length) {
      ok = false
      out.write(
        chalk.red(
          `  ✖  ${displayPath(path)} is invalid, so the AWS CLI can't read it:\n`,
        ),
      )
    } else {
      out.write(
        chalk.yellow(`  ⚠  ${displayPath(path)} has likely mistakes:\n`),
      )
    }
    for (const p of problems.slice(0, MAX_LISTED)) {
      const color = p.severity === 'error' ? chalk.red : chalk.yellow
      out.write(color(`       line ${p.line}: ${p.message}\n`))
    }
    if (problems.length > MAX_LISTED) {
      out.write(chalk.dim(`       …and ${problems.length - MAX_LISTED} more\n`))
    }
    if (errors.length) {
      out.write(chalk.dim(`     Fix the file, then run aws-auth again.\n`))
    }
  }
  return ok
}

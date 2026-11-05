import {chmod, realpath, rename, stat, writeFile} from 'fs/promises'
import {credentialsPath} from './credentials'
import {SESSION_SUFFIX} from './session'

/** Empty lines between the hand-maintained part of the file and the generated -session sections */
export const SESSION_GAP_LINES = 3

type Block = {name: string | null; lines: string[]}

const HEADER = /^\s*\[([^\]]+)\]/
const COMMENT = /^\s*[#;]/

const isSessionBlock = (b: Block) => !!b.name?.endsWith(SESSION_SUFFIX)

/** Split an INI file into a preamble (name: null) and one block per section */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [{name: null, lines: []}]
  for (const line of text.split('\n')) {
    const header = line.match(HEADER)
    if (!header) {
      blocks[blocks.length - 1].lines.push(line)
      continue
    }
    // Comment lines directly above a header describe that section, so they
    // travel with it rather than with the section before
    const prev = blocks[blocks.length - 1].lines
    let start = prev.length
    while (start > 0 && COMMENT.test(prev[start - 1])) start--
    blocks.push({
      name: header[1].trim(),
      lines: [...prev.splice(start), line],
    })
  }
  return blocks
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines]
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

/** Set key = value in a section block, replacing an existing line for the key */
function setKey(block: Block, key: string, value: string) {
  const keyLine = new RegExp(`^\\s*${key}\\s*=`)
  const line = `${key} = ${value}`
  const i = block.lines.findIndex((l) => keyLine.test(l))
  if (i >= 0) {
    block.lines[i] = line
  } else {
    block.lines = [...trimTrailingBlank(block.lines), line]
  }
}

/**
 * Write `values` into `[section]`, keeping every generated -session section
 * grouped at the end of the file, below SESSION_GAP_LINES empty lines.
 * Everything above that group is left exactly as it was.
 */
export function upsertSessionSection(
  text: string,
  section: string,
  values: Record<string, string>,
): string {
  const blocks = parseBlocks(text)
  const kept = blocks.filter((b) => !isSessionBlock(b))
  const sessions = blocks.filter(isSessionBlock)

  let target = sessions.find((b) => b.name === section)
  if (!target) {
    target = {name: section, lines: [`[${section}]`]}
    sessions.push(target)
  }
  for (const [key, value] of Object.entries(values)) setKey(target, key, value)

  const head = trimTrailingBlank(kept.flatMap((b) => b.lines)).join('\n')
  const tail = sessions
    .map((b) => trimTrailingBlank(b.lines).join('\n'))
    .join('\n\n')
  const gap = head ? '\n'.repeat(SESSION_GAP_LINES + 1) : ''
  return `${head}${gap}${tail}\n`
}

/** Write a -session section to the credentials file (atomically, owner-only by default) */
export async function writeSessionCredentials(
  section: string,
  values: Record<string, string>,
) {
  // Resolve symlinks so the rename replaces the real file, not the link
  const path = await realpath(credentialsPath()).catch(() => credentialsPath())
  const file = Bun.file(path)
  const text = (await file.exists()) ? await file.text() : ''
  const mode = await stat(path).then(
    (s) => s.mode & 0o777,
    () => 0o600,
  )

  const tmp = `${path}.aws-auth-${process.pid}`
  await writeFile(tmp, upsertSessionSection(text, section, values), {mode})
  await chmod(tmp, mode)
  await rename(tmp, path)
}

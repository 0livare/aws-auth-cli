import {homedir} from 'os'
import {join} from 'path'
import {SESSION_SUFFIX} from './session'

export type ProfileInfo = {
  name: string
  accountId?: string
}

/**
 * Where a profile's pieces live in ~/.aws:
 * - configSection: role_arn, mfa_serial, source_profile, op_item (read only)
 * - credsSection: the session credentials we write, and what AWS_PROFILE points at
 */
export type ResolvedProfile = {
  name: string
  configSection: string
  credsSection: string
}

/** Thrown when the AWS CLI can't read its config at all (e.g. a malformed file) */
export class AwsConfigError extends Error {}

type Sections = Map<string, Map<string, string>>

const credentialsPath = () => join(homedir(), '.aws', 'credentials')
const configPath = () => join(homedir(), '.aws', 'config')

export function findProfiles(
  profiles: ProfileInfo[],
  nameOrAccountId: string,
): ProfileInfo[] {
  const exact = profiles.find((profile) => profile.name === nameOrAccountId)
  if (exact) return [exact]
  return profiles.filter((profile) => profile.accountId === nameOrAccountId)
}

export async function getProfiles(): Promise<ProfileInfo[]> {
  const credFile = Bun.file(credentialsPath())
  if (!(await credFile.exists())) return []

  // Collect profile names in order from credentials file
  const names: string[] = []
  for (const line of (await credFile.text()).split('\n')) {
    const match = line.match(/^\[([^\]]+)\]/)
    if (match) names.push(match[1])
  }

  const sections = await readSections()
  const roleArn = (name: string) => sections.get(name)?.get('role_arn')

  const allNames = new Set(names)
  const seen = new Set<string>()
  const uniqueNames: string[] = []
  for (const name of names) {
    // Hide non-mfa entries that have a -mfa counterpart — they're auto-created
    // cached credential sections and would just duplicate the -mfa config entry.
    if (!name.endsWith('-mfa') && allNames.has(`${name}-mfa`)) continue
    if (!seen.has(name)) {
      seen.add(name)
      uniqueNames.push(name)
    }
  }

  // Only role profiles are listed; generated -session sections have no role_arn
  return uniqueNames
    .filter((name) => roleArn(name) ?? roleArn(`${name}-mfa`))
    .map((name) => ({
      name,
      accountId: extractAccountId(roleArn(name) ?? roleArn(`${name}-mfa`)),
    }))
}

/**
 * Decide which sections hold a profile's role config and its session
 * credentials. A `[name-mfa]` section keeps the original layout (config in
 * `-mfa`, credentials in `[name]`). Otherwise, if `[name]` itself has a
 * role_arn, config is read from `[name]` and
 * credentials go to `[name-session]`.
 */
export async function resolveProfile(name: string): Promise<ResolvedProfile> {
  const sections = await readSections()
  const mfaSection = `${name}-mfa`
  if (!sections.has(mfaSection) && sections.get(name)?.has('role_arn')) {
    return {name, configSection: name, credsSection: name + SESSION_SUFFIX}
  }
  return {name, configSection: mfaSection, credsSection: name}
}

/** Key/value pairs for every section in ~/.aws/credentials and ~/.aws/config */
async function readSections(): Promise<Sections> {
  const out: Sections = new Map()
  await parseSections(credentialsPath(), out, false)
  await parseSections(configPath(), out, true)
  return out
}

async function parseSections(
  filePath: string,
  out: Sections,
  isConfig: boolean,
) {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return

  let section: Map<string, string> | null = null
  for (const line of (await file.text()).split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/)
    if (sectionMatch) {
      let name = sectionMatch[1].trim()
      if (isConfig && name.startsWith('profile ')) name = name.slice(8).trim()
      section = out.get(name) ?? new Map()
      out.set(name, section)
    } else if (section) {
      const kv = line.match(/^\s*([^=#;\s]+)\s*=\s*(.*)$/)
      if (kv) section.set(kv[1], kv[2].trim())
    }
  }
}

function extractAccountId(roleArn?: string): string | undefined {
  return roleArn?.match(/arn:aws:iam::(\d+):/)?.[1]
}

/**
 * Read a value via the AWS CLI. Returns null when the key or profile isn't
 * set; throws AwsConfigError for anything else (e.g. a config file the CLI
 * can't parse), which would otherwise look like every value is missing.
 */
export async function getConfigValue(
  profile: string,
  key: string,
): Promise<string | null> {
  const proc = Bun.spawn(
    ['aws', 'configure', 'get', key, '--profile', profile],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exitCode !== 0) {
    const err = stderr.trim()
    if (!err || err.includes('could not be found')) return null
    throw new AwsConfigError(err)
  }
  return stdout.trim() || null
}

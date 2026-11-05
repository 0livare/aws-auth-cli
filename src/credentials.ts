import {homedir} from 'os'
import {join} from 'path'

export type ProfileInfo = {
  name: string
  accountId?: string
}

/** Thrown when the AWS CLI can't read its config at all (e.g. a malformed file) */
export class AwsConfigError extends Error {}

type Sections = Map<string, Map<string, string>>

// Same locations the AWS CLI uses, so we read and write the files it reads
export const credentialsPath = () =>
  process.env.AWS_SHARED_CREDENTIALS_FILE ||
  join(homedir(), '.aws', 'credentials')
export const configPath = () =>
  process.env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config')

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

  // Only role profiles are listed; generated -session sections have no role_arn
  return [...new Set(names)]
    .filter((name) => roleArn(name))
    .map((name) => ({name, accountId: extractAccountId(roleArn(name))}))
}

/**
 * Keys that make the AWS CLI resolve credentials itself (assume a role, run a
 * process, use SSO) or that hold credentials. Copying any of these into a
 * -session section would make the CLI ignore the cached session.
 */
const NON_INHERITED_KEYS = new Set([
  'role_arn',
  'source_profile',
  'credential_source',
  'mfa_serial',
  'role_session_name',
  'external_id',
  'duration_seconds',
  'web_identity_token_file',
  'credential_process',
  'sso_session',
  'sso_account_id',
  'sso_role_name',
  'sso_start_url',
  'sso_region',
  'aws_access_key_id',
  'aws_secret_access_key',
  'aws_session_token',
])

/**
 * Every property of a profile (from ~/.aws/credentials and ~/.aws/config,
 * config winning) that can safely follow it into its -session section:
 * region, output, op_item, custom keys, etc.
 */
export async function getInheritedSettings(
  profile: string,
): Promise<Record<string, string>> {
  const section = (await readSections()).get(profile) ?? new Map()
  return Object.fromEntries(
    [...section].filter(([key]) => !NON_INHERITED_KEYS.has(key)),
  )
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
  // Key whose value indented lines continue, e.g. the `s3` in
  //   s3 =
  //     max_concurrent_requests = 20
  let lastKey: string | null = null
  for (const line of (await file.text()).split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/)
    if (sectionMatch) {
      let name = sectionMatch[1].trim()
      if (isConfig && name.startsWith('profile ')) name = name.slice(8).trim()
      section = out.get(name) ?? new Map()
      out.set(name, section)
      lastKey = null
      continue
    }
    if (!section || !line.trim() || /^\s*[#;]/.test(line)) {
      lastKey = null
      continue
    }
    if (lastKey && /^\s/.test(line)) {
      // Nested setting: kept verbatim (indentation included) under its parent
      section.set(lastKey, `${section.get(lastKey)}\n${line.trimEnd()}`)
      continue
    }
    const kv = line.match(/^\s*([^=:#;\s]+)\s*[=:]\s*(.*)$/)
    if (kv) {
      section.set(kv[1], kv[2].trim())
      lastKey = kv[1]
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

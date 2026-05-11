import {homedir} from 'os'
import {join} from 'path'

export type ProfileInfo = {
  name: string
  accountId?: string
}

export async function getProfiles(): Promise<ProfileInfo[]> {
  const credFile = Bun.file(join(homedir(), '.aws', 'credentials'))
  if (!(await credFile.exists())) return []

  // Collect profile names in order from credentials file
  const names: string[] = []
  for (const line of (await credFile.text()).split('\n')) {
    const match = line.match(/^\[([^\]]+)\]/)
    if (match) names.push(match[1])
  }

  // Parse role_arns from both files (credentials + config)
  const roleArns: Record<string, string> = {}
  await parseRoleArns(join(homedir(), '.aws', 'credentials'), roleArns, false)
  await parseRoleArns(join(homedir(), '.aws', 'config'), roleArns, true)

  return names.map((name) => ({
    name,
    accountId: extractAccountId(roleArns[name]),
  }))
}

async function parseRoleArns(
  filePath: string,
  out: Record<string, string>,
  isConfig: boolean,
) {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return

  let section: string | null = null
  for (const line of (await file.text()).split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/)
    if (sectionMatch) {
      let name = sectionMatch[1].trim()
      if (isConfig && name.startsWith('profile ')) name = name.slice(8).trim()
      section = name
    } else if (section) {
      const kv = line.match(/^role_arn\s*=\s*(.+)/)
      if (kv) out[section] = kv[1].trim()
    }
  }
}

function extractAccountId(roleArn?: string): string | undefined {
  return roleArn?.match(/arn:aws:iam::(\d+):/)?.[1]
}

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
  const exitCode = await proc.exited
  if (exitCode !== 0) return null
  const text = await new Response(proc.stdout).text()
  return text.trim() || null
}

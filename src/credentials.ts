import {homedir} from 'os'
import {join} from 'path'

export async function getProfiles(): Promise<string[]> {
  const credFile = Bun.file(join(homedir(), '.aws', 'credentials'))
  if (!(await credFile.exists())) return []

  const text = await credFile.text()
  const profiles: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\[([^\]]+)\]/)
    if (match) profiles.push(match[1])
  }
  return profiles
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

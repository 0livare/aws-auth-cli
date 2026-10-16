import {homedir} from 'os'
import {join} from 'path'
import {mkdir} from 'fs/promises'
import chalk from './chalk'

// Sessions expiring sooner than this are treated as needing re-authentication
// so a freshly switched-to profile doesn't die mid-command.
const MIN_REMAINING_MS = 5 * 60 * 1000

const expiryDir = () => join(homedir(), '.aws', 'expiry')

/** Strip the -mfa suffix so "staging-mfa" and "staging" refer to the same session */
export function baseProfileName(profile: string): string {
  return profile.replace(/-mfa$/, '')
}

export async function getSessionExpiry(profile: string): Promise<Date | null> {
  const file = Bun.file(join(expiryDir(), baseProfileName(profile)))
  if (!(await file.exists())) return null
  let stored = (await file.text()).trim()
  // Older versions stripped the UTC offset from STS's expiration; without it
  // Date would parse the timestamp as local time.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(stored)) stored += 'Z'
  const expiresAt = new Date(stored)
  return isNaN(expiresAt.getTime()) ? null : expiresAt
}

/** Session expiry for each profile, keyed by the profile's name as given */
export async function getSessionExpiries(
  profiles: {name: string}[],
): Promise<Map<string, Date | null>> {
  const entries = await Promise.all(
    profiles.map(
      async (p) => [p.name, await getSessionExpiry(p.name)] as const,
    ),
  )
  return new Map(entries)
}

export async function saveSessionExpiry(profile: string, expiresAt: Date) {
  await mkdir(expiryDir(), {recursive: true})
  await Bun.write(join(expiryDir(), profile), expiresAt.toISOString())
}

export function isSessionUsable(expiresAt: Date | null): expiresAt is Date {
  return !!expiresAt && expiresAt.getTime() - Date.now() > MIN_REMAINING_MS
}

export function formatRemaining(expiresAt: Date): string {
  const remaining = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  )
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatExpiryTime(expiresAt: Date): string {
  return expiresAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Short, colored session label for list views, e.g. "● 42m left" */
export function sessionLabel(expiresAt: Date | null): string {
  if (!expiresAt) return chalk.dim('○ signed out')
  if (expiresAt.getTime() <= Date.now()) return chalk.yellow('○ expired')
  const left = `${formatRemaining(expiresAt)} left`
  return isSessionUsable(expiresAt)
    ? chalk.green(`● ${left}`)
    : chalk.yellow(`● ${left}`)
}

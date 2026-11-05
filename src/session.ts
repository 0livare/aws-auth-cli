import {homedir} from 'os'
import {join} from 'path'
import {mkdir, rm} from 'fs/promises'
import chalk from './chalk'

// Sessions expiring sooner than this are treated as needing re-authentication
// so a freshly switched-to profile doesn't die mid-command.
const MIN_REMAINING_MS = 5 * 60 * 1000

const expiryDir = () => join(homedir(), '.aws', 'expiry')

/**
 * Suffix for the generated section that holds a role profile's session
 * credentials. The two can't share a section: the AWS CLI would see role_arn
 * and try to assume the role itself, ignoring the cached session.
 */
export const SESSION_SUFFIX = '-session'

/** The generated profile AWS_PROFILE points at for a role profile */
export function sessionProfileName(profile: string): string {
  return profile + SESSION_SUFFIX
}

/** Strip the -session suffix so "staging-session" and "staging" refer to the same session */
export function baseProfileName(profile: string): string {
  return profile.endsWith(SESSION_SUFFIX)
    ? profile.slice(0, -SESSION_SUFFIX.length)
    : profile
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

/** Holds the role profile last selected in any shell, for --restore */
const lastProfileFile = () => join(expiryDir(), '.last')

export async function saveLastProfile(profile: string) {
  await mkdir(expiryDir(), {recursive: true})
  await Bun.write(lastProfileFile(), baseProfileName(profile))
}

export async function getLastProfile(): Promise<string | null> {
  const file = Bun.file(lastProfileFile())
  if (!(await file.exists())) return null
  return (await file.text()).trim() || null
}

export async function clearLastProfile() {
  await rm(lastProfileFile(), {force: true})
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

import chalk from './chalk'
import {formatExpiryTime, formatRemaining, getSessionExpiry} from './session'

export async function showTokenStatus(profile: string): Promise<void> {
  const expiresAt = await getSessionExpiry(profile)

  if (!expiresAt) {
    process.stderr.write(
      chalk.yellow(
        `  ⚠  [${profile}] no token — reauth: aws-auth <token> -p ${profile}\n`,
      ),
    )
    return
  }

  if (expiresAt.getTime() <= Date.now()) {
    process.stderr.write(
      chalk.yellow(
        `  ⚠  [${profile}] token expired — reauth: aws-auth <token> -p ${profile}\n`,
      ),
    )
  } else {
    process.stderr.write(
      chalk.green(
        `  ✓  [${profile}] token expires at ${formatExpiryTime(expiresAt)} (in ${formatRemaining(expiresAt)})\n`,
      ),
    )
  }
}

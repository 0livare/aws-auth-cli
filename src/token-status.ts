import {homedir} from 'os'
import {join} from 'path'
import chalk from 'chalk'

export async function showTokenStatus(profile: string): Promise<void> {
  const expiryFile = join(homedir(), '.aws', 'expiry', profile)
  const file = Bun.file(expiryFile)

  if (!(await file.exists())) {
    process.stderr.write(
      chalk.yellow(
        `  ⚠  [${profile}] no token — reauth: aws-auth ${profile} -t <token>\n`,
      ),
    )
    return
  }

  const expiryStr = (await file.text()).trim()
  const expDate = new Date(expiryStr)
  const remaining = Math.floor((expDate.getTime() - Date.now()) / 1000)

  if (remaining <= 0) {
    process.stderr.write(
      chalk.yellow(
        `  ⚠  [${profile}] token expired — reauth: aws-auth ${profile} -t <token>\n`,
      ),
    )
  } else {
    const h = Math.floor(remaining / 3600)
    const m = Math.floor((remaining % 3600) / 60)
    const s = remaining % 60
    const timeStr = expDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    process.stderr.write(
      chalk.green(
        `  ✓  [${profile}] token expires at ${timeStr} (in ${h}h ${m}m ${s}s)\n`,
      ),
    )
  }
}

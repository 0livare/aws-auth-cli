import pkg from '../../package.json'

export function version() {
  process.stderr.write(pkg.version + '\n')
}

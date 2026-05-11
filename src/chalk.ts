import { Chalk } from 'chalk'

// Chalk defaults to checking stdout for TTY/color support.
// Since the zsh wrapper captures stdout via $(), chalk would see a non-TTY
// and disable colors even though all our output goes to stderr.
// Use stderr's TTY status instead.
export default new Chalk({ level: process.stderr.isTTY ? 3 : 0 })

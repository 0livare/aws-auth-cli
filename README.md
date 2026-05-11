# AWS Auth Helper

A CLI to replace the `aws-profile` function in `~/.zshrc`. Reads available profiles from `~/.aws/credentials` and lets you select one from an interactive list, with full MFA / `sts assume-role` support.

## Installation

```sh
bun install
bun link          # makes `aws-auth` available globally
```

In order to allow this tool to modify your shell environment (a subprocess can't modify its parent shell's environment) add this wrapper to your `~/.zshrc`:

```zsh
# Wrapper to allow the aws-auth CLI tool to modify the current shell environment
# See: github.com/0livare/aws-auth
aws-auth() { eval "$(command aws-auth "$@")"; }
```

## Usage

```sh
# Interactive profile selector (reads ~/.aws/credentials)
aws-auth

# Set a profile and show its token status
aws-auth <profile>

# Set a profile and assume its role via MFA
aws-auth <profile> -t <token>

# Unset the current profile
aws-auth --clear
```

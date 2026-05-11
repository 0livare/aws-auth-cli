# AWS Auth Helper

A CLI to replace the `aws-profile` function in `~/.zshrc`. Reads available profiles from `~/.aws/credentials` and lets you select one from an interactive list, with full MFA / `sts assume-role` support and automatic TOTP retrieval from 1Password.

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

## 1Password setup

`aws-auth` can automatically fetch your MFA TOTP code from 1Password so you never have to type it manually.

**Requirements:**
1. [1Password CLI](https://developer.1password.com/docs/cli) installed
2. Signed in to the CLI: `op signin` (required — `op item get` won't work without it)

Add `op_item` to `~/.aws/config` pointing to the name of your 1Password item that holds the AWS MFA TOTP. Setting it under `[default]` applies it to all profiles:

```ini
[default]
op_item = AWS MFA

# Per-profile override (optional)
[profile staging-mfa]
role_arn = arn:aws:iam::123456789012:role/staging-role
mfa_serial = arn:aws:iam::123456789012:mfa/username
source_profile = default
op_item = AWS Staging MFA   # overrides [default] for this profile only
```

With this configured, `aws-auth <profile>` will automatically assume the role — no `-t` flag needed.

## Usage

```sh
# Interactive profile selector (reads ~/.aws/credentials)
aws-auth

# Set a profile — auto-assumes role via 1Password MFA if op_item is configured
aws-auth <profile>

# Set a profile and assume its role with a manual MFA token (bypasses 1Password)
aws-auth <profile> -t <token>

# Unset the current profile
aws-auth --clear
```


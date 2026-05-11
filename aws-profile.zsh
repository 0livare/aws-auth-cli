# Usage:
#   aws-profile                            show current profile
#   aws-profile <profile>                  set profile + show token status
#   aws-profile <profile> -t <token>       set profile + assume role via MFA
#   aws-profile --clear                    unset profile
aws-profile() {
  if [ -z "$1" ]; then
    echo "${AWS_PROFILE}${AWS_DEFAULT_PROFILE}"
    return
  fi
  if [ "$1" = "--clear" ]; then
    AWS_PROFILE=; AWS_DEFAULT_PROFILE=
    return
  fi
  local profile="${1%-mfa}"
  AWS_DEFAULT_PROFILE=
  export AWS_PROFILE="$profile"
  if [ "${2:-}" = "-t" ] && [ -n "${3:-}" ]; then
    local token="$3" mfa="${profile}-mfa"
    local role_arn mfa_serial src duration
    local access_key secret_key session_token expiry
    role_arn=$(aws configure get role_arn         --profile "$mfa" 2>/dev/null) || { echo "ERROR: [$mfa] missing role_arn"      >&2; return 1; }
    mfa_serial=$(aws configure get mfa_serial     --profile "$mfa" 2>/dev/null) || { echo "ERROR: [$mfa] missing mfa_serial"    >&2; return 1; }
    src=$(aws configure get source_profile        --profile "$mfa" 2>/dev/null) || { echo "ERROR: [$mfa] missing source_profile" >&2; return 1; }
    duration=$(aws configure get duration_seconds --profile "$mfa" 2>/dev/null || echo "3600")
    read -r access_key secret_key session_token expiry < <(
      aws sts assume-role \
        --role-arn "$role_arn" \
        --role-session-name "${profile//[^a-zA-Z0-9_=,.@-]/-}-$(date +%s)" \
        --serial-number "$mfa_serial" \
        --token-code "$token" \
        --duration-seconds "$duration" \
        --profile "$src" \
        --query '[Credentials.AccessKeyId,Credentials.SecretAccessKey,Credentials.SessionToken,Credentials.Expiration]' \
        --output text
    )
    [ -z "$access_key" ] && { echo "ERROR: assume-role returned empty credentials" >&2; return 1; }
    aws configure set aws_access_key_id     "$access_key"    --profile "$profile"
    aws configure set aws_secret_access_key "$secret_key"    --profile "$profile"
    aws configure set aws_session_token     "$session_token" --profile "$profile"
    mkdir -p ~/.aws/expiry
    echo "${expiry%%[+Z]*}" > ~/.aws/expiry/"$profile"
    local exp_epoch remaining h m s
    exp_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${expiry%%[+Z]*}" "+%s" 2>/dev/null)
    remaining=$((exp_epoch - $(date +%s)))
    h=$((remaining/3600)); m=$(((remaining%3600)/60)); s=$((remaining%60))
    echo "✓ [$profile] authenticated — expires at $(date -j -r "$exp_epoch" "+%I:%M %p") (in ${h}h ${m}m ${s}s)"
  else
    local expiry_file=~/.aws/expiry/"$profile"
    if [ ! -f "$expiry_file" ]; then
      echo "⚠  [$profile] no token — reauth: aws-profile $profile -t <token>"
      return
    fi
    local exp_epoch remaining h m s
    exp_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$(cat "$expiry_file")" "+%s" 2>/dev/null)
    remaining=$((exp_epoch - $(date +%s)))
    if [ "$remaining" -le 0 ]; then
      echo "⚠  [$profile] token expired — reauth: aws-profile $profile -t <token>"
    else
      h=$((remaining/3600)); m=$(((remaining%3600)/60)); s=$((remaining%60))
      echo "✓  [$profile] — token expires at $(date -j -r "$exp_epoch" "+%I:%M %p") (in ${h}h ${m}m ${s}s)"
    fi
  fi
}
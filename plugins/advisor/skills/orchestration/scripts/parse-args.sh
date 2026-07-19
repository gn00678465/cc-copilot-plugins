#!/usr/bin/env sh
# Parse $ARGUMENTS for the orchestration SKILL.
#
# Usage (wrap $ARGUMENTS in DOUBLE QUOTES so it arrives as a single
# positional argument; without quoting, the host shell will split it on
# whitespace and the script will only see the first word):
#   sh scripts/parse-args.sh "$ARGUMENTS"
#
# Output (single line, JSON, LF-terminated):
#   {"advisorModel":"","userPrompt":"Add rate limiting to the webhook handler"}
#   {"advisorModel":"opus","userPrompt":"Add rate limiting to the webhook handler"}
#
# Rules:
#   - "--advisor <model>" is a two-token flag: the token immediately
#     following --advisor (case-sensitive) is consumed as advisorModel,
#     whatever string it is -- this script does not validate it against a
#     fixed list; the caller decides which model names it accepts.
#   - Only the first "--advisor" occurrence is consumed. A bare trailing
#     "--advisor" with no following token yields advisorModel="" and is
#     still stripped. Any later "--advisor" token (once the flag has
#     already been matched once) is left in userPrompt as ordinary text.
#   - userPrompt = every token from $ARGUMENTS that isn't part of the
#     matched --advisor flag, joined with single spaces. Everything else
#     is ordinary task text -- not parsed further, not validated.
#   - JSON escape covers backslash and double-quote.

set -eu

raw="${1-}"

advisorModel=""
userPrompt=""
found_flag=0
skip_next=0

# shellcheck disable=SC2086
set -- $raw

for tok in "$@"; do
  if [ "$skip_next" = "1" ]; then
    advisorModel="$tok"
    skip_next=0
    continue
  fi
  if [ "$tok" = "--advisor" ] && [ "$found_flag" = "0" ]; then
    skip_next=1
    found_flag=1
    continue
  fi
  userPrompt="$userPrompt $tok"
done

userPrompt=$(printf '%s' "$userPrompt" | sed 's/^ //')

escapedModel=$(printf '%s' "$advisorModel" | sed 's/\\/\\\\/g; s/"/\\"/g')
escaped=$(printf '%s' "$userPrompt" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf '{"advisorModel":"%s","userPrompt":"%s"}\n' "$escapedModel" "$escaped"

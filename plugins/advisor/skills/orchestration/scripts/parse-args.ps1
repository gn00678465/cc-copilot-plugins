# Parse $ARGUMENTS for the orchestration SKILL (PowerShell 7+).
#
# Usage (canonical -- wrap $ARGUMENTS in DOUBLE QUOTES so it arrives as a
# single positional argument; otherwise PowerShell will re-tokenize on
# space and the script's first arg sees only the first word):
#   pwsh -NoProfile -File scripts/parse-args.ps1 "$ARGUMENTS"
#
# Output (single line, JSON, LF-terminated):
#   {"advisorModel":"","userPrompt":"Add rate limiting to the webhook handler"}
#   {"advisorModel":"opus","userPrompt":"Add rate limiting to the webhook handler"}
#
# Rules: same as parse-args.sh. See that file's header for the full contract.
# --advisor match is case-sensitive (-ceq); only the first occurrence is consumed.

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $InputArgs
)

$raw = if ($InputArgs) { ($InputArgs -join ' ') } else { '' }

$tokens = $raw -split '\s+' | Where-Object { $_ -ne '' }

$advisorModel = ''
$userPromptTokens = @()
$foundFlag = $false
$skipNext = $false

foreach ($tok in $tokens) {
    if ($skipNext) {
        $advisorModel = $tok
        $skipNext = $false
        continue
    }
    if ($tok -ceq '--advisor' -and -not $foundFlag) {
        $skipNext = $true
        $foundFlag = $true
        continue
    }
    $userPromptTokens += $tok
}

$userPrompt = ($userPromptTokens -join ' ').Trim()

# ConvertTo-Json -Compress emits CRLF on Windows by default; force LF for
# parity with parse-args.sh.
$json = [ordered]@{
    advisorModel = $advisorModel
    userPrompt   = $userPrompt
} | ConvertTo-Json -Compress

[Console]::Out.Write($json + "`n")

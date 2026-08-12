<#
.SYNOPSIS
    Assemble and push a Hugging Face Space running on the Gradio SDK.

.DESCRIPTION
    Windows-native equivalent of push-gradio-space.sh. It exists because
    PowerShell has no shebang handling: running `./push-gradio-space.sh`
    hands the file to whatever is associated with .sh, so it opens in an
    editor and nothing executes. That failure is silent and looks like the
    script ran and printed itself.

    Use this when Docker Spaces are gated behind a paid plan on your account.
    Gradio and Static Spaces are free; a Gradio Space just runs `app.py` and
    proxies port 7860, which is all this backend needs. See gradio/app.py.

    A Space is its own git repo and expects app.py + README.md + requirements
    at ITS root, while this project keeps the backend under backend/. Rather
    than contort the main repo, this builds the Space tree in a scratch
    directory and pushes only that.

    It force-pushes: the Space is a build artefact of this repo, not somewhere
    to edit code. Anything committed in the Space UI is lost on the next run.

.PARAMETER UserName
    Your Hugging Face username.

.PARAMETER SpaceName
    Space name. Defaults to neighbouraid-api.

.PARAMETER DryRun
    Assemble the tree and list it without pushing. Worth doing once, since
    the real run force-pushes.

.PARAMETER SkipTests
    Skip the backend test suite. Only for debugging this script itself --
    the Space has no CI, so the tests are the one gate before production.

.EXAMPLE
    ./deploy/huggingface/push-gradio-space.ps1 pk23nk21 neighbouraid-api

.EXAMPLE
    ./deploy/huggingface/push-gradio-space.ps1 pk23nk21 -DryRun

.NOTES
    Requires git and a Hugging Face write token (git will prompt):
    https://huggingface.co/settings/tokens
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$UserName,

    [Parameter(Position = 1)]
    [string]$SpaceName = 'neighbouraid-api',

    [switch]$DryRun,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Here     = Join-Path $RepoRoot 'deploy\huggingface\gradio'
$Remote   = "https://huggingface.co/spaces/$UserName/$SpaceName"

# Prefer the project venv so the tests run against the pinned dependencies
# rather than whatever python happens to be first on PATH.
$Py = Join-Path $RepoRoot 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $Py)) { $Py = 'python' }

if (-not $SkipTests) {
    Write-Host '==> Running backend tests' -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot 'backend')
    try {
        & $Py -m pytest -q
        if ($LASTEXITCODE -ne 0) {
            throw "Backend tests failed -- refusing to deploy. Re-run with -SkipTests only if you know why."
        }
    }
    finally { Pop-Location }
}

# Validate the Space README frontmatter locally. The Hub rejects an invalid
# one with a server-side "pre-receive hook declined" that names no field, so
# catching it here turns a guess-and-force-push loop into a one-line error.
Write-Host '==> Validating Space README frontmatter' -ForegroundColor Cyan
& $Py (Join-Path $RepoRoot 'deploy/huggingface/validate_readme.py') (Join-Path $Here 'README.md')
if ($LASTEXITCODE -ne 0) { throw 'Space README frontmatter is invalid -- see above. Fix it before pushing.' }

$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("na-space-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

try {
    Write-Host "==> Assembling Space tree in $Stage" -ForegroundColor Cyan
    Copy-Item (Join-Path $Here 'app.py')    (Join-Path $Stage 'app.py')
    Copy-Item (Join-Path $Here 'README.md') (Join-Path $Stage 'README.md')
    Copy-Item (Join-Path $RepoRoot 'backend\app') (Join-Path $Stage 'app') -Recurse

    # gradio is a deploy-only dependency: it satisfies the Space SDK and
    # renders the landing page, and has no place in the backend's own
    # requirements.txt where everyone would install it for nothing.
    $req = Get-Content (Join-Path $RepoRoot 'backend\requirements.txt') -Raw
    $req += "`n# Added by push-gradio-space.ps1 -- required by the Space SDK only.`ngradio>=6.23.1`n"
    # -Encoding utf8 explicitly: Set-Content defaults to the system ANSI
    # codepage here, which would corrupt any non-ASCII content on the way in.
    Set-Content -Path (Join-Path $Stage 'requirements.txt') -Value $req -Encoding utf8 -NoNewline

    # Never ship local config or caches. A .env here would override the
    # Space's configured secrets with whatever a developer had on their
    # laptop -- most damagingly a MONGO_URL pointing at localhost.
    Get-ChildItem -Path $Stage -Recurse -Force -Include '__pycache__', '.pytest_cache' -Directory -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $Stage -Recurse -Force -Include '*.pyc', '.env' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Set-Content -Path (Join-Path $Stage '.gitignore') -Encoding utf8 -Value @'
__pycache__/
*.pyc
.env
'@

    if ($DryRun) {
        Write-Host '==> -DryRun: assembled tree, not pushing' -ForegroundColor Yellow
        Get-ChildItem -Path $Stage -Recurse -File -Force |
            ForEach-Object { '    ' + $_.FullName.Substring($Stage.Length + 1) } |
            Sort-Object
        Write-Host ''
        Write-Host "    Would force-push the above to $Remote"
        return
    }

    Write-Host "==> Pushing to $Remote" -ForegroundColor Cyan
    Push-Location $Stage
    try {
        git init -q -b main
        if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
        git add -A
        $sha = (git -C $RepoRoot rev-parse --short HEAD)
        git -c user.email=deploy@neighbouraid -c user.name=deploy commit -qm "Deploy from $sha"
        if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
        git remote add space $Remote
        git push --force space main
        if ($LASTEXITCODE -ne 0) {
            throw "git push failed. Does the Space exist? Create it at https://huggingface.co/new-space (SDK: Gradio, template: Blank). Authenticate with a WRITE token from https://huggingface.co/settings/tokens"
        }
    }
    finally { Pop-Location }

    Write-Host ''
    Write-Host '==> Done.' -ForegroundColor Green
    Write-Host "    Build logs: $Remote`?logs=build"
    Write-Host "    Live URL:   https://$UserName-$SpaceName.hf.space"
    Write-Host ''
    Write-Host 'First push? Set these under Settings -> Variables and secrets:'
    Write-Host '    MONGO_URL, JWT_SECRET, ENVIRONMENT=production'
    Write-Host '  ANTHROPIC_API_KEY is optional -- without it triage runs free on the'
    Write-Host '  multilingual keyword heuristic.'
}
finally {
    Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
}

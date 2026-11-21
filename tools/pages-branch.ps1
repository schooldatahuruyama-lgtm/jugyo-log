# Build/update the "pages" branch for GitHub Pages from HEAD's app files only
# (no history, no docs, no .ai-* folders).
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/pages-branch.ps1
# Then: git push origin pages   (first time: GitHub Settings > Pages > Branch: pages / (root))
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$paths = @("index.html", "check.html", "sw.js", "css", "js", "assets")
$head = (git rev-parse --short HEAD).Trim()
$tmpIndex = Join-Path $env:TEMP ("jugyolog-pages-index-" + [guid]::NewGuid().ToString("N"))
$tmpBlob = Join-Path $root (".pages-blob-" + [guid]::NewGuid().ToString("N"))
$utf8 = New-Object Text.UTF8Encoding($false)
$env:GIT_INDEX_FILE = $tmpIndex
try {
  git read-tree --empty
  $files = @(git ls-tree -r HEAD --name-only -- $paths)
  foreach ($f in $files) {
    $blob = (git rev-parse "HEAD:$f").Trim()
    git update-index --add --cacheinfo "100644,$blob,$f"
  }
  # .nojekyll: tell GitHub Pages not to run Jekyll
  [IO.File]::WriteAllText($tmpBlob, "", $utf8)
  $empty = (git hash-object -w --no-filters -- $tmpBlob).Trim()
  git update-index --add --cacheinfo "100644,$empty,.nojekyll"
  # Published version: replace the dev marker in the tree only, leaving the working tree alone
  [IO.File]::WriteAllText($tmpBlob, "export const VERSION = '$head';`n", $utf8)
  $versionJs = (git hash-object -w --no-filters -- $tmpBlob).Trim()
  git update-index --add --cacheinfo "100644,$versionJs,js/version.js"
  [IO.File]::WriteAllText($tmpBlob, "$head`n", $utf8)
  $versionText = (git hash-object -w --no-filters -- $tmpBlob).Trim()
  git update-index --add --cacheinfo "100644,$versionText,version.txt"
  # Offline app manifest: publish it in the tree only, using UTF-8 without BOM
  $appFiles = @($files | Where-Object { $_ -ne "check.html" -and $_ -ne "sw.js" } | ForEach-Object { $_.Replace('\', '/') })
  $manifest = @{ version = $head; files = $appFiles } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($tmpBlob, $manifest, $utf8)
  $appManifest = (git hash-object -w --no-filters -- $tmpBlob).Trim()
  git update-index --add --cacheinfo "100644,$appManifest,app-files.json"
  $tree = (git write-tree).Trim()
} finally {
  if (Test-Path -LiteralPath $tmpBlob) { Remove-Item -LiteralPath $tmpBlob }
  Remove-Item Env:GIT_INDEX_FILE
  if (Test-Path $tmpIndex) { Remove-Item $tmpIndex }
}
$parent = git rev-parse --verify --quiet refs/heads/pages
$msg = "pages: $head"
if ($parent) { $commit = (git commit-tree $tree -p $parent.Trim() -m $msg).Trim() } else { $commit = (git commit-tree $tree -m $msg).Trim() }
git update-ref refs/heads/pages $commit
"pages branch updated: $commit (HEAD $head, files $($files.Count))"

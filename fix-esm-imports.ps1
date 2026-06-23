# fix-esm-imports.ps1
# Adds .js extensions to bare relative imports in compiled ESM output files
# This is needed because Node.js ESM requires explicit extensions

$distDir = ".\dist-electron"
$files = Get-ChildItem -Path $distDir -Recurse -Include "*.js"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    if ($null -eq $content) { continue }

    # Fix: from '../something' -> from '../something.js'
    # Fix: from './something' -> from './something.js'
    # Only add .js if the import doesn't already have an extension
    $fixed = $content -replace "from '(\.\./[^']*?)(?<!\.js)(?<!\.json)(?<!\.css)(?<!\.ts)'", "from '`$1.js'"
    $fixed = $fixed -replace 'from "(\.\./[^"]*?)(?<!\.js)(?<!\.json)(?<!\.css)(?<!\.ts)"', 'from "`$1.js"'
    $fixed = $fixed -replace "from '(\./[^']*?)(?<!\.js)(?<!\.json)(?<!\.css)(?<!\.ts)'", "from '`$1.js'"
    $fixed = $fixed -replace 'from "(\./[^"]*?)(?<!\.js)(?<!\.json)(?<!\.css)(?<!\.ts)"', 'from "`$1.js"'

    if ($fixed -ne $content) {
        Set-Content -Path $file.FullName -Value $fixed -NoNewline
        Write-Host "Fixed: $($file.FullName)"
    }
}

Write-Host "Done fixing ESM imports."

<#
    Sonar SG - copy the local `services` table up to Render Postgres.

    Run it from the project root:

        powershell -ExecutionPolicy Bypass -File phase_3_postgis\scripts\push_to_render.ps1

    It asks for two things and stores neither:
      1. the password of your local `postgres` user
      2. the EXTERNAL Database URL of your Render Postgres instance
         (Render dashboard -> your Postgres -> Connect -> External Database URL)

    Use the EXTERNAL url here, not the internal one. The internal hostname
    only resolves inside Render's own network.
#>

$ErrorActionPreference = "Stop"

# --- locate the PostgreSQL client tools ----------------------------------
$pgBin = $null
foreach ($dir in (Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending)) {
    if (Test-Path (Join-Path $dir.FullName "bin\pg_dump.exe")) {
        $pgBin = Join-Path $dir.FullName "bin"
        break
    }
}
if (-not $pgBin) {
    throw "Could not find pg_dump.exe under C:\Program Files\PostgreSQL. Install the PostgreSQL client tools, or edit `$pgBin in this script."
}

$pgDump = Join-Path $pgBin "pg_dump.exe"
$psql   = Join-Path $pgBin "psql.exe"
Write-Host "Using client tools from $pgBin" -ForegroundColor DarkGray

# --- the SQL file that adds the geography column and indexes -------------
$prepareSql = Join-Path $PSScriptRoot "..\sql\prepare_services.sql"
if (-not (Test-Path $prepareSql)) {
    throw "Cannot find prepare_services.sql at $prepareSql. Run this script from inside the repository."
}

# --- credentials ---------------------------------------------------------
function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try   { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host ""
Write-Host "Local database: postgres@localhost/singapore_webgis" -ForegroundColor Cyan
$localPassword = Read-Secret "Password for the local 'postgres' user"

Write-Host ""
Write-Host "Target database. Paste its connection URL (postgresql://...)" -ForegroundColor Cyan
$renderUrl = Read-Secret "Target database URL"

if ([string]::IsNullOrWhiteSpace($renderUrl)) { throw "No connection URL supplied." }
if ($renderUrl -notmatch '^postgres(ql)?://')  { throw "That does not look like a postgresql:// connection URL." }

# Supabase's direct host (db.<ref>.supabase.co) resolves over IPv6 only,
# which Render cannot reach. The pooler host is the IPv4 one.
if ($renderUrl -match 'db\.[a-z0-9]+\.supabase\.co') {
    Write-Host "Note: that is Supabase's DIRECT host. Use the Session pooler string" -ForegroundColor Yellow
    Write-Host "      (aws-0-....pooler.supabase.com) so Render can reach it too." -ForegroundColor Yellow
}
if ($renderUrl -match '@localhost|@127\.0\.0\.1') {
    throw "That URL points at localhost - it has to be the hosted database."
}

# psql/pg_dump read the password from this variable, so it never appears
# in a command line or in your shell history.
$env:PGPASSWORD = $localPassword
$env:PGCLIENTENCODING = "UTF8"

$dumpFile = Join-Path $env:TEMP "sonar_sg_services.sql"

try {
    # --- 1. check the local table ---------------------------------------
    Write-Host ""
    Write-Host "[1/6] Reading the local services table..." -ForegroundColor Green

    $localCount = & $psql -U postgres -h localhost -d singapore_webgis -w -tAc `
        "SELECT COUNT(*) FROM services;"
    if ($LASTEXITCODE -ne 0) { throw "Could not query the local database. Is PostgreSQL running, and is the password correct?" }

    $localCount = $localCount.Trim()
    Write-Host "      local services rows: $localCount"
    if ([int]$localCount -eq 0) { throw "The local services table is empty - there is nothing to upload." }

    # --- 2. dump just that table ----------------------------------------
    Write-Host "[2/6] Dumping the table to $dumpFile ..." -ForegroundColor Green

    & $pgDump -U postgres -h localhost -d singapore_webgis `
        --table=public.services `
        --no-owner --no-acl --no-comments `
        --clean --if-exists `
        --quote-all-identifiers `
        -f $dumpFile
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }

    $sizeKb = [math]::Round((Get-Item $dumpFile).Length / 1KB, 1)
    Write-Host "      wrote $sizeKb KB"

    # --- 3. PostGIS on the target ---------------------------------------
    # The dumped CREATE TABLE references the `geometry` type, so the
    # extension has to exist before the restore runs.
    Write-Host "[3/6] Enabling PostGIS on the target database..." -ForegroundColor Green

    Remove-Item Env:PGPASSWORD   # the URL carries its own credentials

    & $psql $renderUrl -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis;"
    if ($LASTEXITCODE -ne 0) { throw "Could not enable PostGIS on the target database. Check the URL, and that the instance is awake." }

    # --- 4. restore ------------------------------------------------------
    Write-Host "[4/6] Uploading the table (this replaces any existing services table)..." -ForegroundColor Green

    & $psql $renderUrl -v ON_ERROR_STOP=1 -f $dumpFile
    if ($LASTEXITCODE -ne 0) { throw "The restore failed. Nothing further was changed." }

    # --- 5. geography column + indexes -----------------------------------
    Write-Host "[5/6] Adding the geog column and spatial indexes..." -ForegroundColor Green

    & $psql $renderUrl -v ON_ERROR_STOP=1 -f $prepareSql
    if ($LASTEXITCODE -ne 0) { throw "prepare_services.sql failed on the target database." }

    # --- 6. verify -------------------------------------------------------
    Write-Host "[6/6] Verifying..." -ForegroundColor Green

    $remote = & $psql $renderUrl -tAc @"
SELECT COUNT(*)::text
       || ' rows, '
       || COUNT(geog)::text || ' with geography, '
       || COUNT(DISTINCT category)::text || ' categories'
FROM services;
"@
    if ($LASTEXITCODE -ne 0) { throw "Verification query failed." }

    Write-Host ""
    Write-Host "Done. The hosted database now holds: $($remote.Trim())" -ForegroundColor Green
    Write-Host "Local rows were: $localCount" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Now check the live API:" -ForegroundColor Cyan
    Write-Host "  curl.exe https://singapore-data-project.onrender.com/api/health"
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if (Test-Path $dumpFile) {
        Remove-Item $dumpFile -Force -ErrorAction SilentlyContinue
        Write-Host "Removed the temporary dump file." -ForegroundColor DarkGray
    }
}

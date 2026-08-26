# RidePool dev database helper scripts.
# These manage the LOCAL development PostgreSQL cluster in `.local/postgres`.
# Production database management is intentionally NOT included.

$ErrorActionPreference = "Stop"

$PgBin = "C:\Program Files\PostgreSQL\18\bin"
$Root = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) ".local\postgres"
$Data = Join-Path $Root "data"
$Log = Join-Path $Root "postgres.log"
$Port = 5433
$User = "ridepool"
$Password = "Saishiva@123"
$DbName = "ridepool"

function Ensure-PgBin {
  if (-not (Test-Path (Join-Path $PgBin "initdb.exe"))) {
    Write-Error "PostgreSQL binaries not found at $PgBin. Install PostgreSQL 18 and update the PgBin path in this script."
  }
}

function Ensure-Stopped {
  Ensure-PgBin
  & (Join-Path $PgBin "pg_ctl.exe") -D $Data status 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & (Join-Path $PgBin "pg_ctl.exe") -D $Data stop -m fast | Out-Null
  }
}

function Start-DevPostgres {
  Ensure-PgBin
  if (-not (Test-Path (Join-Path $Data "PG_VERSION"))) {
    Write-Error "Dev cluster not initialized. Run: pnpm db:init"
  }
  $running = & (Join-Path $PgBin "pg_ctl.exe") -D $Data status 2>$null
  if ($LASTEXITCODE -ne 0) {
    # Use a clean PATH so child backends can resolve DLLs correctly.
    $minPath = "C:\Windows\System32;C:\Windows;$PgBin"
    $cmd = "set PATH=$minPath && `"$PgBin\postgres.exe`" -D `"$Data`" -p $Port > `"$Log`" 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $PgBin -WindowStyle Hidden
    Start-Sleep -Seconds 4
  }
  & (Join-Path $PgBin "pg_isready.exe") -h localhost -p $Port
  if ($LASTEXITCODE -ne 0) {
    Write-Error "PostgreSQL did not start. See $Log"
  }
}

function Invoke-Sql {
  param([string]$Sql, [string]$Db = "postgres")
  Ensure-PgBin
  $env:PGPASSWORD = $Password
  & (Join-Path $PgBin "psql.exe") -h localhost -p $Port -U $User -w -d $Db -c $Sql
  if ($LASTEXITCODE -ne 0) { Write-Error "psql failed for: $Sql" }
}

switch ($args[0]) {
  "init" {
    Ensure-Stopped
    if (-not (Test-Path $Data)) {
      New-Item -ItemType Directory -Path (Split-Path $Data) -Force | Out-Null
      $pwFile = Join-Path $env:TEMP "ridepool_pgpw.txt"
      Set-Content -Path $pwFile -Value $Password -NoNewline
      & (Join-Path $PgBin "initdb.exe") -D $Data -U $User --auth=scram-sha-256 --pwfile=$pwFile -E UTF8
      if ($LASTEXITCODE -ne 0) { Write-Error "initdb failed" }
      Remove-Item $pwFile -ErrorAction SilentlyContinue
      Add-Content -Path (Join-Path $Data "postgresql.conf") -Value "`nshared_buffers = 64MB`nmax_connections = 50`n"
    }
    Start-DevPostgres
# Create database if missing
$env:PGPASSWORD = $Password
$exists = & (Join-Path $PgBin "psql.exe") -h localhost -p $Port -U $User -w -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
    if ($env:PGPASSWORD -ne $Password) { $env:PGPASSWORD = $Password }
    if ($LASTEXITCODE -ne 0 -or $exists -ne "1") {
      Invoke-Sql "CREATE DATABASE $DbName"
    }
    Write-Host "Dev database ready: postgresql://${User}:***@localhost:${Port}/${DbName}"
  }
  "start" { Start-DevPostgres }
  "stop" {
    Ensure-Stopped
    Write-Host "Dev database stopped"
  }
  "status" {
    Ensure-PgBin
    & (Join-Path $PgBin "pg_isready.exe") -h localhost -p $Port
  }
  default {
    Write-Host "Usage:"
    Write-Host "  pnpm db:init    Initialize and start the local dev cluster + create the ridepool database"
    Write-Host "  pnpm db:start   Start the local dev cluster"
    Write-Host "  pnpm db:stop    Stop the local dev cluster"
    Write-Host "  pnpm db:status  Check dev cluster status"
  }
}

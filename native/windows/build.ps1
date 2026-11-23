param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build'),
    [switch]$SkipSelfTest
)

$ErrorActionPreference = 'Stop'

# Import the x64 MSVC environment from an existing Visual Studio installation.
# rustc finds the linker through vswhere on its own, but cl.exe is only on PATH
# inside a Developer prompt, so resolve it here instead of failing.
function Import-MsvcEnvironment {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw 'MSVC cl.exe was not found and vswhere.exe is missing. Install Visual Studio Build Tools with the Desktop development with C++ workload.'
    }

    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installPath) {
        throw 'MSVC cl.exe was not found. Install the Microsoft.VisualStudio.Component.VC.Tools.x86.x64 component of Visual Studio Build Tools.'
    }

    $vcvars = Join-Path $installPath 'VC/Auxiliary/Build/vcvars64.bat'
    if (-not (Test-Path $vcvars)) {
        throw "MSVC environment script was not found at $vcvars."
    }

    # vcvars64.bat only exports into its own cmd process, so replay `set` here.
    foreach ($line in & cmd.exe /d /c "`"$vcvars`" >nul 2>&1 && set") {
        $separator = $line.IndexOf('=')
        if ($separator -gt 0) {
            $name = $line.Substring(0, $separator)
            $value = $line.Substring($separator + 1)
            Set-Item -Path "Env:$name" -Value $value -ErrorAction SilentlyContinue
        }
    }
}

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    Import-MsvcEnvironment
}

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'MSVC cl.exe was not found after importing the Visual Studio environment. Run from a Developer PowerShell for Visual Studio or repair the Build Tools installation.'
}

$buildPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
$sourcePath = Join-Path $PSScriptRoot 'drag_watcher.cpp'

Push-Location $buildPath
try {
    & cl.exe /nologo /std:c++17 /EHsc /MT /W4 /WX /permissive- /DUNICODE /D_UNICODE $sourcePath user32.lib /Fe:santra-drag-watcher.exe
    if ($LASTEXITCODE -ne 0) {
        throw "MSVC build failed with exit code $LASTEXITCODE"
    }

    if (-not $SkipSelfTest) {
        & .\santra-drag-watcher.exe --self-test
        if ($LASTEXITCODE -ne 0) {
            throw "Watcher self-test failed with exit code $LASTEXITCODE"
        }
    }
} finally {
    Pop-Location
}

Write-Output "Built $buildPath\santra-drag-watcher.exe"

# RPA Video Editor - Native Desktop Launcher Build Script
# Compiles true Windows GUI executable (RPA_Video_Editor.exe) using .NET C# Compiler

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  BUILDING RPA VIDEO EDITOR NATIVE DESKTOP EXECUTABLE " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    $cscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $cscPath)) {
    Write-Error "Microsoft .NET C# compiler (csc.exe) not found."
    exit 1
}

$outputExe = Join-Path $rootDir "RPA_Video_Editor.exe"
$iconPath = Join-Path $rootDir "client\favicon.ico"
$sourceFile = Join-Path $rootDir "src-launcher\Launcher.cs"

Write-Host "Compiling native GUI binary..." -ForegroundColor Yellow
& $cscPath /target:winexe /out:"$outputExe" /win32icon:"$iconPath" /r:System.Windows.Forms.dll /r:System.Drawing.dll /optimize+ "$sourceFile"

if ($LASTEXITCODE -eq 0 -and (Test-Path $outputExe)) {
    Write-Host "Compilation successful: $outputExe" -ForegroundColor Green

    # Attempt Authenticode Code Signing
    try {
        $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*K Vanlalrengpuia*" } | Select-Object -First 1
        if (-not $cert) {
            $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=K Vanlalrengpuia, O=RPA Video Editor" -CertStoreLocation "Cert:\CurrentUser\My"
        }
        if ($cert) {
            Set-AuthenticodeSignature -FilePath $outputExe -Certificate $cert | Out-Null
            Write-Host "Authenticode signature applied." -ForegroundColor Green
        }
    } catch {
        Write-Warning "Code signing step skipped: $($_.Exception.Message)"
    }

    Write-Host "`nReady to launch: RPA_Video_Editor.exe" -ForegroundColor Cyan
} else {
    Write-Error "Compilation failed."
    exit 1
}

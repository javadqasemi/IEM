<#
    Wandelt cad/out/*.dxf nach DWG.

        powershell -File cad\to_dwg.ps1
        powershell -File cad\to_dwg.ps1 -Version ACAD2013

    Voraussetzung: ODA File Converter (gratis, Open Design Alliance)
        https://www.opendesign.com/guestfiles/oda_file_converter

    DWG ist ein geschlossenes Format - es gibt keine freie Bibliothek, die es
    schreibt. Deshalb erzeugt build_dxf.py DXF R2018 und dieser Schritt
    konvertiert. Alternativ oeffnet jedes CAD (AutoCAD, BricsCAD, ZWCAD,
    Revit, Archicad) das DXF direkt und speichert es als DWG.
#>

param(
    [string]$Version = "ACAD2018",
    [string]$Converter = ""
)

$ErrorActionPreference = "Stop"

$outDir = Join-Path $PSScriptRoot "out"
if (-not (Test-Path $outDir)) {
    throw "Kein Ordner $outDir - zuerst 'python cad/build_dxf.py' ausfuehren."
}

if (-not $Converter) {
    $candidates = Get-ChildItem -Path @(
        "$env:ProgramFiles\ODA",
        "${env:ProgramFiles(x86)}\ODA"
    ) -Filter "ODAFileConverter.exe" -Recurse -ErrorAction SilentlyContinue
    if ($candidates) { $Converter = $candidates[0].FullName }
}

if (-not $Converter -or -not (Test-Path $Converter)) {
    Write-Host "ODA File Converter nicht gefunden." -ForegroundColor Yellow
    Write-Host "Herunterladen: https://www.opendesign.com/guestfiles/oda_file_converter"
    Write-Host "Danach erneut ausfuehren, oder Pfad angeben:"
    Write-Host "  powershell -File cad\to_dwg.ps1 -Converter 'C:\...\ODAFileConverter.exe'"
    exit 1
}

$dwgDir = Join-Path $outDir "dwg"
if (-not (Test-Path $dwgDir)) { New-Item -ItemType Directory -Path $dwgDir | Out-Null }

# Aufruf: <in> <out> <version> <typ> <rekursiv> <audit> [filter]
& $Converter $outDir $dwgDir $Version "DWG" "0" "1" "*.DXF"

$made = Get-ChildItem $dwgDir -Filter *.dwg -ErrorAction SilentlyContinue
if ($made) {
    foreach ($m in $made) {
        "{0,-40} {1,8:N1} KB" -f $m.Name, ($m.Length / 1KB)
    }
} else {
    Write-Host "Keine DWG erzeugt - Ausgabe des Konverters pruefen." -ForegroundColor Yellow
    exit 1
}

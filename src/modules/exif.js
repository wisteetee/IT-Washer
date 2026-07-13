'use strict';
// Module Métadonnées EXIF (GPS) des photos.
// Scanne un dossier pour repérer les images contenant des coordonnées GPS,
// et permet de les nettoyer (réécriture sans EXIF). Aucune donnée n'est envoyée.
// Utilise System.Drawing (présent sur Windows) via PowerShell.
const { runPowerShell } = require('../ps');

// Scanne un dossier (récursif, limité) et renvoie les images avec GPS.
async function scan(folder, { max = 500 } = {}) {
  if (!folder) return { images: [], scanned: 0, error: 'Aucun dossier choisi.' };
  const safe = folder.replace(/'/g, "''");
  // Property IDs EXIF : 0x0001 GPSLatitudeRef, 0x0002 GPSLatitude, 0x0004 GPSLongitude.
  const script = `
Add-Type -AssemblyName System.Drawing
$exts = @('.jpg','.jpeg','.tiff','.tif')
$files = Get-ChildItem -LiteralPath '${safe}' -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $exts -contains $_.Extension.ToLower() } | Select-Object -First ${max}
$scanned = 0
$results = @()
foreach ($f in $files) {
  $scanned++
  try {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $ids = $img.PropertyIdList
    $hasGps = ($ids -contains 2) -or ($ids -contains 4)
    $img.Dispose()
    if ($hasGps) {
      $results += [PSCustomObject]@{ Path = $f.FullName; Name = $f.Name; Size = $f.Length }
    }
  } catch { }
}
[PSCustomObject]@{ Scanned = $scanned; Images = $results } | ConvertTo-Json -Compress -Depth 4
`;
  const res = await runPowerShell(script, { timeout: 180000 });
  try {
    const p = JSON.parse(res.stdout || '{}');
    const imgs = p.Images ? (Array.isArray(p.Images) ? p.Images : [p.Images]) : [];
    return {
      scanned: p.Scanned || 0,
      images: imgs.map((i) => ({ path: i.Path, name: i.Name, size: i.Size })),
    };
  } catch (_) {
    return { images: [], scanned: 0, error: res.stderr || 'Analyse impossible.' };
  }
}

// Retire les métadonnées GPS (et toutes les propriétés EXIF) d'une liste d'images.
// Stratégie : recharger l'image et la réenregistrer sans les PropertyItems GPS.
async function strip(paths) {
  if (!paths || !paths.length) return { ok: false, stderr: 'Aucune image sélectionnée.' };
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  const script = `
Add-Type -AssemblyName System.Drawing
$paths = @(${list})
$done = 0
foreach ($path in $paths) {
  try {
    $img = [System.Drawing.Image]::FromFile($path)
    # Supprime toutes les propriétés GPS (IDs 0x0000-0x001F relèvent du bloc GPS).
    foreach ($id in $img.PropertyIdList) {
      if ($id -le 0x001F) { try { $img.RemovePropertyItem($id) } catch {} }
    }
    # Réenregistre dans un fichier temporaire puis remplace (évite le verrou).
    $tmp = [System.IO.Path]::GetTempFileName()
    $img.Save($tmp, $img.RawFormat)
    $img.Dispose()
    Move-Item -LiteralPath $tmp -Destination $path -Force
    $done++
  } catch { }
}
"$done"
`;
  const res = await runPowerShell(script, { timeout: 120000 });
  const done = parseInt(res.stdout.trim(), 10) || 0;
  return { ok: done > 0, done, stderr: done === 0 ? (res.stderr || 'Aucune image nettoyée.') : '' };
}

module.exports = { id: 'exif', label: 'Métadonnées photos (GPS)', scan, strip };

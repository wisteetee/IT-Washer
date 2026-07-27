'use strict';
// Module Blocage de publicités (niveau système + guide navigateur).
// - Système : ajoute une liste de blocage reconnue (StevenBlack) au fichier hosts
//   Windows, dans une section délimitée par des marqueurs → proprement réversible.
//   Une sauvegarde du hosts est faite avant toute modification.
// - Navigateur : recommandations d'extensions (uBlock Origin, etc.).
const { runPowerShell } = require('../ps');
const https = require('https');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARK_START = '# === ITWASHER ADBLOCK START ===';
const MARK_END = '# === ITWASHER ADBLOCK END ===';
// Liste reconnue, maintenue, uniquement pubs+trackers (pas de faux positifs agressifs).
const BLOCKLIST_URL = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';

// Extensions recommandées pour le navigateur (complément au blocage système).
const BROWSER_TOOLS = [
  { name: 'uBlock Origin', detail: "Le meilleur bloqueur, gratuit et open-source. Firefox et navigateurs Chromium (sauf Chrome récent qui l'a bridé).", url: 'https://ublockorigin.com/' },
  { name: 'Privacy Badger (EFF)', detail: "Bloque automatiquement les traqueurs qui te suivent d'un site à l'autre.", url: 'https://privacybadger.org/' },
  { name: 'Firefox / LibreWolf', detail: "Un navigateur qui respecte uBlock Origin sans le brider, contrairement à Chrome.", url: 'https://www.mozilla.org/firefox/' },
];

// Télécharge la liste de blocage et en extrait les lignes « 0.0.0.0 domaine ».
function fetchBlocklist() {
  return new Promise((resolve, reject) => {
    const req = https.get(BLOCKLIST_URL, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Délai dépassé')); });
  });
}

// Audit : le blocage ITWasher est-il présent dans le hosts ? Combien de domaines ?
async function audit() {
  const res = await runPowerShell(`
try {
  $c = Get-Content -LiteralPath '${HOSTS_PATH}' -Raw -ErrorAction Stop
  if ($c -match '${MARK_START}') {
    $section = ($c -split '${MARK_START}')[1] -split '${MARK_END}'
    $count = ($section[0] -split "\`n" | Where-Object { $_ -match '^\\s*0\\.0\\.0\\.0\\s' }).Count
    "ACTIVE|$count"
  } else { 'INACTIVE' }
} catch { 'ERROR' }`, { timeout: 15000 });
  const out = res.stdout.trim();
  if (out.startsWith('ACTIVE')) {
    return { active: true, count: parseInt(out.split('|')[1], 10) || 0, tools: BROWSER_TOOLS };
  }
  return { active: false, count: 0, tools: BROWSER_TOOLS };
}

// Construit le script d'application : sauvegarde le hosts, retire une ancienne
// section ITWasher éventuelle, ajoute la nouvelle. Le contenu de la liste est
// téléchargé côté Node puis passé au script via un fichier temporaire.
async function buildApply() {
  const raw = await fetchBlocklist();
  // Extrait uniquement les entrées de blocage, normalise en 0.0.0.0.
  const domains = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/);
    if (m && m[1] && m[1] !== 'localhost' && m[1] !== '0.0.0.0') domains.push(m[1]);
  }
  // Dédoublonne.
  const unique = Array.from(new Set(domains));
  const block = unique.map((d) => `0.0.0.0 ${d}`).join('\r\n');

  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmpFile = path.join(os.tmpdir(), `itwasher_hosts_${Date.now()}.txt`);
  const payload = `${MARK_START}\r\n# Liste anti-pub ITWasher (source: StevenBlack). Réversible.\r\n${block}\r\n${MARK_END}`;
  fs.writeFileSync(tmpFile, payload, 'utf8');

  const tmpEsc = tmpFile.replace(/\\/g, '\\\\');
  const script = `
$hosts = '${HOSTS_PATH}'
# Sauvegarde horodatée (une seule fois par jour).
$backup = "$hosts.itwasher-backup"
if (-not (Test-Path $backup)) { Copy-Item -LiteralPath $hosts -Destination $backup -Force }
# Retire une ancienne section ITWasher si présente.
$content = Get-Content -LiteralPath $hosts -Raw
$content = [regex]::Replace($content, '(?s)${MARK_START}.*?${MARK_END}\\r?\\n?', '')
# Ajoute la nouvelle section.
$new = Get-Content -LiteralPath '${tmpEsc}' -Raw
$content = $content.TrimEnd() + "\`r\`n" + $new + "\`r\`n"
Set-Content -LiteralPath $hosts -Value $content -Encoding ASCII -Force
# Vide le cache DNS pour appliquer immédiatement.
ipconfig /flushdns | Out-Null
Remove-Item -LiteralPath '${tmpEsc}' -Force -ErrorAction SilentlyContinue`;
  return { script, needsElevation: true, domainCount: unique.length };
}

// Construit le script de retrait : supprime la section ITWasher du hosts.
function buildRemove() {
  const script = `
$hosts = '${HOSTS_PATH}'
$content = Get-Content -LiteralPath $hosts -Raw
$content = [regex]::Replace($content, '(?s)${MARK_START}.*?${MARK_END}\\r?\\n?', '')
Set-Content -LiteralPath $hosts -Value $content.TrimEnd() -Encoding ASCII -Force
ipconfig /flushdns | Out-Null`;
  return { script, needsElevation: true };
}

module.exports = { id: 'adblock', label: 'Blocage de publicités', audit, buildApply, buildRemove, BROWSER_TOOLS };

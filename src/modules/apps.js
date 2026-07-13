'use strict';
// Module Audit des applications installées.
// Lit les apps depuis le registre (Uninstall) + les paquets AppX (bloatware Store).
// Signale les apps "à remplacer" et les bloatwares connus.
const { runPowerShell } = require('../ps');

// Base de connaissance : apps intrusives et leur alternative respectueuse.
const REPLACEMENTS = [
  { match: /google chrome/i, name: 'Google Chrome', reason: 'Télémétrie Google, tracking cross-site.', alt: 'Brave', url: 'https://brave.com/' },
  { match: /microsoft edge/i, name: 'Microsoft Edge', reason: 'Télémétrie Microsoft intégrée.', alt: 'Brave / Firefox', url: 'https://brave.com/' },
  { match: /ccleaner/i, name: 'CCleaner', reason: 'Historique de télémétrie et bundles douteux.', alt: 'BleachBit', url: 'https://www.bleachbit.org/' },
  { match: /avast|avg /i, name: 'Avast / AVG', reason: 'A revendu des données de navigation (Jumpshot).', alt: 'Windows Defender (intégré)', url: 'https://support.microsoft.com/windows' },
  { match: /mcafee/i, name: 'McAfee', reason: 'Bloatware préinstallé, publicités agressives.', alt: 'Windows Defender (intégré)', url: 'https://support.microsoft.com/windows' },
  { match: /adobe (acrobat|reader)/i, name: 'Adobe Reader', reason: 'Télémétrie, lourdeur.', alt: 'SumatraPDF / Okular', url: 'https://www.sumatrapdfreader.org/' },
  { match: /zoom/i, name: 'Zoom', reason: 'Historique de failles de confidentialité.', alt: 'Jitsi / Signal', url: 'https://jitsi.org/' },
  { match: /whatsapp/i, name: 'WhatsApp', reason: 'Métadonnées partagées avec Meta.', alt: 'Signal', url: 'https://signal.org/' },
  { match: /dropbox/i, name: 'Dropbox', reason: 'Scan de contenu, télémétrie.', alt: 'Proton Drive / Cryptomator', url: 'https://proton.me/drive' },
];

// AppX de bloatware Microsoft courant (candidats à la suppression).
const BLOATWARE_APPX = [
  { id: 'Microsoft.BingNews', label: 'Actualités Bing' },
  { id: 'Microsoft.BingWeather', label: 'Météo (Bing)' },
  { id: 'Microsoft.GetHelp', label: 'Obtenir de l\'aide' },
  { id: 'Microsoft.Getstarted', label: 'Prise en main' },
  { id: 'Microsoft.MicrosoftSolitaireCollection', label: 'Solitaire' },
  { id: 'Microsoft.People', label: 'Contacts (People)' },
  { id: 'Microsoft.WindowsFeedbackHub', label: 'Hub de commentaires' },
  { id: 'Microsoft.XboxGameOverlay', label: 'Xbox Game Overlay' },
  { id: 'Microsoft.XboxGamingOverlay', label: 'Xbox Gaming Overlay' },
  { id: 'Microsoft.ZuneMusic', label: 'Groove Musique' },
  { id: 'Microsoft.ZuneVideo', label: 'Films et TV' },
];

async function audit() {
  // Récupère les apps installées (registre 32 + 64 bits + par-utilisateur).
  const listCmd = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = foreach ($p in $paths) {
  Get-ItemProperty -Path $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher
}
$apps | Sort-Object DisplayName -Unique | ConvertTo-Json -Compress
`;
  const res = await runPowerShell(listCmd, { timeout: 90000 });
  let installed = [];
  try {
    const parsed = JSON.parse(res.stdout || '[]');
    installed = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) { installed = []; }

  // Croise avec la base de remplacements.
  const flagged = [];
  for (const rep of REPLACEMENTS) {
    const found = installed.find((a) => a.DisplayName && rep.match.test(a.DisplayName));
    if (found) {
      flagged.push({
        name: found.DisplayName,
        version: found.DisplayVersion || '',
        reason: rep.reason,
        alt: rep.alt,
        url: rep.url,
        status: 'warn',
      });
    }
  }

  // Détecte les AppX de bloatware présents.
  const appxCmd = `Get-AppxPackage | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress`;
  const appxRes = await runPowerShell(appxCmd, { timeout: 60000 });
  let appxNames = [];
  try {
    const parsed = JSON.parse(appxRes.stdout || '[]');
    appxNames = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) { appxNames = []; }

  const bloat = BLOATWARE_APPX
    .filter((b) => appxNames.some((n) => n && n.startsWith(b.id)))
    .map((b) => ({ ...b, status: 'warn' }));

  return {
    totalInstalled: installed.length,
    flagged,
    bloatware: bloat,
    installed: installed.slice(0, 500).map((a) => ({
      name: a.DisplayName, version: a.DisplayVersion || '', publisher: a.Publisher || '',
    })),
  };
}

// Supprime un paquet AppX (bloatware) pour l'utilisateur courant.
function buildRemoveAppx(ids) {
  const lines = ids.map((id) =>
    `Get-AppxPackage -Name '${id}*' | Remove-AppxPackage -ErrorAction SilentlyContinue`);
  return { script: lines.join('\n'), needsElevation: false };
}

module.exports = { id: 'apps', label: 'Applications', audit, buildRemoveAppx, REPLACEMENTS, BLOATWARE_APPX };

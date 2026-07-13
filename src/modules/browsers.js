'use strict';
// Module Navigateurs & consentements.
// Détecte les navigateurs installés, propose des réglages anti-tracking,
// et fournit une checklist guidée pour Utiq et les consentements publicitaires
// (qui NE peuvent PAS être automatisés — ils vivent sur des portails web tiers).
const { runPowerShell } = require('../ps');

const KNOWN_BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', probe: 'Google\\Chrome\\Application\\chrome.exe', privacy: 'intrusif' },
  { id: 'edge', name: 'Microsoft Edge', probe: 'Microsoft\\Edge\\Application\\msedge.exe', privacy: 'intrusif' },
  { id: 'brave', name: 'Brave', probe: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', privacy: 'bon' },
  { id: 'firefox', name: 'Mozilla Firefox', probe: 'Mozilla Firefox\\firefox.exe', privacy: 'bon' },
  { id: 'librewolf', name: 'LibreWolf', probe: 'LibreWolf\\librewolf.exe', privacy: 'excellent' },
];

// Checklist manuelle : ce qui doit se faire à la main, guidé pas à pas.
const MANUAL_CONSENT = [
  {
    id: 'utiq',
    title: 'Utiq — consentement opérateur (identifiant réseau)',
    detail: "Utiq est un identifiant publicitaire basé sur ta connexion opérateur (Orange, SFR, Bouygues…). Il ne se désactive que sur leur portail officiel, opérateur par opérateur.",
    steps: [
      'Ouvre https://consenthub.utiq.com/',
      'Identifie-toi via ta connexion mobile (données mobiles, pas le Wi-Fi) ou choisis ton opérateur.',
      'Consulte la liste des sites ayant activé Utiq pour toi.',
      'Clique sur « Tout désactiver » / retire ton consentement pour chaque site.',
      'Répète sur chaque appareil et chaque connexion opérateur (mobile ET box internet).',
    ],
    url: 'https://consenthub.utiq.com/',
  },
  {
    id: 'google-ads',
    title: 'Personnalisation des publicités Google',
    detail: "Désactive le suivi publicitaire lié à ton compte Google.",
    steps: [
      'Ouvre https://myadcenter.google.com/',
      'Désactive « Publicités personnalisées ».',
      'Va aussi dans https://myactivity.google.com/ et coupe l\'activité Web et applications.',
    ],
    url: 'https://myadcenter.google.com/',
  },
  {
    id: 'youronlinechoices',
    title: 'Your Online Choices (régies publicitaires EU)',
    detail: "Portail européen pour refuser le suivi de dizaines de régies publicitaires d'un coup.",
    steps: [
      'Ouvre https://www.youronlinechoices.com/fr/controler-ses-cookies/',
      'Clique sur « Tout refuser ».',
      'À refaire par navigateur (le refus est stocké en cookie).',
    ],
    url: 'https://www.youronlinechoices.com/fr/controler-ses-cookies/',
  },
  {
    id: 'microsoft-ads',
    title: 'Publicités Microsoft & tableau de bord confidentialité',
    detail: "Coupe le ciblage publicitaire lié à ton compte Microsoft.",
    steps: [
      'Ouvre https://account.microsoft.com/privacy/ad-settings',
      'Désactive les publicités personnalisées.',
      'Nettoie l\'historique dans le tableau de bord de confidentialité Microsoft.',
    ],
    url: 'https://account.microsoft.com/privacy/ad-settings',
  },
];

// Réglages navigateur recommandés (à appliquer manuellement — profil verrouillé).
const BROWSER_TIPS = [
  'Moteur de recherche par défaut : DuckDuckUck, Brave Search ou Startpage.',
  'Bloqueur : uBlock Origin (Firefox/Brave) — le meilleur, gratuit et open-source.',
  'Cookies tiers : bloquer par défaut.',
  'Do Not Track / GPC : activer le signal « Global Privacy Control ».',
  'Ne pas synchroniser l\'historique dans le cloud du navigateur.',
  'Vider cookies et sites à la fermeture (sauf sites de confiance).',
];

async function audit() {
  // Cherche les navigateurs dans Program Files (x86/x64) et LocalAppData.
  const cmd = `
$roots = @($env:ProgramFiles, ${'${env:ProgramFiles(x86)}'} , $env:LOCALAPPDATA)
$found = @{}
$probes = @{
${KNOWN_BROWSERS.map((b) => `  '${b.id}' = '${b.probe.replace(/\\/g, '\\\\')}'`).join('\n')}
}
foreach ($id in $probes.Keys) {
  foreach ($r in $roots) {
    if ($r -and (Test-Path (Join-Path $r $probes[$id]))) { $found[$id] = $true; break }
  }
}
$found.Keys | ConvertTo-Json -Compress
`;
  const res = await runPowerShell(cmd);
  let detectedIds = [];
  try {
    const parsed = JSON.parse(res.stdout || '[]');
    detectedIds = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch (_) { detectedIds = []; }

  const detected = KNOWN_BROWSERS
    .filter((b) => detectedIds.includes(b.id))
    .map((b) => ({ ...b, status: b.privacy === 'intrusif' ? 'warn' : 'ok' }));

  return { detected, tips: BROWSER_TIPS, consent: MANUAL_CONSENT };
}

module.exports = { id: 'browsers', label: 'Navigateurs & consentements', audit, MANUAL_CONSENT };

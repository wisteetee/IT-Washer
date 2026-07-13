'use strict';
// Module Télémétrie & vie privée Windows.
// Chaque "check" a : une lecture registre (audit), une valeur attendue (durci),
// et une paire remédiation/annulation exprimée en commandes registre.
const { runPowerShell } = require('../ps');

// Un check registre : on lit HKLM/HKCU, on compare à la valeur "durcie".
// `hardened` = la valeur qui désactive le traçage. `restore` = valeur par défaut Windows.
const CHECKS = [
  {
    id: 'telemetry-level',
    label: 'Niveau de télémétrie (données de diagnostic)',
    detail: "Windows envoie des données d'utilisation à Microsoft. On le met au minimum (Sécurité/Basique).",
    hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowTelemetry',
    hardened: 0, restore: null, type: 'DWord', risk: 'low', elevated: true, profile: 'balanced',
  },
  {
    id: 'advertising-id',
    label: 'Identifiant de publicité',
    detail: "Un ID unique qui suit tes usages entre applications pour la pub ciblée.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: false, profile: 'basic',
  },
  {
    id: 'activity-history',
    label: "Historique d'activités (Timeline)",
    detail: "Windows enregistre les apps et fichiers ouverts et peut les envoyer au cloud.",
    hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'EnableActivityFeed',
    hardened: 0, restore: null, type: 'DWord', risk: 'low', elevated: true, profile: 'balanced',
  },
  {
    id: 'cortana',
    label: 'Cortana',
    detail: "L'assistant Cortana collecte requêtes vocales et contexte. On le désactive.",
    hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'AllowCortana',
    hardened: 0, restore: null, type: 'DWord', risk: 'low', elevated: true, profile: 'paranoid',
  },
  {
    id: 'start-suggestions',
    label: 'Suggestions et pubs du menu Démarrer',
    detail: "Applications suggérées et contenu promotionnel dans le menu Démarrer.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SystemPaneSuggestionsEnabled',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: false, profile: 'basic',
  },
  {
    id: 'tailored-experiences',
    label: 'Expériences personnalisées (diagnostic)',
    detail: "Microsoft utilise tes données de diagnostic pour des conseils et pubs personnalisés.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy', name: 'TailoredExperiencesWithDiagnosticDataEnabled',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: false, profile: 'balanced',
  },
  {
    id: 'app-launch-tracking',
    label: "Suivi des lancements d'applications",
    detail: "Windows suit quelles apps tu lances pour 'améliorer' résultats de recherche et Démarrer.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'Start_TrackProgs',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: false, profile: 'balanced',
  },
  {
    id: 'feedback-frequency',
    label: 'Demandes de commentaires Windows',
    detail: "Fréquence à laquelle Windows te demande ton avis. On coupe.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Siuf\\Rules', name: 'NumberOfSIUFInPeriod',
    hardened: 0, restore: null, type: 'DWord', risk: 'low', elevated: false, profile: 'basic',
  },
  {
    id: 'location-tracking',
    label: 'Service de localisation (global)',
    detail: "Autorisation globale de géolocalisation pour Windows et les apps.",
    hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location', name: 'Value',
    hardened: 'Deny', restore: 'Allow', type: 'String', risk: 'medium', elevated: true, profile: 'paranoid',
  },
  {
    id: 'wifi-sense',
    label: 'Wi-Fi Sense (partage de réseaux)',
    detail: "Partage automatique de mots de passe Wi-Fi avec les contacts.",
    hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\WiFi\\AllowWiFiHotSpotReporting', name: 'value',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: true, profile: 'paranoid',
  },
];

// Ordre des profils : chaque profil inclut les précédents.
const PROFILE_RANK = { basic: 1, balanced: 2, paranoid: 3 };

// Renvoie les ids de checks couverts par un profil donné.
function idsForProfile(profileName) {
  const rank = PROFILE_RANK[profileName] || 0;
  return CHECKS.filter((c) => (PROFILE_RANK[c.profile] || 99) <= rank).map((c) => c.id);
}

// Renvoie les cibles registre { hive, key, name, type } pour capture rollback.
function targetsFor(ids) {
  return CHECKS.filter((c) => ids.includes(c.id))
    .map((c) => ({ hive: c.hive, key: c.key, name: c.name, type: c.type }));
}

// Construit la commande PS de lecture d'une valeur registre.
function readCmd(c) {
  const full = `${c.hive}:\\${c.key}`;
  return `$v = (Get-ItemProperty -LiteralPath '${full}' -Name '${c.name}' -ErrorAction SilentlyContinue).'${c.name}'; if ($null -eq $v) { 'MISSING' } else { $v }`;
}

async function audit() {
  const results = [];
  for (const c of CHECKS) {
    const res = await runPowerShell(readCmd(c));
    const raw = res.stdout.trim();
    let current = raw === 'MISSING' ? null : raw;
    // Normalise les entiers.
    if (current !== null && /^-?\d+$/.test(current)) current = parseInt(current, 10);

    const isHardened = current === c.hardened
      || (current === null && c.hardened === null); // absent = déjà "non défini"
    // Cas particulier : beaucoup de clés absentes = comportement Windows par défaut (traçage actif).
    const status = isHardened ? 'ok' : 'warn';
    results.push({
      id: c.id,
      label: c.label,
      detail: c.detail,
      risk: c.risk,
      elevated: c.elevated,
      current: current === null ? 'Non défini (défaut Windows)' : String(current),
      recommended: String(c.hardened),
      profile: c.profile,
      status,
    });
  }
  return results;
}

// Génère le script de remédiation (durcissement) pour une liste d'ids.
function buildRemediation(ids) {
  const selected = CHECKS.filter((c) => ids.includes(c.id));
  const lines = selected.map((c) => {
    const full = `${c.hive}:\\${c.key}`;
    const val = c.type === 'String' ? `'${c.hardened}'` : c.hardened;
    return `if (-not (Test-Path -LiteralPath '${full}')) { New-Item -Path '${full}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${full}' -Name '${c.name}' -Value ${val} -Type ${c.type} -Force`;
  });
  const needsElevation = selected.some((c) => c.elevated);
  return { script: lines.join('\n'), needsElevation };
}

// Génère le script d'annulation (restauration).
function buildRestore(ids) {
  const selected = CHECKS.filter((c) => ids.includes(c.id));
  const lines = selected.map((c) => {
    const full = `${c.hive}:\\${c.key}`;
    if (c.restore === null) {
      return `Remove-ItemProperty -LiteralPath '${full}' -Name '${c.name}' -ErrorAction SilentlyContinue`;
    }
    const val = c.type === 'String' ? `'${c.restore}'` : c.restore;
    return `if (-not (Test-Path -LiteralPath '${full}')) { New-Item -Path '${full}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${full}' -Name '${c.name}' -Value ${val} -Type ${c.type} -Force`;
  });
  const needsElevation = selected.some((c) => c.elevated);
  return { script: lines.join('\n'), needsElevation };
}

module.exports = {
  id: 'telemetry', label: 'Télémétrie Windows',
  audit, buildRemediation, buildRestore,
  idsForProfile, targetsFor, CHECKS,
};

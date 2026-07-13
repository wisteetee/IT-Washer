'use strict';
// Module Nouveautés Windows 11 à surveiller.
// Recall (capture d'écran IA), Copilot, Widgets, Presse-papiers cloud.
// Même patron que telemetry : lecture registre + remédiation/restore + profil.
const { runPowerShell } = require('../ps');

const CHECKS = [
  {
    id: 'recall',
    label: 'Windows Recall (capture d\'écran IA périodique)',
    detail: "Recall prend des captures d'écran régulières et les analyse par IA. Vecteur majeur de fuite de données. On le désactive.",
    hive: 'HKCU', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', name: 'DisableAIDataAnalysis',
    hardened: 1, restore: 0, type: 'DWord', risk: 'high', elevated: false, profile: 'basic',
  },
  {
    id: 'copilot',
    label: 'Windows Copilot',
    detail: "Assistant IA intégré au système, susceptible d'envoyer du contexte au cloud.",
    hive: 'HKCU', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot', name: 'TurnOffWindowsCopilot',
    hardened: 1, restore: 0, type: 'DWord', risk: 'medium', elevated: false, profile: 'basic',
  },
  {
    id: 'widgets',
    label: 'Widgets (actualités et intérêts)',
    detail: "Le panneau Widgets récupère actualités et contenus personnalisés en continu.",
    hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Dsh', name: 'AllowNewsAndInterests',
    hardened: 0, restore: 1, type: 'DWord', risk: 'low', elevated: true, profile: 'balanced',
  },
  {
    id: 'clipboard-cloud',
    label: 'Presse-papiers cloud (synchronisation)',
    detail: "L'historique du presse-papiers peut être synchronisé sur le cloud Microsoft.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Clipboard', name: 'CloudClipboardAutomaticUpload',
    hardened: 0, restore: 1, type: 'DWord', risk: 'medium', elevated: false, profile: 'balanced',
  },
  {
    id: 'clipboard-history',
    label: 'Historique du presse-papiers (persistant)',
    detail: "Windows conserve les éléments copiés (Win+V). Peut retenir des mots de passe copiés.",
    hive: 'HKCU', key: 'SOFTWARE\\Microsoft\\Clipboard', name: 'EnableClipboardHistory',
    hardened: 0, restore: 1, type: 'DWord', risk: 'medium', elevated: false, profile: 'paranoid',
  },
];

const PROFILE_RANK = { basic: 1, balanced: 2, paranoid: 3 };
function idsForProfile(name) {
  const rank = PROFILE_RANK[name] || 0;
  return CHECKS.filter((c) => (PROFILE_RANK[c.profile] || 99) <= rank).map((c) => c.id);
}
function targetsFor(ids) {
  return CHECKS.filter((c) => ids.includes(c.id))
    .map((c) => ({ hive: c.hive, key: c.key, name: c.name, type: c.type }));
}

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
    if (current !== null && /^-?\d+$/.test(current)) current = parseInt(current, 10);
    const isHardened = current === c.hardened || (current === null && c.hardened === null);
    results.push({
      id: c.id, label: c.label, detail: c.detail, risk: c.risk, elevated: c.elevated,
      current: current === null ? 'Non défini (défaut Windows)' : String(current),
      recommended: String(c.hardened), profile: c.profile,
      status: isHardened ? 'ok' : 'warn',
    });
  }
  return results;
}

function buildRemediation(ids) {
  const selected = CHECKS.filter((c) => ids.includes(c.id));
  const lines = selected.map((c) => {
    const full = `${c.hive}:\\${c.key}`;
    const val = c.type === 'String' ? `'${c.hardened}'` : c.hardened;
    return `if (-not (Test-Path -LiteralPath '${full}')) { New-Item -Path '${full}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${full}' -Name '${c.name}' -Value ${val} -Type ${c.type} -Force`;
  });
  return { script: lines.join('\n'), needsElevation: selected.some((c) => c.elevated) };
}

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
  return { script: lines.join('\n'), needsElevation: selected.some((c) => c.elevated) };
}

module.exports = {
  id: 'windows11', label: 'Nouveautés Windows 11',
  audit, buildRemediation, buildRestore,
  idsForProfile, targetsFor, CHECKS,
};

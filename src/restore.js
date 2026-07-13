'use strict';
// Création d'un point de restauration système avant toute modification registre.
const { runPowerShellElevated, runPowerShell } = require('./ps');

async function createRestorePoint(description = 'Hygiène Info - avant durcissement') {
  // La restauration système peut être désactivée ; on tente de l'activer sur C: puis on crée le point.
  const script = `
Enable-ComputerRestore -Drive 'C:\\' -ErrorAction SilentlyContinue
# Contourne la limite de fréquence (1 point / 24h) le temps de l'opération.
New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name 'SystemRestorePointCreationFrequency' -Value 0 -PropertyType DWord -Force | Out-Null
Checkpoint-Computer -Description '${description.replace(/'/g, "''")}' -RestorePointType 'MODIFY_SETTINGS'
`;
  return runPowerShellElevated(script, { timeout: 120000 });
}

// Vérifie si la protection système est disponible/activée sur C:.
async function restoreStatus() {
  const res = await runPowerShell(
    `try { $c = (Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Measure-Object).Count; "$c" } catch { 'unavailable' }`);
  return res.stdout.trim();
}

module.exports = { createRestorePoint, restoreStatus };

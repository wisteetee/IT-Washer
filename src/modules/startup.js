'use strict';
// Module Démarrage & services (façon Autoruns).
// Audite : programmes au démarrage, tâches planifiées non-Microsoft,
// services non-Microsoft actifs, + surface d'attaque (RDP, SMBv1, partages).
// Désactivations ciblées, la plupart avec élévation.
const { runPowerShell } = require('../ps');

async function audit() {
  // --- Programmes au démarrage ---
  const startRes = await runPowerShell(
    `Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | ConvertTo-Json -Compress`,
    { timeout: 40000 });
  let startup = [];
  try {
    const p = JSON.parse(startRes.stdout || '[]');
    startup = (Array.isArray(p) ? p : [p]).map((e) => ({
      name: e.Name || '', command: e.Command || '', location: e.Location || '', user: e.User || '',
    }));
  } catch (_) { startup = []; }

  // --- Tâches planifiées non-Microsoft, actives ---
  const taskRes = await runPowerShell(`
Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' -and $_.TaskPath -notlike '\\Microsoft\\*' } |
  Select-Object TaskName, TaskPath, @{N='Author';E={$_.Author}} | ConvertTo-Json -Compress`,
    { timeout: 40000 });
  let tasks = [];
  try {
    const p = JSON.parse(taskRes.stdout || '[]');
    tasks = (Array.isArray(p) ? p : [p]).map((t) => ({
      name: t.TaskName || '', path: t.TaskPath || '', author: t.Author || '',
    })).filter((t) => t.name);
  } catch (_) { tasks = []; }

  // --- Services non-Microsoft en cours d'exécution ---
  const svcRes = await runPowerShell(`
Get-CimInstance Win32_Service |
  Where-Object { $_.State -eq 'Running' -and $_.PathName -and ($_.PathName -notlike '*\\Windows\\*') } |
  Select-Object Name, DisplayName, StartMode | ConvertTo-Json -Compress`,
    { timeout: 40000 });
  let services = [];
  try {
    const p = JSON.parse(svcRes.stdout || '[]');
    services = (Array.isArray(p) ? p : [p]).map((s) => ({
      name: s.Name || '', display: s.DisplayName || '', startMode: s.StartMode || '',
    })).filter((s) => s.name);
  } catch (_) { services = []; }

  // --- Surface d'attaque : RDP, SMBv1, partages ---
  const surface = [];

  const rdp = await runPowerShell(
    `(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -EA SilentlyContinue).fDenyTSConnections`);
  const rdpVal = rdp.stdout.trim();
  surface.push({
    id: 'rdp', label: 'Bureau à distance (RDP)',
    detail: "Le RDP permet de se connecter à distance. À désactiver s'il n'est pas utilisé.",
    status: (rdpVal === '1' || rdpVal === '') ? 'ok' : 'warn',
    current: (rdpVal === '1' || rdpVal === '') ? 'Désactivé' : 'Activé', risk: 'high', fixable: rdpVal === '0',
  });

  const smb = await runPowerShell(
    `try { (Get-SmbServerConfiguration -EA Stop).EnableSMB1Protocol } catch { 'unknown' }`);
  const smbVal = smb.stdout.trim();
  surface.push({
    id: 'smb1', label: 'SMBv1 (protocole obsolète)',
    detail: "SMBv1 est le vecteur de WannaCry. Doit être désactivé.",
    status: (smbVal === 'False') ? 'ok' : (smbVal === 'True' ? 'warn' : 'ok'),
    current: smbVal === 'True' ? 'Activé (dangereux)' : (smbVal === 'False' ? 'Désactivé' : 'Inconnu'),
    risk: 'high', fixable: smbVal === 'True',
  });

  const shareRes = await runPowerShell(`
Get-SmbShare -EA SilentlyContinue |
  Where-Object { $_.Name -notmatch '^\\w+\\$$' } |
  Select-Object Name, Path | ConvertTo-Json -Compress`);
  let shares = [];
  try {
    const p = JSON.parse(shareRes.stdout || '[]');
    shares = (Array.isArray(p) ? p : [p]).filter((s) => s && s.Name).map((s) => ({ name: s.Name, path: s.Path || '' }));
  } catch (_) { shares = []; }
  surface.push({
    id: 'shares', label: 'Partages réseau exposés',
    detail: "Dossiers partagés visibles sur le réseau local (hors partages administratifs).",
    status: shares.length === 0 ? 'ok' : 'warn',
    current: shares.length === 0 ? 'Aucun partage personnalisé' : `${shares.length} partage(s) : ${shares.map((s) => s.name).join(', ')}`,
    risk: 'medium', fixable: false,
  });

  return { startup, tasks, services, surface };
}

// Désactive une entrée de démarrage (Run key). On la déplace vers une clé de
// sauvegarde pour pouvoir la réactiver ; simplifié ici : suppression de la valeur Run.
function buildDisableStartup(names) {
  // Les entrées Win32_StartupCommand peuvent venir de plusieurs Run keys ou du
  // dossier Démarrage. On tente la suppression dans les Run keys HKCU/HKLM.
  const lines = names.map((n) => {
    const safe = n.replace(/'/g, "''");
    return `foreach ($root in @('HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run')) {
  if (Get-ItemProperty -LiteralPath $root -Name '${safe}' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -LiteralPath $root -Name '${safe}' -ErrorAction SilentlyContinue
  }
}`;
  });
  // HKLM nécessite l'élévation.
  return { script: lines.join('\n'), needsElevation: true };
}

// Désactive des tâches planifiées.
function buildDisableTasks(tasks) {
  // tasks = [{ name, path }]
  const lines = tasks.map((t) => {
    const nm = t.name.replace(/'/g, "''");
    const pa = (t.path || '\\').replace(/'/g, "''");
    return `Disable-ScheduledTask -TaskName '${nm}' -TaskPath '${pa}' -ErrorAction SilentlyContinue | Out-Null`;
  });
  return { script: lines.join('\n'), needsElevation: true };
}

// Désactive/arrête des services.
function buildDisableServices(names) {
  const lines = names.map((n) => {
    const nm = n.replace(/'/g, "''");
    return `Stop-Service -Name '${nm}' -Force -ErrorAction SilentlyContinue
Set-Service -Name '${nm}' -StartupType Disabled -ErrorAction SilentlyContinue`;
  });
  return { script: lines.join('\n'), needsElevation: true };
}

// Corrige la surface d'attaque (RDP, SMBv1).
function buildFixSurface(ids) {
  const parts = [];
  if (ids.includes('rdp')) {
    parts.push(`Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1 -Type DWord -Force`);
  }
  if (ids.includes('smb1')) {
    parts.push(`Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -ErrorAction SilentlyContinue
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue | Out-Null`);
  }
  return { script: parts.join('\n'), needsElevation: true };
}

module.exports = {
  id: 'startup', label: 'Démarrage & services', audit,
  buildDisableStartup, buildDisableTasks, buildDisableServices, buildFixSurface,
};

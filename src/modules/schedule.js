'use strict';
// Module Automatisation planifiée.
// Crée/supprime une tâche planifiée Windows qui relance ITWasher périodiquement
// pour un scan de surveillance. La tâche lance l'exe avec un argument --scan.
const { runPowerShell } = require('../ps');

const TASK_NAME = 'ITWasher-ScanPeriodique';

// Vérifie si la tâche planifiée existe et renvoie sa fréquence.
async function status() {
  const res = await runPowerShell(`
try {
  $t = Get-ScheduledTask -TaskName '${TASK_NAME}' -EA Stop
  $trigger = $t.Triggers[0]
  $freq = if ($trigger.ScheduleByWeek) { 'weekly' } elseif ($trigger.ScheduleByMonth) { 'monthly' } elseif ($trigger.DaysInterval) { 'daily' } else { 'unknown' }
  "EXISTS|$freq|$($t.State)"
} catch { 'NONE' }`, { timeout: 15000 });
  const out = res.stdout.trim();
  if (out.startsWith('EXISTS')) {
    const [, freq, state] = out.split('|');
    return { exists: true, frequency: freq, state };
  }
  return { exists: false };
}

// Crée la tâche planifiée. frequency = 'daily' | 'weekly' | 'monthly'.
// exePath = chemin de l'exe à lancer (fourni par main via process.execPath).
function buildCreate(frequency, exePath) {
  const freqMap = {
    daily: `New-ScheduledTaskTrigger -Daily -At 12pm`,
    weekly: `New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 12pm`,
    monthly: `$t = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Monday -At 12pm; $t`,
  };
  const trigger = freqMap[frequency] || freqMap.weekly;
  const safeExe = exePath.replace(/'/g, "''");
  // La tâche lance l'exe avec --scan (mode surveillance). S'exécute sous
  // l'utilisateur courant, seulement s'il est connecté (pas de mdp requis).
  const script = `
$action = New-ScheduledTaskAction -Execute '${safeExe}' -Argument '--scan'
$trigger = ${trigger}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`;
  return { script, needsElevation: false };
}

// Supprime la tâche planifiée.
function buildRemove() {
  const script = `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue`;
  return { script, needsElevation: false };
}

module.exports = { id: 'schedule', label: 'Automatisation', status, buildCreate, buildRemove, TASK_NAME };

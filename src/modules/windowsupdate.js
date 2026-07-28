'use strict';
// Module Contrôle des mises à jour Windows.
// Permet de mettre les MAJ en pause (toutes éditions) et de différer les mises à
// niveau de fonctionnalités (Pro/Entreprise uniquement — signalé honnêtement).
// Objectif : garder le contrôle du CALENDRIER, pas désactiver la sécurité.
const { runPowerShell } = require('../ps');

const UX_KEY = 'HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings';
const POLICY_KEY = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate';

async function audit() {
  // Édition Windows : les stratégies de report ne s'appliquent qu'aux éditions Pro+.
  const ed = await runPowerShell(
    `(Get-CimInstance Win32_OperatingSystem).Caption`, { timeout: 20000 });
  const edition = ed.stdout.trim();
  const isHome = /famille|home/i.test(edition);

  // Pause en cours ?
  const pause = await runPowerShell(
    `$p = (Get-ItemProperty '${UX_KEY}' -Name PauseUpdatesExpiryTime -EA SilentlyContinue).PauseUpdatesExpiryTime; if ($p) { $p } else { 'NONE' }`,
    { timeout: 15000 });
  const pauseRaw = pause.stdout.trim();
  const pausedUntil = pauseRaw && pauseRaw !== 'NONE' ? pauseRaw : null;

  // Report des mises à niveau de fonctionnalités (Pro uniquement).
  const defer = await runPowerShell(
    `$d = (Get-ItemProperty '${POLICY_KEY}' -Name DeferFeatureUpdatesPeriodInDays -EA SilentlyContinue).DeferFeatureUpdatesPeriodInDays; if ($null -ne $d) { $d } else { 'NONE' }`,
    { timeout: 15000 });
  const deferRaw = defer.stdout.trim();
  const deferDays = deferRaw && deferRaw !== 'NONE' ? parseInt(deferRaw, 10) : null;

  // Dernière mise à jour installée.
  const last = await runPowerShell(
    `try { $d = (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn; if ($d) { $d.ToString('yyyy-MM-dd') } else { '' } } catch { '' }`,
    { timeout: 30000 });

  const checks = [];
  checks.push({
    id: 'pause',
    label: 'Pause des mises à jour',
    detail: "Suspendre temporairement les MAJ pour choisir ton moment (jusqu'à 5 semaines). La sécurité reprend ensuite automatiquement.",
    status: pausedUntil ? 'info' : 'ok',
    current: pausedUntil ? `En pause jusqu'au ${pausedUntil}` : 'Mises à jour actives',
    risk: 'low',
  });
  checks.push({
    id: 'defer',
    label: 'Report des mises à niveau majeures',
    detail: isHome
      ? "Réservé aux éditions Pro/Entreprise. Ton édition est Famille : utilise la pause à la place."
      : "Retarde les nouvelles versions de Windows (pas les correctifs de sécurité) pour éviter les régressions du jour 1.",
    status: deferDays ? 'info' : 'ok',
    current: isHome ? 'Indisponible (édition Famille)' : (deferDays ? `${deferDays} jour(s)` : 'Aucun report'),
    risk: 'low',
    unavailable: isHome,
  });
  checks.push({
    id: 'last-update',
    label: 'Dernière mise à jour installée',
    detail: "Un système à jour reste la meilleure protection contre les failles connues.",
    status: 'info',
    current: last.stdout.trim() || 'Inconnue',
    risk: 'low',
    readOnly: true,
  });

  return { edition, isHome, pausedUntil, deferDays, checks };
}

// Met les MAJ en pause pour N jours (max 35 = 5 semaines côté Windows).
function buildPause(days) {
  const d = Math.max(1, Math.min(parseInt(days, 10) || 7, 35));
  const script = `
$start = (Get-Date).ToUniversalTime()
$end = $start.AddDays(${d})
$fmt = 'yyyy-MM-ddTHH:mm:ssZ'
if (-not (Test-Path '${UX_KEY}')) { New-Item -Path '${UX_KEY}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseUpdatesStartTime' -Value $start.ToString($fmt) -Type String -Force
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseUpdatesExpiryTime' -Value $end.ToString($fmt) -Type String -Force
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseFeatureUpdatesStartTime' -Value $start.ToString($fmt) -Type String -Force
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseFeatureUpdatesEndTime' -Value $end.ToString($fmt) -Type String -Force
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseQualityUpdatesStartTime' -Value $start.ToString($fmt) -Type String -Force
Set-ItemProperty -LiteralPath '${UX_KEY}' -Name 'PauseQualityUpdatesEndTime' -Value $end.ToString($fmt) -Type String -Force`;
  return { script, needsElevation: true, days: d };
}

// Reprend les MAJ (retire la pause).
function buildResume() {
  const names = ['PauseUpdatesStartTime', 'PauseUpdatesExpiryTime',
    'PauseFeatureUpdatesStartTime', 'PauseFeatureUpdatesEndTime',
    'PauseQualityUpdatesStartTime', 'PauseQualityUpdatesEndTime'];
  const script = names
    .map((n) => `Remove-ItemProperty -LiteralPath '${UX_KEY}' -Name '${n}' -ErrorAction SilentlyContinue`)
    .join('\n');
  return { script, needsElevation: true };
}

// Diffère les mises à niveau de fonctionnalités (Pro/Entreprise uniquement).
function buildDefer(days) {
  const d = Math.max(0, Math.min(parseInt(days, 10) || 0, 365));
  const script = `
if (-not (Test-Path '${POLICY_KEY}')) { New-Item -Path '${POLICY_KEY}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${POLICY_KEY}' -Name 'DeferFeatureUpdates' -Value 1 -Type DWord -Force
Set-ItemProperty -LiteralPath '${POLICY_KEY}' -Name 'DeferFeatureUpdatesPeriodInDays' -Value ${d} -Type DWord -Force`;
  return { script, needsElevation: true, days: d };
}

module.exports = { id: 'windowsupdate', label: 'Mises à jour', audit, buildPause, buildResume, buildDefer };

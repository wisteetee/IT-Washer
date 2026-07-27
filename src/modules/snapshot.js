'use strict';
// Module Diff post-Windows Update.
// Capture un "instantané" de l'état des réglages de confidentialité + le build
// Windows. Après une mise à jour majeure, Microsoft réactive souvent des réglages
// (télémétrie, etc.). Comparer deux instantanés révèle ce qui a été réactivé.
const { runPowerShell } = require('../ps');
const telemetry = require('./telemetry');
const windows11 = require('./windows11');
const store = require('../store');

const SNAPSHOT_FILE = 'settings-snapshot.json';

// Récupère le build Windows actuel (DisplayVersion + build.UBR).
async function getWindowsBuild() {
  const res = await runPowerShell(
    `$p = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; "$($p.DisplayVersion)|$($p.CurrentBuild).$($p.UBR)"`,
    { timeout: 15000 });
  const [displayVersion, build] = (res.stdout.trim() || '|').split('|');
  return { displayVersion: displayVersion || '?', build: build || '?' };
}

// Capture l'état durci/non-durci de chaque check registre (télémétrie + win11).
async function captureState() {
  const [telResults, w11Results] = await Promise.all([telemetry.audit(), windows11.audit()]);
  const state = {};
  for (const c of telResults) state['telemetry:' + c.id] = { label: c.label, status: c.status, current: c.current };
  for (const c of w11Results) state['windows11:' + c.id] = { label: c.label, status: c.status, current: c.current };
  return state;
}

// Crée et enregistre un instantané horodaté.
async function takeSnapshot() {
  const build = await getWindowsBuild();
  const state = await captureState();
  const snap = { ts: Date.now(), build, state };
  store.writeJson(SNAPSHOT_FILE, snap);
  return snap;
}

// Renvoie l'instantané enregistré (ou null).
function getSnapshot() {
  return store.readJson(SNAPSHOT_FILE, null);
}

// Compare l'instantané enregistré à l'état actuel. Renvoie les régressions
// (réglages passés de 'ok' à 'warn') et les changements de build.
async function compare() {
  const prev = getSnapshot();
  if (!prev) return { hasPrevious: false };

  const build = await getWindowsBuild();
  const current = await captureState();

  const buildChanged = prev.build.build !== build.build || prev.build.displayVersion !== build.displayVersion;

  const regressions = []; // durci -> non durci (le pire : Microsoft a réactivé)
  const improvements = []; // non durci -> durci
  for (const key of Object.keys(prev.state)) {
    const before = prev.state[key];
    const after = current[key];
    if (!after) continue;
    if (before.status === 'ok' && after.status !== 'ok') {
      regressions.push({ key, label: before.label, before: before.current, after: after.current });
    } else if (before.status !== 'ok' && after.status === 'ok') {
      improvements.push({ key, label: before.label });
    }
  }

  return {
    hasPrevious: true,
    prevTs: prev.ts,
    buildChanged,
    prevBuild: prev.build,
    currentBuild: build,
    regressions,
    improvements,
  };
}

module.exports = { id: 'snapshot', label: 'Diff post-Update', takeSnapshot, getSnapshot, compare, getWindowsBuild };

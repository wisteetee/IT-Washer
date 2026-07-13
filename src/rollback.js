'use strict';
// Journal de rollback horodaté.
// Avant chaque action réversible, on capture la valeur ACTUELLE de chaque clé
// registre concernée. On enregistre une entrée { id, ts, label, entries: [...] }.
// Chaque entrée permet de régénérer un script d'annulation CIBLÉ, sans toucher
// au reste du système (contrairement au point de restauration global).
const { runPowerShell, runPowerShellElevated } = require('./ps');
const store = require('./store');

const JOURNAL_FILE = 'rollback-journal.json';

function readJournal() { return store.readJson(JOURNAL_FILE, []); }
function writeJournal(j) { return store.writeJson(JOURNAL_FILE, j); }

// Lit la valeur actuelle d'une clé registre (avant modification).
// Renvoie { present: bool, value, type } — pour pouvoir restaurer à l'identique.
async function captureValue(hive, key, name, type) {
  const full = `${hive}:\\${key}`;
  const cmd = `$p = Get-ItemProperty -LiteralPath '${full}' -Name '${name}' -ErrorAction SilentlyContinue; if ($null -eq $p) { 'ABSENT' } else { $v = $p.'${name}'; if ($null -eq $v) { 'ABSENT' } else { $v } }`;
  const res = await runPowerShell(cmd);
  const raw = res.stdout.trim();
  if (raw === 'ABSENT' || raw === '') {
    return { hive, key, name, type, present: false, value: null };
  }
  let value = raw;
  if (type !== 'String' && /^-?\d+$/.test(raw)) value = parseInt(raw, 10);
  return { hive, key, name, type, present: true, value };
}

/**
 * Enregistre un point de rollback AVANT d'appliquer une action.
 * `targets` = liste de { hive, key, name, type } à capturer.
 * Renvoie l'id du point créé.
 */
async function snapshot({ actionId, label, targets }) {
  const entries = [];
  for (const t of targets) {
    entries.push(await captureValue(t.hive, t.key, t.name, t.type));
  }
  const point = {
    id: `${actionId}-${Date.now()}`,
    actionId,
    label,
    ts: Date.now(),
    entries,
    undone: false,
  };
  const journal = readJournal();
  journal.push(point);
  writeJournal(journal.slice(-200)); // borne le journal
  return point.id;
}

// Construit le script d'annulation d'un point précis (remet chaque clé à sa
// valeur capturée, ou la supprime si elle était absente).
function buildUndoScript(point) {
  const lines = point.entries.map((e) => {
    const full = `${e.hive}:\\${e.key}`;
    if (!e.present) {
      return `Remove-ItemProperty -LiteralPath '${full}' -Name '${e.name}' -ErrorAction SilentlyContinue`;
    }
    const val = e.type === 'String' ? `'${String(e.value).replace(/'/g, "''")}'` : e.value;
    return `if (-not (Test-Path -LiteralPath '${full}')) { New-Item -Path '${full}' -Force | Out-Null }
Set-ItemProperty -LiteralPath '${full}' -Name '${e.name}' -Value ${val} -Type ${e.type} -Force`;
  });
  // Élévation requise si au moins une clé est sous HKLM.
  const needsElevation = point.entries.some((e) => e.hive === 'HKLM');
  return { script: lines.join('\n'), needsElevation };
}

// Annule un point précis par son id.
async function undo(pointId) {
  const journal = readJournal();
  const point = journal.find((p) => p.id === pointId);
  if (!point) return { ok: false, stderr: 'Point de rollback introuvable.' };
  const { script, needsElevation } = buildUndoScript(point);
  if (!script.trim()) return { ok: false, stderr: 'Rien à annuler.' };
  const res = needsElevation ? await runPowerShellElevated(script) : await runPowerShell(script);
  if (res.ok) {
    point.undone = true;
    point.undoneTs = Date.now();
    writeJournal(journal);
  }
  return res;
}

function list() {
  // Renvoie le journal, plus récent en premier, avec un aperçu léger.
  return readJournal()
    .slice()
    .reverse()
    .map((p) => ({
      id: p.id, actionId: p.actionId, label: p.label, ts: p.ts,
      undone: p.undone, count: p.entries.length,
    }));
}

// Prévisualise le script d'annulation (transparence).
function previewUndo(pointId) {
  const point = readJournal().find((p) => p.id === pointId);
  if (!point) return { script: '(point introuvable)', needsElevation: false };
  return buildUndoScript(point);
}

module.exports = { snapshot, undo, list, previewUndo, readJournal };

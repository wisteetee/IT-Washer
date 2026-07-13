'use strict';
// Stockage local persistant (JSON dans le dossier userData d'Electron).
// Sert à : historique des scores, journal de rollback, préférences.
// Pas de dépendance externe : lecture/écriture de fichiers JSON simples.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function dataDir() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(name) {
  return path.join(dataDir(), name);
}

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// ---- Historique des scores ----
const HISTORY_FILE = 'score-history.json';

function addScoreEntry(entry) {
  const hist = readJson(HISTORY_FILE, []);
  hist.push({ ts: Date.now(), ...entry });
  // On garde au plus 500 points pour ne pas gonfler indéfiniment.
  const trimmed = hist.slice(-500);
  writeJson(HISTORY_FILE, trimmed);
  return trimmed;
}

function getScoreHistory() {
  return readJson(HISTORY_FILE, []);
}

// ---- Préférences ----
const PREFS_FILE = 'prefs.json';
function getPrefs() {
  return readJson(PREFS_FILE, { profile: null, lastSnapshot: null });
}
function setPrefs(patch) {
  const p = { ...getPrefs(), ...patch };
  writeJson(PREFS_FILE, p);
  return p;
}

module.exports = {
  dataDir, readJson, writeJson,
  addScoreEntry, getScoreHistory,
  getPrefs, setPrefs,
};

'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const telemetry = require('./modules/telemetry');
const apps = require('./modules/apps');
const browsers = require('./modules/browsers');
const breaches = require('./modules/breaches');
const network = require('./modules/network');
const windows11 = require('./modules/windows11');
const accounts = require('./modules/accounts');
const startup = require('./modules/startup');
const exif = require('./modules/exif');
const homenetwork = require('./modules/homenetwork');
const snapshot = require('./modules/snapshot');
const schedule = require('./modules/schedule');
const profiles = require('./modules/profiles');
const restore = require('./restore');
const rollback = require('./rollback');
const store = require('./store');
const report = require('./report');
const { runPowerShell, runPowerShellElevated } = require('./ps');

// Mode surveillance : lancé par la tâche planifiée avec --scan (pas d'UI).
const isScanMode = process.argv.includes('--scan');

let win;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0e1116',
    title: 'ITWasher',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  if (isScanMode) {
    // Mode surveillance en tâche de fond : audit silencieux, notification si
    // régression détectée, puis fermeture. Pas de fenêtre.
    runBackgroundScan().finally(() => app.quit());
    return;
  }
  createWindow();
  setupTray();
});
app.on('window-all-closed', () => {
  // Si le tray est actif, on garde l'app en vie en arrière-plan.
  if (tray) return;
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Icône dans la barre système : accès rapide + garde l'app en veille.
function setupTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('ITWasher — hygiène informatique');
    const menu = Menu.buildFromTemplate([
      { label: 'Ouvrir ITWasher', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
      { label: 'Lancer une analyse', click: () => { if (win) { win.show(); win.webContents.send('tray:scan'); } } },
      { type: 'separator' },
      { label: 'Quitter', click: () => { tray.destroy(); tray = null; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', () => { if (win) { win.show(); win.focus(); } else createWindow(); });
  } catch (_) { tray = null; }
}

// Scan silencieux (mode --scan) : compare à l'instantané et notifie si régression.
async function runBackgroundScan() {
  try {
    const diff = await snapshot.compare();
    let title, body;
    if (diff.hasPrevious && diff.regressions.length > 0) {
      title = '⚠ ITWasher — réglages réactivés';
      const changed = diff.buildChanged ? ' (après une mise à jour Windows)' : '';
      body = `${diff.regressions.length} réglage(s) de confidentialité ont été réactivés${changed}. Ouvre ITWasher pour corriger.`;
    } else if (diff.buildChanged) {
      title = 'ITWasher — mise à jour Windows détectée';
      body = 'Aucune régression de confidentialité détectée. 👍';
    } else {
      // Rien à signaler : on reste discret (pas de notif).
      return;
    }
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (_) { /* silencieux */ }
}

// ---- Audit (lecture seule) ----
ipcMain.handle('audit:telemetry', () => telemetry.audit());
ipcMain.handle('audit:apps', () => apps.audit());
ipcMain.handle('audit:browsers', () => browsers.audit());
ipcMain.handle('audit:network', () => network.audit());
ipcMain.handle('audit:windows11', () => windows11.audit());
ipcMain.handle('audit:accounts', () => accounts.audit());
ipcMain.handle('audit:startup', () => startup.audit());
ipcMain.handle('audit:homenetwork', () => homenetwork.audit());
ipcMain.handle('restore:status', () => restore.restoreStatus());

// ---- Réseau domestique : test de fuite d'IP + désactivation UPnP ----
ipcMain.handle('homenetwork:ipLeak', () => homenetwork.ipLeakTest());
ipcMain.handle('homenetwork:previewUpnp', () => homenetwork.buildDisableUpnp());
ipcMain.handle('homenetwork:disableUpnp', () => {
  const { script, needsElevation } = homenetwork.buildDisableUpnp();
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});

// ---- Diff post-Windows Update ----
ipcMain.handle('snapshot:get', () => snapshot.getSnapshot());
ipcMain.handle('snapshot:take', () => snapshot.takeSnapshot());
ipcMain.handle('snapshot:compare', () => snapshot.compare());

// ---- Automatisation planifiée ----
ipcMain.handle('schedule:status', () => schedule.status());
ipcMain.handle('schedule:create', (_e, frequency) => {
  const { script } = schedule.buildCreate(frequency, process.execPath);
  return runPowerShell(script);
});
ipcMain.handle('schedule:remove', () => {
  const { script } = schedule.buildRemove();
  return runPowerShell(script);
});

// ---- Démarrage & services : désactivations ciblées ----
ipcMain.handle('startup:disableStartup', (_e, names) => {
  const { script, needsElevation } = startup.buildDisableStartup(names);
  if (!script.trim()) return { ok: false, stderr: 'Rien à désactiver.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});
ipcMain.handle('startup:disableTasks', (_e, tasks) => {
  const { script, needsElevation } = startup.buildDisableTasks(tasks);
  if (!script.trim()) return { ok: false, stderr: 'Rien à désactiver.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});
ipcMain.handle('startup:disableServices', (_e, names) => {
  const { script, needsElevation } = startup.buildDisableServices(names);
  if (!script.trim()) return { ok: false, stderr: 'Rien à désactiver.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});
ipcMain.handle('startup:fixSurface', (_e, ids) => {
  const { script, needsElevation } = startup.buildFixSurface(ids);
  if (!script.trim()) return { ok: false, stderr: 'Rien à corriger.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});
ipcMain.handle('startup:previewStartup', (_e, names) => startup.buildDisableStartup(names));
ipcMain.handle('startup:previewTasks', (_e, tasks) => startup.buildDisableTasks(tasks));
ipcMain.handle('startup:previewServices', (_e, names) => startup.buildDisableServices(names));
ipcMain.handle('startup:previewSurface', (_e, ids) => startup.buildFixSurface(ids));

// ---- EXIF GPS ----
ipcMain.handle('exif:pickFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choisir un dossier de photos à analyser',
  });
  return canceled ? null : filePaths[0];
});
ipcMain.handle('exif:scan', (_e, folder) => exif.scan(folder));
ipcMain.handle('exif:strip', (_e, paths) => exif.strip(paths));

// ---- Prévisualisation des scripts ----
ipcMain.handle('preview:telemetry', (_e, ids) => telemetry.buildRemediation(ids));
ipcMain.handle('preview:network', (_e, ids) => network.buildRemediation(ids));
ipcMain.handle('preview:appx', (_e, ids) => apps.buildRemoveAppx(ids));
ipcMain.handle('preview:windows11', (_e, ids) => windows11.buildRemediation(ids));

// ---- Restauration système globale ----
ipcMain.handle('restore:create', () => restore.createRestorePoint());

// ---- Helper : applique une remédiation registre en journalisant le rollback ----
async function applyWithRollback({ actionId, label, targets, script, needsElevation }) {
  if (!script || !script.trim()) return { ok: false, stderr: 'Aucune action sélectionnée.' };
  // 1. Capture l'état AVANT (pour rollback ciblé).
  let rollbackId = null;
  try {
    rollbackId = await rollback.snapshot({ actionId, label, targets });
  } catch (_) { /* le rollback est un bonus, on n'empêche pas l'action s'il échoue */ }
  // 2. Applique.
  const res = needsElevation ? await runPowerShellElevated(script) : await runPowerShell(script);
  return { ...res, rollbackId };
}

// ---- Télémétrie ----
ipcMain.handle('apply:telemetry', async (_e, ids) => {
  const { script, needsElevation } = telemetry.buildRemediation(ids);
  return applyWithRollback({
    actionId: 'telemetry', label: `Télémétrie (${ids.length} réglage(s))`,
    targets: telemetry.targetsFor(ids), script, needsElevation,
  });
});
ipcMain.handle('restore:telemetry', async (_e, ids) => {
  const { script, needsElevation } = telemetry.buildRestore(ids);
  if (!script.trim()) return { ok: false, stderr: 'Aucune action sélectionnée.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});

// ---- Windows 11 ----
ipcMain.handle('apply:windows11', async (_e, ids) => {
  const { script, needsElevation } = windows11.buildRemediation(ids);
  return applyWithRollback({
    actionId: 'windows11', label: `Windows 11 (${ids.length} réglage(s))`,
    targets: windows11.targetsFor(ids), script, needsElevation,
  });
});
ipcMain.handle('restore:windows11', async (_e, ids) => {
  const { script, needsElevation } = windows11.buildRestore(ids);
  if (!script.trim()) return { ok: false, stderr: 'Aucune action sélectionnée.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});

// ---- Réseau ----
ipcMain.handle('apply:network', async (_e, ids) => {
  const { script, needsElevation } = network.buildRemediation(ids);
  if (!script.trim()) return { ok: false, stderr: 'Aucune action sélectionnée.' };
  return needsElevation ? runPowerShellElevated(script) : runPowerShell(script);
});

// ---- Bloatware AppX ----
ipcMain.handle('apply:removeAppx', async (_e, ids) => {
  const { script } = apps.buildRemoveAppx(ids);
  if (!script.trim()) return { ok: false, stderr: 'Aucune action sélectionnée.' };
  return runPowerShell(script);
});

// ---- Profils ----
ipcMain.handle('profiles:list', () => profiles.PROFILES);
ipcMain.handle('profiles:audit', (_e, id) => profiles.auditProfile(id));
ipcMain.handle('profiles:plan', (_e, id) => {
  const plan = profiles.planFor(id);
  // On ne renvoie pas les targets au renderer (inutile), juste script + méta.
  return { profileId: plan.profileId, modules: plan.modules, script: plan.script, needsElevation: plan.needsElevation };
});
ipcMain.handle('profiles:apply', async (_e, id) => {
  const plan = profiles.planFor(id);
  return applyWithRollback({
    actionId: `profile-${id}`, label: `Profil « ${id} »`,
    targets: plan.targets, script: plan.script, needsElevation: plan.needsElevation,
  });
});

// ---- Journal de rollback ----
ipcMain.handle('rollback:list', () => rollback.list());
ipcMain.handle('rollback:preview', (_e, pointId) => rollback.previewUndo(pointId));
ipcMain.handle('rollback:undo', (_e, pointId) => rollback.undo(pointId));

// ---- Historique du score ----
ipcMain.handle('history:get', () => store.getScoreHistory());
ipcMain.handle('history:add', (_e, entry) => store.addScoreEntry(entry));

// ---- Préférences ----
ipcMain.handle('prefs:get', () => store.getPrefs());
ipcMain.handle('prefs:set', (_e, patch) => store.setPrefs(patch));

// ---- Fuites (HIBP) ----
ipcMain.handle('breaches:check', (_e, pwd) => breaches.checkPassword(pwd));

// ---- Export du rapport (PDF ou HTML) ----
ipcMain.handle('report:export', async (_e, { data, format }) => {
  const html = report.buildHtml(data);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultName = `ITWasher-rapport-${stamp}.${format === 'pdf' ? 'pdf' : 'html'}`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: format === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    if (format === 'html') {
      fs.writeFileSync(filePath, html, 'utf8');
    } else {
      // Rend le HTML dans une fenêtre offscreen puis exporte en PDF.
      const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
      await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
      fs.writeFileSync(filePath, pdf);
      pdfWin.close();
    }
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, stderr: String(err.message || err) };
  }
});

// ---- Ouvrir un lien / fichier ----
ipcMain.handle('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle('open:path', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); return true; });

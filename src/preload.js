'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Pont sécurisé : le renderer ne voit qu'une API blanche, jamais Node directement.
contextBridge.exposeInMainWorld('api', {
  audit: {
    telemetry: () => ipcRenderer.invoke('audit:telemetry'),
    apps: () => ipcRenderer.invoke('audit:apps'),
    browsers: () => ipcRenderer.invoke('audit:browsers'),
    network: () => ipcRenderer.invoke('audit:network'),
    windows11: () => ipcRenderer.invoke('audit:windows11'),
    accounts: () => ipcRenderer.invoke('audit:accounts'),
    startup: () => ipcRenderer.invoke('audit:startup'),
    homenetwork: () => ipcRenderer.invoke('audit:homenetwork'),
  },
  homenetwork: {
    ipLeak: () => ipcRenderer.invoke('homenetwork:ipLeak'),
    previewUpnp: () => ipcRenderer.invoke('homenetwork:previewUpnp'),
    disableUpnp: () => ipcRenderer.invoke('homenetwork:disableUpnp'),
  },
  snapshot: {
    get: () => ipcRenderer.invoke('snapshot:get'),
    take: () => ipcRenderer.invoke('snapshot:take'),
    compare: () => ipcRenderer.invoke('snapshot:compare'),
  },
  schedule: {
    status: () => ipcRenderer.invoke('schedule:status'),
    create: (frequency) => ipcRenderer.invoke('schedule:create', frequency),
    remove: () => ipcRenderer.invoke('schedule:remove'),
  },
  onTrayScan: (cb) => ipcRenderer.on('tray:scan', cb),
  startup: {
    disableStartup: (names) => ipcRenderer.invoke('startup:disableStartup', names),
    disableTasks: (tasks) => ipcRenderer.invoke('startup:disableTasks', tasks),
    disableServices: (names) => ipcRenderer.invoke('startup:disableServices', names),
    fixSurface: (ids) => ipcRenderer.invoke('startup:fixSurface', ids),
    previewStartup: (names) => ipcRenderer.invoke('startup:previewStartup', names),
    previewTasks: (tasks) => ipcRenderer.invoke('startup:previewTasks', tasks),
    previewServices: (names) => ipcRenderer.invoke('startup:previewServices', names),
    previewSurface: (ids) => ipcRenderer.invoke('startup:previewSurface', ids),
  },
  exif: {
    pickFolder: () => ipcRenderer.invoke('exif:pickFolder'),
    scan: (folder) => ipcRenderer.invoke('exif:scan', folder),
    strip: (paths) => ipcRenderer.invoke('exif:strip', paths),
  },
  preview: {
    telemetry: (ids) => ipcRenderer.invoke('preview:telemetry', ids),
    network: (ids) => ipcRenderer.invoke('preview:network', ids),
    appx: (ids) => ipcRenderer.invoke('preview:appx', ids),
    windows11: (ids) => ipcRenderer.invoke('preview:windows11', ids),
  },
  apply: {
    telemetry: (ids) => ipcRenderer.invoke('apply:telemetry', ids),
    restoreTelemetry: (ids) => ipcRenderer.invoke('restore:telemetry', ids),
    network: (ids) => ipcRenderer.invoke('apply:network', ids),
    removeAppx: (ids) => ipcRenderer.invoke('apply:removeAppx', ids),
    windows11: (ids) => ipcRenderer.invoke('apply:windows11', ids),
    restoreWindows11: (ids) => ipcRenderer.invoke('restore:windows11', ids),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    audit: (id) => ipcRenderer.invoke('profiles:audit', id),
    plan: (id) => ipcRenderer.invoke('profiles:plan', id),
    apply: (id) => ipcRenderer.invoke('profiles:apply', id),
  },
  rollback: {
    list: () => ipcRenderer.invoke('rollback:list'),
    preview: (pointId) => ipcRenderer.invoke('rollback:preview', pointId),
    undo: (pointId) => ipcRenderer.invoke('rollback:undo', pointId),
  },
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },
  restore: {
    status: () => ipcRenderer.invoke('restore:status'),
    create: () => ipcRenderer.invoke('restore:create'),
  },
  breaches: {
    check: (pwd) => ipcRenderer.invoke('breaches:check', pwd),
  },
  report: {
    export: (data, format) => ipcRenderer.invoke('report:export', { data, format }),
  },
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  openPath: (p) => ipcRenderer.invoke('open:path', p),
});

'use strict';
/* Renderer : orchestre navigation, audit, rendu et confirmations. */

const container = document.getElementById('view-container');
const state = { telemetry: null, apps: null, browsers: null, network: null, windows11: null, dashboardDone: false };

// ---------- Utilitaires ----------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function statusClass(s) { return s === 'ok' ? 's-ok' : s === 'crit' ? 's-crit' : 's-warn'; }

let toastTimer;
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 4200);
}

function loading(label = 'Audit en cours…') {
  return `<div class="loading"><div class="spinner"></div><span>${esc(label)}</span></div>`;
}

// ---------- Modale de confirmation ----------
function confirmAction({ title, desc, script, elevated }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-desc').textContent = desc || '';
    document.getElementById('modal-script').textContent = script || '(aucune commande)';
    document.getElementById('modal-elevation').classList.toggle('hidden', !elevated);
    modal.classList.remove('hidden');

    const cancel = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    const cleanup = () => {
      modal.classList.add('hidden');
      cancel.onclick = null; confirm.onclick = null;
    };
    cancel.onclick = () => { cleanup(); resolve(false); };
    confirm.onclick = () => { cleanup(); resolve(true); };
  });
}

// ---------- Navigation ----------
const views = {
  dashboard: renderDashboard,
  profiles: renderProfiles,
  telemetry: renderTelemetry,
  windows11: renderWindows11,
  apps: renderApps,
  startup: renderStartup,
  browsers: renderBrowsers,
  breaches: renderBreaches,
  exif: renderExif,
  network: renderNetwork,
  homenetwork: renderHomeNetwork,
  accounts: renderAccounts,
  snapshot: renderSnapshot,
  schedule: renderSchedule,
  history: renderHistory,
  journal: renderJournal,
};

function navigate(view) {
  document.querySelectorAll('#nav li').forEach((li) =>
    li.classList.toggle('active', li.dataset.view === view));
  (views[view] || renderDashboard)();
}

document.getElementById('nav').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) navigate(li.dataset.view);
});

// ---------- Vue : Tableau de bord ----------
// Le tableau de bord a deux états : inactif (bouton de lancement) et résultats.
// L'analyse ne démarre JAMAIS toute seule — uniquement sur clic.
async function renderDashboard() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Vue d'ensemble</span>
      <h1>Tableau de bord</h1>
      <p>Un audit complet de ta vie privée et de la sécurité de ce PC. Lance l'audit pour calculer ton score d'hygiène, puis inspecte chaque domaine.</p>
    </div>
    <div id="dash-body"></div>`;

  const body = document.getElementById('dash-body');
  const lastScore = await window.api.history.get().then((h) => h.length ? h[h.length - 1] : null).catch(() => null);

  // Si un audit a déjà tourné dans cette session, on réaffiche ses résultats.
  if (state.dashboardDone) { renderDashboardResults(); return; }

  // État inactif : bouton de lancement.
  body.innerHTML = `
    <div class="scan-hero">
      <div class="scan-ring">◈</div>
      <h2>Prêt à analyser ton système</h2>
      <p>ITWasher va inspecter la télémétrie, les applications, les navigateurs, le réseau et les nouveautés Windows 11. Lecture seule — aucune modification n'est faite pendant l'analyse.</p>
      <button class="btn btn-accent" id="dash-launch" style="padding:12px 28px;font-size:15px;margin-top:8px">▶ Lancer l'analyse complète</button>
      ${lastScore ? `<p class="scan-last">Dernier score enregistré : <b style="color:${lastScore.score>=75?'var(--ok)':lastScore.score>=45?'var(--warn)':'var(--crit)'}">${lastScore.score}/100</b> · ${new Date(lastScore.ts).toLocaleString('fr-FR')}</p>` : ''}
    </div>`;
  body.querySelector('#dash-launch').onclick = () => runFullAudit();
}

// Lance réellement tous les audits, puis affiche les résultats.
async function runFullAudit() {
  const body = document.getElementById('dash-body');
  if (body) body.innerHTML = loading('Analyse du système…');

  // Lance tous les audits en parallèle.
  const [tel, ap, br, net, w11] = await Promise.all([
    window.api.audit.telemetry().catch(() => null),
    window.api.audit.apps().catch(() => null),
    window.api.audit.browsers().catch(() => null),
    window.api.audit.network().catch(() => null),
    window.api.audit.windows11().catch(() => null),
  ]);
  state.telemetry = tel; state.apps = ap; state.browsers = br; state.network = net; state.windows11 = w11;
  state.dashboardDone = true;

  // Enregistre le score dans l'historique (horodaté), une seule fois par analyse.
  const { score } = computeScore();
  window.api.history.add({ score, total: state.lastTotal, ok: state.lastOk }).catch(() => {});

  renderDashboardResults();
}

// Calcule le score global à partir de l'état audité.
function computeScore() {
  const { telemetry: tel, apps: ap, browsers: br, network: net, windows11: w11 } = state;
  let total = 0, ok = 0;
  if (tel) { total += tel.length; ok += tel.filter((c) => c.status === 'ok').length; }
  if (w11) { total += w11.length; ok += w11.filter((c) => c.status === 'ok').length; }
  if (net) { total += net.checks.length; ok += net.checks.filter((c) => c.status === 'ok').length; }
  if (br) { total += br.detected.length; ok += br.detected.filter((c) => c.status === 'ok').length; }
  if (ap) {
    const apIssues = ap.flagged.length + ap.bloatware.length;
    total += Math.max(apIssues, 1);
    ok += apIssues === 0 ? 1 : 0;
  }
  state.lastTotal = total; state.lastOk = ok;
  return { score: total ? Math.round((ok / total) * 100) : 0, total, ok };
}

// Affiche les résultats du dernier audit (sans relancer les scans).
async function renderDashboardResults() {
  const { telemetry: tel, apps: ap, browsers: br, network: net, windows11: w11 } = state;
  const { score } = computeScore();
  const scoreColor = score >= 75 ? 'var(--ok)' : score >= 45 ? 'var(--warn)' : 'var(--crit)';
  const verdict = score >= 75 ? 'Bonne hygiène' : score >= 45 ? 'Perfectible' : 'À renforcer';
  const circ = 2 * Math.PI * 56;
  const dash = circ * (score / 100);

  const restoreInfo = await window.api.restore.status().catch(() => 'unavailable');

  const cards = [
    { view: 'telemetry', ico: '◉', name: 'Télémétrie Windows', stat: tel ? `${tel.filter(c=>c.status!=='ok').length} réglage(s) à durcir` : 'Erreur', bad: tel ? tel.filter(c=>c.status!=='ok').length : 0 },
    { view: 'windows11', ico: '⊞', name: 'Nouveautés Windows 11', stat: w11 ? `${w11.filter(c=>c.status!=='ok').length} à durcir (Recall, Copilot…)` : 'Erreur', bad: w11 ? w11.filter(c=>c.status!=='ok').length : 0 },
    { view: 'apps', ico: '▦', name: 'Applications', stat: ap ? `${ap.flagged.length} à remplacer · ${ap.bloatware.length} bloatware` : 'Erreur', bad: ap ? ap.flagged.length + ap.bloatware.length : 0 },
    { view: 'browsers', ico: '◐', name: 'Navigateurs', stat: br ? `${br.detected.length} détecté(s) · ${br.consent.length} consentements` : 'Erreur', bad: br ? br.detected.filter(c=>c.status==='warn').length : 0 },
    { view: 'network', ico: '⇄', name: 'Réseau & sécurité', stat: net ? `${net.checks.filter(c=>c.status!=='ok').length} point(s) faible(s)` : 'Erreur', bad: net ? net.checks.filter(c=>c.status!=='ok').length : 0 },
  ];

  const body = document.getElementById('dash-body');
  body.innerHTML = `
    <div class="score-hero">
      <div class="gauge">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="56" fill="none" stroke="var(--line)" stroke-width="9"/>
          <circle cx="65" cy="65" r="56" fill="none" stroke="${scoreColor}" stroke-width="9"
            stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/>
        </svg>
        <div class="gauge-num"><b style="color:${scoreColor}">${score}</b><small>/ 100</small></div>
      </div>
      <div class="score-txt">
        <h2>${verdict}</h2>
        <p>Score calculé sur l'ensemble des points de contrôle. Chaque domaine détaille les actions recommandées — rien n'est modifié tant que tu ne confirmes pas.</p>
        <p style="margin-top:10px; font-family:var(--mono); font-size:11px; color:var(--text-faint)">
          Protection système : ${restoreInfo === 'unavailable' ? 'indisponible' : restoreInfo + ' point(s) de restauration existant(s)'}
        </p>
      </div>
    </div>
    <div class="action-bar" style="margin-bottom:16px">
      <button class="btn btn-accent btn-sm" id="dash-profiles">◈ Appliquer un profil en un clic</button>
      <button class="btn btn-sm" id="dash-rescan">↻ Relancer l'analyse</button>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="dash-export-pdf">⭳ Exporter en PDF</button>
      <button class="btn btn-sm" id="dash-export-html">⭳ Exporter en HTML</button>
    </div>
    <div class="grid-cards">
      ${cards.map((c) => `
        <div class="mini-card" data-view="${c.view}">
          <div class="mc-top">
            <span class="mc-ico">${c.ico}</span>
            <span class="mc-badge" style="background:${c.bad>0?'var(--warn-bg)':'var(--ok-bg)'};color:${c.bad>0?'var(--warn)':'var(--ok)'}">
              ${c.bad > 0 ? c.bad + ' ⚠' : '✓ OK'}
            </span>
          </div>
          <h3>${esc(c.name)}</h3>
          <div class="mc-stat">${esc(c.stat)}</div>
        </div>`).join('')}
    </div>`;

  body.querySelectorAll('.mini-card').forEach((card) =>
    card.addEventListener('click', () => navigate(card.dataset.view)));
  body.querySelector('#dash-profiles').onclick = () => navigate('profiles');
  body.querySelector('#dash-rescan').onclick = () => runFullAudit();

  // Prépare les données du rapport à partir de l'état audité.
  const reportData = () => buildReportData({ score, verdict, tel, w11, ap, br, net });
  body.querySelector('#dash-export-pdf').onclick = () => exportReport(reportData(), 'pdf');
  body.querySelector('#dash-export-html').onclick = () => exportReport(reportData(), 'html');
}

// Assemble les données du rapport pour l'export.
function buildReportData({ score, verdict, tel, w11, ap, br, net }) {
  const sections = [];
  if (tel) sections.push({ title: 'Télémétrie Windows', rows: tel });
  if (w11) sections.push({ title: 'Nouveautés Windows 11', rows: w11 });
  if (net) sections.push({ title: 'Réseau & sécurité', rows: net.checks.map((c) => ({ label: c.label, detail: c.detail, current: c.current, status: c.status })) });
  if (ap) {
    const rows = [
      ...ap.flagged.map((f) => ({ label: f.name + ' (à remplacer)', detail: f.reason + ' → ' + f.alt, status: 'warn' })),
      ...ap.bloatware.map((b) => ({ label: b.label + ' (bloatware)', detail: b.id, status: 'warn' })),
    ];
    if (rows.length) sections.push({ title: 'Applications à traiter', rows });
  }
  if (br) sections.push({ title: 'Navigateurs', rows: br.detected.map((d) => ({ label: d.name, detail: 'Confidentialité : ' + d.privacy, status: d.status })) });
  return { score, verdict, generatedAt: Date.now(), sections };
}

async function exportReport(data, format) {
  toast(`Génération du rapport ${format.toUpperCase()}…`);
  const res = await window.api.report.export(data, format);
  if (res.canceled) return;
  if (res.ok) {
    toast(`Rapport enregistré ✓`, 'ok');
    window.api.openPath(res.filePath);
  } else {
    toast('Échec de l\'export : ' + (res.stderr || ''), 'err');
  }
}

// ---------- Vue : Télémétrie ----------
async function renderTelemetry() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Confidentialité</span>
      <h1>Télémétrie Windows</h1>
      <p>Windows collecte par défaut de nombreuses données. Coche les réglages à durcir, puis applique — un point de restauration est proposé avant toute écriture registre.</p>
    </div>
    <div id="tel-body">${loading()}</div>`;

  const data = state.telemetry || await window.api.audit.telemetry();
  state.telemetry = data;
  const body = document.getElementById('tel-body');

  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-sm" id="tel-selectall">Tout cocher</button>
      <button class="btn btn-accent btn-sm" id="tel-apply">Appliquer la sélection</button>
      <button class="btn btn-sm" id="tel-restore">Restaurer (annuler)</button>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="tel-rp">🛡 Créer un point de restauration</button>
    </div>
    ${data.map((c) => checkRow(c)).join('')}`;

  bindTelemetry(body, data);
}

function checkRow(c) {
  const isOk = c.status === 'ok';
  return `
    <div class="check">
      <div class="check-status ${statusClass(c.status)}"></div>
      <div class="check-body">
        <div class="check-title">${esc(c.label)}</div>
        <div class="check-detail">${esc(c.detail)}</div>
        <div class="check-meta">
          <span><b>Actuel :</b> <span class="${isOk?'val-ok':'val-current'}">${esc(c.current)}</span></span>
          <span><b>Recommandé :</b> ${esc(c.recommended)}</span>
        </div>
      </div>
      <div class="check-side">
        <span class="pill pill-${c.risk}">${c.risk === 'low' ? 'risque faible' : c.risk === 'medium' ? 'risque moyen' : 'risque élevé'}</span>
        ${c.elevated ? '<span class="pill pill-elev">admin</span>' : ''}
        ${isOk
          ? '<label class="chk"><span style="color:var(--ok)">✓ déjà durci</span></label>'
          : `<label class="chk"><input type="checkbox" data-id="${c.id}" ${c.status!=='ok'?'checked':''}><span>sélectionner</span></label>`}
      </div>
    </div>`;
}

function bindTelemetry(body, data) {
  const getIds = () => Array.from(body.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.dataset.id);

  body.querySelector('#tel-selectall').onclick = () => {
    const boxes = body.querySelectorAll('input[type=checkbox]');
    const allChecked = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allChecked; });
  };

  body.querySelector('#tel-rp').onclick = async () => {
    toast('Création du point de restauration… (UAC requis)');
    const res = await window.api.restore.create();
    toast(res.ok ? 'Point de restauration créé ✓' : 'Échec / annulé : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
  };

  body.querySelector('#tel-apply').onclick = async () => {
    const ids = getIds();
    if (!ids.length) return toast('Aucun réglage sélectionné.', 'err');
    const preview = await window.api.preview.telemetry(ids);
    const go = await confirmAction({
      title: 'Durcir la télémétrie',
      desc: `${ids.length} réglage(s) seront modifiés dans le registre. Action réversible via « Restaurer ».`,
      script: preview.script,
      elevated: preview.needsElevation,
    });
    if (!go) return;
    toast('Application en cours…');
    const res = await window.api.apply.telemetry(ids);
    toast(res.ok ? 'Réglages appliqués ✓' : 'Échec : ' + (res.stderr || 'erreur'), res.ok ? 'ok' : 'err');
    if (res.ok) { state.telemetry = null; renderTelemetry(); }
  };

  body.querySelector('#tel-restore').onclick = async () => {
    const ids = getIds();
    if (!ids.length) return toast('Coche les réglages à restaurer.', 'err');
    const go = await confirmAction({
      title: 'Restaurer les valeurs par défaut',
      desc: `${ids.length} réglage(s) seront remis à leur valeur Windows par défaut.`,
      script: '(restauration des valeurs par défaut)',
      elevated: data.some((c) => ids.includes(c.id) && c.elevated),
    });
    if (!go) return;
    const res = await window.api.apply.restoreTelemetry(ids);
    toast(res.ok ? 'Valeurs restaurées ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) { state.telemetry = null; renderTelemetry(); }
  };
}

// ---------- Vue : Applications ----------
async function renderApps() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Audit logiciel</span>
      <h1>Applications installées</h1>
      <p>Applications intrusives à remplacer et bloatware Windows superflu. Les remplacements ouvrent le site de l'alternative ; la désinstallation reste à ta main.</p>
    </div>
    <div id="apps-body">${loading('Inventaire des applications…')}</div>`;

  const data = state.apps || await window.api.audit.apps();
  state.apps = data;
  const body = document.getElementById('apps-body');

  const flaggedHtml = data.flagged.length ? data.flagged.map((f) => `
    <div class="check">
      <div class="check-status s-warn"></div>
      <div class="check-body">
        <div class="check-title">${esc(f.name)} ${f.version ? '<span style="color:var(--text-faint);font-family:var(--mono);font-size:11px">'+esc(f.version)+'</span>' : ''}</div>
        <div class="check-detail">${esc(f.reason)}</div>
        <div class="check-meta"><span><b>Alternative :</b> <span style="color:var(--accent)">${esc(f.alt)}</span></span></div>
      </div>
      <div class="check-side">
        <button class="btn btn-sm btn-accent" data-url="${esc(f.url)}">Voir l'alternative →</button>
      </div>
    </div>`).join('') : '<div class="empty">Aucune application intrusive connue détectée. 👍</div>';

  const bloatHtml = data.bloatware.length ? `
    <div class="action-bar" style="margin-top:8px">
      <button class="btn btn-accent btn-sm" id="appx-apply">Désinstaller la sélection</button>
      <span style="color:var(--text-dim);font-size:12px">Suppression par utilisateur, réinstallable via le Store.</span>
    </div>
    ${data.bloatware.map((b) => `
    <div class="check">
      <div class="check-status s-warn"></div>
      <div class="check-body">
        <div class="check-title">${esc(b.label)}</div>
        <div class="check-detail" style="font-family:var(--mono);font-size:11px;color:var(--text-faint)">${esc(b.id)}</div>
      </div>
      <div class="check-side">
        <label class="chk"><input type="checkbox" data-appx="${esc(b.id)}" checked><span>désinstaller</span></label>
      </div>
    </div>`).join('')}` : '<div class="empty">Aucun bloatware connu détecté.</div>';

  body.innerHTML = `
    <span class="eyebrow">À remplacer</span>
    ${flaggedHtml}
    <div style="height:22px"></div>
    <span class="eyebrow">Bloatware Windows</span>
    ${bloatHtml}
    <div style="height:22px"></div>
    <span class="eyebrow">Toutes les applications (${data.totalInstalled})</span>
    <input type="text" class="list-filter" id="apps-filter" placeholder="🔍 Filtrer par nom ou éditeur…" autocomplete="off">
    <div class="app-scroll">
      <table class="app-table">
        <thead><tr><th>Nom</th><th>Version</th><th>Éditeur</th></tr></thead>
        <tbody id="apps-tbody">
          ${data.installed.map((a) => `<tr data-search="${esc((a.name + ' ' + a.publisher).toLowerCase())}"><td>${esc(a.name)}</td><td>${esc(a.version)}</td><td>${esc(a.publisher)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  // Filtrage en direct de la liste des applications.
  const filterInput = body.querySelector('#apps-filter');
  filterInput.addEventListener('input', () => {
    const q = filterInput.value.trim().toLowerCase();
    body.querySelectorAll('#apps-tbody tr').forEach((tr) => {
      tr.style.display = !q || tr.dataset.search.includes(q) ? '' : 'none';
    });
  });

  body.querySelectorAll('[data-url]').forEach((btn) =>
    btn.addEventListener('click', () => window.api.openExternal(btn.dataset.url)));

  const applyBtn = body.querySelector('#appx-apply');
  if (applyBtn) applyBtn.onclick = async () => {
    const ids = Array.from(body.querySelectorAll('input[data-appx]:checked')).map((i) => i.dataset.appx);
    if (!ids.length) return toast('Aucun paquet sélectionné.', 'err');
    const preview = await window.api.preview.appx(ids);
    const go = await confirmAction({
      title: 'Désinstaller des applications',
      desc: `${ids.length} application(s) Windows seront désinstallées pour ton compte.`,
      script: preview.script, elevated: false,
    });
    if (!go) return;
    const res = await window.api.apply.removeAppx(ids);
    toast(res.ok ? 'Désinstallé ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) { state.apps = null; renderApps(); }
  };
}

// ---------- Vue : Navigateurs & consentements ----------
async function renderBrowsers() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Navigation privée</span>
      <h1>Navigateurs &amp; consentements</h1>
      <p>Navigateurs détectés, réglages anti-tracking, et checklist guidée pour Utiq et les régies publicitaires. Ces consentements vivent sur des portails web tiers : ils ne s'automatisent pas, mais on te guide pas à pas.</p>
    </div>
    <div id="br-body">${loading('Détection des navigateurs…')}</div>`;

  const data = state.browsers || await window.api.audit.browsers();
  state.browsers = data;
  const body = document.getElementById('br-body');

  const privLabel = { 'intrusif': 'var(--crit)', 'bon': 'var(--ok)', 'excellent': 'var(--accent)' };

  body.innerHTML = `
    <span class="eyebrow">Navigateurs détectés</span>
    ${data.detected.length ? data.detected.map((b) => `
      <div class="check">
        <div class="check-status ${b.status==='ok'?'s-ok':'s-warn'}"></div>
        <div class="check-body">
          <div class="check-title">${esc(b.name)}</div>
          <div class="check-meta"><span><b>Confidentialité :</b> <span style="color:${privLabel[b.privacy]||'var(--text-dim)'}">${esc(b.privacy)}</span></span></div>
        </div>
        ${b.privacy==='intrusif' ? '<div class="check-side"><button class="btn btn-sm btn-accent" data-url="https://brave.com/">Passer à Brave →</button></div>' : ''}
      </div>`).join('') : '<div class="empty">Aucun navigateur connu détecté.</div>'}

    <div style="height:22px"></div>
    <span class="eyebrow">Réglages recommandés (manuels)</span>
    <div class="guide">
      <ul style="margin-left:18px; color:var(--text); font-size:13px; line-height:1.9">
        ${data.tips.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
    </div>

    <div style="height:22px"></div>
    <span class="eyebrow">Consentements à révoquer</span>
    ${data.consent.map((c) => `
      <div class="guide">
        <h3><span style="color:var(--accent)">◆</span> ${esc(c.title)}</h3>
        <div class="g-detail">${esc(c.detail)}</div>
        <ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <button class="btn btn-sm btn-accent" data-url="${esc(c.url)}">Ouvrir le portail →</button>
      </div>`).join('')}`;

  body.querySelectorAll('[data-url]').forEach((btn) =>
    btn.addEventListener('click', () => window.api.openExternal(btn.dataset.url)));
}

// ---------- Vue : Fuites de données ----------
function renderBreaches() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Compromission</span>
      <h1>Fuites de données</h1>
      <p>Vérifie si un mot de passe a déjà fuité dans une brèche connue, via la base Pwned Passwords (plus de 800 millions de mots de passe compromis).</p>
    </div>
    <div class="pw-field">
      <div class="check-title">Tester un mot de passe</div>
      <div class="check-detail">Saisis un mot de passe pour savoir s'il apparaît dans des fuites connues.</div>
      <div class="pw-input-row">
        <input type="password" id="pw-input" placeholder="Ton mot de passe…" autocomplete="off" spellcheck="false" />
        <button class="btn btn-accent" id="pw-check">Vérifier</button>
        <button class="btn btn-sm" id="pw-toggle" title="Afficher/masquer">👁</button>
      </div>
      <div id="pw-result"></div>
      <div class="privacy-note">
        <span>🔒</span>
        <span><b>Ton mot de passe ne quitte jamais cet ordinateur.</b> On calcule son empreinte SHA-1 localement et on n'envoie que les 5 premiers caractères de cette empreinte à l'API (protocole k-anonymity). Impossible pour le serveur de connaître ton mot de passe.</span>
      </div>
    </div>`;

  const input = document.getElementById('pw-input');
  const resultEl = document.getElementById('pw-result');

  document.getElementById('pw-toggle').onclick = () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  };

  const doCheck = async () => {
    const pwd = input.value;
    if (!pwd) return toast('Saisis un mot de passe.', 'err');
    resultEl.innerHTML = `<div class="pw-result" style="background:var(--surface-2)">Vérification…</div>`;
    const res = await window.api.breaches.check(pwd);
    if (res.error) {
      resultEl.innerHTML = `<div class="pw-result pw-pwned">Erreur : ${esc(res.error)}</div>`;
    } else if (res.pwned) {
      resultEl.innerHTML = `<div class="pw-result pw-pwned">⚠ Compromis — vu ${res.count.toLocaleString('fr-FR')} fois dans des fuites. Change-le partout où tu l'utilises.</div>`;
    } else {
      resultEl.innerHTML = `<div class="pw-result pw-safe">✓ Pas trouvé dans les fuites connues. (Ne garantit pas qu'il soit fort — privilégie un gestionnaire de mots de passe.)</div>`;
    }
  };

  document.getElementById('pw-check').onclick = doCheck;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCheck(); });
}

// ---------- Vue : Réseau & sécurité ----------
async function renderNetwork() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Système</span>
      <h1>Réseau &amp; sécurité</h1>
      <p>Pare-feu, DNS chiffré, chiffrement disque, mises à jour et comptes. Les corrections nécessitent des droits administrateur.</p>
    </div>
    <div id="net-body">${loading('Analyse réseau et sécurité…')}</div>`;

  const data = state.network || await window.api.audit.network();
  state.network = data;
  const body = document.getElementById('net-body');

  const fixable = ['firewall', 'doh', 'builtin-admin'];
  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-accent btn-sm" id="net-apply">Corriger la sélection (admin)</button>
      <span style="color:var(--text-dim);font-size:12px">BitLocker et les MAJ se gèrent dans Windows (voir détails).</span>
    </div>
    ${data.checks.map((c) => {
      const canFix = fixable.includes(c.id) && c.status !== 'ok';
      return `
      <div class="check">
        <div class="check-status ${statusClass(c.status)}"></div>
        <div class="check-body">
          <div class="check-title">${esc(c.label)}</div>
          <div class="check-detail">${esc(c.detail)}</div>
          <div class="check-meta"><span><b>État :</b> <span class="${c.status==='ok'?'val-ok':'val-current'}">${esc(c.current)}</span></span></div>
        </div>
        <div class="check-side">
          <span class="pill pill-${c.risk}">${c.risk==='high'?'risque élevé':c.risk==='medium'?'risque moyen':'risque faible'}</span>
          ${canFix ? `<label class="chk"><input type="checkbox" data-id="${c.id}" checked><span>corriger</span></label>` : (c.status==='ok'?'<span style="color:var(--ok);font-size:11.5px">✓ OK</span>':'<span style="color:var(--text-faint);font-size:11px">manuel</span>')}
        </div>
      </div>`;
    }).join('')}`;

  body.querySelector('#net-apply').onclick = async () => {
    const ids = Array.from(body.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.dataset.id);
    if (!ids.length) return toast('Aucune correction sélectionnée.', 'err');
    const preview = await window.api.preview.network(ids);
    const go = await confirmAction({
      title: 'Corriger les réglages réseau',
      desc: `${ids.length} correction(s) seront appliquées. Droits administrateur requis.`,
      script: preview.script, elevated: true,
    });
    if (!go) return;
    toast('Application… (UAC requis)');
    const res = await window.api.apply.network(ids);
    toast(res.ok ? 'Corrections appliquées ✓' : 'Échec / annulé : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) { state.network = null; renderNetwork(); }
  };
}

// ---------- Vue : Nouveautés Windows 11 ----------
async function renderWindows11() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Windows 11</span>
      <h1>Nouveautés à surveiller</h1>
      <p>Recall (capture d'écran IA), Copilot, Widgets et presse-papiers cloud collectent ou synchronisent des données. Coche ce que tu veux désactiver.</p>
    </div>
    <div id="w11-body">${loading()}</div>`;

  const data = state.windows11 || await window.api.audit.windows11();
  state.windows11 = data;
  const body = document.getElementById('w11-body');

  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-sm" id="w11-selectall">Tout cocher</button>
      <button class="btn btn-accent btn-sm" id="w11-apply">Appliquer la sélection</button>
      <button class="btn btn-sm" id="w11-restore">Restaurer (annuler)</button>
    </div>
    ${data.map((c) => checkRow(c)).join('')}`;

  const getIds = () => Array.from(body.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.dataset.id);
  body.querySelector('#w11-selectall').onclick = () => {
    const boxes = body.querySelectorAll('input[type=checkbox]');
    const all = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
  };
  body.querySelector('#w11-apply').onclick = async () => {
    const ids = getIds();
    if (!ids.length) return toast('Aucun réglage sélectionné.', 'err');
    const preview = await window.api.preview.windows11(ids);
    const go = await confirmAction({
      title: 'Durcir les fonctions Windows 11',
      desc: `${ids.length} réglage(s) seront modifiés. Réversible via « Restaurer » ou le Journal.`,
      script: preview.script, elevated: preview.needsElevation,
    });
    if (!go) return;
    toast('Application en cours…');
    const res = await window.api.apply.windows11(ids);
    toast(res.ok ? 'Réglages appliqués ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) { state.windows11 = null; renderWindows11(); }
  };
  body.querySelector('#w11-restore').onclick = async () => {
    const ids = getIds();
    if (!ids.length) return toast('Coche les réglages à restaurer.', 'err');
    const go = await confirmAction({
      title: 'Restaurer les valeurs par défaut',
      desc: `${ids.length} réglage(s) seront remis à leur valeur Windows par défaut.`,
      script: '(restauration des valeurs par défaut)',
      elevated: data.some((c) => ids.includes(c.id) && c.elevated),
    });
    if (!go) return;
    const res = await window.api.apply.restoreWindows11(ids);
    toast(res.ok ? 'Valeurs restaurées ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) { state.windows11 = null; renderWindows11(); }
  };
}

// ---------- Vue : Profils ----------
async function renderProfiles() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Automatisation</span>
      <h1>Profils de confidentialité</h1>
      <p>Applique d'un coup un ensemble cohérent de réglages, plutôt que de cocher case par case. Chaque profil inclut le précédent. Tout est réversible via le Journal.</p>
    </div>
    <div id="prof-body">${loading('Évaluation des profils…')}</div>`;

  const [list, prefs] = await Promise.all([window.api.profiles.list(), window.api.prefs.get()]);
  const audits = await Promise.all(list.map((p) => window.api.profiles.audit(p.id).catch(() => ({ total: 0, done: 0 }))));
  const body = document.getElementById('prof-body');

  const toneColor = { ok: 'var(--ok)', accent: 'var(--accent)', warn: 'var(--warn)' };
  body.innerHTML = list.map((p, i) => {
    const a = audits[i];
    const pct = a.total ? Math.round((a.done / a.total) * 100) : 0;
    const active = prefs.profile === p.id;
    return `
      <div class="guide" style="border-color:${active ? toneColor[p.tone] : 'var(--line)'}">
        <h3><span style="color:${toneColor[p.tone]}">◈</span> Profil ${esc(p.label)} ${active ? '<span class="pill pill-elev" style="margin-left:8px">actif</span>' : ''}</h3>
        <div class="g-detail">${esc(p.detail)}</div>
        <div class="check-meta" style="margin-bottom:12px">
          <span><b>Conformité actuelle :</b> <span style="color:${pct>=100?'var(--ok)':'var(--warn)'}">${a.done}/${a.total} réglages (${pct}%)</span></span>
        </div>
        <button class="btn btn-sm ${pct>=100?'':'btn-accent'}" data-profile="${p.id}" ${pct>=100?'disabled':''}>
          ${pct>=100 ? '✓ Déjà appliqué' : 'Appliquer le profil ' + esc(p.label)}
        </button>
      </div>`;
  }).join('');

  body.querySelectorAll('[data-profile]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.profile;
      const plan = await window.api.profiles.plan(id);
      const go = await confirmAction({
        title: `Appliquer le profil « ${id} »`,
        desc: `Applique ${plan.modules.reduce((n, m) => n + m.ids.length, 0)} réglage(s) sur ${plan.modules.length} module(s). L'état actuel est sauvegardé pour annulation dans le Journal.`,
        script: plan.script, elevated: plan.needsElevation,
      });
      if (!go) return;
      toast('Application du profil…');
      const res = await window.api.profiles.apply(id);
      if (res.ok) { await window.api.prefs.set({ profile: id }); toast(`Profil « ${id} » appliqué ✓`, 'ok'); state.telemetry = state.windows11 = null; renderProfiles(); }
      else toast('Échec / annulé : ' + (res.stderr || ''), 'err');
    };
  });
}

// ---------- Vue : Comptes Windows ----------
async function renderAccounts() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Système</span>
      <h1>Comptes Windows</h1>
      <p>Audit de tous les comptes locaux : type (local vs Microsoft), droits admin, absence de mot de passe. Lecture seule — les modifications de comptes se font dans Windows.</p>
    </div>
    <div id="acc-body">${loading('Analyse des comptes…')}</div>`;

  const data = await window.api.audit.accounts();
  const body = document.getElementById('acc-body');

  body.innerHTML = `
    ${data.hasMicrosoftAccount ? '' : '<div class="privacy-note" style="margin-bottom:16px"><span>✓</span><span>Aucun compte Microsoft lié détecté — bon point pour la confidentialité (moins de données synchronisées au cloud).</span></div>'}
    ${data.users.map((u) => `
      <div class="check">
        <div class="check-status ${statusClass(u.status)}"></div>
        <div class="check-body">
          <div class="check-title">${esc(u.name)} ${u.enabled ? '' : '<span style="color:var(--text-faint);font-size:11px">(désactivé)</span>'}</div>
          <div class="check-meta">
            <span><b>Type :</b> ${esc(u.source)}</span>
            ${u.isAdmin ? '<span style="color:var(--warn)"><b>Admin</b></span>' : ''}
            ${u.lastLogon ? `<span><b>Dernière connexion :</b> ${esc(u.lastLogon)}</span>` : ''}
          </div>
          ${u.flags.length ? `<div class="check-meta">${u.flags.map((f) => `<span class="pill pill-${f.risk}">${esc(f.t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`).join('')}
    <div style="height:20px"></div>
    <span class="eyebrow">Politique de mot de passe</span>
    <div class="guide"><pre style="font-family:var(--mono);font-size:11.5px;color:var(--text-dim);white-space:pre-wrap;margin:0">${esc(data.policy.join('\n'))}</pre></div>`;
}

// ---------- Vue : Historique du score ----------
async function renderHistory() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Suivi dans le temps</span>
      <h1>Historique du score</h1>
      <p>Évolution de ton score d'hygiène à chaque audit. Comme un historique de crédit : visualise tes progrès dans le temps.</p>
    </div>
    <div id="hist-body">${loading('Chargement de l\'historique…')}</div>`;

  const hist = await window.api.history.get();
  const body = document.getElementById('hist-body');

  if (!hist.length) {
    body.innerHTML = '<div class="empty">Aucun audit enregistré pour l\'instant. Lance un audit depuis le tableau de bord.</div>';
    return;
  }

  // Graphique SVG simple (courbe du score dans le temps).
  const W = 720, H = 240, pad = 34;
  const pts = hist.slice(-60);
  const xStep = pts.length > 1 ? (W - pad * 2) / (pts.length - 1) : 0;
  const y = (s) => H - pad - (s / 100) * (H - pad * 2);
  const coords = pts.map((e, i) => [pad + i * xStep, y(e.score)]);
  const line = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ');
  const area = line + ` L${(pad + (pts.length - 1) * xStep).toFixed(1)} ${H - pad} L${pad} ${H - pad} Z`;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const delta = last.score - first.score;

  body.innerHTML = `
    <div class="score-hero" style="gap:20px">
      <div>
        <div class="gauge-num" style="position:static">
          <b style="font-family:var(--mono);font-size:38px;color:${last.score>=75?'var(--ok)':last.score>=45?'var(--warn)':'var(--crit)'}">${last.score}</b>
        </div>
        <div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:2px">score actuel</div>
        <div style="margin-top:8px;font-size:12px;color:${delta>=0?'var(--ok)':'var(--crit)'}">${delta>=0?'▲ +':'▼ '}${delta} depuis le 1er audit</div>
      </div>
      <div style="flex:1;overflow-x:auto">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%">
          ${[0,25,50,75,100].map((g) => `<line x1="${pad}" y1="${y(g)}" x2="${W-pad}" y2="${y(g)}" stroke="var(--line)" stroke-width="1"/><text x="4" y="${y(g)+4}" fill="var(--text-faint)" font-size="10" font-family="monospace">${g}</text>`).join('')}
          <path d="${area}" fill="var(--accent-glow)"/>
          <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
          ${coords.map((c) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="2.5" fill="var(--accent)"/>`).join('')}
        </svg>
      </div>
    </div>
    <div class="app-scroll" style="margin-top:16px">
      <table class="app-table">
        <thead><tr><th>Date</th><th>Score</th><th>Conformes</th></tr></thead>
        <tbody>${hist.slice().reverse().slice(0, 100).map((e) => `<tr><td>${new Date(e.ts).toLocaleString('fr-FR')}</td><td style="font-family:var(--mono)">${e.score}/100</td><td>${e.ok}/${e.total}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ---------- Vue : Journal & annulation (rollback) ----------
async function renderJournal() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Traçabilité</span>
      <h1>Journal &amp; annulation</h1>
      <p>Chaque action réversible enregistre l'état exact <b>avant</b> modification. Tu peux annuler une action précise sans toucher au reste du système, contrairement à un point de restauration global.</p>
    </div>
    <div id="jrn-body">${loading('Chargement du journal…')}</div>`;

  const points = await window.api.rollback.list();
  const body = document.getElementById('jrn-body');

  if (!points.length) {
    body.innerHTML = '<div class="empty">Aucune action enregistrée. Le journal se remplit dès que tu appliques un réglage ou un profil.</div>';
    return;
  }

  body.innerHTML = points.map((p) => `
    <div class="check">
      <div class="check-status ${p.undone ? 's-ok' : 's-warn'}"></div>
      <div class="check-body">
        <div class="check-title">${esc(p.label)}</div>
        <div class="check-meta">
          <span><b>Date :</b> ${new Date(p.ts).toLocaleString('fr-FR')}</span>
          <span><b>Clés touchées :</b> ${p.count}</span>
          ${p.undone ? '<span style="color:var(--ok)">✓ annulé</span>' : ''}
        </div>
      </div>
      <div class="check-side">
        ${p.undone ? '<span style="color:var(--text-faint);font-size:11px">restauré</span>' : `<button class="btn btn-sm" data-undo="${esc(p.id)}">↺ Annuler cette action</button>`}
      </div>
    </div>`).join('');

  body.querySelectorAll('[data-undo]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.undo;
      const preview = await window.api.rollback.preview(id);
      const go = await confirmAction({
        title: 'Annuler cette action',
        desc: 'Chaque clé registre sera remise exactement à sa valeur d\'avant l\'action.',
        script: preview.script, elevated: preview.needsElevation,
      });
      if (!go) return;
      const res = await window.api.rollback.undo(id);
      toast(res.ok ? 'Action annulée ✓' : 'Échec / annulé : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
      if (res.ok) { state.telemetry = state.windows11 = null; renderJournal(); }
    };
  });
}

// ---------- Vue : Démarrage & services (Autoruns) ----------
async function renderStartup() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Surface d'exécution</span>
      <h1>Démarrage &amp; services</h1>
      <p>Ce qui se lance automatiquement et ce qui écoute en arrière-plan. Désactive ce qui est inutile pour accélérer le démarrage et réduire la surface d'attaque. Les désactivations demandent les droits admin.</p>
    </div>
    <div id="su-body">${loading('Inventaire du démarrage, des tâches et services…')}</div>`;

  const data = await window.api.audit.startup();
  const body = document.getElementById('su-body');

  // Surface d'attaque d'abord (le plus important).
  const surfaceHtml = data.surface.map((s) => `
    <div class="check">
      <div class="check-status ${statusClass(s.status)}"></div>
      <div class="check-body">
        <div class="check-title">${esc(s.label)}</div>
        <div class="check-detail">${esc(s.detail)}</div>
        <div class="check-meta"><span><b>État :</b> <span class="${s.status==='ok'?'val-ok':'val-current'}">${esc(s.current)}</span></span></div>
      </div>
      <div class="check-side">
        <span class="pill pill-${s.risk}">${s.risk==='high'?'risque élevé':s.risk==='medium'?'risque moyen':'risque faible'}</span>
        ${s.fixable ? `<label class="chk"><input type="checkbox" data-surface="${esc(s.id)}" checked><span>corriger</span></label>` : (s.status==='ok'?'<span style="color:var(--ok);font-size:11.5px">✓ OK</span>':'<span style="color:var(--text-faint);font-size:11px">manuel</span>')}
      </div>
    </div>`).join('');

  const startupHtml = data.startup.length ? data.startup.map((s) => `
    <div class="check">
      <div class="check-status s-warn"></div>
      <div class="check-body">
        <div class="check-title">${esc(s.name)}</div>
        <div class="check-detail" style="font-family:var(--mono);font-size:11px;color:var(--text-faint);word-break:break-all">${esc(s.command)}</div>
        <div class="check-meta"><span><b>Emplacement :</b> ${esc(s.location)}</span></div>
      </div>
      <div class="check-side">
        <label class="chk"><input type="checkbox" data-startup="${esc(s.name)}"><span>désactiver</span></label>
      </div>
    </div>`).join('') : '<div class="empty">Aucun programme au démarrage détecté.</div>';

  const tasksHtml = data.tasks.length ? data.tasks.map((t) => `
    <div class="check">
      <div class="check-status s-warn"></div>
      <div class="check-body">
        <div class="check-title">${esc(t.name)}</div>
        <div class="check-meta"><span><b>Chemin :</b> ${esc(t.path)}</span>${t.author?`<span><b>Éditeur :</b> ${esc(t.author)}</span>`:''}</div>
      </div>
      <div class="check-side">
        <label class="chk"><input type="checkbox" data-task="${esc(t.name)}" data-taskpath="${esc(t.path)}"><span>désactiver</span></label>
      </div>
    </div>`).join('') : '<div class="empty">Aucune tâche planifiée non-Microsoft active.</div>';

  const servicesHtml = data.services.length ? data.services.map((s) => `
    <div class="check">
      <div class="check-status s-warn"></div>
      <div class="check-body">
        <div class="check-title">${esc(s.display || s.name)}</div>
        <div class="check-meta"><span><b>Nom :</b> ${esc(s.name)}</span><span><b>Démarrage :</b> ${esc(s.startMode)}</span></div>
      </div>
      <div class="check-side">
        <label class="chk"><input type="checkbox" data-service="${esc(s.name)}"><span>désactiver</span></label>
      </div>
    </div>`).join('') : '<div class="empty">Aucun service non-Microsoft en cours.</div>';

  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-accent btn-sm" id="su-apply">Appliquer les désactivations sélectionnées (admin)</button>
      <span style="color:var(--text-dim);font-size:12px">Ne désactive que ce que tu reconnais comme inutile.</span>
    </div>
    <span class="eyebrow">Surface d'attaque</span>
    ${surfaceHtml}
    <div style="height:20px"></div>
    <span class="eyebrow">Programmes au démarrage (${data.startup.length})</span>
    ${startupHtml}
    <div style="height:20px"></div>
    <span class="eyebrow">Tâches planifiées non-Microsoft (${data.tasks.length})</span>
    ${tasksHtml}
    <div style="height:20px"></div>
    <span class="eyebrow">Services non-Microsoft actifs (${data.services.length})</span>
    ${servicesHtml}`;

  body.querySelector('#su-apply').onclick = async () => {
    const startupNames = Array.from(body.querySelectorAll('input[data-startup]:checked')).map((i) => i.dataset.startup);
    const taskItems = Array.from(body.querySelectorAll('input[data-task]:checked')).map((i) => ({ name: i.dataset.task, path: i.dataset.taskpath }));
    const serviceNames = Array.from(body.querySelectorAll('input[data-service]:checked')).map((i) => i.dataset.service);
    const surfaceIds = Array.from(body.querySelectorAll('input[data-surface]:checked')).map((i) => i.dataset.surface);
    const totalSel = startupNames.length + taskItems.length + serviceNames.length + surfaceIds.length;
    if (!totalSel) return toast('Rien de sélectionné.', 'err');

    // Compose un aperçu combiné de tous les scripts.
    const previews = [];
    if (surfaceIds.length) previews.push((await window.api.startup.previewSurface(surfaceIds)).script);
    if (startupNames.length) previews.push((await window.api.startup.previewStartup(startupNames)).script);
    if (taskItems.length) previews.push((await window.api.startup.previewTasks(taskItems)).script);
    if (serviceNames.length) previews.push((await window.api.startup.previewServices(serviceNames)).script);

    const go = await confirmAction({
      title: 'Désactiver au démarrage / en service',
      desc: `${totalSel} élément(s) seront désactivés. Droits administrateur requis. Réactivables manuellement dans Windows.`,
      script: previews.join('\n\n'), elevated: true,
    });
    if (!go) return;
    toast('Application… (UAC requis)');
    // Exécute séquentiellement (chaque appel peut demander l'élévation).
    let allOk = true, errs = [];
    if (surfaceIds.length) { const r = await window.api.startup.fixSurface(surfaceIds); if (!r.ok) { allOk = false; errs.push(r.stderr); } }
    if (startupNames.length) { const r = await window.api.startup.disableStartup(startupNames); if (!r.ok) { allOk = false; errs.push(r.stderr); } }
    if (taskItems.length) { const r = await window.api.startup.disableTasks(taskItems); if (!r.ok) { allOk = false; errs.push(r.stderr); } }
    if (serviceNames.length) { const r = await window.api.startup.disableServices(serviceNames); if (!r.ok) { allOk = false; errs.push(r.stderr); } }
    toast(allOk ? 'Désactivations appliquées ✓' : 'Partiel / échec : ' + errs.filter(Boolean).join(' ; '), allOk ? 'ok' : 'err');
    if (allOk) renderStartup();
  };
}

// ---------- Vue : Métadonnées photos (EXIF GPS) ----------
async function renderExif() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Confidentialité des fichiers</span>
      <h1>Métadonnées photos (GPS)</h1>
      <p>Tes photos peuvent contenir les coordonnées GPS exactes du lieu de prise de vue. Avant de les partager, repère et efface ces métadonnées. Tout se passe en local — aucune image n'est envoyée.</p>
    </div>
    <div class="pw-field">
      <div class="check-title">Choisir un dossier à analyser</div>
      <div class="check-detail">Sélectionne un dossier (ex. tes Images). L'analyse est récursive, jusqu'à 500 photos.</div>
      <div class="pw-input-row">
        <input type="text" id="exif-folder" placeholder="Aucun dossier sélectionné" readonly style="cursor:default">
        <button class="btn" id="exif-pick">Parcourir…</button>
        <button class="btn btn-accent" id="exif-scan" disabled>Analyser</button>
      </div>
      <div class="privacy-note"><span>🔒</span><span>L'analyse lit uniquement les métadonnées (pas le contenu visuel) et ne quitte jamais ton ordinateur.</span></div>
    </div>
    <div id="exif-results"></div>`;

  let folder = null;
  const folderInput = document.getElementById('exif-folder');
  const scanBtn = document.getElementById('exif-scan');
  const results = document.getElementById('exif-results');

  // Restaure le dernier dossier analysé (préférence persistée).
  window.api.prefs.get().then((p) => {
    if (p && p.exifFolder) { folder = p.exifFolder; folderInput.value = p.exifFolder; scanBtn.disabled = false; }
  });

  document.getElementById('exif-pick').onclick = async () => {
    const picked = await window.api.exif.pickFolder();
    if (picked) { folder = picked; folderInput.value = picked; scanBtn.disabled = false; window.api.prefs.set({ exifFolder: picked }); }
  };

  scanBtn.onclick = async () => {
    if (!folder) return;
    results.innerHTML = loading('Analyse des métadonnées…');
    const data = await window.api.exif.scan(folder);
    if (data.error) { results.innerHTML = `<div class="empty">Erreur : ${esc(data.error)}</div>`; return; }
    if (!data.images.length) {
      results.innerHTML = `<div class="privacy-note" style="background:var(--ok-bg);color:var(--ok)"><span>✓</span><span>${data.scanned} image(s) analysée(s), aucune coordonnée GPS trouvée. Rien à nettoyer.</span></div>`;
      return;
    }
    results.innerHTML = `
      <div class="action-bar">
        <button class="btn btn-sm" id="exif-selectall">Tout cocher</button>
        <button class="btn btn-accent btn-sm" id="exif-strip">Effacer le GPS des images cochées</button>
        <span style="color:var(--text-dim);font-size:12px">${data.images.length} image(s) avec GPS sur ${data.scanned} analysées.</span>
      </div>
      ${data.images.map((im) => `
        <div class="check">
          <div class="check-status s-warn"></div>
          <div class="check-body">
            <div class="check-title">${esc(im.name)}</div>
            <div class="check-detail" style="font-family:var(--mono);font-size:11px;color:var(--text-faint);word-break:break-all">${esc(im.path)}</div>
          </div>
          <div class="check-side">
            <label class="chk"><input type="checkbox" data-img="${esc(im.path)}" checked><span>nettoyer</span></label>
          </div>
        </div>`).join('')}`;

    results.querySelector('#exif-selectall').onclick = () => {
      const boxes = results.querySelectorAll('input[data-img]');
      const all = Array.from(boxes).every((b) => b.checked);
      boxes.forEach((b) => { b.checked = !all; });
    };
    results.querySelector('#exif-strip').onclick = async () => {
      const paths = Array.from(results.querySelectorAll('input[data-img]:checked')).map((i) => i.dataset.img);
      if (!paths.length) return toast('Aucune image sélectionnée.', 'err');
      const go = await confirmAction({
        title: 'Effacer les métadonnées GPS',
        desc: `${paths.length} image(s) seront réenregistrées sans coordonnées GPS. Cette opération modifie les fichiers directement.`,
        script: paths.slice(0, 20).join('\n') + (paths.length > 20 ? `\n… (+${paths.length - 20})` : ''),
        elevated: false,
      });
      if (!go) return;
      toast('Nettoyage en cours…');
      const res = await window.api.exif.strip(paths);
      toast(res.ok ? `${res.done} image(s) nettoyée(s) ✓` : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
      if (res.ok) scanBtn.onclick();
    };
  };
}

// ---------- Vue : Réseau domestique ----------
async function renderHomeNetwork() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Exposition réseau</span>
      <h1>Réseau domestique</h1>
      <p>VPN, ports exposés, UPnP et test de fuite d'IP. Le test d'IP publique est le seul élément qui contacte un service externe — et uniquement quand tu le déclenches.</p>
    </div>
    <div id="hn-body">${loading('Analyse du réseau…')}</div>`;

  const data = await window.api.audit.homenetwork();
  const body = document.getElementById('hn-body');

  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-accent btn-sm" id="hn-fix">Corriger la sélection (admin)</button>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="hn-ipleak">🌐 Tester la fuite d'IP</button>
    </div>
    <div id="hn-leak"></div>
    ${data.checks.map((c) => {
      const dot = c.status === 'ok' ? 's-ok' : c.status === 'info' ? 's-ok' : 's-warn';
      return `
      <div class="check">
        <div class="check-status ${dot}"></div>
        <div class="check-body">
          <div class="check-title">${esc(c.label)}</div>
          <div class="check-detail">${esc(c.detail)}</div>
          <div class="check-meta"><span><b>État :</b> <span class="${c.status==='ok'?'val-ok':(c.status==='info'?'':'val-current')}">${esc(c.current)}</span></span></div>
        </div>
        <div class="check-side">
          <span class="pill pill-${c.risk}">${c.risk==='high'?'risque élevé':c.risk==='medium'?'risque moyen':'risque faible'}</span>
          ${c.fixable ? `<label class="chk"><input type="checkbox" data-fix="${esc(c.id)}" checked><span>corriger</span></label>` : (c.status==='warn'?'<span style="color:var(--text-faint);font-size:11px">manuel</span>':'<span style="color:var(--ok);font-size:11.5px">✓ OK</span>')}
        </div>
      </div>`;
    }).join('')}`;

  body.querySelector('#hn-ipleak').onclick = async () => {
    const leakEl = body.querySelector('#hn-leak');
    leakEl.innerHTML = loading('Récupération de l\'IP publique…');
    const r = await window.api.homenetwork.ipLeak();
    // On masque partiellement l'IP publique par prudence (affichage).
    const masked = r.publicIp && r.publicIp !== 'Indisponible'
      ? r.publicIp.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.•••.•••') : r.publicIp;
    leakEl.innerHTML = `
      <div class="pw-field" style="margin-bottom:12px">
        <div class="check-title">Résultat du test de fuite</div>
        <div class="check-meta" style="margin-top:8px">
          <span><b>IP publique :</b> <span style="font-family:var(--mono)">${esc(masked)}</span></span>
          <span><b>VPN :</b> ${r.vpnActive ? '<span style="color:var(--ok)">actif</span>' : '<span style="color:var(--warn)">inactif</span>'}</span>
        </div>
        <div class="check-detail" style="margin-top:8px">${r.vpnActive
          ? 'Un VPN est actif : ton IP réelle est masquée pour les sites que tu visites.'
          : 'Aucun VPN : ton IP publique ci-dessus est visible par tous les sites et ton FAI voit ton trafic.'}</div>
        <div class="privacy-note" style="margin-top:10px"><span>🔒</span><span>L'IP est affichée partiellement masquée. Ce test a contacté un service externe (ipify) uniquement pour cette vérification.</span></div>
      </div>`;
  };

  body.querySelector('#hn-fix').onclick = async () => {
    const ids = Array.from(body.querySelectorAll('input[data-fix]:checked')).map((i) => i.dataset.fix);
    if (!ids.length) return toast('Aucune correction sélectionnée.', 'err');
    if (ids.includes('upnp')) {
      const preview = await window.api.homenetwork.previewUpnp();
      const go = await confirmAction({
        title: 'Désactiver UPnP',
        desc: 'Les services UPnP (SSDP, Hôte de périphérique UPnP) seront arrêtés et désactivés. Droits admin requis.',
        script: preview.script, elevated: true,
      });
      if (!go) return;
      toast('Application… (UAC requis)');
      const res = await window.api.homenetwork.disableUpnp();
      toast(res.ok ? 'UPnP désactivé ✓' : 'Échec / annulé : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
      if (res.ok) renderHomeNetwork();
    }
  };
}

// ---------- Vue : Diff post-Windows Update ----------
async function renderSnapshot() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Suivi des mises à jour</span>
      <h1>Diff post-Windows Update</h1>
      <p>Windows réactive souvent des réglages de confidentialité après une mise à jour majeure. Enregistre un instantané de ton état actuel, puis compare après chaque MAJ pour repérer ce qui a été réactivé.</p>
    </div>
    <div id="snap-body">${loading('Chargement…')}</div>`;

  const body = document.getElementById('snap-body');
  const [snap, diff] = await Promise.all([window.api.snapshot.get(), window.api.snapshot.compare()]);

  const buildLine = diff.hasPrevious
    ? `${esc(diff.currentBuild.displayVersion)} · build ${esc(diff.currentBuild.build)}`
    : '';

  let diffHtml = '';
  if (!diff.hasPrevious) {
    diffHtml = '<div class="empty">Aucun instantané enregistré. Enregistre-en un maintenant pour pouvoir comparer après ta prochaine mise à jour Windows.</div>';
  } else {
    const buildBadge = diff.buildChanged
      ? `<div class="privacy-note" style="background:var(--warn-bg);color:var(--warn);margin-bottom:14px"><span>🔄</span><span>Le build Windows a changé depuis l'instantané (${esc(diff.prevBuild.build)} → ${esc(diff.currentBuild.build)}). Une mise à jour a eu lieu.</span></div>`
      : `<div class="privacy-note" style="background:var(--ok-bg);color:var(--ok);margin-bottom:14px"><span>✓</span><span>Même build Windows qu'à l'instantané (${esc(diff.currentBuild.build)}).</span></div>`;
    const regHtml = diff.regressions.length
      ? diff.regressions.map((r) => `
        <div class="check">
          <div class="check-status s-crit"></div>
          <div class="check-body">
            <div class="check-title">${esc(r.label)}</div>
            <div class="check-meta"><span><b>Avant :</b> <span class="val-ok">${esc(r.before)}</span></span><span><b>Maintenant :</b> <span class="val-current">${esc(r.after)}</span></span></div>
          </div>
          <div class="check-side"><span class="pill pill-high">réactivé</span></div>
        </div>`).join('')
      : '<div class="privacy-note" style="background:var(--ok-bg);color:var(--ok)"><span>✓</span><span>Aucun réglage durci n\'a été réactivé depuis l\'instantané.</span></div>';
    diffHtml = `${buildBadge}
      <span class="eyebrow">Réglages réactivés (${diff.regressions.length})</span>
      ${regHtml}
      <p style="color:var(--text-faint);font-size:11.5px;margin-top:14px">Instantané du ${new Date(diff.prevTs).toLocaleString('fr-FR')}${diff.improvements.length ? ` · ${diff.improvements.length} réglage(s) améliorés depuis` : ''}.</p>`;
  }

  body.innerHTML = `
    <div class="action-bar">
      <button class="btn btn-accent btn-sm" id="snap-take">📸 Enregistrer un instantané maintenant</button>
      ${snap ? `<span style="color:var(--text-dim);font-size:12px">Dernier : ${new Date(snap.ts).toLocaleString('fr-FR')}</span>` : ''}
    </div>
    ${buildLine ? `<p style="font-family:var(--mono);font-size:12px;color:var(--text-faint);margin-bottom:16px">Windows ${buildLine}</p>` : ''}
    ${diffHtml}`;

  body.querySelector('#snap-take').onclick = async () => {
    toast('Enregistrement de l\'instantané…');
    await window.api.snapshot.take();
    toast('Instantané enregistré ✓', 'ok');
    renderSnapshot();
  };
}

// ---------- Vue : Surveillance (automatisation planifiée) ----------
async function renderSchedule() {
  container.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">Automatisation</span>
      <h1>Surveillance périodique</h1>
      <p>Programme une analyse automatique récurrente. Si un réglage de confidentialité est réactivé (souvent après une mise à jour Windows), tu reçois une notification. ITWasher reste aussi accessible depuis la barre système.</p>
    </div>
    <div id="sch-body">${loading('Vérification de la tâche planifiée…')}</div>`;

  const body = document.getElementById('sch-body');
  const st = await window.api.schedule.status();

  const freqLabel = { daily: 'quotidienne', weekly: 'hebdomadaire', monthly: 'mensuelle' };
  body.innerHTML = `
    <div class="guide">
      <h3><span style="color:var(--accent)">⏰</span> État de la surveillance</h3>
      <div class="g-detail">${st.exists
        ? `Surveillance <b style="color:var(--ok)">active</b> — fréquence ${esc(freqLabel[st.frequency] || st.frequency)}, état : ${esc(st.state)}.`
        : 'Aucune surveillance planifiée pour l\'instant.'}</div>
      <div class="check-meta" style="margin-bottom:14px">
        <span><b>Comment ça marche :</b> une tâche planifiée Windows lance ITWasher en arrière-plan et compare ton état à l'instantané enregistré. Notification uniquement en cas de régression.</span>
      </div>
      ${st.exists
        ? `<button class="btn btn-sm" id="sch-remove">Désactiver la surveillance</button>`
        : `<div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-accent" data-freq="weekly">Activer (hebdomadaire)</button>
            <button class="btn btn-sm" data-freq="daily">Quotidienne</button>
            <button class="btn btn-sm" data-freq="monthly">Mensuelle</button>
          </div>`}
    </div>
    <div class="privacy-note"><span>ℹ️</span><span>La surveillance nécessite un instantané de référence (onglet « Diff post-Update »). Pense à en enregistrer un après avoir durci tes réglages.</span></div>`;

  body.querySelectorAll('[data-freq]').forEach((btn) => {
    btn.onclick = async () => {
      toast('Création de la tâche planifiée…');
      const res = await window.api.schedule.create(btn.dataset.freq);
      toast(res.ok ? 'Surveillance activée ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
      if (res.ok) renderSchedule();
    };
  });
  const rm = body.querySelector('#sch-remove');
  if (rm) rm.onclick = async () => {
    const res = await window.api.schedule.remove();
    toast(res.ok ? 'Surveillance désactivée ✓' : 'Échec : ' + (res.stderr || ''), res.ok ? 'ok' : 'err');
    if (res.ok) renderSchedule();
  };
}

// ---------- Boot ----------
// Le bouton du rail « Tout auditer » relance une analyse complète immédiatement.
document.getElementById('scanAll').addEventListener('click', async () => {
  state.telemetry = state.apps = state.browsers = state.network = state.windows11 = null;
  state.dashboardDone = false;
  navigate('dashboard');
  // Déclenche l'analyse (le rail est un raccourci explicite = clic utilisateur).
  await runFullAudit();
});

// Depuis le menu de la barre système : lancer une analyse.
if (window.api.onTrayScan) {
  window.api.onTrayScan(() => {
    state.dashboardDone = false;
    navigate('dashboard');
    runFullAudit();
  });
}

// Au démarrage : on affiche le tableau de bord en état INACTIF. Aucune analyse
// n'est lancée tant que l'utilisateur ne clique pas sur un bouton.
navigate('dashboard');

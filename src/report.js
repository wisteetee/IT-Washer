'use strict';
// Génère un rapport d'audit HTML autonome et horodaté.
// Le HTML est imprimable en PDF via Electron (printToPDF côté main).

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function statusDot(status) {
  const color = status === 'ok' ? '#16a34a' : status === 'crit' ? '#dc2626' : '#d97706';
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:8px"></span>`;
}

// data = { score, verdict, generatedAt, sections: [{ title, rows: [{label, detail, current, recommended, status}] }] }
function buildHtml(data) {
  const date = new Date(data.generatedAt || Date.now());
  const dateStr = date.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const scoreColor = data.score >= 75 ? '#16a34a' : data.score >= 45 ? '#d97706' : '#dc2626';

  const sections = (data.sections || []).map((s) => `
    <section>
      <h2>${esc(s.title)}</h2>
      ${(s.rows || []).map((r) => `
        <div class="row">
          <div class="row-main">
            <div class="row-label">${statusDot(r.status)}${esc(r.label)}</div>
            ${r.detail ? `<div class="row-detail">${esc(r.detail)}</div>` : ''}
          </div>
          <div class="row-vals">
            ${r.current != null ? `<span class="val"><b>Actuel</b> ${esc(r.current)}</span>` : ''}
            ${r.recommended != null ? `<span class="val"><b>Recommandé</b> ${esc(r.recommended)}</span>` : ''}
          </div>
        </div>`).join('')}
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Rapport ITWasher — ${esc(dateStr)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c2530; padding: 40px; font-size: 13px; line-height: 1.5; }
  header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #17877d; padding-bottom: 20px; margin-bottom: 24px; }
  .logo { font-size: 34px; color: #17877d; }
  h1 { font-size: 22px; letter-spacing: .5px; }
  .sub { color: #5a6673; font-size: 12px; margin-top: 2px; }
  .score-box { margin-left: auto; text-align: center; }
  .score-num { font-size: 42px; font-weight: 700; color: ${scoreColor}; line-height: 1; }
  .score-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #8b97a6; }
  .verdict { font-size: 14px; font-weight: 600; color: ${scoreColor}; margin-top: 4px; }
  section { margin-bottom: 22px; break-inside: avoid; }
  h2 { font-size: 15px; color: #17877d; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #e0e5ea; }
  .row { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #f0f2f5; break-inside: avoid; }
  .row-main { flex: 1; }
  .row-label { font-weight: 600; }
  .row-detail { color: #5a6673; font-size: 11.5px; margin-top: 2px; margin-left: 17px; }
  .row-vals { display: flex; flex-direction: column; gap: 3px; text-align: right; min-width: 180px; }
  .val { font-size: 11px; color: #5a6673; }
  .val b { color: #8b97a6; font-weight: 600; margin-right: 4px; text-transform: uppercase; font-size: 9.5px; }
  footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e0e5ea; color: #8b97a6; font-size: 11px; }
</style></head>
<body>
  <header>
    <div class="logo">◈</div>
    <div>
      <h1>ITWasher — Rapport d'audit</h1>
      <div class="sub">Hygiène informatique · vie privée &amp; sécurité Windows</div>
    </div>
    <div class="score-box">
      <div class="score-num">${data.score}<span style="font-size:16px;color:#8b97a6">/100</span></div>
      <div class="score-lbl">Score</div>
      <div class="verdict">${esc(data.verdict || '')}</div>
    </div>
  </header>
  <p class="sub" style="margin-bottom:20px">Généré le ${esc(dateStr)}</p>
  ${sections}
  <footer>
    Rapport généré localement par ITWasher. Aucune donnée n'a été transmise à un tiers.
    Les recommandations sont indicatives ; chaque action reste sous ton contrôle.
  </footer>
</body></html>`;
}

module.exports = { buildHtml };

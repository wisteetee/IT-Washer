'use strict';
// Module Profils : applique un ensemble cohérent de réglages en un clic.
// Agrège les checks "registre" de plusieurs modules (télémétrie, windows11)
// selon 3 niveaux cumulatifs.
const telemetry = require('./telemetry');
const windows11 = require('./windows11');

const REGISTRY_MODULES = [telemetry, windows11];

const PROFILES = [
  {
    id: 'basic',
    label: 'Basique',
    detail: "Coupe la publicité ciblée et les suggestions, sans aucun impact fonctionnel. Idéal pour tout le monde.",
    tone: 'ok',
  },
  {
    id: 'balanced',
    label: 'Équilibré',
    detail: "Ajoute la réduction de télémétrie, l'historique d'activités et le suivi d'usage. Bon compromis vie privée / confort.",
    tone: 'accent',
  },
  {
    id: 'paranoid',
    label: 'Parano',
    detail: "Durcissement maximal : localisation, Cortana, presse-papiers, Wi-Fi Sense. Peut désactiver des fonctions pratiques.",
    tone: 'warn',
  },
];

// Construit, pour un profil donné, la liste des remédiations par module + un
// script combiné et la liste des cibles registre (pour le rollback).
function planFor(profileId) {
  const plan = { profileId, modules: [], targets: [], scripts: [], needsElevation: false };
  for (const mod of REGISTRY_MODULES) {
    const ids = mod.idsForProfile(profileId);
    if (!ids.length) continue;
    const { script, needsElevation } = mod.buildRemediation(ids);
    plan.modules.push({ moduleId: mod.id, label: mod.label, ids });
    plan.targets.push(...mod.targetsFor(ids));
    if (script.trim()) plan.scripts.push(`# --- ${mod.label} ---\n${script}`);
    if (needsElevation) plan.needsElevation = true;
  }
  plan.script = plan.scripts.join('\n\n');
  return plan;
}

// Audite l'état actuel vis-à-vis d'un profil : combien de réglages déjà conformes.
async function auditProfile(profileId) {
  let total = 0, done = 0;
  for (const mod of REGISTRY_MODULES) {
    const ids = mod.idsForProfile(profileId);
    if (!ids.length) continue;
    const results = await mod.audit();
    for (const r of results) {
      if (ids.includes(r.id)) { total++; if (r.status === 'ok') done++; }
    }
  }
  return { total, done };
}

module.exports = { PROFILES, planFor, auditProfile };

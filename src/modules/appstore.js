'use strict';
// Module Installation d'applications recommandées (via Winget).
// Complète l'audit « Applications » : quand ITWasher signale une app intrusive,
// ce module permet d'installer l'alternative respectueuse en un clic.
// Catalogue trié par catégorie, uniquement des logiciels libres/respectueux.
const { runPowerShell } = require('../ps');

// Catalogue d'alternatives. `id` = identifiant Winget exact.
const CATALOG = [
  // --- Navigateurs ---
  { cat: 'Navigateurs', id: 'Brave.Brave', name: 'Brave', detail: "Navigateur Chromium avec blocage pubs/traqueurs intégré.", replaces: 'Google Chrome' },
  { cat: 'Navigateurs', id: 'Mozilla.Firefox', name: 'Mozilla Firefox', detail: "Navigateur indépendant, respecte uBlock Origin sans le brider.", replaces: 'Google Chrome, Edge' },
  { cat: 'Navigateurs', id: 'Mozilla.Firefox.ESR', name: 'Firefox ESR', detail: "Version à support étendu, plus stable.", replaces: '' },

  // --- Sécurité & vie privée ---
  { cat: 'Sécurité & vie privée', id: 'Bitwarden.Bitwarden', name: 'Bitwarden', detail: "Gestionnaire de mots de passe libre, chiffré de bout en bout.", replaces: 'mots de passe du navigateur' },
  { cat: 'Sécurité & vie privée', id: 'KeePassXCTeam.KeePassXC', name: 'KeePassXC', detail: "Gestionnaire de mots de passe 100 % local (aucun cloud).", replaces: '' },
  { cat: 'Sécurité & vie privée', id: 'AgileBits.1Password', name: '1Password', detail: "Gestionnaire de mots de passe commercial réputé.", replaces: '' },
  { cat: 'Sécurité & vie privée', id: 'Cryptomator.Cryptomator', name: 'Cryptomator', detail: "Chiffre tes fichiers avant envoi vers un cloud.", replaces: '' },
  { cat: 'Sécurité & vie privée', id: 'VeraCrypt.VeraCrypt', name: 'VeraCrypt', detail: "Chiffrement de disques et conteneurs, libre.", replaces: '' },

  // --- Communication ---
  { cat: 'Communication', id: 'OpenWhisperSystems.Signal', name: 'Signal', detail: "Messagerie chiffrée de bout en bout, sans collecte de métadonnées.", replaces: 'WhatsApp, Messenger' },
  { cat: 'Communication', id: 'Element.Element', name: 'Element (Matrix)', detail: "Messagerie décentralisée et chiffrée.", replaces: 'Discord, Slack' },
  { cat: 'Communication', id: 'ProtonTechnologies.ProtonMailBridge', name: 'Proton Mail Bridge', detail: "Relie Proton Mail à ton client mail habituel.", replaces: '' },

  // --- Bureautique & documents ---
  { cat: 'Bureautique & documents', id: 'TheDocumentFoundation.LibreOffice', name: 'LibreOffice', detail: "Suite bureautique libre et complète.", replaces: 'Microsoft Office' },
  { cat: 'Bureautique & documents', id: 'SumatraPDF.SumatraPDF', name: 'SumatraPDF', detail: "Lecteur PDF ultra-léger, sans télémétrie.", replaces: 'Adobe Reader' },
  { cat: 'Bureautique & documents', id: 'Joplin.Joplin', name: 'Joplin', detail: "Prise de notes chiffrée, synchronisation au choix.", replaces: 'OneNote, Evernote' },

  // --- Multimédia ---
  { cat: 'Multimédia', id: 'VideoLAN.VLC', name: 'VLC', detail: "Lecteur multimédia universel, libre.", replaces: 'Films et TV, Groove' },
  { cat: 'Multimédia', id: 'GIMP.GIMP', name: 'GIMP', detail: "Éditeur d'images libre.", replaces: 'Photoshop' },
  { cat: 'Multimédia', id: 'Audacity.Audacity', name: 'Audacity', detail: "Éditeur audio libre.", replaces: '' },

  // --- Utilitaires ---
  { cat: 'Utilitaires', id: '7zip.7zip', name: '7-Zip', detail: "Archiveur libre, meilleure compression que l'outil Windows.", replaces: 'WinRAR' },
  { cat: 'Utilitaires', id: 'BleachBit.BleachBit', name: 'BleachBit', detail: "Nettoyage disque et traces, libre.", replaces: 'CCleaner' },
  { cat: 'Utilitaires', id: 'Notepad++.Notepad++', name: 'Notepad++', detail: "Éditeur de texte avancé.", replaces: '' },
  { cat: 'Utilitaires', id: 'ShareX.ShareX', name: 'ShareX', detail: "Capture d'écran et partage, libre.", replaces: '' },
];

// Liste les catégories dans l'ordre d'apparition du catalogue.
function categories() {
  const seen = [];
  for (const a of CATALOG) if (!seen.includes(a.cat)) seen.push(a.cat);
  return seen;
}

// Vérifie la disponibilité de Winget et quelles apps du catalogue sont installées.
async function audit() {
  const ver = await runPowerShell(
    `try { (winget --version) } catch { 'ABSENT' }`, { timeout: 25000 });
  const wingetVersion = ver.stdout.trim();
  const available = wingetVersion && !wingetVersion.includes('ABSENT');

  let installedIds = [];
  if (available) {
    // Un seul appel : liste tout, on croise avec le catalogue localement.
    const res = await runPowerShell(
      `winget list --accept-source-agreements --disable-interactivity 2>$null | Out-String`,
      { timeout: 90000 });
    const out = res.stdout || '';
    const lower = out.toLowerCase();
    // On croise sur l'ID winget ET sur le nom : une même app peut être installée
    // via une autre source (Microsoft Store, installeur classique) avec un ID différent.
    installedIds = CATALOG
      .filter((a) => out.includes(a.id) || lower.includes(a.name.toLowerCase()))
      .map((a) => a.id);
  }

  return {
    available,
    wingetVersion: available ? wingetVersion : null,
    categories: categories(),
    apps: CATALOG.map((a) => ({ ...a, installed: installedIds.includes(a.id) })),
  };
}

// Construit la commande d'installation (winget install pour chaque id).
// Winget gère lui-même l'élévation si nécessaire (prompt UAC par paquet).
function buildInstall(ids) {
  const lines = ids.map((id) => {
    const safe = id.replace(/'/g, "''");
    return `winget install --id '${safe}' --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`;
  });
  return { script: lines.join('\n'), needsElevation: true };
}

// Construit la commande de désinstallation.
function buildUninstall(ids) {
  const lines = ids.map((id) => {
    const safe = id.replace(/'/g, "''");
    return `winget uninstall --id '${safe}' --exact --silent --disable-interactivity`;
  });
  return { script: lines.join('\n'), needsElevation: true };
}

module.exports = { id: 'appstore', label: 'Installer des apps', audit, buildInstall, buildUninstall, CATALOG };

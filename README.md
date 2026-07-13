# ITWasher

Application de bureau (Electron) pour **auditer et durcir la confidentialité et la sécurité de Windows**. Elle inspecte ton système, calcule un score d'hygiène, et applique **uniquement les changements que tu confirmes** — chaque action affiche la commande PowerShell exacte avant exécution.

> Windows uniquement. Aucune donnée n'est envoyée à un tiers : tout l'audit est local.

## Principes de sécurité

- **Rien n'est modifié sans ta confirmation.** Chaque action affiche le script PowerShell exact qui sera exécuté.
- **Réversible.** Les durcissements registre ont un bouton « Restaurer » ; un **Journal** horodaté permet d'annuler une action précise sans toucher au reste du système.
- **Point de restauration** système créable avant toute écriture registre.
- **Élévation à la demande.** Les modifications système (HKLM, réseau, services) déclenchent une invite UAC ; les réglages utilisateur (HKCU) non.
- **Ton mot de passe ne quitte jamais la machine** (module Fuites) : protocole k-anonymity (Pwned Passwords), seuls 5 caractères de l'empreinte SHA-1 sont envoyés.
- Interface isolée (`contextIsolation`, `nodeIntegration: false`), CSP stricte sur les scripts.

## Démarrer

```powershell
npm install
npm start
```

## Construire un exécutable Windows

```powershell
npm run dist
```

Génère un dossier autonome `dist/ITWasher-win32-x64/` contenant `ITWasher.exe` (lançable sans Node).

## Modules

| Module | Ce qu'il fait |
|--------|---------------|
| **Tableau de bord** | Score d'hygiène global (analyse déclenchée par bouton) + vue par domaine + export du rapport. |
| **Profils** | Applique un ensemble cohérent de réglages en un clic : Basique / Équilibré / Parano. |
| **Télémétrie Windows** | Durcit : niveau de télémétrie, ID publicitaire, historique d'activités, Cortana, pubs Démarrer, suivi d'usage, localisation, Wi-Fi Sense. Réversible. |
| **Nouveautés Windows 11** | Recall (capture IA), Copilot, Widgets, presse-papiers cloud/historique. |
| **Applications** | Liste les apps installées, signale les intrusives (Chrome→Brave, CCleaner, Avast…) et le bloatware (désinstallable en un clic). |
| **Démarrage & services** | Programmes au démarrage, tâches planifiées et services non-Microsoft, surface d'attaque (RDP, SMBv1, partages). |
| **Navigateurs & consentements** | Navigateurs détectés, réglages anti-tracking, checklist guidée (Utiq, Google/Microsoft Ads, Your Online Choices). |
| **Fuites de données** | Vérifie si un mot de passe a fuité via Pwned Passwords (k-anonymity). |
| **Métadonnées photos** | Repère les photos contenant des coordonnées GPS et les efface en un clic. 100 % local. |
| **Réseau & sécurité** | Pare-feu, DNS chiffré (DoH → Quad9), BitLocker, mises à jour, compte administrateur intégré. |
| **Comptes Windows** | Audit multi-utilisateurs : local vs Microsoft, sans mot de passe, droits admin. |
| **Historique** | Évolution du score d'hygiène dans le temps. |
| **Journal & annulation** | Chaque action réversible enregistre l'état avant modification, pour annulation ciblée. |

## Ce qui reste manuel (par nature)

- **Utiq** et autres consentements publicitaires : gérés sur des portails web tiers, l'app t'y guide pas à pas.
- Réglages profil-par-profil des navigateurs.
- Toute action nécessitant tes identifiants.

## Architecture

```
src/
  main.js         process principal Electron + handlers IPC
  preload.js      pont sécurisé (contextIsolation)
  ps.js           exécuteur PowerShell (normal + élévation UAC)
  store.js        stockage local (historique, préférences)
  rollback.js     journal d'annulation horodaté
  restore.js      points de restauration système
  report.js       génération du rapport HTML/PDF
  modules/        un module par domaine (audit + remédiation)
  renderer/       interface (HTML/CSS/JS, sans dépendance front)
```

Les scripts de remédiation sont construits côté processus principal à partir de définitions versionnées, jamais par concaténation de chaînes venant de l'interface.

## Licence

MIT

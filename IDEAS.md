# ITWasher — Backlog des idées

Liste évolutive des modules et fonctionnalités à ajouter. Pour chaque piste :
**Faisabilité** (auto = automatisable, guidé = action manuelle assistée, mixte),
**Risque**, et notes techniques honnêtes (limites Windows incluses).

Légende faisabilité : 🟢 auto fiable · 🟡 auto avec réserves · 🔵 audit seul (pas d'action auto) · ⚪ guidé/manuel

## ✅ Déjà implémenté (session du 2026-07-13)

- **Profils Basique / Équilibré / Parano** — application groupée en un clic (module `profiles.js`, vue Profils). Testé.
- **Rollback horodaté ciblé** — chaque action capture l'état registre AVANT, annulation d'une action précise sans restauration globale (`rollback.js` + `store.js`, vue Journal). Cycle snapshot→apply→undo validé de bout en bout.
- **Historique du score** — score horodaté à chaque audit + graphique d'évolution (vue Historique). Validé en prod (`score-history.json`).
- **Export rapport PDF / HTML** — rapport horodaté via `printToPDF` Electron (`report.js`, boutons du tableau de bord).
- **Module Nouveautés Windows 11** — Recall, Copilot, Widgets, presse-papiers cloud/historique (`windows11.js`, vue dédiée). Testé.
- **Module Comptes Windows** — audit multi-utilisateurs, local vs Microsoft, sans-mdp, admin (`accounts.js`, vue Comptes). Testé.
- **Correctif encodage UTF-8** des sorties PowerShell (accents).

### 2e vague (même journée)
- **Analyse sur clic** — le tableau de bord ne lance plus l'audit au démarrage : état inactif avec bouton « Lancer l'analyse complète » + bouton « Relancer ». Le rappel du dernier score est affiché sans relancer.
- **Module Démarrage & services (Autoruns)** — `startup.js`, vue dédiée : programmes au démarrage, tâches planifiées non-MS, services non-MS actifs, surface d'attaque (RDP, SMBv1, partages). Désactivations ciblées (admin). Testé (16 startup, 8 tâches, 13 services, surface saine).
- **Module Métadonnées photos (EXIF GPS)** — `exif.js`, vue dédiée : scan récursif d'un dossier (System.Drawing), détection GPS, effacement en un clic (réécriture atomique). Scan+strip testés.
- **Rebranding** — titre fenêtre + brand = ITWasher.

### 3e vague (nouveaux modules + UX)
- **Module Réseau domestique** — `homenetwork.js`, vue dédiée : VPN actif, UPnP/SSDP (désactivable admin), découverte réseau public, ports en écoute exposés, test de fuite d'IP (appel ipify côté Node, IP masquée à l'affichage). Testé (UPnP actif détecté, 20 ports, IP publique récupérée).
- **Module Diff post-Windows Update** — `snapshot.js`, vue dédiée : capture instantané des réglages télémétrie+win11 + build Windows, comparaison pour détecter les réglages réactivés par une MAJ. Testé (build 25H2/26200, 15 états).
- **Module Surveillance planifiée** — `schedule.js`, vue dédiée : tâche planifiée Windows (quotidienne/hebdo/mensuelle) lançant `ITWasher.exe --scan`. Mode `--scan` = audit silencieux sans UI + notification si régression (testé, se ferme proprement).
- **Tray + notifications** — icône barre système (ouvrir/scanner/quitter), l'app survit à la fermeture de fenêtre si tray actif. Notification Electron en mode --scan.
- **UX** : filtre de recherche live dans la liste des apps (`.list-filter`), persistance du dernier dossier EXIF (prefs.exifFolder).

Reste à faire ci-dessous.

---

## 🆕 Nouveaux modules

### 1. Démarrage & services (façon Autoruns) — 🟢/🟡
- **Programmes au démarrage** : lisibles via `Win32_StartupCommand` + clés Run (HKCU/HKLM) + dossier Startup. Désactivation = déplacer/supprimer l'entrée. ✅ testé : 16 entrées détectables sur ce PC.
- **Tâches planifiées suspectes** : `Get-ScheduledTask` OK. Signaler celles hors Microsoft, sans éditeur, à déclencheur réseau. Désactivation `Disable-ScheduledTask`. ⚠️ certaines exigent admin.
- **Services non-Microsoft actifs** : `Get-Service` + `Get-CimInstance Win32_Service` (chemin + éditeur). Désactivation admin.
- **RDP activé sans usage** : clé `fDenyTSConnections`. ✅ Désactivé par défaut sur ce PC. Toggle admin.
- **SMBv1 (vecteur WannaCry)** : `Get-SmbServerConfiguration`. ✅ déjà désactivé ici. `Set-SmbServerConfiguration` admin.
- **Partages réseau/imprimante exposés au LAN** : `Get-SmbShare`. Audit + suppression admin.
> **Verdict** : gros module à forte valeur. Principalement admin. Le tri « suspect vs légitime » est le vrai défi (base de signatures éditeurs à maintenir).

### 2. Permissions par application — 🔵/🟡
- Windows stocke les accès caméra/micro/localisation/contacts par app sous
  `HKCU\...\CapabilityAccessManager\ConsentStore\{webcam,microphone,location,contacts...}`.
  ⚠️ Chemin par catégorie (pas un seul). Lisible : quelle app a l'accès + `LastUsedTimeStop` (dernier usage).
- **Audit « qui a accédé à quoi et quand »** : 🔵 très parlant, faisable en lecture.
- **Révocation groupée des accès inutilisés** : 🟡 possible en écrivant `Value=Deny` par app, mais fragile (Windows peut réécrire). À tester prudemment.
> **Verdict** : excellent rapport valeur/effort côté audit. La révocation auto demande des tests.

### 3. Nouveautés Windows 11 (Recall, Copilot, etc.) — 🟡
- **Recall** (capture d'écran IA périodique) : détection via feature optionnelle `Recall` + clé `DisableAIDataAnalysis`. Désactivation par GPO/registre + `Disable-WindowsOptionalFeature`. ⚠️ admin, dépend de la build Windows.
- **Copilot système** : clé `TurnOffWindowsCopilot` (HKCU/HKLM Policies). 🟢 simple.
- **Widgets** : clé `AllowNewsAndInterests` / désactivable. 🟢
- **Presse-papiers cloud** (historique persistant) : `EnableClipboardHistory` + `CloudClipboardAutomaticUpload`. Purge via `Clear-Clipboard` + clé. 🟢
> **Verdict** : très pertinent en 2026. Recall = le morceau sensible (admin + variabilité build).

### 4. Emails (Have I Been Pwned complet) — 🟡
- **Fuite par adresse email** : API HIBP `/breachedaccount`. ⚠️ **nécessite une clé API payante** (~3,95 $/mois). Sans clé : impossible (seuls les mots de passe sont gratuits, déjà fait).
- **Règles de transfert Outlook suspectes** : détectable si Outlook classique installé (profils MAPI) ou via Graph API pour comptes M365 (auth requise). ⚠️ complexe, dépend de la config mail.
> **Verdict** : le check email exige une clé API (prévoir un champ optionnel). Les règles Outlook = cas avancé, à faire plus tard.

### 5. Réseau domestique — 🟡/⚪
- **DNS leak / WebRTC leak** : 🟡 testable en interrogeant un service de test (appel réseau sortant) ; WebRTC nécessite un rendu navigateur.
- **Routeur avec identifiants par défaut** : ⚪ risqué/intrusif (scan d'auth sur la gateway) — à cadrer, plutôt un avertissement guidé.
- **UPnP actif** : détectable via la gateway (SSDP). 🟡
- **VPN actif + fuite d'IP réelle** : 🟡 comparer IP de l'interface vs IP publique vue par un service externe.
> **Verdict** : valeur réelle mais implique des appels réseau externes → à faire avec consentement clair (respect vie privée).

### 6. Fichiers & métadonnées — 🟢/🟡
- **Scan de motifs sensibles en clair** (IBAN, n° de carte, mots de passe dans .txt) : 🟡 regex locale sur Documents/Images. **Scoring uniquement, sans afficher le contenu** (comme demandé). Attention perf sur gros volumes + faux positifs.
- **EXIF GPS dans les photos** : 🟢 lecture des tags GPS, nettoyage en un clic (réécriture sans EXIF). Très concret et utile avant partage.
> **Verdict** : l'EXIF est un quick-win net. Le scan de motifs demande un cadrage strict (jamais lire à voix haute, juste alerter).

### 7. Historique & suivi dans le temps — 🟢
- **Graphique d'évolution du score** : stocker chaque audit horodaté dans un fichier local JSON → courbe.
- **Export du rapport PDF/HTML horodaté** : 🟢 génération HTML (déjà tout le CSS) → impression PDF via Electron `printToPDF`. Quick-win.
> **Verdict** : deux quick-wins à forte valeur perçue (montrer le progrès + partager).

### 8. Automatisation planifiée — 🟡
- **Scan récurrent** (hebdo/mensuel) via Planificateur de tâches Windows (`Register-ScheduledTask`). 🟢
- **Notification si le score baisse / nouvelle app intrusive** : 🟢 notification système Electron.
- **Mode surveillance system tray** : 🟡 tray Electron + watchers registre (nouvelle app, réglage confidentialité réécrit par un Update). Watchers registre = plus délicat mais faisable.
> **Verdict** : le tray + scan planifié transforment l'outil ponctuel en surveillance continue. Bon différenciateur.

### 9. Comptes Windows locaux — 🔵/🟡
- **Audit multi-utilisateurs** : `Get-LocalUser` (tous les comptes, pas juste l'actif). 🔵
- **Compte local vs compte Microsoft lié** : `PrincipalSource`. ✅ testé (0 compte MS ici). Impact confidentialité expliqué.
- **Politique de mot de passe local** : `net accounts` / `Get-LocalUser` (PasswordExpires, etc.). 🔵
> **Verdict** : audit simple et informatif. La conversion MS→local reste guidée (pas auto).

---

## 🤖 Automatisation transversale à renforcer

- **Profils « Basique / Équilibré / Parano »** — 🟢 appliquer un ensemble cohérent de réglages en un clic. Chaque check porte déjà un niveau de risque → mappable sur un profil. **Priorité haute** (change l'UX).
- **CLI / mode silencieux** — 🟢 exporter les remédiations en un `.ps1` autonome + exécution planifiée sans UI. Réutilise les `build*` existants.
- **Rollback universel horodaté** — 🟡 chaque action réversible logge (fichier JSON) l'état AVANT modif, pour annuler UNE action précise sans restaurer tout le système. Remplace avantageusement le seul point de restauration global. **Priorité haute** (sécurité + confiance).
- **Diff avant/après mise à jour Windows** — 🟡 snapshot de tous les réglages, comparaison post-Update pour détecter ce que Microsoft a réactivé. S'appuie sur l'historique (piste 7). Excellent différenciateur.

---

## Suggestions d'ordre d'implémentation

1. **Profils Basique/Équilibré/Parano** + **Rollback horodaté** (transverse, améliore tout l'existant)
2. **Export PDF/HTML** + **Historique du score** (quick-wins visibles)
3. **Nouveautés Windows 11** (Copilot/Recall/Widgets/Presse-papiers — sujet chaud, surtout 🟢)
4. **Permissions par application** (audit à forte valeur)
5. **Démarrage & services** (gros module)
6. **EXIF GPS** (quick-win concret)
7. **Comptes locaux** (audit simple)
8. **Automatisation planifiée + tray** (transforme l'outil)
9. **Réseau domestique** & **Scan de fichiers** (cadrage vie privée requis)
10. **Emails HIBP** (dépend d'une clé API payante)

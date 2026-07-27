'use strict';
// Module Centre de démarches en ligne.
// Catalogue de parcours guidés (RGPD, comptes, anti-démarchage, publicité) que
// l'utilisateur effectue lui-même sur des portails officiels. Chaque démarche a
// un bouton « Commencer » (ouvre le portail) et un suivi de progression persisté.
// Toutes les URLs sont des portails officiels ou reconnus, vérifiés.
const store = require('../store');

const PROGRESS_FILE = 'procedures-progress.json';

// Catégories affichées dans l'ordre.
const CATEGORIES = [
  { id: 'privacy', label: 'Vie privée & données', icon: '🛡️' },
  { id: 'ads', label: 'Publicité & tracking', icon: '🚫' },
  { id: 'accounts', label: 'Comptes & effacement', icon: '🗑️' },
  { id: 'antispam', label: 'Anti-démarchage', icon: '📵' },
];

// Chaque démarche : id, catégorie, titre motivant, pourquoi, temps estimé,
// impact (low/medium/high), étapes, url du bouton « Commencer ».
const PROCEDURES = [
  // --- Vie privée & données ---
  {
    id: 'gdpr-erasure',
    cat: 'privacy',
    title: "Exercer ton droit à l'effacement (RGPD)",
    why: "Toute entreprise détenant tes données doit les effacer sur simple demande. C'est un droit européen gratuit et opposable.",
    time: '15 min',
    impact: 'high',
    steps: [
      "Liste les services qui ont tes données et que tu n'utilises plus.",
      "Pour chacun, envoie un email type « droit à l'effacement RGPD » (modèle fourni par la CNIL).",
      "L'entreprise a 1 mois pour répondre et effacer.",
      "En cas de refus ou silence, dépose une plainte à la CNIL (voir la démarche dédiée).",
    ],
    url: 'https://www.cnil.fr/fr/modele/courrier/supprimer-des-donnees-personnelles',
    cta: 'Voir le modèle CNIL',
  },
  {
    id: 'cnil-complaint',
    cat: 'privacy',
    title: 'Porter plainte à la CNIL',
    why: "Si une entreprise ignore tes droits (effacement, accès, opposition), la CNIL peut la sanctionner. La plainte est gratuite et en ligne.",
    time: '10 min',
    impact: 'medium',
    steps: [
      'Rassemble les preuves (emails envoyés, captures, dates).',
      'Ouvre le service de plainte en ligne de la CNIL.',
      'Décris le manquement et joins tes preuves.',
      'La CNIL instruit et peut sanctionner le responsable.',
    ],
    url: 'https://www.cnil.fr/fr/plaintes',
    cta: 'Déposer une plainte',
  },
  {
    id: 'data-brokers',
    cat: 'privacy',
    title: 'Te retirer des courtiers en données',
    why: "Des milliers de « data brokers » revendent ton nom, adresse et habitudes. Beaucoup proposent un formulaire d'opt-out (désinscription) gratuit.",
    time: '30 min',
    impact: 'high',
    steps: [
      "Cherche ton nom sur les principaux annuaires/courtiers pour voir ce qui est exposé.",
      'Utilise leurs formulaires « opt-out » / « do not sell my info » (souvent en bas de page).',
      "Pour les courtiers européens, invoque le droit d'effacement RGPD.",
      'Refais le point tous les 6 mois : certains te re-listent.',
    ],
    url: 'https://simpleopt-out.com/',
    cta: 'Voir les opt-out',
  },
  {
    id: 'google-takeout',
    cat: 'privacy',
    title: 'Récupérer une copie de tes données Google',
    why: "Avant de nettoyer ou fermer un compte, récupère TES données. Google Takeout exporte tout (mails, photos, Drive, historique).",
    time: '10 min',
    impact: 'low',
    steps: [
      'Ouvre Google Takeout.',
      'Sélectionne les données à exporter (ou tout).',
      'Choisis le format et lance l\'export.',
      'Télécharge l\'archive quand elle est prête (email de notification).',
    ],
    url: 'https://takeout.google.com/',
    cta: 'Ouvrir Takeout',
  },

  // --- Publicité & tracking ---
  {
    id: 'google-ads-off',
    cat: 'ads',
    title: 'Couper la pub personnalisée Google',
    why: "Google construit un profil publicitaire sur toi à partir de recherches, YouTube et sites visités. Tu peux tout désactiver.",
    time: '5 min',
    impact: 'medium',
    steps: [
      'Ouvre le centre de publicité Google (My Ad Center).',
      'Désactive « Publicités personnalisées ».',
      "Va dans « Mon activité » et coupe l'activité Web et applications, YouTube et Localisation.",
    ],
    url: 'https://myadcenter.google.com/',
    cta: 'Régler chez Google',
  },
  {
    id: 'meta-ads-off',
    cat: 'ads',
    title: 'Couper le ciblage publicitaire Meta',
    why: "Facebook et Instagram te profilent même hors de leurs apps (bouton « J'aime », pixels). Le centre de comptes Meta permet de limiter ça.",
    time: '8 min',
    impact: 'medium',
    steps: [
      'Ouvre le Centre de comptes Meta.',
      "Va dans « Préférences publicitaires » → « Activité en dehors des technologies Meta ».",
      'Déconnecte l\'activité passée et refuse la future.',
    ],
    url: 'https://accountscenter.meta.com/',
    cta: 'Régler chez Meta',
  },
  {
    id: 'microsoft-ads-off',
    cat: 'ads',
    title: 'Couper la pub personnalisée Microsoft',
    why: "Ton compte Microsoft (Windows, Bing, Edge) alimente un profil publicitaire. Le tableau de bord confidentialité permet de le couper et de le vider.",
    time: '5 min',
    impact: 'medium',
    steps: [
      'Ouvre les paramètres de publicité Microsoft.',
      'Désactive les publicités personnalisées.',
      "Dans le tableau de bord de confidentialité, efface l'historique (recherche, navigation, localisation).",
    ],
    url: 'https://account.microsoft.com/privacy/ad-settings',
    cta: 'Régler chez Microsoft',
  },
  {
    id: 'youronlinechoices',
    cat: 'ads',
    title: 'Refuser les régies publicitaires (EU)',
    why: "Un portail européen permet de refuser d'un coup le suivi de dizaines de régies publicitaires membres.",
    time: '5 min',
    impact: 'medium',
    steps: [
      'Ouvre Your Online Choices.',
      'Clique sur « Tout refuser ».',
      'À refaire dans chaque navigateur (le refus est un cookie).',
    ],
    url: 'https://www.youronlinechoices.com/fr/controler-ses-cookies/',
    cta: 'Tout refuser',
  },
  {
    id: 'utiq',
    cat: 'ads',
    title: 'Désactiver Utiq (identifiant opérateur)',
    why: "Utiq est un identifiant publicitaire basé sur ta connexion opérateur (Orange, SFR, Bouygues, Free). Il te suit sans cookie et ne se coupe que sur leur portail.",
    time: '5 min',
    impact: 'high',
    steps: [
      'Ouvre le portail Utiq (Consent Hub).',
      'Identifie-toi via ta connexion mobile (données mobiles, pas Wi-Fi) ou choisis ton opérateur.',
      'Retire ton consentement pour chaque site listé.',
      'Répète sur chaque connexion : mobile ET box internet.',
    ],
    url: 'https://consenthub.utiq.com/',
    cta: 'Ouvrir Utiq',
  },

  // --- Comptes & effacement ---
  {
    id: 'delete-old-accounts',
    cat: 'accounts',
    title: 'Supprimer tes comptes inutilisés',
    why: "Chaque vieux compte est une fuite potentielle (mots de passe réutilisés, données oubliées). JustDeleteMe donne le lien de suppression direct de centaines de services.",
    time: '20 min',
    impact: 'high',
    steps: [
      'Liste les services où tu as un compte que tu n\'utilises plus.',
      'Cherche chaque service sur JustDeleteMe pour le lien de suppression.',
      'Suis le lien (JustDeleteMe indique la difficulté : facile / moyen / difficile).',
      'Récupère tes données avant si besoin (voir Google Takeout).',
    ],
    url: 'https://justdeleteme.xyz/fr',
    cta: 'Ouvrir JustDeleteMe',
  },
  {
    id: 'check-breaches',
    cat: 'accounts',
    title: 'Vérifier si tes comptes ont fuité',
    why: "Have I Been Pwned te dit dans quelles fuites de données ton adresse email apparaît, pour changer les mots de passe concernés.",
    time: '3 min',
    impact: 'high',
    steps: [
      'Ouvre Have I Been Pwned.',
      'Entre ton adresse email.',
      'Pour chaque fuite listée, change le mot de passe du service concerné.',
      'Active la double authentification (2FA) partout où c\'est possible.',
    ],
    url: 'https://haveibeenpwned.com/',
    cta: 'Vérifier mon email',
  },
  {
    id: 'password-manager',
    cat: 'accounts',
    title: 'Adopter un gestionnaire de mots de passe',
    why: "Un mot de passe unique et fort par service, sans avoir à les retenir. Bitwarden est gratuit, open-source et audité.",
    time: '30 min',
    impact: 'high',
    steps: [
      'Crée un compte Bitwarden (ou installe KeePassXC en local).',
      'Installe l\'extension navigateur + l\'app mobile.',
      'Importe tes mots de passe existants (depuis le navigateur).',
      'Remplace progressivement les mots de passe réutilisés par des uniques générés.',
    ],
    url: 'https://bitwarden.com/fr-fr/',
    cta: 'Découvrir Bitwarden',
  },

  // --- Anti-démarchage ---
  {
    id: 'bloctel',
    cat: 'antispam',
    title: 'T\'opposer au démarchage téléphonique (Bloctel)',
    why: "Bloctel est la liste d'opposition officielle du gouvernement. Une fois inscrit, les démarcheurs n'ont plus le droit de t'appeler.",
    time: '5 min',
    impact: 'high',
    steps: [
      'Ouvre le site officiel bloctel.gouv.fr.',
      'Inscris tes numéros de téléphone (jusqu\'à 10).',
      'Confirme via l\'email reçu.',
      "Après 30 jours, signale sur le site tout appel abusif restant.",
    ],
    url: 'https://www.bloctel.gouv.fr/',
    cta: 'M\'inscrire à Bloctel',
  },
  {
    id: 'signal-spam',
    cat: 'antispam',
    title: 'Signaler les spams (SMS et email)',
    why: "Le 33700 (SMS) et Signal Spam (email) alimentent les autorités pour faire fermer les spammeurs. C'est rapide et utile collectivement.",
    time: '2 min',
    impact: 'low',
    steps: [
      'Pour un SMS indésirable : transfère-le au 33700 (gratuit).',
      'Pour un email : signale-le via Signal Spam.',
      'Ne clique jamais sur les liens de désinscription douteux.',
    ],
    url: 'https://www.signal-spam.fr/',
    cta: 'Signaler un spam',
  },
];

// ---- Suivi de progression ----
// Structure : { [procedureId]: { done: bool, ts } }
function getProgress() {
  return store.readJson(PROGRESS_FILE, {});
}

function setDone(id, done) {
  const p = getProgress();
  if (done) p[id] = { done: true, ts: Date.now() };
  else delete p[id];
  store.writeJson(PROGRESS_FILE, p);
  return p;
}

// Renvoie le catalogue enrichi de l'état de progression + un résumé.
function list() {
  const progress = getProgress();
  const procedures = PROCEDURES.map((p) => ({ ...p, done: !!(progress[p.id] && progress[p.id].done) }));
  const total = procedures.length;
  const done = procedures.filter((p) => p.done).length;
  return { categories: CATEGORIES, procedures, total, done };
}

module.exports = { id: 'procedures', label: 'Centre de démarches', list, setDone, getProgress };

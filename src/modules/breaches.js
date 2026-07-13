'use strict';
// Module Fuites de données — vérification de mots de passe via l'API Pwned Passwords.
// Protocole k-anonymity : le mot de passe N'EST JAMAIS envoyé.
// On envoie uniquement les 5 premiers caractères du hash SHA-1, l'API renvoie
// tous les suffixes correspondants, et on compare localement.
const crypto = require('crypto');
const https = require('https');

function sha1Upper(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').toUpperCase();
}

function fetchRange(prefix) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.pwnedpasswords.com',
      path: `/range/${prefix}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Hygiene-Info-App',
        'Add-Padding': 'true', // brouille la taille de réponse pour + de confidentialité
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`API HIBP a répondu ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Délai dépassé')); });
    req.end();
  });
}

/**
 * Vérifie un mot de passe. Renvoie { pwned: bool, count: number }.
 * Le mot de passe ne quitte jamais la machine.
 */
async function checkPassword(password) {
  if (!password) return { pwned: false, count: 0, error: 'Mot de passe vide.' };
  const hash = sha1Upper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const body = await fetchRange(prefix);
    const lines = body.split('\n');
    for (const line of lines) {
      const [suf, cnt] = line.trim().split(':');
      if (suf === suffix) {
        return { pwned: true, count: parseInt(cnt, 10) || 0 };
      }
    }
    return { pwned: false, count: 0 };
  } catch (err) {
    return { pwned: false, count: 0, error: String(err.message || err) };
  }
}

module.exports = { id: 'breaches', label: 'Fuites de données', checkPassword };

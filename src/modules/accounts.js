'use strict';
// Module Comptes Windows locaux (audit read-only).
// Liste tous les comptes, distingue compte local vs compte Microsoft lié,
// signale les comptes actifs sans mot de passe et l'admin intégré.
const { runPowerShell } = require('../ps');

async function audit() {
  const cmd = `
Get-LocalUser | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    Enabled = $_.Enabled
    Source = "$($_.PrincipalSource)"
    PasswordRequired = $_.PasswordRequired
    LastLogon = if ($_.LastLogon) { $_.LastLogon.ToString('yyyy-MM-dd') } else { '' }
    IsAdmin = $false
  }
} | ConvertTo-Json -Compress
`;
  const res = await runPowerShell(cmd, { timeout: 30000 });
  let users = [];
  try {
    const parsed = JSON.parse(res.stdout || '[]');
    users = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) { users = []; }

  // Récupère les membres du groupe Administrateurs (local).
  const admCmd = `try { (Get-LocalGroupMember -Group 'Administrateurs' -ErrorAction Stop).Name } catch { try { (Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop).Name } catch { '' } } | ConvertTo-Json -Compress`;
  const admRes = await runPowerShell(admCmd, { timeout: 20000 });
  let admins = [];
  try {
    const parsed = JSON.parse(admRes.stdout || '[]');
    admins = (Array.isArray(parsed) ? parsed : [parsed]).map((n) => String(n).split('\\').pop());
  } catch (_) { admins = []; }

  // Politique de mot de passe (net accounts).
  const polRes = await runPowerShell(`net accounts`, { timeout: 20000 });

  const enriched = users.map((u) => {
    const isAdmin = admins.includes(u.Name);
    const flags = [];
    if (u.Enabled && u.PasswordRequired === false) flags.push({ t: 'Sans mot de passe requis', risk: 'high' });
    if (u.Source === 'MicrosoftAccount') flags.push({ t: 'Compte Microsoft lié', risk: 'medium' });
    if (isAdmin && u.Enabled) flags.push({ t: 'Administrateur', risk: 'low' });
    return {
      name: u.Name,
      enabled: u.Enabled,
      source: u.Source === 'MicrosoftAccount' ? 'Compte Microsoft' : (u.Source === 'Local' ? 'Compte local' : u.Source),
      passwordRequired: u.PasswordRequired,
      lastLogon: u.LastLogon,
      isAdmin,
      flags,
      status: flags.some((f) => f.risk === 'high') ? 'warn' : 'ok',
    };
  });

  return {
    users: enriched,
    policy: (polRes.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12),
    hasMicrosoftAccount: enriched.some((u) => u.source === 'Compte Microsoft'),
  };
}

module.exports = { id: 'accounts', label: 'Comptes Windows', audit };

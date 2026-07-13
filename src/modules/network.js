'use strict';
// Module Réseau & sécurité système.
// Audite : pare-feu, DNS chiffré, comptes locaux, mises à jour, chiffrement disque.
const { runPowerShell } = require('../ps');

async function audit() {
  const checks = [];

  // 1. Pare-feu Windows (les 3 profils actifs ?)
  const fw = await runPowerShell(
    `(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $false } | Measure-Object).Count`);
  const fwDisabled = parseInt(fw.stdout.trim(), 10) || 0;
  checks.push({
    id: 'firewall',
    label: 'Pare-feu Windows',
    detail: 'Tous les profils réseau (Domaine, Privé, Public) doivent être actifs.',
    status: fwDisabled === 0 ? 'ok' : 'warn',
    current: fwDisabled === 0 ? 'Actif sur tous les profils' : `${fwDisabled} profil(s) désactivé(s)`,
    risk: 'high',
  });

  // 2. DNS chiffré (DoH) — vérifie que les serveurs DNS réellement utilisés
  // sur les cartes actives disposent d'un template DoH configuré (usage réel,
  // pas seulement la liste de templates connus du système).
  const doh = await runPowerShell(`
try {
  $active = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.ServerAddresses.Count -gt 0 -and (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up' }
  $servers = $active | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique
  $doh = (Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue).ServerAddress
  $covered = 0
  foreach ($s in $servers) { if ($doh -contains $s) { $covered++ } }
  if ($servers.Count -gt 0 -and $covered -eq $servers.Count) { 'all' } elseif ($covered -gt 0) { 'partial' } else { 'none' }
} catch { 'none' }`);
  const dohState = doh.stdout.trim();
  const dohCount = dohState === 'all' ? 1 : 0;
  checks.push({
    id: 'doh',
    label: 'DNS chiffré (DoH)',
    detail: "Sans DNS chiffré, ton FAI voit tous les sites que tu visites. Recommandé : Quad9 (9.9.9.9) ou Cloudflare (1.1.1.1).",
    status: dohState === 'all' ? 'ok' : 'warn',
    current: dohState === 'all' ? 'Actif sur les cartes utilisées'
      : dohState === 'partial' ? 'Partiel (certaines cartes non chiffrées)' : 'Non configuré',
    risk: 'medium',
  });

  // 3. Chiffrement du disque (BitLocker) sur C:
  const bl = await runPowerShell(
    `try { (Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop).ProtectionStatus } catch { 'Unknown' }`);
  const blStatus = bl.stdout.trim();
  checks.push({
    id: 'bitlocker',
    label: 'Chiffrement du disque (BitLocker)',
    detail: "Sans chiffrement, un vol de PC = accès à toutes tes données.",
    status: blStatus === 'On' || blStatus === '1' ? 'ok' : 'warn',
    current: blStatus === 'On' || blStatus === '1' ? 'Activé' : (blStatus === 'Unknown' ? 'Inconnu / non dispo' : 'Désactivé'),
    risk: 'high',
  });

  // 4. Mises à jour Windows récentes ?
  const upd = await runPowerShell(
    `try { $d = (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn; if ($d) { (New-TimeSpan -Start $d -End (Get-Date)).Days } else { 999 } } catch { 999 }`);
  const daysSinceUpdate = parseInt(upd.stdout.trim(), 10);
  checks.push({
    id: 'updates',
    label: 'Mises à jour de sécurité',
    detail: 'Un système à jour bouche les failles connues.',
    status: (!isNaN(daysSinceUpdate) && daysSinceUpdate < 45) ? 'ok' : 'warn',
    current: isNaN(daysSinceUpdate) || daysSinceUpdate === 999 ? 'Inconnu' : `Dernière il y a ${daysSinceUpdate} j`,
    risk: 'medium',
  });

  // 5. Compte administrateur intégré activé ? (devrait être désactivé)
  const adm = await runPowerShell(
    `try { (Get-LocalUser -Name 'Administrator' -ErrorAction Stop).Enabled } catch { try { (Get-LocalUser -Name 'Administrateur' -ErrorAction Stop).Enabled } catch { 'Unknown' } }`);
  const admEnabled = adm.stdout.trim();
  checks.push({
    id: 'builtin-admin',
    label: 'Compte Administrateur intégré',
    detail: "Le compte 'Administrateur' natif devrait rester désactivé.",
    status: admEnabled === 'False' ? 'ok' : (admEnabled === 'True' ? 'warn' : 'ok'),
    current: admEnabled === 'True' ? 'Activé (à désactiver)' : (admEnabled === 'False' ? 'Désactivé' : 'N/A'),
    risk: 'medium',
  });

  return { checks };
}

// Remédiations réseau applicables (avec élévation).
function buildRemediation(ids) {
  const parts = [];
  if (ids.includes('firewall')) {
    parts.push(`Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True`);
  }
  if (ids.includes('doh')) {
    // Configure Quad9 en DoH sur les cartes actives.
    parts.push(`
Netsh interface ipv4 set dnsservers name="*" static 9.9.9.9 primary 2>$null
$doh = 'https://dns.quad9.net/dns-query'
try { Add-DnsClientDohServerAddress -ServerAddress '9.9.9.9' -DohTemplate $doh -AllowFallbackToUdp $false -AutoUpgrade $true -ErrorAction SilentlyContinue } catch {}
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters' -Name 'EnableAutoDoh' -Value 2 -Type DWord -Force`);
  }
  if (ids.includes('builtin-admin')) {
    parts.push(`try { Disable-LocalUser -Name 'Administrator' -ErrorAction SilentlyContinue } catch {}; try { Disable-LocalUser -Name 'Administrateur' -ErrorAction SilentlyContinue } catch {}`);
  }
  return { script: parts.join('\n'), needsElevation: true };
}

module.exports = { id: 'network', label: 'Réseau & sécurité', audit, buildRemediation };

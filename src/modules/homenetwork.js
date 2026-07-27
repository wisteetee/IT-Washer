'use strict';
// Module Réseau domestique.
// Audite : VPN actif, IP publique (fuite d'IP réelle), UPnP/SSDP, ports en écoute
// exposés, découverte réseau. L'IP publique passe par un appel HTTPS côté Node
// (comme breaches.js), pas PowerShell — et UNIQUEMENT sur demande de l'utilisateur.
const { runPowerShell } = require('../ps');
const https = require('https');

// Récupère l'IP publique via un service minimal (ipify). Appel réseau explicite.
function fetchPublicIp() {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=text', { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.trim() || null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function audit() {
  const checks = [];

  // 1. VPN actif ? (adaptateur de type VPN/tunnel up)
  const vpn = await runPowerShell(
    `(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'VPN|WireGuard|OpenVPN|TAP|Wintun|Tun|NordLynx|Mullvad|ProtonVPN') } | Select-Object -ExpandProperty Name) -join ','`,
    { timeout: 15000 });
  const vpnName = vpn.stdout.trim();
  checks.push({
    id: 'vpn',
    label: 'VPN',
    detail: "Un VPN masque ton IP réelle à ton FAI et aux sites visités.",
    status: vpnName ? 'ok' : 'info',
    current: vpnName ? `Actif : ${vpnName}` : 'Aucun VPN actif',
    risk: 'low',
    fixable: false,
  });

  // 2. UPnP / SSDP : ouvre des ports automatiquement sur la box (risque).
  const ssdp = await runPowerShell(
    `(Get-Service -Name SSDPSRV -EA SilentlyContinue).Status`, { timeout: 15000 });
  const ssdpStatus = ssdp.stdout.trim();
  checks.push({
    id: 'upnp',
    label: 'UPnP / découverte SSDP',
    detail: "UPnP laisse les applications ouvrir des ports sur ta box sans confirmation. Recommandé : désactiver.",
    status: ssdpStatus === 'Running' ? 'warn' : 'ok',
    current: ssdpStatus === 'Running' ? 'Actif (ports auto-ouvrables)' : (ssdpStatus || 'Arrêté'),
    risk: 'medium',
    fixable: ssdpStatus === 'Running',
  });

  // 3. Découverte réseau sur profil public (ne devrait PAS être activée).
  const disc = await runPowerShell(
    `try { (Get-NetFirewallRule -DisplayGroup 'Découverte du réseau' -EA Stop | Where-Object { $_.Profile -match 'Public' -and $_.Enabled -eq 'True' } | Measure-Object).Count } catch { try { (Get-NetFirewallRule -DisplayGroup 'Network Discovery' -EA Stop | Where-Object { $_.Profile -match 'Public' -and $_.Enabled -eq 'True' } | Measure-Object).Count } catch { 0 } }`,
    { timeout: 20000 });
  const discCount = parseInt(disc.stdout.trim(), 10) || 0;
  checks.push({
    id: 'netdiscovery-public',
    label: 'Découverte réseau (profil public)',
    detail: "Rendre ton PC visible sur les réseaux publics (Wi-Fi ouverts) est risqué.",
    status: discCount === 0 ? 'ok' : 'warn',
    current: discCount === 0 ? 'Désactivée sur réseau public' : `${discCount} règle(s) active(s)`,
    risk: 'medium',
    fixable: false,
  });

  // 4. Ports en écoute exposés (0.0.0.0), hors localhost.
  const ports = await runPowerShell(`
try {
  $listen = Get-NetTCPConnection -State Listen -EA Stop |
    Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' } |
    Select-Object -ExpandProperty LocalPort -Unique
  ($listen | Sort-Object) -join ','
} catch { '' }`, { timeout: 20000 });
  const openPorts = ports.stdout.trim();
  const portCount = openPorts ? openPorts.split(',').filter(Boolean).length : 0;
  checks.push({
    id: 'listening-ports',
    label: 'Ports en écoute exposés',
    detail: "Ports ouverts sur toutes les interfaces (0.0.0.0), accessibles depuis le réseau.",
    status: portCount <= 6 ? 'ok' : 'warn',
    current: portCount === 0 ? 'Aucun' : `${portCount} port(s) : ${openPorts.slice(0, 80)}${openPorts.length > 80 ? '…' : ''}`,
    risk: 'low',
    fixable: false,
  });

  return { checks };
}

// Test de fuite d'IP : renvoie l'IP publique + les IP locales, pour comparaison.
// Appel réseau explicite, déclenché uniquement par l'utilisateur.
async function ipLeakTest() {
  const publicIp = await fetchPublicIp();
  const local = await runPowerShell(
    `(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress) -join ','`,
    { timeout: 15000 });
  const vpn = await runPowerShell(
    `(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'VPN|WireGuard|OpenVPN|TAP|Wintun|Tun|NordLynx|Mullvad|ProtonVPN') } | Measure-Object).Count`,
    { timeout: 15000 });
  const vpnActive = (parseInt(vpn.stdout.trim(), 10) || 0) > 0;
  return {
    publicIp: publicIp || 'Indisponible',
    localIps: local.stdout.trim().split(',').filter(Boolean),
    vpnActive,
  };
}

// Remédiation : désactive UPnP (arrête + désactive le service SSDP et Upnphost).
function buildDisableUpnp() {
  const script = `Stop-Service -Name SSDPSRV -Force -ErrorAction SilentlyContinue
Set-Service -Name SSDPSRV -StartupType Disabled -ErrorAction SilentlyContinue
Stop-Service -Name upnphost -Force -ErrorAction SilentlyContinue
Set-Service -Name upnphost -StartupType Disabled -ErrorAction SilentlyContinue`;
  return { script, needsElevation: true };
}

module.exports = { id: 'homenetwork', label: 'Réseau domestique', audit, ipLeakTest, buildDisableUpnp };

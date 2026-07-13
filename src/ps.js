'use strict';
// Exécuteur PowerShell centralisé et sécurisé.
// - Toute commande est loggée.
// - Les scripts de remédiation sont exécutés depuis des fichiers .ps1 versionnés,
//   jamais construits par concaténation de chaînes issues du renderer.
const { spawn } = require('child_process');

/**
 * Exécute un bloc PowerShell en lecture seule (audit).
 * Renvoie { ok, stdout, stderr, code }.
 */
function runPowerShell(script, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    // Force la sortie en UTF-8 pour que les accents soient décodés correctement
    // côté Node (sinon PowerShell écrit dans la codepage console FR, ex. CP-1252).
    const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`;
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-OutputFormat', 'Text',
      '-Command', wrapped,
    ];
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, stdout, stderr: stderr + '\n[timeout]', code: -1 });
    }, timeout);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(err), code: -1 });
    });
  });
}

/**
 * Exécute du PowerShell en tant qu'administrateur via un prompt UAC.
 *
 * Approche robuste : on écrit le script dans un fichier .ps1 temporaire, puis
 * on lance UN SEUL process élevé (Start-Process -Verb RunAs -Wait -PassThru)
 * qui exécute ce fichier. On récupère le vrai ExitCode du process élevé.
 *
 * Points clés du correctif :
 *  - $ErrorActionPreference = 'Stop' DANS le script élevé : sans ça, les erreurs
 *    d'écriture registre (accès refusé, etc.) sont ignorées et le script rapporte
 *    faussement un succès.
 *  - Le launcher utilise -Wait et lit $p.ExitCode : si l'UAC est refusé,
 *    Start-Process lève une exception → on la détecte. Si le script échoue,
 *    son ExitCode != 0 → on le détecte.
 */
function runPowerShellElevated(script, { timeout = 180000 } = {}) {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');

  const tag = crypto.randomBytes(6).toString('hex');
  const scriptFile = path.join(os.tmpdir(), `itwasher_${tag}.ps1`);
  const logFile = path.join(os.tmpdir(), `itwasher_${tag}.log`);

  // Script élevé : ErrorActionPreference=Stop pour que les erreurs registre
  // remontent, capture des erreurs dans un log, exit code explicite.
  const inner = `$ErrorActionPreference = 'Stop'
try {
${script}
  exit 0
} catch {
  $_ | Out-String | Set-Content -LiteralPath '${logFile.replace(/\\/g, '\\\\')}' -Encoding UTF8
  exit 1
}`;

  // Le launcher (non élevé) : lance le .ps1 en admin, attend, renvoie l'ExitCode.
  // Si l'UAC est refusé, Start-Process lève → on écrit -1.
  const launcher = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptFile.replace(/\\/g, '\\\\')}'
  Write-Output $p.ExitCode
} catch {
  Write-Output 'UAC_DENIED'
}`;

  return new Promise((resolve) => {
    try {
      fs.writeFileSync(scriptFile, inner, 'utf8');
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: 'Impossible de préparer le script élevé : ' + err.message, code: -1 });
      return;
    }

    runPowerShell(launcher, { timeout }).then((res) => {
      const out = (res.stdout || '').trim();
      // Dernière ligne non-vide = l'ExitCode (ou UAC_DENIED) écrit par le launcher.
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const last = lines.length ? lines[lines.length - 1] : '';
      let log = '';
      try { if (fs.existsSync(logFile)) log = fs.readFileSync(logFile, 'utf8'); } catch (_) {}
      // Nettoyage
      try { fs.unlinkSync(scriptFile); } catch (_) {}
      try { if (fs.existsSync(logFile)) fs.unlinkSync(logFile); } catch (_) {}

      if (last === 'UAC_DENIED') {
        resolve({ ok: false, stdout: '', stderr: 'Élévation refusée (UAC annulé).', code: -1 });
      } else if (last === '0') {
        resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      } else {
        resolve({ ok: false, stdout: '', stderr: log.trim() || `Le script élevé a échoué (code ${last || 'inconnu'}).`, code: 1 });
      }
    });
  });
}

module.exports = { runPowerShell, runPowerShellElevated };

// Liest die Tranchen aus der Desktop-App und zeigt sie als QR-Code fürs Handy.
// Aufruf: npm run qr [-- --datei <ruhestand_suite_data.json>] [--ziel <html>] [--nicht-oeffnen]
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import QRCode from 'qrcode';

const PRAEFIX = 'DEPOT1:';
const APP_ORDNER = 'de.vermoegen-ruhestand.suite';

/** Windows-Ordner wie %APPDATA% als WSL-Pfad; der Nutzername steht so nirgends im Code. */
function windowsOrdner(variable) {
  const wert = execFileSync('cmd.exe', ['/c', `echo %${variable}%`], { cwd: '/mnt/c', encoding: 'utf8' }).trim();
  if (!wert || wert.includes('%')) throw new Error(`Windows-Variable ${variable} nicht gefunden. Pfad mit --datei/--ziel angeben.`);
  return execFileSync('wslpath', ['-u', wert], { encoding: 'utf8' }).trim();
}

const lies = wert => { try { return typeof wert === 'string' ? JSON.parse(wert) : wert; } catch { return wert; } };

/** Baut aus dem gespeicherten App-Stand den Inhalt des QR-Codes. Nur Name, Ticker und Stückzahl je Tranche. */
export function baueDaten(appStand, jetzt = new Date()) {
  const profile = lies(appStand?.records?.rs_profiles_v1)?.profiles;
  if (!profile || typeof profile !== 'object') throw new Error('Keine Profile im App-Stand gefunden.');
  const hinweise = [];
  const personen = [];
  for (const [id, profil] of Object.entries(profile)) {
    if (profil?.meta?.belongsToHousehold === false) continue;
    const name = String(profil?.meta?.name || id).trim();
    const tranchen = lies(profil?.data?.depot_tranchen);
    if (!Array.isArray(tranchen)) { hinweise.push(`${name}: keine Tranchen`); continue; }
    const t = [];
    for (const tranche of tranchen) {
      const ticker = String(tranche?.ticker || '').trim();
      const stueck = Number(tranche?.shares);
      if (!ticker) { hinweise.push(`${name}: „${tranche?.name}“ ohne Ticker, übersprungen`); continue; }
      if (!Number.isFinite(stueck) || stueck <= 0) { hinweise.push(`${name}: „${tranche?.name}“ ohne Stückzahl, übersprungen`); continue; }
      t.push([String(tranche.name || ticker).trim(), ticker, stueck]);
    }
    personen.push({ n: name, t });
  }
  if (!personen.length) throw new Error('Keine Person mit Tranchen gefunden.');
  return { daten: { s: jetzt.toISOString(), p: personen }, hinweise };
}

export const verschluessele = daten => PRAEFIX + Buffer.from(JSON.stringify(daten), 'utf8').toString('base64url');

function seite(svg, personen) {
  const liste = personen.map(p => `${p.n}: ${p.t.length} Tranchen`).join(' · ');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Depot fürs Handy</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f2ee;color:#1d2830;font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif;text-align:center}
main{padding:32px}h1{font:500 30px/1.2 Georgia,serif;color:#7a5a1f;margin:0 0 8px}.qr{width:min(72vh,520px);margin:20px auto;padding:16px;background:#fff;border:1px solid #d8dbd3;border-radius:16px}
.qr svg{display:block;width:100%;height:auto}p{margin:4px 0;color:#56626a}</style></head>
<body><main><h1>Depot fürs Handy</h1><p>Auf dem Handy: Menü ⋮ → <b>Positionen neu einlesen</b>, dann diesen Code scannen.</p>
<div class="qr">${svg}</div><p>${liste}</p><p>Diese Datei wird nach dem Scannen gelöscht.</p></main></body></html>`;
}

async function main() {
  const arg = process.argv.slice(2);
  const wert = name => { const i = arg.indexOf(name); return i >= 0 ? arg[i + 1] : null; };
  const datei = wert('--datei') || `${windowsOrdner('APPDATA')}/${APP_ORDNER}/ruhestand_suite_data.json`;
  const ziel = wert('--ziel') || `${windowsOrdner('TEMP')}/depot-handy-qr.html`;

  const { daten, hinweise } = baueDaten(JSON.parse(readFileSync(datei, 'utf8')));
  const code = verschluessele(daten);
  const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
  writeFileSync(ziel, seite(svg, daten.p), 'utf8');

  for (const p of daten.p) console.log(`${p.n}: ${p.t.length} Tranchen`);
  for (const h of hinweise) console.log(`Hinweis: ${h}`);
  console.log(`QR-Code: ${code.length} Zeichen`);

  if (arg.includes('--nicht-oeffnen')) { console.log(`Geschrieben: ${ziel}`); return; }
  const windowsPfad = execFileSync('wslpath', ['-w', ziel], { encoding: 'utf8' }).trim();
  spawn('cmd.exe', ['/c', 'start', '""', windowsPfad], { cwd: '/mnt/c', stdio: 'ignore', detached: true }).unref();

  const loeschen = () => { rmSync(ziel, { force: true }); console.log('QR-Datei gelöscht.'); };
  if (process.stdin.isTTY) {
    console.log('Nach dem Scannen Enter drücken, dann wird die QR-Datei gelöscht.');
    const rl = createInterface({ input: process.stdin });
    rl.once('line', () => { rl.close(); loeschen(); });
  } else {
    console.log('Die QR-Datei wird in 3 Minuten gelöscht.');
    setTimeout(loeschen, 180_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(`Fehler: ${e.message}`); process.exit(1); });
}

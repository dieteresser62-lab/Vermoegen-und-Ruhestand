// Depot fürs Handy. Positionen liegen nur in diesem Browser (localStorage), Kurse kommen über /api/kurse.
import { PRAEFIX, entschluessele, pruefe } from './code.js';
const SCHLUESSEL_POSITIONEN = 'depot.positionen.v1';
const SCHLUESSEL_KURSE = 'depot.kurse.v1';
const SCHLUESSEL_OFFEN = 'depot.offen.v1';
const MINDESTABSTAND_MS = 60_000;

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euroDelta = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const kursFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3 });
const stueckFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const prozent = new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const zeitFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const tagFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const zeitTag = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const datumFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const $ = id => document.getElementById(id);
const zustand = { positionen: null, kurse: {}, frisch: new Set(), letzterVersuch: 0, abrufFehler: false, laeuft: false, offen: new Set() };

// ---------- Speicher ----------
function lies(schluessel) {
  try { return JSON.parse(localStorage.getItem(schluessel)); } catch { return null; }
}
function schreib(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); return true; } catch { return false; }
}

function uebernimm({ daten, positionen }) {
  if (!schreib(SCHLUESSEL_POSITIONEN, daten)) throw new Error('Speichern auf dem Handy ist fehlgeschlagen.');
  zustand.positionen = positionen;
  zustand.frisch = new Set();
  zustand.letzterVersuch = 0;
  zeige();
  aktualisiere();
}

// ---------- Kurse ----------
function alleTicker() {
  return [...new Set((zustand.positionen?.personen || []).flatMap(p => p.tranchen.map(t => t.ticker)))];
}

async function aktualisiere({ erzwingen = false } = {}) {
  const ticker = alleTicker();
  if (!ticker.length || zustand.laeuft) return;
  if (!erzwingen && Date.now() - zustand.letzterVersuch < MINDESTABSTAND_MS) return;
  zustand.laeuft = true;
  zustand.letzterVersuch = Date.now();
  zeigeLaeuft(true);
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), 15_000);
  try {
    const res = await fetch(`api/kurse?s=${encodeURIComponent(ticker.join(','))}`, { cache: 'no-store', signal: abbruch.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const antwort = await res.json();
    const neu = { ...zustand.kurse };
    zustand.frisch = new Set();
    for (const [t, k] of Object.entries(antwort.kurse || {})) {
      if (typeof k?.kurs === 'number') { neu[t] = k; zustand.frisch.add(t); }
    }
    zustand.kurse = neu;
    zustand.abrufFehler = ticker.some(t => !zustand.frisch.has(t));
    schreib(SCHLUESSEL_KURSE, neu);
  } catch {
    zustand.abrufFehler = true;
    zustand.frisch = new Set();
  } finally {
    clearTimeout(uhr);
    zustand.laeuft = false;
    zeigeLaeuft(false);
    zeige();
  }
}

// ---------- Rechnen ----------
function rechne() {
  const personen = zustand.positionen.personen.map(person => {
    const tranchen = person.tranchen.map(t => {
      const k = zustand.kurse[t.ticker];
      if (!k) return { ...t, wert: null, delta: null };
      const wert = t.stueck * k.kurs;
      const delta = typeof k.vortag === 'number' ? t.stueck * (k.kurs - k.vortag) : null;
      return { ...t, kurs: k.kurs, zeit: k.zeit, boerse: k.boerse, wert, delta };
    });
    return { name: person.name, tranchen, ...summiere(tranchen) };
  });
  return { personen, ...summiere(personen.flatMap(p => p.tranchen)) };
}

function summiere(tranchen) {
  let wert = 0, delta = 0, fehlend = 0;
  for (const t of tranchen) {
    if (t.wert === null) { fehlend++; continue; }
    wert += t.wert;
    delta += t.delta ?? 0;
  }
  return { wert, delta, fehlend };
}

// ---------- Anzeige ----------
const esc = s => String(s).replace(/[&<>"']/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));

function deltaHtml(delta, wert, { seit = false } = {}) {
  if (delta === null || wert === null) return '';
  const basis = wert - delta;
  const klasse = Math.round(delta) > 0 ? 'gut' : Math.round(delta) < 0 ? 'schlecht' : '';
  const pz = basis > 0 ? ` · ${prozent.format(delta / basis)}` : '';
  return `<span class="delta ${klasse}">${euroDelta.format(delta)}${pz}${seit ? ' <span class="seit">seit Vortag</span>' : ''}</span>`;
}

function zeige() {
  const hatDaten = Boolean(zustand.positionen?.personen?.length);
  $('leer').hidden = hatDaten;
  $('inhalt').hidden = !hatDaten;
  if (!hatDaten) return;

  const r = rechne();
  $('gesamtWert').textContent = r.wert || !r.fehlend ? euro.format(r.wert) : '–';
  $('gesamtDelta').innerHTML = deltaHtml(r.delta, r.wert, { seit: true });

  $('personen').innerHTML = r.personen.map((p, i) => `
    <details class="person" data-index="${i}" ${zustand.offen.has(i) ? 'open' : ''}>
      <summary>
        <span class="name">${esc(p.name)}</span>
        <span class="summe">${p.fehlend === p.tranchen.length && p.tranchen.length ? '–' : euro.format(p.wert)}</span>
        <span class="anzahl">${p.tranchen.length} ${p.tranchen.length === 1 ? 'Tranche' : 'Tranchen'}</span>
        ${deltaHtml(p.delta, p.wert)}
        <svg class="pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </summary>
      <ul class="tranchen">${p.tranchen.map(trancheHtml).join('')}</ul>
    </details>`).join('');

  $('kursStand').innerHTML = standText(r);
  $('positionsStand').textContent = zustand.positionen.stand
    ? `Positionen vom ${datumFormat.format(new Date(zustand.positionen.stand))}` : '';
}

function trancheHtml(t) {
  const veraltet = t.wert !== null && zustand.abrufFehler && !zustand.frisch.has(t.ticker);
  const detail = t.wert === null
    ? `${stueckFormat.format(t.stueck)} Stk · kein Kurs`
    : `${stueckFormat.format(t.stueck)} Stk · ${kursFormat.format(t.kurs)}${veraltet ? ' <span class="alt">(älterer Kurs)</span>' : ''}`;
  return `<li class="tranche">
    <span class="tname">${esc(t.name)}</span>
    <span class="twert">${t.wert === null ? '–' : euro.format(t.wert)}</span>
    <span class="tdetail">${detail}</span>
    ${deltaHtml(t.delta, t.wert)}
    ${t.zeit ? `<span class="tquelle">${esc(quelle(t))}</span>` : ''}
  </li>`;
}

/** Woher der Kurs stammt, etwa „Stuttgart 21:15“ oder „Xetra Fr. 17:36“. */
function quelle(t) {
  const zeit = new Date(t.zeit);
  const heute = new Date().toDateString() === zeit.toDateString();
  return `${t.boerse || 'Börse'} ${heute ? '' : `${zeitTag.format(zeit)} `}${zeitFormat.format(zeit)}`;
}

function standText(r) {
  const zeiten = r.personen.flatMap(p => p.tranchen).map(t => t.zeit).filter(Boolean).map(z => new Date(z));
  const teile = [];
  if (zeiten.length) {
    const neueste = new Date(Math.max(...zeiten));
    const heute = new Date().toDateString() === neueste.toDateString();
    teile.push(`Kurse ${heute ? 'von heute' : `vom ${tagFormat.format(neueste)}`}, ${zeitFormat.format(neueste)} Uhr`);
  }
  if (zustand.abrufFehler) teile.push('<span class="hinweis">Aktualisierung fehlgeschlagen, letzter bekannter Stand</span>');
  if (r.fehlend) teile.push(`<span class="hinweis">${r.fehlend} ${r.fehlend === 1 ? 'Tranche' : 'Tranchen'} ohne Kurs, nicht in der Summe</span>`);
  return teile.join('<br>');
}

function zeigeLaeuft(an) {
  const knopf = $('aktualisieren');
  knopf.classList.toggle('laeuft', an);
  knopf.disabled = an;
  knopf.querySelector('span').textContent = an ? 'Lädt …' : 'Aktualisieren';
}

// ---------- Scanner ----------
let strom = null, suche = null;

async function oeffneScanner() {
  $('menue').close();
  const hinweis = $('scanHinweis');
  hinweis.classList.remove('fehler');
  hinweis.textContent = 'Halte die Kamera auf den QR-Code am PC.';
  $('codeFeld').value = '';
  $('scanner').showModal();
  if (!('BarcodeDetector' in window)) {
    return scanFehler('Dieser Browser kann keine QR-Codes lesen. Füge den Code unten ein.');
  }
  try {
    const erkenner = new BarcodeDetector({ formats: ['qr_code'] });
    strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = $('video');
    video.srcObject = strom;
    await video.play();
    const runde = async () => {
      if (!strom) return;
      try {
        const codes = await erkenner.detect(video);
        const treffer = codes.find(c => c.rawValue?.startsWith(PRAEFIX));
        if (treffer && fertig(treffer.rawValue)) return;
        if (codes.length && !treffer) scanFehler('Das ist kein Depot-Code.');
      } catch { /* einzelnes Bild nicht lesbar */ }
      suche = setTimeout(runde, 200);
    };
    runde();
  } catch (e) {
    scanFehler(e?.name === 'NotAllowedError'
      ? 'Kein Zugriff auf die Kamera. Erlaube ihn in den Chrome-Einstellungen oder füge den Code unten ein.'
      : 'Die Kamera ließ sich nicht starten. Füge den Code unten ein.');
  }
}

function scanFehler(text) {
  const hinweis = $('scanHinweis');
  hinweis.textContent = text;
  hinweis.classList.add('fehler');
}

function schliesseScanner() {
  clearTimeout(suche);
  strom?.getTracks().forEach(t => t.stop());
  strom = null;
  $('video').srcObject = null;
  if ($('scanner').open) $('scanner').close();
}

function fertig(text) {
  try {
    const ergebnis = entschluessele(text);
    schliesseScanner();
    uebernimm(ergebnis);
    return true;
  } catch (e) {
    scanFehler(e.message);
    return false;
  }
}

// ---------- Bedienung ----------
document.addEventListener('click', ereignis => {
  const ziel = ereignis.target.closest('[data-aktion]');
  if (!ziel) return;
  const aktion = ziel.dataset.aktion;
  if (aktion === 'scannen') oeffneScanner();
  if (aktion === 'scanZu') schliesseScanner();
  if (aktion === 'einfuegen') fertig($('codeFeld').value);
  if (aktion === 'loeschen') {
    $('menue').close();
    if (!confirm('Positionen und Kurse von diesem Handy löschen?')) return;
    try { [SCHLUESSEL_POSITIONEN, SCHLUESSEL_KURSE, SCHLUESSEL_OFFEN].forEach(s => localStorage.removeItem(s)); } catch { /* nichts zu tun */ }
    Object.assign(zustand, { positionen: null, kurse: {}, frisch: new Set(), abrufFehler: false, offen: new Set() });
    zeige();
  }
});
$('scanner').addEventListener('close', schliesseScanner);
$('menueKnopf').addEventListener('click', () => $('menue').showModal());
$('menue').addEventListener('click', e => { if (e.target === $('menue')) $('menue').close(); });
$('aktualisieren').addEventListener('click', () => aktualisiere({ erzwingen: true }));
$('personen').addEventListener('toggle', e => {
  const i = Number(e.target.dataset.index);
  if (e.target.open) zustand.offen.add(i); else zustand.offen.delete(i);
  schreib(SCHLUESSEL_OFFEN, [...zustand.offen]);
}, true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') aktualisiere(); });

// ---------- Start ----------
zustand.positionen = (() => { try { return pruefe(lies(SCHLUESSEL_POSITIONEN)); } catch { return null; } })();
zustand.kurse = lies(SCHLUESSEL_KURSE) || {};
zustand.offen = new Set(Array.isArray(lies(SCHLUESSEL_OFFEN)) ? lies(SCHLUESSEL_OFFEN) : []);
zeige();
aktualisiere();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

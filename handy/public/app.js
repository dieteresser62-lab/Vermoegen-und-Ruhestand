// Depot fürs Handy. Positionen liegen nur in diesem Browser (localStorage), Kurse kommen über /api/kurse,
// der Jahresverlauf über /api/verlauf.
import { PRAEFIX, entschluessele, pruefe } from './code.js';
import { kennzahlen } from './verlauf.js';
const SCHLUESSEL_POSITIONEN = 'depot.positionen.v1';
const SCHLUESSEL_KURSE = 'depot.kurse.v1';
const SCHLUESSEL_VERLAUF = 'depot.verlauf.v1';
const SCHLUESSEL_OFFEN = 'depot.offen.v1';
const MINDESTABSTAND_MS = 60_000;
const TICKER_JE_ABRUF = 12;
const VERLAUF_JE_ABRUF = 40;
const VERLAUF_GILT_MS = 6 * 3600_000;

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euroDelta = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const kursFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3 });
const stueckFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const prozent = new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const zeitFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const tagFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const zeitTag = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const datumFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const prozent1 = new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const abstandFormat = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 });
const kurzDatum = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
const isoTag = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });

const $ = id => document.getElementById(id);
const zustand = { positionen: null, kurse: {}, verlauf: null, frisch: new Set(), letzterVersuch: 0, abrufFehler: false, laeuft: false, offen: new Set() };

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

const ladezeit = (cache, ticker) => cache?.tickerGeladen ? cache.tickerGeladen[ticker] : cache?.geladen;
const hatVerlauf = v => !v?.fehler && Array.isArray(v?.punkte) && v.punkte.length > 0;

async function aktualisiere({ erzwingen = false, beimOeffnen = false } = {}) {
  const ticker = alleTicker();
  if (!ticker.length || zustand.laeuft) return;
  const jetzt = Date.now();
  const kurseFaellig = erzwingen || jetzt - zustand.letzterVersuch >= MINDESTABSTAND_MS;
  const alt = zustand.verlauf;
  const verlaufTicker = ticker.filter(t => !hatVerlauf(alt?.ticker[t]) || !(jetzt - Date.parse(ladezeit(alt, t)) < VERLAUF_GILT_MS));
  if (!kurseFaellig && (!beimOeffnen || !verlaufTicker.length)) return;
  zustand.laeuft = true;
  zeigeLaeuft(true);
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), 15_000);
  try {
    const verlauf = ladeVerlauf(ticker, verlaufTicker, abbruch.signal);
    if (!kurseFaellig) {
      await verlauf;
      return;
    }
    zustand.letzterVersuch = jetzt;
    const antworten = await Promise.allSettled(teile(ticker, TICKER_JE_ABRUF).map(teil => hole('kurse', teil, abbruch.signal)));
    const neu = { ...zustand.kurse };
    zustand.frisch = new Set();
    for (const antwort of antworten) {
      if (antwort.status !== 'fulfilled') continue;
      for (const [t, k] of Object.entries(antwort.value?.kurse || {})) {
        if (typeof k?.kurs === 'number') { neu[t] = k; zustand.frisch.add(t); }
      }
    }
    zustand.kurse = neu;
    zustand.abrufFehler = ticker.some(t => !zustand.frisch.has(t));
    schreib(SCHLUESSEL_KURSE, neu);
    await verlauf;
  } finally {
    clearTimeout(uhr);
    zustand.laeuft = false;
    zeigeLaeuft(false);
    zeige();
  }
}

/** Hält bei Fehlern den letzten Verlauf und dessen Ladezeit fest. */
async function ladeVerlauf(ticker, faellig, signal) {
  if (!faellig.length) return;
  const antworten = await Promise.allSettled(teile(faellig, VERLAUF_JE_ABRUF).map(teil => hole('verlauf', teil, signal)));
  const erfolgreich = Object.fromEntries(antworten.flatMap(a => a.status === 'fulfilled'
    ? Object.entries(a.value?.verlauf || {}).filter(([, v]) => hatVerlauf(v)) : []));
  if (!Object.keys(erfolgreich).length) return;
  const alt = zustand.verlauf;
  const geladen = new Date(Date.now()).toISOString();
  const neu = { ...alt?.ticker, ...erfolgreich };
  const behalten = ticker.filter(t => hatVerlauf(neu[t]));
  zustand.verlauf = {
    geladen,
    ticker: Object.fromEntries(behalten.map(t => [t, neu[t]])),
    tickerGeladen: Object.fromEntries(behalten.map(t => [t,
      erfolgreich[t] ? geladen : ladezeit(alt, t)]))
  };
  schreib(SCHLUESSEL_VERLAUF, zustand.verlauf);
}

async function hole(pfad, ticker, signal) {
  const res = await fetch(`api/${pfad}?s=${encodeURIComponent(ticker.join(','))}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const teile = (liste, groesse) => Array.from({ length: Math.ceil(liste.length / groesse) }, (_, i) => liste.slice(i * groesse, (i + 1) * groesse));

// ---------- Rechnen ----------
function rechne() {
  const heute = isoTag.format(new Date());
  const personen = zustand.positionen.personen.map(person => {
    const tranchen = person.tranchen.map(t => {
      const k = zustand.kurse[t.ticker];
      if (!k) return { ...t, wert: null, delta: null, verlauf: null };
      const wert = t.stueck * k.kurs;
      const delta = typeof k.vortag === 'number' ? t.stueck * (k.kurs - k.vortag) : null;
      return { ...t, kurs: k.kurs, zeit: k.zeit, boerse: k.boerse, wert, delta, verlauf: bezuege(t.ticker, k, heute) };
    });
    return { name: person.name, tranchen, ...summiere(tranchen) };
  });
  return { personen, ...summiere(personen.flatMap(p => p.tranchen)) };
}

/** Bezugswerte aus dem gespeicherten Verlauf, mit dem heutigen Tag gerechnet. */
function bezuege(ticker, k, heute) {
  const v = zustand.verlauf?.ticker[ticker];
  if (!v?.punkte?.length || (v.waehrung && k.waehrung && v.waehrung !== k.waehrung)) return null;
  return kennzahlen(v.punkte, heute);
}

/** Woche und Monat rechnen mit den heutigen Stückzahlen: Wert heute gegen Stück × Schluss damals. */
function summiere(tranchen) {
  let wert = 0, delta = 0, fehlend = 0, ohneVerlauf = 0;
  const damals = { woche: [0, 0], monat: [0, 0] };
  for (const t of tranchen) {
    if (t.wert === null) { fehlend++; continue; }
    wert += t.wert;
    delta += t.delta ?? 0;
    if (!t.verlauf) ohneVerlauf++;
    for (const [name, summe] of Object.entries(damals)) {
      const bezug = t.verlauf?.[name];
      if (bezug) { summe[0] += t.wert; summe[1] += t.stueck * bezug.schluss; }
    }
  }
  const vergleich = ([heute, frueher]) => (frueher > 0 ? { delta: heute - frueher, basis: frueher } : null);
  return { wert, delta, fehlend, ohneVerlauf, woche: vergleich(damals.woche), monat: vergleich(damals.monat) };
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
  $('gesamtVerlauf').innerHTML = gesamtVerlaufHtml(r);

  $('personen').innerHTML = r.personen.map((p, i) => `
    <details class="person" data-index="${i}" ${zustand.offen.has(i) ? 'open' : ''}>
      <summary>
        <span class="name">${esc(p.name)}</span>
        <span class="summe">${p.fehlend === p.tranchen.length && p.tranchen.length ? '–' : euro.format(p.wert)}</span>
        <span class="anzahl">${p.tranchen.length} ${p.tranchen.length === 1 ? 'Tranche' : 'Tranchen'}</span>
        ${deltaHtml(p.delta, p.wert)}
        ${personVerlaufHtml(p)}
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
    ${verlaufHtml(t)}
    ${t.zeit ? `<span class="tquelle">${esc(quelle(t))}</span>` : ''}
  </li>`;
}

/** Veränderung in Prozent, auf Wunsch mit Euro davor, grün oder rot wie die Tagesänderung. */
function aenderung(anteil, euroBetrag = null) {
  const gerundet = Math.round(anteil * 1000);
  const klasse = gerundet > 0 ? 'gut' : gerundet < 0 ? 'schlecht' : '';
  const euroTeil = euroBetrag === null ? '' : `${euroDelta.format(euroBetrag)} · `;
  return `<span class="vz ${klasse}">${euroTeil}${prozent1.format(anteil)}</span>`;
}

/** „Woche +1,2 % · Monat −0,8 %“ für eine Person. */
function personVerlaufHtml(p) {
  const teile = [['Woche', p.woche], ['Monat', p.monat]].filter(([, z]) => z)
    .map(([name, z]) => `${name} ${aenderung(z.delta / z.basis)}`);
  return teile.length ? `<span class="pverlauf">${teile.join(' · ')}</span>` : '';
}

function gesamtVerlaufHtml(r) {
  const zeilen = [['Woche', r.woche], ['Monat', r.monat]].filter(([, z]) => z)
    .map(([name, z]) => `<p>${name} ${aenderung(z.delta / z.basis, z.delta)}</p>`);
  return zeilen.length ? `${zeilen.join('')}<p class="vhinweis">ⓘ Mit heutigen Stückzahlen, ohne Käufe und Verkäufe dazwischen</p>` : '';
}

/** „Woche +1,2 % · Monat −0,8 % · 52 W +9,4 % · 8 % unter Hoch“: heutiger Kurs gegen die Schlüsse von damals. */
function verlaufHtml(t) {
  const v = t.verlauf;
  if (!v || t.wert === null) return '';
  const jahr = v.hinweis ? `seit ${kurzDatum.format(Date.parse(v.jahr.datum))}` : '52 W';
  const teile = [['Woche', v.woche], ['Monat', v.monat], [jahr, v.jahr]].filter(([, bezug]) => bezug)
    .map(([name, bezug]) => `${name} ${aenderung(t.kurs / bezug.schluss - 1)}`);
  const abstand = 1 - t.kurs / v.hoch52.schluss;
  teile.push(abstand >= 0.0005 ? `${abstandFormat.format(abstand)} unter Hoch` : 'am Hoch');
  return `<span class="tverlauf">${teile.join(' · ')}</span>`;
}

/** „von heute, 21:15 Uhr“ oder „vom Fr., 21.11., 17:36 Uhr“. */
function standVon(zeit) {
  const heute = new Date().toDateString() === zeit.toDateString();
  return `${heute ? 'von heute' : `vom ${tagFormat.format(zeit)}`}, ${zeitFormat.format(zeit)} Uhr`;
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
  if (zeiten.length) teile.push(`Kurse ${standVon(new Date(Math.max(...zeiten)))}`);
  if (zustand.verlauf) teile.push(`Verlauf ${standVon(new Date(zustand.verlauf.geladen))}`);
  if (zustand.abrufFehler) teile.push('<span class="hinweis">Aktualisierung fehlgeschlagen, letzter bekannter Stand</span>');
  if (r.fehlend) teile.push(`<span class="hinweis">${r.fehlend} ${r.fehlend === 1 ? 'Tranche' : 'Tranchen'} ohne Kurs, nicht in der Summe</span>`);
  if (zustand.verlauf && r.ohneVerlauf) teile.push(`${r.ohneVerlauf} ${r.ohneVerlauf === 1 ? 'Tranche' : 'Tranchen'} ohne Verlauf, nicht in Woche und Monat`);
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
    try { [SCHLUESSEL_POSITIONEN, SCHLUESSEL_KURSE, SCHLUESSEL_VERLAUF, SCHLUESSEL_OFFEN].forEach(s => localStorage.removeItem(s)); } catch { /* nichts zu tun */ }
    Object.assign(zustand, { positionen: null, kurse: {}, verlauf: null, frisch: new Set(), abrufFehler: false, offen: new Set() });
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') return aktualisiere({ beimOeffnen: true });
});

// ---------- Start ----------
zustand.positionen = (() => { try { return pruefe(lies(SCHLUESSEL_POSITIONEN)); } catch { return null; } })();
zustand.kurse = lies(SCHLUESSEL_KURSE) || {};
zustand.verlauf = (v => (v?.geladen && v.ticker ? v : null))(lies(SCHLUESSEL_VERLAUF));
zustand.offen = new Set(Array.isArray(lies(SCHLUESSEL_OFFEN)) ? lies(SCHLUESSEL_OFFEN) : []);
zeige();
aktualisiere();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

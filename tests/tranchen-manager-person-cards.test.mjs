import { bindManagerPersonCards } from '../app/tranches/tranchen-manager-person-cards.js';
import { describePersonDates } from '../app/profile/profile-person-data.js';

function createDocument(session = new Map()) {
    const elements = new Map();
    const doc = { getElementById: id => elements.get(id), activeElement: null,
        defaultView: { location: { hash: '' }, sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) }, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } } };
    for (const id of ['managerCardsToggleAll', 'managerBirthSupplement', 'managerBirthDate', 'profileGeburtsdatum', ...['Person', 'Assets', 'Care'].flatMap(card => [`manager${card}Toggle`, `manager${card}Action`, `manager${card}Body`])]) {
        elements.set(id, { hidden: true, textContent: '', attrs: {}, listeners: {}, setAttribute(key, value) { this.attrs[key] = value; },
            addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.listeners.click?.(); }, focus() { doc.activeElement = this; } });
    }
    return doc;
}
const session = new Map(), doc = createDocument(session);
let person = 'a';
const api = bindManagerPersonCards(doc, () => person);
const open = card => !doc.getElementById(`manager${card}Body`).hidden;
assert(['Person', 'Assets', 'Care'].every(card => !open(card)), 'Neuer Seitenaufruf hält alle Detailkarten geschlossen');
assertEqual(session.size, 0, 'Lesendes Initialisieren schreibt keinen Sitzungswert');
assertEqual(bindManagerPersonCards(doc, () => person), api, 'Wiederholtes Binden verwendet denselben Binder');
doc.getElementById('managerPersonToggle').click();
assert(open('Person'), 'Ein Klick öffnet die anfangs geschlossene Personkarte');
doc.getElementById('managerPersonToggle').click();
assert(!open('Person') && !open('Assets'), 'Ein nativer Klick schließt genau eine Karte einmal');
doc.getElementById('managerPersonToggle').click();
assertEqual(doc.getElementById('managerPersonToggle').attrs['aria-expanded'], 'true', 'ARIA-Zustand folgt der sichtbaren Region');
assertEqual(doc.getElementById('managerCardsToggleAll').textContent, '▸ Alle Details zeigen', 'Gemischter Zustand bietet Öffnen an');
doc.getElementById('managerCardsToggleAll').click();
assert(['Person', 'Assets', 'Care'].every(open), 'Gesamtknopf öffnet aus gemischtem Zustand alle');
doc.getElementById('managerCardsToggleAll').click();
assert(['Person', 'Assets', 'Care'].every(card => !open(card)), 'Gesamtknopf schließt aus vollständig offenem Zustand alle');
doc.getElementById('managerAssetsToggle').click(); api.sync();
assert(open('Assets'), 'Rerender erhält Zustand');
person = 'b'; api.sync(); assert(!open('Assets'), 'Person B beginnt unabhängig geschlossen');
doc.getElementById('managerCareToggle').click(); person = 'a'; api.sync();
assert(open('Assets') && !open('Care'), 'A/B/A behält je Person gemerkte Karten');
const reload = createDocument(session); bindManagerPersonCards(reload, () => 'a');
assert(['Person', 'Assets', 'Care'].every(card => reload.getElementById(`manager${card}Body`).hidden), 'Reload startet alle Karten geschlossen');
const fresh = createDocument(); bindManagerPersonCards(fresh, () => 'a');
assert(fresh.getElementById('managerAssetsBody').hidden, 'Neue Sitzung übernimmt keine alten Karten');
assertEqual(session.size, 0, 'Klappen schreibt weder Sitzungs- noch Profilwerte');
doc.defaultView.location.hash = '#personendaten'; api.openTarget();
assert(open('Person') && doc.activeElement === doc.getElementById('profileGeburtsdatum'), 'Sprungziel öffnet und fokussiert Persondaten');
doc.getElementById('managerBirthSupplement').hidden = false; api.openTarget();
assertEqual(doc.activeElement, doc.getElementById('managerBirthDate'), 'Fehlendes Datum fokussiert die zentrale Ergänzung');
const closed = JSON.stringify([...session]); doc.defaultView.location.hash = '#personen'; api.openTarget();
assertEqual(JSON.stringify([...session]), closed, 'Personenverwaltungshash verändert keine Karten');
const inaccessible = createDocument(); inaccessible.defaultView.sessionStorage.getItem = () => { throw new Error('blocked'); };
inaccessible.defaultView.sessionStorage.setItem = () => { throw new Error('blocked'); };
bindManagerPersonCards(inaccessible, () => 'a'); inaccessible.getElementById('managerPersonToggle').click(); inaccessible.getElementById('managerPersonToggle').click();
assert(inaccessible.getElementById('managerPersonBody').hidden, 'Auch bei gesperrtem sessionStorage funktionieren zwei Klicks ohne Speicherzugriff');
for (const [raw, year, expected] of [
    ['1958-03-14', 2026, 'Für die Planung 2026 zählt das Alter am 01.01.: 67 Jahre (ab Planung 2027: 68).'],
    ['1958-01-01', 2026, 'Für die Planung 2026 zählt das Alter am 01.01.: 68 Jahre (ab Planung 2027: 69). Geburtstag am Stichtag, bereits in diesem Planungsjahr berücksichtigt.'],
    ['1960-02-29', 2027, 'Für die Planung 2027 zählt das Alter am 01.01.: 66 Jahre (ab Planung 2028: 67).'],
    ['1960-02-29', 2028, 'Für die Planung 2028 zählt das Alter am 01.01.: 67 Jahre (ab Planung 2029: 68).']
]) assertEqual(describePersonDates({ profile_geburtsdatum: raw }, year).hint, expected, 'Kalenderhinweis ' + raw + '/' + year);
const fallback = describePersonDates({ profile_aktuelles_alter: '67' }, 2026);
assert(fallback.identity.includes('Altalter') && fallback.birthMissing && fallback.suggestedBirthYear === 1958, 'Fehlendes Datum bleibt als festes Altalter mit reinem Jahresvorschlag erkennbar');
assert(describePersonDates({ profile_rentenbeginn: '2027-04-01' }, 2026).pensionStatus.includes('in 1 Jahr'), 'Künftiger Rentenbeginn behält die Jahresrechnung');
assert(describePersonDates({ profile_rentenbeginn: '2027-04-01' }, 2027).pensionStatus.includes('9 von 12 Monaten'), 'Neue Jahresbasis projiziert Rentenstatus anteilig neu');

assert(describePersonDates({ profile_rentenbeginn: '2028-07-15' }, 2026).pensionStatus.includes('Rente ab 15.07.2028 · in 2 Jahren'), 'Manager nennt künftigen Beginn und Abstand');
assert(describePersonDates({ profile_rentenbeginn: '2026-07-01' }, 2026).pensionStatus.includes('6 von 12 Monaten'), 'Manager nennt den Startjahresanteil');
assert(describePersonDates({ profile_rentenbeginn: '2026-07-01' }, 2027).pensionStatus.includes('Rente läuft'), 'Manager nennt laufende Rente im Folgejahr');

// Gesonderter Fehlerbeleg: sichtbare Regionen weichen von der Erinnerung ab.
{
    const drift = createDocument(); bindManagerPersonCards(drift, () => 'a');
    for (const card of ['Person', 'Assets', 'Care']) drift.getElementById(`manager${card}Body`).hidden = false;
    drift.getElementById('managerCardsToggleAll').click();
    assert(['Person', 'Assets', 'Care'].every(card => drift.getElementById(`manager${card}Body`).hidden), 'Erster Gesamtklick schließt tatsächlich alle offenen Regionen trotz geschlossener Erinnerung');
}

function assertCardState(doc, label) {
    const present = ['Person', 'Assets', 'Care'].filter(card => doc.getElementById(`manager${card}Body`));
    const all = present.every(card => !doc.getElementById(`manager${card}Body`).hidden);
    assertEqual(doc.getElementById('managerCardsToggleAll').attrs['aria-expanded'], String(all), label + ': Gesamt-ARIA entspricht Regionen');
    assertEqual(doc.getElementById('managerCardsToggleAll').textContent, all ? '▾ Alle Details ausblenden' : '▸ Alle Details zeigen', label + ': Gesamttext entspricht Regionen');
    for (const card of present) {
        const open = !doc.getElementById(`manager${card}Body`).hidden;
        assertEqual(doc.getElementById(`manager${card}Toggle`).attrs['aria-expanded'], String(open), label + ': Einzel-ARIA ' + card);
        assertEqual(doc.getElementById(`manager${card}Action`).textContent, open ? '▾ ausblenden' : '▸ zeigen', label + ': sichtbare Einzelaktion ' + card);
    }
}
{
    const session = new Map(), doc = createDocument(session); let profile = 'a';
    const api = bindManagerPersonCards(doc, () => profile);
    assertCardState(doc, 'Initialisierung');
    doc.getElementById('managerPersonToggle').click(); assertCardState(doc, 'Einzelöffnung');
    doc.getElementById('managerCardsToggleAll').click(); assertCardState(doc, 'Gesamtöffnung');
    doc.getElementById('managerAssetsToggle').click(); assertCardState(doc, 'Einzelschließen');
    api.openPerson(); assertCardState(doc, 'openPerson');
    doc.defaultView.location.hash = '#personendaten'; api.openTarget(); assertCardState(doc, 'Hashöffnung');
    api.sync(); assertCardState(doc, 'Rerender');
    profile = 'b'; api.sync(); assertCardState(doc, 'Profil B');
    doc.getElementById('managerCardsToggleAll').click(); assertCardState(doc, 'Profil B geöffnet');
    profile = 'a'; api.sync(); assertCardState(doc, 'A/B/A');
    const reload = createDocument(session); bindManagerPersonCards(reload, () => 'a'); assertCardState(reload, 'Sitzungsreload');
    const mixed = createDocument(); bindManagerPersonCards(mixed, () => 'a');
    mixed.getElementById('managerPersonBody').hidden = false;
    mixed.getElementById('managerCardsToggleAll').click();
    assert(['Person', 'Assets', 'Care'].every(card => !mixed.getElementById(`manager${card}Body`).hidden), 'Sichtbare Einzelöffnung wird beim Gesamtklick nicht aus Erinnerung zurückgesetzt');
    assertCardState(mixed, 'Sichtbare Einzelöffnung');
    // Nur die tatsächlich vorhandenen Regionen bestimmen den Gesamtzustand.
    const partial = createDocument(), originalLookup = partial.getElementById;
    partial.getElementById = id => id === 'managerCareBody' ? null : originalLookup(id);
    bindManagerPersonCards(partial, () => 'a'); partial.getElementById('managerCardsToggleAll').click();
    assertCardState(partial, 'Zwei vorhandene Regionen');
    const blocked = createDocument(); blocked.defaultView.sessionStorage.getItem = blocked.defaultView.sessionStorage.setItem = () => { throw new Error('blocked'); };
    const blockedApi = bindManagerPersonCards(blocked, () => 'a'); blockedApi.openPerson(); assertCardState(blocked, 'Gesperrter Sitzungsspeicher');
}

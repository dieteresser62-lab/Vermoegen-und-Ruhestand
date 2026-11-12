// IMO-1: Immobilien stehen als aufklappbare Anlageformen in der Tabelle, wie die Tranchen.
import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { installPageDialogDom, respondPageDialog } from './helpers/page-dialog-dom.mjs';
import { FakeEvent, createDocument, flush, cells } from './helpers/imo-1-dom.mjs';
import { renderTranchenTable } from '../app/tranches/tranchen-manager-renderer.js';
import { bindPersonImmobilien, applyPersonImmobilienToDom } from '../app/tranches/tranchen-manager-immobilien.js';
import { readImmobilien, writeImmobilien } from '../app/profile/profile-immobilien.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const page = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
const { elements } = tokenizeHTML(page);
const byId = id => elements.find(el => el.attrs.id === id);
const inside = (child, parent) => { for (let el = child; el; el = el.parent) if (el === parent) return true; return false; };

// Wegfall des Kapitels und Knopf oben in der Personenkarte.
for (const id of ['managerImmobilien', 'managerImmobilienTitle', 'managerImmobilienRows', 'managerImmobilienSum', 'managerImmobilienEmpty', 'managerImmobilienHeadings'])
    assert(!byId(id), `IMO-1: eigenes Immobilienkapitel entfällt (${id})`);
assert(!page.includes('Teil des Gesamtvermögens') && !page.includes('Noch keine Immobilien eingetragen'), 'IMO-1: Kapitelüberschrift und Leerhinweis entfallen');
const addButton = byId('depotAddHomeBtn');
assert(addButton?.tag === 'button' && addButton.parent.attrs.class === 'pv-heading-actions', 'IMO-1: „+ Immobilie“ steht in den Kopfaktionen der Personenkarte');
assertEqual(addButton.parent.children.filter(el => el.tag === 'button').map(el => el.attrs.id).join(','), 'depotAddTrancheBtn,depotOpenSaleEntryBtn,depotAddHomeBtn', 'IMO-1: „+ Immobilie“ steht neben Kauf und Verkauf');
assert(/id="depotAddHomeBtn"[^>]*>\+ Immobilie<\/button>/.test(page), 'IMO-1: Knopf heißt „+ Immobilie“');
assert(inside(byId('profileImmobilien'), byId('managerPersonPanel')) && byId('profileImmobilien').attrs.type === 'hidden', 'IMO-1: Datenfeld der Immobilien bleibt in der Personenansicht');
assert(page.includes('href="Handbuch.html#immobilien-eintragen"'), 'IMO-1: Handbuchhinweis zu Immobilien bleibt erreichbar');

// Verdrahtung der Seite: Tabelle liest Formularfeld und Editorzustand, Editor baut über renderDepotHistory neu.
const rendering = fs.readFileSync(new URL('../app/tranches/tranchen-manager-page/rendering.js', import.meta.url), 'utf8');
assert(rendering.includes('homeView: homes?.view()') && rendering.includes('homes?.afterRender(homeFocus)') && rendering.includes('immobilien: personHomes(values)'), 'IMO-1: Seitentabelle erhält Immobilienliste und Editorzustand');
assert(fs.readFileSync(new URL('../app/tranches/tranchen-manager-page/profile-values.js', import.meta.url), 'utf8').includes('refresh: renderPersonAssets'), 'IMO-1: Editor aktualisiert Kacheln und Tabelle über die Seite');
assert(fs.readFileSync(new URL('../app/tranches/tranchen-manager-page/controls.js', import.meta.url), 'utf8').includes("'depotAddHomeBtn'"), 'IMO-1: Kopfknopf folgt der Seitensperre');

// Bedienung mit echtem Renderer und echtem Editor auf dem Personenausschnitt der Seite.
const previousDate = getAppTestDate(), previousDocument = globalThis.document;
try {
    setAppTestDate('2026-10-20');
    const depot = page.match(/<section class="ds-card pv-depot"[\s\S]*?<\/section>/)[0];
    const doc = createDocument(`${depot}<div id="profileRentalIncome"></div><p id="profileRentalWarning" hidden></p><input id="profileEinkuenfte" type="hidden">`);
    globalThis.document = doc;
    installPageDialogDom(doc);
    const homes = [{ id: 'haus', bezeichnung: 'Haus', nutzung: 'selbst', wert: 450000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' },
        { id: 'wohnung', bezeichnung: 'Wohnung Leipzig', nutzung: 'vermietet', wert: 210000, stand: '2026-10', mieteNetto: 650, anpassung: 'inflation' }];
    const lots = [{ schemaVersion: 2, trancheId: 'etf', name: 'Welt-ETF', isin: 'XX0000000001', ticker: 'WELT', type: 'aktien_neu', category: 'equity',
        shares: 100, purchasePrice: 80, currentPrice: 100, purchaseDate: '2020-01-02', tqf: .3, taxExempt: false, marketValue: 10000, costBasis: 8000 }];
    const field = doc.getElementById('profileImmobilien'), table = doc.getElementById('tranchenTable');
    field.value = writeImmobilien(homes);
    let saves = 0, blocked = false, profileId = 'max', tranchen = lots;
    field.addEventListener('input', () => saves++);
    const view = bindPersonImmobilien(doc, { blocked: () => blocked, refresh: () => refresh() });
    function refresh() {
        const focus = view.beforeRender();
        renderTranchenTable(table, tranchen, { context: { status: 'missing' }, profileId, cash: 5000, immobilien: view.homes(), homeView: view.view() });
        view.afterRender(focus);
    }
    const group = key => table.querySelector(`[data-asset-group="${key}"]`);
    const rows = key => group(key).querySelectorAll('.pv-home-row').map(cells);
    const count = key => group(key).querySelector('summary .pv-asset-count').textContent;
    refresh();

    // Aufklappen wie Tranchen: gleicher Zeilenkopf, gleicher Pfeil, darunter die einzelnen Immobilien.
    const equity = group('aktien_neu'), self = group('homeSelf'), rented = group('homeRented');
    assert(equity && self && rented, 'IMO-1: Aktien, selbst genutzte und vermietete Immobilien sind Gruppen der Anlageformen');
    for (const home of [self, rented]) {
        assertEqual(home.localName, equity.localName, 'IMO-1: Immobilienzeile klappt wie Tranchen auf');
        assertEqual(home.children[0].children.map(el => el.className).join(' '), equity.children[0].children.map(el => el.className).join(' ').replace('pv-asset-aktien_neu', `pv-asset-${home.dataset.assetGroup}`), 'IMO-1: Zeilenkopf hat dieselben Spalten');
        assertEqual(home.querySelector('summary .pv-asset-arrow').textContent, '▸', 'IMO-1: Immobilienzeile trägt denselben Pfeil');
        assert(!home.open, 'IMO-1: Immobiliengruppe startet zugeklappt');
    }
    assertEqual(count('aktien_neu'), '1', 'IMO-1b: Aktienzeile zählt ihre Tranchen');
    assertEqual(`${count('homeSelf')}|${count('homeRented')}`, '1|1', 'IMO-1b: Spalte Tranchen zählt je Nutzung eine Immobilie');
    assert(self.querySelector('summary').textContent.replaceAll('\u00a0', ' ').includes('Immobilien selbst genutzt') && self.querySelector('summary').textContent.replaceAll('\u00a0', ' ').includes('450.000 €'), 'IMO-1: Gruppe nennt Nutzung und Wert');
    assertEqual(JSON.stringify(rows('homeSelf')), JSON.stringify([['Haus', '—', '450.000 €', '10.2026', '▸']]), 'IMO-1: selbst genutzt zeigt Bezeichnung, — statt Miete, Wert und Stand');
    assertEqual(JSON.stringify(rows('homeRented')), JSON.stringify([['Wohnung Leipzig', '650 €/Monat', '210.000 €', '10.2026', '▸']]), 'IMO-1: vermietet zeigt die Nettomiete');
    assert(group('homeRented').querySelector('table').classList.contains('ds-table'), 'IMO-1: Immobilien stehen in einer Designsystemtabelle');
    assert(table.textContent.replaceAll('\u00a0', ' ').includes('Gesamtvermögen') && table.querySelector('.pv-asset-total').textContent.replaceAll('\u00a0', ' ').includes('675.000 €'), 'IMO-1: Gesamtvermögen enthält beide Immobilien');

    // Bearbeiten über den Pfeil: gleicher Editor, gleiche Felder, Speichern über das Datenfeld.
    table.querySelector('[data-home-open="wohnung"]').click();
    assert(group('homeRented').open && group('homeRented').querySelector('.pv-home-editor'), 'IMO-1: Pfeil öffnet den Editor in der aufgeklappten Gruppe');
    assertEqual(doc.activeElement?.dataset.homeOpen, 'wohnung', 'IMO-1: Fokus bleibt nach dem Neuaufbau am Pfeil');
    assertEqual(doc.getElementById('home-bezeichnung').value, 'Wohnung Leipzig', 'IMO-1: Editor übernimmt die Bezeichnung');
    assertEqual(doc.getElementById('home-wert').value, '210.000', 'IMO-1: Editor zeigt den Wert gruppiert');
    assert(!table.querySelector('.pv-home-rent').hidden && table.querySelector('.pv-home-residence').hidden, 'IMO-1: vermietet zeigt die Mietfelder');
    assertEqual(table.querySelector('[data-home-open="wohnung"]').getAttribute('aria-expanded'), 'true', 'IMO-1: Pfeil meldet den offenen Zustand');
    assert(view.read().dirty === false, 'IMO-1: offener Editor ohne Änderung ist nicht ungespeichert');
    doc.getElementById('home-mieteNetto').value = '700';
    doc.getElementById('home-mieteNetto').dispatchEvent(new FakeEvent('input'));
    assert(view.read().dirty, 'IMO-1: geänderte Miete gilt als Entwurf');
    refresh();
    assertEqual(doc.getElementById('home-mieteNetto').value, '700', 'IMO-1: Neuaufbau der Seite erhält den Entwurf');
    table.querySelector('[data-home-action="save"]').click();
    assertEqual(readImmobilien(field.value).find(entry => entry.id === 'wohnung').mieteNetto, 700, 'IMO-1: Speichern schreibt die neue Miete ins Datenfeld');
    assertEqual(saves, 1, 'IMO-1: Speichern meldet die Änderung wie bisher an das Profil');
    assert(!table.querySelector('.pv-home-editor') && group('homeRented').open, 'IMO-1: Editor schließt, Gruppe bleibt offen');
    assertEqual(JSON.stringify(rows('homeRented')[0]), JSON.stringify(['Wohnung Leipzig', '700 €/Monat', '210.000 €', '10.2026', '▸']), 'IMO-1: Zeile zeigt die gespeicherte Miete');
    assertEqual(doc.activeElement?.dataset.homeOpen, 'wohnung', 'IMO-1: Fokus kehrt zum Pfeil der Immobilie zurück');
    const rental = doc.getElementById('profileRentalIncome');
    assert(rental.textContent.replaceAll('\u00a0', ' ').includes('Miete · Wohnung Leipzig') && rental.textContent.includes('700 €/Monat'), 'IMO-1: Mieteinnahmen-Abgleich zeigt die neue Miete unter Einkünfte');

    // „ändern“ bei den Einkünften öffnet dieselbe Zeile; Escape schließt ohne Speichern.
    rental.querySelector('[data-rental-home="wohnung"]').click();
    assert(group('homeRented').querySelector('.pv-home-editor') && doc.scrolled?.classList.contains('pv-home-editor'), 'IMO-1: Einkünftelink öffnet und zeigt den Editor');
    doc.getElementById('home-mieteNetto').value = '999';
    doc.getElementById('home-mieteNetto').dispatchEvent(new FakeEvent('input'));
    doc.getElementById('home-mieteNetto').dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    assert(!table.querySelector('.pv-home-editor') && readImmobilien(field.value).find(entry => entry.id === 'wohnung').mieteNetto === 700 && saves === 1, 'IMO-1: Escape verwirft den Entwurf');

    // „+ Immobilie“ oben legt eine vermietete Immobilie mit Miete an; ihre Gruppe klappt danach auf.
    group('homeRented').open = false;
    doc.getElementById('depotAddHomeBtn').click();
    const fresh = table.querySelector('[data-home-new]');
    assert(fresh?.querySelector('.pv-home-editor') && doc.activeElement === doc.getElementById('home-bezeichnung'), 'IMO-1: Kopfknopf öffnet den Editor für eine neue Immobilie');
    assertEqual(doc.getElementById('home-stand').value, '10.2026', 'IMO-1: neuer Stand ist der Testmonat');
    for (const [id, value] of [['home-bezeichnung', 'Garage'], ['home-wert', '25000']]) {
        doc.getElementById(id).value = value; doc.getElementById(id).dispatchEvent(new FakeEvent('input'));
    }
    table.querySelector('[data-home-choice="nutzung"][data-value="vermietet"]').click();
    assert(!table.querySelector('.pv-home-rent').hidden, 'IMO-1: Nutzung vermietet zeigt die Mietfelder');
    doc.getElementById('home-mieteNetto').value = '80';
    doc.getElementById('home-mieteNetto').dispatchEvent(new FakeEvent('input'));
    doc.getElementById('home-mieteNetto').dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    await flush();
    const garage = readImmobilien(field.value).find(entry => entry.bezeichnung === 'Garage');
    assert(garage?.nutzung === 'vermietet' && garage.wert === 25000 && garage.mieteNetto === 80 && saves === 2, 'IMO-1: neue vermietete Immobilie mit Miete gespeichert');
    assert(!table.querySelector('[data-home-new]') && rows('homeRented').some(row => row[0] === 'Garage' && row[1] === '80 €/Monat'), 'IMO-1: neue Immobilie erscheint in ihrer Gruppe');
    assert(group('homeRented').open && doc.activeElement?.dataset.homeOpen === garage.id, 'IMO-1: Gruppe der neuen Immobilie ist offen, Fokus an ihrem Pfeil');
    assertEqual(`${count('homeSelf')}|${count('homeRented')}`, '1|2', 'IMO-1b: zwei vermietete Immobilien zählen zwei');

    // Fehler bleiben am Feld; Abbrechen verwirft die neue Zeile.
    doc.getElementById('depotAddHomeBtn').click();
    table.querySelector('[data-home-action="save"]').click();
    assert(table.querySelector('[data-home-error="bezeichnung"]').textContent.length > 0 && readImmobilien(field.value).length === 3, 'IMO-1: leere Bezeichnung bleibt Feldfehler');
    table.querySelector('[data-home-open]').click();
    assertEqual(table.querySelector('#home-save-status').textContent, 'Bitte zuerst speichern oder abbrechen.', 'IMO-1: offene neue Zeile sperrt andere Zeilen');
    table.querySelector('[data-home-action="cancel"]').click();
    assert(!table.querySelector('[data-home-new]') && saves === 2, 'IMO-1: Abbrechen verwirft die neue Zeile');

    // Löschen über den Editor mit Rückfrage; die letzte selbst genutzte Immobilie nimmt ihre Gruppe mit.
    table.querySelector('[data-home-open="haus"]').click();
    table.querySelector('[data-home-action="remove"]').click();
    await respondPageDialog(doc, 'accept');
    await flush();
    assert(!readImmobilien(field.value).some(entry => entry.id === 'haus') && saves === 3, 'IMO-1: Entfernen löscht die Immobilie nach Rückfrage');
    assert(!group('homeSelf') && group('homeRented'), 'IMO-1: leere Nutzung zeigt keine Immobilienzeile');

    // Gesperrte Seite öffnet keinen Editor.
    blocked = true;
    table.querySelector('[data-home-open="wohnung"]').click();
    doc.getElementById('depotAddHomeBtn').click();
    assert(!table.querySelector('.pv-home-editor'), 'IMO-1: gesperrte Seite öffnet keinen Editor');
    blocked = false;

    // Personenwechsel: andere Person ohne Immobilie, offene Gruppen und Entwürfe gelten nicht weiter.
    table.querySelector('[data-home-open="wohnung"]').click();
    view.discard();
    profileId = 'erika'; tranchen = [];
    applyPersonImmobilienToDom([], doc);
    refresh();
    assert(!table.querySelector('[data-asset-group^="home"]') && !table.querySelector('.pv-home-editor'), 'IMO-1: Person ohne Immobilie hat keine Immobilienzeile');
    assert(doc.getElementById('depotAddHomeBtn') && !doc.getElementById('depotAddHomeBtn').hidden, 'IMO-1: Person ohne Immobilie behält den Knopf oben');
    assertEqual(doc.getElementById('profileRentalIncome').textContent, '', 'IMO-1: ohne Immobilie keine Mieteinnahme unter Einkünfte');
    doc.getElementById('depotAddHomeBtn').click();
    assert(table.querySelector('[data-home-new] .pv-home-editor'), 'IMO-1: erste Immobilie lässt sich ohne vorhandene Zeile anlegen');
    view.discard();
    assert(!table.querySelector('[data-home-new]') && !view.read().draft, 'IMO-1: Verwerfen beim Personenwechsel schließt den Editor');
    profileId = 'max';
    applyPersonImmobilienToDom(homes, doc);
    refresh();
    assert(!group('homeRented').open, 'IMO-1: offene Gruppen der vorherigen Person gelten nicht für die nächste');
    applyPersonImmobilienToDom([...homes, { ...homes[0], id: 'ferienhaus', bezeichnung: 'Ferienhaus', wert: 150000 }], doc);
    refresh();
    assertEqual(`${count('homeSelf')}|${count('homeRented')}`, '2|1', 'IMO-1b: zwei selbst genutzte Immobilien zählen zwei');
} finally {
    setAppTestDate(previousDate);
    globalThis.document = previousDocument;
}

// Vertragstest der Fassade tranchen-manager-page: Immobilientabelle, Kacheln und Entwürfe bleiben einheitlich (IMO-1c).
// IMO-1c: Kacheln, Anzahl und Tabelle zeigen nach dem Speichern einer Immobilie denselben Stand;
// angefangener Betragstext übersteht den Neuaufbau der Tabelle.
import fs from 'node:fs';
import { FakeEvent, createDocument } from './helpers/imo-1-dom.mjs';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { state } from '../app/tranches/tranchen-manager-page/state.js';
import { renderPersonAssets } from '../app/tranches/tranchen-manager-page/rendering.js';
import { bindPersonImmobilien } from '../app/tranches/tranchen-manager-immobilien.js';
import { bindDecimalInputDisplay } from '../app/tranches/tranchen-manager-decimal-input.js';
import { IMMOBILIEN_KEY, readImmobilien, writeImmobilien } from '../app/profile/profile-immobilien.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const page = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
const depot = page.match(/<section class="ds-card pv-depot"[\s\S]*?<\/section>/)[0];
const homes = [{ id: 'haus', bezeichnung: 'Haus', nutzung: 'selbst', wert: 450000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' },
    { id: 'wohnung', bezeichnung: 'Wohnung Leipzig', nutzung: 'vermietet', wert: 210000, stand: '2026-10', mieteNetto: 650, anpassung: 'inflation' }];
const lots = [{ schemaVersion: 2, trancheId: 'etf', name: 'Welt-ETF', isin: 'XX0000000001', ticker: 'WELT', type: 'aktien_neu', category: 'equity',
    shares: 100, purchasePrice: 80, currentPrice: 100, purchaseDate: '2020-01-02', tqf: .3, taxExempt: false, marketValue: 10000, costBasis: 8000 }];
const text = el => el.textContent.replaceAll('\u00a0', ' ').trim();
const previous = { date: getAppTestDate(), document: globalThis.document, tranchen: state.tranchen, profileId: state.profileId, immobilien: state.immobilien };
try {
    setAppTestDate('2026-10-20');
    resetPersistenceForTests({ async loadAll() { return { profile_tagesgeld: '5000', [IMMOBILIEN_KEY]: writeImmobilien(homes) }; }, async saveBatch() {} });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createDocument(`${depot}<div id="profileRentalIncome"></div>`);
    globalThis.document = doc;
    bindDecimalInputDisplay(doc);
    const field = doc.getElementById('profileImmobilien'), table = doc.getElementById('tranchenTable');
    field.value = writeImmobilien(homes);
    Object.assign(state, { tranchen: lots, profileId: 'max' });
    // Wie bindProfileValueInputs: Editoraktionen bauen Kacheln und Tabelle über die Seite neu.
    state.immobilien = bindPersonImmobilien(doc, { refresh: renderPersonAssets });
    renderPersonAssets();
    const tile = metric => text(doc.querySelector(`#stats [data-wealth-metric="${metric}"] .stat-value`));
    const tableTotal = () => text(table.querySelector('.pv-asset-total').children[3]);
    const count = () => text(doc.getElementById('managerDepotCount'));
    assertEqual(`${tile('total')}|${tableTotal()}`, '675.000 €|675.000 €', 'IMO-1c: Ausgangsstand gleich in Kachel und Tabelle');

    // Befund 1: Haus auf 500.000 € ändern; kein Autosave (wie bei einem ungültigen anderen Profilfeld).
    table.querySelector('[data-home-open="haus"]').click();
    doc.getElementById('home-wert').value = '500000';
    doc.getElementById('home-wert').dispatchEvent(new FakeEvent('input'));
    table.querySelector('[data-home-action="save"]').click();
    assertEqual(readImmobilien(P.getItemSync(IMMOBILIEN_KEY)).find(entry => entry.id === 'haus').wert, 450000, 'IMO-1c: Speicher noch ohne Autosave');
    assertEqual(`${tile('total')}|${tableTotal()}`, '725.000 €|725.000 €', 'IMO-1c: Gesamtvermögen in Kachel und Tabelle gleich (Gutachten 725.000 € gegen 675.000 €)');
    assertEqual(tile('homes'), '710.000 €', 'IMO-1c: Immobilienkachel zeigt denselben Stand');
    assertEqual(count(), 'Tagesgeld, 1 Tranche und 2 Immobilien', 'IMO-1c: Anzahl zeigt denselben Stand');
    doc.getElementById('depotAddHomeBtn').click();
    for (const [id, value] of [['home-bezeichnung', 'Garage'], ['home-wert', '25000']]) {
        doc.getElementById(id).value = value; doc.getElementById(id).dispatchEvent(new FakeEvent('input'));
    }
    table.querySelector('[data-home-action="save"]').click();
    assertEqual(`${tile('total')}|${tableTotal()}|${count()}`, '750.000 €|750.000 €|Tagesgeld, 1 Tranche und 3 Immobilien', 'IMO-1c: neue Immobilie erscheint überall zugleich');

    // Befund 2: angefangener Text in Betragsfeldern übersteht den Neuaufbau samt Cursor.
    table.querySelector('[data-home-open="wohnung"]').click();
    const wert = () => doc.getElementById('home-wert');
    wert().click();
    assertEqual(wert().value, '210000', 'IMO-1c: Fokus zeigt den Betrag ungruppiert zum Bearbeiten');
    for (const [typed, caret] of [['12,', 3], ['12,5', 4], ['1e', 2], ['', 0]]) {
        wert().value = typed; wert().setSelectionRange(caret, caret);
        wert().dispatchEvent(new FakeEvent('input'));
        renderPersonAssets();
        assertEqual(wert().value, typed, `IMO-1c: Neuaufbau erhält den Text „${typed}“`);
        assert(doc.activeElement === wert() && wert().selectionStart === caret && wert().selectionEnd === caret, `IMO-1c: Neuaufbau erhält Fokus und Cursor bei „${typed}“`);
    }
    wert().value = '12,5'; wert().dispatchEvent(new FakeEvent('input'));
    renderPersonAssets();
    assertEqual(doc.getElementById('home-mieteNetto').value, '650', 'IMO-1c: unberührtes Betragsfeld behält seine Anzeige');
    table.querySelector('[data-home-action="save"]').click();
    const wohnung = readImmobilien(field.value).find(entry => entry.id === 'wohnung');
    assert(wohnung.wert === 12.5 && wohnung.mieteNetto === 650, 'IMO-1c: Umwandlung erst beim Speichern, 12,5 bleibt 12,5');

    // Gruppierte Anzeige eines unberührten Betrags bleibt nach dem Neuaufbau derselbe Wert.
    table.querySelector('[data-home-open="haus"]').click();
    assertEqual(wert().value, '500.000', 'IMO-1c: Editor zeigt den Betrag gruppiert');
    doc.getElementById('home-bezeichnung').value = 'Haus am See';
    doc.getElementById('home-bezeichnung').dispatchEvent(new FakeEvent('input'));
    renderPersonAssets();
    assert(wert().value === '500.000' && doc.getElementById('home-bezeichnung').value === 'Haus am See', 'IMO-1c: Neuaufbau erhält Bezeichnung und gruppierten Betrag');
    table.querySelector('[data-home-action="save"]').click();
    const haus = readImmobilien(field.value).find(entry => entry.id === 'haus');
    assert(haus.wert === 500000 && haus.bezeichnung === 'Haus am See', 'IMO-1c: gruppierter Betrag bleibt 500.000 € und nicht 500 €');

    // Neuer Entwurf beginnt ohne alten Text.
    table.querySelector('[data-home-open="wohnung"]').click();
    assertEqual(wert().value, '12,5', 'IMO-1c: neu geöffneter Editor zeigt den gespeicherten Wert, keinen alten Entwurfstext');
} finally {
    setAppTestDate(previous.date);
    globalThis.document = previous.document;
    Object.assign(state, { tranchen: previous.tranchen, profileId: previous.profileId, immobilien: previous.immobilien });
    resetPersistenceForTests();
}

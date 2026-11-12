// FR-72 Teil 4 (HE-4): Oberfläche und Protokoll zur Heimpflege. Kostenstaffel (Punkt 6), Texte im Pflegebereich,
// Jahresabschluss „Pflegewerte prüfen“, Protokoll-ⓘ mit getrennten Posten und gespeichertem Jahreszustand.
import { readFileSync } from 'node:fs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initializePflegeUIControls, PFLEGE_COST_PRESETS, PFLEGE_CUSTOM_COSTS_KEY } from '../app/simulator/simulator-ui-pflege.js';
import { renderCareTodaySummary } from '../app/simulator/simulator-care-today-ui.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { PROTOCOL_COLUMNS, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const plain = text => String(text).replaceAll(' ', ' ');
const prior = { document: globalThis.document, window: globalThis.window };
async function restart(records) {
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'HE-4 Staffel', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    globalThis.document = simulatorDocument();
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initializePflegeUIControls();
    const field = id => document.getElementById(id);
    return { field, store, select: field('pflegeKostenStaffelPreset'),
        costs: () => [1, 2, 3, 4, 5].map(grade => field(`pflegeStufe${grade}Zusatz`).value).join('/') };
}
const change = (element, value) => { element.value = value; element.dispatchEvent(new Event('change')); };
const reason = field => field.ownerDocument.getElementById(field.getAttribute('aria-describedby')?.split(' ').at(-1))?.textContent ?? '';

try {
    // Punkt 6: Zeilen „im Heim“ ruhen mit Hinweis, andere Formen und „Amtlich“ bleiben bearbeitbar.
    let ui = await restart({ sim_pflegeKostenStaffelPreset: 'custom' });
    const grade4 = ui.field('pflegeStufe4Zusatz'), grade3 = ui.field('pflegeStufe3Zusatz');
    assert(grade4.disabled && grade4.getAttribute('data-field-state') === 'inactive' && reason(grade4) === 'aus den Pflegewerten',
        'Staffel: Grad 4 „im Heim“ ist inaktiv mit „aus den Pflegewerten“');
    assert(!grade3.disabled && grade3.getAttribute('data-field-state') !== 'inactive', 'Staffel: Grad 3 zu Hause bleibt bearbeitbar');
    change(ui.field('pflegeStufe4Form'), 'home-support');
    assert(!grade4.disabled && grade4.getAttribute('data-field-state') === 'editable' && reason(grade4) === '', 'Staffel: Form zu Hause gibt das Feld frei');
    change(ui.field('pflegeStufe3Form'), 'residential');
    assert(grade3.disabled && reason(grade3) === 'aus den Pflegewerten', 'Staffel: Grad 3 „im Heim“ ruht');
    change(ui.select, 'amtlich');
    assert(!ui.field('pflegeStufe5Zusatz').disabled, 'Staffel: „Amtlich“ hat keine Formzeilen und keine ruhenden Felder');

    // Punkt 6: „Stationär (Premium)“ entfällt; Gespeichertes wird beim Lesen zu „Individuelle Werte“ ohne Schreiben.
    assert(!Object.hasOwn(PFLEGE_COST_PRESETS, 'stationaer'), 'Vorgabe „Stationär (Premium)“ entfällt');
    assert(!readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8').includes('value="stationaer"'), 'Auswahl ohne „Stationär (Premium)“');
    const stored = { sim_pflegeKostenStaffelPreset: 'stationaer', sim_pflegeStufe1Zusatz: '45000', sim_pflegeStufe2Zusatz: '60000',
        sim_pflegeStufe3Zusatz: '75000', sim_pflegeStufe4Zusatz: '90000', sim_pflegeStufe5Zusatz: '105000', sim_pflegeStufe3Form: 'family',
        sim_pflegeStufe2FlexCut: '80', sim_pflegeStufe4Mortality: '3.5', [PFLEGE_CUSTOM_COSTS_KEY]: JSON.stringify({ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }) };
    ui = await restart(stored);
    assertEqual(ui.select.value, 'custom', 'Gespeichertes „stationaer“ erscheint als „Individuelle Werte“');
    assertEqual(ui.costs(), '45000/60000/75000/90000/105000', 'Die fünf gespeicherten Beträge bleiben, gemerkte Beträge überschreiben sie nicht');
    assertEqual([ui.field('pflegeStufe3Form').value, ui.field('pflegeStufe2FlexCut').value, ui.field('pflegeStufe4Mortality').value].join('/'), 'family/80/3.5',
        'Formen, Flex- und Sterblichkeitswerte bleiben');
    await P.flush();
    assertEqual(ui.store.get('sim_pflegeKostenStaffelPreset'), 'stationaer', 'Keine Schreib-Migration beim Start');
    assertEqual(ui.store.get(PFLEGE_CUSTOM_COSTS_KEY), stored[PFLEGE_CUSTOM_COSTS_KEY], 'Gemerkte Beträge unverändert beim Start');
    change(ui.select, 'ambulant');
    change(ui.select, 'custom');
    assertEqual(ui.costs(), '45000/60000/75000/90000/105000', 'Nach Wechsel und Rückkehr kommen die bisherigen Beträge als eigene Werte zurück');
    await P.flush();
    assertEqual(ui.store.get('sim_pflegeKostenStaffelPreset'), 'custom', 'Erst eine Wahl speichert „Individuelle Werte“');

    // Texte im Pflegebereich.
    const page = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    assert(/id="pflegeFormHint">[^<]*ersetzen Heimkosten den Anteil der Person am Grundbedarf[^<]*Grad 2–5[^<]*Heimjahren/.test(page), 'Hinweis zur Ersatzrechnung unter der Staffel');
    assert(page.includes('auch private Krankenversicherung') && page.includes('Extras für bessere Pflege'), '„Eigene Ausgaben im Heim“ erklärt');
    assert(page.includes('Nur für Pflege zu Hause, je Person. Heimkosten sind nicht gedeckelt.'), 'Maximaler Pflege-Floor: nur zu Hause, je Person');
    assert(PFLEGE_COST_PRESETS.amtlich.description.includes('zieht künftige Heimformen'), '„Amtlich“ zieht die Form');
    assert(ui.field('pflegeMaxFloor').title.includes('je Person'), 'Deckel-Titel nennt „je Person“');

    // Fable HE-3 B1: heute im Heim, auch per Vorgabe, ist Bestand und sichtbar.
    const summary = {}, simulator = { getElementById: id => id === 'simCareTodaySummary' ? summary : null };
    renderCareTodaySummary(simulator, { simulationPeople: [{ name: 'Werner' }], partner: { aktiv: false }, careToday: { grade: 4, form: 'residential' } });
    assert(summary.textContent.includes('Werner Grad 4 im Heim') && summary.textContent.includes('Heimkosten und eigene Ausgaben berechnet der Simulator'), 'FR-73: heutige Heimkosten automatisch');
    renderCareTodaySummary(simulator, { simulationPeople: [{ name: 'Werner' }], partner: { aktiv: false }, careToday: { grade: 3, form: 'family' } });
    assert(!summary.textContent.includes('Heimkosten'), 'Simulator: ohne Heim kein Bestandshinweis');
    const dom = { profileCareGradeToday: { value: '5' }, profileCareFormToday: { value: '' }, profileCareAllowanceSummary: {} };
    syncManagerCareToday({ getElementById: id => dom[id] ?? null }, { getItem: () => null });
    assertEqual(dom.profileCareFormToday.value, 'residential', 'Personenkarte: Grad 5 ohne Wahl ist „im Heim“');
    assert(dom.profileCareAllowanceSummary.textContent.startsWith('Angesetzt: Heimkosten nach Heimjahr und eigene Ausgaben'), 'Personenkarte: automatische Heimkosten sichtbar (UR-1: Ergebniszeile)');
    assert(readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8').includes('Ohne eigene Wahl gilt bei Grad 4–5 „im Heim“'), 'Personenkarte nennt die Vorgabe');
} finally {
    globalThis.document = prior.document; globalThis.window = prior.window; P.resetPersistenceForTests();
}

// Jahresabschluss: Der Heimwert gilt für jede Heimpflege; drei Bestandteile; Heimjahre ohne Umbruch im Eintrag.
{
    const records = new Map();
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: key => records.delete(key) };
    const { doc } = createDialogFixture();
    const care = createAnnualCareEditor({ doc, targetYear: 2026, storage, listen: (node, type, fn) => node.addEventListener(type, fn) });
    const home = care.root.querySelector('.annual-care-home');
    const homeText = home.children.map(child => child.textContent).join(' ');
    assert(!homeText.includes('nur für die Staffel') && homeText.includes('für jede Heimpflege'), 'Heimwert gilt für jede Heimpflege');
    assertEqual(care.root.querySelector('[data-annual-care-home-parts]').textContent,
        'Je Monat vor Zuschuss: Pflegeanteil 2.088 € · Unterkunft und Verpflegung 1.068 € · Investitionskosten 521 €', 'Drei Bestandteile sichtbar');
    assertEqual(care.root.querySelector('[data-annual-care-home-years]').textContent,
        'Nach Zuschuss der Kasse: 1. Jahr 3.364 € · 2. Jahr 3.051 € · 3. Jahr 2.633 € · ab 4. Jahr 2.111 €',
        'Heimjahre: Umbruch nur zwischen den Einträgen');
}

// Punkt 18: Ausgaben-ⓘ mit getrennten Posten und je Person Grad, Form, Heimjahr und Zuschuss; Kostenänderung negativ.
{
    const inputs = { partner: { aktiv: true }, simulationPeople: [{ name: 'Werner' }, { name: 'Helga' }],
        pflegeGradeConfigs: { 3: { careForm: 'home-support' }, 4: { careForm: 'residential' } } };
    const heim = (jahr, costs, subsidy) => ({ jahr, floor_brutto: 27000 + costs + 6000, grundbedarf_zu_hause: 27000, pflege_zusatz_floor: 0,
        pflege_heimkosten: costs, pflege_heim_eigene_ausgaben: 6000, Person1Alive: 1, Person2Alive: 1,
        CareP1_Active: 1, CareP1_Grade: 4, CareP1_Cost: costs + 6000, CareP1_Form: 'residential', CareP1_HeimJahr: jahr,
        CareP1_HeimZuschuss: subsidy, CareP1_HeimKosten: costs, CareP1_HeimEigeneAusgaben: 6000, CareP2_Active: 0, CareP2_Cost: 0 });
    const rows = [heim(1, 40368, .15), heim(2, 36612, .3)];
    const html = plain(renderProtocolTable(rows, { source: 'mc', inputs }));
    for (const label of ['Grundbedarf zu Hause', 'Heimkosten', 'Eigene Ausgaben im Heim']) assert(html.includes(`<span>${label}</span>`), `Ausgaben-ⓘ: ${label} getrennt`);
    assert(html.includes('Werner: Grad 4, im Heim, Heimjahr 2, Zuschuss der Kasse 30 % auf den Pflegeanteil,'), 'Ausgaben-ⓘ: Form, Heimjahr und Zuschussstufe je Person');
    assert(html.includes('kein Pflegegeld: im Heim, die Kasse zahlt an das Heim'), 'Einnahmen-ⓘ: Heimgrund aus dem Jahreszustand');
    assert(html.includes('Heimjahr 2, Zuschuss der Kasse 30 % auf den Pflegeanteil, Heimkosten -3.756 € gegenüber dem Vorjahr.'), 'Kostenänderung darf negativ sein (Zuschuss im zweiten Heimjahr)');
    assert(!html.includes('Heimjahr 1, Zuschuss der Kasse 15 % auf den Pflegeanteil, Heimkosten'), 'Erstes Heimjahr ohne Vorjahresvergleich');
    const real = plain(renderProtocolTable(rows.map((row, index) => ({ ...row, inflation_factor_cum: index ? 1.1 : 1 })), { source: 'mc', inputs, moneyBasis: 'real' }));
    assert(real.includes('Heimkosten -7.084 € gegenüber dem Vorjahr'), 'Änderung in heutiger Kaufkraft: 36.612 / 1,1 − 40.368');
    const column = id => PROTOCOL_COLUMNS.find(item => item.id === id);
    assert(column('pflege-zusatz-floor-delta').explanation.includes('nie negativ') && column('pflege').explanation.includes('eingesparte Grundbedarf')
        && column('floor-brutto').explanation.includes('Heimkosten') && column('carep1-cost').explanation.includes('im Todesjahr die Hälfte'), 'Summenspalten erklären ihre Bedeutung');
    assertEqual(readProtocolValue(column('pflege'), rows[1], { source: 'mc' }), 42612, 'Pflegekosten gesamt mit Heimposten');

    // Bestand und „Amtlich“: Hinweise lesen den gespeicherten Jahreszustand (Gutachten HE-3, B3).
    const bestand = { ...heim(1, 0, 0), floor_brutto: 70000, grundbedarf_zu_hause: 70000, pflege_heimkosten: undefined, pflege_heim_eigene_ausgaben: undefined,
        CareP1_HeimJahr: undefined, CareP1_HeimBestand: true, CareP1_Cost: 0 };
    assert(plain(renderProtocolTable([bestand], { source: 'mc', inputs })).includes('Werner: Grad 4, heute schon im Heim, die Heimkosten stecken im Grundbedarf.'), 'Bestand im ⓘ');
    const official = { ...inputs, pflegeKostenStaffelPreset: 'amtlich' };
    const atHome = { jahr: 1, floor_brutto: 36000, Person1Alive: 1, Person2Alive: 1, CareP1_Active: 1, CareP1_Grade: 4, CareP1_Cost: 0, CareP1_Form: 'home-support', CareP2_Active: 0 };
    const homeHtml = plain(renderProtocolTable([atHome], { source: 'mc', inputs: official }));
    assert(homeHtml.includes('Werner: Grad 4, zu Hause mit externer Unterstützung.') && !homeHtml.includes('Werner: Grad 4, im Heim') && !homeHtml.includes('kein Pflegegeld: im Heim'), 'Amtlich: gezogene Form zu Hause aus dem Jahreszustand, nicht aus Grad und Vorgabe');
    assert(homeHtml.includes('im amtlichen Durchschnitt bereits verrechnet'), 'Amtlich zu Hause: Pflegegeldgrund wie bisher');
    const drawnHeim = plain(renderProtocolTable([{ ...heim(1, 40368, .15) }], { source: 'mc', inputs: official }));
    assert(drawnHeim.includes('kein Pflegegeld: im Heim'), 'Amtlich im Heim: Heimgrund statt Durchschnitt');
    const older = plain(renderProtocolTable([{ ...atHome, CareP1_Form: undefined }], { source: 'mc', inputs: official }));
    assert(older.includes('Werner: Grad 4, Form im amtlichen Durchschnitt enthalten.'), 'Ältere Amtlich-Läufe ohne gezogene Form erfinden keine Form');
}

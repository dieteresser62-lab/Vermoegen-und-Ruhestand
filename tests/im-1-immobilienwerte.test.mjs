// IM-1 (FR-85, Nutzer 16.11.2026): Immobilienwert im Jahresabschluss fortschreiben, mit Wertverlauf je Immobilie.
// Sollfälle der Steuerung: Max und Erika „Haus und vermietete Wohnung“, Abschluss 2026 am 02.01.2027 mit 2,5 % Inflation;
// Martin und Petra; Renate ohne Immobilien unverändert; alte Sicherung ohne Wertverlauf.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { IMMOBILIEN_KEY, readImmobilien, readImmobilienRecord, writeImmobilien, writeImmobilienMitVerlauf, immobilienWertverlauf, immobilienErrors } from '../app/profile/profile-immobilien.js';
import { readAnnualProperties, applyAnnualPropertyValues, annualPropertyProposal } from '../app/shared/annual-property-values.js';
import { createAnnualPropertyEditor } from '../app/shared/annual-property-editor.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { withPropertyHistory } from '../app/shared/wealth-display.js';
import { saveProfileAssetValues, loadProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { createAnnualCloseSession } from '../app/shared/annual-close-session.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';

const STATE_KEY = 'ruhestandsmodellValues_v29_guardrails';
const now = () => new Date('2027-01-02T12:00:00Z');
const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2.5 } };
const listen = (node, type, fn) => node.addEventListener(type, fn);
// DOM-Doppel: Text aller Kinder einsammeln.
const textOf = node => [node.textContent || '', ...[...(node.children || node.childNodes || [])].map(textOf)].join(' ').replaceAll('\u00a0', ' ');
const homesOf = (records, id) => readImmobilienRecord(JSON.parse(records.rs_profiles_v1).profiles[id].data[IMMOBILIEN_KEY]);
const people = records => Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([id, profile]) => ({ id, name: profile.meta.name }));
/** Beispielhaushalt am 15.12.2026 angelegt, Jahresabschluss 2026 am 02.01.2027 vorbereitet. */
function closingRecords(household, variant = 'grund') {
    const records = createMusterHaushaltRecords('2026-12-15', household, variant);
    const state = JSON.parse(records[STATE_KEY]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'im1-before', phase: 'writes_started' };
    records[STATE_KEY] = JSON.stringify(state);
    return records;
}
function close(records, options = {}) {
    setAppTestDate('2026-12-15');
    try {
        const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
        return { ...records, ...prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now, ...options }).records };
    } finally { setAppTestDate(null); }
}
/** Schritt wie im Dialog: Inflation setzen, unverändert bestätigen oder Werte ändern. */
async function editor(records, changes = null) {
    const { doc } = createDialogFixture();
    const step = createAnnualPropertyEditor({ doc, targetYear: 2026, people: people(records), storage: annualRecordStorage(records), listen });
    doc.body.append(step.root);
    step.setInflation(2.5);
    if (changes) {
        await step.root.querySelector('[data-annual-property-edit]').fire('click');
        for (const [id, [value, reason]] of Object.entries(changes)) {
            const input = step.root.querySelector(`[data-annual-property-value="${id}"]`), grund = step.root.querySelector(`[data-annual-property-reason="${id}"]`);
            input.value = value; await input.fire('input'); grund.value = reason; await grund.fire('input');
        }
        await step.root.querySelector('[data-annual-property-accept]').fire('click');
    } else await step.root.querySelector('[data-annual-property-confirm]').fire('click');
    return step;
}

// 1. Speicherform: Alte Records bleiben gültig und bytegleich; nur eine Wertänderung ergänzt den Verlauf.
{
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika', 'immobilien');
    const raw = JSON.parse(records.rs_profiles_v1).profiles.muster_a.data[IMMOBILIEN_KEY];
    const [haus] = readImmobilien(raw);
    assertEqual(haus.wertverlauf, undefined, 'Beispielhaushalt schreibt keinen Wertverlauf (keine Schreib-Migration)');
    assertEqual(JSON.stringify(immobilienWertverlauf(haus)), JSON.stringify([{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }]), 'Fehlender Verlauf: heutiger Wert ab seinem Stand, nur beim Lesen');
    assertEqual(writeImmobilienMitVerlauf(raw, readImmobilien(raw), '2027-01-05'), raw, 'Speichern ohne Wertänderung bleibt bytegleich');
    const renamed = readImmobilienRecord(writeImmobilienMitVerlauf(raw, [{ ...haus, bezeichnung: 'Elternhaus' }], '2027-01-05')).entries[0];
    assertEqual(renamed.wertverlauf, undefined, 'Nur andere Felder geändert: kein Eintrag');
    const changed = readImmobilienRecord(writeImmobilienMitVerlauf(raw, [{ ...haus, wert: 470000 }], '2027-01-05')).entries[0];
    assertEqual(JSON.stringify(changed.wertverlauf), JSON.stringify([{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }, { datum: '2027-01-05', wert: 470000, herkunft: 'eingabe' }]),
        'Wertänderung: Eintrag mit Tagesdatum, Herkunft Eingabe; der bisherige Wert bleibt davor stehen');
    const removed = readImmobilienRecord(writeImmobilienMitVerlauf(raw, [], '2027-01-05'));
    assertEqual(removed.entries.length, 0, 'Entfernte Immobilie erscheint nicht mehr');
    assertEqual(JSON.stringify(removed.beendet), JSON.stringify([{ id: 'muster-haus', bezeichnung: 'Haus', nutzung: 'selbst', ende: '2027-01-05',
        wertverlauf: [{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }] }]), 'Entfernen: beendeter Verlauf mit Ende am Tag des Entfernens');
    let rejected = false;
    try { readImmobilien(JSON.stringify({ schemaVersion: 1, entries: [{ ...haus, wertverlauf: [{ datum: '2026-12-30', wert: 1, herkunft: 'jahresabschluss' }] }] })); } catch { rejected = true; }
    assert(rejected, 'Ein Jahresabschluss-Eintrag liegt immer auf dem 31.12.');
    // Personen & Vermögen: Speichern über den echten Profilwriter.
    const live = { ...JSON.parse(records.rs_profiles_v1).profiles.muster_a.data };
    const storage = { getItem: key => live[key] ?? null, setItem: (key, value) => { live[key] = String(value); } };
    const values = loadProfileAssetValues(storage);
    saveProfileAssetValues({ ...values, immobilien: values.immobilien.map(home => ({ ...home, wert: 455000 })) }, storage, { date: '2027-01-03' });
    assertEqual(readImmobilien(live[IMMOBILIEN_KEY])[0].wertverlauf.at(-1).datum, '2027-01-03', 'Personen & Vermögen speichert den Eintrag mit dem Tagesdatum');
    saveProfileAssetValues({ ...loadProfileAssetValues(storage), immobilien: [] }, storage, { date: '2027-01-04' });
    assertEqual(readImmobilienRecord(live[IMMOBILIEN_KEY]).beendet[0].ende, '2027-01-04', 'Personen & Vermögen behält den Verlauf entfernter Immobilien');
    saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 1234 }, storage, { date: '2027-01-05' });
    assertEqual(readImmobilienRecord(live[IMMOBILIEN_KEY]).beendet.length, 1, 'Späteres Speichern verliert beendete Verläufe nicht');
}

// 2. Sollfall Max und Erika: Vorschläge, Abschluss, Stand für den Simulator, eigener Wert mit Grund.
let booked;
{
    const records = closingRecords('max-erika', 'immobilien');
    const rows = readAnnualProperties({ storage: annualRecordStorage(records), people: people(records), targetYear: 2026 });
    assertEqual(rows.map(row => `${row.bezeichnung}·${row.name}:${row.base}→${annualPropertyProposal(row.base, 2.5)}`).join(' | '),
        'Haus·Max:450000→461250 | Vermietete Wohnung·Erika:210000→215250', 'Vorschläge Haus 461.250 €, Wohnung 215.250 €');
    const before = JSON.stringify(records);
    const step = await editor(records);
    assertEqual(JSON.stringify(records), before, 'Bestätigen im Schritt schreibt nichts');
    const text = textOf(step.root);
    for (const part of ['Fortgeschrieben zum 31.12.2026: bisheriger Wert plus Inflation 2,5 %, auf ganze Euro gerundet.', 'Haus · Max', 'Wert bisher', 'Inflation 2026',
        'Wert zum 31.12.2026', '461.250 €', '+ 11.250 €', '215.250 €', '+ 5.250 €', 'So erscheint es im Vermögensverlauf', 'bisheriger Wert 660.000 €', 'neuer Wert ab 31.12.2026', '676.500 €'])
        assert(text.includes(part), `Schritt zeigt „${part}“ (${text.slice(0, 400)})`);
    assert(step.read().confirmed && step.root.querySelector('[data-annual-property-confirm]').textContent === 'Bestätigt', 'Unverändert bestätigen erledigt den Schritt');
    assert(step.setInflation(2.6) && !step.read().confirmed, 'Geänderte Inflation hebt die Bestätigung auf');
    step.setInflation(2.5); await step.root.querySelector('[data-annual-property-confirm]').fire('click');
    booked = close(records, { propertyValues: step.accept() });
    const haus = homesOf(booked, 'muster_a').entries[0], wohnung = homesOf(booked, 'muster_b').entries[0];
    assertEqual(`${haus.wert}/${haus.stand}/${wohnung.wert}`, '461250/2027-01/215250', 'Abschluss setzt neuen Wert und Stand Januar 2027');
    assertEqual(JSON.stringify(haus.wertverlauf.at(-1)), JSON.stringify({ datum: '2026-12-31', wert: 461250, herkunft: 'jahresabschluss' }), 'Eintrag zum 31.12.2026, Herkunft Jahresabschluss');
    assertEqual(booked[IMMOBILIEN_KEY], JSON.parse(booked.rs_profiles_v1).profiles.muster_a.data[IMMOBILIEN_KEY], 'Aktive Person: Livespeicher und Registry gleich');
    // Nachtrag 1: Der Simulator schreibt das Jahr 2026 nicht noch einmal fort.
    const data = JSON.parse(booked.rs_profiles_v1).profiles.muster_a.data;
    const inputs = buildSimulatorInputsFromProfileData(data, { referenceYear: 2027, storage: annualRecordStorage(booked) });
    assertEqual(homeValueAtDeath(inputs.home[0], { ...inputs, homeReferenceYear: 2027 }, 1), 461250, 'Simulator mit Rechenbeginn 2027: Haus 461.250 € ohne zusätzliche Inflation 2026');
    // Eigener Wert mit Grund.
    const own = await editor(records, { 'muster-haus': ['480.000 €', 'Gutachten 11/2026'] });
    const meta = textOf(own.root.querySelector('[data-annual-property-meta="muster-haus"]')).trim();
    assertEqual(meta, 'Vorschlag 461.250 € · eigener Wert', 'Variante kennzeichnet den eigenen Wert');
    const withOwn = close(records, { propertyValues: own.accept() });
    assertEqual(JSON.stringify(homesOf(withOwn, 'muster_a').entries[0].wertverlauf.at(-1)), JSON.stringify({ datum: '2026-12-31', wert: 480000, herkunft: 'jahresabschluss', grund: 'Gutachten 11/2026' }),
        'Eigener Wert 480.000 € mit Grund');
    assertEqual(homesOf(withOwn, 'muster_b').entries[0].wert, 215250, 'Nicht geänderte Wohnung übernimmt den Vorschlag');
    let refused = false;
    try { close(records, { propertyValues: { ...own.accept(), year: 2025 } }); } catch { refused = true; }
    assert(refused, 'Werte eines anderen Jahres werden abgewiesen');
}

// 3. Wiederholung (Nachtrag 4): kein zweiter Eintrag, kein erneutes Fortschreiben, auch nicht im überlappenden Personenabschluss.
{
    const adapter = annualRecordStorage(booked);
    assertEqual(readAnnualProperties({ storage: adapter, people: people(booked), targetYear: 2026 }).length, 0, 'Bestätigte Immobilien erscheinen im selben Jahr nicht noch einmal');
    applyAnnualPropertyValues({ adapter, activeId: 'muster_a', targetYear: 2026, propertyValues: { year: 2026, entries: [{ profileId: 'muster_a', id: 'muster-haus', wert: 472781 }, { profileId: 'muster_b', id: 'muster-mietwohnung', wert: 1 }] } });
    const haus = homesOf(adapter.records, 'muster_a').entries[0];
    assertEqual(`${haus.wert}/${haus.wertverlauf.filter(item => item.herkunft === 'jahresabschluss').length}/${homesOf(adapter.records, 'muster_b').entries[0].wert}`, '461250/1/215250',
        'Zweiter Abschluss desselben Jahres ändert keinen bestätigten Wert');
}

// 4. Späterer Eintrag (Nachtrag 3): Vorschlag aus dem Wert am 31.12., aktueller Wert bleibt.
{
    const records = closingRecords('max-erika', 'immobilien');
    const registry = JSON.parse(records.rs_profiles_v1), raw = registry.profiles.muster_a.data[IMMOBILIEN_KEY];
    const next = writeImmobilienMitVerlauf(raw, readImmobilien(raw).map(home => ({ ...home, wert: 500000 })), '2027-01-01');
    registry.profiles.muster_a.data[IMMOBILIEN_KEY] = records[IMMOBILIEN_KEY] = next; records.rs_profiles_v1 = JSON.stringify(registry);
    const step = await editor(records);
    const text = textOf(step.root);
    assert(text.includes('Wert am 01.01.2027 geändert; der aktuelle Wert bleibt.') && text.includes('461.250 €'), 'Hinweis auf den späteren Eintrag, Vorschlag aus dem Wert am 31.12.');
    const haus = homesOf(close(records, { propertyValues: step.accept() }), 'muster_a').entries[0];
    assertEqual(`${haus.wert}/${haus.wertverlauf.map(item => `${item.datum}:${item.wert}`).join(',')}`, '500000/2026-12-01:450000,2026-12-31:461250,2027-01-01:500000',
        'Abschluss schreibt zum 31.12., der aktuelle Wert bleibt auf dem späteren Eintrag');
}

// 4b. Steuerung 16.11.2026: Ohne Verlauf und mit Stand nach dem 31.12. (Wert schon neuer) erscheint die Immobilie nicht;
// sind alle Immobilien des Jahres schon bestätigt, entfällt der Schritt.
{
    const records = createMusterHaushaltRecords('2027-01-02', 'max-erika', 'immobilien');
    assertEqual(readImmobilien(JSON.parse(records.rs_profiles_v1).profiles.muster_a.data[IMMOBILIEN_KEY])[0].stand, '2027-01', 'Beispiel am 02.01.2027 angelegt: Stand 01.2027');
    const { doc } = createDialogFixture();
    const step = createAnnualPropertyEditor({ doc, targetYear: 2026, people: people(records), storage: annualRecordStorage(records), listen });
    assert(!step.present, 'Immobilien ohne Verlauf mit Stand nach dem 31.12.2026 erscheinen nicht; ohne weitere Immobilien entfällt der Schritt');
    const adapter = annualRecordStorage(records), before = JSON.stringify(adapter.records);
    applyAnnualPropertyValues({ adapter, activeId: 'muster_a', targetYear: 2026, propertyValues: { year: 2026, entries: [{ profileId: 'muster_a', id: 'muster-haus', wert: 461250 }] } });
    assertEqual(homesOf(adapter.records, 'muster_a').entries[0].wert, 450000, 'Auch der Abschluss schreibt solche Immobilien nicht fort');
    assert(before !== '' && !createAnnualPropertyEditor({ doc, targetYear: 2026, people: people(booked), storage: annualRecordStorage(booked), listen }).present,
        'Alle Immobilien des Jahres bestätigt: kein Schritt');
}

// 5. Kurve: damals gültiger Wert, erster bekannter Wert davor, entfernte Immobilie bis zum Tag des Entfernens.
{
    const persons = records => people(records).map(person => ({ values: { immobilien: homesOf(records, person.id).entries }, immobilienBeendet: homesOf(records, person.id).beendet }));
    const history = { points: ['2026-06-30', '2026-12-30', '2026-12-31', '2027-01-01'].map((date, day) => ({ day, date, total: 100 })), types: [], events: [], gaps: [] };
    const curve = withPropertyHistory(history, persons(booked));
    assertEqual(curve.points.map(point => point.property.total).join(','), '660000,660000,676500,676500', 'Am 30.12.2026 660.000 €, am 31.12.2026 676.500 €, davor der erste bekannte Wert');
    assertEqual(curve.points[2].totalWithHomes, 676600, 'Linie ist echtes Gesamtvermögen');
    const ended = structuredClone(booked), registry = JSON.parse(ended.rs_profiles_v1);
    registry.profiles.muster_b.data[IMMOBILIEN_KEY] = writeImmobilienMitVerlauf(registry.profiles.muster_b.data[IMMOBILIEN_KEY], [], '2026-12-31');
    ended.rs_profiles_v1 = JSON.stringify(registry);
    assertEqual(withPropertyHistory(history, persons(ended)).points.map(point => point.property.total).join(','), '660000,660000,676500,461250',
        'Entfernt am 31.12.2026: zählt bis V, ab V+1 nicht mehr');
}

// 6. Martin und Petra: Haus 600.000 € von Martin → 615.000 € bei 2,5 %.
{
    const records = closingRecords('martin-petra');
    const rows = readAnnualProperties({ storage: annualRecordStorage(records), people: people(records), targetYear: 2026 });
    const haus = rows.find(row => row.bezeichnung === 'Haus');
    assertEqual(`${haus.name}:${annualPropertyProposal(haus.base, 2.5)}`, 'Martin:615000', 'Martin und Petra: Vorschlag 615.000 €');
}

// 7. Ohne Immobilien (Renate): kein Schritt, Abschluss und Kurve unverändert.
{
    const records = closingRecords('renate');
    const { doc } = createDialogFixture();
    const step = createAnnualPropertyEditor({ doc, targetYear: 2026, people: people(records), storage: annualRecordStorage(records), listen });
    assert(!step.present, 'Ohne Immobilien gibt es den Schritt nicht');
    assertEqual(JSON.stringify(close(records, { propertyValues: { year: 2026, entries: [] } })), JSON.stringify(close(records)), 'Abschluss ohne Immobilien bytegleich');
    const history = { points: [{ day: 1, date: '2026-12-31', total: 5 }], types: [], events: [], gaps: [] };
    assert(withPropertyHistory(history, [{ values: { immobilien: [] } }]) === history, 'Kurve ohne Immobilien unverändert');
}

// 8. Sicherung: alte Sicherung ohne Wertverlauf gültig; neue mit Wertverlauf übersteht Sichern und Wiederherstellen bytegleich.
{
    const old = createMusterHaushaltRecords('2026-12-15', 'max-erika', 'immobilien');
    const oldBackup = normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage: annualRecordStorage(old) }));
    assert(oldBackup.ok && oldBackup.backup.records.rs_profiles_v1 === old.rs_profiles_v1, 'Alte Sicherung ohne Wertverlauf lädt unverändert');
    const fresh = { ...booked };
    const registry = JSON.parse(fresh.rs_profiles_v1);
    registry.profiles.muster_b.data[IMMOBILIEN_KEY] = writeImmobilienMitVerlauf(registry.profiles.muster_b.data[IMMOBILIEN_KEY], [], '2027-01-02');
    fresh.rs_profiles_v1 = JSON.stringify(registry);
    const restored = normalizeFullPersistenceBackup(JSON.parse(JSON.stringify(buildFullPersistenceBackup({ storage: annualRecordStorage(fresh) }))));
    assert(restored.ok, 'Neue Sicherung mit Wertverlauf ist importierbar');
    assertEqual(restored.backup.records.rs_profiles_v1, fresh.rs_profiles_v1, 'Wertverlauf und beendete Verläufe überstehen Sichern und Wiederherstellen bytegleich');
    assertEqual(restored.backup.records[IMMOBILIEN_KEY], fresh[IMMOBILIEN_KEY], 'Livespeicher der Immobilien bytegleich');
    const broken = JSON.parse(fresh[IMMOBILIEN_KEY]); broken.entries[0].wertverlauf[0].wert = -1;
    assertEqual(validatePersistenceDomainRecords({ ...fresh, [IMMOBILIEN_KEY]: JSON.stringify(broken) }).ok, false, 'Sicherungsprüfer weist einen beschädigten Wertverlauf ab');
    const brokenEnd = JSON.parse(registry.profiles.muster_b.data[IMMOBILIEN_KEY]); brokenEnd.beendet[0].ende = '2026-02-30';
    const brokenRegistry = structuredClone(registry); brokenRegistry.profiles.muster_b.data[IMMOBILIEN_KEY] = JSON.stringify(brokenEnd);
    assertEqual(validatePersistenceDomainRecords({ ...fresh, rs_profiles_v1: JSON.stringify(brokenRegistry) }).ok, false, 'Sicherungsprüfer weist einen beschädigten beendeten Verlauf ab');
}

// 9. Dialog: Schritt „Immobilienwerte“ nach „Pflegewerte“, vor „Marktdaten“; ohne Immobilien wie bisher. Bestätigungspflicht wie bei Pflegewerten.
for (const [household, variant] of [['max-erika', 'immobilien'], ['renate', 'grund']]) {
    const records = createMusterHaushaltRecords('2026-12-15', household, variant);
    resetPersistenceForTests({ async loadAll() { return { ...records }; }, async saveBatch() {} });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try {
        const { doc } = createDialogFixture();
        const guard = createNavigationGuard({ decide: async () => 'stay', status() {} });
        const ids = people(records).map(person => person.id);
        const persons = captureCashPeople({ ids, activeId: records.rs_current_profile });
        const model = { now: new Date(2027, 0, 2), scope: { kind: ids.length > 1 ? 'household' : 'single', ids, key: `household:${ids.join('+')}` }, members: persons,
            occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 } };
        const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
            projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
        const market = Object.fromEntries([['inflation', '2.5'], ['etf', '150'], ['cape', '28']].map(([type, value]) => [type, createManualAnnualValue(type, value, 2026)]));
        const session = createAnnualCloseSession({ guard, readContext: () => `im1-${household}`, showPreparation: ui.showAnnualPreparation,
            fetchers: Object.fromEntries(Object.entries(market).map(([type, value]) => [type, async () => value])), schedule: () => 1, unschedule() {} });
        const pending = session.prepare({ targetYear: 2026, model, people: persons });
        for (let i = 0; i < 50; i++) await Promise.resolve();
        const root = doc.getElementById('balanceAnnualClose');
        const steps = root.querySelectorAll('[data-close-dialog-activate]').map(node => node.dataset.closeDialogActivate).join(',');
        if (household === 'renate') {
            assertEqual(steps, 'prices,expenses,budget,cash,care,market,preview', 'Ohne Immobilien: Dialog ohne neuen Schritt');
            assert(!root.querySelector('[data-annual-property-editor]'), 'Ohne Immobilien kein Immobilienentwurf');
        } else {
            assertEqual(steps, 'prices,expenses,budget,cash,care,property,market,preview', 'Immobilienwerte nach Pflegewerten, vor Marktdaten');
            // OP-2 (Punkt 2): Der Schrittkopf heißt „Immobilien“; Titel und Weiter-Knopf nennen weiter die Immobilienwerte.
            const propertyTab = root.querySelector('[data-close-dialog-activate="property"]');
            assertEqual(textOf(propertyTab.querySelector('.close-dialog-step-name')), 'Immobilien', 'Schrittkopf „Immobilien“ statt „Immobilienwerte“');
            assert(root.querySelectorAll('.close-dialog-step-heading').some(node => textOf(node) === 'Immobilienwerte prüfen'), 'Titel „Immobilienwerte prüfen“ bleibt');
            await root.querySelector('[data-close-dialog-activate="care"]').fire('click');
            assert(textOf(root).includes('Weiter zu den Immobilienwerten'), 'Knopf „Weiter zu den Immobilienwerten“ bleibt');
            for (const id of steps.split(',')) await root.querySelector(`[data-close-dialog-activate="${id}"]`).fire('click');
            await root.querySelector('[data-annual-care-confirm]').fire('click');
            for (const node of root.querySelectorAll('[data-tagesgeld-confirm-person], [data-annual-cape-confirm]')) await node.fire('click');
            assertEqual(textOf(root.querySelector('[data-close-dialog-status]')).trim(), 'Noch offen: Immobilienwerte bestätigen oder ändern', 'Bestätigungspflicht wie bei Pflegewerten');
            await root.querySelector('[data-annual-property-confirm]').fire('click');
            await root.querySelector('#annualConfirmBtn').fire('click');
            const accepted = await pending;
            assertEqual(accepted.propertyValues.entries.map(entry => entry.wert).join(','), '461250,215250', 'Bestätigte Immobilienwerte reisen zum Abschluss');
        }
        if (household === 'renate') { await root.querySelector('[data-close-dialog-close]')?.fire('click'); }
    } finally { await resetPersistenceForTests(); }
}

// 10. Gutachten IM-1 (Codex): neuere Immobilie bleibt auch nach Wertänderung draußen; aktueller Wert = letzter Eintrag;
// keine Immobilie zugleich heutig und beendet.
{
    // P2a: Stand 01.2027, am 02.01.2027 auf 500.000 € geändert: Verlauf beginnt erst 2027, kein Vorschlag für 2026.
    const records = createMusterHaushaltRecords('2027-01-02', 'max-erika', 'immobilien');
    const registry = JSON.parse(records.rs_profiles_v1), raw = registry.profiles.muster_a.data[IMMOBILIEN_KEY];
    registry.profiles.muster_a.data[IMMOBILIEN_KEY] = records[IMMOBILIEN_KEY] = writeImmobilienMitVerlauf(raw, readImmobilien(raw).map(home => ({ ...home, wert: 500000 })), '2027-01-02');
    records.rs_profiles_v1 = JSON.stringify(registry);
    assertEqual(readAnnualProperties({ storage: annualRecordStorage(records), people: people(records), targetYear: 2026 }).length, 0,
        'Verlauf erst ab 2027: Immobilie erscheint auch nach einer Wertänderung nicht im Abschluss 2026');
    const adapter = annualRecordStorage(records);
    applyAnnualPropertyValues({ adapter, activeId: 'muster_a', targetYear: 2026, propertyValues: { year: 2026, entries: [{ profileId: 'muster_a', id: 'muster-haus', wert: 461250 }] } });
    assertEqual(homesOf(adapter.records, 'muster_a').entries[0].wertverlauf.map(item => item.datum).join(','), '2027-01-01,2027-01-02', 'Auch der Abschluss schreibt keinen Eintrag zum 31.12.2026');
    // Echter älterer Verlauf mit späterer Eingabe bleibt zugelassen (Abschnitt 4).
    // P2b: aktueller Wert widerspricht dem letzten Eintrag.
    const [haus] = readImmobilien(raw);
    const contradicting = JSON.stringify({ schemaVersion: 1, entries: [{ ...haus, wert: 450000, wertverlauf: [{ datum: '2026-12-01', wert: 1, herkunft: 'eingabe' }] }] });
    let message = '';
    try { readImmobilien(contradicting); } catch (error) { message = error.message; }
    assertEqual(message, 'Immobilie „Haus“: Der aktuelle Wert passt nicht zum letzten Eintrag im Wertverlauf.', 'Widerspruch wird mit verständlicher Meldung abgewiesen');
    assertEqual(validatePersistenceDomainRecords({ ...records, [IMMOBILIEN_KEY]: contradicting }).ok, false, 'Sicherungsprüfer weist den Widerspruch ab');
    const consistent = JSON.stringify({ schemaVersion: 1, entries: [{ ...haus, wert: 1, wertverlauf: [{ datum: '2026-12-01', wert: 1, herkunft: 'eingabe' }] }] });
    assertEqual(writeImmobilien(readImmobilien(consistent)), consistent, 'Gültige Bytes werden unverändert übernommen');
    // P3: dieselbe Kennung heutig und beendet.
    const both = JSON.stringify({ schemaVersion: 1, entries: [haus], beendet: [{ id: haus.id, bezeichnung: haus.bezeichnung, nutzung: haus.nutzung, ende: '2027-01-02',
        wertverlauf: [{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }] }] });
    let doubled = false; try { readImmobilienRecord(both); } catch { doubled = true; }
    assert(doubled, 'Lesen weist eine zugleich heutige und beendete Immobilie ab');
    let writerRejects = false; try { writeImmobilien([haus], JSON.parse(both).beendet); } catch { writerRejects = true; }
    assert(writerRejects, 'Auch der Writer weist sie ab');
    assertEqual(validatePersistenceDomainRecords({ ...records, [IMMOBILIEN_KEY]: both }).ok, false, 'Sicherungsprüfer weist sie ab');
    // Formularentwurf: ein geänderter Wert mit altem Verlauf ist kein gespeicherter Record und bleibt prüfbar.
    assertEqual(JSON.stringify(immobilienErrors([{ ...haus, wert: 470000, wertverlauf: [{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }] }])), '[]', 'Formularentwurf wird getrennt geprüft');
}

// 11. Gutachten IM-1, Nachtrag 3: Stand in der Zukunft (02.2027), Wertänderung am 02.01.2027 lässt sich speichern;
// der abgeleitete Eintrag entfällt. Gegenfall: Stand in der Vergangenheit behält den abgeleiteten Eintrag.
for (const [stand, expected] of [['2027-02', '2027-01-02:470000'], ['2026-03', '2026-03-01:450000,2027-01-02:470000']]) {
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika', 'immobilien');
    const live = { ...JSON.parse(records.rs_profiles_v1).profiles.muster_a.data };
    live[IMMOBILIEN_KEY] = writeImmobilien(readImmobilien(live[IMMOBILIEN_KEY]).map(home => ({ ...home, stand })));
    const storage = { getItem: key => live[key] ?? null, setItem: (key, value) => { live[key] = String(value); } };
    const values = loadProfileAssetValues(storage);
    saveProfileAssetValues({ ...values, immobilien: values.immobilien.map(home => ({ ...home, wert: 470000 })) }, storage, { date: '2027-01-02' });
    const [haus] = readImmobilien(live[IMMOBILIEN_KEY]);
    assertEqual(haus.wertverlauf.map(item => `${item.datum}:${item.wert}`).join(','), expected, `Stand ${stand}: Verlauf chronologisch, letzter Eintrag = aktueller Wert`);
    assertEqual(haus.wert, haus.wertverlauf.at(-1).wert, `Stand ${stand}: Speichern besteht die Konsistenzprüfung`);
}

// JV-1: Ohne Inflation des Jahres ist „Unverändert bestätigen“ gesperrt und ein Hinweis nennt den Grund.
{
    const records = closingRecords('max-erika', 'immobilien');
    const { doc } = createDialogFixture();
    const step = createAnnualPropertyEditor({ doc, targetYear: 2026, people: people(records), storage: annualRecordStorage(records), listen });
    doc.body.append(step.root);
    const confirm = step.root.querySelector('[data-annual-property-confirm]'), wait = step.root.querySelector('[data-annual-property-wait]');
    await confirm.fire('click');
    assert(confirm.disabled && !wait.hidden && !step.read().confirmed && wait.textContent.includes('Inflation 2026'), 'JV-1: ohne Inflation gesperrt, Hinweis sichtbar');
    step.setInflation(2.5); await confirm.fire('click');
    assert(!confirm.disabled && wait.hidden && step.read().confirmed, 'JV-1: mit Inflation bestätigbar, Hinweis verschwindet');
}

// JV-1: Ein gespeicherter Eintrag nach dem Speichertag (Spielbereich nach Datumssprung zurück) blockiert die Wertänderung nicht mehr.
// Echte Daten laufen nur vorwärts: Liegen alle Einträge vor dem Speichertag, bleibt der Verlauf wie bisher und erhält den neuen Eintrag am Ende.
{
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika', 'immobilien');
    const [haus] = readImmobilien(JSON.parse(records.rs_profiles_v1).profiles.muster_a.data[IMMOBILIEN_KEY]);
    const verlauf = [{ datum: '2026-12-01', wert: 450000, herkunft: 'eingabe' }, { datum: '2026-12-31', wert: 461250, herkunft: 'jahresabschluss' }];
    const raw = writeImmobilien([{ ...haus, wert: 461250, stand: '2027-01', wertverlauf: verlauf }]);
    const zurueck = readImmobilien(writeImmobilienMitVerlauf(raw, [{ ...haus, wert: 455000, stand: '2027-01' }], '2026-12-20'))[0];
    assertEqual(zurueck.wertverlauf.map(item => `${item.datum}:${item.wert}`).join(','), '2026-12-01:450000,2026-12-20:455000', 'JV-1: späterer Eintrag entfällt, letzter Eintrag = neuer Wert');
    const vorwaerts = readImmobilien(writeImmobilienMitVerlauf(raw, [{ ...haus, wert: 470000, stand: '2027-01' }], '2027-01-05'))[0];
    assertEqual(JSON.stringify(vorwaerts.wertverlauf), JSON.stringify([...verlauf, { datum: '2027-01-05', wert: 470000, herkunft: 'eingabe' }]), 'JV-1: Datum nur vorwärts: Verlauf unverändert, neuer Eintrag am Ende');
}

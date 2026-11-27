// ATH-1 (FR-89): Balance verwendet ein Allzeithoch aus gespeichertem Hoch, Stichtagskurs und allen gespeicherten Tagesschlüssen,
// mit Datum. Keine Wahl im Jahresabschluss, keine zweite Lesart. Nur erfundene Musterdaten.
import { readDM1References } from './helpers/dm-1-expectations.mjs';
import { readVS2References } from './helpers/vs-2-expectations.mjs';
import { readGU1References as readBeforeKO2References } from './helpers/gu-1-expectations.mjs';
import { readKO2References } from './helpers/ko-2-expectations.mjs';
// KO-2 (Ergänzung FR-76): gemessene Hashpaare für Fondskosten im Dynamic Flex und den gelesenen Planwert.
const readGU1References = value => readKO2References(readBeforeKO2References(value));
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { annualTestMarketData as marketData, annualTestNow as now, annualServiceFixture, readyAnnualFixture } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords, evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { deriveMarketHigh, deriveYearEndMarketInputs, prepareMarketPreview } from '../app/balance/balance-market-preview.js';
import { marketHighRows } from '../app/balance/balance-market-preview-renderer.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceInputs } from '../app/balance/balance-evaluation.js';
import { emptyHistorySymbol, historyDay, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { CONFIG as ENGINE_CONFIG } from '../engine/config.mjs';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectAnnualCloseResult, createAnnualActionResult } from '../app/shared/annual-close-result.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { buildNextMarketDataHist } from '../app/simulator/simulator-year-portfolio.js';

const key = CONFIG.STORAGE.LS_KEY, json = JSON.stringify;
const hash = value => createHash('sha256').update(json(value)).digest('hex');
const yearsBetween = (from, to) => (historyDay(to) - historyDay(from)) / 365.2425;
const CUT_REGIMES = ENGINE_CONFIG.SPENDING_MODEL.FLEX_BUDGET.ACTIVE_REGIMES;
/** @param {[string, number][]} points */
const pricesOf = points => ({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR',
    days: points.map(([date]) => historyDay(date)), closes: points.map(([, price]) => price),
    queried: [[historyDay(points[0][0]), historyDay(points.at(-1)[0])]] } } });
/** Jahresmarktdaten in aktivem Stand und allen Profilkopien setzen, samt Eingabefeldern. */
const setMarketInputs = (records, inputs) => {
    const write = raw => { const state = JSON.parse(raw); state.inputs = { ...state.inputs, ...inputs };
        for (const [field, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[field] = { value: String(value), checked: false };
        return json(state); };
    records[key] = write(records[key]);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) if (profile.data[key]) profile.data[key] = write(profile.data[key]);
    records.rs_profiles_v1 = json(registry);
};

// Ohne höheres Tageshoch bleibt der Jahresabschluss bytegleich zum Stand vor FR-89 (Musterhaushalt, Kurs 160,20 über allen Schlüssen).
{
    const records = createMusterHaushaltRecords('2026-12-15');
    const state = JSON.parse(records[key]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ar2-before', phase: 'writes_started' };
    records[key] = json(state);
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
    assertEqual(hash(draft.records), readDM1References(readVS2References(readGU1References('aeac523006dd72fde26591464f7b22656ed1a4004c7318a6af89a382078463aa'))), 'Ohne höheres Tageshoch entspricht der Jahresentwurf der gemessenen Referenz');
    assertEqual(hash(prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now }).records), readVS2References('782c2bb80c823070aa2f0d45a7c6bb5dfc0bfa7cfd3727fe34d77b3c9e62c4f7'), 'Ohne höheres Tageshoch bleiben alle Abschlussrecords bytegleich');
}

// Reine Funktion: höchster Wert mit Datum, jüngster Tag bei Gleichstand, das Hoch sinkt nie, Regelalter ohne höheren Schluss.
{
    const inputs = { endeVJ: 170, endeVJ_1: 150, endeVJ_2: 140, endeVJ_3: 135, ath: 170, jahreSeitAth: 2 };
    const quote = { price: 160, asOf: '2026-11-20' };
    const derive = (points, extra = {}) => deriveMarketHigh({ inputs, quote, yearEndDate: '2025-12-31',
        series: points ? pricesOf(points).symbols['VWCE.DE'] : null, ageUntil: quote.asOf, ...extra });
    const plain = derive(null);
    assertEqual(json(plain.inputs), json(deriveYearEndMarketInputs(inputs, 160)), 'Ohne Tageskurse gilt die Jahresendregel unverändert');
    assertEqual(json(plain.high), json({ value: 170, asOf: '2023-12-31', origin: 'stored', dated: false }), 'Gespeichertes Hoch ohne Datum: <Jahr − jahreSeitAth>-12-31');
    const daily = derive([['2025-06-16', 215], ['2025-09-01', 215], ['2026-11-20', 999]]);
    assertEqual(json(daily.high), json({ value: 215, asOf: '2025-09-01', origin: 'daily_close', dated: true }),
        'Tagesschluss vor dem letzten 31.12. zählt; gleicher Höchstwert: jüngster Tag; der Stichtagskurs ersetzt den Schluss seines Tages');
    assertEqual(daily.inputs.jahreSeitAth, yearsBetween('2025-09-01', '2026-11-20'), 'Alter in Bruchjahren bis zum Kursdatum');
    assertEqual(daily.inputs.endeVJ, 160, 'Jahresendstände rücken wie bisher nach');
    const lower = derive([['2025-06-16', 165]]);
    assertEqual(lower.inputs.ath, 170, 'Das Hoch sinkt nie');
    assertEqual(lower.inputs.jahreSeitAth, 3, 'Ohne höheren Schluss bleibt das Alter der Jahresendregel');
    const dated = derive([['2025-10-01', 170]], { storedHighAsOf: '2025-10-01' });
    assertEqual(json(dated.high), json({ value: 170, asOf: '2025-10-01', origin: 'stored', dated: true }), 'Gleicher Schluss am belegten Hochdatum ändert nichts');
    const tie = derive([['2025-10-01', 170]]);
    assertEqual(tie.high.asOf, '2025-10-01', 'Gleichstand mit jüngerem Tag als dem abgeleiteten Datum: jüngster Tag');
    assertEqual(tie.inputs.jahreSeitAth, yearsBetween('2025-10-01', '2026-11-20'), 'Der jüngere Tag bestimmt das Alter');
}

// Nachweis 1, Vorschau: Ein Tageshoch vom Juni des Vorjahrs liegt über dem gespeicherten Jahresend-Hoch.
{
    const records = createMusterHaushaltRecords('2026-11-26', 'max-erika');
    const storage = { getItem: name => records[name] ?? null, key: i => Object.keys(records)[i] ?? null,
        setItem: (name, value) => { records[name] = value; }, removeItem: name => { delete records[name]; }, get length() { return Object.keys(records).length; } };
    setMarketInputs(records, { endeVJ: 170, endeVJ_1: 150, endeVJ_2: 140, endeVJ_3: 135, ath: 170, jahreSeitAth: 0 });
    const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
    const handlers = createProfilverbundHandlers({ dom: {}, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
    const options = { inputData: calculation.inputData, persistentState: calculation.history.persistentState, profiles: calculation.profiles,
        profileId: calculation.profileId, engineApi: EngineAPI, planInputs: calculation.householdPlan.entry.values, publish: false,
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state, { publish = false } = {}) => handlers.runProfilverbundProfileSimulations(input, profiles, state,
            { engineApi: EngineAPI, publish, withdrawalMode: calculation.householdPlan.entry.values.householdWithdrawalMode }) } };
    const preview = points => {
        records[DAILY_PRICES_KEY] = json(pricesOf(points));
        const bytes = json(records);
        const evaluation = evaluateBalanceInputs({ ...options, marketPreviewContext: { calculation, storage, now: new Date('2026-11-26T12:00:00Z') } });
        assertEqual(json(records), bytes, 'Vorschau schreibt nichts');
        return evaluation;
    };
    const juneHigh = preview([['2025-06-16', 215], ['2025-12-30', 170], ['2026-11-20', 160]]);
    const view = juneHigh.marketPreview;
    assertEqual(json(view.high), json({ value: 215, asOf: '2025-06-16', origin: 'daily_close', dated: true, source: 'daily', splitAsOf: null }), 'Vorschau: Hoch 215 mit Datum aus dem Juni des Vorjahrs');
    assertEqual(juneHigh.previewInputData.ath, 215, 'Vorschau rechnet mit dem Tageshoch');
    assertEqual(juneHigh.previewInputData.jahreSeitAth, yearsBetween('2025-06-16', '2026-11-20'), 'Vorschau: Bruchalter bis zum Kursdatum');
    assert(!Number.isInteger(juneHigh.previewInputData.jahreSeitAth), 'Bruchalter statt ganzer Jahre');
    assertEqual(view.market.key, 'bear_deep', 'Vorschau: Marktlage tiefer Bär');
    assert(view.deepBear.reached && view.deepBear.cutActive, 'Vorschau: Kursschwelle erreicht, Kürzung aktiv');
    assert(juneHigh.modelResult.ui.spending.kuerzungProzent > 0, `Vorschau: Engine kürzt den Flex (${juneHigh.modelResult.ui.spending.kuerzungProzent} %)`);
    const rows = Object.fromEntries(marketHighRows(view));
    assertEqual(rows.Allzeithoch, '215,00 € · Tagesschluss vom 16.06.2025', 'Anzeige: Hoch mit Tagesschluss');
    assertEqual(rows['Tiefer Bär'], 'unter 172,00 € · Kürzung aktiv', 'Anzeige: Kursschwelle mit „Kürzung aktiv“');
    assertEqual(rows.Marktlage, 'Tiefer Bär', 'Anzeige: Marktlage aus der Engine');
    const yearEndOnly = preview([['2025-12-30', 170], ['2026-11-20', 160]]);
    assertEqual(yearEndOnly.marketPreview.high.value, 170, 'Gegenprobe ohne Juni-Schluss: gespeichertes Jahresend-Hoch');
    assert(!CUT_REGIMES.includes(yearEndOnly.modelResult.ui.market.sKey) && !(yearEndOnly.modelResult.ui.spending.kuerzungProzent > 0), 'Gegenprobe: ohne das Tageshoch keine Kürzung');
    assertEqual(Object.fromEntries(marketHighRows(yearEndOnly.marketPreview))['Tiefer Bär'], 'unter 136,00 € · noch 15,0 % Abstand', 'Anzeige: Restabstand bis zur Kursschwelle');
}

// Nachweis 2, Jahresabschluss: Ende Vorjahr 120, Jahresmitte 200, Jahresende 170. Der Abschluss speichert 200 mit Datum und Bruchalter.
const example = createMusterHaushaltRecords('2026-12-15');
{
    const state = JSON.parse(example[key]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1-example', phase: 'writes_started' };
    example[key] = json(state);
    setMarketInputs(example, { endeVJ: 120, endeVJ_1: 118, endeVJ_2: 115, endeVJ_3: 112, ath: 120, jahreSeitAth: 0 });
    example[DAILY_PRICES_KEY] = json(pricesOf([['2025-12-31', 120], ['2026-06-15', 200], ['2026-12-31', 170]]));
}
const exampleStorage = annualRecordStorage(example);
const exampleMarket = { ...marketData, etf: { ...marketData.etf, price: 170 } };
const exampleDraft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: exampleMarket, storage: exampleStorage, now });
const exampleCommit = prepareAnnualCommitRecords(exampleDraft, { engineApi: EngineAPI, now });
const age = yearsBetween('2026-06-15', '2026-12-31');
{
    const after = JSON.parse(exampleCommit.records[key]);
    assertEqual(after.inputs.ath, 200, 'Jahresabschluss: Hoch 200 statt Jahresschluss 170, ohne Wahl');
    assertEqual(after.inputs.jahreSeitAth, age, 'Jahresabschluss: Bruchalter bis zum 31.12.');
    assertEqual(after.inputs.endeVJ, 170, 'Jahresabschluss: Jahresschluss rückt nach');
    assertEqual(json(after.annualMarketDataMeta.ath), json({ value: 200, yearsSince: age, evaluatedAsOf: '2026-12-31', lastHighAsOf: '2026-06-15' }),
        'Meta: Datenformat bleibt, Datum des Hochs, keine Lesart');
    assert(!Object.hasOwn(exampleCommit.receipt.adopted.snapshot, 'marketReading') && !Object.hasOwn(exampleCommit.receipt.recommended.snapshot, 'marketReading'), 'Beleg: kein marketReading');
    assertEqual(json(exampleDraft.results.etf.ath), json({ old: 120, new: 200, isNew: true, yearsSince: age, evaluatedAsOf: '2026-12-31', lastHighAsOf: '2026-06-15' }),
        'Ergebnis nennt Hoch und Datum ohne Lesart');
    for (const profile of Object.values(JSON.parse(exampleCommit.records.rs_profiles_v1).profiles)) {
        assertEqual(JSON.parse(profile.data[key]).inputs.ath, 200, 'Jedes Haushaltsmitglied erhält dieselbe Hochbasis');
    }
    assertEqual(json(exampleStorage.records), json(example), 'Entwurf bleibt im privaten Speicher');
}
// Im Folgejahr bei 150 kürzt die Engine; mit dem bisherigen Jahresend-Hoch 170 täte sie es nicht.
const yearAfter = (records, price) => {
    const market = { inflation: { ...marketData.inflation, year: 2027 },
        etf: { ...marketData.etf, price, asOf: '2027-12-31', date: new Date('2027-12-31'), targetYear: 2027 },
        cape: { ...marketData.cape, capeAsOf: '2027-12-01', capeUpdatedAt: '2028-01-02T12:00:00Z' } };
    const clock = () => new Date('2028-01-02T12:00:00Z');
    const draft = computeAnnualPlanUpdate({ targetYear: 2027, marketData: market, storage: annualRecordStorage(records), now: clock });
    return { inputs: JSON.parse(draft.records[key]).inputs, evaluation: evaluateAnnualDraft(draft, { engineApi: EngineAPI, now: clock }) };
};
{
    const following = { ...example, ...exampleCommit.records };
    delete following[DAILY_PRICES_KEY];
    const next = yearAfter(following, 150);
    assertEqual(next.inputs.ath, 200, 'Folgejahr: gespeichertes Hoch 200 bleibt');
    // Gutachten P2-3: Das gespeicherte Hoch hat ein belegtes Datum und zählt sein Alter wie ein Tagesschluss bis zum 31.12.
    assertEqual(next.inputs.jahreSeitAth, yearsBetween('2026-06-15', '2027-12-31'), 'Folgejahr: Alter zählt vom 15.06.2026 bis 31.12.2027');
    assertEqual(next.evaluation.modelResult.ui.market.sKey, 'bear_deep', 'Folgejahr bei 150: 25 % unter 200, tiefer Bär');
    assert(next.evaluation.modelResult.ui.spending.kuerzungProzent > 0, `Folgejahr: Engine kürzt den Flex (${next.evaluation.modelResult.ui.spending.kuerzungProzent} %)`);
    const yearEndRule = structuredClone(following);
    setMarketInputs(yearEndRule, { ath: 170, jahreSeitAth: 0 });
    const control = yearAfter(yearEndRule, 150);
    assertEqual(control.inputs.ath, 170, 'Gegenprobe: Jahresend-Hoch 170');
    const controlSpending = control.evaluation.modelResult.ui.spending;
    // Mit 170 bliebe es eine Seitwärtsphase; übrig bliebe nur die kleine Rundungskürzung (Quelle „Rundung“).
    assert(!CUT_REGIMES.includes(control.evaluation.modelResult.ui.market.sKey) && controlSpending.kuerzungQuelle !== next.evaluation.modelResult.ui.spending.kuerzungQuelle
        && controlSpending.kuerzungProzent < next.evaluation.modelResult.ui.spending.kuerzungProzent,
        `Gegenprobe: mit 170 bliebe die Kürzung des Bärenmarkts aus (${control.evaluation.modelResult.ui.market.sKey}, ${controlSpending.kuerzungQuelle})`);
    // Übergabe an den Simulator: Das Bruchalter passiert die Engine-Prüfung (Folgejahr oben) und wächst dort je Jahr um 1.
    const simulated = buildNextMarketDataHist({ marketDataHist: { ...next.inputs }, yearData: { inflation: 2 }, rA: 0, resolvedCapeRatio: 25 });
    assertEqual(simulated.jahreSeitAth, next.inputs.jahreSeitAth + 1, 'Simulator: Bruchalter wächst je Jahr um 1');
    for (const price of [180, 260]) {
        const moved = yearAfter(following, price).inputs;
        assertEqual(moved.jahreSeitAth, price > 200 ? 0 : yearsBetween('2026-06-15', '2027-12-31'), 'Folgejahr: Alter bis 31.12. oder neues Hoch setzt 0');
        assertEqual(moved.ath, Math.max(price, 200), 'Folgejahr: Hochfortschreibung nach Jahresendregel');
    }
}
// FR-90 bleibt: Tageshoch vor sieben Monaten ergibt junge Korrektur, Hoch am 31.12. des Vorjahrs bestätigte Erholung.
{
    const recoveryPrice = exampleDraft.before.readerInputData.endeVJ * 1.12;
    for (const [asOf, phase] of [['2026-05-29', 'Junge Korrektur'], ['2025-12-31', 'Best. Erholung']]) {
        const records = { ...example, [DAILY_PRICES_KEY]: json(pricesOf([[asOf, recoveryPrice / 0.85], ['2026-12-31', recoveryPrice]])) };
        const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: { ...marketData, etf: { ...marketData.etf, price: recoveryPrice } },
            storage: annualRecordStorage(records), now });
        assertEqual(prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now }).receipt.adopted.marketPhase, phase, `FR-90: Jahresbeleg für Tageshoch am ${asOf}`);
    }
}
// Abschlussdialog, Abschluss und Balance-Vorschau nennen dasselbe Hoch.
{
    const readings = await projectAnnualMarketReadings({ targetYear: 2026, quote: exampleMarket.etf, storage: exampleStorage, engineLoader: { load: async () => EngineAPI } });
    const stored = JSON.parse(exampleCommit.records[key]).inputs;
    assertEqual(json(readings.inputs), json({ endeVJ: stored.endeVJ, endeVJ_1: stored.endeVJ_1, endeVJ_2: stored.endeVJ_2, endeVJ_3: stored.endeVJ_3,
        ath: stored.ath, jahreSeitAth: stored.jahreSeitAth }), 'Abschlussdialog zeigt genau die Markteingaben des Abschlusses');
    assertEqual(readings.high.asOf, '2026-06-15', 'Abschlussdialog: Hoch mit Datum');
    const preview = prepareMarketPreview({ inputs: exampleDraft.before.readerInputData, dailyPrices: JSON.parse(example[DAILY_PRICES_KEY]),
        today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true });
    assertEqual(preview.high.value, 200, 'Balance-Vorschau im laufenden Jahr: dasselbe Hoch');
}

// Nachweis 3: Der Abschlussdialog hat keine Marktwahl; „Jahr abschließen“ geht ohne sie. Jahresmitte 230 statt 200: Vor FR-89 war das
// ein verdeckter Bärenmarkt mit Pflichtwahl (26 % unter dem Jahreshoch, nach Jahresendständen ein neues Hoch).
{
    const bearRecords = { ...example, [DAILY_PRICES_KEY]: json(pricesOf([['2025-12-31', 120], ['2026-06-15', 230], ['2026-12-31', 170]])) };
    const bearStorage = annualRecordStorage(bearRecords);
    const { doc } = createDialogFixture(); let binding;
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const people = captureCashPeople({ storage: bearStorage, registry: JSON.parse(example.rs_profiles_v1), activeId: example.rs_current_profile, ids: exampleDraft.scope.ids });
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings: opts => projectAnnualMarketReadings({ ...opts, storage: bearStorage, engineLoader: { load: async () => EngineAPI } }),
        projectPreview: opts => projectAnnualPreview({ ...opts, storage: bearStorage }),
        evaluatePlan: async opts => evaluateAnnualPlanPreview({ ...opts, storage: bearStorage, now, engineLoader: { load: async () => EngineAPI } }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: exampleMarket, errors: {} });
    const settle = () => new Promise(resolve => setTimeout(resolve, 30)); await settle();
    const all = root => [root, ...root.children.flatMap(all)];
    await prepareCloseFixture(doc); await settle(); binding.activate('preview'); await settle();
    assert(!all(doc.body).some(el => el.type === 'radio'), 'Keine Auswahl im Abschlussdialog');
    assertEqual(doc.querySelectorAll('[data-annual-market-reading]').length, 0, 'Keine Marktwahl');
    assert(!doc.querySelector('[data-close-dialog-activate="preview"]').getAttribute('aria-label').includes('Wahl'), 'Planreiter ohne „Wahl offen“');
    const facts = all(doc.querySelector('[data-annual-market-readings]')).map(node => node.textContent).join(' ');
    assert(facts.includes('230,00 € · Tagesschluss vom 15.06.2026') && facts.includes('Tiefer Bär'), `Schritt Marktdaten nennt Allzeithoch mit Datum und Marktlage (${facts})`);
    assert(!doc.getElementById('annualConfirmBtn').disabled, '„Jahr abschließen“ ohne Wahl möglich');
    await doc.getElementById('annualConfirmBtn').fire('click'); const accepted = await pending;
    assert(accepted && !Object.hasOwn(accepted, 'yearHigh'), 'Übergabevertrag ohne Hochwahl');
    binding.close(true);
    const stored = JSON.parse(prepareAnnualCommitRecords(computeAnnualPlanUpdate({ targetYear: 2026, marketData: exampleMarket, storage: bearStorage, now }),
        { engineApi: EngineAPI, now }).records[key]);
    assertEqual(stored.inputs.ath, 230, 'Der Abschluss speichert das Tageshoch ohne Wahl');
}

// Nachweis 4: Ein alter Beleg mit der Wahl „Jahreshoch“ wird weiter angezeigt [A7]; neue Belege haben keine Lesart.
{
    const legacyRecord = JSON.parse(exampleCommit.records[ANNUAL_PLAN_RECORD_KEY]);
    for (const entry of Object.values(legacyRecord.entries)) entry.adopted.snapshot.marketReading = { reading: 'year_high', value: 200, asOf: '2026-06-15' };
    const resultFor = records => projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model: { scope: exampleDraft.scope,
        planComparison: projectHouseholdPlanComparison({ year: 2027, scope: exampleDraft.scope, storage: annualRecordStorage(records) }) } });
    const { doc } = createDialogFixture();
    const legacy = createAnnualActionResult({ doc, result: resultFor({ ...example, ...exampleCommit.records, [ANNUAL_PLAN_RECORD_KEY]: json(legacyRecord) }) });
    assert(legacy.querySelector('[data-annual-market-choice-label]')?.textContent.includes('mit dem Jahreshoch vom 15.06.2026'), 'Alter Beleg nennt die Wahl mit Datum');
    const fresh = createAnnualActionResult({ doc, result: resultFor({ ...example, ...exampleCommit.records }) });
    assertEqual(fresh.querySelector('[data-annual-market-choice-label]'), null, 'Neuer Beleg ohne Lesart');
}

// Koordinierter Transaktionspfad: Hoch aus den gespeicherten Tagesschlüssen, ohne Wahl und ohne Lesart.
{
    const sample = readyAnnualFixture();
    sample.records[DAILY_PRICES_KEY] = json(pricesOf([['2025-12-31', 150], ['2026-06-15', 1000], ['2026-12-30', 160]]));
    const service = await annualServiceFixture({ sample });
    try {
        const closed = await service.create().close({ targetYear: 2026 });
        assertEqual(closed.status, 'already_committed', 'Koordinator bestätigt Abschluss ohne Wahl');
        const meta = JSON.parse(service.backend.get(key)).annualMarketDataMeta.ath;
        assertEqual(meta.value, 1000, 'Transaktion speichert das Tageshoch');
        assertEqual(meta.lastHighAsOf, '2026-06-15', 'Transaktion speichert sein Datum');
        assert(!Object.hasOwn(meta, 'reading'), 'Keine Lesart im Speicher');
        assertEqual(closed.results.etf.ath.lastHighAsOf, '2026-06-15', 'Ergebnis und Protokoll nennen das Hoch');
    } finally { service.persistence.resetPersistenceRuntimeForTests(); }
}

import { createMusterHaushaltRecords, rebuildSyntheticPriceRecords, MUSTER_PROFILE_IDS } from '../app/demo/muster-haushalt.js';
import { HOUSEHOLD_PLAN_KEY, BALANCE_PLAN_INPUT_KEYS, assertHouseholdPlanRecord } from '../app/profile/household-plan.js';
import { analyzeHouseholdPlanMigration } from '../app/profile/household-plan-migration.js';
import { ANNUAL_PLAN_RECORD_KEY, assertAnnualPlanRecord, readAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { projectHouseholdPlanComparison, householdPlanComparisonHtml } from '../app/profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { deriveAnnualCloseEvidence } from '../app/shared/annual-close-evidence.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { readProfileContext } from '../app/profile/profile-context-reader.js';
import { loadStoredBalanceStateFromData } from '../app/profile/profile-state.js';
import { buildPersonMigrationDraft } from '../app/profile/profile-person-migration.js';
import { projectPerson, describePersonDates } from '../app/profile/profile-person-data.js';
import { readMonthProvision, readOverviewSummary, overviewScope } from '../app/overview/overview-storage.js';
import { readCashPerson } from '../app/profile/profile-cash-update.js';
import { syntheticQuote, syntheticAnnualQuote, syntheticChart, syntheticDay } from '../app/shared/probelauf-prices.js';
import { assertWealthHistory } from '../types/wealth-history-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { normalizeTrancheCollection } from '../types/tranche-contract.js';
import { assertCashHistory, assertWealthLots } from '../app/profile/profile-wealth-history.js';
import { assertDailyPrices } from '../app/tranches/tranchen-history-store.js';
import { readHouseholdSimulatorNeedsState } from '../app/simulator/simulator-household-needs-persistence.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { createProfileSyncHandlers } from '../app/balance/balance-main-profile-sync.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';
import { prepareEngineLastState } from '../app/balance/balance-update-pipeline.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildBalanceOverviewSummary } from '../app/overview/overview-model.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';

// Nur DOM und Backend-I/O ersetzen; Leser, Synchronisierung, Engine und Attribution sind produktiv.
async function verifyBalance(date, startDate = date) {
    const saved = { document: globalThis.document, window: globalThis.window };
    const records = rebuildSyntheticPriceRecords(createMusterHaushaltRecords(startDate), date);
    async function calculate(source) {
        PersistenceFacade.resetPersistenceForTests({ name: 'Muster-Balance', async loadAll() { return { ...source }; },
            async saveBatch() { throw new Error("Die Vergleichsrechnung darf nicht schreiben."); } });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const state = loadStoredBalanceStateFromData(source).value;
        const doc = createSelectionDocument();
        globalThis.document = doc;
        globalThis.window = { EngineAPI };
        const keys = [...new Set([...Object.keys(state.inputs), 'aktuellesAlter', 'renteAktiv', 'renteMonatlich',
            'fixedIncomeAnnual', 'sparerPauschbetrag', 'kirchensteuerSatz', 'costBasisAlt', 'costBasisNeu', 'depotwertGesamt'])];
        const dom = { inputs: Object.fromEntries(keys.map(key => [key, addField(doc, key)])), controls: {}, outputs: {}, containers: {} };
        for (const [key, value] of Object.entries(state.inputs)) if (typeof value === 'boolean') dom.inputs[key].type = 'checkbox';
        initUIReader(dom);
        UIReader.applyStoredInputs(state.inputs);
        assert(createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }).syncProfileDerivedInputs(), `${date}: produktiver Haushaltssync erfolgreich`);
        const input = UIReader.readAllInputs();
        const profiles = loadProfilverbundProfiles();
        assertEqual(profiles.map(profile => profile.profileId).join(), MUSTER_PROFILE_IDS.join(), `${date}: beide echten Profilquellen`);
        const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
        handlers.updateProfilverbundGlobals(profiles, input);
        const householdSource = profiles.find(entry => entry.balanceState?.profilverbundHouseholdLastState)?.balanceState || state;
        const lastState = prepareEngineLastState({ inputs: householdSource.profilverbundHouseholdInputs,
            lastState: householdSource.profilverbundHouseholdLastState }, input);
        const runs = handlers.runProfilverbundProfileSimulations(input, profiles, lastState);
        const action = handlers.mergeProfilverbundActions(runs);
        const summary = buildBalanceOverviewSummary({ modelResult: runs.householdResult, monthlyBudget: 5000,
            metadata: state.annualPeriodMetadata, scope: overviewScope('household', MUSTER_PROFILE_IDS),
            now: new Date(`${date}T12:00:00`), profileActions: window.__profilverbundActionResults });
        return { input, result: runs.householdResult, runs: runs.map(({ balanceState, ...computed }) => computed), summary, action };
    }
    try {
        // Rekonstruktion der bisherigen lückenhaften Musterinputs einschließlich Altaliase.
        const legacy = { ...records };
        delete legacy[HOUSEHOLD_PLAN_KEY];
        const registry = JSON.parse(legacy.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) {
            const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
            for (const inputs of [state.inputs, state.profilverbundHouseholdInputs]) {
                for (const key of BALANCE_PLAN_INPUT_KEYS) {
                    if (!['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'capeRatio'].includes(key)) delete inputs[key];
                }
                delete inputs.mode;
                Object.assign(inputs, { zielLiquiditaetJahre: 3, runwayMinM: 24, runwayTargetM: 36 });
            }
            profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        legacy.rs_profiles_v1 = JSON.stringify(registry);
        legacy[CONFIG.STORAGE.LS_KEY] = registry.profiles.muster_a.data[CONFIG.STORAGE.LS_KEY];
        const before = await calculate(legacy);
        const withoutPlan = { ...records }; delete withoutPlan[HOUSEHOLD_PLAN_KEY];
        const canonical = await calculate(withoutPlan);
        const after = await calculate(records);
        for (const [name, comparison] of [['vollständige Musterinputs', canonical], ['bestätigter Musterplan', after]]) {
            for (const key of ['input', 'result', 'runs', 'summary']) assertEqual(JSON.stringify(comparison[key]), JSON.stringify(before[key]),
                `${date}/${startDate}: ${name} erhält vollständige ${key}-Bytes des bisherigen Readerwegs`);
        }
        const { input, result, runs } = after, ui = result?.ui;
        assertEqual(input.aktuellesAlter, projectPerson(records, Number(date.slice(0, 4))).startAlter, 'Produktiver Balanceeingang übernimmt kanonisches Januaralter');
        assertEqual(input.renteMonatlich, date.slice(0, 4) === startDate.slice(0, 4) ? 2300 : 3100, `${date}: frischer Start und fortgesetzter Lauf haben unterschiedliche Rentenmonate`);
        assertEqual(input.floorBedarf, 30000, `${date}: Floor nicht doppelt summiert`);
        assertEqual(input.flexBedarf, 30000, `${date}: Flex nicht doppelt summiert`);
        assertEqual(input.minimumFlexAnnual, 7500, `${date}: Mindest-Flex unverändert gelesen`);

        assert(!result?.error && result?.newState && ui, `${date}: echte Engine liefert fehlerfreien Modellstand`);
        assertEqual(runs.length, 2, `${date}: finale Aktion beiden Profilen zugeordnet`);
        const target = ui.zielLiquiditaet, coverage = ui.liquiditaet?.deckungVorher, withdrawal = ui.spending?.monatlicheEntnahme;
        console.log(JSON.stringify({ date, zielLiquiditaet: target, deckungVorher: coverage, monatlicheEntnahme: withdrawal,
            aktienkauf: ui.action?.verwendungen?.aktien, aktion: ui.action?.title }));
        assert(Number.isFinite(target) && target > 0, `${date}: Liquiditätsziel positiv und endlich`);
        assert(Number.isFinite(coverage) && coverage >= 60 && coverage <= 130, `${date}: reale Deckung innerhalb 60–130 Prozent`);
        assert(Math.abs(coverage - (input.tagesgeld + input.geldmarktEtf) / target * 100) < 1e-8, `${date}: KPI konsistent mit tatsächlicher Liquidität und Modellziel`);
        assert(Number.isFinite(withdrawal) && withdrawal >= 1000 && withdrawal <= 3000, `${date}: reale Monatsentnahme innerhalb 1.000–3.000 €`);
        const action = after.action;
        assert(action === ui.action && ['NONE', 'TRANSACTION'].includes(action.type) && typeof action.title === 'string' && action.title.trim(), `${date}: gültige finale Haushaltsaktion statt vorläufigem Plan`);
        const buy = action.verwendungen?.aktien;
        assert(Number.isFinite(buy) && buy >= 0 && buy <= 25000, `${date}: strukturierter Aktienkauf endlich und höchstens 25.000 €`);
        assert(Array.isArray(action.quellen) && Number.isFinite(action.steuer), `${date}: finalisierte Quellen und Steuerabrechnung vorhanden`);
        assertEqual(persistenceStorage.getItem('rs_active_profile'), 'muster_a', `${date}: aktive Identität erhalten`);
    } finally {
        Object.assign(globalThis, saved);
        PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}

try {
    // Ein kopierter Altbestand mit ungültiger Kopplung bleibt beim Kursneuaufbau
    // startfähig; der Seitenstart übernimmt später die ausdrückliche Auflösung.
    const invalidCopy = createMusterHaushaltRecords('2026-10-09');
    delete invalidCopy[HOUSEHOLD_PLAN_KEY]; delete invalidCopy.household_simulator_needs_v1;
    const invalidRegistry = JSON.parse(invalidCopy.rs_profiles_v1);
    for (const profile of Object.values(invalidRegistry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        state.inputs.minimumFlexAnnual = 40000;
        state.profilverbundHouseholdInputs.minimumFlexAnnual = 40000;
        profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    }
    invalidCopy.rs_profiles_v1 = JSON.stringify(invalidRegistry);
    invalidCopy[CONFIG.STORAGE.LS_KEY] = invalidRegistry.profiles[invalidCopy.rs_active_profile].data[CONFIG.STORAGE.LS_KEY];
    const rebuiltCopy = rebuildSyntheticPriceRecords(invalidCopy, '2026-10-10');
    assert(!Object.hasOwn(rebuiltCopy, HOUSEHOLD_PLAN_KEY), 'Ungültige Kopie startet ohne Ausnahme und ohne ungültigen Plan');
    assertEqual(rebuiltCopy[CONFIG.STORAGE.LS_KEY], invalidCopy[CONFIG.STORAGE.LS_KEY], 'Kursneuaufbau begrenzt Mindest-Flex nicht still');
    assert(analyzeHouseholdPlanMigration(rebuiltCopy).analyses.some(item => item.coupledFields?.length), 'Kopie behält den bedienbaren Korrekturweg beim nächsten Seitenstart');
    for (const date of ['2026-01-01', '2026-01-02', '2026-06-15', '2026-11-02', '2026-12-31', '2027-01-02', '2027-06-15', '2031-11-02', '2060-06-15', '2027-03-13', '2027-03-14', '2027-07-01', '2027-08-21', '2027-08-22']) {
        setAppTestDate(date);
        const records = createMusterHaushaltRecords(date), year = Number(date.slice(0, 4));
        const currentPlan = Object.values(assertHouseholdPlanRecord(records[HOUSEHOLD_PLAN_KEY]).entries);
        assertEqual(currentPlan.length, 1, 'Muster erhält direkt genau einen Haushaltsplan');
        for (const [key, expected] of Object.entries({ floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500 })) {
            assertEqual(currentPlan[0].values[key], expected, 'Direkter Musterplan übernimmt Haushaltsbedarf einmal: ' + key);
        }
        assertEqual(analyzeHouseholdPlanMigration(records).analyses.length, 0, 'Musterstart benötigt keine Planumstellung oder Rückfrage');
        const storage = { getItem: key => records[key] ?? null };
        assertEqual(Object.keys(assertAnnualPlanRecord(records[ANNUAL_PLAN_RECORD_KEY]).entries).length, 1, 'Genau ein gültiger Muster-Jahresbeleg');
        const receipt = readAnnualPlanRecord({ year, scope: currentPlan[0].scope, storage });
        assertEqual(receipt.periodId, `calendar-year:${year - 1}`, 'Musterbeleg schließt das Vorjahr des Starts ab');
        assertEqual(receipt.committedAt, new Date(year, 0, 1, 12).toISOString(), 'Abschlussdatum liegt auch am ersten Januartag nicht in der Zukunft');
        assertEqual(JSON.stringify(receipt.adopted), JSON.stringify(receipt.recommended), 'Muster übernimmt die vollständige Jahresrechnung ohne Anpassung');
        assertEqual(JSON.stringify(receipt.adopted.snapshot.plan), JSON.stringify(currentPlan[0].values), 'Beleg verwendet denselben Bedarf und dieselbe Strategie wie der Musterplan');
        assertEqual(receipt.adopted.snapshot.inflation, 2, 'Beleg und gespeicherte Inflation stimmen überein');
        assertEqual(JSON.stringify(receipt.adopted.snapshot.ageByPerson), JSON.stringify({ muster_a: 67, muster_b: 64 }), 'Beleg hält das Januaralter beider Personen fest');
        assertEqual(receipt.adopted.snapshot.source, 'Beispieldaten (Spielbereich)', 'Musterherkunft bleibt im Beleg erhalten');
        const comparison = projectHouseholdPlanComparison({ year, scope: currentPlan[0].scope, storage, now: new Date(`${date}T12:00:00`) });
        const html = householdPlanComparisonHtml(comparison);
        assertEqual(comparison.recordStatus, 'valid', 'Gemeinsamer Planvergleich liest den Musterbeleg');
        assert(html.includes(`Plan ${year} · festgeschrieben am 01.01.${year}`) && html.includes('Beispieldaten (Spielbereich)'), 'Planvergleich zeigt festen Plan und sichtbare Musterherkunft');
        assert(projectBalanceActionOrigin({ comparison, year, scope: currentPlan[0].scope }).confirmed, 'Balance erkennt die festgeschriebene Musteranweisung');
        const evidence = deriveAnnualCloseEvidence({ targetYear: year - 1, scope: currentPlan[0].scope, activeId: records.rs_active_profile, records });
        assertEqual(evidence.status, 'already_committed', 'Belegprüfung bestätigt den vorbereiteten Vorjahresabschluss');
        assertEqual(JSON.stringify(createMusterHaushaltRecords(date)), JSON.stringify(records), 'Fixture ist reproduzierbar');
        assert(validatePersistenceDomainRecords(records, { requireProfileContext: true }).ok, 'Vollständige echte Domainprüfung akzeptiert Records');
        assertEqual(readProfileContext(storage).status, 'ready', 'Echter Profilleser ohne Bootstrap/Recovery');
        assert(buildPersonMigrationDraft(records, { inspectOnly: true }).people.every(person => !person.needed), 'Keine alten Personeninputs lösen eine Migration aus');
        assertEqual(records.rs_active_profile, 'muster_a', 'Liveprofil und Selektoren sind A');
        assertEqual(records.rs_current_profile, 'muster_a', 'Beide Selektoren stimmen überein');
        const registry = JSON.parse(records.rs_profiles_v1);
        assertEqual(Object.keys(registry.profiles).join(','), MUSTER_PROFILE_IDS.join(','), 'Zwei stabile IDs');
        assertEqual(registry.profiles.muster_a.meta.name, 'Max', 'muster_a heißt Max');
        assertEqual(registry.profiles.muster_b.meta.name, 'Erika', 'muster_b heißt Erika');
        assertEqual(records.depot_tranchen, registry.profiles.muster_a.data.depot_tranchen, 'Live-A und Registry identisch');
        const model = projectOverview({ registry, activeId: 'muster_a', liveData: records });
        assert(model.available && model.complete, 'Echter Übersichtleser akzeptiert Haushalt');
        assert(Math.abs(model.household.assets - 790000) < 0.01, '790.000 € ohne Reserve-Doppelsummen');
        assertEqual(model.household.allocation.cash, 30000, 'Tagesgeld genau einmal');
        assert(Math.abs(model.household.allocation.geldmarkt - 60000) < 0.01, 'Geldmarkt genau einmal');
        assertEqual(model.occasion.kind, 'play', 'Frischer Musterstart ist ruhig');
        assertEqual(model.occasion.monthCompleted, true, 'Vormonat ist bestätigt');
        assertEqual(model.planning.errors.length, 0, 'Keine fehlerhaften Planungsbelege');
        assertEqual(model.periodSource.reason, null, 'Eindeutige Periodenquelle');
        assertEqual(model.cashWarnings.length, 0, 'Tagesgeld am Start frisch bestätigt');
        for (const [key, value] of Object.entries(registry.profiles.muster_a.data)) assertEqual(records[key], value, 'Alle Live-A-Spiegelkeys bytegleich: ' + key);
        assertEqual(model.occasion.annualState, 'done', 'Vorjahr bestätigt ohne Recovery');
        assertEqual(model.summary.status, 'fest', 'Haushaltsplan des Startjahres ist fest');
        assertEqual(model.planComparison.recordStatus, 'valid', 'Startseite zeigt den festgeschriebenen Musterplan');
        assertEqual(JSON.parse(records.rs_wealth_history_start_v1).startDate, `${year - 1}-01-01`, 'Verlauf startet am Vorjahresbeginn');
        assertDailyPrices(JSON.parse(records.rs_daily_prices_v1));
        const simulatorNeeds = readHouseholdSimulatorNeedsState(storage);
        assertEqual(simulatorNeeds.status, 'valid', 'Simulator-Haushaltsplan vorhanden');
        assertEqual(JSON.stringify(JSON.parse(records.household_simulator_needs_v1).values),
            JSON.stringify({ startFloorBedarf: '30000', startFlexBedarf: '30000', minimumFlexAnnual: '7500' }), 'Simulator-Override entspricht Balancebedarf');
        for (const [id, profile] of Object.entries(registry.profiles)) {
            const data = profile.data, state = loadStoredBalanceStateFromData(data);
            assertEqual(state.status, 'valid', 'Echter Balanceleser ohne Migration');
            const name = id === 'muster_a' ? 'Max' : 'Erika';
            assertEqual(profile.meta.id, id, 'Profilidentität unverändert');
            assertEqual(data.profile_geschlecht, id === 'muster_a' ? 'm' : 'w', 'Geschlecht unverändert');
            assertEqual(state.value.inputs.profilName, name, 'Persönliche Balanceinputs nennen dieselbe Person');
            assertEqual(state.value.profilverbundHouseholdInputs.profilName, name, 'Haushaltsinputs nennen dieselbe Person');
            if (id === records.rs_active_profile) assertEqual(loadStoredBalanceStateFromData(records).value.inputs.profilName, name, 'Liveinputs nennen Max');
            assertEqual(data.profile_person_schema_version, '1', 'Personenschema 1');
            const lots = normalizeTrancheCollection(JSON.parse(data.depot_tranchen), { mode: 'persisted' });
            assertEqual(lots.map(lot => lot.type).join(','), 'aktien_alt,aktien_neu,geldmarkt', 'Alt-/Neu-/Geldmarkttypen');
            assert(lots.every(lot => lot.schemaVersion === 2 && lot.purchaseDate >= '2016-01-01' && lot.purchaseDate < date && lot.taxExempt === false), 'Schema 2, Kaufdatum und ausdrückliche Steuerfelder');
            assertCashHistory(JSON.parse(data.profile_cash_history_v1)); assertWealthLots(JSON.parse(data.profile_wealth_history_lots_v1));
            const isMax = id === 'muster_a', cash = isMax ? 18000 : 12000;
            assertEqual(projectPerson(data, year).startAlter, isMax ? 67 : 64, 'Januaralter bleibt relativ konstant');
            assert(!Object.hasOwn(state.value.inputs, 'aktuellesAlter'), 'Januaralter stammt ausschließlich aus kanonischem Geburtsdatum');
            assert(describePersonDates(data, year).hint.includes(`Planung ${year} zählt das Alter am 01.01.: ${isMax ? 67 : 64} Jahre`) && describePersonDates(data, year).hint.includes(`ab Planung ${year + 1}: ${isMax ? 68 : 65}`), 'Planungshinweis im Startjahr');
            assertEqual(projectPerson(data, year).renteImJahr, isMax ? 27600 : 0, 'Startjahr ohne Erika-Rente');
            assertEqual(projectPerson(data, year + 1).renteImJahr, isMax ? 27600 : 9600, 'Folgejahr mit sechs Erika-Monaten');
            assertEqual(projectPerson(data, year + 2).renteImJahr, isMax ? 27600 : 19200, 'Danach zwölf Rentenmonate');
            assertEqual(projectPerson(data, year).monateImJahr, isMax ? 12 : 0, 'Rentenmonate Startjahr');
            assertEqual(projectPerson(data, year + 1).monateImJahr, isMax ? 12 : 6, 'Rentenmonate Folgejahr');
            assertEqual(lots[0].purchaseDate, '2016-06-15', 'Absoluter Altbestand bleibt erhalten');
            assertEqual(lots[1].purchaseDate, isMax ? `${year - 6}-05-18` : `${year - 1}-02-14`, 'Neuaktien relativ verschoben');
            assertEqual(lots[2].purchaseDate, `${year - 2}-04-12`, 'Geldmarkt relativ verschoben');
            for (const lot of lots) {
                assertEqual(lot.purchasePrice, syntheticQuote(lot.ticker, lot.purchaseDate).price, 'Kaufpreis aus synthetischer API');
                assertEqual(lot.currentPrice, syntheticQuote(lot.ticker, date).price, 'Startquote aus synthetischer API');
                if (lot.type !== 'aktien_alt') assert(lot.purchaseDate >= '2018-01-01', 'Neubestand bleibt nach Steuerstichtag');
            }
            assertEqual(state.value.annualPeriodMetadata.lastCommittedPeriod, `calendar-year:${year - 1}`, 'Bestätigte Vorjahresperiode');
            assertEqual(state.value.annualPeriodMetadata.pendingCommit, null, 'Keine Pendingperiode');
            const provision = readMonthProvision(data.overview_month_provision_v1, model.occasion.month, model.scope);
            assert(provision, 'Vormonatshaken für beide Personen im Haushalts-Scope lesbar');
            const confirmationDate = `${year}-${date.slice(5, 7)}-01`;
            assertEqual(provision.completedAt, new Date(year, Number(date.slice(5, 7)) - 1, 1, 12).toISOString(), 'Deterministische lokale Bestätigung');
            const cashPerson = readCashPerson(id, name, data);
            assertEqual(cashPerson.error, null, 'Cashhistorie widerspruchsfrei');
            assertEqual(cashPerson.value, cash, 'Persönlicher Cashstand');
            assertEqual(cashPerson.lastDate, confirmationDate, 'Letzter Bestätigungstag');
            const cashHistory = JSON.parse(data.profile_cash_history_v1);
            assertEqual(new Set(cashHistory.entries.map(entry => entry.date)).size, cashHistory.entries.length, 'Keine doppelten Cashpunkte');
            const summary = readOverviewSummary(data.overview_balance_summary_v1, year, model.scope);
            assertEqual(summary.status, 'fest', 'Persistierter Startjahrplan fest');
            assertEqual(summary.monthlyWithdrawal, receipt.adopted.monthlyWithdrawal, 'Monatsinformation entspricht dem Jahresbeleg');
            assertEqual(summary.monthlyBudget, receipt.adopted.monthlyBudget, 'Budgetinformation entspricht dem Jahresbeleg');
            assertWealthHistory(state.value.wealthHistory);
            assertEqual(state.value.wealthHistory.entries.length, year === 2026 ? 1 : 2, 'Kein unzulässiger Jahresstand 2025');
            for (const entry of state.value.wealthHistory.entries) {
                const historicalCash = cashHistory.entries.filter(point => point.date <= entry.asOf).at(-1)?.value ?? cashHistory.baselineValue;
                assertEqual(entry.tagesgeld, historicalCash, 'Historischer Cash aus Cashquelle');
                for (const [key, type] of [['depotwertAlt', 'aktien_alt'], ['depotwertNeu', 'aktien_neu'], ['geldmarktEtf', 'geldmarkt']]) {
                    const expected = lots.filter(lot => lot.type === type && lot.purchaseDate <= entry.asOf)
                        .reduce((sum, lot) => sum + lot.shares * syntheticQuote(lot.ticker, entry.asOf).price, 0);
                    assert(Math.abs(entry[key] - expected) < 0.01, 'Historische Bewertung aus Stück-/Kursquelle: ' + key);
                }
                assert(entry.total > 0 && Number.isFinite(entry.total), 'Historische Summe positiv und endlich');
                assertEqual(entry.aktienEtf, entry.depotwertAlt + entry.depotwertNeu, 'Historische Aktiensumme');
                assertEqual(entry.total, entry.tagesgeld + entry.geldmarktEtf + entry.aktienEtf, 'Historische Gesamtsumme');
                assertEqual(entry.asOf, entry.reason === 'annual_close' ? `${year - 1}-12-31` : `${year}-01-01`, 'Jahresend-/Januarvertrag unverändert');
            }
            for (let n = 0; n < 4; n++) assertEqual(state.value.inputs[n ? `endeVJ_${n}` : 'endeVJ'], Math.round(syntheticAnnualQuote('VWCE.DE', year - 1 - n, date).price), 'Vorjahreskursfolge passend zur bestätigten Periode');
            assertEqual(state.value.inputs.ath, Math.max(...[0, 1, 2, 3].map(n => state.value.inputs[n ? `endeVJ_${n}` : 'endeVJ'])), 'ATH konsistent mit Kursfolge');
            assertEqual(data[CONFIG.STORAGE.LS_KEY], JSON.stringify(state.value), 'Balance vollständig parsebar');
            assertEqual(state.value.inputs.tagesgeld, Number(data.profile_tagesgeld), 'Persönlicher Balancecash entspricht Profilcash');
            for (const [key, expected] of Object.entries({ floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500 })) {
                assertEqual(state.value.inputs[key], expected, 'Persönliche Bedarfsvorgabe: ' + key);
                assertEqual(state.value.profilverbundHouseholdInputs[key], expected, 'Haushaltsbedarf ohne Verdopplung: ' + key);
            }
            for (const [key, type] of [['depotwertAlt', 'aktien_alt'], ['depotwertNeu', 'aktien_neu'], ['geldmarktEtf', 'geldmarkt']]) {
                const value = lots.filter(lot => lot.type === type).reduce((sum, lot) => sum + lot.shares * lot.currentPrice, 0);
                assert(Math.abs(state.value.inputs[key] - value) < 0.01, 'Persönlicher Bestand entspricht Tranchen: ' + key);
            }
            for (const [key, expected] of Object.entries({ tagesgeld: 30000, geldmarktEtf: 60000, depotwertAlt: 340000, depotwertNeu: 360000 })) {
                assert(Math.abs(state.value.profilverbundHouseholdInputs[key] - expected) < 0.01, 'Gespeicherte Haushaltssumme: ' + key);
            }
        }
        const equity = model.household.assets - model.household.allocation.cash - model.household.allocation.geldmarkt;
        assert(equity >= 650000 && equity <= 750000, 'Aktien im realistischen Zielbereich');
        assert(model.household.assets >= 750000 && model.household.assets <= 850000, 'Gesamtvermögen im realistischen Zielbereich');
        assertEqual(model.summary.monthlyBudget, receipt.adopted.monthlyBudget, 'Festes Budget stammt aus der echten Jahresrechnung');
        assertEqual(model.summary.monthlyWithdrawal, receipt.adopted.monthlyWithdrawal, 'Jahresentnahme stammt aus der echten Jahresrechnung');
        assertClose(model.summary.monthlyBudget, (30000 + 30000 * receipt.adopted.flexRate / 100) / 12, 0.01,
            'Festes Budget berücksichtigt die Flex-Kürzung der echten Jahresrechnung');
        assertEqual(model.summary.monthlyBudget - model.summary.monthlyWithdrawal, 2300, 'Budget enthält nur die im Startjahr laufende Max-Rente');
        const januaryLiquidity = Object.values(registry.profiles).reduce((sum, profile) => {
            const entry = loadStoredBalanceStateFromData(profile.data).value.wealthHistory.entries.find(item => item.asOf === `${year}-01-01`);
            return sum + entry.tagesgeld + entry.geldmarktEtf;
        }, 0);
        assertClose(receipt.adopted.liquidityBefore, januaryLiquidity / receipt.adopted.action.zielLiquiditaet * 100, 1e-8,
            'Beleg bewertet die vorhandenen Stücke und Cashstände wie der Januar-Verlauf');
        const expenses = JSON.parse(records.balance_expenses_v1);
        assertEqual(expenses.activeYear, year, 'Ausgaben aktives Startjahr');
        assertEqual(Object.keys(expenses.years[year].months).length, Number(date.slice(5, 7)) - 1, 'Nur abgelaufene Startjahrmonate befüllt');
        assertEqual(Object.keys(expenses.years[year - 1].months).length, 12, 'Vollständiges Vorjahr');
        assert(!expenses.years[year].months[Number(date.slice(5, 7))], 'Startmonat nicht vorbefüllt');
        for (const curve of Object.entries(JSON.parse(records.rs_daily_prices_v1).symbols)) {
            const chart = syntheticChart(curve[0], [syntheticDay(`${year - 1}-01-01`), syntheticDay(date)], date);
            assertEqual(JSON.stringify(curve[1].days), JSON.stringify(chart.days), 'Tägliche Kurstage aus API');
            assertEqual(JSON.stringify(curve[1].closes), JSON.stringify(chart.closes), 'Tägliche Kurse aus API');
        }
        for (const period of Object.values(expenses.years)) for (const month of Object.values(period.months)) {
            assertEqual(Object.values(month.profiles).reduce((sum, profile) => sum - Object.values(profile.categories).reduce((a, b) => a + b, 0), 0), 5000, 'Ausgaben entsprechen dem Wunschbedarf vor Flex-Kürzung');
        }
        if (['2026-06-15', '2027-06-15', '2031-11-02', '2060-06-15'].includes(date)) await verifyBalance(date);
    }
    for (const date of ['2027-06-15', '2027-07-01']) {
        setAppTestDate(date);
        await verifyBalance(date, '2026-06-15');
    }
    for (const [start, later, kind, month] of [
        ['2026-01-01', '2026-01-02', 'play', '2025-12'],
        ['2026-06-15', '2026-06-16', 'play', '2026-05'],
        ['2026-06-30', '2026-07-01', 'monthly', '2026-06'],
        ['2026-06-15', '2026-07-15', 'monthly', '2026-06'],
        ['2026-06-15', '2026-07-23', 'monthly', '2026-06'],
        ['2027-06-15', '2027-07-23', 'monthly', '2027-06'],
        ['2031-11-02', '2031-12-02', 'monthly', '2031-11'],
        ['2026-12-15', '2027-01-02', 'annual', '2026-12'],
        ['2026-12-31', '2027-01-01', 'annual', '2026-12']]) {
        const original = createMusterHaushaltRecords(start), moved = rebuildSyntheticPriceRecords(original, later);
        assertEqual(moved[ANNUAL_PLAN_RECORD_KEY], original[ANNUAL_PLAN_RECORD_KEY], 'Datumssprung erhält den Muster-Jahresbeleg bytegleich');
        const model = projectOverview({ registry: JSON.parse(moved.rs_profiles_v1), activeId: moved.rs_active_profile,
            liveData: moved, now: new Date(`${later}T12:00:00`) });
        assertEqual(model.occasion.kind, kind, 'Gleicher Bestand folgt Kalenderwechsel');
        assertEqual(model.occasion.month, month, 'Anlass betrifft gerade abgelaufenen Monat');
        assertEqual(model.occasion.annualState, kind === 'annual' ? 'open' : 'done', 'Jahresanlass gewinnt bei Jahreswechsel');
        const oldRegistry = JSON.parse(original.rs_profiles_v1), newRegistry = JSON.parse(moved.rs_profiles_v1);
        for (const id of MUSTER_PROFILE_IDS) for (const key of [CONFIG.STORAGE.LS_KEY, 'overview_month_provision_v1', 'profile_geburtsdatum', 'profile_rentenbeginn']) {
            assertEqual(newRegistry.profiles[id].data[key], oldRegistry.profiles[id].data[key], 'Kursneuaufbau erhält bestätigte Perioden und Personen');
        }
    }
    for (const invalid of ['2026-02-30', '2026-13-01', '2027-02-29']) {
        let invalidRejected = false;
        try { createMusterHaushaltRecords(invalid); } catch { invalidRejected = true; }
        assert(invalidRejected, 'Ungültiger Kalendertag wird abgewiesen');
    }
    let rejected = false;
    try { createMusterHaushaltRecords('2025-12-31'); } catch (error) { rejected = error.message.includes('ab 01.01.2026'); }
    assert(rejected, 'Datum vor unterstütztem Start wird mit Vorabhinweis abgewiesen');
} finally { setAppTestDate(null); }

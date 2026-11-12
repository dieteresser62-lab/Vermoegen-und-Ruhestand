import { UIUtils } from '../app/balance/balance-utils.js';
import { persistenceStorage, resetPersistenceForTests, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { formatCurrency, calculateTotals, renderSummary, SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { initUIRenderer, UIRenderer } from '../app/balance/balance-renderer.js';
import { bindHouseholdPlanField, readBoundHouseholdPlanField, householdPlanFieldSpec } from '../app/shared/household-plan-fields.js';

console.log('--- Balance Renderer Summary Tests ---');

// Produktiver Kopf-Host ohne den früheren balanceScopeText-Ausgabehost.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const doc = createPresentationTestDocument();
    const scopeHost = doc.createElement('span');
    scopeHost.id = 'suiteHouseholdContext';
    const profileHost = doc.createElement('span');
    profileHost.id = 'suiteProfileContext';
    const profileText = 'Aktives Profil: Testprofil';
    profileHost.textContent = profileText;
    doc.body.append(scopeHost, profileHost);
    globalThis.document = doc;
    globalThis.window = { ...previousWindow, __profileRecoveryBlocker: false,
        __profilverbundProfileSummaries: [{ name: 'A', profileId: 'a' }, { name: 'B', profileId: 'b' }] };
    try {
        const renderer = new SummaryRenderer({ outputs: {} });
        const input = { profilName: 'Testprofil' };
        renderer.renderContext(input);
        assertEqual(scopeHost.textContent, 'Berechnet für: Haushalt · A + B', 'Haushaltsumfang landet über den DOM-Fallback im Kopf');
        assertEqual(profileHost.textContent, profileText, 'Haushaltsrendern erhält die aktive Profilanzeige');

        delete globalThis.window.__profilverbundProfileSummaries;
        renderer.renderContext(input);
        assertEqual(scopeHost.textContent, 'Berechnet für: aktives Profil · Testprofil', 'Ohne Zusammenfassungen ersetzt der Einzelprofilumfang den Haushalt im Kopf');
        assertEqual(profileHost.textContent, profileText, 'Einzelprofilrendern erhält die aktive Profilanzeige');

        globalThis.window.__profilverbundProfileSummaries = [{ name: 'A', profileId: 'a' }, { name: 'B', profileId: 'b' }];
        globalThis.window.__profileRecoveryBlocker = true;
        renderer.renderContext(input);
        assertEqual(scopeHost.textContent, 'Berechnet für: nicht verfügbar', 'Recovery ersetzt den vorherigen Umfang auch bei vorhandenen Haushalts- und Profildaten');
        assertEqual(profileHost.textContent, profileText, 'Recoveryrendern erhält die aktive Profilanzeige');
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
}

// --- TEST 1: formatCurrency ---
{
    const formatted = formatCurrency(1234.56);
    assert(formatted.includes('€'), 'formatCurrency should include euro symbol');
    assertEqual(formatted, '1.234,56\u00a0€', 'Detailformatter außerhalb der Karten bleibt centgenau');
}

// --- TEST 2: calculateTotals ---
{
    const totals = calculateTotals({
        depotwertGesamt: 1000,
        neuerBedarf: 2000,
        minGold: 300,
        zielLiquiditaet: 400
    });
    assertEqual(totals.depotwertGesamt, 1000, 'depotwertGesamt should be preserved');
    assertEqual(totals.neuerBedarf, 2000, 'neuerBedarf should be preserved');
    assertEqual(totals.minGold, 300, 'minGold should be preserved');
    assertEqual(totals.zielLiquiditaet, 400, 'zielLiquiditaet should be preserved');
}

// --- TEST 3: renderSummary updates DOM ---
{
    const outputs = {
        depotwert: { textContent: '' },
        neuerBedarf: { textContent: '' },
        minGoldDisplay: { textContent: '' },
        zielLiquiditaet: { textContent: '' }
    };
    // DOM-Outputs werden formatiert, Rückgabewerte bleiben numerisch.
    const totals = renderSummary(outputs, {
        depotwertGesamt: 1500.25,
        neuerBedarf: 2500.75,
        minGold: 100.50,
        zielLiquiditaet: 500.05
    });

    assertEqual(outputs.depotwert.textContent, '1.500\u00a0€', 'Depotdetail zeigt ganze Euro');
    assertEqual(outputs.neuerBedarf.textContent, '2.501\u00a0€', 'Bedarfsdetail zeigt ganze Euro');
    assertEqual(outputs.minGoldDisplay.textContent, '101\u00a0€', 'Goldziel zeigt ganze Euro');
    // Die bestehende Meldung ist der Testbeleg für B31 im Funktionsinventar.
    assertEqual(outputs.zielLiquiditaet.textContent, '500\u00a0€', 'zielLiquiditaet should be formatted');
    assertEqual(totals.depotwertGesamt, 1500.25, 'Numerischer Depotwert bleibt unverändert');
    assertEqual(totals.neuerBedarf, 2500.75, 'Numerischer Bedarf bleibt unverändert');
    assertEqual(totals.minGold, 100.50, 'Numerisches Goldziel bleibt unverändert');
    assertEqual(totals.zielLiquiditaet, 500.05, 'Numerisches Liquiditätsziel bleibt unverändert');

    for (const ui of [{ depotwertGesamt: 0, neuerBedarf: 0, minGold: 0, zielLiquiditaet: 0 }, {}]) {
        const zeroTotals = renderSummary(outputs, ui);
        for (const key of Object.keys(outputs)) assertEqual(outputs[key].textContent, '0\u00a0€', `${key}: Null/Fallback zeigt ganze Euro`);
        for (const key of Object.keys(zeroTotals)) assertEqual(zeroTotals[key], 0, `${key}: Null/Fallback bleibt numerisch Null`);
    }
    assertEqual(renderSummary().depotwertGesamt, 0, 'Fehlende Ausgabehosts bleiben zulässig');
    assertEqual(renderSummary({}, { depotwertGesamt: 1500.25 }).depotwertGesamt, 1500.25, 'Fehlende Hosts verändern den Rückgabewert nicht');
}

// --- TEST 4: vollständiger Überblick mit Ganz-Euro-Kartenzeilen und Ganz-Euro-Budget ---
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const formDoc = createSelectionDocument(), blurredNeeds = {};
    for (const [path, text, expected] of [['floorBedarf', '18.003,25', 18003.25], ['flexBedarf', '12.006,50', 12006.5]]) {
        const field = addField(formDoc, path);
        const binding = bindHouseholdPlanField({ doc: formDoc, field, path });
        field.value = text;
        field.dispatchEvent({ type: 'blur' });
        blurredNeeds[path] = readBoundHouseholdPlanField(field);
        assertEqual(blurredNeeds[path], expected, `${path}: Planfeld behält Centwert nach Blur`);
        binding.dispose();
    }
    const previousDocument = globalThis.document;
    const doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const outputs = Object.fromEntries(['depotwert', 'neuerBedarf', 'minGoldDisplay', 'zielLiquiditaet',
            'balanceMonthlyBudget', 'balanceNeedRows', 'balanceNeedTotal', 'balanceFloorCoverage', 'balanceReserveRows', 'balanceReserveRunway']
            .map(key => [key, doc.createElement('div')]));
        const renderer = new SummaryRenderer({ outputs });
        const ui = {
            depotwertGesamt: 1500.25, neuerBedarf: 2500.75, minGold: 100.50, zielLiquiditaet: 500.05,
            input: { ...blurredNeeds, renteAktiv: true, renteMonatlich: 1000.25,
                tagesgeld: 10000.15, geldmarktEtf: 2000.20, goldWert: 300.65, liquidityRunwayYears: 3 },
            spending: { monatlicheEntnahme: 1000.25 },
            runway: { months: 9.25 }, vpw: { gesamtwert: 95000.75 },
            healthBucketDiagnostics: { operativeLiquidity: 9000.35, lockedAmount: 10000.25 }
        };
        renderer.renderOverview(ui);
        const details = { depotwert: '1.500\u00a0€', neuerBedarf: '2.501\u00a0€',
            minGoldDisplay: '101\u00a0€', zielLiquiditaet: '500\u00a0€' };
        for (const [key, expected] of Object.entries(details)) assertEqual(outputs[key].textContent, expected, `${key}: vollständiger Überblick zeigt ganze Euro`);
        const rowValue = (host, label) => {
            const amount = host.children.flatMap(node => node.className === 'household-plan-group' ? node.children.slice(1) : [node]).find(row => row.children[0].textContent === label)?.children[1];
            return amount?.children.length ? amount.children.map(node => node.textContent).join('') : amount?.textContent;
        };
        for (const [label, expected] of [
            [householdPlanFieldSpec('floorBedarf').label, '1.500\u00a0€ / Monat'],
            [householdPlanFieldSpec('flexBedarf').label, '1.001\u00a0€ / Monat']
        ]) assertEqual(rowValue(outputs.balanceNeedRows, label), expected, `${label}: benachbarte Bedarfszeile zeigt ganze Euro`);
        assertEqual(outputs.balanceNeedTotal.textContent, '2.501\u00a0€', 'Bedarf gesamt steht als Kennzahl über den Zeilen');
        assertEqual(outputs.balanceMonthlyBudget.children.map(node => node.textContent).join(''), '2.001\u00a0€', 'Großes Monatsbudget 2000,50 bleibt in ganzen Euro');

    } finally { globalThis.document = previousDocument; }
}

// TD-1: Die Budgetzeile nimmt alle Beträge aus der Projektion, auch wenn das laufende Jahr abweicht.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const previousDocument = globalThis.document;
    const doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const ids = ['balanceMonthlyBudget', 'balanceAnnualBudget', 'balanceMonthlyIncome', 'monatlicheEntnahme', 'balanceFlowBudget',
            'balanceMonthlySaving', 'balanceFlowSaving', 'balanceFlowWithdrawal', 'balanceBudgetBar', 'balanceWithdrawalPlan'];
        const outputs = Object.fromEntries(ids.map(key => [key, doc.createElement('div')]));
        const renderer = new SummaryRenderer({ outputs });
        const money = UIUtils.formatBalanceCurrency, json = JSON.stringify;
        const line = () => ({ income: outputs.balanceMonthlyIncome.textContent, withdrawal: outputs.monatlicheEntnahme.children.map(node => node.textContent).join(''),
            budget: outputs.balanceFlowBudget.textContent, saving: outputs.balanceMonthlySaving.textContent,
            savingHidden: outputs.balanceFlowSaving.hidden, withdrawalHidden: outputs.balanceFlowWithdrawal.hidden });
        const year = (renteMonatlich, monatlicheEntnahme, floorBedarf, flexBedarf) => ({
            input: { renteAktiv: true, renteMonatlich, floorBedarf, flexBedarf }, spending: { monatlicheEntnahme } });

        renderer.renderOverview({ ...year(2000, 8000, 60000, 60000), currentYear: year(1500, 7000, 60000, 60000) });
        assertEqual(json(line()), json({ income: money(2000), withdrawal: money(8000), budget: money(10000), saving: money(0),
            savingHidden: true, withdrawalHidden: false }), 'Abweichendes laufendes Jahr: 2.000 + 8.000 = 10.000 aus der Projektion');

        renderer.renderOverview({ ...year(5000, 200, 30000, 12000), currentYear: year(4000, 300, 30000, 12000) });
        const surplus = line();
        assertEqual(json(surplus), json({ income: money(5000), withdrawal: money(0), budget: money(3700), saving: money(1300),
            savingHidden: false, withdrawalHidden: false }), 'Ansparjahr: Einkünfte + Vermögen = Budget + angelegt aus der Projektion');

        const same = year(2400, 3600, 40000, 20000);
        renderer.renderOverview(same);
        const before = line();
        renderer.renderOverview({ ...same, currentYear: structuredClone(same) });
        assertEqual(json(line()), json(before), 'Gleiches laufendes Jahr und gleiche Projektion zeigen dieselbe Zeile wie ohne Projektion');
        assertEqual(before.withdrawal, money(3600), 'Ohne Abweichung bleibt die Entnahme unverändert');
    } finally { globalThis.document = previousDocument; }
}

// Produktive Fassade wie in balance-main: Konstruktion mit Storage und Gesamtrendern.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const previousDocument = globalThis.document;
    const doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const outputs = Object.fromEntries(['balanceMonthlyBudget',
            'balanceMarketAlarm', 'marktstatusText', 'balanceNeedRows']
            .map(key => [key, doc.createElement('div')]));
        let adjustedAge = 2026;
        let stateReads = 0;
        initUIRenderer({ outputs }, { loadState: () => {
            stateReads++;
            return { needsAdjustedForInflationYear: adjustedAge };
        } });
        const ui = {
            input: { aktuellesAlter: 68, referenceYear: 2027, inflation: 2, floorBedarf: 18000, flexBedarf: 12000,
                renteAktiv: true, renteMonatlich: 1000 },
            spending: { monatlicheEntnahme: 1000, details: { flexRate: 60 } },
            market: { sKey: 'corr_young', szenarioText: 'Junge Korrektur' },
            balanceAlarmActive: false
        };
        const marketNote = () => outputs.marktstatusText.children
            .find(node => node.className === 'balance-market-note')?.textContent;
        const inflationNote = () => outputs.balanceNeedRows.children.flatMap(group => group.children.slice(1))
            .find(row => row.children[0].textContent.startsWith('Inflation ·'))?.children[0].children[0].children[1].textContent;

        UIRenderer.render(ui);
        assertEqual(marketNote(), undefined, 'Marktkarte wiederholt die Budgetkürzung nicht');
        assert(inflationNote()?.includes('Bedarfe noch nicht angepasst'), 'Inflationszusatz liest den älteren Anpassungsstand über den produktiv konstruierten Renderer');
        assert(stateReads > 0, 'Produktive Renderer-Konstruktion reicht den StorageManager an den SummaryRenderer weiter');

        const uncut = { ...ui, spending: { monatlicheEntnahme: 1500, details: { flexRate: 100 } } };
        adjustedAge = 2027;
        UIRenderer.render(uncut);
        assertEqual(marketNote(), undefined, 'Auch Vollfinanzierung steht nur beim Monatsbudget');
        assert(inflationNote()?.includes('Bedarfe bereits angepasst'), 'Folgerendern liest den aktuellen Anpassungsstand statt eines alten oder fehlenden Storagewerts');

        const missingComparison = { ...ui, input: { ...ui.input, flexBedarf: undefined } };
        UIRenderer.render(missingComparison);
        assertEqual(marketNote(), undefined, 'Fehlende Bedarfsvergleichswerte entfernen den Kürzungszusatz statt keine Kürzung zu behaupten');
        UIRenderer.render({ ...ui, spending: {} });
        assertEqual(marketNote(), undefined, 'Fehlende Entnahme erzeugt ebenfalls keinen Kürzungszusatz');

        UIRenderer.render({ ...ui, balanceAlarmActive: true });
        assertEqual(marketNote(), undefined, 'Aktiver Alarm wiederholt die Budgetkürzung nicht am Marktchip');
        assertEqual(outputs.balanceMarketAlarm.hidden, false, 'Aktiver Alarm bleibt im bestehenden Hinweisband sichtbar');
        UIRenderer.render({ ...missingComparison, balanceAlarmActive: true });
        assertEqual(marketNote(), undefined, 'Alarmband genügt auch ohne Kürzungsvergleich');
        UIRenderer.render(uncut);
        assertEqual(outputs.balanceMarketAlarm.hidden, true, 'Folgerendern entfernt einen aufgehobenen Alarm aus dem Hinweisband');

        UIRenderer.render({ ...ui, input: { ...ui.input, inflation: undefined } });
        assertEqual(inflationNote(), undefined, 'Fehlende Inflationswerte entfernen die Inflationszeile samt Anpassungszusatz');
    } finally {
        initUIRenderer({}, undefined);
        globalThis.document = previousDocument;
    }
}

console.log('✅ Balance renderer summary tests passed');
console.log('--- Balance Renderer Summary Tests Completed ---');

// Echte Summary-Ausgabe schützt Klassenanker, Warntext, Monatsbetrag und Datenvertrag.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const doc = createPresentationTestDocument(), previous = globalThis.document;
    globalThis.document = doc;
    try {
        const outputs = { monatlicheEntnahme: doc.createElement('div'), marktstatusText: doc.createElement('div') };
        const containers = { bedarfAnpassung: doc.createElement('div') };
        const renderer = new SummaryRenderer({ outputs, containers });
        renderer.renderEntnahme({ monatlicheEntnahme: 1234.56, anmerkung: 'Synthetischer vorhandener Grund' });
        assertEqual(outputs.monatlicheEntnahme.children[0].textContent, UIUtils.formatBalanceCurrency(1234.56), 'Quelle zeigt nur den vorhandenen Monatsbetrag');
        assertEqual(outputs.monatlicheEntnahme.children.length, 1, 'Jahresklammer und technischer Subtext entfallen in der Budgetquelle');
        const spending = { monatlicheEntnahme: 1234.56, anmerkung: 'Synthetischer vorhandener Grund' };
        const beforeSpending = JSON.stringify(spending);
        renderer.renderEntnahme(spending);
        assertEqual(JSON.stringify(spending), beforeSpending, 'Jahresbetrag und fachlicher Grund bleiben im Datenvertrag erhalten');
        renderer.renderEntnahme({});
        assertEqual(outputs.monatlicheEntnahme.children[0].textContent, '—', 'Fehlender Betrag behält keinen alten Wert');
        renderer.renderBedarfAnpassungUI({ aktuellesAlter: 68, referenceYear: 2027, inflation: 2 }, { needsAdjustedForInflationYear: 2026 });
        assert(!containers.bedarfAnpassung.innerHTML.includes('btn-apply-inflation') && containers.bedarfAnpassung.innerHTML.includes('Jahresabschluss'), 'Fortschreibung verweist auf Jahresabschluss statt unterjährigem Write');
        outputs.healthBucketSummary = doc.createElement('div');
        renderer.renderHealthBucket({ enabled: true, lockedAmount: 100.25, targetInflationAdjusted: 200.75,
            operativeLiquidity: 300.25, grossLiquidity: 400.5, targetCoveragePct: 50, targetGap: 100.5,
            releaseReason: 'Synthetischer Sperrgrund', warning: 'Synthetische Pflegewarnung' });
        assert(outputs.healthBucketSummary.children.at(-1).className.includes('ds-note-warning')
            && outputs.healthBucketSummary.children.at(-1).textContent === 'Synthetische Pflegewarnung', 'Pflegewarnung behält ihren bestehenden Grund');
        assertEqual(outputs.healthBucketSummary.children[3].textContent, 'Synthetischer Sperrgrund', 'Pflegepolicy bleibt unverändert sichtbar');
        assertEqual(outputs.healthBucketSummary.children[0].children[2].textContent, 'Ziel: 201\u00a0€', 'Pflegeziel zeigt ganze Euro');
        assertEqual(outputs.healthBucketSummary.children[1].children[2].textContent, 'Brutto: 401\u00a0€', 'Brutto-Unterzeile zeigt ganze Euro');
        assertEqual(outputs.healthBucketSummary.children[2].children[2].textContent, 'Lücke: 101\u00a0€', 'Pflegelücke zeigt ganze Euro');
        renderer.renderMarktstatus({ szenarioText: 'Tiefer Bär', reasons: ['Synthetischer Marktgrund'] });
        assert(outputs.marktstatusText.children[0].className.includes('status-red'), 'Bestehender Marktstatus bleibt kritisch');
        assertEqual(outputs.marktstatusText.children[0].title, 'Synthetischer Marktgrund', 'Marktgrund bleibt am Phasenchip lesbar vorhanden');
        assertEqual(outputs.marktstatusText.children.length, 1, 'Kein zusätzliches Infosymbol am Phasenchip');
        for (const key of ['balanceMonthlyBudget', 'balanceAnnualBudget', 'balanceMonthlyIncome', 'balanceBudgetCut', 'balanceActionCoverage', 'balanceActionFootnote', 'balanceActionDisclaimer', 'balanceNeedProfiles', 'balanceBudgetChips', 'balanceNeedRows', 'balanceNeedTotal', 'balanceFloorCoverage', 'balanceReserveRows', 'balanceMarketFacts', 'balanceMarketScale', 'balancePlanningYear', 'balanceScope', 'balanceAnnualRecovery']) {
            outputs[key] = doc.createElement('div');
        }
        let metadata;
        const plan = new SummaryRenderer({ outputs }, { loadState: () => ({ annualPeriodMetadata: metadata }) });
        const ui = { input: { aktuellesAlter: 68, renteAktiv: true, renteMonatlich: 1000, floorBedarf: 18000, flexBedarf: 12000, tagesgeld: 10000, geldmarktEtf: 2000, jahreSeitAth: 2, marketCapeRatio: 30 },
            spending: { monatlicheEntnahme: 1000, details: { flexRate: 60 } }, neuerBedarf: 18000,
            market: { sKey: 'corr_young', szenarioText: 'Junge Korrektur', abstandVomAthProzent: 12 },
            liquiditaet: { deckungVorher: 50 }, healthBucketDiagnostics: { operativeLiquidity: 9000 } };
        plan.renderPlanCards(ui);
        assertEqual(outputs.balanceMonthlyBudget.textContent, UIUtils.formatBalanceCurrency(2000), 'Monatsbudget addiert feste Einkünfte und finanzierte Entnahme');
        assertEqual(outputs.balanceBudgetCut.textContent, `Dein Haushalts-Flex ist zu 50,0\u00a0% finanziert: ${UIUtils.formatBalanceCurrency(500)} weniger im Monat, als du planst.`, 'Kürzung aus tatsächlichem Monatsbudget und Bedarf');
        assert(!outputs.balanceBudgetChips.children.some(node => node.textContent.startsWith('Flex-Rate')), 'Der Kürzungssatz nennt die gelieferte Flex-Rate ohne zusätzlichen Chip');
        plan.renderPlanCards({ ...ui, spending: { monatlicheEntnahme: 1500, details: { flexRate: 100 } } });
        assert(outputs.balanceBudgetCut.textContent === 'Dein Haushalts-Flex ist voll finanziert.', 'Ohne Kürzung bestätigt der Satz die Vollfinanzierung');
        plan.renderPlanCards({ input: {} });
        assert(outputs.balanceBudgetCut.textContent === '', 'Fehlende Werte erzeugen keine Nullkürzung');
        plan.renderPlanCards(ui);

        assert(outputs.balanceMarketScale.children[3].className.includes('active'), 'Skala markiert ausschließlich den gelieferten sKey');
        metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2025', phase: 'writes_started', snapshotId: 'synthetischer-recoverypunkt' } };
        plan.renderContext(ui.input);
        assert(!outputs.balanceAnnualRecovery.hidden && outputs.balanceAnnualRecovery.textContent.includes('synthetischer-recoverypunkt'), 'Recoveryhinweis bleibt außerhalb der Panels sichtbar');
        const targetYear = new Date().getFullYear() - 1;
        metadata = { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${targetYear}`, pendingCommit: null };
        const live = { profile_tagesgeld: '100', depot_tranchen: '[]',
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata, inputs: {} }) };
        const registry = { version: 1, profiles: { a: { meta: { name: 'Synthetisch', belongsToHousehold: true }, data: live } } };
        const values = new Map(Object.entries({ ...live, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' }));
        resetPersistenceForTests({ getItemSync: key => values.get(key) ?? null,
            setItemSync: (key, value) => values.set(key, value), keysSync: () => [...values.keys()] });
        plan.renderContext(ui.input);
        plan.renderPlanCards({ ...ui, vpw: { enabled: true }, neuerBedarf: 24000 });
        assertEqual(outputs.balanceNeedTotal.textContent,
            UIUtils.formatBalanceCurrency(2500), 'Dynamic Flex vergleicht mit Plan-Grundbedarf plus Plan-Flex');
        const profileHost = doc.createElement('span'); profileHost.id = 'suiteProfileContext'; profileHost.textContent = 'Aktives Profil: <Profil A>'; doc.body.appendChild(profileHost);
        outputs.balanceScopeText = doc.createElement('b');
        const profilePill = doc.createElement('span'), profileIcon = doc.createElement('svg');
        profilePill.append(profileIcon, profileHost);
        const scopePill = doc.createElement('span'), scopeIcon = doc.createElement('svg');
        scopePill.append(scopeIcon, outputs.balanceScopeText);
        const originalWindow = globalThis.window;
        globalThis.window = { ...originalWindow, __profilverbundProfileSummaries: [{ name: '<Profil A>', profileId: 'a', totalAssets: 1234.56 }] };
        try {
            const input = { ...ui.input, profilName: '<Profil A>', inflation: 2.1 };
            const raw = JSON.stringify(input);
            plan.renderPlanCards({ ...ui, input, liquiditaet: { deckungNachher: 99.25 } });
            assertEqual(outputs.balanceNeedRows.children.flatMap(group => group.children.slice(1)).length, 4, 'Beide Gruppen bewahren den finanzierten Haushalts-Flex und alle bisherigen Bedarfswerte');
            assertEqual(outputs.balanceNeedProfiles.children.length, 0, 'Ohne Profilbedarfswerte entsteht keine Vermögensersatzzeile');
            assert(outputs.balanceNeedProfiles.hidden, 'Profilbedarfshost bleibt ohne vorhandenen Bedarf verborgen');
            assertEqual(outputs.balanceActionCoverage.textContent, ' Danach 99,3\u00a0% des Ziels.', 'Erklärung nutzt die gelieferte Nachherdeckung');
            plan.renderPlanCards({ ...ui, input });
            assertEqual(outputs.balanceActionCoverage.textContent, '', 'Fehlende Nachherdeckung lässt den Zusatz entfallen');
            assertEqual(JSON.stringify(input), raw, 'Kartenanzeige verändert keine Eingaben');
            assertEqual(profileHost.textContent, 'Aktives Profil: <Profil A>', 'Summary kopiert oder ersetzt die gemeinsame Profilidentität nicht');
            assertEqual(outputs.balanceScopeText.textContent, 'Berechnet für: Haushalt · <Profil A>', 'Summary übernimmt den gelieferten Berechnungsumfang ohne Profilkopie');
            assertEqual(scopePill.children[0], scopeIcon, 'Kontextneuerung erhält das dekorative Haushaltssymbol');
            const seedPeriod = () => {
                const current = { ...live, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata, inputs: {} }),
                    balance_expenses_v1: JSON.stringify({ version: 1, activeYear: targetYear, years: { [targetYear]: { months: {} } } }) };
                const selected = { version: 1, profiles: { a: { meta: { name: 'Synthetisch' }, data: current } } };
                const source = new Map(Object.entries({ ...current, rs_profiles_v1: JSON.stringify(selected), rs_current_profile: 'a', rs_active_profile: 'a' }));
                resetPersistenceForTests({ getItemSync: key => source.get(key) ?? null, setItemSync: (key, value) => source.set(key, value), keysSync: () => [...source.keys()] });
            };
            outputs.balanceActionPeriod = doc.createElement('span');
            outputs.balanceActionPreviewTitle = doc.createElement('span');
            const checkPreview = expectedYear => {
                const detailOutputs = { handlungsanweisung: doc.createElement('div'), actionDetailsTitle: doc.createElement('h2') };
                // Echte Fassade, auch wenn die Detailansicht keine Budgetkarte besitzt.
                initUIRenderer({ outputs: { ...detailOutputs, balanceActionPeriod: outputs.balanceActionPeriod,
                    balanceActionPreviewTitle: outputs.balanceActionPreviewTitle, balanceActionDisclaimer: outputs.balanceActionDisclaimer } }, { loadState: () => ({ annualPeriodMetadata: metadata }) });
                UIRenderer.render({ ...ui, input, action: { type: 'NONE', title: 'Kein Handel nötig' } });
                const label = `Vorläufige Vorschau · Jahresabschluss ${expectedYear}`;
                // WT-1 (FR-77 Punkt 4), WT-1b: Die Vorschau ist eine zugeklappte Zeile „Vorschau auf den Plan {J+1}“.
                assertEqual(outputs.balanceActionPreviewTitle.textContent, `Vorschau auf den Plan ${expectedYear + 1}`, 'Vorschauzeile nennt den Plan des nächsten Abschlusses');
                assert(outputs.balanceActionDisclaimer.textContent.startsWith('So sähe der Plan aus, wenn heute der 31.12. wäre.'), 'Aufgeklappt steht ein Satz zur Vorschau');
                assert(detailOutputs.actionDetailsTitle.textContent.startsWith(label), 'Dialogtitel nennt das Abschlussjahr der Herkunftsprojektion');
                const copy = UIRenderer.getActionCopyText();
                assert(copy.startsWith(label), 'Kopie übernimmt das Label derselben Herkunftsprojektion');
            };
            metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            assert(outputs.balanceActionPreviewTitle.textContent.includes(`Plan ${targetYear + 1}`), 'Offenes Vorjahr: Vorschau auf den Plan, den der nächste Jahresabschluss beschließt');
            checkPreview(targetYear);
            metadata = { schemaVersion: 99, lastCommittedPeriod: null, pendingCommit: null }; seedPeriod(); plan.renderContext(input);
            metadata = { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${targetYear}`, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            checkPreview(targetYear + 1);
            const { setAppTestDate } = await import('../app/shared/app-clock.js');
            const { createManualWealthHistoryEntry } = await import('../types/wealth-history-contract.js');
            try {
                setAppTestDate('2026-01-02'); metadata = null;
                const first = { ...live, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ wealthHistory: { schemaVersion: 1, entries: [
                    createManualWealthHistoryEntry({ tagesgeld: 100, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 }, '2026-01-01')
                ] } }) };
                const firstRegistry = { version: 1, profiles: { a: { meta: { name: 'Erstperson' }, data: first } } };
                const source = new Map(Object.entries({ ...first, rs_profiles_v1: JSON.stringify(firstRegistry), rs_current_profile: 'a', rs_active_profile: 'a' }));
                resetPersistenceForTests({ getItemSync: key => source.get(key) ?? null, setItemSync: (key, value) => source.set(key, value), keysSync: () => [...source.keys()] });
                const before = JSON.stringify([...source]);
                outputs.balanceBudgetChips.replaceChildren(); // Eigener Erstjahrfall, ohne die vorigen Zustandsfixtures.
                outputs.balanceActionPeriod = doc.createElement('span');
                plan.renderContext(input);
                assert(outputs.balanceActionPreviewTitle.textContent === 'Vorschau auf den Plan 2027' && outputs.balanceActionDisclaimer.textContent.includes('erster Jahresabschluss Anfang 2027'), 'Erstjahrvorschau nennt den ersten Termin');
                assert(outputs.balanceActionPeriod.hidden !== false || outputs.balanceActionPeriod.textContent === '', 'Ohne Beleg kein Planchip, die Handlung bleibt vorläufig');
                checkPreview(2026);
                assert(!outputs.balanceBudgetChips.children.some(node => /ungeklärt/.test(node.textContent)), 'Kein ungeklärter Erstjahrchip');
                assertEqual(JSON.stringify([...source]), before, 'Erstjahrdarstellung ist schreibfrei');
            } finally { setAppTestDate(null); }

        } finally { globalThis.window = originalWindow; }

    } finally { resetPersistenceRuntimeForTests(); globalThis.document = previous; }
}

// Die Balancezeile liest genau das Planjahr und denselben Haushaltsbereich wie Ausgaben.
{
    const { readyAnnualFixture } = await import('./helpers/balance-storage-fixtures.mjs');
    const { setAppTestDate, getAppTestDate } = await import('../app/shared/app-clock.js');
    const { overviewScope } = await import('../app/overview/overview-storage.js');
    const previous = { date: getAppTestDate(), doc: globalThis.document, win: globalThis.window };
    try {
        setAppTestDate('2026-10-10');
        const sample = readyAnnualFixture();
        const values = new Map(Object.entries(sample.records));
        values.set('balance_expenses_v1', JSON.stringify({ version: 1, activeYear: 2025, years: {
            2025: { months: { 1: { profiles: { muster_a: { categories: { Altjahr: -999 } } } } } },
            2026: { months: { 1: { profiles: { muster_a: { categories: { Wohnen: -120, Erstattung: 20 } }, muster_b: { categories: { Lebensmittel: -60 } }, outsider: { categories: { Fremd: -800 } } } } } }
        } }));
        const scope = overviewScope('household', ['muster_a', 'muster_b']);
        const { buildAnnualPlanRecord } = await import('../app/profile/annual-plan-record.js');
        const { PLAN_DEFAULTS } = await import('../app/profile/household-plan.js');
        const outcome = { monthlyWithdrawal: 500, monthlyBudget: 1000, liquidityBefore: 2, liquidityAfter: 2, flexRate: 100, marketPhase: 'Normal', action: { type: 'NONE', title: 'Keine Transaktion' } };
        values.set('annual_plan_record_v1', buildAnnualPlanRecord(null, { targetYear: 2025, scope, committedAt: '2026-01-02T12:00:00Z', recommended: outcome,
            adopted: { ...outcome, snapshot: { inflation: 2, ageByPerson: { muster_a: 67, muster_b: 66 }, plan: structuredClone(PLAN_DEFAULTS) } } }).raw);
        values.set('overview_balance_summary_v1', JSON.stringify({ schemaVersion: 1, year: 2026, scope, monthlyBudget: 1000, monthlyWithdrawal: 500, status: 'vorläufig', createdAt: '2026-10-10T10:00:00Z' }));
        resetPersistenceForTests({ getItemSync: key => values.get(key) ?? null, setItemSync: (key, value) => values.set(key, value), keysSync: () => [...values.keys()] });
        const host = { textContent: '', setAttribute(name, value) { this[name] = value; } };
        globalThis.document = { getElementById: () => null, querySelector: () => null };
        globalThis.window = {};
        const plan = new SummaryRenderer({ outputs: { balanceExpensesSummary: host } }, { loadState: () => JSON.parse(values.get(CONFIG.STORAGE.LS_KEY)) });
        const before = JSON.stringify([...values]);
        plan.renderContext({});
        assert(host.textContent.includes('160'), 'Balance-Ausgabenzeile saldiert nur dieselben Haushaltspersonen im Planjahr');
        assert(host.textContent.includes('12.000'), 'Ausgabenübersichtszeile verwendet den Jahresbeleg desselben Bereichs');
        assert(!host.textContent.includes('960') && !host.textContent.includes('999'), 'Ausgabenzeile nimmt weder fremde Person noch fremdes Jahr hinzu');
        assertEqual(host.href, 'Ausgaben.html?year=2026#ausgaben', 'Übersichtszeile verlinkt das Planjahr direkt');
        assertEqual(JSON.stringify([...values]), before, 'Ausgabenübersichtszeile bleibt vollständig lesend');
        const registryRaw = values.get('rs_profiles_v1');
        const registry = JSON.parse(registryRaw);
        registry.profiles.muster_b.meta.belongsToHousehold = false;
        values.set('rs_profiles_v1', JSON.stringify(registry));
        const singleHousehold = overviewScope('household', ['muster_a']);
        values.set('annual_plan_record_v1', buildAnnualPlanRecord(null, { targetYear: 2025, scope: singleHousehold, committedAt: '2026-01-02T12:00:00Z', recommended: outcome,
            adopted: { ...outcome, snapshot: { inflation: 2, ageByPerson: { muster_a: 67 }, plan: structuredClone(PLAN_DEFAULTS) } } }).raw);
        plan.renderContext({});
        assert(host.textContent.includes('100') && !host.textContent.includes('160'), 'Einpersonenhaushalt liest nur seine eigenen Ausgaben');
        assert(host.textContent.includes('12.000'), 'Einpersonenhaushalt liest wie die Ausgabenseite den Haushaltsbeleg statt einen Einzelbeleg');
        values.set('rs_profiles_v1', registryRaw);
        values.set('balance_expenses_v1', '{synthetic-corrupt'); plan.renderContext({});
        assert(host.textContent.includes('nicht sicher lesbar'), 'Beschädigte Ausgaben erscheinen nicht als Nullsumme');
        values.set('balance_expenses_v1', JSON.stringify({ version: 1, years: {} })); plan.renderContext({});
        assert(host.textContent.includes('noch keine Imports'), 'Fehlende Imports erscheinen wie auf der neuen Seite als fehlende Daten');
    } finally {
        resetPersistenceRuntimeForTests(); setAppTestDate(previous.date);
        if (previous.doc === undefined) delete globalThis.document; else globalThis.document = previous.doc;
        if (previous.win === undefined) delete globalThis.window; else globalThis.window = previous.win;
    }
}

// Jahresbeleg und heutige Beträge am selben Ausgabehost; fehlende Reichweitenseiten bleiben getrennt.
{
    const { completedComparisonFixture } = await import('./household-plan-comparison.test.mjs?fixture');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { setAppTestDate, getAppTestDate } = await import('../app/shared/app-clock.js');
    const previous = { document: globalThis.document, date: getAppTestDate() };
    const doc = createPresentationTestDocument();
    const outputs = Object.fromEntries(['balanceBudgetPreview', 'balanceBudgetPlan', 'balanceWithdrawalPlan']
        .map(key => [key, doc.createElement('div')]));
    const fixture = completedComparisonFixture();
    const record = JSON.parse(fixture.records.annual_plan_record_v1);
    const adopted = Object.values(record.entries)[0].adopted;
    adopted.monthlyBudget = 5000; adopted.monthlyWithdrawal = 1900;
    fixture.records.annual_plan_record_v1 = JSON.stringify(record);
    try {
        globalThis.document = doc; setAppTestDate('2026-10-09');
        const model = projectOverview({ registry: fixture.registry, activeId: 'z', liveData: fixture.records, now: fixture.now });
        const renderer = new SummaryRenderer({ outputs });
        const ui = { input: { renteAktiv: true, renteMonatlich: 3100, floorBedarf: 30750, flexBedarf: 30000 }, spending: { monatlicheEntnahme: 1850 } };
        const before = JSON.stringify({ model, ui });
        renderer.renderBudgetOrigin(model, ui);
        assertEqual(outputs.balanceBudgetPreview.textContent, 'Vorschau heute · 09.10.2026', 'Vorschau und fachliches Datum stehen direkt beim Monatsbudget');
        assertEqual(outputs.balanceBudgetPlan.children[0].textContent, 'Plan 2026 · festgeschrieben am 02.01.2026', 'Beschlussdatum stammt aus dem echten Planbeleg');
        assertEqual(outputs.balanceBudgetPlan.children[1].textContent, '5.000\u00a0€', 'Gültiges Planbudget bleibt neben der Vorschau');
        assertEqual(outputs.balanceBudgetPlan.children[2].textContent, 'Differenz −50\u00a0€', 'Budgetkopf behält seine Differenz');
        assertEqual(outputs.balanceWithdrawalPlan.textContent, 'Plan 2026 aus dem Vermögen: 1.900\u00a0€/Monat', 'Entnahmekasten zeigt den kompakten gültigen Planwert');
        assertEqual(JSON.stringify({ model, ui }), before, 'Planvergleich verändert weder Vorschau noch festgeschriebenen Beleg');
        renderer.renderBudgetOrigin({ ...model, summary: { ...model.summary, year: 2025 } }, ui);
        assert(outputs.balanceBudgetPlan.hidden && outputs.balanceWithdrawalPlan.hidden && !outputs.balanceBudgetPreview.hidden,
            'Fremdes Planjahr hinterlässt keinen gültigen Vergleich; heutige Vorschau bleibt beschriftet');
        renderer.renderBudgetOrigin({ ...model, planComparison: { recordStatus: 'invalid' } }, ui);
        assert(!outputs.balanceBudgetPlan.children.length && !outputs.balanceWithdrawalPlan.children.length, 'Beschädigter Beleg hinterlässt keine früheren Planbeträge');

    } finally { globalThis.document = previous.document; setAppTestDate(previous.date); }
}

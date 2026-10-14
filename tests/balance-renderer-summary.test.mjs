import { UIUtils } from '../app/balance/balance-utils.js';
import { persistenceStorage, resetPersistenceForTests, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { formatCurrency, calculateTotals, renderSummary, SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { initUIRenderer, UIRenderer } from '../app/balance/balance-renderer.js';
import { bindHouseholdPlanField, readBoundHouseholdPlanField, householdPlanFieldSpec } from '../app/shared/household-plan-fields.js';

// Die erledigte Ansicht und ein neuer Jahresschritt werden aus echten Belegen projiziert.
{
    const { createMusterHaushaltRecords } = await import('../app/demo/muster-haushalt.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { setAppTestDate, getAppTestDate } = await import('../app/shared/app-clock.js');
    const previous = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate() };
    const records = new Map(Object.entries(createMusterHaushaltRecords('2026-10-13')));
    const doc = createPresentationTestDocument();
    const outputs = Object.fromEntries(['balanceNextSteps', 'balanceNextStatus', 'balanceNextAnnual', 'balanceNextAnnualLabel', 'marktstatusText', 'liquiditaetBalken', 'balkenContainer']
        .map(key => [key, doc.createElement('div')]));
    const card = doc.createElement('section');
    outputs.balanceNextSteps.closest = () => card;
    outputs.liquiditaetBalken.classList = { add: value => { outputs.liquiditaetBalken.className += ` ${value}`; } };
    try {
        globalThis.document = doc; globalThis.window = {};
        setAppTestDate('2026-10-13');
        resetPersistenceForTests({ getItemSync: key => records.get(key) ?? null, setItemSync: (key,value) => records.set(key,value), keysSync: () => [...records.keys()] });
        const before = JSON.stringify([...records]);
        const renderer = new SummaryRenderer({ outputs });
        renderer.renderContext({});
        assert(card.hidden && !outputs.balanceNextStatus.hidden, 'Ohne offenen Schritt steht nur die kompakte Statuszeile');
        assert(outputs.balanceNextStatus.textContent.includes('Alles erledigt') && outputs.balanceNextStatus.textContent.includes('Anfang 2027'), 'Erledigter Zustand nennt den nächsten Jahresabschluss');
        assert(outputs.balanceNextAnnual.hidden && outputs.balanceNextAnnual.disabled, 'Erledigtes Jahr zeigt keinen Startknopf');
        setAppTestDate('2027-01-02');
        renderer.renderContext({});
        assert(!card.hidden && outputs.balanceNextStatus.hidden, 'Fälliger Abschluss zeigt wieder die Schrittkarte');
        assert(!outputs.balanceNextAnnual.hidden && !outputs.balanceNextAnnual.disabled, 'Fälliges Jahr hat den bisherigen aktiven Jahreszugang');
        assertEqual(outputs.balanceNextAnnualLabel.textContent, 'Jahresabschluss 2026 starten', 'Startzugang nennt das fällige Jahr');
        assertEqual(JSON.stringify([...records]), before, 'Zustandsanzeige schreibt keine Finanz- oder Abschlussdaten');

        renderer.renderOverview({ input: {}, liquiditaet: { deckungVorher: 73.1, deckungNachher: 100 } });
        assertEqual(outputs.liquiditaetBalken.style.width, '73.1%', 'Reservebalken verwendet die aktuelle Deckung vor dem Vorschlag');
        assert(outputs.liquiditaetBalken.className.includes('bar-warn'), 'Aktuelle Unterdeckung zeigt keinen grünen Zielstatus');
        renderer.renderLiquidityBar(undefined);
        assertEqual(outputs.liquiditaetBalken.style.width, '0%', 'Fehlende Deckung entfernt einen alten Balken');
        for (const market of [{ sKey: 'peak_hot', szenarioText: 'Markt heiß gelaufen' }, { szenarioText: 'Markt heiß gelaufen' }]) {
            renderer.renderMarktstatus(market);
            assert(outputs.marktstatusText.children[0].className.includes('status-amber'), 'Heiße Marktphase verwendet die Warnfarbe');
        }
    } finally {
        globalThis.document = previous.doc; globalThis.window = previous.win; setAppTestDate(previous.date); resetPersistenceRuntimeForTests();
    }
}

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
            'balanceMonthlyBudget', 'balanceNeedRows', 'balanceReserveRows', 'balanceFreeLiquidity',
            'balanceReserveTargetMonths', 'balanceReserveRunway', 'balanceWealthFooter', 'miniSummary']
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
            const amount = host.children.find(row => row.children[0].textContent === label)?.children[1];
            return amount?.children.length ? amount.children.map(node => node.textContent).join('') : amount?.textContent;
        };
        for (const [label, expected] of [
            [householdPlanFieldSpec('floorBedarf').label, '1.500\u00a0€ / Monat'],
            [householdPlanFieldSpec('flexBedarf').label, '1.001\u00a0€ / Monat'],
            ['Bedarf gesamt', '2.501\u00a0€ / Monat']
        ]) assertEqual(rowValue(outputs.balanceNeedRows, label), expected, `${label}: benachbarte Bedarfszeile zeigt ganze Euro`);
        assertEqual(outputs.balanceFreeLiquidity.textContent, '9.000\u00a0€', 'Operative Liquidität zeigt ganze Euro');
        assertEqual(outputs.balanceReserveTargetMonths.textContent, '36\u00a0Monate', 'Zielmonate stammen vom Runwayparameter, nicht vom Istwert');
        assertEqual(outputs.balanceReserveRunway.textContent, 'Nach Vorschlag: reicht für 9,3\u00a0Monate Vermögensentnahme', 'Ist-Reichweite bleibt vom Ziel getrennt');
        assertEqual(outputs.balanceWealthFooter.textContent, 'Gesamtvermögen 95.001\u00a0€ · davon Pflegevorsorge 10.000\u00a0€ reserviert', 'Gesamtwert wird geliefert und Pflegevorsorge nicht doppelt addiert');
        assertEqual(outputs.balanceNeedRows.children[2].children[1].children[1].className, 'balance-unit', 'Monatliche Bedarfssumme hat eine kleine Einheit');
        assertEqual(rowValue(outputs.balanceReserveRows, 'Gold-Bestand'), '301\u00a0€', 'Gold-Bestand zeigt ganze Euro');
        assertEqual(outputs.balanceMonthlyBudget.children.map(node => node.textContent).join(''), '2.001\u00a0€', 'Großes Monatsbudget 2000,50 bleibt in ganzen Euro');

        renderer.renderOverview({ ...ui, healthBucketDiagnostics: undefined });
        assertEqual(outputs.balanceFreeLiquidity.textContent, '12.000\u00a0€', 'Liquiditätsfallback zeigt ganze Euro');
        assert(outputs.balanceWealthFooter.textContent.includes('— (Wert fehlt) reserviert'), 'Fehlende Pflegevorsorge wird nicht als Null ausgegeben');
        renderer.renderOverview({ input: {} });
        for (const [key, expected] of Object.entries(details)) assertEqual(outputs[key].textContent, expected, `${key}: fehlender Eingang überschreibt den Detailtext nicht`);
        assertEqual(outputs.balanceNeedRows.children.length, 0, 'Fehlende Bedarfseingänge erzeugen keine Geldzeilen');
        assertEqual(outputs.balanceReserveRows.children.length, 0, 'Fehlende Reserveeingänge erzeugen keine Geldzeilen');
        renderer.renderOverview({ input: {}, depotwertGesamt: 0, neuerBedarf: 0, minGold: 0, zielLiquiditaet: 0,
            runway: { months: Infinity }, vpw: { gesamtwert: 0 }, healthBucketDiagnostics: { lockedAmount: 0 } });
        for (const key of Object.keys(details)) assertEqual(outputs[key].textContent, '0\u00a0€', `${key}: echte Null bleibt sichtbar`);
        assertEqual(outputs.balanceReserveRunway.textContent, 'Nach Vorschlag: reicht für ∞\u00a0Monate Vermögensentnahme', 'Unendliche Ist-Reichweite wird nicht auf Zielmonate begrenzt');
        assertEqual(outputs.balanceWealthFooter.textContent, 'Gesamtvermögen 0\u00a0€ · davon Pflegevorsorge 0\u00a0€ reserviert', 'Echte Null bleibt auch bei deaktivierter Pflegevorsorge sichtbar');
        new SummaryRenderer({}, { loadState: () => ({ inputs: {} }) }).renderOverview();
        assert(true, 'Vollständiger Überblick toleriert fehlende Ausgabehosts und Eingabewerte');
    } finally { globalThis.document = previousDocument; }
}

// Produktive Fassade wie in balance-main: Konstruktion mit Storage und Gesamtrendern.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const previousDocument = globalThis.document;
    const doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetCutLegend',
            'balanceBudgetCutAmount', 'balanceMarketAlarm', 'marktstatusText', 'balanceNeedRows']
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
        const inflationNote = () => outputs.balanceNeedRows.children
            .find(row => row.children[0].textContent.startsWith('Inflation ·'))?.children[1].children
            .find(node => node.className === 'balance-need-meta')?.textContent;

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
        outputs.miniSummary = doc.createElement('div');
        renderer.renderMiniSummary({ input: { floorBedarf: 12000, flexBedarf: 24000, renteAktiv: false, tagesgeld: 10000, geldmarktEtf: 2000 },
            action: { verwendungen: { liquiditaet: 1000 } }, liquiditaet: { deckungVorher: 50, deckungNachher: 60 },
            runway: { months: 4, status: 'warn' } });
        const summaryItems = outputs.miniSummary.children[0].children;
        assert(summaryItems[1].className.includes('summary-kpi') && summaryItems[1].className.includes('ds-metric')
            && summaryItems[1].className.includes('status-warn'), 'KPI-Anker und bestehende Runwaywarnung bleiben mit additiver Rolle erhalten');
        assertEqual(summaryItems[1].children[1].textContent, '— → ', 'Fehlender Vorherwert bleibt fehlend; gelieferte Runway steht nachher');
        assert(summaryItems[0].className.includes('summary-item') && summaryItems[0].className.includes('ds-metric'), 'Vorher-/Nachher-Anker bleiben erhalten');
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
        for (const key of ['balanceMonthlyBudget', 'balanceAnnualBudget', 'balanceMonthlyIncome', 'balanceBudgetCut', 'balanceBudgetCutLegend', 'balanceBudgetCutAmount', 'balanceActionCoverage', 'balanceActionFootnote', 'balanceActionDisclaimer', 'balanceNextAnnualLabel', 'balanceNeedProfiles', 'balanceBudgetChips', 'balanceNeedRows', 'balanceReserveRows', 'balanceFreeLiquidity', 'balanceMarketFacts', 'balanceMarketScale', 'balancePlanningYear', 'balanceScope', 'balanceNextSteps', 'balanceAnnualRecovery']) {
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
        assert(!outputs.balanceBudgetCutLegend.hidden, 'Positive Kürzung besitzt eine dritte Legende');
        assertEqual(outputs.balanceBudgetCutAmount.textContent, `−${UIUtils.formatBalanceCurrency(500)}`, 'Legende nennt Kürzung mit Minuszeichen');
        plan.renderPlanCards({ ...ui, spending: { monatlicheEntnahme: 1500, details: { flexRate: 100 } } });
        assert(outputs.balanceBudgetCutLegend.hidden && outputs.balanceBudgetCut.textContent === 'Dein Haushalts-Flex ist voll finanziert.', 'Ohne Kürzung verschwinden Legende und Kürzungssatz nach Neurendern');
        plan.renderPlanCards({ input: {} });
        assert(outputs.balanceBudgetCutLegend.hidden && outputs.balanceBudgetCutAmount.textContent === '', 'Fehlende Werte erzeugen keine Nullkürzung');
        plan.renderPlanCards(ui);

        assert(outputs.balanceFreeLiquidity.textContent === UIUtils.formatBalanceCurrency(9000), 'Reserve berücksichtigt die gelieferte operative Liquidität');
        assert(outputs.balanceMarketScale.children[3].className.includes('active'), 'Skala markiert ausschließlich den gelieferten sKey');
        assert(!outputs.balanceNextSteps.children[0].children[1].children[1].textContent.includes('abgeschlossen'), 'Fehlende Legacy-Metadaten sind kein abgeschlossener Zeitraum');
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
        const stepIds = outputs.balanceNextSteps.children.map(node => node.getAttribute('data-next-step'));
        assert(!stepIds.includes('annual'), 'Abgeschlossenes Jahr erzeugt keinen offenen Jahresschritt');
        assertEqual(JSON.stringify(stepIds), JSON.stringify(projectOverview({ registry, activeId: 'a', liveData: live }).nextSteps.map(step => step.id)),
            'Balance-Renderer und Übersicht verwenden für denselben gespeicherten Zustand dieselben Schrittkennungen');
        assert(outputs.balanceAnnualRecovery.hidden, 'Abgeschlossener Fachzeitraum entfernt den Recoveryhinweis');
        const RealDate = globalThis.Date;
        try {
            globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [new RealDate(2027, 0, 15, 12).getTime()])); } };
            outputs.balanceNextAnnual = doc.createElement('button');
            metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            const initialized = { ...live, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata, inputs: {} }),
                balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
            const selected = { version: 1, profiles: { a: { meta: { name: 'Synthetisch' }, data: initialized } } };
            for (const [key, value] of Object.entries(initialized)) values.set(key, value);
            values.set('rs_profiles_v1', JSON.stringify(selected));
            const before = JSON.stringify([...values]);
            plan.renderContext(ui.input, { action: { verb: 'Verkaufen', betrag: 1000 } });
            assertEqual(outputs.balanceNextSteps.children[0].getAttribute('data-next-step'), 'annual', 'Echter Renderer zeigt fälligen Jahresabschluss zuerst');
            assertEqual(outputs.balanceNextAnnual.disabled, false, 'Initialisiertes leeres Vorjahr erhält aktiven Jahreszugang');
            assertEqual(outputs.balanceNextSteps.children[0].children[1].children[0].textContent, 'Jahr 2026 abschließen', 'Renderer nennt korrekte Periode');
            assertEqual(JSON.stringify([...values]), before, 'Rendering schreibt keine Persistenzwerte');
            for (const [nextMetadata, expected] of [
                [{ schemaVersion: 99, lastCommittedPeriod: null, pendingCommit: null }, 'Jahresstatus klären'],
                [{ ...metadata, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'synthetic' } }, 'Wiederherstellung öffnen']
            ]) {
                metadata = nextMetadata;
                initialized[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ annualPeriodMetadata: metadata });
                values.set(CONFIG.STORAGE.LS_KEY, initialized[CONFIG.STORAGE.LS_KEY]);
                values.set('rs_profiles_v1', JSON.stringify(selected));
                plan.renderContext(ui.input);
                assertEqual(outputs.balanceNextSteps.children[0].getAttribute('data-next-step'), 'annual', 'Sonderzustand bleibt erster Rendererschritt');
                assertEqual(outputs.balanceNextAnnual.disabled, false, 'Klärung und Recovery behalten bedienbaren bestehenden Zugang');
                assertEqual(outputs.balanceNextAnnualLabel.textContent, expected, 'Jahresknopf und Schritt teilen denselben Status');
            }
            plan.dom.controls = { jahresabschlussBtn: { disabled: true } };
            plan.renderContext(ui.input);
            assertEqual(outputs.balanceNextAnnual.disabled, true, 'Renderer erhält die Sperre einer laufenden Jahresaktion');
            delete plan.dom.controls;

        } finally { globalThis.Date = RealDate; }
        const originalLocalStorage = globalThis.localStorage;
        const cashStore = new Map();
        globalThis.localStorage = { getItem: key => cashStore.get(key) ?? null, setItem: (key, value) => cashStore.set(key, String(value)), removeItem: key => cashStore.delete(key), key: index => [...cashStore.keys()][index] ?? null, get length() { return cashStore.size; } };
        resetPersistenceRuntimeForTests();
        const keys = ['rs_profiles_v1', 'rs_active_profile', 'rs_current_profile'];
        const saved = keys.map(key => persistenceStorage.getItem(key));
        const sale = { schemaVersion: 1, eventType: 'sale_reconciled', actionId: 'synthetic-sale',
            profileId: 'cash-test', trancheId: 'synthetic-lot', executedAt: '2026-07-14',
            actual: { sharesSold: 1, grossProceeds: 100, fees: 5, netProceeds: 95 },
            cashStatus: 'pending_manual_posting', result: { beforeShares: 2, remainingShares: 1, trancheRemoved: false },
            reconciledAt: '2026-07-14T12:00:00.000Z' };
        try {
            for (const kind of ['open', 'confirmed', 'legacy', 'missing', 'unreadable']) {
                const currentSale = { ...sale };
                if (kind === 'confirmed') Object.assign(currentSale, { cashStatus: 'confirmed_already_reflected',
                    cashBalanceAfterPostingEur: 95, cashConfirmationReason: 'Synthetisch bestätigt', cashConfirmedAt: '2026-07-14T12:00:00.000Z' });
                if (kind === 'legacy') { delete currentSale.eventType; delete currentSale.cashStatus; }
                const registry = { version: 1, profiles: { 'cash-test': { meta: { id: 'cash-test', name: 'Cash',
                    createdAt: '2026-07-14T12:00:00.000Z', updatedAt: '2026-07-14T12:00:00.000Z', belongsToHousehold: true }, data: {} } } };
                if (kind !== 'missing') registry.trancheReconciliation = kind === 'unreadable' ? 'kaputtes Audit' : { schemaVersion: 1, actions: [currentSale] };
                persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
                persistenceStorage.setItem('rs_active_profile', 'cash-test');
                persistenceStorage.setItem('rs_current_profile', 'cash-test');
                const before = keys.map(key => persistenceStorage.getItem(key));
                plan.renderContext(ui.input); plan.renderContext(ui.input);
                assertEqual(outputs.balanceNextSteps.children.filter(step => step.getAttribute('data-next-step') === 'cash').length, ['open', 'unreadable'].includes(kind) ? 1 : 0, 'Cashschritt bleibt beim erneuten Rendern eindeutig');
                if (kind === 'open') {
                    const step = outputs.balanceNextSteps.children.find(step => step.getAttribute('data-next-step') === 'cash');
                    assert(Number(step.children[0].textContent) > 0, 'Cashhinweis ist zusätzlicher nummerierter Schritt');
                    assertEqual(step.children[1].children[1].textContent, '1 Realverkauf/Realverkäufe mit offener manueller Cashbuchung.', 'Cashhinweis nennt exakte Anzahl und bisherigen Text');
                    const link = step.children[1].children[1].children[0];
                    assertEqual(link.href, 'depot-tranchen-manager.html', 'Cashhinweis führt in den vorhandenen Manager');
                    assert(link.hasAttribute('data-profile-handoff') && link.getAttribute('data-profile-handoff-export') === 'false', 'Managerweg nutzt vorhandenen Profil-/Navigationsschutz');
                }
                if (kind === 'unreadable') assert(outputs.balanceNextSteps.children.find(step => step.getAttribute('data-next-step') === 'cash').children[1].children[1].textContent.includes('Cashstatus-Audit'), 'Unlesbares Audit warnt ohne Entwarnung');
                assertEqual(JSON.stringify(keys.map(key => persistenceStorage.getItem(key))), JSON.stringify(before), 'Cashhinweis schreibt weder Profil- noch Bestandsdaten');
            }
        } finally { keys.forEach((key, index) => saved[index] === null ? persistenceStorage.removeItem(key) : persistenceStorage.setItem(key, saved[index])); globalThis.localStorage = originalLocalStorage; resetPersistenceRuntimeForTests(); }
        plan.renderMiniSummary({ ...ui, runway: { months: 9, status: 'warn' } });
        assertEqual(outputs.miniSummary.children[0].children.length, 3, 'Fehlende Nachherdeckung erhält einen ausgewiesenen Fehlwert in der festen Vergleichsleiste');
        plan.renderMiniSummary({ ...ui, runway: { months: 9, status: 'warn' }, action: { quellen: [{ kind: 'liquiditaet', brutto: 5000 }, { kind: 'geldmarkt', brutto: 2000 }], verwendungen: { liquiditaet: 2000, geldmarkt: 500 } } });
        assertEqual(outputs.miniSummary.children[0].children[2].children[1].children[0].textContent, '0,8 Jahre', 'Nachher-Floorreichweite zieht vorhandene Cashquellen ab und addiert beide Liquiditätsverwendungen');
        plan.renderMiniSummary({ ...ui, runway: { months: 9, status: 'warn' }, action: { quellen: [{ kind: 'liquiditaet' }], verwendungen: { liquiditaet: 2000 } } });
        assert(outputs.miniSummary.children[0].children[2].children[1].children[0].textContent.includes('Wert fehlt'), 'Unvollständige Cashquellen liefern keinen fingierten Nachherwert');

        plan.renderPlanCards({ ...ui, vpw: { enabled: true }, neuerBedarf: 24000 });
        assert(outputs.balanceAnnualBudget.textContent.includes(UIUtils.formatBalanceCurrency(3000)), 'Dynamic Flex verwendet den gelieferten Bedarf statt des statischen Flexinputs');
        const profileHost = doc.createElement('span'); profileHost.id = 'suiteProfileContext'; profileHost.textContent = 'Aktives Profil: <Profil A>'; doc.body.appendChild(profileHost);
        outputs.balanceScopeText = doc.createElement('b');
        const profilePill = doc.createElement('span'), profileIcon = doc.createElement('svg');
        profilePill.append(profileIcon, profileHost);
        const scopePill = doc.createElement('span'), scopeIcon = doc.createElement('svg');
        scopePill.append(scopeIcon, outputs.balanceScopeText);
        outputs.balanceNextAnnual = doc.createElement('button');
        const calendarIcon = doc.createElement('svg'); outputs.balanceNextAnnual.append(calendarIcon, outputs.balanceNextAnnualLabel);
        const originalWindow = globalThis.window;
        globalThis.window = { ...originalWindow, __profilverbundProfileSummaries: [{ name: '<Profil A>', profileId: 'a', totalAssets: 1234.56 }] };
        try {
            const input = { ...ui.input, profilName: '<Profil A>', inflation: 2.1 };
            const raw = JSON.stringify(input);
            plan.renderPlanCards({ ...ui, input, liquiditaet: { deckungNachher: 99.25 } });
            assertEqual(outputs.balanceNeedRows.children.length, 5, 'Finanzierter Haushalts-Flex steht getrennt neben den bisherigen Bedarfszeilen');
            assertEqual(outputs.balanceNeedProfiles.children.length, 0, 'Ohne Profilbedarfswerte entsteht keine Vermögensersatzzeile');
            assert(outputs.balanceNeedProfiles.hidden, 'Profilbedarfshost bleibt ohne vorhandenen Bedarf verborgen');
            assertEqual(outputs.balanceActionCoverage.textContent, ' Danach 99,3\u00a0% des Ziels.', 'Erklärung nutzt die gelieferte Nachherdeckung');
            plan.renderPlanCards({ ...ui, input });
            assertEqual(outputs.balanceActionCoverage.textContent, '', 'Fehlende Nachherdeckung lässt den Zusatz entfallen');
            assertEqual(JSON.stringify(input), raw, 'Kartenanzeige verändert keine Eingaben');
            assertEqual(profileHost.textContent, 'Aktives Profil: <Profil A>', 'Summary kopiert oder ersetzt die gemeinsame Profilidentität nicht');
            assertEqual(outputs.balanceScopeText.textContent, 'Berechnet für: Haushalt · <Profil A>', 'Summary übernimmt den gelieferten Berechnungsumfang ohne Profilkopie');
            assertEqual(scopePill.children[0], scopeIcon, 'Kontextneuerung erhält das dekorative Haushaltssymbol');
            assertEqual(outputs.balanceNextAnnual.children[0], calendarIcon, 'Jahresbeschriftung erhält das Kalendersymbol');
            const seedPeriod = () => {
                const current = { ...live, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata, inputs: {} }),
                    balance_expenses_v1: JSON.stringify({ version: 1, activeYear: targetYear, years: { [targetYear]: { months: {} } } }) };
                const selected = { version: 1, profiles: { a: { meta: { name: 'Synthetisch' }, data: current } } };
                const source = new Map(Object.entries({ ...current, rs_profiles_v1: JSON.stringify(selected), rs_current_profile: 'a', rs_active_profile: 'a' }));
                resetPersistenceForTests({ getItemSync: key => source.get(key) ?? null, setItemSync: (key, value) => source.set(key, value), keysSync: () => [...source.keys()] });
            };
            outputs.balanceActionPeriod = doc.createElement('span');
            const checkPreview = expectedYear => {
                const detailOutputs = { handlungsanweisung: doc.createElement('div'), actionDetailsTitle: doc.createElement('h2') };
                // Echte Fassade, auch wenn die Detailansicht keine Budgetkarte besitzt.
                initUIRenderer({ outputs: { ...detailOutputs, balanceActionPeriod: outputs.balanceActionPeriod,
                    balanceActionFootnote: outputs.balanceActionFootnote, balanceActionDisclaimer: outputs.balanceActionDisclaimer } }, { loadState: () => ({ annualPeriodMetadata: metadata }) });
                UIRenderer.render({ ...ui, input, action: { type: 'NONE', title: 'Kein Handel nötig' } });
                const label = `Vorläufige Vorschau · Jahresabschluss ${expectedYear}`;
                assertEqual(outputs.balanceActionPeriod.textContent, label, 'Periodenchip nennt das nächste Abschlussjahr');
                assert(outputs.balanceActionFootnote.textContent === `Festgeschrieben erst im Jahresabschluss ${expectedYear}`, 'Fußtext verwendet dasselbe Abschlussjahr');
                assert(detailOutputs.actionDetailsTitle.textContent.startsWith(label), 'Dialogtitel übernimmt das Abschlussjahr der Karte');
                const copy = UIRenderer.getActionCopyText();
                assert(copy.startsWith(label) && copy.includes(outputs.balanceActionDisclaimer.textContent), 'Kopie übernimmt Label und Hinweis derselben Herkunftsprojektion');
            };
            metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            assertEqual(outputs.balanceNextAnnualLabel.textContent, `Jahresabschluss ${targetYear} starten`, 'Knopf verwendet dieselbe Kalenderperiode wie der Jahresprozess');
            metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            assert(outputs.balanceActionFootnote.textContent.includes(`Jahresabschluss ${targetYear}`), 'Offenes Vorjahr ist der nächste Jahresabschluss');
            checkPreview(targetYear);
            metadata = { schemaVersion: 99, lastCommittedPeriod: null, pendingCommit: null }; seedPeriod(); plan.renderContext(input);
            assert(outputs.balanceActionDisclaimer.textContent.includes('heute Jahresabschluss') && outputs.balanceNextAnnualLabel.textContent === 'Jahresstatus klären', 'Ungültige Metadaten zeigen erreichbare Jahresklärung statt Abschlussfreigabe');
            metadata = { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${targetYear}`, pendingCommit: null };
            seedPeriod(); plan.renderContext(input);
            assert(outputs.balanceNextAnnual.disabled && outputs.balanceActionDisclaimer.textContent.includes('heute Jahresabschluss'), 'Abgeschlossene Periode erhält bisherigen Sperrvertrag und passenden Fußtext');
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
                assert(outputs.balanceActionFootnote.textContent.includes('Jahresabschluss 2026') && outputs.balanceActionDisclaimer.textContent.includes('Anfang 2027'), 'Erstjahrvorschau nennt Abschlussjahr und ersten Termin getrennt');
                assertEqual(outputs.balanceActionPeriod.textContent, 'Vorläufige Vorschau · Jahresabschluss 2026', 'Handlung bleibt auch im Erstjahr vorläufig');
                checkPreview(2026);
                assert(!outputs.balanceNextSteps.children.some(node => ['annual', 'monthly'].includes(node.getAttribute('data-next-step'))), 'Kein Abschluss-/Bereitstellungsschritt für 2025');
                assert(!outputs.balanceBudgetChips.children.some(node => /ungeklärt/.test(node.textContent)), 'Kein ungeklärter Erstjahrchip');
                assertEqual(JSON.stringify([...source]), before, 'Erstjahrdarstellung ist schreibfrei');
            } finally { setAppTestDate(null); }

        } finally { globalThis.window = originalWindow; }

    } finally { resetPersistenceRuntimeForTests(); globalThis.document = previous; }
}

// P13b: echter bestehender Binderzugang, Recovery und Laufzeitsperre.
{
    const { UIBinder, initUIBinder } = await import('../app/balance/balance-binder.js');
    const { StorageManager } = await import('../app/balance/balance-storage.js');
    const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const previous = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date,
        load: StorageManager.loadState, tab: UIBinder.selectTab, year: UIBinder.openExpensesYear, preparation: UIBinder.openAnnualPreparation };
    const doc = createPresentationTestDocument();
    let metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    let clicks = 0, preparations = 0, recoveryClicks = 0, selected = null;
    const next = doc.createElement('button'); next.id = 'balanceNextAnnual'; next.disabled = false; doc.body.appendChild(next);
    const head = { disabled: false, click() { clicks++; } };
    const recoveryLinks = [];
    const createElement = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const element = createElement(tag);
        if (tag === 'a') element.click = () => { recoveryClicks++; recoveryLinks.push(element); };
        return element;
    };
    const refs = { controls: { jahresabschlussBtn: head }, outputs: {},
        containers: { tabButtons: { querySelector: selector => ({ selector }) }, tabPanels: [] }, expenses: { yearSelect: { value: '2026', disabled: false } } };
    const values = new Map();
    const seed = () => {
        const source = { depot_tranchen: '[]', profile_tagesgeld: '100',
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata }),
            balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
        for (const [key, value] of Object.entries({ ...source, rs_profiles_v1: JSON.stringify({ version: 1, profiles: { a: { meta: { name: 'A' }, data: source } } }), rs_current_profile: 'a', rs_active_profile: 'a' })) values.set(key, value);
    };
    try {
        globalThis.document = doc; globalThis.window = {};
        globalThis.Date = class extends previous.Date { constructor(...args) { super(...(args.length ? args : [new previous.Date(2027, 0, 15, 12).getTime()])); } };
        seed();
        resetPersistenceForTests({ getItemSync: key => values.get(key) ?? null, setItemSync: (key, value) => values.set(key, value), keysSync: () => [...values.keys()] });
        StorageManager.loadState = () => ({ annualPeriodMetadata: metadata });
        initUIBinder(refs, {}, () => ({ ok: true }), () => {});
        UIBinder.selectTab = tab => { selected = tab?.selector; };
        UIBinder.openExpensesYear = year => { refs.expenses.yearSelect.value = String(year); };
        UIBinder.openAnnualPreparation = async () => { preparations++; };
        assertEqual(UIBinder.openNextAnnual(), true, 'Regulärer Jahreszugang erreicht vorhandene Kopfbindung');
        assertEqual(clicks, 1, 'Regulärer Zugang delegiert genau einmal');
        assertEqual(UIBinder.openOverviewTarget({ hash: '#jahresabschluss', search: '?year=2026' }, { ready: true }), true, 'Startseitenjahresziel erreicht bestehende Vorbereitung');
        assertEqual(preparations, 1, 'Jahresziel startet genau eine Vorbereitung für ausgewählte Periode');
        assertEqual(refs.expenses.yearSelect.value, '2026', 'Vorbereitung bewahrt die Ausgabenperiodenauswahl');
        assertEqual(UIBinder.openOverviewTarget({ hash: '#jahresabschluss', search: '?year=2025' }, { ready: true }), false, 'Fremde Zielperiode wird vor dem Zugang abgelehnt');
        metadata = { ...metadata, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'synthetic' } }; seed();
        const before = JSON.stringify([...values]);
        assertEqual(UIBinder.openNextAnnual(), true, 'Recoveryzugang bleibt bedienbar');
        assertEqual(selected, '[data-tab="strategy"]', 'Recovery behält die bestehende Strategiereiterauswahl vor der Navigation');
        assertEqual(recoveryClicks, 1, 'Recovery bedient den geschützten Sicherungsverweis genau einmal');
        assertEqual(recoveryLinks[0].getAttribute('href'), 'Daten-Sicherung.html?punkt=synthetic#wiederherstellung', 'Recovery übergibt den unterbrochenen Jahrespunkt an die zentrale Wiederherstellung');
        assert(recoveryLinks[0].hasAttribute('data-profile-handoff') && recoveryLinks[0].getAttribute('data-profile-handoff-export') === 'false', 'Recovery bleibt im geschützten lokalen Handoff');
        assert(!doc.getElementById('balanceRecoveryLink') && !recoveryLinks[0].parentNode, 'Recovery funktioniert ohne alten DOM-Anker und entfernt den kurzlebigen Link');
        assertEqual(clicks, 1, 'Recovery startet keinen zweiten Jahreshandler');
        assertEqual(preparations, 1, 'Recovery startet keine zweite Vorbereitung');
        assertEqual(JSON.stringify([...values]), before, 'Recoveryzugang schreibt keine Fach- oder Persistenzwerte');
        assertEqual(UIBinder.openOverviewTarget({ hash: '#jahresabschluss', search: '?year=2026' }, { ready: true }), true, 'Jahresdeeplink nutzt auch bei Recovery vorhandenen Restoreweg');
        assertEqual(recoveryClicks, 2, 'Recoverydeeplink delegiert genau einmal an die zentrale Wiederherstellung');
        assertEqual(recoveryLinks[1].getAttribute('href'), 'Daten-Sicherung.html?punkt=synthetic#wiederherstellung', 'Recoverydeeplink bewahrt dasselbe Punktziel');
        assertEqual(JSON.stringify([...values]), before, 'Auch der Recoverydeeplink bleibt schreibfrei');
        assertEqual(preparations, 1, 'Recoverydeeplink startet keinen Commit');
        head.disabled = true;
        assertEqual(UIBinder.openNextAnnual(), false, 'Jahreszugang respektiert bestehende Kopfbuttonsperre');
        head.disabled = false;
        const owner = getPageNavigationGuard(doc).register(Symbol('p13b-commit'), { read: () => ({ phase: 'commit' }) });
        try { assertEqual(UIBinder.openNextAnnual(), false, 'Laufender Commit blockiert auch Recoveryzugang'); }
        finally { owner.unregister(); }
        next.disabled = true;
        assertEqual(UIBinder.openNextAnnual(), false, 'Gesperrter Folgeknopf umgeht keinen Periodenvertrag');
    } finally {
        StorageManager.loadState = previous.load; UIBinder.selectTab = previous.tab; UIBinder.openExpensesYear = previous.year; UIBinder.openAnnualPreparation = previous.preparation;
        globalThis.document = previous.document; globalThis.window = previous.window; globalThis.Date = previous.Date;
        resetPersistenceRuntimeForTests();
    }
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
    const outputs = Object.fromEntries(['balanceBudgetPreview', 'balanceBudgetPlan', 'balanceWithdrawalPreview', 'balanceWithdrawalPlan', 'miniSummary']
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
        for (const [key, amount] of [['balanceBudgetPlan', '5.000\u00a0€'], ['balanceWithdrawalPlan', '1.900\u00a0€']]) {
            assertEqual(outputs[key].children[1].textContent, amount, 'Gültiger Planbetrag bleibt neben der heutigen Rechnung');
            assertEqual(outputs[key].children[2].textContent, 'Differenz −50\u00a0€', 'Beide Vorschauwerte vergleichen sich mit ihrem passenden Planbetrag');
        }
        assertEqual(JSON.stringify({ model, ui }), before, 'Planvergleich verändert weder Vorschau noch festgeschriebenen Beleg');
        renderer.renderBudgetOrigin({ ...model, summary: { ...model.summary, year: 2025 } }, ui);
        assert(outputs.balanceBudgetPlan.hidden && outputs.balanceWithdrawalPlan.hidden && outputs.balanceBudgetPreview.hidden,
            'Fremdes Planjahr hinterlässt keinen gültigen Vergleich');
        renderer.renderBudgetOrigin({ ...model, planComparison: { recordStatus: 'invalid' } }, ui);
        assert(!outputs.balanceBudgetPlan.children.length && !outputs.balanceWithdrawalPlan.children.length, 'Beschädigter Beleg hinterlässt keine früheren Planbeträge');

        const runwayUi = { input: { floorBedarf: 30000, flexBedarf: 30000, renteAktiv: true, renteMonatlich: 2300, tagesgeld: 90000, geldmarktEtf: 0 },
            spending: { monatlicheEntnahme: 2400 }, runway: { months: 159388 / 2400, status: 'ok' } };
        renderer.renderMiniSummary(runwayUi);
        let item = outputs.miniSummary.children[0].children[1];
        assertEqual(item.children[1].textContent, '37,5\u00a0Monate → ', 'Freie Liquidität vor dem Vorschlag verwendet dieselbe Monatsentnahme');
        assertEqual(item.children[1].children[0].textContent, '66,4\u00a0Monate', 'Gelieferte Runway bleibt ausschließlich nach dem Vorschlag');
        assert(item.children[0].children[0].children[1].textContent.includes('freie Liquidität ÷ finanzierte monatliche Vermögensentnahme'), 'Formel bleibt im Infofeld zugänglich');
        renderer.renderMiniSummary({ ...runwayUi, spending: {} });
        item = outputs.miniSummary.children[0].children[1];
        assertEqual(item.children[1].textContent, '— → ', 'Fehlende Monatsbasis erzeugt keinen Vorherwert');
        assertEqual(item.children[1].children[0].textContent, '66,4\u00a0Monate', 'Fehlender Vorherwert benennt den Nachherwert nicht um');
        assertEqual(item.children[2].textContent, 'Vorher nicht verfügbar', 'Fehlende Seite wird ausdrücklich genannt');
        renderer.renderMiniSummary({ ...runwayUi, runway: {} });
        item = outputs.miniSummary.children[0].children[1];
        assertEqual(item.children[1].children[0].textContent, '—', 'Fehlender Nachherwert wird nicht aus dem Vorherwert erfunden');
        assertEqual(item.children[2].textContent, 'Nachher nicht verfügbar', 'Auch die andere fehlende Seite bleibt benannt');
        renderer.renderMiniSummary({ ...runwayUi, spending: { monatlicheEntnahme: 0 }, runway: { months: Infinity } });
        item = outputs.miniSummary.children[0].children[1];
        assertEqual(item.children[1].textContent, '∞\u00a0Monate → ', 'Entnahme null behält die vorhandene unendliche Reichweite');
    } finally { globalThis.document = previous.document; setAppTestDate(previous.date); }
}

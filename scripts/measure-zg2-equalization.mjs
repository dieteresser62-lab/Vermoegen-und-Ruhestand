// Nur synthetische ZG-1b-Eingaben; keine Dateien oder Rechenmodule verändern.
// node scripts/measure-zg2-equalization.mjs
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { pathToFileURL } from 'node:url';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { ScenarioAnalyzer } from '../app/simulator/scenario-analyzer.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio-init.js';
import { equalizationAllowance, inheritanceTax } from '../app/profile/household-partnership.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/zg-1b-measurement.json', import.meta.url)));
const inputs = fixture.households.find(row => row.id === 'max-erika' && row.variant === 'immobilien').inputs;
const parameters = { ...fixture.params, anzahl: 50 };
const preparationFile = new URL('../app/simulator/simulator-engine-direct/year-preparation.js', import.meta.url);
const marketFile = new URL('../app/simulator/simulator-engine-direct/year-market.js', import.meta.url);
const payoutFile = new URL('../app/simulator/simulator-engine-direct/year-payout.js', import.meta.url);
const settlementFile = new URL('../app/simulator/simulator-engine-direct/year-tax-inheritance.js', import.meta.url);
const inheritanceFile = new URL('../app/simulator/simulator-inheritance.js', import.meta.url);

function sourceLine(url, marker) {
    const lines = readFileSync(url, 'utf8').split('\n');
    const index = lines.findIndex(line => line.includes(marker));
    if (index < 0) throw new Error(`Messstelle fehlt: ${marker}`);
    return index + 1;
}

// Eigene Summierung der Rohbestände; personalAssetValues wird nicht verwendet.
function personValues(portfolio) {
    return portfolio.personAccounts.map(account => {
        const lots = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches']
            .flatMap(key => portfolio[key] || [])
            .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === account.profileId);
        const securities = lots.reduce((sum, lot) => sum + lot.marketValue, 0);
        const reserveCash = (portfolio.healthBucketCashOwners || [])
            .filter(row => row.profileId === account.profileId).reduce((sum, row) => sum + row.amount, 0);
        return { profileId: account.profileId, cash: account.tagesgeld, securities, reserveCash,
            money: account.tagesgeld + securities + reserveCash };
    });
}

async function run(start, count, logIndices) {
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters,
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start, count }, logIndices, engine: EngineAPI });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Musterlauf nicht auswertbar.');
    return chunk.runMeta;
}

// Der lokale Node-Debugger liest nur Kopien an Haltepunkten im Originalcode.
// Keine Quellkopie, kein Loader und keine zusätzliche Buchung im Simulator.
async function observe(runIndex, deathYearIndex) {
    const session = new Session(), observations = [], breakpoints = [];
    let observerError;
    session.connect();
    const post = (method, params = {}) => {
        let result, error;
        session.post(method, params, (failure, value) => { error = failure; result = value; });
        if (error) throw error;
        if (result === undefined) throw new Error(`Debugger antwortet nicht synchron: ${method}`);
        return result;
    };
    const evaluate = (frame, expression) => {
        const reply = post('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId,
            expression: `JSON.stringify(${expression})`, returnByValue: true, throwOnSideEffect: true });
        if (reply.exceptionDetails) throw new Error('Messwerte am Haltepunkt nicht lesbar.');
        return JSON.parse(reply.result.value);
    };
    const points = [
        ['year_open', preparationFile, 'const engineBoundaryPortfolio = captureEngineBoundaryPortfolio(portfolio);'],
        // Die Initialisierung darf eine JSDoc-Zusicherung tragen; der Haltepunkt bleibt dieselbe Deklaration.
        ['after_returns', marketFile, 'const balanceTrace ='],
        ['before_payout', payoutFile, 'const personalPayout = unmarried'],
        ['after_payout', payoutFile, 'const jahresEntnahmeEffektiv = payout;'],
        ['before_inheritance', inheritanceFile, 'const rule = testamentRule(inputs.partnership, deceasedProfileId);']
    ];
    try {
        post('Debugger.enable');
        for (const [phase, url, marker] of points) {
            const line = sourceLine(url, marker);
            const condition = url === inheritanceFile
                ? `transition.survivor.deathYearIndex === ${deathYearIndex} && deceasedProfileId === 'muster_a'`
                : `context.yearIndex === ${deathYearIndex}`;
            const { breakpointId, locations } = post('Debugger.setBreakpointByUrl', { url: url.href, lineNumber: line - 1, condition });
            if (!locations.length) throw new Error(`Messstelle nicht geladen: ${phase}`);
            breakpoints.push({ breakpointId, phase, line });
        }
        session.on('Debugger.paused', ({ params }) => {
            try {
                const point = breakpoints.find(item => params.hitBreakpoints.includes(item.breakpointId));
                if (!point) throw new Error('Unbekannter Messhaltepunkt.');
                const frame = params.callFrames[0];
                const data = evaluate(frame, point.phase === 'before_inheritance'
                    ? '({portfolio, gains, assets, home, familyHome, percent, deceasedProfileId, survivorProfileId})'
                    : '({portfolio})');
                const observation = { phase: point.phase, line: point.line, people: personValues(data.portfolio) };
                if (point.phase === 'before_inheritance') {
                    const caller = params.callFrames.find(row => row.functionName === 'settleYear');
                    const timing = evaluate(caller, '({yearIndex, yearData, cumulativeInflationFactor, payout:context.payout, cashZinsen, totalTaxesThisYear})');
                    observation.detail = { ...data, portfolio: undefined, timing,
                        homeSales: data.portfolio.homeSales || [], equalizationInflows: data.portfolio.equalizationInflows || {} };
                }
                observations.push(observation);
            } catch (error) { observerError = error; }
            finally { post('Debugger.resume'); }
        });
        const [meta] = await run(runIndex, 1, [runIndex]);
        if (observerError) throw observerError;
        if (observations.length !== points.length) throw new Error('Musterpfad erreicht die Messstellen nicht genau einmal.');
        return { meta, observations };
    } finally {
        for (const { breakpointId } of breakpoints) post('Debugger.removeBreakpoint', { breakpointId });
        session.disconnect();
    }
}

export async function measureZG2({ search = false } = {}) {
    // Pfad 11 liegt bei 50 Läufen in der echten Szenarioauswahl „Zufällig #11“.
    const candidates = await run(search ? 0 : 10, search ? 50 : 1, search ? Array.from({ length: 50 }, (_, i) => i) : [10]);
    const analyzer = new ScenarioAnalyzer(parameters.anzahl);
    for (const meta of candidates) {
        analyzer.addRun({ ...meta, isRandomSample: analyzer.shouldCaptureRandomSample(meta.index) });
    }
    const selected = analyzer.buildScenarioLogs().random.find(item => item.logDataRows.some(row =>
        row.inheritance?.deceasedProfileId === 'muster_a' && row.inheritance.exemptGain > 0 && row.entnahme_effektiv > 0));
    if (!selected) throw new Error('Kein auswählbarer Musterpfad mit Ausgleich und Entnahme gefunden.');
    const original = candidates.find(meta => meta.index === selected.sourceIdentity.absoluteRunIndex);
    const death = original.logDataRows.find(row => row.inheritance?.deceasedProfileId === 'muster_a');
    const { meta, observations } = await observe(original.index, death.jahr - 1);
    const boundary = observations.find(row => row.phase === 'before_inheritance');
    const { gains, timing, homeSales, equalizationInflows } = boundary.detail;
    // Dieser unabhängige Sollfall verwendet nur die zwei unverkauften Oktober-Immobilien.
    if (homeSales.length || Object.keys(equalizationInflows).length
        || inputs.home.some(home => home.stand !== '2026-10')) throw new Error('Musterpfad verlässt den festgelegten Sollfall.');
    const factor = original.logDataRows.slice(0, death.jahr)
        .reduce((product, row) => product * (1 + row.inflation / 100), 1);
    const initial = personValues(initializePortfolio(inputs));
    const people = inputs.simulationPeople.map(person => {
        const start = initial.find(row => row.profileId === person.profileId);
        const end = boundary.people.find(row => row.profileId === person.profileId);
        const initialHome = inputs.home.filter(home => home.profileId === person.profileId).reduce((sum, home) => sum + home.wert, 0);
        const initialAssets = start.money + initialHome;
        const endAssets = end.money + initialHome * factor;
        return { name: person.name, profileId: person.profileId, initialMoney: start.money, initialHome,
            initialAssets, indexedInitialAssets: initialAssets * factor, endMoney: end.money,
            endHome: initialHome * factor, endAssets, gain: Math.max(0, endAssets - initialAssets * factor) };
    });
    const [max, erika] = people;
    const acquisition = death.inheritance.inherited + death.inheritance.inheritedHome;
    const rawAllowance = Math.min(acquisition, Math.max(0, (max.gain - erika.gain) / 2));
    const exemptHome = max.endHome;
    const homeReductionFactor = (max.endAssets - exemptHome) / max.endAssets;
    const allowance = rawAllowance * homeReductionFactor;
    const taxableWith = Math.max(0, acquisition - exemptHome - 500000 - allowance);
    const taxableWithout = Math.max(0, acquisition - exemptHome - 500000);
    // Unabhängiger Tarif für diesen Sollfall: 19 %, Gegenprobe Härteausgleich ab 600.000.
    if (![taxableWith, taxableWithout].every(value => value > 600000 && value <= 6000000)) {
        throw new Error('Musterpfad verlässt das festgelegte Tarifintervall.');
    }
    const manualTax = value => Math.min(value * .19, 90000 + (value - 600000) * .5);
    const codeAllowance = equalizationAllowance(inputs.partnership, { ...gains, acquisition, exemptHome });
    const codeTaxWithout = inheritanceTax(acquisition, { status: 'married', exemptHome });
    const close = (a, b) => Math.abs(a - b) < 1e-7;
    const checks = {
        unchangedLog: JSON.stringify(original.logDataRows) === JSON.stringify(meta.logDataRows),
        sameValuation: close(gains.deceasedAssets, max.endAssets) && close(gains.survivorAssets, erika.endAssets)
            && close(gains.deceasedInitialAssets, max.initialAssets) && close(gains.survivorInitialAssets, erika.initialAssets),
        sameInflation: close(gains.inflationFactor, factor) && close(gains.inflationFactor,
            timing.cumulativeInflationFactor * (1 + timing.yearData.inflation / 100)),
        allowanceMatches: close(allowance, codeAllowance) && close(allowance, death.inheritance.exemptGain),
        taxMatches: close(manualTax(taxableWith), death.erbschaftsteuer) && close(manualTax(taxableWithout), codeTaxWithout)
    };
    const html = renderProtocolTable([death], { source: 'mc', inputs, startYear: 2026, moneyBasis: 'nominal' });
    const tooltipStart = html.indexOf('class="ds-info protocol-inheritance-info"');
    const tooltip = tooltipStart < 0 ? '' : html.slice(tooltipStart, html.indexOf('</td>', tooltipStart));
    return {
        source: 'tests/fixtures/zg-1b-measurement.json · max-erika/immobilien', testDate: fixture.testDate,
        parameters, searchRuns: search ? 50 : 1, runIndex: original.index, pathNumber: original.index + 1,
        scenarioLabel: selected.label, simulationYear: death.jahr, calendarYear: 2026 + death.jahr - 1,
        historicalYear: death.histJahr, inflationFactor: factor, people,
        handCalculation: { acquisition, exemptHome, rawAllowance, homeReductionFactor, allowance,
            taxableWith, taxableWithout, taxWith: manualTax(taxableWith), taxWithout: manualTax(taxableWithout) },
        code: { gains, allowance: codeAllowance, loggedAllowance: death.inheritance.exemptGain,
            taxWith: death.erbschaftsteuer, taxWithout: codeTaxWithout },
        timing: { yearIndex: timing.yearIndex, equityReturn: timing.yearData.rendite,
            annualInflationPct: timing.yearData.inflation, inflationBeforeYear: timing.cumulativeInflationFactor,
            withdrawal: timing.payout, cashInterest: timing.cashZinsen, ordinaryAnnualTax: timing.totalTaxesThisYear },
        observations: observations.map(({ detail, ...row }) => row),
        tooltip: { deathMax: tooltip.includes('Todesfall Max'), gainLine: tooltip.includes('steuerfrei als Zugewinnausgleich'),
            formattedAllowance: tooltip.includes(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(allowance)) },
        checks, calculationError: !Object.values(checks).every(Boolean),
        references: { caller: `app/simulator/simulator-engine-direct/year-tax-inheritance.js:${sourceLine(settlementFile, 'const inheritanceLog = hasInheritance')}`,
            assetMeasurement: `app/simulator/simulator-inheritance.js:${sourceLine(inheritanceFile, 'deceasedAssets: assets +')}`,
            formula: 'app/profile/household-partnership.js:69', tooltip: 'app/simulator/protocol-renderer.js:307' },
        ui: ['Spielbereich starten: Max und Erika, „Haus und vermietete Wohnung“, Spielkurse, Testdatum 28.10.2026.',
            'Partnerschaft: verheiratet, Zugewinngemeinschaft, beide Erbanteile 100 %, keine Testamentbegrenzung; Musterplan unverändert.',
            'Simulator → Monte Carlo → Einstellungen: 50 Läufe, 35 Jahre, Seed 12345, „Marktregime mit Übergängen“, „Alle Jahre gleich“.',
            'CAPE-Startjahre, geschätzte Daten ausschließen, Stressmodus und Tail-Risk aus; Erweitert → „Seed je Lauf (reproduzierbar)“.',
            `Simulation starten → Szenario-Logs → „Nominal · Kontowert“ → Stichprobe → „${selected.label}“.`,
            `Im Jahresprotokoll Jahr ${death.jahr} (${2026 + death.jahr - 1}) → Erbe-ⓘ: „Todesfall Max“, „steuerfrei als Zugewinnausgleich“.`]
    };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    console.log(JSON.stringify(await measureZG2({ search: true }), null, 2));
}

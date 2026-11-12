import assert from 'node:assert/strict';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { normalizeTrancheCollection } from '../types/tranche-contract.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { DEFAULT_EQUITY_COST_PCT, netEquityReturn } from '../app/simulator/simulator-year-portfolio.js';
/** Vorgabe der Fondskosten im Beispieltext, z. B. „0,5 %“. */
export const EQUITY_COST_TEXT = `${String(DEFAULT_EQUITY_COST_PCT).replace('.', ',')} %`;
import { calculateWealthAdjustedReductionFactor } from '../engine/planners/wealth-reduction.mjs';

export function calculateBudgetExamples() {

    function measuredYear(input, previous) {
        const savedInput = structuredClone(input), savedState = structuredClone(previous);
        const plain = EngineAPI.simulateSingleYear(input, previous);
        const traced = EngineAPI.simulateSingleYear(input, previous, { includeFlexTrace: true });
        assert(!traced.error, JSON.stringify(traced.error));
        const copy = structuredClone(traced);
        delete copy.ui.spending.flexTrace;
        assert.deepEqual(copy, plain, 'Trace darf ausschließlich lesend wirken');
        assert.deepEqual(input, savedInput);
        assert.deepEqual(previous, savedState);

        const trace = traced.ui.spending.flexTrace;
        for (let i = 1; i < trace.length; i++) {
            assert(Math.abs(trace[i - 1].monatsbetragNachher - trace[i].monatsbetragVorher) < 1e-7);
        }
        const netFloor = Math.max(0, traced.input.floorBedarf - (traced.input.renteAktiv ? traced.input.renteMonatlich * 12 : 0));
        assert(Math.abs(trace.at(-1).monatsbetragNachher + netFloor / 12 - traced.ui.spending.monatlicheEntnahme) < 1e-7);
        return traced;
    }

    const dynamicInput = { depotwertAlt: 1000000, depotwertNeu: 0, tagesgeld: 200000,
        floorBedarf: 24000, flexBedarf: 30000, inflation: 0, goldAktiv: false,
        renteAktiv: true, renteMonatlich: 2500, liquidityRunwayYears: 5,
        risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
        ath: 100, jahreSeitAth: 0, goGoActive: true, goGoMultiplier: 1.2,
        aktuellesAlter: 65, partnerAlter: 63, horizonYears: 20, capeRatio: 25,
        // FR-76: Wie die Balance mit Dynamic Flex mindern die Fondskosten die erwartete Aktienrendite.
        equityCostPct: DEFAULT_EQUITY_COST_PCT };
    const curveCases = [false, true].map(dynamicFlex => {
        const input = { ...dynamicInput, minimumFlexAnnual: 30000, dynamicFlex };
        const result = measuredYear(input, null);
        const curve = result.ui.spending.flexTrace.find(e => e.schritt === 'flex_share_curve');
        const pension = input.renteMonatlich * 12;
        const baseline = Math.max(0, input.flexBedarf - Math.max(0, pension - input.floorBedarf));
        const annualFlex = result.ui.neuerBedarf - Math.max(0, input.floorBedarf - pension);
        const quote = result.diagnosis.general.protectedPortfolioWithdrawalRate;
        assert(quote <= CONFIG.SPENDING_MODEL.FLEX_SHARE_MIN_PROTECTED_WITHDRAWAL_RATE);
        if (dynamicFlex) {
            assert(curve.gegriffen);
            assert(curve.monatsbetragNachher * 12 >= baseline - 1e-7);
            assert(result.ui.vpw.wishFlexCapApplied);
        } else assert.equal(curve.gegriffen, false);
        return { dynamicFlex, input, baseline, annualFlex, quote, curve, vpw: result.ui.vpw,
            finalMonthly: result.ui.spending.monatlicheEntnahme,
            followingAnchor: result.newState.flexRateSmoothingReference };
    });

    prepareHistoricalDataOnce();
    const backtests = [];
    for (const household of ['max-erika', 'helga-werner']) {
        const records = createMusterHaushaltRecords('2026-10-17', household);
        const registry = JSON.parse(records.rs_profiles_v1);
        const plan = Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
        const profiles = Object.entries(registry.profiles).map(([profileId, profile]) => ({
            profileId, name: profile.meta.name,
            inputs: buildSimulatorInputsFromProfileData({ ...profile.data,
                depot_tranchen: JSON.stringify(normalizeTrancheCollection(JSON.parse(profile.data.depot_tranchen), { mode: 'persisted' }))
            }, { referenceYear: 2026, planValues: plan })
        }));
        const combined = combineSimulatorProfiles(profiles, profiles[0].profileId, { planValues: plan });
        // FR-76: Wie im Simulator gilt die Vorgabe der Fondskosten; die Eingaben entstehen hier ohne das Feld der Seite.
        const inputs = validateSimulatorInputs({ ...combined.combined, equityCostPct: DEFAULT_EQUITY_COST_PCT });
        const years = [];
        const result = runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
            historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
            simulateYear: (...args) => {
                let captured;
                const observationAPI = { ...EngineAPI, simulateSingleYear: (input, previous) => {
                    const result = measuredYear(input, previous);
                    captured = { input: structuredClone(input), previous: structuredClone(previous), result };
                    return result;
                } };
                const outcome = simulateOneYear(...args, null, 0, null, 1, observationAPI);
                if (captured) years.push({ year: args[2].jahr, ...captured });
                return outcome;
            }, computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
            totalPortfolio: portfolioTotal, breakOnRuin: true });
        assert.equal(result.outcome.kind, 'completed');
        assert.equal(result.rows.length, 26);
        assert.equal(years.length, 26);
        backtests.push({ household, plan, inputs, years, result });
    }
    return { backtests, curveCases };
}

const fmt = value => Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const HANDBOOK_BUDGET_CAPTURES = Object.freeze([
    { year: 2000, name: 'jahresbudget-max-erika-normal',
        caption: 'Im normalen Jahr ist der Flex voll finanziert. Die App zeigt keine Warum-Treppe.' },
    { year: 2002, name: 'jahresbudget-max-erika-2002',
        caption: '2002 senken Alarm und Rundung den Monatsbetrag. Die Warum-Treppe zeigt beide Eingriffe.' }
]);

export function renderHandbookBudgetExamples(images = []) {
    const max = calculateBudgetExamples().backtests[0];
    const years = HANDBOOK_BUDGET_CAPTURES.map(item => max.years.find(y => y.year === item.year));
    const annualPension = y => y.input.renteAktiv ? y.input.renteMonatlich * 12 : 0;
    const row = (label, value) => `<tr><th scope="row">${label}</th>${years.map(y => `<td>${fmt(value(y))} €</td>`).join('')}</tr>`;
    const bear = years[1], trace = bear.result.ui.spending.flexTrace;
    const rounding = trace.find(e => e.schritt === 'quantization');
    const pictures = HANDBOOK_BUDGET_CAPTURES.map(item => {
        const file = `docs/ui/${item.name}.png`, image = images.find(image => image.path === file);
        if (!image) return '';
        return `<figure class="hb-figure"><a href="${file}" target="_blank" rel="noopener" aria-label="Bild in voller Größe öffnen"><img src="${file}" width="${image.width}" height="${image.height}" loading="lazy" alt="${item.caption}"></a><figcaption>${item.caption} · Max und Erika Mustermann</figcaption></figure>`;
    });
    return [
        '<p>Max und Erika Mustermann, synthetische Werte vom 17.10.2026, Backtest ab 2000 ohne Dynamic Flex. Vergleiche Monatsentnahme und Haushaltsbudget:</p>',
        '<p class="ds-scroll-hint">Bei Bedarf seitlich scrollen.</p>',
        '<div class="ds-table-scroll" tabindex="0" role="region" aria-label="Max und Erika im Jahresvergleich"><table class="ds-table"><thead><tr><th scope="col">Betrag</th><th scope="col">Normales Jahr 2000</th><th scope="col">Bärenjahr 2002</th></tr></thead><tbody>',
        row('Vermögensentnahme im Monat', y => y.result.ui.spending.monatlicheEntnahme),
        row('Haushaltsbudget mit Rente im Monat', y => y.result.ui.spending.monatlicheEntnahme + annualPension(y) / 12),
        '</tbody></table></div>',
        pictures[0],
        `<p>Öffne 2002 „Warum?“. Die letzte Stufe zeigt ${fmt(rounding.monatsbetragNachher)} € nach Rundung. Im voll finanzierten Jahr 2000 fehlt dieser Knopf.</p>`,
        pictures[1],
        '<p>Ausführlich: <a href="docs/reference/JAHRESBUDGET.html#zwei-beispiele">Rechenbeispiele des Jahresbudgets</a>.</p>'
    ].join('\n');
}

const steps = { previous_rate: ['B0', 'Vorjahresanker'], alarm: ['B1', 'Alarm'], raw_target: ['B2', 'Rohziel'],
    internal_smoothing: ['B3', 'Glättung'], annual_change_limit: ['B4', 'Änderungsgrenze'],
    flex_share_curve: ['B5', 'S-Kurve'], bear_cap: ['B6', 'Bären-Obergrenze'], runway_cap: ['B7', 'Liquiditäts-Obergrenze'],
    guardrails: ['B8', 'Leitplanken'], minimum_flex: ['B9', 'Mindest-Flex'], flex_budget: ['B10', 'Flex-Budget'],
    final_smoothing: ['B11', 'Letzte Änderungsgrenze'], safety_cap: ['B12', 'Sicherheitsgrenze'], quantization: ['B13', 'Rundung'] };
function traceReason(entry) {
    const k = entry.kennzahlen;
    switch (entry.schritt) {
        case 'previous_rate': return `Anker vor Rundung; ausgezahlte Vorjahresrate ${fmt(k.vorjahresAuszahlungsrateProzent)} %.`;
        case 'alarm': return `${k.neuAusgeloest ? 'Neuer' : 'Anhaltender'} Alarm; wirksamer Abzug bei Aktivierung ${fmt(k.effektiveKuerzungProzentpunkte)} Punkte.`;
        case 'raw_target': return `ATH-Abstand ${fmt(k.athAbstandProzent)} %; Vermögensfaktor ${fmt(k.vermoegensfaktorRatio)}.`;
        case 'internal_smoothing': return `Anteil des Rohziels ${fmt(k.effektivesAlphaRatio * 100)} %; Rest aus Vorjahresanker.`;
        case 'annual_change_limit': case 'final_smoothing': return `Höchstens +${fmt(k.anstiegMaxProzentpunkte)} / −${fmt(k.abfallMaxProzentpunkte)} Punkte zum Anker ${fmt(k.vorjahresrateProzent)} %.`;
        case 'flex_share_curve': return k.uebernommen ? `Deckel ${fmt(k.effektiverCapProzent)} %.${k.wunschFlexRateProzent !== undefined ? ' Offener Wunsch-Flex geschützt.' : ''}`
            : 'Keine Kürzung durch die S-Kurve.';
        case 'bear_cap': return k.effektiverCapProzent === null ? 'Kein tiefer Bär.' : `Deckel ${fmt(k.effektiverCapProzent)} %.`;
        case 'runway_cap': return k.effektiverCapProzent == null ? 'Keine Liquiditätsgrenze unterschritten.' : `Deckel ${fmt(k.effektiverCapProzent)} % bei ${fmt(k.runwayMonate)} Monaten Reichweite.`;
        case 'guardrails': return k.wegenAlarmAusgesetzt ? 'Im Alarm ausgesetzt.' : `\`grund\`: „${entry.grund}“; \`kennzahlen.gewaehlteQuelle\`: „${k.gewaehlteQuelle}“. ${entry.gegriffen ? 'Rate geändert.' : 'Rate unverändert.'}`;
        case 'minimum_flex': return k.offenesZielEurJahr === 0 ? 'Kein offener Mindest-Flex.' : `Offenes Ziel ${fmt(k.offenesZielEurJahr)} €/Jahr; ${k.status === 'not_needed' ? 'bereits gedeckt' : k.status === 'applied' ? 'Rate angehoben' : k.status === 'blocked_emergency' ? 'Anhebung gesperrt' : k.status}.`;
        case 'flex_budget': return k.budgetEurJahr === 0 ? 'Ausgeschaltet; Jahresbudget 0 €.' : `Budget ${fmt(k.budgetEurJahr)} €/Jahr.`;
        case 'safety_cap': return `${k.schwereNotlage ? 'Schwere Flex-Notlage' : 'Keine schwere Flex-Notlage'}; geplante tatsächliche Quote ${fmt(k.geplanteEntnahmequoteRatio * 100)} %.${k.wirksamerCapProzent !== null ? ` Sicherheitsgrenze ${fmt(k.wirksamerCapProzent)} %.` : ''}`;
        case 'quantization': return `Auf volle ${fmt(k.stufeEurMonat)} € abgerundet; nächster Anker ${fmt(k.naechsterGlaettungsankerProzent)} %.`;
        default: throw new Error(`Unbekannter Trace-Schritt: ${entry.schritt}`);
    }
}
function traceTable(trace) {
    return ['| Stufe | Rate vorher | Rate nachher | € pro Monat | Grund |', '| --- | ---: | ---: | ---: | --- |',
        ...trace.map(e => `| [${steps[e.schritt].join(' ')}](#${steps[e.schritt][0].toLowerCase()}) | ${fmt(e.rateVorher)} % | ${fmt(e.rateNachher)} % | ${fmt(e.monatsbetragNachher)} | ${traceReason(e).replace(/\|/g, '/')} |`)].join('\n');
}
function quotaTable(result, previous = null) {
    const details = result.ui.spending.details, metrics = result.diagnosis.general;
    const origin = Number.isFinite(previous?.lastEntnahmeReal) && result.ui.depotwertGesamt > 0
        ? 'aus realer Vorjahresentnahme und realem Depot'
        : 'Ersatz aus aktuellem ungekürztem Bedarf';
    return ['| Bezugsgröße | Quote |', '| --- | ---: |',
        `| Quote für den Vermögensfaktor, ${origin} | ${fmt(details.entnahmequoteUsed * 100)} % |`,
        `| Vorläufige Depotquote | ${fmt(details.entnahmequoteDepot * 100)} % |`,
        `| Geschützte Geldvermögensquote | ${fmt(metrics.protectedPortfolioWithdrawalRate * 100)} % |`,
        `| Geplante tatsächliche Geldvermögensquote | ${fmt(metrics.plannedPortfolioWithdrawalRate * 100)} % |`].join('\n');
}
function historicalExample(title, year) {
    const { input, previous, result } = year;
    const pension = input.renteAktiv ? input.renteMonatlich * 12 : 0;
    const floor = Math.max(0, input.floorBedarf - pension);
    const flex = result.ui.neuerBedarf - floor;
    const liquidity = result.input.aktuelleLiquiditaet ?? (result.input.tagesgeld + result.input.geldmarktEtf);
    const depot = result.ui.depotwertGesamt;
    const details = result.ui.spending.details;
    const priorValues = previous?.initialized ? [
        `Übernommen werden der kumulierte Inflationsfaktor ${details.cumulativeInflationFactor.toLocaleString('de-DE', { maximumFractionDigits: 6 })}, die reale Vorjahresentnahme ${fmt(previous.lastEntnahmeReal)} €, der reale Höchststand ${fmt(details.peakRealVermoegen)} € und der Vorjahresanker ${fmt(details.previousFlexRateSmoothingReference)} %. Das reale Depot beträgt ${fmt(depot / details.cumulativeInflationFactor)} €, das reale aktive Geldvermögen ${fmt(details.currentRealVermoegen)} €.`, ''
    ] : [];
    const rows = [title, '', `Beschluss nach der Jahresrendite ${year.year}. Dynamic Flex ist aus. Grundbedarf ${fmt(input.floorBedarf)} €, Wunsch-Flex ${fmt(input.flexBedarf)} €, Mindest-Flex ${fmt(input.minimumFlexAnnual)} € und Rente ${fmt(pension)} € sind Jahreswerte.`, '',
        `Nach der Rente bleiben ${fmt(floor)} € Grundbedarf und ${fmt(flex)} € Wunsch-Flex offen. Die Marktphase heißt „${result.ui.market.szenarioText}“.`, '',
        `Beim Beschluss stehen ${fmt(depot)} € Depot und ${fmt(liquidity)} € freie Liquidität zur Verfügung. Das aktive Geldvermögen beträgt ${fmt(depot + liquidity)} €. Der Markt liegt ${fmt(result.ui.market.abstandVomAthProzent)} % unter seinem Hoch; der reale Vermögensrückgang beträgt ${fmt(details.realerDepotDrawdown * 100)} %.`, '',
        ...priorValues, quotaTable(result, previous), '',
        traceTable(result.ui.spending.flexTrace), '',

        `Die Vermögensentnahme beträgt ${fmt(result.ui.spending.monatlicheEntnahme)} € im Monat. Mit Rente stehen dem Haushalt ${fmt(result.ui.spending.monatlicheEntnahme + pension / 12)} € monatlich zur Verfügung.`];
    if (result.diagnosis.general.alarmActive) rows.push('', 'B2 bis B7 werden im Alarm übersprungen. B8 bleibt im Trace sichtbar, wird aber ausgesetzt.');
    return rows.join('\n');
}
export function renderBudgetTechnicalExamples() {
    const { backtests, curveCases } = calculateBudgetExamples();
    const max = backtests[0], helga = backtests[1];
    const dynamic = curveCases[1];
    assert(dynamic.vpw.wishFlexCapApplied, 'Das Dynamic-Flex-Beispiel muss die Haushaltsobergrenze erreichen.');
    const input = dynamic.input;
    const dynamicResult = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: true });
    const vpw = dynamicResult.ui.vpw;
    const floorInput = { ...input, depotwertAlt: 1250000 };
    const floorResult = EngineAPI.simulateSingleYear(floorInput, null, { includeFlexTrace: true });
    assert(!floorResult.error, JSON.stringify(floorResult.error));
    const floorSteps = floorResult.ui.spending.flexTrace;
    const floorStep = name => floorSteps.find(step => step.schritt === name);
    return [
        'Alle Daten sind synthetisch. Die Musterhaushalte werden mit Datum 17. Oktober 2026 geladen. Der historische Lauf umfasst 2000 bis 2025. Die Zeile eines Jahres zeigt den Beschluss nach dessen Rendite; sie bildet keine damalige Lebensgeschichte ab.',
        '', '„€ pro Monat“ zeigt den offenen Depot-Flex nach jeder durchlaufenen Stufe. Der Netto-Grundbedarf kommt hinzu. Die Tabelle enthält die unveränderten Trace-Raten; nur ihre Anzeige wird auf zwei Nachkommastellen gerundet.', '',
        historicalExample('### Max und Erika im normalen Jahr', max.years.find(y => y.year === 2000)), '',
        historicalExample('### Max und Erika 2002', max.years.find(y => y.year === 2002)), '',
        historicalExample('### Helga und Werner', helga.years.find(y => y.year === 2000)), '',
        '### Dynamic Flex mit greifender Haushaltsobergrenze', '',
        `Der synthetische Vergleichshaushalt hat ${fmt(input.depotwertAlt)} € Depot und ${fmt(input.tagesgeld)} € Liquidität. Grundbedarf ${fmt(input.floorBedarf)} €, Wunsch-Flex ${fmt(input.flexBedarf)} €, Mindest-Flex ${fmt(input.minimumFlexAnnual)} € und Rente ${fmt(input.renteMonatlich * 12)} € gelten pro Jahr. Der Horizont beträgt ${input.horizonYears} Jahre, das Alter ${input.aktuellesAlter} und ${input.partnerAlter} Jahre. Go-Go ist mit Faktor ${fmt(input.goGoMultiplier)} angefordert. Inflation ist null; der Markt steht ohne Jahresgewinn am Höchststand. CAPE ist ${input.capeRatio}, die Fondskosten betragen ${EQUITY_COST_TEXT} pro Jahr.`, '',
        `A2: Aktienrendite ${fmt(vpw.expectedReturnCape * 100)} %, nach ${EQUITY_COST_TEXT} Fondskosten ${fmt(netEquityReturn(vpw.expectedReturnCape, input.equityCostPct) * 100)} %. Abzüglich ${fmt(CONFIG.SPENDING_MODEL.DYNAMIC_FLEX.LONG_TERM_INFLATION * 100)} % Inflation bleiben ${fmt((netEquityReturn(vpw.expectedReturnCape, input.equityCostPct) - CONFIG.SPENDING_MODEL.DYNAMIC_FLEX.LONG_TERM_INFLATION) * 100)} % Aktienrealrendite, Aktiengewicht ${fmt(vpw.equityWeight * 100)} %, sichere Realrendite ${fmt(vpw.safeRealReturn * 100)} % bei ${fmt(vpw.safeWeight * 100)} % Gewicht. Daraus folgen ${fmt(vpw.expectedRealReturn * 100)} % Portfoliorealrendite, ${Number(vpw.vpwRate * 100).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} % Annuitätenfaktor und ${fmt(vpw.vpwTotal / vpw.goGoMultiplier)} € Annuität. A3 multipliziert sie mit ${fmt(vpw.goGoMultiplier)} auf ${fmt(vpw.vpwTotal)} €. Der Netto-Grundbedarf ist null.`, '',
        `A5 begrenzt den Depot-Flex von ${fmt(dynamic.vpw.dynamicFlexBeforeWishCap)} € auf ${fmt(dynamic.annualFlex)} € im Jahr. Die Haushaltsobergrenze beträgt ${fmt(dynamic.vpw.wishFlexCapAnnual)} € einschließlich Rentenanteil.`, '',
        quotaTable(dynamicResult), '',
        '| B5 im direkten Vergleich | Ohne Dynamic Flex | Mit Dynamic Flex und Go-Go |', '| --- | ---: | ---: |',
        `| Flex-Bedarf nach A5 in €/Jahr | ${curveCases.map(c => fmt(c.annualFlex)).join(' | ')} |`,
        `| Geschützte Quote | ${curveCases.map(c => `${fmt(c.quote * 100)} %`).join(' | ')} |`,
        `| Rate vor B5 | ${curveCases.map(c => `${fmt(c.curve.rateVorher)} %`).join(' | ')} |`,
        `| Rate nach B5 | ${curveCases.map(c => `${fmt(c.curve.rateNachher)} %`).join(' | ')} |`,
        `| Depot-Flex nach B5 in €/Monat | ${curveCases.map(c => fmt(c.curve.monatsbetragNachher)).join(' | ')} |`, '',
        `FR-32 schützt in B5 den offenen Wunsch-Flex. B8 prüft die vorläufige Depotquote aus B0: ${fmt(dynamicResult.ui.spending.details.entnahmequoteDepot * 100)} %, gegenüber ${fmt(dynamic.curve.monatsbetragNachher * 12 / input.depotwertAlt * 100)} % nach B5. Die Vorsicht begrenzt das Anhebungsziel deshalb auf 4,5 % des Depots (FR-60).`, '', traceTable(dynamicResult.ui.spending.flexTrace), '',
        `Ohne Vorjahr gilt der Startanker ${fmt(dynamicResult.ui.spending.flexTrace.find(e => e.schritt === 'final_smoothing').kennzahlen.vorjahresrateProzent)} %. Deshalb hebt B11 die Rate aus B5 auf ${fmt(dynamic.followingAnchor)} %. Nach B13 beträgt die Vermögensentnahme ${fmt(dynamic.finalMonthly)} € monatlich.`, '',
        `Variante mit ${fmt(floorInput.depotwertAlt)} € Depot, sonst gleichen Eingaben: B0 meldet ${fmt(floorResult.ui.spending.details.entnahmequoteDepot * 100)} %. B5 senkt auf ${fmt(floorStep('flex_share_curve').rateNachher)} %, B8 hebt nach FR-37 auf ${fmt(floorStep('guardrails').rateNachher)} %. B11 bleibt bei ${fmt(floorStep('final_smoothing').rateNachher)} %; B13 zahlt ${fmt(floorResult.ui.spending.monatlicheEntnahme)} € monatlich.`
    ].join('\n');
}

export function renderBudgetExamples() {
    const { backtests, curveCases } = calculateBudgetExamples();
    const years = [2000, 2002].map(year => backtests[0].years.find(row => row.year === year));
    const pension = y => y.input.renteAktiv ? y.input.renteMonatlich * 12 : 0;
    const row = (name, value, unit = '€') => `| ${name} | ${years.map(y => `${fmt(value(y))}${unit ? ` ${unit}` : ''}`).join(' | ')} |`;
    const bear = years[1], trace = bear.result.ui.spending.flexTrace;
    const dynamic = curveCases[1], result = EngineAPI.simulateSingleYear(dynamic.input, null, { includeFlexTrace: true });
    const step = name => result.ui.spending.flexTrace.find(row => row.schritt === name);
    return [
        '<a id="max-und-erika-im-normalen-jahr"></a>', '<a id="max-und-erika-2002"></a>',
        '### Max und Erika im Jahresvergleich', '',
        `Synthetische Musterbestände vom 17.10.2026, historischer Lauf 2000–2025. Die Jahreszeile zeigt den Beschluss nach der Rendite, keine damalige Lebensgeschichte. Dynamic Flex ist aus. Aktien rechnen wie im Simulator mit ${EQUITY_COST_TEXT} Fondskosten pro Jahr. Alle Bedarfe und Renten gelten pro Jahr.`, '',
        '| Größe | Normaljahr 2000 | Bärenjahr 2002 |', '| --- | ---: | ---: |',
        row('Grundbedarf', y => y.input.floorBedarf), row('Wunsch-Flex', y => y.input.flexBedarf),
        row('Mindest-Flex', y => y.input.minimumFlexAnnual), row('Rente', pension),
        row('Offener Grundbedarf', y => Math.max(0, y.input.floorBedarf - pension(y))),
        row('Offener Wunsch-Flex', y => y.result.ui.neuerBedarf - Math.max(0, y.input.floorBedarf - pension(y))),
        row('Depot', y => y.result.ui.depotwertGesamt),
        row('Freie Liquidität', y => y.result.input.aktuelleLiquiditaet ?? y.result.input.tagesgeld + y.result.input.geldmarktEtf),
        row('Vermögensentnahme pro Monat', y => y.result.ui.spending.monatlicheEntnahme),
        row('Haushaltsbudget pro Monat mit Rente', y => y.result.ui.spending.monatlicheEntnahme + pension(y) / 12), '',
        `2002 beginnt die Rate bei ${fmt(trace[0].rateVorher)} %. Alarm senkt auf ${fmt(trace.find(e => e.schritt === 'alarm').rateNachher)} %; Rundung ergibt ${fmt(trace.at(-1).rateNachher)} % und ${fmt(bear.result.ui.spending.monatlicheEntnahme)} € monatliche Entnahme. Der nächste Anker bleibt ${fmt(bear.result.newState.flexRateSmoothingReference)} %. Die Rente deckt das Minimum schon vollständig; die niedrige Depotrate bedeutet hier kein Unterschreiten des Mindest-Flex.`, '',
        '### Dynamic Flex mit greifender Haushaltsobergrenze', '',
        `Synthetischer Jahresbeschluss, geprüft am 27.10.2026: ${fmt(dynamic.input.depotwertAlt)} € Depot, ${fmt(dynamic.input.tagesgeld)} € Liquidität, ${fmt(dynamic.input.floorBedarf)} € Grundbedarf, ${fmt(dynamic.input.flexBedarf)} € Wunsch- und Mindest-Flex, ${fmt(dynamic.input.renteMonatlich * 12)} € Jahresrente. Alter ${dynamic.input.aktuellesAlter}/${dynamic.input.partnerAlter}, Horizont ${dynamic.input.horizonYears} Jahre, CAPE ${dynamic.input.capeRatio}, Inflation null, Markt am Hoch. Go-Go-Faktor ${fmt(dynamic.input.goGoMultiplier)}, Fondskosten ${EQUITY_COST_TEXT} pro Jahr.`, '',
        '| Schritt | Ergebnis |', '| --- | ---: |',
        `| Portfoliorealrendite | ${fmt(dynamic.vpw.expectedRealReturn * 100)} % |`,
        `| Annuität vor Go-Go | ${fmt(dynamic.vpw.vpwTotal / dynamic.vpw.goGoMultiplier)} € |`,
        `| Dynamischer Depot-Flex vor / nach Haushaltsdeckel | ${fmt(dynamic.vpw.dynamicFlexBeforeWishCap)} / ${fmt(dynamic.annualFlex)} € |`,
        `| Geschützte Geldvermögensquote | ${fmt(dynamic.quote * 100)} % |`,
        ...['flex_share_curve', 'guardrails', 'final_smoothing', 'quantization'].map(name => `| ${steps[name].join(' ')} · Rate danach | ${fmt(step(name).rateNachher)} % |`),
        `| Vermögensentnahme pro Monat | ${fmt(dynamic.finalMonthly)} € |`, '',
        `Ohne Dynamik lässt B5 ${fmt(curveCases[0].curve.monatsbetragNachher)} € Depot-Flex monatlich stehen. Mit Dynamik schützt es denselben Wunsch, begrenzt aber Mehrbedarf. Danach heben Kaufkraftregel und letzte Änderungsgrenze wieder an. Der Deckel einer Zwischenstufe ist deshalb keine endgültige Auszahlung. Alle Trace-Zeilen und Gegenvarianten stehen in den [technischen Beispielen](TECHNICAL.md#vollständige-budgetbeispiele).`
    ].join('\n');
}

// Deterministische SVGs ohne Browser; Kurvenwerte kommen aus Konfiguration und Engine.
function plotSvg(title, xLabel, yLabel, xmax, ymax, values, xTicks, yTicks) {
    const x = v => 78 + v / xmax * 566, y = v => 270 - v / ymax * 210;
    const path = values.map(([a,b],i) => `${i ? 'L' : 'M'}${x(a).toFixed(2)},${y(b).toFixed(2)}`).join(' ');
    const ticks = [
        ...xTicks.map(v => `<text x="${x(v)}" y="292" text-anchor="middle">${Number(v.toFixed(4)).toLocaleString('de-DE')}</text>`),
        ...yTicks.map(v => `<path d="M78,${y(v)}H644" stroke="#ddd"/><text x="68" y="${y(v)+5}" text-anchor="end">${Number(v.toFixed(4)).toLocaleString('de-DE')}</text>`)
    ].join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="350" viewBox="0 0 720 350" role="img" aria-labelledby="title desc">
<title id="title">${title}</title><desc id="desc">${xLabel}; ${yLabel}. Aus engine/config.mjs erzeugt.</desc>
<rect width="720" height="350" fill="white"/><g font-family="sans-serif" font-size="15" fill="#222">
<text x="360" y="26" text-anchor="middle" font-size="19">${title}</text><text x="78" y="48">${yLabel}</text>
${ticks}<path d="M78,60V270H644" fill="none" stroke="#333"/><path d="${path}" fill="none" stroke="#256e63" stroke-width="3"/>
<text x="360" y="329" text-anchor="middle">${xLabel}</text></g></svg>\n`;
}
export function renderBudgetCurves() {
    const cfg = CONFIG.SPENDING_MODEL;
    const full = cfg.WEALTH_ADJUSTED_REDUCTION.FULL_WITHDRAWAL_RATE;
    const xMax = full * 100 * 1.5;
    const wealth = Array.from({length:201}, (_,i) => {
        const quote = i / 200 * xMax / 100;
        return [quote * 100, calculateWealthAdjustedReductionFactor({depotwertGesamt:100, inflatedBedarf:{floor:quote * 100,flex:0}}).factor];
    });
    const curve = cfg.FLEX_SHARE_S_CURVE;
    const shares = Array.from({length:201}, (_,i) => {
        const share = i / 200;
        return [share * 100, 100 - curve.K * 100 / (1 + Math.exp(-curve.A * (share - curve.B)))];
    });
    return {
        'docs/reference/images/jahresbudget-vermoegensfaktor.svg': plotSvg('Vermögensfaktor', 'Entnahmequote in %', 'Faktor', xMax, 1, wealth,
            [0,cfg.WEALTH_ADJUSTED_REDUCTION.SAFE_WITHDRAWAL_RATE*100,full*100,xMax], [0,.5,1]),
        'docs/reference/images/jahresbudget-s-kurve.svg': plotSvg('S-Kurven-Deckel bei Vermögensfaktor 1', 'Flex-Anteil in %', 'Maximale Flex-Rate in %', 100, 100, shares, [0,25,50,75,100], [0,20,40,60,80,100])
    };
}

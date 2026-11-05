import assert from 'node:assert/strict';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { calculateBudgetExamples } from './jahresbudget-beispiele.mjs';
import { calculateSaleAndTax } from '../engine/transactions/sale-engine.mjs';
import { determineAction } from '../engine/transactions/transaction-action.mjs';
import { computeAppliedMinTradeGate, computeCappedRefill, quantizeAmount } from '../engine/transactions/transaction-utils.mjs';
import { settleTaxYear, capitalGainsTaxRate } from '../engine/tax-settlement.mjs';
import { resolveTargetTagesgeld, withProfileLiquidityTargets } from '../app/balance/balance-play-execution.js';

// Ausschließlich synthetische Eingaben. Keine Lese- oder Schreibzugriffe auf Nutzerrecords.
export function syntheticHousehold() {
    const common = {
        aktuellesAlter: 65, startAlter: 65, partnerAlter: 63, inflation: 0,
        floorBedarf: 24000, flexBedarf: 18000, minimumFlexAnnual: 6000,
        dynamicFlex: false, goGoActive: false, flexBudgetAnnual: 0,
        liquidityRunwayYears: 5, maxSkimPctOfEq: 5, maxBearRefillPctOfEq: 0.5,
        risikoprofil: 'sicherheits-dynamisch', rebalancingBand: 35,
        goldAktiv: false, goldWert: 0, goldCost: 0, goldZielProzent: 0, goldFloorProzent: 0,
        renteAktiv: true, kirchensteuerSatz: 0, sparerPauschbetrag: 1000,
        tqfAlt: 0.3, tqfNeu: 0.3, goldSteuerfrei: false,
        endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: 0, capeRatio: 25
    };
    const lot = (trancheId, name, marketValue, costBasis, purchaseDate, type = 'aktien_neu') => ({
        schemaVersion: 2, trancheId, name, type,
        category: type === 'geldmarkt' ? 'money_market' : 'equity',
        marketValue, costBasis, purchaseDate, tqf: type === 'geldmarkt' ? 0 : 0.3, taxExempt: false
    });
    const profiles = [
        { profileId: 'max', name: 'Max Mustermann', hasExplicitTrancheOverride: true,
            inputs: { ...common, tagesgeld: 14000, geldmarktEtf: 46000, depotwertAlt: 200000,
                depotwertNeu: 10000, costBasisAlt: 60000, costBasisNeu: 9000, renteMonatlich: 1000 },
            balanceState: { lastState: { taxState: { lossCarry: 200 } } },
            tranches: [lot('alt', 'Aktienfonds Alt', 200000, 60000, '2010-01-01', 'aktien_alt'),
                lot('neu', 'Aktienfonds Neu', 10000, 9000, '2025-01-01'),
                lot('mm', 'Geldmarkt', 46000, 46000, '2023-01-01', 'geldmarkt')] },
        { profileId: 'erika', name: 'Erika Mustermann', hasExplicitTrancheOverride: true,
            inputs: { ...common, aktuellesAlter: 63, tagesgeld: 14000, geldmarktEtf: 16000,
                depotwertAlt: 0, depotwertNeu: 490000, costBasisAlt: 0, costBasisNeu: 392000, renteMonatlich: 500 },
            balanceState: { lastState: { taxState: { lossCarry: 500 } } },
            tranches: [lot('neu', 'Aktienfonds Erika', 490000, 392000, '2020-01-01'),
                lot('mm', 'Geldmarkt', 16000, 16000, '2023-01-01', 'geldmarkt')] }
    ];
    const input = { ...common, tagesgeld: 28000, geldmarktEtf: 62000, depotwertAlt: 200000,
        depotwertNeu: 500000, costBasisAlt: 60000, costBasisNeu: 401000,
        renteMonatlich: 1500, sparerPauschbetrag: 2000, jointAssessment: false };

    return { input, profiles };
}

function evaluate(input, profiles, previous = null, mode = 'tax_optimized') {
    const before = JSON.stringify({ input, profiles, previous }), calls = [];
    const engineApi = { simulateSingleYear(engineInput, state) {
        const result = EngineAPI.simulateSingleYear(engineInput, state);
        assert.ok(!result.error, result.error?.message);
        calls.push({ input: structuredClone(engineInput), result: structuredClone(result) });
        return result;
    } };
    const runs = evaluateStoredAnnualHousehold(input, profiles, previous, { engineApi, withdrawalMode: mode });
    assert.equal(JSON.stringify({ input, profiles, previous }), before);
    for (const action of [runs.householdResult.ui.action, ...runs.map(run => run.ui.action)]) {
        const net = (action.quellen || []).reduce((sum, source) => sum + source.brutto - source.steuer, 0);
        assert.ok(Math.abs(net - Object.values(action.verwendungen || {}).reduce((a, b) => a + b, 0)) < 0.02);
    }
    return { input, profiles, calls, runs, model: runs.householdResult };
}

function muster(id) {
    const records = createMusterHaushaltRecords('2026-10-19', id);
    const values = Object.values(JSON.parse(records.household_plan_v1).entries)[0];
    const calculation = buildBalanceEngineInputFromStorage({ scope: values.scope,
        storage: annualRecordStorage(records), referenceYear: 2026 });
    return { input: calculation.inputData, profiles: calculation.profiles,
        previous: calculation.engineLastState, mode: values.values.householdWithdrawalMode };
}

export function calculateActionExamples() {
    const synthetic = syntheticHousehold();
    const main = evaluate(synthetic.input, synthetic.profiles);
    // Gleiche Pfadwahl mit echten Verkaufshilfen wiederholen, um C8-Probe und C11 getrennt zu belegen.
    const mainSales = [];
    const { input: mainInput, ui: mainUi } = main.calls[0].result;
    const replay = determineAction({
        aktuelleLiquiditaet: mainInput.tagesgeld + mainInput.geldmarktEtf,
        depotwertGesamt: mainUi.depotwertGesamt,
        zielLiquiditaet: mainUi.zielLiquiditaet,
        market: mainUi.market, spending: mainUi.spending, minGold: mainUi.minGold,
        input: mainInput
    }, {
        computeAppliedMinTradeGate, computeCappedRefill, quantizeAmount,
        calculateSaleAndTax(...args) {
            const sale = calculateSaleAndTax(...args);
            mainSales.push(sale);
            return sale;
        }
    });
    assert.equal(mainSales.length, 2);
    assert.ok(Math.abs(replay.nettoErlös - mainUi.action.nettoErlös) < 0.01);
    const budget = calculateBudgetExamples();
    const bear = budget.backtests.find(row => row.household === 'max-erika').years.find(row => row.year === 2002);
    const jan = muster('jan-lena');
    const janBase = evaluate(jan.input, jan.profiles, jan.previous, jan.mode);
    // Varianten der Musterbestände: Nur Goldwert bzw. Tagesgeld ändern.
    const goldProfiles = structuredClone(jan.profiles);
    for (const profile of goldProfiles) {
        for (const tranche of profile.tranches) if (tranche.category === 'gold') {
            tranche.marketValue *= 3; tranche.costBasis *= 3;
        }
        profile.inputs.goldWert *= 3;
        profile.inputs.tagesgeld += 150000;
    }
    const gold = evaluate({ ...jan.input, goldWert: jan.input.goldWert * 3, tagesgeld: jan.input.tagesgeld + 300000 }, goldProfiles, jan.previous, jan.mode);
    const surplusProfiles = structuredClone(jan.profiles);
    for (const profile of surplusProfiles) { profile.inputs.tagesgeld += 300000; profile.inputs.maxSkimPctOfEq = 5; }
    const surplus = evaluate({ ...jan.input, tagesgeld: jan.input.tagesgeld + 600000, maxSkimPctOfEq: 5 }, surplusProfiles, jan.previous, jan.mode);
    const helga = muster('helga-werner');
    const care = evaluate(helga.input, helga.profiles, helga.previous, helga.mode);
    const partialInput = { kirchensteuerSatz: 0, sparerPauschbetrag: 1000,
        detailledTranches: [lotForProbe()] };
    const partial = calculateSaleAndTax(10000, partialInput, { minGold: 0 }, { sKey: 'peak_stable' }, false);
    const tax = [0, 5000].map(lossCarry => settleTaxYear({ taxStatePrev: { lossCarry },
        rawAggregate: { sumRealizedGainSigned: 15000, sumTaxableAfterTqfSigned: 10500 },
        sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }));
    assert.match(gold.calls[0].result.ui.action.title, /Opportunistisch/);
    assert.ok(gold.model.ui.action.quellen.some(q => q.kind === 'gold'));
    assert.match(surplus.calls[0].result.ui.action.title, /Überschuss/);
    assert.ok(surplus.model.ui.action.verwendungen.gold > 0 && surplus.model.ui.action.verwendungen.aktien > 0);
    assert.ok(care.model.ui.action.taxSettlements.every(row => row.details.jointAssessment));
    return { main, mainSales, bear, janBase, gold, surplus, care, partial, tax };
}
function lotForProbe() {
    return { schemaVersion: 2, trancheId: 'probe', name: 'Synthetischer Teilverkauf', type: 'aktien_neu',
        category: 'equity', marketValue: 100000, costBasis: 0, purchaseDate: '2020-01-01', tqf: 0.3, taxExempt: false };
}

const fmt = (n, digits = 2) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const eur = n => `${fmt(n)} €`;
const sum = rows => rows.reduce((a, b) => a + b, 0);
function actionTable(model) {
    const ui = model.ui, a = ui.action;
    return ['| Wert | Ergebnis |', '| --- | ---: |',
        `| Jahresentnahme | ${eur(ui.spending.monatlicheEntnahme * 12)} |`,
        `| Liquiditätsziel | ${eur(ui.zielLiquiditaet)} |`,
        `| Freie Liquidität vorher | ${eur(model.input.tagesgeld + model.input.geldmarktEtf)} |`,
        `| Deckung vorher / nachher | ${fmt(ui.liquiditaet.deckungVorher)} % / ${fmt(ui.liquiditaet.deckungNachher)} % |`,
        `| Reichweite vorher / nachher, vor Auszahlung | ${fmt((model.input.tagesgeld + model.input.geldmarktEtf) / ui.spending.monatlicheEntnahme)} / ${fmt(ui.runway.months)} Monate |`,
        `| Bruttoquellen / Steuer / Netto | ${eur(sum((a.quellen || []).map(q => q.brutto)))} / ${eur(a.steuer)} / ${eur(a.nettoErlös)} |`,
        ...Object.entries(a.verwendungen || {}).filter(([,n]) => n > 0).map(([key,n]) => `| Verwendung ${{ liquiditaet: 'Liquidität', aktien: 'Aktien', gold: 'Gold', bonds: 'Anleihen' }[key] ?? key} | ${eur(n)} |`)].join('\n');
}

export function renderActionTechnicalExamples(examples = calculateActionExamples()) {
    const { main, mainSales, bear, janBase, gold, surplus, care, partial, tax } = examples;
    const cashTarget = resolveTargetTagesgeld(main.model.ui.spending, main.model.ui.zielLiquiditaet,
        { ...main.input, liquidityCashMonths: main.input.liquidityCashMonths ?? 12 });
    const cashTargets = withProfileLiquidityTargets(main.runs.map(run => ({ profileId: run.profileId, name: run.name,
        input: { ...run.input, liquidityCashMonths: 12 }, spending: run.ui.spending })), main.model.ui.zielLiquiditaet,
        { storage: { getItem: () => null }, now: new Date(2027, 0, 2) });
    const personalTargets = cashTargets.map(entry => `${entry.name} ${eur(resolveTargetTagesgeld(entry.spending, entry.targetLiquidity, entry.input))}`).join(', ');
    const initial = main.calls[0].result.ui.action, final = main.model.ui.action;
    const [probe, execution] = mainSales;
    const goldNeed = gold.calls[0].result.ui.action.transactionDiagnostics.goldThresholds;
    const rawGoldSale = goldNeed.currentGoldValue - goldNeed.targetGoldValue;
    const roundedGoldNeed = quantizeAmount(rawGoldSale, 'ceil');
    const sourceRows = ['| Person und Tranche | Brutto | Steuer | Netto |', '| --- | ---: | ---: | ---: |',
        ...final.quellen.map(q => `| ${q.sourceProfileName} · ${q.name} · ${q.purchaseDate} | ${eur(q.brutto)} | ${eur(q.steuer)} | ${eur(q.netto)} |`),
        `| Summe | ${eur(sum(final.quellen.map(q => q.brutto)))} | ${eur(final.steuer)} | ${eur(final.nettoErlös)} |`];
    const personRows = main.runs.map(run => `| ${run.name} | ${eur(run.ui.action.verwendungen.liquiditaet)} | ${eur(run.ui.action.taxSettlement.taxSavedByLossCarry)} |`);
    const three = care.model.ui.threeBucket || care.model.diagnosis.keyParams.threeBucket;
    return [
        '### Max und Erika mit Auffüllung und persönlicher Steuer', '',
        'Synthetische Variante von Max und Erika Mustermann für die Vorschau des Jahresabschlusses 2026 und Plan 2027. Alter 65 und 63; stabiler Höchststand, Inflation 0 %, Dynamic Flex und Go-Go aus, Standardstrategie ohne Gold und Pflege-Rücklage. Kirchensteuer und Zusammenveranlagung sind aus.', '',
        '| Ausgangswert | Max | Erika |', '| --- | ---: | ---: |',
        ...['tagesgeld','geldmarktEtf','depotwertAlt','costBasisAlt','depotwertNeu','costBasisNeu','renteMonatlich','sparerPauschbetrag'].map((key,i) =>
            `| ${['Tagesgeld','Geldmarkt ohne Buchgewinn','Aktien alt Marktwert','Aktien alt Einstand','Aktien neu Marktwert','Aktien neu Einstand','Rente monatlich','Pauschbetrag'][i]} | ${eur(main.profiles[0].inputs[key])} | ${eur(main.profiles[1].inputs[key])} |`),
        `| Verlustvortrag | ${eur(main.profiles[0].balanceState.lastState.taxState.lossCarry)} | ${eur(main.profiles[1].balanceState.lastState.taxState.lossCarry)} |`, '',
        `Alle Aktienfonds haben ${fmt(main.input.tqfNeu * 100, 0)} % Teilfreistellung. Grundbedarf ${eur(main.input.floorBedarf)}, Wunsch-Flex ${eur(main.input.flexBedarf)}, Mindest-Flex ${eur(main.input.minimumFlexAnnual)} pro Jahr; Reichweite ${fmt(main.input.liquidityRunwayYears, 0)} Jahre und Abschöpflimit ${fmt(main.input.maxSkimPctOfEq, 0)} % der Aktien.`, '',
        actionTable(main.model), '',
        `A/B liefern ${eur(main.model.ui.spending.monatlicheEntnahme)} monatlich. C1 bemisst das Ziel am Jahresbedarf nach ${eur(main.input.renteMonatlich * 12)} Rente. Der Brutto-Mindestpuffer beträgt ${eur((main.input.floorBedarf + main.input.flexBedarf) / 12 * (main.calls[0].input.minCashBufferMonths ?? CONFIG.THRESHOLDS.STRATEGY.minCashBufferMonths))}. C6–C8 finden ${eur(main.model.ui.zielLiquiditaet - main.input.tagesgeld - main.input.geldmarktEtf)} Lücke und runden den Probeverkauf auf.`, '',
        `Die C8-Probe liefert ${eur(probe.breakdown[0].brutto)} brutto aus Max Neu und ${eur(probe.breakdown[1].brutto)} aus Erika Neu: zusammen ${eur(probe.bruttoVerkaufGesamt)} brutto bei ${eur(probe.steuerGesamt)} Plansteuer. Das sind die angeforderten ${eur(probe.achievedRefill)} netto. C8 rundet auf ${eur(quantizeAmount(probe.bruttoVerkaufGesamt, 'ceil'))} brutto auf. C11 verkauft dafür ${eur(execution.breakdown[0].brutto)} Max Neu und ${eur(execution.breakdown[1].brutto)} Erika Neu. Nach ${eur(execution.steuerGesamt)} Plansteuer bleiben ${eur(execution.achievedRefill)} als Nettoziel für D2; der Mehrerlös zur ursprünglichen Lücke geht in C13 zur Liquidität.`, '',
        '| Steuerstand | Brutto | Steuer | Netto für Liquidität |', '| --- | ---: | ---: | ---: |',
        `| C10–C16 vor persönlicher Abrechnung | ${eur(sum(initial.quellen.map(q => q.brutto)))} | ${eur(initial.steuer)} | ${eur(initial.nettoErlös)} |`,
        `| D2 nach persönlicher Abrechnung | ${eur(sum(final.quellen.map(q => q.brutto)))} | ${eur(final.steuer)} | ${eur(final.nettoErlös)} |`, '',
        ...sourceRows, '',
        '| Person | Zufluss Liquidität aus D3 | Steuerersparnis durch Verlustvortrag |', '| --- | ---: | ---: |', ...personRows, '',
        `Max Neu liefert ${eur(final.quellen[0].taxableAfterTqfSigned)} steuerlich gewichteten Gewinn. Verlustvortrag plus Pauschbetrag lassen danach ${eur(main.profiles[0].balanceState.lastState.taxState.lossCarry + main.profiles[0].inputs.sparerPauschbetrag - final.quellen[0].taxableAfterTqfSigned)} frei; deshalb kommt Max Alt hinzu. D2 hält den geplanten Nettozufluss fest und bestimmt dafür Brutto und Steuer neu. Der endgültige Bruttoverkauf ist dadurch nicht mehr glatt.`, '',
        `Die getrennte Auszahlungsverteilung weist ${main.runs.distribution.items.filter(row => row.withdrawalAmount > 0).map(row => `${main.profiles.find(p => p.profileId === row.profileId).name} ${eur(row.withdrawalAmount)}`).join(', ')} zu. Das Tagesgeldziel des Haushalts aus E2 beträgt ${eur(cashTarget)}: ${personalTargets}, nach Bedarf der kommenden zwölf Monate mit gleichem Planbudgetanteil als Ausgabenquelle. Der persönliche Mindestanteil bleibt erhalten. Alle Tabellen gelten vor Auszahlung; die Einzelanzeige kann durch Rundung um einen Cent von einer nachgerechneten Summe abweichen.`, '',
        '### Max und Erika im Bärenjahr', '',
        `Unveränderte Musterprofile im historischen Lauf, Marktjahr ${bear.year}; der Simulator hat Renditen und Renten bereits angewandt. Die Grundversorgung ist durch Rente gedeckt. Der Bärenpfad schützt die vorhandene Liquidität und wartet; C3 als eigentlicher Auffüllverkauf wird hier nicht ausgelöst.`, '',
        actionTable(bear.result), '',
        `Engineaktion: „${bear.result.ui.action.title}“, Typ ${bear.result.ui.action.type}. Eine Zielunterdeckung allein würde im Bär ebenfalls keinen opportunistischen Verkauf auslösen.`, '',
        '### Jan und Lena mit Gold über dem Band', '',
        'Variante der Musterprofile: Die Goldwerte und ihre Einstandswerte sind verdreifacht; je Person kommen 150.000 € Tagesgeld hinzu, damit der Gold-Band-Pfad ohne Notauffüllung sichtbar wird. Die Goldquoten bleiben erhalten. Die Quoteneinstellungen sind 10 % Ziel, 5 % Floor und 20 % Band; nach dem Haushaltsmerge zählt die freie Vermögensbasis. Das Band löst Verkäufe bis zum Ziel aus, der Floor ist eine getrennte Verkaufssperre.', '',
        actionTable(gold.model), '',
        `C7 rundet den Goldverkaufsbedarf ${eur(rawGoldSale)} auf ${eur(roundedGoldNeed)} Gesamtbedarf auf. Die Differenz ${eur(roundedGoldNeed - rawGoldSale)} wird als Liquiditätsbedarf eingeplant, obwohl vorher keine Liquiditätslücke besteht. C8 rundet das Goldverkaufsbudget dagegen auf ${eur(goldNeed.saleBudgetGold)} ab. C13 bedient daraus zuerst den Liquiditätsbedarf; für Aktien bleiben ${eur(gold.model.ui.action.verwendungen.aktien)}.`, '',
        `Goldquellen brutto: ${eur(sum(gold.model.ui.action.quellen.filter(q => q.kind === 'gold').map(q => q.brutto)))}. Zum Vergleich haben die unveränderten Profile ${eur(janBase.input.goldWert)} Gold; ihr Enginevorschlag lautet „${janBase.calls[0].result.ui.action.title}“.`, '',
        '### Jan und Lena legen Überschuss an', '',
        'Variante derselben Musterprofile: Je Person kommen 300.000 € Tagesgeld hinzu; das Abschöpflimit wird auf 5 % gesetzt. Andere Bestände bleiben erhalten. Das ist eine synthetische Sofortanlage, keine vorweggenommene einmalige Einkunft. C9 baut zuerst das Goldziel auf und gibt den verbleibenden Überschuss an Aktien.', '',
        actionTable(surplus.model), '',
        `Enginepfad: „${surplus.calls[0].result.ui.action.title}“. Das eingestellte Abschöpflimit beträgt ${fmt(surplus.input.maxSkimPctOfEq, 0)} %; auch bei 0 % bleibt dieser Überschusskauf gleich.`, '',
        '### Helga und Werner mit Pflege-Rücklage und drei Töpfen', '',
        'Musterbestände vom 19. Oktober 2026: proportionale Verteilung und Kirchensteuer 9 %. Der Generator sowie Live-Formularleser und gespeicherter Balance-Leser übergeben die gespeicherte Zusammenveranlagung an den Haushaltsaufruf. Die aktivierte Pflege-Rücklage wird vor der Rechnung aus Geldmarkt und Tagesgeld getrennt. Die Tabellen zeigen die operative Basis nach diesem Abzug.', '',
        `Liquidität vor Reservierung ${eur(care.input.tagesgeld + care.input.geldmarktEtf)}, operative Liquidität ${eur(care.model.input.tagesgeld + care.model.input.geldmarktEtf)}; reserviert ${eur(care.input.tagesgeld + care.input.geldmarktEtf - care.model.input.tagesgeld - care.model.input.geldmarktEtf)}. Kirchensteuerfaktor im Modell: ${fmt(capitalGainsTaxRate(0.09) * 100, 6)} %.`, '',
        actionTable(care.model), '',
        `Drei Töpfe: ${three?.isBadYear ? 'schlechtes' : 'kein schlechtes'} Aktienjahr; Anleihen vorher ${eur(three?.bondBucketBefore)}, Verkauf ${eur(three?.bondSaleAmount)}, Nachkauf ${eur(three?.bondRefillNet)}, danach ${eur(three?.bondBucketAfter)}. D2 rechnet den endgültigen Haushaltssteuerstand mit Zusammenveranlagung; die Drei-Topf-Diagnose stammt aus der vorherigen Enginefinalisierung.`, '',
        '### Steuer mit Verlustvortrag', '',
        'Isolierter synthetischer Jahresabschluss über die Steuerroutine der Engine: 30.000 € Bruttoverkauf, 15.000 € Gewinn und 30 % Teilfreistellung ergeben 10.500 € steuerlich gewichteten Gewinn. Der Pauschbetrag beträgt 1.000 €, Kirchensteuer ist aus.', '',
        '| Verlustvortrag am Jahresanfang | Steuerbasis nach Verlust und Pauschbetrag | Steuer | Netto aus 30.000 € | Vortrag danach |', '| ---: | ---: | ---: | ---: | ---: |',
        ...tax.map(t => `| ${eur(t.details.lossCarryStart)} | ${eur(t.details.taxBaseAfterCarry)} | ${eur(t.taxDue)} | ${eur(30000 - t.taxDue)} | ${eur(t.taxStateNext.lossCarry)} |`), '',
        `Gegenprobe zu C11: Bei einem Teilverkauf aus einer vollständig im Gewinn stehenden Tranche mit 30 % Teilfreistellung und 1.000 € Pauschbetrag fordert die Sale-Engine ${eur(10000)} netto an und liefert ${eur(partial.achievedRefill)}. Dafür verkauft sie ${eur(partial.bruttoVerkaufGesamt)} brutto bei ${eur(partial.steuerGesamt)} Steuer auf den tatsächlichen Teilgewinn. Der Pauschbetrag wird dabei nicht proportional verkleinert.`, '',
        'Die Zahlen erzeugt [handlungsanweisung-beispiele.mjs](../../scripts/handlungsanweisung-beispiele.mjs) mit Engine und Haushaltsweg. Der Generator verändert keine gespeicherten Bestände.'
    ].join('\n');
}

export function renderActionExamples(examples = calculateActionExamples()) {
    const { main, bear } = examples, initial = main.calls[0].result.ui.action, final = main.model.ui.action;
    return [
        '### Max und Erika mit Auffüllung und persönlicher Steuer', '',
        `Synthetischer Jahresabschlussentwurf 2026 für Plan 2027, geprüft am 27.10.2026: ${eur(main.input.floorBedarf)} Grundbedarf, ${eur(main.input.flexBedarf)} Wunsch-Flex, ${eur(main.input.minimumFlexAnnual)} Mindest-Flex und ${eur(main.input.renteMonatlich * 12)} Rente jährlich. Dynamik und Go-Go aus, stabiler Höchststand, keine Inflation, kein Gold und keine Pflege-Rücklage. Zusammenveranlagung und Kirchensteuer aus.`, '',
        `Aktienbestand ${eur(main.input.depotwertAlt + main.input.depotwertNeu)}, freie Liquidität ${eur(main.input.tagesgeld + main.input.geldmarktEtf)}. Fünf Jahre Reserve und 5 % Abschöpfgrenze. Die [vollständigen Ausgangstranchen und Steuerdaten](TECHNICAL.md#max-und-erika-mit-auffüllung-und-persönlicher-steuer) gehören zu demselben Beispiel.`, '',
        actionTable(main.model), '',
        `Die ursprüngliche Lücke von ${eur(main.model.ui.zielLiquiditaet - main.input.tagesgeld - main.input.geldmarktEtf)} führt durch Plansteuer und Handelsrundung zunächst zu ${eur(sum(initial.quellen.map(q => q.brutto)))} Bruttoverkauf und ${eur(initial.steuer)} Plansteuer. Persönliche Abrechnung verändert Brutto und Steuer; das Netto bleibt ${eur(final.nettoErlös)}.`, '',
        '| Person und Tranche | Brutto | Steuer | Netto |', '| --- | ---: | ---: | ---: |',
        ...final.quellen.map(q => `| ${q.sourceProfileName} · ${q.name} | ${eur(q.brutto)} | ${eur(q.steuer)} | ${eur(q.netto)} |`), '',
        `Die getrennte Auszahlung nutzt ${main.runs.distribution.items.filter(row => row.withdrawalAmount > 0).map(row => `${main.profiles.find(p => p.profileId === row.profileId).name}: ${eur(row.withdrawalAmount)}`).join(', ')}. Die Tabellen gelten vor Auszahlung; gerundete Einzelanzeigen können um einen Cent abweichen.`, '',
        '### Max und Erika im Bärenjahr', '',
        `Musterbestände vom 17.10.2026 im historischen Lauf, Beschluss nach der Rendite ${bear.year}. Die Rente deckt den Grundbedarf. Der Bärenpfad wartet bei ausreichender Liquidität; eine Kürzung erzwingt keinen Verkauf.`, '',
        actionTable(bear.result), '',
        `Anweisung: „${bear.result.ui.action.title}“. Gold, Überschussanlage, Pflege-Rücklage und isolierte Steuergegenproben stehen in den [vollständigen technischen Beispielen](TECHNICAL.md#vollständige-handelsbeispiele).`
    ].join('\n');
}

export function renderHandbookActionExample(examples = calculateActionExamples()) {
    const { main } = examples, a = main.model.ui.action;
    return `<p>Max und Erika Mustermann, synthetische Rechenvariante vom 17.10.2026: Lies in den Details ${eur(sum(a.quellen.map(q => q.brutto)))} Bruttoverkauf. Abzüglich ${eur(a.steuer)} Steuer bleiben ${eur(a.nettoErlös)} für Liquidität. Die Deckung danach beträgt ${fmt(main.model.ui.liquiditaet.deckungNachher, 1)} % vor Jahresauszahlung. Ausführlich: <a href="docs/reference/HANDLUNGSANWEISUNG.html#zwei-beispiele">Handlungsbeispiele</a>.</p>`;
}

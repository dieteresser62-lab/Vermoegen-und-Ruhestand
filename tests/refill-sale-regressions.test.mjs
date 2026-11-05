import TransactionEngine from '../engine/transactions/TransactionEngine.mjs';
import { calculateSaleAndTax, getSellOrder } from '../engine/transactions/sale-engine.mjs';
import { CONFIG } from '../engine/config.mjs';

const lot = (trancheId, patch = {}) => ({ schemaVersion: 2, trancheId,
    type: 'aktien_neu', category: 'equity', marketValue: 500000, costBasis: 500000,
    purchaseDate: '2020-01-01', tqf: 0.3, taxExempt: false, ...patch });
const base = { depotwertAlt: 500000, depotwertNeu: 500000, tagesgeld: 50000,
    geldmarktEtf: 0, floorBedarf: 12000, flexBedarf: 12000, liquidityRunwayYears: 5,
    maxSkimPctOfEq: 5, maxBearRefillPctOfEq: 5, kirchensteuerSatz: 0,
    sparerPauschbetrag: 0, goldAktiv: false };
function action(input = base, sKey = 'neutral', patch = {}) {
    return TransactionEngine.determineAction({ aktuelleLiquiditaet: 50000,
        depotwertGesamt: input.depotwertAlt + input.depotwertNeu + (input.goldWert || 0),
        zielLiquiditaet: 120000, minGold: 0, market: { sKey, seiATH: 1 },
        spending: { details: { endgueltigeEntnahme: 24000 } }, input, ...patch });
}

// B3: C4 und C5 müssen dasselbe Nettoziel einschließlich Verkaufssteuer decken.
for (const regime of ['bear_deep', 'recovery_in_bear', 'neutral']) {
    for (const spb of [0, 1000]) {
        const input = { ...base, depotwertAlt: 0, depotwertNeu: 1000000,
            sparerPauschbetrag: spb, detailledTranches: [lot('taxable', {
                marketValue: 1000000, costBasis: 0 })] };
        const result = action(input, regime);
        const gross = (40000 - spb * 0.26375) / (1 - 0.7 * 0.26375);
        assert(result.title.includes('Runway-Notfüllung'), 'C4/C5 wurde erreicht');
        assertClose(result.nettoErlös, 40000, 1e-8, 'Notauffüllung trifft den Nettoauftrag');
        assertClose(result.quellen[0].brutto, gross, 1e-8, 'Bruttospielraum deckt die tatsächliche Steuer');
        assertClose(result.steuer, gross - 40000, 1e-8, 'Steuer gehört nicht zum Nettoziel');
        assertClose(result.verwendungen.liquiditaet, 40000, 1e-8, 'Netto steht vollständig zur Auffüllung bereit');
    }
    const mixed = action({ ...base, detailledTranches: [
        lot('expensive', { type: 'aktien_alt', costBasis: 0 }), lot('cheap')
    ] }, regime);
    assertEqual(mixed.quellen.length, 1, 'Kein erzwungener proportionaler Alt-/Neu-Verkauf');
    assertEqual(mixed.quellen[0].trancheId, 'cheap', 'Normale Steuerreihenfolge wählt die günstige Tranche');
    assertEqual(mixed.steuer, 0, 'Vermeidbare Steuer entfällt');
    assertClose(mixed.nettoErlös, 40000, 1e-8, 'Günstiger Verkauf deckt denselben Auftrag');
}
{
    const capped = action(base, 'neutral', { zielLiquiditaet: 500000 });
    assertEqual(capped.isPufferSchutzAktiv, false, 'C3 bleibt getrennt');
    assertEqual(capped.nettoErlös, 100000, 'Bestehender 10-%-Netto-Krisenkorridor bleibt erhalten');
    const goldOnly = action({ ...base, depotwertAlt: 0, depotwertNeu: 0,
        goldAktiv: true, goldWert: 80000, goldSteuerfrei: true,
        detailledTranches: [lot('gold-only', { type: 'gold', category: 'gold',
            marketValue: 80000, costBasis: 80000, tqf: 0, taxExempt: true })] });
    assertClose(goldOnly.nettoErlös, 40000, 1e-8, 'Ohne Aktienbasis bleibt die Goldquelle verfügbar');
}

// F2: Gold über Band darf Anleihen weder überspringen noch unverkäuflich machen.
{
    const tranches = [lot('gold', { type: 'gold', category: 'gold', marketValue: 100000,
        costBasis: 100000, tqf: 0, taxExempt: true }),
    lot('bond', { type: 'anleihe', category: 'bonds', marketValue: 100000, costBasis: 100000, tqf: 0 }),
    lot('equity', { marketValue: 100000, costBasis: 100000 })];
    const input = { ...base, depotwertAlt: 0, depotwertNeu: 200000, tagesgeld: 0,
        goldAktiv: true, goldWert: 100000, goldZielProzent: 10, rebalancingBand: 35,
        detailledTranches: tranches };
    const order = getSellOrder(Object.fromEntries(tranches.map(t => [t.trancheId, t])),
        { sKey: 'peak_stable' }, input, {}, false);
    assertEqual(JSON.stringify(order), JSON.stringify(['gold', 'bond', 'equity']), 'Gold, Anleihen, Aktien');
    const sale = calculateSaleAndTax(150000, input, { saleBudgets: { gold: 20000 } }, { sKey: 'peak_stable' }, false);
    assertEqual(sale.breakdown[1].trancheId, 'bond', 'Nach Goldbudget zuerst Anleihen');
    assertEqual(sale.breakdown[1].brutto, 100000, 'Anleihen sind vollständig verkäuflich');
    assertClose(sale.achievedRefill, 150000, 1e-8, 'Alle Quellen decken den Nettoauftrag');
    const override = { ...input, aktuelleLiquiditaet: 1000000 };
    const expected = ['bond', 'equity', 'gold'];
    assertEqual(JSON.stringify(getSellOrder(Object.fromEntries(tranches.map(t => [t.trancheId, t])),
        { sKey: 'peak_stable' }, override, {}, false)), JSON.stringify(expected), 'Band nutzt die operative Liquidität');
    assertEqual(JSON.stringify(getSellOrder(Object.fromEntries(tranches.map(t => [t.trancheId, t])),
        { sKey: 'peak_stable' }, { ...override, aktuelleLiquiditaet: undefined, tagesgeld: 1000000 }, {}, false)),
    JSON.stringify(expected), 'Ohne Override gilt Tagesgeld plus Geldmarkt');
}

// B5: Verkaufsbedarf 0 übergibt den Kauf an die vorhandene Überschussanlage C9.
{
    const input = { ...base, floorBedarf: 40000, goldAktiv: true,
        goldWert: 0, goldZielProzent: 10, rebalancingBand: 35 };
    const result = action(input, 'peak_stable', { aktuelleLiquiditaet: 70000, zielLiquiditaet: 20000 });
    assertEqual(result.title, 'Runway-Überschuss investieren', 'Cashkrise unter dem Floor-Puffer erreicht C9');
    assertEqual(result.quellen[0].kind, 'liquiditaet', 'Goldkauf wird aus dem Überschuss bezahlt');
    // AN-1b: Trotz niedrigerem Ziel bleiben 40.000 € Netto-Floor plus ein Monat stehen.
    assertEqual(result.verwendungen.gold, 25000, 'Der Goldkauf bleibt nach Schutz des Auszahlungspuffers erhalten');
    assertEqual(result.quellen[0].brutto, 25000, 'Nur der Überschuss oberhalb des Auszahlungspuffers wird investiert');
    assert(70000 - result.quellen[0].brutto >= 40000 + 40000 / 12,
        'Der höhere Netto-Floor ist auch bei kleinerer geplanter Auszahlung geschützt');
    const small = action({ ...input, floorBedarf: 0 }, 'peak_stable', {
        aktuelleLiquiditaet: 8000, zielLiquiditaet: 2000,
        spending: { details: { endgueltigeEntnahme: 0 } }
    });
    assertEqual(small.type, 'NONE', 'Unter absolutem Cashminimum bleibt das normale C9-Mindesthandelstor wirksam');
}

// B2: Jedes C5-Coverage-Gate liegt unter der kritischen Schwelle; Runway ist ebenfalls kritisch.
assert(CONFIG.THRESHOLDS.STRATEGY.runwayGuardrailActivationPct < CONFIG.THRESHOLDS.STRATEGY.runwayCoverageMinPct,
    '69 % Aktivierung liegt unter 75 % kritischer Deckung; Normalzweig bleibt unerreichbar');

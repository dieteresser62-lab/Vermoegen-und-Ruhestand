// Kaufzeilen je Person: Der geführte Kauf teilt die Käufe aus dem Jahresbeleg so auf wie die Haushaltsrechnung, also nach den
// persönlichen Nettoquellen. Nur erfundene Beträge und Beispielhaushalte.
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { annualBuyLines } from '../app/tranches/buy-flow-model.js';
import { capitalGainsTaxRate } from '../engine/tax-settlement.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPersonalUses, assertAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';

const cents = value => Math.round(value * 100) / 100;
const BUY_KEYS = { gold: 'gold', aktien: 'equity', bonds: 'bonds', geldmarkt: 'money_market' };
const gainForTax = tax => tax / capitalGainsTaxRate(0);
const profile = (profileId, { gain = 0, cash = 0 } = {}) => ({ profileId, hasExplicitTrancheOverride: true,
    inputs: { tagesgeld: cash, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 },
    tranches: [{ trancheId: 'bond', category: 'bonds', type: 'anleihe', marketValue: 10000, costBasis: 10000 - gain, tqf: 0 }] });
const sale = (profileId, gain, brutto = 10000) => ({ sourceProfileId: profileId, trancheId: `${profileId}:bond`, kind: 'anleihe',
    category: 'bonds', brutto, realizedGainSigned: gain, taxableAfterTqfSigned: gain });
const linesText = lines => lines.map(line => `${line.profileId}:${line.assetClass}:${line.amount}`).join(', ');
/** Kaufzeilen aus dem gespeicherten Beleg (JSON wie im Jahresbeleg) gegen die persönlichen Verwendungen der Haushaltsrechnung. */
function expectSameAsHousehold(result, ids, label) {
    const lines = annualBuyLines(JSON.parse(JSON.stringify(result.finalAction)), ids);
    const expected = result.profileActions.flatMap(({ profileId, action }) => Object.entries(BUY_KEYS)
        .map(([key, assetClass]) => ({ profileId, assetClass, amount: cents(action.verwendungen[key] || 0) }))
        .filter(line => line.amount > 0.5));
    const sortKey = line => `${ids.indexOf(line.profileId)}:${line.assetClass}`;
    assertEqual(linesText([...lines].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))),
        linesText([...expected].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))), `${label}: Kaufzeilen = persönliche Käufe der Haushaltsrechnung`);
    return lines;
}

// Sollfall: A verkauft brutto 10.000 €, Steuer 1.000 €, netto 9.000 €; B verkauft brutto und netto 10.000 €; Gold für 19.000 €.
{
    const profiles = [profile('a', { gain: gainForTax(1000) }), profile('b')];
    const householdAction = { type: 'TRANSACTION', nettoErlös: 19000, steuer: 1000,
        quellen: [sale('a', gainForTax(1000)), sale('b', 0)], verwendungen: { liquiditaet: 0, gold: 19000, aktien: 0, geldmarkt: 0 } };
    const result = attributeHouseholdAction({ profiles, householdAction, mode: 'tax_optimized' });
    const byId = Object.fromEntries(result.finalAction.quellen.map(source => [source.sourceProfileId, source]));
    assertClose(byId.a.steuer, 1000, 1e-6, 'Sollfall: A zahlt 1.000 € Steuer');
    assertClose(byId.a.netto, 9000, 1e-6, 'Sollfall: A setzt netto 9.000 € ein');
    assertClose(byId.b.netto, 10000, 1e-6, 'Sollfall: B setzt netto 10.000 € ein');
    const personal = Object.fromEntries(result.profileActions.map(row => [row.profileId, cents(row.action.verwendungen.gold)]));
    assertEqual(`${personal.a}/${personal.b}`, '9000/10000', 'Haushaltsrechnung: A kauft Gold für 9.000 €, B für 10.000 €');
    const lines = expectSameAsHousehold(result, ['a', 'b'], 'Sollfall');
    assertEqual(linesText(lines), 'a:gold:9000, b:gold:10000', 'Kaufzeilen: A 9.000 €, B 10.000 € (nicht 9.500/9.500 nach Brutto)');
}

// Tagesgeld auffüllen geht je Person vor den Käufen ab, in allen drei Aufteilungsarten; Centreste wie in der Haushaltsrechnung.
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    const profiles = [profile('a', { gain: gainForTax(1000) }), profile('b')];
    const householdAction = { type: 'TRANSACTION', nettoErlös: 19000, steuer: 1000, quellen: [sale('a', gainForTax(1000)), sale('b', 0)],
        verwendungen: { liquiditaet: 4000, gold: 9000.01, aktien: 5999.99, geldmarkt: 0 } };
    const result = attributeHouseholdAction({ profiles, householdAction, mode });
    const lines = expectSameAsHousehold(result, ['a', 'b'], `Auffüllen/${mode}`);
    for (const assetClass of ['gold', 'equity']) {
        const key = assetClass === 'gold' ? 'gold' : 'aktien';
        assertClose(lines.filter(line => line.assetClass === assetClass).reduce((sum, line) => sum + line.amount, 0),
            cents(result.finalAction.verwendungen[key]), 1e-9, `Auffüllen/${mode}: ${assetClass} je Person ergibt centgenau den Haushaltskauf`);
    }
    const ownCash = result.profileActions.map(row => row.action.verwendungen.liquiditaet);
    assert(ownCash.every(amount => amount > 0), `Auffüllen/${mode}: beide Personen tragen einen Teil des Auffüllens`);
}

// Tagesgeld der einen und Verkauf der anderen Person: Tagesgeld zählt mit seinem Betrag, der Verkauf netto.
{
    const profiles = [profile('a', { cash: 20000 }), profile('b', { gain: gainForTax(500) })];
    const householdAction = { type: 'TRANSACTION', nettoErlös: 14500, steuer: 500,
        quellen: [{ sourceProfileId: 'a', kind: 'liquiditaet', brutto: 5000, netto: 5000, steuer: 0 }, sale('b', gainForTax(500))],
        verwendungen: { liquiditaet: 0, gold: 0, aktien: 14500, geldmarkt: 0 } };
    expectSameAsHousehold(attributeHouseholdAction({ profiles, householdAction, mode: 'tax_optimized' }), ['a', 'b'], 'Tagesgeld und Verkauf');
}

// Altbeleg: Quellen ohne Person zählen für die erste Person, Quellen ohne Netto mit Brutto abzüglich Steuer.
{
    const old = { verwendungen: { liquiditaet: 0, gold: 19000 }, quellen: [{ kind: 'anleihe', brutto: 10000, steuer: 1000 },
        { sourceProfileId: 'b', kind: 'anleihe', brutto: 10000 }] };
    assertEqual(linesText(annualBuyLines(old, ['a', 'b'])), 'a:gold:9000, b:gold:10000', 'Altbeleg: fehlende Person und fehlendes Netto');
    assertEqual(linesText(annualBuyLines({ verwendungen: { aktien: 1200 }, quellen: [] }, ['a', 'b'])), 'a:equity:1200',
        'Ohne Quellen zahlt die erste Person');
    assertEqual(annualBuyLines({ verwendungen: { liquiditaet: 5000 }, quellen: [sale('a', 0)] }, ['a', 'b']).length, 0, 'Nur Auffüllen: keine Kaufzeile');
}

// Messung an Beispielhaushalten (Testdatum 23.10.2026, Planjahr 2026): unveränderte Kaufzeilen.
for (const [id, variant, expected] of [['max-erika', 'grund', ''], ['max-erika', 'teilweise', ''],
    ['martin-petra', 'grund', 'muster_martin:equity:100000, muster_petra:equity:22000']]) {
    const records = createMusterHaushaltRecords('2026-10-23', id, variant);
    const ids = Object.keys(JSON.parse(records.rs_profiles_v1).profiles);
    const entry = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries).find(row => row.year === 2026);
    assertEqual(linesText(annualBuyLines(entry.adopted.action, ids)), expected, `${id}/${variant}: Kaufzeilen je Person unverändert`);
}

// Gegenfall mit Verrechnung gegenläufiger Aufträge (FR-63): A verkauft Aktien, B Anleihen, je 10.000 €; der Plan kauft je 10.000 €
// Aktien und Anleihen. Nach der Verrechnung kauft A nur Anleihen und B nur Aktien, je 5.000 €. Der Beleg trägt diese Verwendungen.
{
    const holder = (profileId, tranche) => ({ profileId, hasExplicitTrancheOverride: true,
        inputs: { tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 }, tranches: [tranche] });
    const profiles = [holder('a', { trancheId: 'etf', category: 'equity', type: 'aktien_neu', marketValue: 10000, costBasis: 10000, tqf: 0.3 }),
        holder('b', { trancheId: 'bond', category: 'bonds', type: 'anleihe', marketValue: 10000, costBasis: 10000, tqf: 0 })];
    const householdAction = { type: 'TRANSACTION', nettoErlös: 20000, steuer: 0,
        quellen: [{ sourceProfileId: 'a', trancheId: 'a:etf', kind: 'aktien_neu', category: 'equity', brutto: 10000, realizedGainSigned: 0, taxableAfterTqfSigned: 0, tqf: 0.3 },
            { sourceProfileId: 'b', trancheId: 'b:bond', kind: 'anleihe', category: 'bonds', brutto: 10000, realizedGainSigned: 0, taxableAfterTqfSigned: 0 }],
        verwendungen: { liquiditaet: 0, gold: 0, aktien: 10000, geldmarkt: 0, bonds: 10000 } };
    const result = attributeHouseholdAction({ profiles, householdAction, mode: 'tax_optimized' });
    const runs = result.profileActions.map(row => ({ profileId: row.profileId, ui: { action: row.action } }));
    const action = { ...JSON.parse(JSON.stringify(result.finalAction)), personalUses: annualPersonalUses(result.finalAction, runs) };
    assertEqual(JSON.stringify(action.personalUses), JSON.stringify({ a: { bonds: 5000 }, b: { aktien: 5000 } }), 'Beleg: A 5.000 € Anleihen, B 5.000 € Aktien');
    assertEqual(linesText(annualBuyLines(action, ['a', 'b'])), 'a:bonds:5000, b:equity:5000', 'Kaufzeilen folgen den verrechneten persönlichen Käufen');
    const fallback = annualBuyLines(JSON.parse(JSON.stringify(result.finalAction)), ['a', 'b']);
    assertEqual(fallback.reduce((sum, line) => sum + line.amount, 0), 10000, 'Altbeleg ohne Feld: Rückfall verteilt weiter die Haushaltskäufe');
    assertEqual(annualPersonalUses({ verwendungen: { liquiditaet: 5000 } }, runs), null, 'Ohne Kauf im Plan kein Feld');
    assertEqual(annualPersonalUses(result.finalAction, runs.slice(0, 1)), null, 'Einzelrechnung ohne Feld');
    const records = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'grund');
    const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(record.entries)[0];
    assertEqual(JSON.stringify(entry.adopted.action.personalUses), JSON.stringify({ muster_martin: { aktien: 100000 }, muster_petra: { aktien: 22000 } }),
        'Jahresbeleg Martin und Petra trägt die persönlichen Käufe');
    assert(assertAnnualPlanRecord(record), 'Beleg mit persönlichen Verwendungen ist gültig');
    // Widersprüchliche Felder: Validator und Import lehnen ab, die Anzeige nimmt den gekennzeichneten Rückfall, nie eine fremde Kennung.
    const ids = ['muster_martin', 'muster_petra'];
    for (const [label, personalUses] of [['leeres Feld', {}], ['nur Martin', { muster_martin: { aktien: 100000 } }],
        ['Summe 222.000 €', { muster_martin: { aktien: 200000 }, muster_petra: { aktien: 22000 } }], ['fremde Kennung', { fremd: { aktien: 999999 } }],
        ['fremde Kennung zusätzlich', { muster_martin: { aktien: 100000 }, muster_petra: { aktien: 22000 }, fremd: { aktien: 0.5 } }],
        ['negativ', { muster_martin: { aktien: -1 } }]]) {
        const broken = structuredClone(record), brokenEntry = Object.values(broken.entries)[0];
        brokenEntry.adopted.action.personalUses = personalUses;
        let rejected = false; try { assertAnnualPlanRecord(broken); } catch { rejected = true; }
        assert(rejected, `${label}: Jahresbeleg wird abgewiesen`);
        assert(!validatePersistenceDomainRecords({ ...records, [ANNUAL_PLAN_RECORD_KEY]: JSON.stringify(broken) }).ok, `${label}: Import lehnt ab`);
        assertEqual(linesText(annualBuyLines(brokenEntry.adopted.action, ids)), 'muster_martin:equity:100000, muster_petra:equity:22000', `${label}: Anzeige nutzt den Rückfall`);
    }
    const rounded = structuredClone(record), roundedEntry = Object.values(rounded.entries)[0];
    roundedEntry.adopted.action.personalUses = { muster_martin: { aktien: 100000.6 }, muster_petra: { aktien: 21999.7 } };
    assert(assertAnnualPlanRecord(rounded), 'Rundung innerhalb ±1 € bleibt gültig');
}

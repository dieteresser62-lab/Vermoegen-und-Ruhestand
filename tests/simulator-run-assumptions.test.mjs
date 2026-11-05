import { createRunAssumptions, effectiveRunAssumptions } from '../app/simulator/simulator-run-assumptions.js';
const heads = createRunAssumptions();
const base = { startVermoegen: 100, minimumFlexAnnual: 0, stressPreset: 'NONE', tailRiskEnabled: false };
const bt = effectiveRunAssumptions('backtest', base, { startYear: 2000, endYear: 2025 });
const mc = effectiveRunAssumptions('montecarlo', base, { methode: 'block', anzahl: 100, maxDauer: 30 });
heads.observe('backtest', bt); heads.observe('montecarlo', mc);
const btToken = heads.begin('backtest', bt); heads.complete('backtest', btToken, 'BT');
const mcToken = heads.begin('montecarlo', mc); heads.complete('montecarlo', mcToken, 'MC');
assert(!heads.read('backtest').stale && !heads.read('montecarlo').stale, 'Separate Backtest-/MC-Snapshots starten aktuell');
heads.observe('backtest', effectiveRunAssumptions('backtest', { ...base, logDetails: true }, { endYear: 2025, startYear: 2000 }));
assert(!heads.read('backtest').stale, 'Reine UI-Änderung und Objektschlüsselreihenfolge ändern keine Annahmen');
const inactive = { ...base, pflegefallLogikAktivieren: false, pflegeMinDauer: 5,
    partner: { aktiv: false, monatsrente: 100 }, accumulationPhase: { enabled: false, sparrate: 500 } };
assertEqual(JSON.stringify(effectiveRunAssumptions('backtest', inactive, bt.settings)),
    JSON.stringify(effectiveRunAssumptions('backtest', { ...inactive, pflegeMinDauer: 10,
        partner: { aktiv: false, monatsrente: 900 }, accumulationPhase: { enabled: false, sparrate: 999 } }, bt.settings)),
    'Nicht aktive Pflege-, Partner- und Ansparparameter erzeugen keine wirksame Revision');
assertEqual(JSON.stringify(effectiveRunAssumptions('backtest', { ...base, marketCapeRatio: 1 }, bt.settings)),
    JSON.stringify(effectiveRunAssumptions('backtest', { ...base, marketCapeRatio: 99, tailRiskEnabled: true }, bt.settings)),
    'Historische Daten ersetzen CAPE; zusätzliche MC-Tail-Risk-Auswahl betrifft nicht den Backtest');
heads.observe('montecarlo', effectiveRunAssumptions('montecarlo', { ...base, stressPreset: 'CRASH' }, mc.settings));
assert(heads.read('montecarlo').stale && !heads.read('backtest').stale, 'Stressänderung betrifft MC getrennt vom Backtest');
heads.observe('montecarlo', effectiveRunAssumptions('montecarlo', { ...base, tailRiskEnabled: true }, mc.settings));
assert(heads.read('montecarlo').stale, 'Tail-Risk wird für MC berücksichtigt');
heads.observe('montecarlo', mc);
assert(!heads.read('montecarlo').stale, 'Zurückgesetzte wirksame Annahmen entfernen den Hinweis');
const changed = effectiveRunAssumptions('backtest', { ...base, minimumFlexAnnual: 5 }, bt.settings);
heads.observe('backtest', changed);
assert(heads.read('backtest').stale, 'Echt geänderte genaue Werte markieren Backtest veraltet');
assert(heads.claimBacktestRevision(), 'Neue wirksame Backtestrevision wird einmal beansprucht');
assert(!heads.claimBacktestRevision(), 'Mehrfaches Ergebnisanzeigen beansprucht keine zweite Rechnung');
const during = heads.begin('backtest', changed);
heads.observe('backtest', bt);
heads.complete('backtest', during, 'neuer BT');
assert(heads.read('backtest').stale, 'Änderung während Lauf erzeugt keinen fälschlich aktuellen Laufkopf');
assert(heads.claimBacktestRevision(), 'Änderung während Lauf erhält eine neue offene Revision');
heads.phase('backtest', 'preparing');
assert(!heads.claimBacktestRevision(), 'Vorbereitung verhindert parallelen Backtest');
const replacement = heads.begin('montecarlo', mc);
assertEqual(heads.read('montecarlo').last.result, 'MC', 'Laufender Ersatz bewahrt letztes erfolgreiches MC-Ergebnis');
heads.fail('montecarlo');
assertEqual(heads.read('montecarlo').last.result, 'MC', 'Fehlgeschlagener Ersatz bewahrt letztes erfolgreiches MC-Ergebnis');
assert(!heads.complete('montecarlo', replacement, 'spät'), 'Verspätete Antwort ersetzt kein Ergebnis');
heads.fail('montecarlo', 'cancelled');
assertEqual(heads.read('montecarlo').last.result, 'MC', 'Abgebrochener Ersatz bewahrt letztes erfolgreiches MC-Ergebnis');
const mutable = { nested: { value: 1 } };
heads.observe('montecarlo', mutable); const copied = heads.begin('montecarlo', mutable); mutable.nested.value = 2;
heads.complete('montecarlo', copied, 'copy');
assertEqual(heads.read('montecarlo').last.values.nested.value, 1, 'Laufkopf hält genaue strukturierte Werte statt mutable Eingabereferenz');

for (const phase of ['invalid', 'missing', 'technical_error']) {
    const retry = createRunAssumptions();
    retry.observe('backtest', bt);
    retry.fail('backtest', phase);
    assert(!retry.claimBacktestRevision(), `${phase}: fehlgeschlagene Revision wird nicht wiederholt`);
    retry.observe('backtest', changed);
    assert(retry.claimBacktestRevision(), `${phase}: korrigierte wirksame Annahmen erlauben eine neue Revision`);
    assert(!retry.claimBacktestRevision(), `${phase}: auch die neue Revision startet nur einmal`);
}

{
    const { bindPersonDataContext } = await import('../app/simulator/simulator-person-overrides.js');
    const draft = { schemaVersion: 1, referenceYear: 2027, ageRule: 'january-1-completed-years', deviationApplied: true,
        persons: [{ profileId: 'a', role: 'primary', changes: [{ field: 'profile_rente_monatlich', profileValue: 1000, effectiveValue: 2000 }] }] };
    const inputs = bindPersonDataContext({ ...base }, draft);
    const ledger = createRunAssumptions();
    const values = effectiveRunAssumptions('montecarlo', inputs, mc.settings);
    ledger.observe('montecarlo', values);
    const first = ledger.begin('montecarlo', values); ledger.complete('montecarlo', first, 'alternative');
    draft.persons[0].changes[0].effectiveValue = 9999;
    ledger.observe('montecarlo', mc);
    assert(ledger.read('montecarlo').stale, 'Ausschalten markiert das vorhandene abweichende Ergebnis veraltet');
    assertEqual(ledger.read('montecarlo').last.values.personDataContext.persons[0].changes[0].effectiveValue, 2000, 'Entwurfsänderung und Ausschalten verändern keinen Laufbeleg');
    const cancelled = ledger.begin('montecarlo', mc); ledger.fail('montecarlo', 'cancelled');
    assert(!ledger.complete('montecarlo', cancelled, 'spät'), 'Verspäteter Abbruchlauf überschreibt keinen gebundenen Kontext');
    assert(ledger.read('montecarlo').last.values.personDataContext.deviationApplied, 'Abbruch erhält den bisherigen Ergebnisbeleg');
    const second = ledger.begin('montecarlo', mc); ledger.complete('montecarlo', second, 'regulär');
    assert(!ledger.read('montecarlo').last.values.personDataContext, 'Neues reguläres Ergebnis besitzt keinen falschen Abweichungshinweis');
}

// Vorbereitung wird nur vom tatsächlichen Kontextwechsel entwertet, nicht von normalen Beobachtungen.
{
    const ledger = createRunAssumptions();
    ledger.observe('backtest', bt);
    const contextRevision = ledger.read('backtest').contextRevision;
    ledger.observe('backtest', changed);
    assertEqual(ledger.read('backtest').contextRevision, contextRevision, 'Gewöhnliche Annahmenrevision entwertet keinen vorbereitenden Start');
    assert(ledger.replaceContext('backtest', { ...changed, household: ['a', 'b'] }), 'Tatsächlicher Kontextwechsel meldet neue Bindung');
    assertEqual(ledger.read('backtest').contextRevision, contextRevision + 1, 'Nur Haushaltswechsel erhöht die vorbereitende Kontextrevision');
    assert(!ledger.replaceContext('backtest', { ...changed, household: ['a', 'b'] }), 'Unwirksame Kontextwiederholung bleibt idempotent');
}

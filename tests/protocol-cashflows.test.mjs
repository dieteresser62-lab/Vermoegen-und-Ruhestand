import { protocolAnnualTotals, protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2, serializeScenarioLogExportV2 } from '../app/simulator/monte-carlo-export.js';
import { captureHistoricalBacktestEngineProvenance, createHistoricalBacktestDownload } from '../app/simulator/historical-backtest-export.js';
import { canonicalizeHistoricalContractValue as canonical } from '../app/simulator/historical-backtest-contract.js';
import { EngineAPI } from '../engine/index.mjs';

const raw = { jahr: 2, recordType: 'financial_year', financiallyEvaluable: true,
    entscheidung: { jahresEntnahme: 0 }, rente1: 8000, rente2: 4000, renteSum: 12000,
    WidowIncomeOffset: 1000, sonstige_einkuenfte: 60000,
    sonstige_einkuenfte_personen: [{ profileId: 'erika', amount: 40000 }, { profileId: 'max', amount: 20000 }],
    zufluss: 10000, zufluss_personen: [{ profileId: 'max', amount: 10000, label: 'Rückzahlung <sicher>' }],
    einkuenfte_gespart: 30000, geplante_ausgaben: 5000, floor_brutto: 36000, floor_aus_depot: 0,
    flex_erfuellt_nominal: 0, flex_haushalt_erfuellt: 6000, pflege_zusatz_floor: 4000, inflation_factor_cum: 1.25, inflation: 0 };
const before = JSON.stringify(raw);
const inputs = { partner: { aktiv: true }, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }],
    plannedExpensesReferenceYear: 2026, plannedExpenses: [
        { monat: '2027-03', betrag: 2400, bezeichnung: 'Auto <neu>' },
        { ab: '2027-05', bis: '2027-08', betragMonat: 500, anpassung: 'keine', bezeichnung: 'Raten' },
        { monat: '2026-03', betrag: 1000, bezeichnung: 'Vorjahr' }
    ] };
const personDisplayContext = { persons: [{ name: 'Max' }, { name: 'Erika' }] };
for (const source of ['mc', 'backtest']) {
    const entry = source === 'mc' ? raw : { jahr: 2001, entscheidung: raw.entscheidung, row: raw, inflationVJ: 0 };
    for (const moneyBasis of ['nominal', 'real']) for (const logDetailLevel of ['normal', 'detailed']) {
        const options = { source, startYear: 2000, inputs, personDisplayContext, moneyBasis, logDetailLevel, rows: [entry] };
        const columns = getProtocolColumns(options), block = columns.filter(column => column.group === 'withdrawal');
        if (logDetailLevel === 'normal') assertEqual(block.map(column => column.label).join(','), 'Einnahmen,Ausgaben', 'Standard hat genau zwei Geldspalten');
        else for (const id of ['withdrawal', 'floor-brutto', 'rente1', 'rente2', 'rentesum', 'widow-income-offset', 'other-income', 'zufluss', 'income-saved', 'planned-expenses', 'income-total', 'expense-total'])
            assert(block.some(column => column.id === id), `${source}: vollständige Einzelspalte ${id}`);
        assertEqual(block.find(column => column.id === 'income-total').extractor(entry), 82000, 'Renten bereits nach Anrechnung; Sparbetrag wird nicht zusätzlich gezählt');
        assertEqual(block.find(column => column.id === 'expense-total').extractor(entry), 47000, 'Effektiver Grundbedarf plus gezahlter Haushalts-Flex plus geplante Ausgaben');
        if (logDetailLevel === 'detailed') for (const id of ['withdrawal', 'jahresentnahme-real']) {
            const column = block.find(column => column.id === id);
            assertEqual(column.label, 'Laufende Entnahme', 'Detailspalte benennt die laufende Entnahme; Kennung bleibt erhalten');
            assertEqual(column.header, 'Laufende Entnahme', 'Sichtbarer Spaltenkopf benennt die laufende Entnahme');
            assertEqual(column.explanation, 'Entnahme aus dem Vermögen für Grundbedarf und Flex; geplante Ausgaben stehen in eigener Spalte',
                'Erklärung grenzt die laufende Entnahme von geplanten Ausgaben ab');
        }
        if (logDetailLevel === 'detailed') assertEqual(block.find(column => column.id === 'withdrawal').exportHeader,
            'Entnahme', 'Bisheriger Name des Anzeigeexports bleibt erhalten');
        if (logDetailLevel === 'detailed') assertEqual(block.find(column => column.id === 'jahresentnahme-real').exportHeader,
            'Entnahme aus Vermögen', 'Bisheriger Exportname der zweiten Entnahmespalte bleibt erhalten');
        const breakdown = protocolCashflowBreakdown(entry, options);
        assertEqual(breakdown.incomes.reduce((sum, item) => sum + item.amount, 0), 82000, 'Einnahmenposten ergeben exakt die Summe');
        assertEqual(breakdown.expenses.reduce((sum, item) => sum + item.amount, 0), 47000, 'Ausgabenposten ergeben exakt die Summe');
        assertEqual(breakdown.expenses.map(item => `${item.label}:${item.amount}`).join('|'),
            'Grundbedarf:32000|Pflege:4000|Flex:6000|Geplante Ausgaben (Auto <neu>):3000|Geplante Ausgaben (Raten):2000', 'Pflege im effektiven Bedarf enthalten; Ausgabenbezeichnungen nach Planjahr und Inflation');
        assertEqual(breakdown.incomes.find(item => item.label === 'Sonstige Einkünfte Erika').amount, 40000, 'Personenbetrag folgt Profilkennung');
        const html = renderProtocolTable([entry], options);
        const infos = [...html.matchAll(/<span class="ds-info-pop" role="tooltip">([\s\S]*?)<\/span><\/span>/g)];
        assert(infos.length >= 2, 'Beide Summenzellen verwenden den vorhandenen Info-Baustein');
        for (const id of ['income-total', 'expense-total']) {
            const column = columns.find(column => column.id === id), value = column.extractor(entry);
            const formatted = column.valueFormatter(value, entry);
            assert(html.includes(`>${formatted}<span class="ds-info">`), 'Zellwert folgt dem Euro-Schalter');
            assert(html.includes(`<span>Summe</span><span>${formatted}</span>`), 'Letzte Summenzeile ist gleich dem Zellwert');
        }
        assert(html.includes('Rückzahlung &lt;sicher&gt;') && html.includes('Auto &lt;neu&gt;') && !html.includes('<neu>'), 'Postenbezeichnungen sind textgesichert');
        assert(html.indexOf('protocol-cashflow-saved') > html.indexOf('protocol-cashflow-sum'), 'davon angelegt steht getrennt unter der Summe');
        assert(html.indexOf('protocol-cashflow-withdrawal') > html.lastIndexOf('protocol-cashflow-sum'), 'Vermögensentnahme steht getrennt nach der Ausgabensumme');
        const expenseColumn = columns.find(column => column.id === 'expense-total');
        assert(html.includes(`<span>davon aus dem Vermögen bezahlt</span><span>${expenseColumn.valueFormatter(5000, entry)}</span>`),
            'Geplante Ausgaben zählen auch ohne laufende Entnahme zum Vermögensanteil und folgen der Euro-Basis');
    }
}
// Kohärente Jahresdaten: Einkommen deckt nur den Floor, zusätzlich Flex oder den
// gesamten Verbrauch. Einmalige Einkünfte fließen stets vollständig ins Vermögen.
for (const [income, saved, withdrawal, portfolioFlex] of [
    [6000, 0, 24000, 6000], [27000, 0, 3000, 3000], [60000, 30000, 0, 0]
]) {
    const year = { ...raw, sonstige_einkuenfte: income, einkuenfte_gespart: saved,
        flex_erfuellt_nominal: portfolioFlex, entscheidung: { jahresEntnahme: withdrawal } };
    const bytes = JSON.stringify(year), totals = protocolAnnualTotals(year);
    assertEqual(totals.ausgaben_gesamt, 47000, 'Verbrauch bleibt mit und ohne Vermögensentnahme gleich');
    assertEqual(totals.ausgaben_gesamt, year.renteSum + year.sonstige_einkuenfte - year.einkuenfte_gespart
        + protocolCashflowBreakdown(year).withdrawal, 'Ausgaben = Renten + sonstige Einkünfte − davon angelegt + davon aus dem Vermögen bezahlt');
    assertEqual(protocolCashflowBreakdown(year).expenses.reduce((sum, item) => sum + item.amount, 0), totals.ausgaben_gesamt,
        'Aufschlüsselung zählt die Vermögensentnahme nicht zusätzlich');
    assertEqual(protocolAnnualTotals({ ...year, zufluss: 999999 }).ausgaben_gesamt, totals.ausgaben_gesamt,
        'Einmalige Einkünfte erhöhen den Verbrauch nicht');
    assertEqual(JSON.stringify(year), bytes, 'Rechenergebnis bleibt bytegleich');
}
for (const [pension, income, saved, annualWithdrawal, planned] of [
    [24000, 12000, 0, 0, 25000], // Astras Beispiel: 36.000 € laufende Einnahmen und Bedarf, 25.000 € Auto.
    [24000, 24000, 12000, 0, 25000], // Überschuss wird vor der geplanten Zahlung als angelegt gebucht.
    [18000, 6000, 0, 12000, 0] // Ohne geplante Ausgabe bleibt der bisherige Vermögensanteil erhalten.
]) {
    const year = { jahr: 1, entscheidung: { jahresEntnahme: annualWithdrawal }, renteSum: pension,
        sonstige_einkuenfte: income, einkuenfte_gespart: saved, floor_brutto: 24000,
        flex_haushalt_erfuellt: 12000, ...(planned ? { geplante_ausgaben: planned } : {}) };
    const bytes = JSON.stringify(year);
    for (const source of ['mc', 'backtest']) {
        const entry = source === 'mc' ? year : { jahr: 2000, entscheidung: year.entscheidung, row: year };
        const breakdown = protocolCashflowBreakdown(entry, { source });
        assertEqual(breakdown.withdrawal, annualWithdrawal + planned, 'Vermögensanteil enthält die laufende Entnahme und die geplante Ausgabe');
        assertEqual(breakdown.totals.ausgaben_gesamt, pension + income - saved + breakdown.withdrawal,
            'Kontrollidentität gilt für ausgeglichene Einnahmen, Überschuss und laufende Entnahme');
        assert(renderProtocolTable([entry], { source }).includes(`<span>davon aus dem Vermögen bezahlt</span><span>${planned ? '25.000' : '12.000'}\u00a0€</span>`),
            'Ausgaben-Info zeigt den bezahlten Vermögensanteil');
        if (!planned) assertEqual(JSON.stringify(breakdown.withdrawal), JSON.stringify(annualWithdrawal),
            'Ohne geplante Ausgabe bleibt der Zahlenwert bytegleich');
    }
    assertEqual(JSON.stringify(year), bytes, 'Anzeige lässt sämtliche Jahresdaten bytegleich');
}
const reduced = { ...raw, flex_haushalt_erfuellt: 1200, flex_brutto_haushalt: 6000 };
assertEqual(protocolAnnualTotals(reduced).ausgaben_gesamt, 42200, 'Nur tatsächlich gezahlter Flex zählt, nicht der Wunsch');
const oldRow = { ...raw, flex_haushalt_erfuellt: undefined, flex_erfuellt_nominal: 2000, flex_rentenueberschuss: 4000 };
assertEqual(protocolAnnualTotals(oldRow).ausgaben_gesamt, 47000, 'Ältere Jahresdaten verwenden vorhandene gezahlte Flexanteile');
const zero = { entscheidung: { jahresEntnahme: 0 }, renteSum: 0, rente1: 0, rente2: 0 };
const empty = protocolCashflowBreakdown(zero);
assertEqual(empty.incomes.length + empty.expenses.length, 0, 'Nullposten bleiben in der Aufschlüsselung verborgen');
assert(!renderProtocolTable([zero]).includes('protocol-cashflow-saved'), 'Ohne Überschuss keine davon-angelegt-Zeile');
assertEqual(protocolAnnualTotals({ ...raw, renteSum: 0, rente1: 8000, rente2: 4000 }).einnahmen_gesamt, 70000, 'Nullsumme wird nicht aus alten Personenwerten ersetzt');
assertEqual(protocolAnnualTotals({ recordType: 'terminal_ruin' }).ausgaben_gesamt, null, 'Terminalrecord erhält keine erfundene Zahlung');
assertEqual(protocolCashflowBreakdown({ ...raw, sonstige_einkuenfte: -100, sonstige_einkuenfte_personen: [] }).incomes.find(item => item.label === 'Sonstige Einkünfte').amount, -100, 'Auch negative Nichtnullposten bleiben sichtbar');

const scenario = projectScenarioLogV2([raw]);
const record = JSON.parse(serializeScenarioLogExportV2(scenario)).records[0];
assertEqual(record.einnahmen_gesamt, 82000, 'Szenario-Log v2 JSON: einnahmen_gesamt');
assertEqual(record.ausgaben_gesamt, 47000, 'Szenario-Log v2 JSON: ausgaben_gesamt');
const checkCsv = csv => {
    const heads = csv.split(/\r?\n/)[0].split(';');
    assertEqual(heads.slice(-2).join(';'), 'Einnahmen;Ausgaben', 'CSV ergänzt Einnahmen und Ausgaben nach den bisherigen Spalten');
    assert(csv.split(/\r?\n/)[1].endsWith(';82000;47000'), 'CSV enthält nominale ungerundete Summen');
};
checkCsv(serializeScenarioLogCsvV2(scenario));
const result = { schemaVersion: 'BacktestRunResultV1', outcome: { kind: 'completed' }, completedYears: 1,
    request: { startYear: 2000, endYear: 2000, inputs, engine: captureHistoricalBacktestEngineProvenance(EngineAPI,
        { schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40), sourceTreeStatus: 'clean', provider: 'synthetic_fixture' }) },
    rows: [{ jahr: 2000, row: raw, entscheidung: raw.entscheidung }] };
const bytes = JSON.stringify(result);
const btJson = JSON.parse(createHistoricalBacktestDownload(result, 'json').content).result.rows[0].row;
assertEqual(btJson.einnahmen_gesamt, 82000, 'Backtest JSON: result.rows[].row.einnahmen_gesamt');
assertEqual(btJson.ausgaben_gesamt, 47000, 'Backtest JSON: result.rows[].row.ausgaben_gesamt');
for (const [key, value] of Object.entries(raw)) assertEqual(canonical(btJson[key]), canonical(value), `Bisheriges Backtest-Rohfeld unverändert: ${key}`);
checkCsv(createHistoricalBacktestDownload(result, 'csv').content);
assertEqual(JSON.stringify(result), bytes, 'Download verändert das Backtestergebnis nicht');
assertEqual(JSON.stringify(raw), before, 'Anzeige und Exporte verändern keine Rechenergebnisbytes');

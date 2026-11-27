// NK-2 Punkte 7 und 8 (FR-84): Protokoll und Kennzahlen. „Warum Heim“ auch im ersten Simulationsjahr (gegen den Anfangszustand);
// Hilfe zur Pflege in Jahres- und Personenzeile gleich; Einnahmen, Entnahme und Hilfe ergeben in Jahren mit Hilfe die Ausgaben;
// Kartentexte stimmen; der Rückfallverkauf bucht keine Pflege auf das Geld der anderen Person. Beispielhaushalte, Testdatum 15.11.2026.
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { sollfallARecords } from './helpers/nk-1-sollfall.mjs';
import { couple, lot, yearWithCare, A, B } from './helpers/nk-1b-cases.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { protocolResidentialEntry } from '../app/simulator/protocol-columns.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { buildKpiDashboard } from '../app/simulator/results-metrics.js';
import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { EngineAPI } from '../engine/index.mjs';

const DATE = '2026-11-15';
const chunkOf = (inputs, start, count, maxDauer) => runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 1000, maxDauer },
    widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count }, logIndices: Array.from({ length: count }, (_, i) => start + i) });

// Warum Heim im ersten Jahr: Max und Erika, Staffel mit Heim ab Grad 2, Startwert 12345, Lauf 22. Max kommt im ersten Jahr ins Heim.
{
    const inputs = await measurementInputs(0, 'max-erika', DATE, 'grund');
    for (const grade of [2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade] = { ...inputs.pflegeGradeConfigs[grade], careForm: 'residential' };
    const rows = (await chunkOf(inputs, 22, 1, 2)).runMeta[0].logDataRows;
    assertEqual(`${parameters.seed} · ${rows[0].CareP1_Form}`, '12345 · residential', 'Warum Heim: Lauf 22 beginnt mit Heimeintritt im ersten Jahr');
    assertEqual(protocolResidentialEntry(rows[0], 0, { source: 'mc', inputs, rows }), 'Heim laut Staffel', 'Warum Heim: Grund im ersten Jahr gegen den Anfangszustand');
    assertEqual(protocolResidentialEntry(rows[1], 0, { source: 'mc', inputs, rows }), null, 'Warum Heim: im Folgejahr kein Wechsel');
}
// Gegenprobe: Werner lebt heute schon im Heim (unverheiratet). Im ersten Jahr ist das kein Wechsel.
{
    const records = recordsIn => {
        const registry = JSON.parse(recordsIn.rs_profiles_v1), data = registry.profiles.muster_werner.data;
        Object.assign(data, { profile_care_grade_today: '4', profile_care_form_today: 'residential', profile_care_residential_since: '2023-01' });
        recordsIn.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(recordsIn, registry.profiles[recordsIn.rs_current_profile].data);
        recordsIn[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { muster_helga: 0, muster_werner: 0 } });
        return recordsIn;
    };
    const inputs = await measurementInputs(0, 'helga-werner', DATE, 'grund', records);
    const rows = (await chunkOf(inputs, 0, 1, 2)).runMeta[0].logDataRows;
    assertEqual(`${rows[0].CareP2_Form} · ${protocolResidentialEntry(rows[0], 1, { source: 'mc', inputs, rows })}`, 'residential · null',
        'Warum Heim Gegenprobe: heute schon im Heim, kein Grund im ersten Jahr');
}

// Jahre mit Hilfe: Sollfall A (unverheiratet, Petra im Heim) und Max und Erika verheiratet mit wenig Geld (Erika Grad 4 im Heim).
{
    const married = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        const patch = { muster_a: { profile_tagesgeld: '20000', depot_tranchen: '[]' },
            muster_b: { profile_tagesgeld: '20000', depot_tranchen: '[]', profile_care_grade_today: '4', profile_care_form_today: 'residential' } };
        for (const [id, values] of Object.entries(patch)) Object.assign(registry.profiles[id].data, values);
        records.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(records, registry.profiles[records.rs_current_profile].data);
        return records;
    };
    for (const [label, household, variant, transform] of [['Sollfall A', 'martin-petra', 'traegt', sollfallARecords], ['Max und Erika knapp', 'max-erika', 'grund', married]]) {
        const inputs = await measurementInputs(0, household, DATE, variant, transform);
        const chunk = await chunkOf(inputs, 0, 40, 20);
        const rows = chunk.runMeta.flatMap(run => run.logDataRows).filter(row => row.hilfe_zur_pflege > 0 && !row.ruin_reason);
        assert(rows.length > 10, `${label}: Jahre mit Hilfe (${rows.length})`);
        const persons = rows.filter(row => row.hilfe_zur_pflege_personen
            && Math.abs(row.hilfe_zur_pflege_personen.reduce((sum, item) => sum + item.amount, 0) - row.hilfe_zur_pflege) > 0.01);
        assertEqual(persons.length, 0, `${label}: Hilfe in Jahres- und Personenzeile gleich`);
        const open = rows.filter(row => { const b = protocolCashflowBreakdown(row, { source: 'mc', inputs });
            return Math.abs(b.totals.ausgaben_gesamt - (b.totals.einnahmen_gesamt - b.saved + b.withdrawal + b.careAid.payout)) > 0.01; });
        assertEqual(open.length, 0, `${label}: Einnahmen, Entnahme und Hilfe ergeben die Ausgaben`);
        // Befund 2143: Die Hilfe-Zeile steht direkt unter „Heimkosten“; deckt sie mehr als die Heimkosten, nennt der Text, wofür.
        // KR-1c-b: Auch Jahre, deren Hilfe nur die Steuer ist (Zinssteuer auf Geld, das samt Zins ins Heim fließt), zeigen dieselbe Zeile.
        const taxOnly = row => row.hilfe_zur_pflege - (row.hilfe_zur_pflege_steuer || 0) < 0.5;
        const inHome = rows.filter(row => row.pflege_heimkosten > 0 && row.hilfe_zur_pflege >= 0.5);
        const lineOf = row => {
            const lines = protocolCashflowBreakdown(row, { source: 'mc', inputs }).expenses, at = lines.findIndex(item => /Hilfe zur Pflege/.test(item.label));
            return { at, line: lines[at], above: lines[at - 1] };
        };
        const misplaced = inHome.filter(row => {
            const { at, line, above } = lineOf(row);
            return at < 1 || above.label !== 'Heimkosten' || (line.amount > above.amount + 0.5 && line.label.startsWith('davon'));
        });
        assertEqual(misplaced.length, 0, `${label}: „Hilfe zur Pflege“ unter „Heimkosten“, eindeutiger Text (${inHome.length} Jahre)`);
        const taxYears = inHome.filter(taxOnly);
        const taxLines = taxYears.map(row => ({ row, ...lineOf(row) })).filter(({ row, line }) => line?.label === 'davon Hilfe zur Pflege (zahlt der Staat)'
            && Math.abs(line.amount - row.hilfe_zur_pflege_steuer) <= 0.01);
        assertEqual(`${taxLines.length} von ${taxYears.length}`, `${taxYears.length} von ${taxYears.length}`, `${label}: Jahre nur mit Steuerhilfe zeigen dieselbe Hilfe-Zeile`);
        assert(taxYears.length > 0, `${label}: ${taxYears.length} von ${inHome.length} Heimjahren mit Hilfe nur aus der Steuer`);
        const html = renderProtocolTable([taxYears[0]], { source: 'mc', inputs });
        assert(html.includes('davon Hilfe zur Pflege (zahlt der Staat)') && html.includes('Steuer aus Verkäufen oder Zinsen für die Pflege'),
            `${label}: Protokoll-ⓘ zeigt die Steuerhilfe in der Hilfe-Zeile`);
        const card = buildKpiDashboard({ careAid: { runCount: 2, runSharePct: 5, firstYearMedian: 3, sumMedianNominalEur: 1000 } }).detailSections
            .flatMap(section => section.kpis).find(kpi => kpi.title === 'Läufe mit Hilfe zur Pflege');
        assert(/Nur über diese Läufe/.test(card.description) && /Pflegeanteil der Steuer/.test(card.description) && !/Kein Ruin/.test(card.description),
            'Kartentext: Median nur über Läufe mit Hilfe, Steueranteil genannt, kein falsches „Kein Ruin“');
    }
}

// Punkt 8: B kann ihre Pflege nicht zahlen, A hat nur Wertpapiere. A verkauft nur für den Grundbedarf (und seine Liquiditätsreserve), nie
// für Bs Pflege; die Pflege ist Hilfe. Der Rückfallverkauf deckt nur den nachgerechneten Grundbedarf ohne Pflege (basicShort).
{
    for (const mode of ['proportional', `one_carries:${A}`]) {
        const result = yearWithCare(couple({ mode, cash: [0, 0], lots: [lot(A, 100000, 100000, 'equity')] }), 20000);
        const paidA = result.logData.personalPayout.items.find(item => item.profileId === A).amount;
        assertEqual(`${result.kind} · ${paidA} · ${result.logData.hilfe_zur_pflege}`, 'success · 12000 · 20000', `Punkt 8 (${mode}): A zahlt nur den Grundbedarf, Bs Pflege ist Hilfe`);
        assert(!result.logData.personalPayout.fallback, `Punkt 8 (${mode}): kein Rückfallverkauf für Pflege`);
    }
}

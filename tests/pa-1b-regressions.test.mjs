import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { inheritanceTaxRate } from '../app/profile/household-partnership.js';

// Einzelne Gutachtenpunkte auch gegen den unveränderten Ausgangsstand prüfen.
const selected = process.env.PA1B_CASE;
if (!selected || selected === '1' || selected === '2') {
    const inputs = await measurementInputs(0, 'helga-werner', '2026-10-23', 'haus-pg3');
    inputs.careToday = { grade: 2, form: 'home-support', progression: 'usual' };
    inputs.partner.careToday = { grade: 2, form: 'family', progression: 'much_slower' };
    inputs.pflegeGradeConfigs[2].careForm = 'home-support';
    const params = { anzahl: 48, maxDauer: 35, blockSize: 5, seed: 12345,
        methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: params,
        widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count: params.anzahl },
        logIndices: Array.from({ length: params.anzahl }, (_, index) => index) });
    assertEqual(chunk.technicalInventory.technicalError, 0, 'PA-1b: echte Pflegepfade sind technisch auswertbar');
    const rows = chunk.runMeta.flatMap(meta => meta.logDataRows);
    const before = JSON.stringify(chunk);
    if (!selected || selected === '1') {
        const laterDeath = rows.filter(row => row.Person1Alive === 0 && row.Person2Alive === 1
            && row.CareP2_FamilyFallback?.reason === 'care');
        assert(laterDeath.length > 0, 'PA-1b/1: echte Todesjahre nach früherem Wechsel wegen Partnerpflege vorhanden');
        for (const row of laterDeath) {
            const html = renderProtocolTable([row], { source: 'mc', inputs });
            assert(html.includes('Pflegeform: externe Unterstützung, weil Helga verstorben ist.'),
                'PA-1b/1: aktueller Tod ersetzt den früheren Pflegegrad im Protokollgrund');
            assert(!html.includes('weil Helga selbst Pflegegrad'), 'PA-1b/1: nach Tod kein veralteter Pflegegrund');
        }
    }
    if (!selected || selected === '2') {
        const laterGrade = rows.filter(row => row.Person1Alive === 1 && row.Person2Alive === 1
            && row.CareP2_FamilyFallback?.reason === 'care' && row.CareP1_Grade > row.CareP2_FamilyFallback.grade);
        assert(laterGrade.length > 0, 'PA-1b/2: echte Fortschrittsjahre nach früherem Wechsel vorhanden');
        for (const row of laterGrade) {
            const html = renderProtocolTable([row], { source: 'mc', inputs });
            assert(html.includes(`Pflegeform: externe Unterstützung, weil Helga selbst Pflegegrad ${row.CareP1_Grade} hat.`),
                'PA-1b/2: Protokollgrund nennt den aktuellen Partnergrad');
            assert(!html.includes(`weil Helga selbst Pflegegrad ${row.CareP2_FamilyFallback.grade} hat`),
                'PA-1b/2: früherer Partnergrad wird nicht mehr als aktueller Anlass ausgegeben');
        }
    }
    assertEqual(JSON.stringify(chunk), before, 'PA-1b: Anzeige erhält das vollständige MC-Ergebnis bytegleich');
}

if (!selected || selected === '3') {
    const inputs = await measurementInputs(0, 'helga-werner', '2026-10-23', 'haus-pg3');
    inputs.partner.aktiv = false;
    inputs.careToday = { grade: 2, form: 'home-support' };
    inputs.partner.careToday = { grade: 4, form: 'residential' };
    const result = backtest(inputs, 2000, 2002), before = JSON.stringify(result);
    assertEqual(result.outcome.kind, 'completed', 'PA-1b/3: Einzel-Backtest mit alten Partnerangaben läuft');
    const html = renderProtocolTable(result.rows, { source: 'backtest', inputs });
    assert(html.includes('Helga: kein Pflegegeld'), 'PA-1b/3: Pflegegrund der aktiven Person bleibt sichtbar');
    assert(!html.includes('Werner: kein Pflegegeld') && !html.includes('Person 2: kein Pflegegeld'),
        'PA-1b/3: inaktiver Partner erhält trotz careToday keine Begründungszeile');
    assertEqual(JSON.stringify(result), before, 'PA-1b/3: Anzeige erhält das vollständige Backtestergebnis bytegleich');
    inputs.partner.aktiv = true;
    const couple = backtest(inputs, 2000, 2002);
    assert(renderProtocolTable(couple.rows, { source: 'backtest', inputs }).includes('Werner: kein Pflegegeld'),
        'PA-1b/3: aktiver Partner behält seine Begründungszeile');
}

if (!selected || selected === '4') {
    const warn = console.warn, notes = [];
    console.warn = (...args) => notes.push(args.map(String).join(' '));
    try {
        const invalid = [undefined, NaN, Infinity, -Infinity, null, 'ungültig', '75000', {}, [], true, 1n, Symbol('Probe')];
        for (const status of ['married', 'unmarried']) {
            for (const taxable of invalid) {
                const count = notes.length;
                assertEqual(inheritanceTaxRate(taxable, status), 0, 'PA-1b/4: nicht endlicher oder ungültiger Erwerb ergibt Satz 0');
                assertEqual(notes.length, count + 1, 'PA-1b/4: jeder ungültige Erwerb erzeugt einen Hinweis');
                assert(notes.at(-1).includes('[Inheritance]') && notes.at(-1).includes('Steuersatz 0'),
                    'PA-1b/4: Hinweis erklärt den Rückfall auf Satz 0');
            }
            const count = notes.length;
            for (const [amount, married, unmarried] of [[-1, 0, 0], [0, 0, 0], [75000, .07, .3],
                [75001, .11, .3], [6000000, .19, .3], [6000001, .23, .5], [Number.MAX_VALUE, .3, .5]]) {
                assertEqual(inheritanceTaxRate(amount, status), status === 'married' ? married : unmarried,
                    'PA-1b/4: endliche Beträge behalten ihren bisherigen Tarif');
            }
            assertEqual(notes.length, count, 'PA-1b/4: gültige Beträge erzeugen keinen Warnhinweis');
        }
    } finally { console.warn = warn; }
}

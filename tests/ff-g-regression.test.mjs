import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readQSBReferences } from './helpers/qs-b-expectations.mjs';
import { readVF2DReferences } from './helpers/vf-2d-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { readBK2Hash } from './helpers/bk-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { applyFlexShareCurve } from '../engine/planners/flex-rate-policy.mjs';
import { createFlexTraceCollector } from '../engine/planners/flex-trace.mjs';
import { projectBalanceFlexTrace } from '../app/balance/balance-flex-trace.js';
import { ffgInput, unchangedFFG } from './helpers/ff-g-scenarios.mjs';
import { helgaWernerBacktest } from './helpers/ff-e-scenarios.mjs';

for (const quote of [0, .019, .02, .020001]) {
    const need = { floor: 6000, flex: 60000 }, baseline = 30000;
    const trace = createFlexTraceCollector(need.flex);
    const result = applyFlexShareCurve(100, need, () => {}, 1, trace, quote, baseline);
    const oldCap = applyFlexShareCurve(100, need, () => {}, 1).rate;
    assertClose(result.rate, quote <= .02 ? Math.max(oldCap, 50) : oldCap, 1e-12,
        'FR-32: bis einschließlich 2 % schützt die S-Kurve den Wunsch-Flex; darüber alter Cap');
    assert(result.rate < 100, 'Hoher dynamischer Mehrbetrag wird weiterhin begrenzt');
    if (quote <= .02) assert(result.rate * need.flex / 100 >= baseline,
        'Die S-Kurve allein kürzt nicht unter den Wunsch-Flex');
    assert(trace.snapshot()[0].gegriffen, 'Trace belegt den tatsächlichen S-Kurven-Eingriff');
}
assertEqual(applyFlexShareCurve(100, { floor: 0, flex: 60000 }, () => {}, 0, undefined, 0, 30000).rate,
    100, 'Unveränderte Vermögensdämpfung: Faktor 0 löst keine S-Kurven-Kürzung aus');
assertEqual(applyFlexShareCurve(100, { floor: 6000, flex: 30000 }, () => {}, 1, undefined, .02, 30000).rate,
    100, 'Ohne Mehrbetrag ist die S-Kurve unter FR-32 weiterhin ausgesetzt');

for (const goGoActive of [false, true]) {
    for (const factor of [1, 1.2]) {
        const input = { ...ffgInput, goGoActive, floorBedarf: ffgInput.floorBedarf * factor,
            flexBedarf: ffgInput.flexBedarf * factor, renteMonatlich: ffgInput.renteMonatlich * factor };
        for (const includeFlexTrace of [false, true]) {
            const result = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace });
            assert(!result.error, 'Engine berechnet Dynamic Flex mit und ohne Go-Go');
            const baseline = input.flexBedarf - (input.renteMonatlich * 12 - input.floorBedarf);
            assertClose(result.ui.vpw.staticFlexBaseline, baseline, 1e-9,
                'Durchgereichter Wunsch-Flex verwendet nominalen Jahresbedarf nach Überschussrente');
            assert(result.diagnosis.general.protectedPortfolioWithdrawalRate < .02,
                'Gegenprobe liegt unter 2 % geschützter Quote');
            assert(result.ui.spending.monatlicheEntnahme * 12 >= baseline,
                'Auszahlung finanziert mindestens den Wunsch-Flex aus dem Depot');
            assert(result.ui.spending.anmerkung.includes(result.ui.spending.kuerzungQuelle),
                'Begründung und Kürzungsquelle nennen denselben stärksten Schritt, auch ohne gespeicherten Trace');
            if (includeFlexTrace) {
                const stage = result.ui.spending.flexTrace.find(e => e.schritt === 'flex_share_curve');
                assert(stage.gegriffen && stage.rateNachher < 100, 'S-Kurve bremst den dynamischen Flex');
                assertClose(stage.kennzahlen.wunschFlexEurJahr, baseline, 1e-9,
                    'Trace nennt den weitergereichten Wunschbetrag');
                assert(stage.monatsbetragNachher * 12 >= baseline - 1e-8,
                    'S-Kurven-Stufe schützt den Wunsch-Flex vor nachgelagerten Regeln');
                const view = projectBalanceFlexTrace({ ...result.ui, input: result.input });
                assert(view.rows.some(r => r.label === 'S-Kurve für dynamischen Flex'),
                    'Warum-Treppe benennt den S-Kurven-Eingriff im dynamischen Anteil');
                assertEqual(view.reason, result.ui.spending.kuerzungQuelle,
                    'Warum-Grund nennt denselben verbleibenden Grund wie die Engine');
            }
        }
        const fixed = EngineAPI.simulateSingleYear({ ...input, dynamicFlex: false }, null, { includeFlexTrace: true });
        assert(!fixed.ui.spending.flexTrace.find(e => e.schritt === 'flex_share_curve').gegriffen,
            'Ohne Dynamic Flex bleibt FR-32 unverändert: keine S-Kurven-Kürzung');
        assertEqual(fixed.ui.spending.anmerkung, '', 'Statischer Wunsch-Flex wird ohne Kürzungsanmerkung ausgezahlt');
    }
}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidence = JSON.parse(readFileSync(new URL('./fixtures/ff-g-expectation-deltas.json', import.meta.url)));
for (const [key, value] of Object.entries(unchangedFFG(EngineAPI))) {
    const expected = evidence.unchanged[key];
    assertEqual(expected.before, expected.after, `${key}: vollständige Ergebnisse vor/nach FF-G bytegleich`);
    assertEqual(hash(value), readQSCReferences(readVF2BReferences(readGL1References(readAN1Hash(readJB2Hash(readBK2Hash(expected.before)))))), `${key}: ungefilterte JSON-Bytes gegen BK-2`);
}
const backtest = helgaWernerBacktest();
const qsh = JSON.parse(readFileSync(new URL('./fixtures/qs-h-measurement.json', import.meta.url))).specialBacktest;
assertEqual(readQSCReferences(readGL1References(readAN1Hash(readJB2Hash('d4ef2924a53684d00a6f7d4ea0ed66e297c6f8aac1bd9bedaff2d5c3911359cb')))),
    'b50168a6d6597d7a0f4efbadcefce1e8dabf713626df7ba50d1fd5a4a8ccb93d', 'Alter Drei-Töpfe-Beleg bleibt erhalten');
assertEqual(qsh.beforeHash, readQSCReferences(readQSBReferences(readVF2DReferences(readVF2BReferences('be6787b97faa328e26b26d940f12860ee349ff5c0baf3ce19f813e3758e8d3c4')))),
    'QS-H 4: bisheriger vollständiger Backtestbeleg bleibt erhalten');
assertEqual(qsh.rowsBeforeHash, qsh.rowsAfterHash, 'QS-H 4: Jahresrechnungen bleiben bytegleich');
assertEqual(hash(backtest.rows), qsh.rowsBeforeHash, 'QS-H 4: keine geänderten Entnahmen, Steuern oder Folgejahre');
assertEqual(hash(backtest), qsh.afterHash,
    'Helga/Werner: vollständiger Backtest nach FR-63, Tagesgeld zuerst in Anleihen und keine Auffüllung im Bärenmarkt');
assertEqual(backtest.rows.filter(r => r.entscheidung.kuerzungProzent >= 10).map(r => r.jahr).join(),
    '2002,2003,2004,2005,2008,2009', 'Helga/Werner: FR-36: sechs stärkere Kürzungsjahre');

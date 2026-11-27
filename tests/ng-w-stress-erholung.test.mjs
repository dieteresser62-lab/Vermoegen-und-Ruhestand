// NG-W (W4; Neon-Bewertung 19.11.): Läufe ohne Erholung nach Stress zählen getrennt und gehen nicht als Erholungsdauer in den Median ein.
// Synthetischer Einzelhaushalt, keine Nutzerdaten.
import { buildStressMetrics } from '../app/simulator/results-metrics.js';
import { STRESS_PRESETS } from '../app/simulator/simulator-data.js';
import { createMonteCarloStressTracker, recordMonteCarloStressRuin, recordMonteCarloStressYear, recordMonteCarloStressZeroWithdrawal,
    summarizeStressRecovery, writeMonteCarloStressMetrics } from '../app/simulator/mc-stress-tracker.js';
import { base, ruinInFirstYear, run, stressKey } from './helpers/ng-w-monte-carlo.mjs';

const recoveryCard = results => buildStressMetrics(results.stressKPI, 'real', results).kpis.find(kpi => kpi.title === 'Erholung nach Stress (Median)');

// Totalverlust im ersten Stressjahr: kein Lauf erholt sich.
{
    const results = await run(ruinInFirstYear(stressKey), 3, 5);
    assertEqual(results.failCountForTest, 3, 'Alle drei Läufe sind im ersten Stressjahr aufgebraucht');
    const recovery = results.stressKPI.recoveryYears;
    assert(recovery.p50 !== STRESS_PRESETS[stressKey].years, 'W4: Totalverlust erscheint nicht als Erholung nach der Länge der Stressphase');
    assertEqual(recovery.noRecoveryCount, 3, 'W4: alle drei Läufe zählen als „keine Erholung“');
    assertEqual(recovery.recoveredCount, 0, 'W4: kein Lauf zählt als erholt');
    assertEqual(recovery.p50, null, 'W4: ohne erholten Lauf gibt es keinen Median der Erholungsdauer');
    const card = recoveryCard(results);
    assertEqual(card.value, 'keine Erholung', 'W4: Karte zeigt „keine Erholung“ statt einer Dauer');
    assertEqual(card.secondaryValue, '100,0\u00a0%', 'W4: Karte nennt den Anteil der Läufe ohne Erholung');
    assertEqual(card.secondaryStatusLine, '3 von 3 Läufen', 'W4: Karte nennt die Zahl der Läufe ohne Erholung');
}

// W4: gemischter Fall. Der Median kommt nur aus erholten Läufen, die übrigen stehen getrennt.
// Eigener Pfadaufbau über den Stress-Tracker statt eines Presets: Das Ergebnis hängt nicht davon ab, welche historischen Jahre ein
// Stressfilter zieht (SF-1 hat den Stagflationsfilter auf 6,5 % gesenkt; danach erholte sich im Monte-Carlo-Fall kein Lauf mehr).
// Drei Stressjahre, danach die Entnahmequoten je Lauf; erholt ist ein Lauf mit der ersten Quote unter 3,5 %.
{
    const stressYears = 3;
    const paths = [
        { after: [0.03] },                   // erholt nach 1 Jahr
        { after: [0.05, 0.03] },             // erholt nach 2 Jahren
        { after: [0.05, 0.05, 0.05, 0.03] }, // erholt nach 4 Jahren
        { after: [0.05, 0.05, 0.05, 0.05] }, // Horizont endet ohne Erholung
        { ruinYear: 1 }                      // im zweiten Stressjahr aufgebraucht
    ];
    const buffers = Array.from({ length: 5 }, () => new Float64Array(paths.length));
    const log = quote => ({ entnahmequote: quote, flex_wunsch_haushalt_nominal: 0, entscheidung: { kuerzungProzent: 0 }, jahresentnahme_real: 4000 });
    paths.forEach((path, index) => {
        const tracker = createMonteCarloStressTracker({ preset: { years: stressYears } }, 100000);
        for (let year = 0; year < stressYears; year++) {
            if (year === path.ruinYear) { recordMonteCarloStressRuin(tracker, year); recordMonteCarloStressZeroWithdrawal(tracker, year); break; }
            recordMonteCarloStressYear(tracker, year, 100000 - 10000 * (year + 1), log(0.06));
        }
        (path.after || []).forEach((quote, offset) => recordMonteCarloStressYear(tracker, stressYears + offset, 70000, log(quote)));
        writeMonteCarloStressMetrics(tracker, index, ...buffers);
    });
    const recovery = summarizeStressRecovery(buffers[4], true);
    assert(recovery.recoveredCount > 0 && recovery.noRecoveryCount > 0, `W4: Testfall enthält erholte und nicht erholte Läufe (${recovery.recoveredCount}/${recovery.noRecoveryCount})`);
    assertEqual(`${recovery.recoveredCount}/${recovery.noRecoveryCount}`, '3/2', 'W4: drei Läufe erholt, zwei ohne Erholung (Horizontende und Ruin)');
    assertEqual(recovery.recoveredCount + recovery.noRecoveryCount, paths.length, 'W4: jeder auswertbare Lauf ist entweder erholt oder ohne Erholung');
    // Median aus 1, 2 und 4 Jahren. Nach der alten Regel zählten die zwei Läufe ohne Erholung mit der Länge der Stressphase (3 Jahre), Median 3.
    assertEqual(recovery.p50, 2, 'W4: Median nur aus den erholten Läufen');
    const card = buildStressMetrics({ presetKey: 'EIGENER_PFAD', years: stressYears, recoveryYears: recovery }, 'real', {}).kpis
        .find(kpi => kpi.title === 'Erholung nach Stress (Median)');
    assertEqual(card.value, '2,0 Jahre', 'W4: Karte zeigt die Dauer der erholten Läufe');
    assertEqual(card.secondaryLabel, 'keine Erholung:', 'W4: Karte zeigt getrennt den Anteil ohne Erholung');
    assertEqual(card.secondaryValue, '40,0 %', 'W4: Karte nennt den Anteil der Läufe ohne Erholung');
    assertEqual(card.secondaryStatusLine, '2 von 5 Läufen', 'W4: Karte nennt die Zahl der Läufe ohne Erholung');
}

// Ohne Stress bleibt die Erholung wie bisher 0 und ohne Zähler.
{
    const results = await run(base(), 3, 5);
    assertEqual(JSON.stringify(results.stressKPI.recoveryYears), JSON.stringify({ p50: 0 }), 'Ohne Stressphase bleibt die Erholungskennzahl unverändert');
}

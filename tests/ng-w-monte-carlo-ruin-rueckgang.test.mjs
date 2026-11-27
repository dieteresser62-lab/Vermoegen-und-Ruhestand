// NG-W (W3; Neon-Bewertung 19.11.): Ein Ruinpfad zählt im Rückgang mit 100 %, auch bei Ruin im ersten Jahr und in der Stressphase.
// Synthetischer Einzelhaushalt, keine Nutzerdaten.
import { ruinInFirstYear, run, stressKey } from './helpers/ng-w-monte-carlo.mjs';

// Ruin im ersten Jahr ohne Stress.
{
    const results = await run(ruinInFirstYear('NONE'), 3, 5);
    assertEqual(results.failCountForTest, 3, 'Alle drei Läufe sind im ersten Jahr aufgebraucht');
    assertEqual(results.maxDrawdowns.p50, 100, 'W3: Max. Rückgang nominal (Median) zählt den Ruinpfad mit 100 %');
    assertEqual(results.maxDrawdowns.p90, 100, 'W3: Max. Rückgang nominal (P90) zählt den Ruinpfad mit 100 %');
    assertEqual(results.realMaxDrawdowns.p50, 100, 'W3: Max. Rückgang real (Median) zählt den Ruinpfad mit 100 %');
    assertEqual(results.realMaxDrawdowns.p90, 100, 'W3: Max. Rückgang real (P90) zählt den Ruinpfad mit 100 %');
}

// Ruin im ersten Jahr der Stressphase.
{
    const results = await run(ruinInFirstYear(stressKey), 3, 5);
    assertEqual(results.failCountForTest, 3, 'Mit Stress sind ebenfalls alle drei Läufe im ersten Jahr aufgebraucht');
    assertEqual(results.stressKPI.maxDD.p50, 100, 'W3: Max. Rückgang (Median, Stress) zählt den Ruinpfad mit 100 %');
    assertEqual(results.stressKPI.maxDD.p90, 100, 'W3: Max. Rückgang (P90, Stress) zählt den Ruinpfad mit 100 %');
}

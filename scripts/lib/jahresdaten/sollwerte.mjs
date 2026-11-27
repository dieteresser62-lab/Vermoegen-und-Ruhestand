/**
 * Klasse-3-Sollwerte, die sich aus dem aktuellen Datenstand rechnen lassen (`npm run jahresdaten:sollwerte`).
 *
 * Neu erzeugt werden die Regimezählung samt Stresspools und die Ergebnis-Schnappschüsse des Live-Stands
 * (Backtests bis zum Endjahr, Monte Carlo, Kennung des Stands). Commit-gebundene Belege,
 * per SHA festgeschriebene Fixtures, Altstände und Alt/Neu-Messungen bleiben eingefroren; ihre Tests
 * vergleichen nur den Grundbestand (Liste in tests/README.md, „Neues Datenjahr: drei Testklassen“).
 * Die Erzeuger laden App-Module; deshalb läuft das Skript in einem eigenen Prozess.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const laden = (root, file) => import(pathToFileURL(path.join(root, file)).href);

/** Stresspools mit historischer Auswahl (Kalenderfenster und Filter); Jahre der Stichprobe. */
const STRESSPOOLS = Object.freeze(['GREAT_DEPRESSION_29_33', 'WWII_40s', 'DOUBLE_BEAR_00s', 'STAGFLATION_70s', 'STAGFLATION_SUPER']);

/** Regimezählung, Übergänge und historische Stresspools über alle Jahre des Datenstands. @param {string} root */
async function regimeSollwerte(root) {
    const { annualData, HISTORICAL_DATENSTAND, REGIME_CLASSIFICATION_THRESHOLDS, REGIME_DATA, REGIME_TRANSITIONS } = await laden(root, 'app/simulator/simulator-data.js');
    const { buildStressContext } = await laden(root, 'app/simulator/simulator-portfolio-stress.js');
    return json({
        beschreibung: 'Regimezählung, Übergänge und historische Stresspools aller Jahre des Datenstands; neu erzeugt mit npm run jahresdaten:sollwerte',
        datenstand: { startYear: HISTORICAL_DATENSTAND.startYear, endYear: HISTORICAL_DATENSTAND.endYear, contentHash: HISTORICAL_DATENSTAND.contentHash },
        verteilung: Object.fromEntries(REGIME_CLASSIFICATION_THRESHOLDS.labels.map(label => [label, REGIME_DATA[label].length])),
        uebergaenge: REGIME_TRANSITIONS,
        stresspools: Object.fromEntries(STRESSPOOLS.map(key => [key,
            buildStressContext(key, () => 0.5).pickableIndices.map(index => annualData[index].jahr)]))
    });
}

/** Ergebnis-Schnappschüsse des Live-Stands (tests/helpers/live-sollwerte.mjs). @param {string} root */
async function liveSollwerte(root) {
    const { liveSollwerte: berechnen } = await laden(root, 'tests/helpers/live-sollwerte.mjs');
    return json(await berechnen());
}

/** Erzeuger je Datei; Reihenfolge = Schreibreihenfolge. */
export const SOLLWERTE = Object.freeze([
    Object.freeze({ datei: 'tests/fixtures/regime-sollwerte.json', erzeugen: regimeSollwerte }),
    Object.freeze({ datei: 'tests/fixtures/live-sollwerte.json', erzeugen: liveSollwerte })
]);

/** Felder, die nach der Rückwärtsprobe abweichen dürfen (Revision und davon abhängiger Manifesthash). */
export const REVISIONSABHAENGIG = Object.freeze({ 'tests/fixtures/live-sollwerte.json': Object.freeze(['datenstand.revision', 'datenstand.manifestHash']) });

export const SOLLWERT_DATEIEN = Object.freeze(SOLLWERTE.map(({ datei }) => datei));

/**
 * Erzeugt alle Sollwerte und schreibt geänderte Dateien.
 * @param {string} root @param {{nurPruefen?: boolean}} [options]
 * @returns {Promise<{datei: string, geaendert: boolean}[]>}
 */
export async function sollwerteSchreiben(root, { nurPruefen = false } = {}) {
    const ergebnis = [];
    for (const { datei, erzeugen } of SOLLWERTE) {
        const text = await erzeugen(root);
        const full = path.join(root, datei);
        const geaendert = !fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== text;
        if (geaendert && !nurPruefen) fs.writeFileSync(full, text);
        ergebnis.push({ datei, geaendert });
    }
    return ergebnis;
}

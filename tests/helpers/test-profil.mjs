// Testprofil: `npm test` rechnet „schnell“, `npm run test:schwer` setzt TEST_PROFIL=schwer für die Prüfkette.
// Ohne Variable (oder leer) gilt „schnell“; jeder andere Wert bricht ab, damit kein Tippfehler still das leichte Profil wählt.
export const TEST_PROFILES = Object.freeze(['schnell', 'schwer']);

/** @param {string|undefined} [value] @returns {'schnell'|'schwer'} */
export function getTestProfile(value = process.env.TEST_PROFIL) {
    if (value === undefined || value === '') return 'schnell';
    if (!TEST_PROFILES.includes(value)) {
        throw new Error(`TEST_PROFIL="${value}" ist unbekannt; erlaubt sind ${TEST_PROFILES.join(' und ')}.`);
    }
    return /** @type {'schnell'|'schwer'} */ (value);
}

/** Monte-Carlo-Läufe der NK-1-Invarianten: 1.000 in der Prüfkette, 100 im Alltag (gleicher Startwert, gleiche Backtests).
 * @param {string|undefined} [value] */
export const invariantRuns = (value = process.env.TEST_PROFIL) => getTestProfile(value) === 'schwer' ? 1000 : 100;

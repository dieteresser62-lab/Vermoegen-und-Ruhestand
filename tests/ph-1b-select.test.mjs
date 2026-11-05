import { readFileSync } from 'node:fs';
const measure = JSON.parse(readFileSync(new URL('./fixtures/ph-1b-select-measurement.json', import.meta.url), 'utf8'));
assertEqual(measure.length, 9, '14: Kirchensteuer bei drei Breiten in Plan und beiden Versuchsarten gemessen');
for (const viewport of [1366, 1920, 2560]) for (const mode of ['Plan', 'Versuch', 'Versuch, Dynamik Ausgewogen']) {
    const row = measure.find(row => row.viewport === viewport && row.mode === mode);
    assert(row && row.textSpace >= row.textWidth && row.textWidth > 20, `14: Längster Eintrag passt in gemessenen Textplatz (${viewport}, ${mode})`);
}
const css = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
assert(css.includes('.household-plan-field > select.ds-select { min-width: 6rem; }'), '14: Auswahl bekommt eigene Mindestbreite');
assert(css.includes('grid-template-columns: minmax(0, 1fr) auto') && css.includes('.household-plan-field > .ds-segment { grid-column: 2;'), '14: Umschalter-Zeilen bleiben erhalten');

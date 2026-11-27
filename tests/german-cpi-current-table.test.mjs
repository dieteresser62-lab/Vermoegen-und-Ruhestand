// JD-1 Nachtrag 2, Befund 1: Alle Jahre nach dem Ende der Destatis-Langreihe bis zum Endjahr kommen aus der aktuellen
// Jahrestabelle; Pegel und Rate werden für jedes dieser Jahre geprüft. Gegenprobe mit erfundenen Werten für 2026.
import { readFileSync } from 'node:fs';
import { CURRENT_TABLE_PLAUSIBLE, currentTableAnnualRates, currentTableConstruction } from '../scripts/lib/german-cpi-current-table.mjs';
import { GERMAN_CPI_INFLATION_RATES, GERMAN_CPI_RESEARCH_CHAIN } from '../app/simulator/german-cpi-chain.js';

console.log('--- German CPI Current Table Tests ---');

const captureError = callback => { try { callback(); return null; } catch (error) { return error; } };
const LONG_SERIES_LAST_YEAR = 2024;
// Erfundene, untereinander stimmige Werte: Pegel 2024 aus der Langreihe, danach die aktuelle Jahrestabelle.
const longSeriesLastLevel = 119.3;
const table = { level: { 2025: 121.9, 2026: 124.5 }, rate: { 2025: 2.2, 2026: 2.1 } };
const reader = values => year => {
    if (!Number.isFinite(values[year])) throw new Error(`Destatis HTML annual value is missing ${year}`);
    return values[year];
};
const build = (overrides = {}) => currentTableAnnualRates({ longSeriesLastYear: LONG_SERIES_LAST_YEAR, longSeriesLastLevel, endYear: 2026,
    readLevel: reader(table.level), readRate: reader(table.rate), tolerancePp: GERMAN_CPI_RESEARCH_CHAIN.validation.publishedRateVsRoundedLevelTolerancePp, ...overrides });

console.log('Test 1: Endjahr 2026 übernimmt 2025 und 2026 aus der aktuellen Jahrestabelle');
const rates2026 = build();
assertEqual(JSON.stringify(rates2026), '{"2025":2.2,"2026":2.1}', 'Beide Folgejahre der Langreihe kommen aus der Jahrestabelle');
const assembled = { ...Object.fromEntries(Object.entries(GERMAN_CPI_INFLATION_RATES).filter(([year]) => Number(year) <= LONG_SERIES_LAST_YEAR)), ...rates2026 };
assertEqual(Object.keys(assembled).length, 102, 'Kette bis 2026 enthält 102 Jahresraten');
assert(Array.from({ length: 102 }, (_, index) => 1925 + index).every(year => Number.isFinite(assembled[year])), 'Keine Lücke von 1925 bis 2026');
assertEqual(currentTableConstruction(LONG_SERIES_LAST_YEAR, 2026),
    'Published Destatis annual changes, each checked against the consecutive annual-average levels from 2024 to 2026.', 'Segmenttext nennt die geprüften Jahre');

console.log('Test 2: heutiger Stand bis 2025 bleibt gleich');
const rates2025 = build({ endYear: 2025 });
assertEqual(JSON.stringify(rates2025), '{"2025":2.2}', 'Bis 2025 nur das eine Folgejahr');
assertEqual(GERMAN_CPI_INFLATION_RATES[2025], rates2025[2025], 'Rate 2025 gleicht der erzeugten Kette');
assertEqual(currentTableConstruction(LONG_SERIES_LAST_YEAR, 2025),
    GERMAN_CPI_RESEARCH_CHAIN.segments.at(-1).construction, 'Segmenttext bis 2025 bleibt bytegleich');

console.log('Test 3: jedes Folgejahr wird geprüft');
const inconsistent = captureError(() => build({ readRate: reader({ ...table.rate, 2026: 3.0 }) }));
assert(inconsistent?.message === 'Destatis 2026 published rate is inconsistent with the annual-average levels', 'Rate 2026 gegen Pegel 2025 und 2026 geprüft');
assertEqual(inconsistent?.details.previousYear, 2025, 'Vorjahrespegel des zweiten Folgejahrs kommt aus der Jahrestabelle');
const inconsistentFirst = captureError(() => build({ longSeriesLastLevel: 110 }));
assert(inconsistentFirst?.message.startsWith('Destatis 2025 published rate is inconsistent'), 'Erstes Folgejahr gegen den Langreihenpegel geprüft');
const implausible = captureError(() => build({ readLevel: reader({ ...table.level, 2026: CURRENT_TABLE_PLAUSIBLE.levelMax + 1 }) }));
assertEqual(implausible?.message, 'Destatis current values are implausible', 'Unplausibler Pegel bricht ab');
const missing = captureError(() => build({ readLevel: reader({ 2026: 124.5 }) }));
assert(missing?.message.includes('2025'), 'Fehlender Wert 2025 in der Jahrestabelle bricht ab');
assertEqual(captureError(() => build({ endYear: LONG_SERIES_LAST_YEAR }))?.message, 'The data end year must follow the Destatis long series', 'Endjahr vor der Jahrestabelle bricht ab');

console.log('Test 4: das Bauskript nutzt genau diese Logik');
const script = readFileSync(new URL('../scripts/build-german-cpi-chain.mjs', import.meta.url), 'utf8');
assert(script.includes("import { currentTableAnnualRates, currentTableConstruction } from './lib/german-cpi-current-table.mjs';"), 'Bauskript importiert die Jahrestabellen-Logik');
// JD-2a: Die Jahrestabelle des Originals liefert die Jahre bis zum Grundbestandsende; spätere Jahre bis zum Endjahr des
// Datenstands hängt die Fortschreibung aus den Jahreslieferungen an.
assert(script.includes('endYear: GRUND_END_YEAR,') && script.includes('longSeriesLastYear: LONG_SERIES_LAST_YEAR,'), 'Bauskript übergibt Langreihenende und Grundbestandsende');
assert(script.includes('Object.assign(annualRates, currentTableRates);'), 'Bauskript übernimmt alle Folgejahre der Jahrestabelle');
assert(script.includes('construction: currentTableConstruction(LONG_SERIES_LAST_YEAR, GRUND_END_YEAR)'), 'Segmenttext kommt aus derselben Logik');
assert(script.includes('fortschreibungAnwenden(inflationKette, grundbestand, { root: PROJECT_ROOT, endYear: END_YEAR })'), 'Jahre nach dem Grundbestand kommen aus den Jahreslieferungen');

console.log('✅ German CPI current table tests passed');

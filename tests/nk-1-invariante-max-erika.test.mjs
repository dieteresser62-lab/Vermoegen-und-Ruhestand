// NK-1 (FR-84 Punkt 13): max-erika, alle Varianten. Monte Carlo mit 1.000 Läufen in `npm run test:schwer`, 100 in `npm test` (Startwert 12345) und Backtests 2000–2025 und 1965–1999:
// kein Ruin, solange das Geldvermögen des Haushalts den Grundbedarf ohne Pflege plus feste geplante Ausgaben deckt; NK-1b: in jedem
// Erfolgsjahr ist der Grundbedarf nach den Zahlungen der Jahreszeile bezahlt.
import { assertHouseholdInvariant } from './helpers/nk-1-invariant.mjs';

await assertHouseholdInvariant('max-erika');

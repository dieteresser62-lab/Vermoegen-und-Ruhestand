// NK-1 (FR-84 Punkt 13): Martin und Petra, alle Varianten, Sollfall A und (NK-1b, Fable P1-1) „Martin trägt“ mit knapper Liquidität.
// Monte Carlo mit 1.000 Läufen in `npm run test:schwer`, 100 in `npm test` (Startwert 12345) und Backtests 2000–2025 und 1965–1999: kein Ruin, solange das Geldvermögen des Haushalts
// den Grundbedarf ohne Pflege deckt, und in jedem Erfolgsjahr ist der Grundbedarf nachweislich bezahlt.
import { assertHouseholdInvariant } from './helpers/nk-1-invariant.mjs';
import { sollfallARecords, knappRecords } from './helpers/nk-1-sollfall.mjs';

await assertHouseholdInvariant('martin-petra', { extra: [
    { label: 'martin-petra/traegt (Sollfall A)', variant: 'traegt', transform: sollfallARecords },
    { label: 'martin-petra/traegt (Martin knapp)', variant: 'traegt', transform: knappRecords }] });

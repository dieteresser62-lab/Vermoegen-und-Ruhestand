/**
 * Seiteneffekt-Import (JD-2a, jahresrobust): als erster Import einer Testdatei, deren eingefrorene MC- oder
 * Backtest-Belege dem Grundbestand 1925–2025 gelten. Danach ziehen Monte Carlo und die Test-Provider (über
 * `historischerProvider()`) nur aus dem Grundbestand. Ohne angehängte Jahre ändert sich nichts.
 * Der Import muss vor allen Modulen stehen, die beim Laden einen Provider anlegen (z. B. parity-replay-fixture).
 */
import { grundbestandSichtAktivieren } from './grundbestand-stichprobe.mjs';

grundbestandSichtAktivieren();

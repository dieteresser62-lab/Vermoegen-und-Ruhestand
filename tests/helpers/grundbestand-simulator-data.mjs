/**
 * simulator-data.js mit Grundbestandssicht (JD-2a, Nachtrag 2, Befund 6): alle Exporte unverändert, nur HISTORICAL_DATA
 * und HISTORICAL_DATA_MANIFEST zeigen auf 1925–2025. Nur der Import-Adapter des Testläufers lädt dieses Modul.
 */
export * from '../../app/simulator/simulator-data.js';
export { GRUNDBESTAND_DATA as HISTORICAL_DATA, GRUNDBESTAND_MANIFEST as HISTORICAL_DATA_MANIFEST } from './grundbestand-sicht.mjs';

/**
 * Module: Balance Annual Market Data
 * Purpose: Bündelt die Jahresmarktdaten-Verträge für Balance (Meta-Schlüssel, Kursprüfung, Handkurs).
 *          Die lesenden ETF- und CAPE-Abrufe liegen in shared/annual-marketdata.js; geschrieben wird nur beim Jahresabschluss in der Übersicht.
 * Usage: Used by balance-main.js, balance-annual-storage.js and balance-binder-imports/manual-market-import.js.
 * Dependencies: shared/annual-marketdata.js
 */
"use strict";

export { ANNUAL_MARKET_DATA_META_KEY, ANNUAL_MARKET_DATA_SCHEMA_VERSION, isPlausibleAnnualClosePrice, createAnnualMarketDataRequest, createManualAnnualQuote, validatePreparedAnnualQuote, selectAnnualCloseQuote } from '../shared/annual-marketdata.js';

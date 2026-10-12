import { appNow } from '../shared/app-clock.js';
import { classifyTranche } from '../../types/tranche-contract.js';
import { formatLocalWealthHistoryDate } from '../../types/wealth-history-contract.js';
import { previewWealthHistory } from './balance-wealth-history.js';

export const EXPENSES_WEALTH_QUOTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Die reale PREVIEW trägt auch profilfremde und synthetische Bestände mit. */
export function readExpensesWealthQuoteEvidence(inputData) {
    const expectedEquity = Number(inputData.depotwertAlt || 0) + Number(inputData.depotwertNeu || 0);
    const expectedMoney = Number(inputData.geldmarktEtf || 0);
    let coveredEquity = 0, coveredMoney = 0, coveredBonds = 0;
    const timestamps = [];
    let unknown = false;
    for (const tranche of inputData.detailledTranches || []) {
        const category = classifyTranche(tranche);
        if (!['equity', 'money_market', 'bonds'].includes(category)) continue;
        const value = Number(tranche.marketValue ?? Number(tranche.shares) * Number(tranche.currentPrice));
        if (!(value > 0)) continue;
        // Separate Anleihen sind kein ETF-Kursgate; ihre belegte Zuordnung bleibt erhalten.
        if (category === 'bonds') { coveredBonds += value; continue; }
        if (category === 'money_market') coveredMoney += value;
        else coveredEquity += value;
        const priced = Number(tranche.shares) * Number(tranche.currentPrice);
        if (tranche.syntheticProfileFallback || !(Number(tranche.shares) > 0)
            || !(Number(tranche.currentPrice) > 0) || !Number.isFinite(priced)
            || Math.abs(priced - value) > 0.000001) unknown = true;
        timestamps.push(tranche.asOf);
    }
    // Die bestehende Verbundprojektion zählt Anleihen zum Neu-Depot, der
    // Einzelprofil-Aggregator führt sie separat. Beide PREVIEW-Verträge erhalten.
    const equityCovered = Math.abs(expectedEquity - coveredEquity) <= 0.000001
        || Math.abs(expectedEquity - coveredEquity - coveredBonds) <= 0.000001;
    if (!Number.isFinite(expectedEquity) || !Number.isFinite(expectedMoney)
        || !equityCovered
        || Math.abs(expectedMoney - coveredMoney) > 0.000001) unknown = true;
    return { timestamps, unknown };
}

export function evaluateExpensesWealthQuoteFreshness(evidence, importedAt) {
    const time = importedAt.getTime();
    if (evidence.unknown || !Number.isFinite(time)) return { status: 'unknown' };
    if (!evidence.timestamps.length) return { status: 'none' };
    const times = evidence.timestamps.map(value => Number.isSafeInteger(value) && value > 0 ? value * 1000 : NaN);
    if (times.some(value => !Number.isFinite(new Date(value).getTime()) || value > time)) {
        return { status: 'unknown' };
    }
    const oldest = times.reduce((oldest, time) => Math.min(oldest, time), Infinity);
    return { status: time - oldest > EXPENSES_WEALTH_QUOTE_MAX_AGE_MS ? 'old' : 'fresh', oldest };
}

export function createExpensesWealthCaptureController({ service, update, refresh = () => {},
    readEvidence = readExpensesWealthQuoteEvidence,
    now = appNow, toast = () => {}, clearError = () => {}, reportError = () => {} }) {
    let tail = Promise.resolve();
    const notify = (text, type) => {
        try { toast(text, type); } catch { /* Darstellung ändert kein bestätigtes Ergebnis. */ }
    };
    return {
        afterImport() {
            // Erfolgsgrenze des Imports: Tag und Kontext vor jedem weiteren Warten fixieren.
            const importedAt = new Date(now().getTime());
            let context, contextError;
            try { context = service.captureContext(); } catch (error) { contextError = error; }
            const operation = async () => {
                clearError('expenses-wealth');
                try {
                    if (contextError) throw contextError;
                    service.assertContext(context);
                    service.assertManualReady();
                    const asOf = formatLocalWealthHistoryDate(importedAt);
                    const result = previewWealthHistory({ service, update, context });
                    const freshness = evaluateExpensesWealthQuoteFreshness(readEvidence(result.inputData), importedAt);
                    const date = freshness.oldest === undefined ? null
                        : formatLocalWealthHistoryDate(new Date(freshness.oldest)).split('-').reverse().join('.');
                    if (freshness.status === 'unknown' || freshness.status === 'old') {
                        const detail = freshness.status === 'old'
                            ? `Kurse vom ${date} sind älter als 7 Tage.` : 'Kursdatum unbekannt.';
                        notify(`Vermögensstand nicht gesichert: ${detail} Kurse im Profil-Assets-Manager aktualisieren und danach in Personen & Vermögen „Stand jetzt erfassen“.`, 'info');
                        return { status: freshness.status };
                    }
                    const validatePreview = service.bindPreviewSource(result);
                    const validateSource = replacement => {
                        validatePreview(replacement);
                        const current = evaluateExpensesWealthQuoteFreshness(readEvidence(result.inputData), importedAt);
                        if (current.status === 'unknown' || current.status === 'old') {
                            throw new Error('Die Vorschau besitzt keine bestätigten frischen Kurse mehr.');
                        }
                    };
                    if (result.overviewPersistence) await service.waitForOverview({ result, context, validateSource });
                    await service.captureManual({ result, asOf, context, validateSource });
                    service.assertContext(context);
                    notify(freshness.status === 'none'
                        ? 'Vermögensstand gesichert (keine kursabhängigen Bestände).'
                        : `Vermögensstand gesichert (Kurse vom ${date}).`, true);
                    return { status: 'saved' };
                } catch (error) {
                    reportError(new Error(`Ausgaben importiert; Vermögensstand nicht bestätigt: ${error.message || error}`), 'expenses-wealth');
                    return { status: 'failed', error };
                } finally {
                    try { refresh(); } catch { /* Bestätigte Persistenz bleibt maßgeblich. */ }
                }
            };
            const result = tail.then(operation);
            tail = result.catch(() => {});
            return result;
        }
    };
}

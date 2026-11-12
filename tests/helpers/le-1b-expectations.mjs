import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as CONTRACT } from '../../app/simulator/german-demography-care-survivor-contract.js';

/** LE-1b (Gutachten Fable P3-4, 12.11.2026): Der Laufbeleg jedes Monte-Carlo-Laufs nennt seit LE-1b die Zieltafel
 * (Kohorte V2) statt der Abstimmtafel, und die Revision des Demografievertrags steigt auf 2026-11-12.2 (P2-1).
 * Für Vollvergleiche mit den Referenzen von vorher setzt dieser Leser nur diesen einen Block auf den Stand davor
 * zurück. Alle anderen Bytes, auch Jahreszeilen, Zufallsziehungen und übrige Metadaten, bleiben Teil des Vergleichs.
 * Kein Hashpaar: Stimmt der Vergleich, hat sich außer dem Beleg nichts geändert. */
export const LE_1B_PREVIOUS_CONTRACT_REVISION = '2026-11-12.1';

function previousDiagnostics(current) {
    return { ...current, contractRevision: LE_1B_PREVIOUS_CONTRACT_REVISION, mortality: {
        tableType: CONTRACT.mortality.tableType,
        period: CONTRACT.mortality.period,
        cohortProjection: CONTRACT.mortality.cohortProjection,
        futureMortalityImprovement: CONTRACT.mortality.futureMortalityImprovement,
        officialAgeRange: { ...CONTRACT.mortality.officialAgeRange },
        runtimeAgeRange: { ...CONTRACT.mortality.runtimeAgeRange },
        tailEvidenceClass: CONTRACT.mortality.tailAssumption.evidenceClass
    } };
}

/** Ersetzt jeden Laufbeleg `demographyCareSurvivor` (DemographyCareSurvivorDiagnosticsV1) durch den Stand vor LE-1b.
 * Reihenfolge der Schlüssel bleibt; nur Objekte auf dem Weg zum Beleg werden kopiert.
 * @template T @param {T} value @returns {T} */
export function withPreviousRunEvidence(value) {
    if (Array.isArray(value)) return /** @type {T} */ (value.map(withPreviousRunEvidence));
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = key === 'demographyCareSurvivor' && item?.schemaVersion === 'DemographyCareSurvivorDiagnosticsV1'
            ? previousDiagnostics(item) : withPreviousRunEvidence(item);
    }
    return /** @type {T} */ (out);
}

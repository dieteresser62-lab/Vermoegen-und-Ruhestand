/** FR-41 verändert ausschließlich diese vier Herkunftsfelder ohne Pflege.
 * Finanzdaten, Jahreszeilen, Zufallsziehungen und alle anderen Metadaten
 * bleiben Teil des vollständigen JSON-Vergleichs mit der historischen Referenz.
 */
export function withLegacyCareProvenance(output) {
    const original = output?.samplingDiagnostics?.modelContracts?.demographyCareSurvivor;
    if (!original) return output;
    const contract = { ...original, contractRevision: '2026-08-01.1', hashes: { ...original.hashes,
        careEntryModelHash: '8155dc6bb9a7798bab7ead47fcbb3075baabd00b2d892d90c64e6512fe1280e0',
        careProgressionModelHash: '34c6e6fc39b311f911f6c4b7a0d0cb8c2ab248f18802a83ce42bc9b52a56c78d' } };
    delete contract.hashes.careMortalityDefaultsHash;
    return { ...output, samplingDiagnostics: { ...output.samplingDiagnostics,
        modelContracts: { ...output.samplingDiagnostics.modelContracts, demographyCareSurvivor: contract } } };
}

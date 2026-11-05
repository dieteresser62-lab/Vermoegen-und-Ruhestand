// Gemeinsamer Zustand der bisherigen Ausgabensteuerung; genau eine Instanz.
export const context = {
    dom: null,
    adapters: {},
    detailTarget: null,
    pendingImport: null,
    recoveryOptions: null,
    onChange: null,
    onImportSuccess: null,
    generation: 0,
    decisionInFlight: false,
    exampleVisible: false,
    refreshYearSegments: () => {}
};

export const state = {
    year: null,
    monthlyBudget: 0,
    annualBudget: 0,
    profileIds: [],
    corruption: null,
    recoveryExported: false,
    recoveryCancelled: false
};

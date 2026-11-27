/**
 * Erzeugt von scripts/historical-data-generate.mjs – nicht von Hand ändern.
 *
 * Datenstand der historischen Reihen 1925–2025: Zeitraum, Revision, Inhaltshash von
 * HISTORICAL_DATA, geprüfte Regimezählung und die Inventar-Hashes, die vom Datenumfang abhängen.
 * Endjahr und Revision bestimmt die Datenübernahme; alle übrigen Werte rechnet der Generator.
 */
export default Object.freeze({
    schemaVersion: "HistoricalDatenstandV1",
    startYear: 1925,
    endYear: 2025,
    revision: "2026-08-01.4",
    contentHash: "c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79",
    regimeDistribution: Object.freeze({
        observationCount: 101,
        BULL: 40,
        BEAR: 6,
        SIDEWAYS: 49,
        STAGFLATION: 6
    }),
    seriesHashes: Object.freeze({
        global_equity_research_index: Object.freeze({
            rawDataHash: "a234f57c21c3184077ce00743bbd6bc149363518939eeebb016e9fb25ab1f893",
            embeddedValueHash: "38118b9f982ee3ff5d64a920b397451c302c34f3e46722462bac6e0732878c89",
            lieferungen: Object.freeze([])
        }),
        inflation_de: Object.freeze({
            rawDataHash: "83841d2c11df3a5e193aa07db3bdfe815cbbeea7f9f81c3526b197702a46bdb4",
            embeddedValueHash: "9ec87b5052d5e086517142c34213a4063e2be6ccdd8a5babf6d5722ffb76ae3a",
            lieferungen: Object.freeze([])
        }),
        zinssatz_de: Object.freeze({
            rawDataHash: "ea1608b5dee7e00ae7bf24bb651cb01cd3f0d5423b54cdf21b9f975cced30722",
            embeddedValueHash: "cf5471a345234984ac3ff8de57bffdb3128c1046e01ec998198721325ede9b69",
            lieferungen: Object.freeze([])
        }),
        lohn_de: Object.freeze({
            rawDataHash: "cfd5c598a8bc846a96966fa8ff7388d80c30f3ada39edbfe90d39f234eef9d9b",
            embeddedValueHash: "e10e581f6994e07ed0a943b3716dd8fd5dea7b8b272d47a546466af8701a3057",
            lieferungen: Object.freeze([])
        }),
        gold_eur_perf: Object.freeze({
            rawDataHash: "133ed7c3d79a313de4a64f94e54b4f0e06e4f7b24ab4182aa5263958cae49b7d",
            embeddedValueHash: "068a15a99c665b48dc14a187b654033d292c9de6ed3cf712f7e789ddcec049aa",
            lieferungen: Object.freeze([])
        }),
        cape: Object.freeze({
            rawDataHash: "0e3d716f83f51c14f40c5ab5662e767cde4f83fcb7305db24ab003df2c9ee6c5",
            embeddedValueHash: "d1101958fed64dadf8fba76e9e4e92c8d24e86bd3d21accc42cdb60c247a835f",
            lieferungen: Object.freeze([])
        })
    }),
    policyHashes: Object.freeze({
        regime_classification_thresholds: "8dad669ee3def85c107b2ea21d5e4531af9fd0a0cb0d0bfe4271a02dd9f448da",
        regime_transition_matrix: "ab1a37acbf4a1f141983ad194108f028fac85eb3f3c5522efe1d70c42601f398",
        monte_carlo_defaults: "2a85b230cfe4324e4630127d452c59f5588f3d3ce4305bd17831ea78b34502f3"
    })
});

/**
 * Module: Engine Config
 * Purpose: Central configuration for the simulation engine.
 *          Defines thresholds (alarms, caution), control parameters, and version info.
 * Usage: Imported by all engine modules.
 * Dependencies: None
 */

// Engine-Versionierung
export const ENGINE_API_VERSION = "31.0";
export const ENGINE_BUILD_ID = "2025-12-22_16-35";

/** Gemeinsame Ausgangswerte für Konfiguration und Ersatzwerte im Core. */
export const DYNAMIC_FLEX_SAFETY_DEFAULTS = Object.freeze({
    ENABLED: true,
    MAX_STAGE: 2,
    BAD_SCORE_THRESHOLD: 2,                     // Ab diesem Score gilt ein Jahr als "kritisch"
    SEVERE_SCORE_THRESHOLD: 5, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    ESCALATE_STREAK_YEARS: 2,                   // Kritische Jahre in Folge bis Eskalation
    DEESCALATE_STREAK_YEARS: 2,                 // Stabile Jahre in Folge bis Deeskalation
    HARD_CUT_PCT: 35,                           // Sehr starke Flex-Kuerzung als Stresssignal
    GOOD_WITHDRAWAL_RATE: 0.05, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    GOOD_DRAWDOWN: 0.25, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    GOOD_CUT_PCT: 45, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    RUNWAY_HEADROOM_MONTHS: 3,                  // Für Deeskalation: Min-Runway + Puffer
    REENTRY_RAMP_YEARS: 3, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    STAGE2_REQUIRE_CRITICAL_STRESS: /** @type {boolean} */ (true), // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    STAGE2_MIN_FLEX_OF_FLOOR_RATIO: 0.25, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
    STAGE2_MIN_FLEX_OF_PREV_DYNAMIC_RATIO: 0.20 // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
});

/** Zentrale Schwellen und Parameter der Jahres-, Ausgaben- und Transaktionsrechnung. */
export const CONFIG = {
    APP: {
        VERSION: ENGINE_API_VERSION,
        NAME: 'Ruhestand-Engine-Core'
    },

    /**
     * Schwellenwerte für verschiedene Entscheidungsregeln
     */
    THRESHOLDS: {
        /**
         * Alarmgrenzen für vorläufige Depotquote und realen Vermögensrückgang.
         * Werte siehe JAHRESBUDGET.md (erzeugte Tabelle).
         */
        ALARM: {
            withdrawalRate: 0.055, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            realDrawdown: 0.25, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        },

        /**
         * Begrenzt das Ziel der Budget-Floor-Anhebung auf die Depotquote
         * zum Erhalt der Kaufkraft. Die Bedarfsindexierung bleibt erhalten.
         * Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
         */
        CAUTION: {
            withdrawalRate: 0.045, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        },
        /**
         * STRATEGIE-Schwellen: Definieren Verhaltensregeln für Transaktionen
         */
        STRATEGY: {
            stagflationInflation: 4, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            runwayThinMonths: 24, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            liquidityBufferZonePercent: 10, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            minCashBufferMonths: 2, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            minRefillAmount: 10000, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            minTradeAmountStatic: 25000, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            minTradeAmountDynamicFactor: 0.005, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            cashRebalanceThreshold: 2500, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            recoveryLiquidityTargetFactor: 0.85, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            absoluteMinLiquidity: 10000, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            runwayGuardrailActivationPct: 0.69, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            runwayCoverageMinPct: 0.75 // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        }
    },

    /**
     * Historische Profilvorgaben. Operative Reichweiten liefert der Vertrag
     * types/liquidity-runway-contract.js aus der gewählten Jahresreichweite.
     */
    PROFIL_MAP: {
        'sicherheits-dynamisch': {
            isDynamic: true,                            // Dynamisches Profil (Runway variiert mit Markt)
            minRunwayMonths: 24,
            runway: {
                'peak': { total: 48 },
                'hot_neutral': { total: 36 },
                'bear': { total: 60 },
                'stagflation': { total: 60 },
                'recovery_in_bear': { total: 48 },
                'recovery': { total: 48 }
            }
        }
    },

    /**
     * Ausgabenmodell-Parameter
     *
     * Steuert den Anteil des flexiblen Bedarfs, der entnommen wird.
     * Die erste Abwärtsgrenze im tiefen Bär ist RATE_CHANGE_MAX_DOWN_IN_BEAR_PP.
     * Die größere Aufwärtsgrenze gilt bei neuem Hoch, Seitwärtsphase und Erholung im Bär.
     * Werte siehe JAHRESBUDGET.md (erzeugte Tabelle).
     */
    SPENDING_MODEL: {
        FLEX_RATE_SMOOTHING_ALPHA: 0.35,                // Glättungsfaktor für Flex-Rate
        RATE_CHANGE_MAX_UP_PP: 2.5, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        RATE_CHANGE_AGILE_UP_PP: 4.5, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        RATE_CHANGE_MAX_DOWN_PP: 3.5, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        RATE_CHANGE_MAX_DOWN_IN_BEAR_PP: 6.0, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        RATE_CHANGE_RELAX_MAX_DOWN_PP: 20.0,            // Max. Relaxierung der Down-Rate bei hohem Vermögen
        // FR-29: Schnellere Rückkehr bei niedriger Entnahmequote.
        // Alarm, Sicherheitsstufen und harte Obergrenzen gelten weiterhin.
        // Werte siehe JAHRESBUDGET.md (erzeugte Tabelle).
        RATE_CHANGE_RELAX_UP_WITHDRAWAL_RATE: 0.025,
        RATE_CHANGE_RELAX_MAX_UP_PP: 20.0,
        WEALTH_ADJUSTED_REDUCTION: {
            SAFE_WITHDRAWAL_RATE: 0.015, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            FULL_WITHDRAWAL_RATE: 0.035 // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        },
        FLEX_BUDGET: {
            ENABLED: true,
            DEFAULT_MAX_YEARS: 5,
            DEFAULT_RECHARGE_FRACTION: 0.7,
            ACTIVE_REGIMES: ['bear_deep', 'recovery_in_bear'],
            REGIME_WEIGHTS: /** @type {Record<string,number>} */ ({
                bear_deep: 1.0,
                recovery_in_bear: 0.5
            }),
            REGIME_CAP_MULTIPLIER: /** @type {Record<string,number>} */ ({
                bear_deep: 1.0,
                recovery_in_bear: 1.5
            }),
            MIN_RATE_BASE_PCT: /** @type {Record<string,number>} */ ({
                bear_deep: 5,
                recovery_in_bear: 5
            }),
            MIN_RATE_FLOOR_SLOPE_PCT: /** @type {Record<string,number>} */ ({
                bear_deep: 60,
                recovery_in_bear: 60
            })
        },
        // FR-32: Bei niedriger geschützter Entnahmequote schützt die
        // S-Kurve den Wunsch-Flex; den dynamischen Mehrbetrag begrenzt sie weiter.
        FLEX_SHARE_MIN_PROTECTED_WITHDRAWAL_RATE: 0.02,
        FLEX_SHARE_S_CURVE: {
            ENABLED: true,
            K: 0.8, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            A: 14.0,                                    // Steilheit der S-Kurve
            B: 0.52 // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        },
        FLEX_RATE_HARD_CAPS: {
            BEAR_DEEP_MAX_RATE: 70,                     // Max. Flex-Rate im tiefen Bärenmarkt
            FLEX_SHARE_RELIEF_MAX_PP: 15,              // Entlastung bei geringem Flex-Anteil
            RUNWAY_COVERAGE_CAPS: [
                { maxCoverage: 1.20, maxRate: 70 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
                { maxCoverage: 1.05, maxRate: 60 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
                { maxCoverage: 0.90, maxRate: 50 } // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            ]
        },
        FLEX_RATE_FINAL_LIMITS: {
            MAX_UP_PP: 12.0,                            // Max. Anstieg nach Caps pro Jahr
            MAX_DOWN_PP: 12.0,                          // Max. Rückgang nach Caps pro Jahr
            MAX_DOWN_IN_BEAR_PP: 10.0,                  // Sanfterer Abbau im Bärenmarkt
            RELAX_MAX_DOWN_PP: 20.0                     // Max. Relaxierung des Final-Down-Limits
        },
        DYNAMIC_FLEX: {
            RETURN_POLICY: 'legacy_step',                // legacy_step | cape_continuous
            LONG_TERM_INFLATION: 0.02,                  // Langfristige Inflation für die Renditeannahme, keine Bedarfsindexierung
            SAFE_ASSET_REAL_RETURN: 0.005, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            GOLD_REAL_RETURN: 0.01, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            MIN_HORIZON_YEARS: 1,                       // Mindest-Restlaufzeit
            MAX_HORIZON_YEARS: 60,                      // Maximale Restlaufzeit
            FALLBACK_REAL_RETURN: 0.03,                 // Reserviert; im aktuellen Renditepfad ungenutzt
            MIN_REAL_RETURN: 0.00, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            MAX_REAL_RETURN: 0.05, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            EXPECTED_RETURN_SMOOTHING_ALPHA: 0.35,      // Daempfung gegen Spruenge
            MAX_GO_GO_MULTIPLIER: 1.5                   // Sicherheitslimit Go-Go
        },
        DYNAMIC_FLEX_SAFETY: { ...DYNAMIC_FLEX_SAFETY_DEFAULTS },
        THREE_BUCKET: {
            DEFAULT_BOND_TARGET_FACTOR: 5.0,
            DEFAULT_DRAWDOWN_TRIGGER: -15,
            DEFAULT_BOND_REFILL_THRESHOLD: null,
            BOND_NOMINAL_RETURN: 0.02
        }
    },

    /**
     * Parameter fuer die optionale kontinuierliche CAPE-to-Return-Policy.
     * Der Engine-Default bleibt bis zur expliziten Freigabe bei legacy_step.
     */
    CAPE_CONTINUOUS: {
        DEFAULT_CAPE: 20,
        MIN_CAPE: 0,
        MAX_CAPE: 100,
        MIN_REAL_RETURN: -0.015,
        MAX_REAL_RETURN: 0.07,
        MIN_EQUITY_REAL_RETURN: -0.03,
        MAX_EQUITY_REAL_RETURN: 0.08,
        EQUITY_PREMIUM_ADJUSTMENT: 0.015,
        SAFE_REAL_RETURN_MODE: 'config_or_zero'
    },

    /**
     * Anti-Pseudo-Accuracy
     *
     * Rundet Transaktionen und Monatsbeträge in festgelegten Stufen.
     * Die Entnahme wird monatlich abgerundet; der Netto-Grundbedarf bleibt geschützt.
     */
    ANTI_PSEUDO_ACCURACY: {
        ENABLED: true,
        HYSTERESIS_MIN_REFILL_AMOUNT: 2000, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).

        // Adaptive Rundungsstufen: [Obergrenze (exklusiv), Schrittweite]
        QUANTIZATION_TIERS: [
            { limit: 10000, step: 1000 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            { limit: 50000, step: 5000 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            { limit: 200000, step: 10000 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            { limit: Infinity, step: 25000 } // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        ],

        // Eigene Tiers für monatliche Beträge (feiner)
        QUANTIZATION_TIERS_MONTHLY: [
            { limit: 2000, step: 50 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            { limit: 5000, step: 100 }, // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
            { limit: Infinity, step: 250 } // Wert siehe JAHRESBUDGET.md (erzeugte Tabelle).
        ],

        // Von calculateFinalWithdrawal konsumierter, exportierbarer Vertrag.
        WITHDRAWAL_ROUNDING: {
            phase: 'after_floor_plus_flex_decision_before_final_annual_withdrawal',
            monthlyMode: 'floor',
            annualizationFactor: 12,
            floorProtection: 'max_floor_annual'
        },
        METRIC_DISPLAY_ROUNDING: 'descriptor_only_not_applied_to_raw_metric_values'
    },

    /**
     * Recovery-Guardrails
     *
     * Verhindert zu aggressive Entnahmen während der Markt-Erholung.
     * Die Flex-Rate wird gekappt basierend auf dem Abstand zum Allzeithoch (ATH).
     *
     * minGap ist exklusiv, maxGap inklusiv. Werte siehe JAHRESBUDGET.md.
     */
    RECOVERY_GUARDRAILS: {
        description: "Vorsichtige Erhöhung der Flex-Rate während Erholungsphasen, abhängig vom Abstand zum ATH.",

        // Kürzungsregeln basierend auf ATH-Abstand
        CURB_RULES: [
            { minGap: 25, maxGap: Infinity, curbPercent: 25 },
            { minGap: 15, maxGap: 25, curbPercent: 20 },
            { minGap: 10, maxGap: 15, curbPercent: 15 },
            { minGap: 0, maxGap: 10, curbPercent: 10 }
        ],

        /**
         * Bestimmt Kürzung basierend auf ATH-Abstand
         * @param {number} athGapPercent - Abstand vom Allzeithoch in Prozent
         * @returns {number} Kürzung in Prozentpunkten; Werte siehe JAHRESBUDGET.md
         */
        getCurb(athGapPercent) {
            const rule = this.CURB_RULES.find(c => athGapPercent > c.minGap && athGapPercent <= c.maxGap);
            return rule ? rule.curbPercent : 10;
        }
    },

    /**
     * Bewertungsparameter für CAPE-basierte Marktanalysen.
     * Diese Werte werden für diagnostische Hinweise und erwartete Renditen genutzt.
     */
    MARKET_VALUATION: {
        DEFAULT_CAPE: 20,
        // FR-33: alte Renditen an den Klassenmitten; dazwischen linear,
        // außerhalb konstant. Bewertungssignale bleiben separat gestuft.
        EXPECTED_RETURN_CAPE_POINTS: /** @type {[number,number][]} */ ([
            [7.5, 0.08], [22.5, 0.07], [32.5, 0.05], [37.5, 0.04]
        ]),
        UNDERVALUED_CAPE: 15,
        FAIR_VALUE_CAPE: 25,
        OVERVALUED_CAPE: 30,
        EXTREME_OVERVALUED_CAPE: 35,
        EXPECTED_RETURN_BY_SIGNAL: {
            undervalued: 0.08,
            fair: 0.07,
            overvalued: 0.05,
            extreme_overvalued: 0.04
        }
    },

    REGIME_SMOOTHING: {
        TARGETS_ENABLED: false,
        RUNWAY_TARGETS: {
            NEUTRAL_REGIME: 'hot_neutral',
            STRESS_REGIME: 'bear'
        }
    },

    /**
     * Texte und Mappings für UI-Darstellung
     */
    TEXTS: {
        /**
         * Szenario-Beschreibungen für UI
         * Mapping von Szenario-Key zu lesbarem Text
         */
        SCENARIO: {
            peak_hot: "Markt heiß gelaufen",                // Überhitzter Markt
            peak_stable: "Stabiler Höchststand",            // Stabiles ATH
            recovery: "Best. Erholung",                     // Bestätigte Erholung
            bear_deep: "Tiefer Bär",                        // Tiefer Bärenmarkt
            corr_young: "Junge Korrektur",                  // Kurze Korrektur
            side_long: "Seitwärts Lang",                    // Lange Seitwärtsbewegung
            recovery_in_bear: "Erholung im Bärenmarkt"      // Rally im Bärenmarkt
        },

        /**
         * Regime-Mapping für Runway-Berechnung
         * Mappt spezifische Szenarien auf allgemeine Markt-Regimes
         */
        REGIME_MAP: {
            peak_hot: 'peak',                               // Überhitzt -> Peak-Regime
            peak_stable: 'hot_neutral',                     // Stabil -> Hot-Neutral
            side_long: 'hot_neutral',                       // Seitwärts -> Hot-Neutral
            recovery: 'recovery',                           // Erholung -> Recovery
            corr_young: 'recovery',                         // Junge Korrektur -> Recovery
            bear_deep: 'bear',                              // Tiefer Bär -> Bear
            recovery_in_bear: 'recovery_in_bear'            // Rally im Bär -> Special Recovery
        },

        /**
         * Bewertungstexte für CAPE-Signale
         */
        VALUATION_SIGNAL: {
            undervalued: 'Bewertung attraktiv',
            fair: 'Bewertung moderat',
            overvalued: 'Bewertung angespannt',
            extreme_overvalued: 'Bewertung extrem angespannt'
        }
    }
};

export default { ENGINE_API_VERSION, ENGINE_BUILD_ID, CONFIG };

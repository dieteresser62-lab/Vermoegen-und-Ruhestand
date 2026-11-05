/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { percentileWealthNotice } from '../../shared/wealth-display.js';
import { wealthPartsDetail } from './display-values.js';
import { formatWholeEuro, formatPercentage, formatNumberWithUnit, sanitizeDescription } from '../results-formatting.js';

/**
 * Bereitet die KPI-Struktur für Pflege-Risiken auf.
 *
 * @param {Object} results - Simulationsergebnisse (inkl. extraKPI.pflege).
 * @param {Object} inputs - Eingabeparameter der Simulation (inkl. Partnerdaten).
 * @returns {Object|null} Formatierte Pflege-KPI-Struktur oder null, wenn nicht aktiv.

 *
 * @param {string} [moneyBasis] - Preisbasis der Anzeige.
 */
export function buildCareMetrics(results, inputs, moneyBasis = DEFAULT_EURO_MODE) {
    const sourceCare = results?.extraKPI?.pflege;
    const selectedCare = results?.euroMetrics?.[moneyBasis]?.pflege;
    const selected = (group, key) => selectedCare ? selectedCare[group]?.[key === 'realCostEurP50' ? 'additionalNeedEurP50' : key.replace('RealEur', 'Eur')]
        : moneyBasis === 'real' ? sourceCare?.[group]?.[key] : null;
    const care = sourceCare && { ...sourceCare,
        p1: { ...sourceCare.p1, realCostEurP50: selected('p1', 'realCostEurP50') },
        p2: { ...sourceCare.p2, realCostEurP50: selected('p2', 'realCostEurP50') },
        household: { ...sourceCare.household, ...Object.fromEntries(['totalAdditionalNeedRealEurP50', 'maxAnnualAdditionalNeedRealEurP50', 'endWealthWithCareRealEurP50', 'endWealthNoCareRealEurP50'].map(key => [key, selected('household', key)])) },
        comparison: { ...sourceCare.comparison, endWealthNoCareMinusCareRealEur: selected('comparison', 'endWealthNoCareMinusCareRealEur') } };
    const sourceBucket = results?.extraKPI?.healthBucket;
    const healthBucket = sourceBucket && (moneyBasis === 'nominal' ? sourceBucket
        : { ...sourceBucket, usedMedian: null, usedP90: null, endMedian: null, targetGapMedian: null, ...results?.euroMetrics?.real?.healthBucket });
    const hasCareMetrics = care && inputs?.pflegefallLogikAktivieren;
    const hasHealthBucketMetrics = healthBucket && (inputs?.healthBucketEnabled || inputs?.healthBucket?.enabled);
    if (!hasCareMetrics && !hasHealthBucketMetrics) {
        return null;
    }

    const cards = [];

    if (hasCareMetrics) {
        const p1 = care.p1 || {};
        cards.push(
            buildCareEntryCard('Pflegefall-Eintrittsquote P1', p1.entryRatePct, `P1-Eintritte: ${p1.entryRateNumerator || 0} von ${p1.entryRateDenominator || 0} angeforderten Läufen.`, '%'),
            buildCareEntryCard('Median Eintrittsalter P1', p1.entryAgeP50, `Bedingt auf beobachtete P1-Eintritte; Stichprobe: ${p1.sampleSize || 0} Läufe.`, 'Jahre'),
            buildCareEntryCard('Median Pflegejahre P1', p1.careYearsP50, `Nur P1-Pflegejahre in Läufen mit P1-Eintritt; Stichprobe: ${p1.sampleSize || 0}.`, 'Jahre'),
            buildCareEntryCard('Realer Pflege-Mehrbedarf P1 (Median)', p1.realCostEurP50, `Modellierter P1-Zusatzbedarf zu Preisen des Simulationsstarts; keine kausale Depot-Cashflow-Zurechnung. Stichprobe: ${p1.sampleSize || 0}.`, null, true)
        );
    }

    if (hasCareMetrics && inputs.partner?.aktiv) {
        const p2 = care.p2 || {};
        cards.push(
            buildCareEntryCard('Pflegefall-Eintrittsquote P2', p2.entryRatePct, `P2-Eintritte: ${p2.entryRateNumerator || 0} von ${p2.entryRateDenominator || 0} angeforderten Läufen.`, '%'),
            buildCareEntryCard('Median Eintrittsalter P2', p2.entryAgeP50, `Bedingt auf beobachtete P2-Eintritte; Stichprobe: ${p2.sampleSize || 0} Läufe.`, 'Jahre'),
            buildCareEntryCard('Median Pflegejahre P2', p2.careYearsP50, `Nur P2-Pflegejahre in Läufen mit P2-Eintritt; Stichprobe: ${p2.sampleSize || 0}.`, 'Jahre'),
            buildCareEntryCard('Realer Pflege-Mehrbedarf P2 (Median)', p2.realCostEurP50, `Modellierter P2-Zusatzbedarf zu Preisen des Simulationsstarts; keine kausale Depot-Cashflow-Zurechnung. Stichprobe: ${p2.sampleSize || 0}.`, null, true),
            buildCareEntryCard('Median Jahre beide in Pflege', care.household?.careYearsOverlapP50, `Gleichzeitige P1-/P2-Pflegejahre, einschließlich beobachteter 0; Stichprobe: ${care.household?.sampleSize || 0}.`, 'Jahre')
        );
    }

    if (hasCareMetrics) {
        const endCard = (withCare) => {
            const original = care.household?.[withCare ? 'endWealthWithCareRealEurP50' : 'endWealthNoCareRealEurP50'];
            const total = results.displayWealth?.[moneyBasis]?.[withCare ? 'withCareMedian' : 'noCareMedian'];
            const card = buildCareEntryCard(`Reales Endvermögen (${withCare ? 'm.' : 'o.'} Pflege, Median)`,
                results.displayWealth ? total : original, `Gruppenmedian der Läufe ${withCare ? 'mit' : 'ohne'} Pflegeeintritt, zu Preisen des Simulationsstarts. ${results.displayWealth ? percentileWealthNotice : ''}`, null, true);
            if (results.displayWealth) card.moneyDetail = wealthPartsDetail(results.displayWealth[moneyBasis]?.parts?.[withCare ? 'withCareMedian' : 'noCareMedian']);
            return card;
        };
        cards.push(
            buildCareEntryCard('Max. jährlicher Pflege-Mehrbedarf (real)', care.household?.maxAnnualAdditionalNeedRealEurP50, 'Median des je Lauf höchsten tatsächlich modellierten jährlichen Haushalts-Zusatzbedarfs (P1 + P2), zu Preisen des Simulationsstarts.', null, true),
            buildCareEntryCard('Gesamter Pflege-Mehrbedarf (real)', care.household?.totalAdditionalNeedRealEurP50, 'Median der über Pflegejahre summierten modellierten Haushalts-Zusatzbedarfe, zu Preisen des Simulationsstarts; nicht als depotfinanzierter Betrag interpretieren.', null, true),
            buildCareEntryCard('Bedingte Shortfall-Rate', care.household?.shortfallRateWithCarePct, `Anteil der Shortfalls unter Läufen mit Pflegeeintritt; Stichprobe: ${care.household?.sampleSize || 0}.`, '%'),
            buildCareEntryCard('Shortfall-Rate (o. Pflege)', care.household?.shortfallRateWithoutCarePct, `Anteil der Shortfalls unter Läufen ohne Pflegeeintritt; Stichprobe: ${care.household?.noCareSampleSize || 0}.`, '%'),
            endCard(true),
            endCard(false),
            buildCareEntryCard('Geldvermögen: Gruppenmedian-Differenz (nicht kausal)', care.comparison?.endWealthNoCareMinusCareRealEur, 'Nicht gepaarter, nicht kausaler Gruppenvergleich: Median ohne Pflege minus Median mit Pflege, zu Preisen des Simulationsstarts. Unterschiede der Gruppen, etwa Lebensdauer und Pflegeeintritt, sind nicht kontrolliert.', null, true)
        );
    }

    if (hasHealthBucketMetrics) {
        cards.push(
            buildCareEntryCard('Pflegereserve genutzt', healthBucket.usedRatePct, 'Anteil der Monte-Carlo-Läufe mit mindestens einer Entnahme aus der Pflegereserve.', '%'),
            buildCareEntryCard('Pflegereserve erschöpft', healthBucket.depletedRatePct, 'Anteil der Läufe mit aktiver Pflegereserve, in denen die Reserve am Ende aufgebraucht ist.', '%'),
            buildCareEntryCard('Median Reservenutzung', healthBucket.usedMedian, 'Typische Reservenentnahme in Läufen mit Nutzung.', null, true, 'nominal'),
            buildCareEntryCard('P90 Reservenutzung', healthBucket.usedP90, 'Hohe, aber nicht extreme Reservenentnahme über die Läufe mit Nutzung.', null, true, 'nominal'),
            buildCareEntryCard('Median Restreserve', healthBucket.endMedian, 'Typische verbleibende Pflegereserve am Laufende.', null, true, 'nominal'),
            buildCareEntryCard('Median Zieldeckung', healthBucket.coverageMedianPct, 'Typische reale Deckung relativ zum inflationsangepassten Reserveziel.', '%'),
            buildCareEntryCard('Median Ziellücke', healthBucket.targetGapMedian, 'Typische Lücke zum inflationsangepassten Reserveziel.', null, true, 'nominal')
        );
    }

    return { cards: cards.map(card => ({ ...card,
        title: card.title.replace('Realer ', '').replace('Reales ', '').replace(' (real)', ''),
        priceBasis: card.priceBasis ? euroBasisLabel(moneyBasis) : '',
        description: card.description.replaceAll('zu Preisen des Simulationsstarts', euroBasisLabel(moneyBasis))
            .replace('Typische reale Deckung', 'Typische Deckung') })) };
}

/**
 * Hilfsfunktion für Pflege-KPIs.
 * @param {string} title - Titel der Karte.
 * @param {number|null|undefined} value - Rohwert.
 * @param {string} description - Beschreibung der Kennzahl.
 * @param {string|null} unit - Einheit ("%"/"Jahre"), ansonsten null für Währung.
 * @param {boolean} isCurrency - Kennzeichnet Währungsformatierung.
 * @returns {KpiDescriptor} Formatierte Pflege-KPI.
 */
function buildCareEntryCard(title, value, description, unit = null, isCurrency = false, priceBasis = 'heutige Euro') {
    let formattedValue = '—';
    if (isCurrency) {
        formattedValue = formatWholeEuro(value);
    } else if (unit) {
        formattedValue = unit === '%'
            ? formatPercentage(value)
            : formatNumberWithUnit(value, unit);
    } else {
        formattedValue = formatNumberWithUnit(value);
    }

    return {
        title,
        value: formattedValue,
        description: sanitizeDescription(description),
        priceBasis: isCurrency ? priceBasis : '',
        tone: 'default'
    };
}

/** PFA-10: Lese- und Schreibweg der Pflegewerte-Felder, gemeinsam für Simulator und Personen & Vermögen › Pflege.
 * Die Feldkennungen bleiben die des Simulators (`sim_<id>`); geschrieben wird genau das, was der Simulator bei derselben
 * Eingabe schreibt. Lesen schreibt nie. */
import { parseRememberedCareCosts, rememberedCareCostsRecord, resolveCareSetting } from './care-cost-resolver.js';
import { careSettingsStorage, sharesHouseholdCareValues } from './care-profile-settings.js';
import { OWN_CARE_PRICES_KEY, careValuesWithPrices, ownCarePricesWithPatch, resolveCarePrices } from './care-prices.js';
import { HOUSEHOLD_CARE_VALUES_KEY, officialCareCosts, parseCareValues, readCareValues, residentialComponents, residentialMonthly } from './household-care-values.js';
import { defaultCareForm, normalizeCareForm } from './care-benefits.js';
import { persistenceStorage } from './persistence-facade.js';
import { appNow, localCalendarDate } from './app-clock.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY, migrateCareFlexRecord } from '../simulator/simulator-care-flex.js';
import { migrateStoredCareFlex } from '../simulator/simulator-care-flex-persistence.js';

const GRADES = [1, 2, 3, 4, 5];
export const PFLEGE_CUSTOM_COSTS_KEY = 'sim_pflegeCustomCosts';

// FR-73 P8: Staffel, Deckel, eigene Ausgaben im Heim und Kostenanstieg besitzt der Pflegewerte-Record des Haushalts.
export const CARE_PRICE_FIELD_IDS = new Set([...GRADES.map(grade => `pflegeStufe${grade}Zusatz`), 'pflegeMaxFloor', 'pflegeHeimEigeneAusgaben', 'pflegeKostenDrift']);
/** PFA-11: Regionaler Zuschlag und Flex-Level je Grad rechnen auch in Balance; gespeichert bleiben sie als `sim_<id>` beim
 * Preisbesitzer, gelesen mit denselben Vorgaben wie in Balance (0 % und {@link CARE_FLEX_DEFAULT_PERCENT}). */
export const CARE_SETTING_NUMBER_DEFAULTS = Object.freeze({ pflegeRegionalZuschlag: 0,
    ...Object.fromEntries(GRADES.map(grade => [`pflegeStufe${grade}FlexCut`, CARE_FLEX_DEFAULT_PERCENT[grade]])) });
/** Felder, die Personen & Vermögen › Pflege bearbeitet: Preise, Pflegeform je Grad, die Vorgabe der Staffel, regionaler
 * Zuschlag und Flex-Level je Grad. */
export const CARE_VALUE_FIELD_IDS = Object.freeze([...CARE_PRICE_FIELD_IDS, ...GRADES.map(grade => `pflegeStufe${grade}Form`), 'pflegeKostenStaffelPreset',
    ...Object.keys(CARE_SETTING_NUMBER_DEFAULTS)]);

/**
 * @param {string} id Feldkennung eines Preisfelds.
 * @param {ReturnType<typeof resolveCarePrices>} prices Wirksame Preise.
 * @returns {number} Feldwert.
 */
export const carePriceValue = (id, prices) => id === 'pflegeMaxFloor' ? prices.maximumFloor : id === 'pflegeKostenDrift' ? prices.driftPercent
    : id === 'pflegeHeimEigeneAusgaben' ? prices.ownExpensesMonthly : prices.costs[/^pflegeStufe([1-5])Zusatz$/.exec(id)?.[1]];

/**
 * Vordefinierte Kosten-Staffeln für Pflegegrade.
 * Jede Voreinstellung enthält eine Benutzerbeschreibung und optionale Werte pro Pflegegrad.
 */
export const PFLEGE_COST_PRESETS = Object.freeze({
    custom: {
        label: 'Individuelle Werte',
        description: 'Deine fünf eigenen Beträge werden beim Wechsel zu einer Voreinstellung gemerkt und hier wiederhergestellt, auch nach einem Neustart. Sicherung und Wiederherstellung nehmen sie mit.'
    },
    ambulant: {
        label: 'Ambulant (ab 36 Tsd. €)',
        description: 'Ambulante Leistungen inkl. Haushaltshilfen (PG1 36k → PG5 78k).',
        values: { 1: 36000, 2: 42000, 3: 54000, 4: 66000, 5: 78000 }
    },
    amtlich: {
        label: 'Amtlicher Durchschnitt (Destatis/vdek)',
        description: 'Monte Carlo zieht künftige Heimformen nach Destatis 2023. Bekannte heutige Formen gelten auch im Backtest: im Heim Kosten nach Heimjahr, zu Hause 0 € Zusatz und kein Pflegegeld.',
        // Destatis 22421-01, I34:I38 / C34:C38 × (3.364 € × 12), auf 100 € gerundet.
        values: { 1: 200, 2: 2300, 3: 7100, 4: 15000, 5: 18900 }
    }
});

/** FR-72 Punkt 6: Die Vorgabe „Stationär (Premium)“ entfällt. Ein gespeicherter Wert gilt beim Lesen als
 * „Individuelle Werte“; die fünf Beträge bleiben, gemerkte eigene Beträge überschreiben sie nicht und
 * gespeichert wird erst bei der nächsten Wahl.
 *
 * @param {unknown} value Gespeicherte Voreinstellung.
 * @returns {unknown} Lesewert für die Auswahl.
 */
export const normalizePflegeKostenPreset = value => value === 'stationaer' ? 'custom' : value;

/** Gemerkte „Individuelle Werte“ (Gutachten PFA-2, Befund 7): Ein markierter Datensatz kommt so zurück, wie er gemerkt
 * wurde. Im flachen Altbestand bedeuten alte Vorgabewerte nur „Vorgabe“ und zeigen auf die heute wirksamen Preise des
 * Haushalts, etwa nach einer Fortschreibung; eigene Altbeträge bleiben.
 *
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {Record<number, string>|null} Fünf Beträge als Text oder null.
 */
export function rememberedCareCosts(storage = persistenceStorage) {
    const remembered = parseRememberedCareCosts(careSettingsStorage(storage).getItem(PFLEGE_CUSTOM_COSTS_KEY));
    if (!remembered || remembered.marked || !remembered.defaultGrades.length) return remembered?.values ?? null;
    const prices = resolveCarePrices(readCareValues(storage), careSettingsStorage(storage), { shared: sharesHouseholdCareValues(storage) });
    return Object.fromEntries(GRADES.map(grade => [grade, remembered.defaultGrades.includes(grade) ? String(prices.costs[grade]) : remembered.values[grade]]));
}

/** Merkt die fünf eigenen Beträge beim Wechsel weg von „Individuelle Werte“.
 *
 * @param {Record<number, string>} values Fünf Feldwerte als Text.
 * @param {import("../../typcheck/datenvertraege.js").RecordWriter} [storage]
 * @returns {void}
 */
export function rememberCareCostValues(values, storage = persistenceStorage) {
    careSettingsStorage(/** @type {any} */ (storage)).setItem(PFLEGE_CUSTOM_COSTS_KEY, rememberedCareCostsRecord(values));
}

/** Beträge einer Voreinstellung; „Individuelle Werte“ sind die gemerkten eigenen Beträge.
 *
 * @param {string} presetKey Schlüssel aus {@link PFLEGE_COST_PRESETS}.
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {Record<number, number|string>|null} Beträge je Grad oder null.
 */
export function carePresetValues(presetKey, storage = persistenceStorage) {
    if (presetKey === 'custom') return rememberedCareCosts(storage);
    if (presetKey === 'amtlich') return officialCareCosts(readCareValues(storage));
    return PFLEGE_COST_PRESETS[presetKey]?.values ?? null;
}

/** Bewusste Eingabe des Nutzers: Preisblock mit Herkunft „von Hand“ schreiben; die Markierung schützt vor Umdeutung (B3).
 * Haushaltsmitglieder schreiben den Pflegewerte-Record, Außenpersonen ihren eigenen Preisblock beim eigenen Preisbesitzer
 * (Gutachten PFA-4, Befund 2); abgeleitete amtliche Beträge werden nicht gespeichert.
 *
 * @param {string} id Feldkennung.
 * @param {string} raw Feldwert.
 * @param {{preset?: string}} [options] Gewählte Staffel; ohne Angabe die Auswahl `pflegeKostenStaffelPreset` der Seite.
 * @returns {void}
 */
export function writeCarePriceField(id, raw, { preset = /** @type {HTMLSelectElement|null} */ (globalThis.document?.getElementById?.('pflegeKostenStaffelPreset'))?.value } = {}) {
    if (id.endsWith('Zusatz') && preset === 'amtlich') return;
    const text = String(raw ?? '').trim(), value = Number(text.replace(',', '.'));
    if (!text || !Number.isFinite(value) || value < 0) return;
    const grade = /^pflegeStufe([1-5])Zusatz$/.exec(id)?.[1];
    const patch = id === 'pflegeMaxFloor' ? { maximumFloor: value } : id === 'pflegeHeimEigeneAusgaben' ? { ownExpensesMonthly: value }
        : id === 'pflegeKostenDrift' ? { driftPercent: value } : { costs: { [grade]: value } };
    const priceYear = appNow().getFullYear(), owner = careSettingsStorage(persistenceStorage);
    if (!sharesHouseholdCareValues(persistenceStorage)) {
        owner.setItem(OWN_CARE_PRICES_KEY, JSON.stringify(ownCarePricesWithPatch(owner, patch, { priceYear })));
        return;
    }
    const next = careValuesWithPrices(persistenceStorage.getItem(HOUSEHOLD_CARE_VALUES_KEY), patch, { priceYear, legacySource: owner });
    persistenceStorage.setItem(HOUSEHOLD_CARE_VALUES_KEY, JSON.stringify(next));
}

/** Schreibweg eines Pflegefelds wie der Autosave des Simulators: `sim_<id>` beim Preisbesitzer, bei Preisfeldern
 * zusätzlich der Preisblock.
 *
 * @param {string} id Feldkennung (`pflege…`).
 * @param {string} value Feldwert als Text.
 * @param {{preset?: string}} [options] Siehe {@link writeCarePriceField}.
 * @returns {void}
 */
export function writeCareSettingField(id, value, options) {
    // PFA-12: Vor einem Flex-Level die Altbestandsregel des Simulatorstarts anwenden (wirksame Staffel samt Marke).
    if (CARE_FLEX_FIELD_KEYS.includes(`sim_${id}`)) migrateStoredCareFlex(persistenceStorage);
    careSettingsStorage(persistenceStorage).setItem(`sim_${id}`, value);
    if (CARE_PRICE_FIELD_IDS.has(id)) writeCarePriceField(id, value, options);
}

/** Wahl einer Staffel wie im Simulator: eigene Beträge beim Verlassen von „Individuelle Werte“ merken, die Vorgabe
 * speichern und ihre fünf Beträge wie Eingaben schreiben.
 *
 * @param {string} next Neue Vorgabe.
 * @param {string} previous Bisherige Vorgabe.
 * @param {Record<number, string>} currentCosts Bisherige fünf Beträge als Text.
 * @returns {Record<number, number|string>|null} Geschriebene Beträge oder null.
 */
export function writeCarePreset(next, previous, currentCosts) {
    if (previous === 'custom' && next !== 'custom') rememberCareCostValues(currentCosts);
    const values = carePresetValues(next);
    if (values) for (const grade of GRADES) {
        if (values[grade] != null) writeCareSettingField(`pflegeStufe${grade}Zusatz`, String(values[grade]), { preset: next });
    }
    writeCareSettingField('pflegeKostenStaffelPreset', next, { preset: next });
    return values;
}

/** Feldwerte wie beim Start des Simulators: Preise aus dem Record (sonst Altbestand), Form und Vorgabe aus `sim_<id>`.
 * Liest nur.
 *
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {Record<string, string>} Feldwerte je Kennung.
 */
export function readCareFieldValues(storage = persistenceStorage) {
    const owner = careSettingsStorage(storage);
    const prices = resolveCarePrices(readCareValues(storage), owner, { shared: sharesHouseholdCareValues(storage) });
    const stored = id => resolveCareSetting(`sim_${id}`, owner.getItem(`sim_${id}`));
    // PFA-12: Alte Flex-Vorgabe ohne Marke nur projizieren, wie der Simulator sie beim Start umstellt.
    const flexKeys = [...CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY];
    const flex = migrateCareFlexRecord(Object.fromEntries(flexKeys.map(key => [key, owner.getItem(key)])));
    return Object.fromEntries(CARE_VALUE_FIELD_IDS.map(id => {
        if (CARE_PRICE_FIELD_IDS.has(id)) return [id, String(carePriceValue(id, prices))];
        if (Object.hasOwn(CARE_SETTING_NUMBER_DEFAULTS, id)) {
            const raw = Object.hasOwn(flex, `sim_${id}`) ? flex[`sim_${id}`] : owner.getItem(`sim_${id}`), parsed = Number(String(raw ?? '').replace(',', '.'));
            return [id, raw == null || String(raw).trim() === '' || !Number.isFinite(parsed) ? String(CARE_SETTING_NUMBER_DEFAULTS[id]) : String(parsed)];
        }
        const grade = /^pflegeStufe([1-5])Form$/.exec(id)?.[1];
        const raw = stored(id);
        if (grade) return [id, raw == null || raw === '' ? defaultCareForm(Number(grade)) : normalizeCareForm(raw, grade)];
        const preset = normalizePflegeKostenPreset(raw);
        return [id, typeof preset === 'string' && Object.hasOwn(PFLEGE_COST_PRESETS, preset) ? preset : 'custom'];
    }));
}

const euro = value => Math.round(value).toLocaleString('de-DE');

/** UR-2: Pflegegeld je Grad und Heim-Bestandteile, die der Reiter Pflege jederzeit ändert; sie gehören zum Pflegewerte-Record
 * des Haushalts (`household_care_values_v1`), nicht zu `sim_<id>`. */
/** UR-2b: Obergrenzen der Eingabe (€/Monat); gespeicherte Altbestände liest `parseCareValues` weiter ohne Grenze. */
export const CARE_RECORD_LIMITS = Object.freeze({ allowance: 10000, residential: 100000 });
export const CARE_RECORD_FIELDS = Object.freeze({
    careAllowance2: ['allowance', 2], careAllowance3: ['allowance', 3], careAllowance4: ['allowance', 4], careAllowance5: ['allowance', 5],
    careResidentialCare: ['residential', 'care'], careResidentialBoard: ['residential', 'board'], careResidentialInvest: ['residential', 'invest']
});

/** UR-2b: Grund bei überschrittener Obergrenze.
 *
 * @param {string} id Kennung aus {@link CARE_RECORD_FIELDS}.
 * @returns {string} Meldung für Feld und Status.
 */
export function careRecordLimitText(id) {
    const part = CARE_RECORD_FIELDS[id]?.[0];
    return `Bitte höchstens ${CARE_RECORD_LIMITS[part].toLocaleString('de-DE')} €/Monat eintragen; der bisherige Wert bleibt.`;
}

/** UR-2: Ein Pflegegeld- oder Heimbetrag (€/Monat) in den Pflegewerte-Record des Haushalts, wie „Werte ändern …“ im
 * Jahresabschluss: Geändert werden nur der Wert, `origin: 'von Hand'`, `asOf` und `validFrom` (laufender Monat, im
 * Spielbereich das Testdatum); Quelle und Bestätigungsjahr bleiben. Beim Heim rechnet der Eigenanteil des ersten Jahres
 * neu. Geprüft mit `parseCareValues`; ein unveränderter Betrag schreibt nichts. Die Werte gelten für den Haushalt,
 * deshalb ändert sie nur eine Person, die zum Haushalt gehört.
 *
 * @param {string} id Kennung aus {@link CARE_RECORD_FIELDS}.
 * @param {string|number} raw Betrag in €/Monat (kanonischer Text oder Zahl).
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordStorage}} [options]
 * @returns {boolean} Ob geschrieben wurde.
 */
export function writeCareRecordField(id, raw, { storage = persistenceStorage } = {}) {
    const target = CARE_RECORD_FIELDS[id];
    if (!target) throw new Error(`Unbekanntes Pflegewertfeld: ${id}`);
    if (!sharesHouseholdCareValues(storage)) throw new Error('Pflegegeld und Heimwerte gelten für den Haushalt; ändern in der Ansicht einer Person im Haushalt.');
    const text = String(raw ?? '').trim(), value = Number(text.replace(',', '.'));
    if (!text || !Number.isFinite(value) || value < 0) throw new Error('Bitte einen Betrag ab 0 eintragen.');
    if (value > CARE_RECORD_LIMITS[target[0]]) throw new Error(careRecordLimitText(id));
    const current = readCareValues(storage), next = structuredClone(current), month = localCalendarDate().slice(0, 7);
    const [part, key] = target;
    if (part === 'allowance') {
        if (current.allowance.values[key] === value) return false;
        next.allowance.values[key] = value;
    } else {
        const { care, board, invest } = residentialComponents(current.residential), components = { care, board, invest };
        if (components[key] === value) return false;
        components[key] = value;
        next.residential = { ...next.residential, components, monthly: residentialMonthly(components) };
    }
    Object.assign(next[part], { origin: 'von Hand', asOf: month, validFrom: month });
    storage.setItem(HOUSEHOLD_CARE_VALUES_KEY, JSON.stringify(parseCareValues(next)));
    return true;
}

/** Eine Zeile mit den wirksamen Pflegewerten für den Simulator (PFA-10): Staffel je Monat, Heim im ersten Jahr,
 * Kostenanstieg, regionaler Zuschlag und Flex-Level je Grad (PFA-11) sowie Preisstand. Liest nur.
 *
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {string} Zusammenfassung.
 */
export function careValuesSummaryText(storage = persistenceStorage) {
    const values = readCareFieldValues(storage), careValues = readCareValues(storage);
    const owner = careSettingsStorage(storage), shared = sharesHouseholdCareValues(storage);
    const prices = resolveCarePrices(careValues, owner, { shared });
    const staffel = values.pflegeKostenStaffelPreset === 'amtlich' ? 'Amtlicher Durchschnitt'
        : `Staffel ${GRADES.map(grade => euro(prices.costs[grade] / 12)).join(' / ')} €/Monat`;
    const stand = prices.priceYear ? `Preisstand ${prices.priceYear}` : prices.origin;
    const percent = id => Number(values[id]).toLocaleString('de-DE');
    const regional = values.pflegeRegionalZuschlag === '0' ? '' : `, regionaler Zuschlag ${percent('pflegeRegionalZuschlag')} %`;
    const flex = `Flex-Level ${GRADES.map(grade => percent(`pflegeStufe${grade}FlexCut`)).join(' / ')} %`;
    return `${shared ? '' : 'eigene Werte · '}${staffel}, Heim ${euro(careValues.residential.monthly)} €/Monat im ersten Jahr, Kostenanstieg Inflation + ${prices.driftPercent.toLocaleString('de-DE')} %${regional} · ${flex} · ${stand}`;
}

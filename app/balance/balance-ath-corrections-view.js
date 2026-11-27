/** ATH-1b: Allzeithoch unter Balance › „Alle Parameter“ › „Marktdaten-Korrektur“ prüfen. Tageskurs nicht verwenden oder wieder
 * verwenden, Split eintragen, Warnung beim Senken des gespeicherten Hochs. Es gibt keinen automatischen Filter. */
/** @import * as D from '../../typcheck/datenvertraege.js' */
import { readAthCorrections, ignoreDailyClose, restoreDailyClose, planSplit, applySplit, SPLIT_MARKET_FIELDS } from './balance-ath-corrections.js';
import { marketHighSource, marketHighWarningTexts } from './balance-market-preview-renderer.js';
import { readDailyPrices, historyDay } from '../tranches/tranchen-history-store.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { requestPageConfirmation } from '../shared/page-dialog.js';
import { MARKET_DISPLAY_DECIMALS, readExactFieldValue, setExactFieldValue } from './balance-exact-field.js';
import { StorageManager } from './balance-storage.js';
import { BALANCE_UPDATE_MODE } from './balance-update-pipeline.js';
import { registeredPlanTrial } from '../shared/plan-trial.js';

/** ATH-1c: Die Korrekturen schreiben den Balance-Stand direkt und würden am Versuch vorbei bleiben. */
export const ATH_TRIAL_LOCKED_TEXT = 'Im Ausprobieren nicht möglich – erst ‚Zurück zum Plan‘.';
/** ATH-1c: Ohne Jahresstand der Vorschau lässt sich die Sperre „erst Jahresabschluss“ nicht prüfen. */
export const ATH_SPLIT_YEAR_UNKNOWN_TEXT = 'Jahresstand gerade unklar – Split bitte später eintragen.';

/** @typedef {ReturnType<typeof import('./balance-market-preview.js').projectMarketPreview>} MarketPreview */
/** @param {string|null|undefined} value */
const date = value => value ? value.split('-').reverse().join('.') : 'Datum nicht belegt';
/** @param {number|null|undefined} value */
const price = value => typeof value === 'number' && Number.isFinite(value) ? `${formatDisplayNumber(value, { fractionDigits: 2 })} €` : '—';
/** @param {Document} doc @param {string} tag @param {string} [text] @param {string} [className] */
const make = (doc, tag, text = '', className = '') => { const node = doc.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
/** @param {Document} doc @param {string} text @param {Record<string, string>} data */
const button = (doc, text, data) => {
    const node = /** @type {HTMLButtonElement} */ (make(doc, 'button', text, 'ds-button ds-button-secondary'));
    node.type = 'button';
    for (const [key, value] of Object.entries(data)) node.dataset[key] = value;
    return node;
};

/** Herkunft des gespeicherten Hochs für die Kachel „Allzeithoch“: Tagesschluss, Jahresschluss, gespeicherter Wert, nach Split.
 * @param {D.BalanceState|null|undefined} state @param {number|undefined} ath */
export function storedHighSource(state, ath) {
    const meta = /** @type {any} */ (state)?.annualMarketDataMeta;
    const asOf = meta?.ath && meta.ath.value === ath ? meta.ath.lastHighAsOf || null : null;
    const text = !asOf ? 'gespeicherter Wert' : `${asOf === meta.asOf ? 'Jahresschluss' : 'Tagesschluss'} vom ${date(asOf)}`;
    const split = readAthCorrections(state).splits.filter(entry => !asOf || entry.asOf > asOf).at(-1);
    return split ? `${text} · nach Split am ${date(split.asOf)}` : text;
}

/** Hinweis beim Senken des gespeicherten Hochs; eine Warnung, keine Sperre. @param {number} baseline @param {number} value */
export function athLowerWarningText(baseline, value) {
    if (!Number.isFinite(baseline) || !Number.isFinite(value) || !(value < baseline)) return null;
    return `Du senkst das gespeicherte Hoch von ${price(baseline)} auf ${price(value)}. Ein Hoch, das älter ist als die gespeicherten Tageskurse, geht damit verloren.`;
}

/** Block „Allzeithoch aus Tageskursen“: verwendetes Hoch mit Herkunft und Warnhinweisen, „nicht verwenden“, Liste der nicht
 * verwendeten Tage mit „Wieder verwenden“, Split mit Datum und Verhältnis.
 * @param {Document} doc @param {{state: D.BalanceState|null|undefined, view?: MarketPreview|object|null, prices?: import('../../typcheck/tranches-history.js').DailyPrices|null}} context */
export function createAthCorrectionsBlock(doc, { state, view, prices = null }) {
    const root = make(doc, 'div', '', 'balance-ath-corrections'); root.dataset.athCorrections = '';
    const corrections = readAthCorrections(state);
    const preview = view && 'high' in view && 'warnings' in view ? /** @type {MarketPreview} */ (view) : null;
    // FIX-ST9 (Befund 1612): Der Satz zur Sperre im Ausprobieren steht von Anfang an über dem Block (syncAthTrialLock).
    const lock = make(doc, 'p', ATH_TRIAL_LOCKED_TEXT, 'ds-note ds-note-warning'); lock.dataset.athTrialLock = ''; lock.hidden = true;
    root.append(lock, make(doc, 'h4', 'Allzeithoch aus Tageskursen'));
    if (preview) {
        const line = make(doc, 'p', `Verwendet: ${price(preview.high.value)} · ${marketHighSource(preview.high)}`, 'ds-source');
        line.dataset.athUsedHigh = '';
        root.append(line);
        for (const text of marketHighWarningTexts(preview.warnings)) {
            const note = make(doc, 'p', text, 'ds-note ds-note-warning'); note.dataset.athWarning = ''; root.append(note);
        }
        if (preview.high.origin === 'daily_close' && preview.high.asOf) {
            const actions = make(doc, 'div', '', 'ds-actions');
            actions.append(button(doc, `Tageskurs vom ${date(preview.high.asOf)} nicht verwenden`, { athIgnore: preview.high.asOf }));
            root.append(actions);
        }
    } else root.append(make(doc, 'p', 'Ohne Tageskurs seit dem Jahresende gilt das gespeicherte Hoch.', 'ds-source'));
    if (corrections.ignoredCloses.length) {
        root.append(make(doc, 'h5', 'Nicht verwendete Tageskurse'));
        const series = prices?.symbols?.['VWCE.DE'];
        for (const asOf of corrections.ignoredCloses) {
            const index = series ? series.days.indexOf(historyDay(asOf)) : -1;
            const row = make(doc, 'div', '', 'balance-row ds-row'); row.dataset.athIgnored = asOf;
            row.append(make(doc, 'span', `${date(asOf)} · ${index >= 0 ? price(series?.closes[index]) : 'Kurs nicht mehr gespeichert'}`),
                button(doc, 'Wieder verwenden', { athRestore: asOf }));
            root.append(row);
        }
    }
    root.append(make(doc, 'h5', 'Split'));
    for (const split of corrections.splits) {
        const row = make(doc, 'p', `Split 1:${formatDisplayNumber(split.ratio, { fractionDigits: 2, minimumFractionDigits: 0 })} am ${date(split.asOf)} · Allzeithoch ${price(split.before.ath)} → ${price(split.after.ath)}`, 'ds-source');
        row.dataset.athSplit = split.asOf; root.append(row);
    }
    const fields = make(doc, 'div', '', 'household-plan-rows');
    const field = (/** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ type, /** @type {string} */ unit) => {
        const wrap = make(doc, 'div', '', 'household-plan-field'), name = make(doc, 'label', label); name.setAttribute('for', id);
        const input = /** @type {HTMLInputElement} */ (make(doc, 'input', '', 'ds-input')); input.id = id; input.type = type;
        if (type === 'number') { input.min = '0'; input.step = '0.01'; input.placeholder = '2'; }
        const frame = make(doc, 'div', '', 'ds-unit-frame'); frame.append(input);
        if (unit) frame.append(make(doc, 'span', unit));
        wrap.append(name, frame); return wrap;
    };
    fields.append(field('athSplitDate', 'Split am', 'date', ''), field('athSplitRatio', 'Verhältnis', 'number', '1:x'));
    const splitActions = make(doc, 'div', '', 'ds-actions'); splitActions.append(button(doc, 'Split eintragen …', { athSplitSubmit: '' }));
    const status = make(doc, 'p', '', 'ds-note ds-note-warning'); status.id = 'athSplitStatus'; status.hidden = true; status.setAttribute('role', 'status');
    root.append(fields, make(doc, 'p', 'Teilt Allzeithoch und die vier Jahresschlüsse einmal durch das Verhältnis, etwa 2 für 1:2. Tagesschlüsse vor dem Splitdatum zählen danach nicht mehr. Stückzahlen und Einstand der Tranchen passt du in Personen & Vermögen an.', 'ds-help'), splitActions, status);
    return root;
}

/** @param {Element} node @returns {Element[]} alle Nachfahren, auch ohne querySelectorAll */
const descendants = node => Array.from(node?.children || []).flatMap(child => [child, ...descendants(child)]);
/** @param {Document} doc */
const pageTrialActive = doc => registeredPlanTrial(doc)?.read?.().active === true;

/** FIX-ST9 (Befund 1612): Im Ausprobieren sind „nicht verwenden“, „Wieder verwenden“, „Split eintragen …“ und die Split-Felder
 * sichtbar gesperrt, der Satz steht über dem Block; nach „Zurück zum Plan“ ist alles frei. Der Klickschutz bleibt zusätzlich.
 * @param {Document} doc @param {boolean} active */
export function syncAthTrialLock(doc, active) {
    const host = doc?.getElementById?.('athCorrections');
    if (!host) return;
    for (const node of /** @type {(HTMLInputElement & HTMLElement)[]} */ (descendants(host))) {
        const data = node.dataset || {};
        if ('athIgnore' in data || 'athRestore' in data || 'athSplitSubmit' in data || ['athSplitDate', 'athSplitRatio'].includes(node.id)) node.disabled = active;
        if ('athTrialLock' in data) node.hidden = !active;
    }
}

/** Füllt den Platz unter „Marktdaten-Korrektur“ und merkt das gespeicherte Hoch als Bezug für die Warnung beim Senken.
 * @param {Document} doc @param {{state: D.BalanceState|null|undefined, view?: object|null, trialActive?: boolean}} context */
export function renderAthCorrections(doc, { state, view, trialActive = pageTrialActive(doc) }) {
    const host = doc?.getElementById?.('athCorrections');
    if (!host) return;
    let prices = null;
    try { prices = readDailyPrices(persistenceStorage).value ?? null; } catch { prices = null; }
    // Begonnene Split-Eingaben überstehen das Neuzeichnen nach einer Aktualisierung.
    const kept = ['athSplitDate', 'athSplitRatio'].map(id => /** @type {HTMLInputElement|null} */ (doc.getElementById(id))?.value ?? '');
    host.replaceChildren(createAthCorrectionsBlock(doc, { state, view, prices }));
    ['athSplitDate', 'athSplitRatio'].forEach((id, index) => { const input = /** @type {HTMLInputElement|null} */ (doc.getElementById(id)); if (input && kept[index]) input.value = kept[index]; });
    const meta = /** @type {any} */ (state)?.annualMarketDataMeta?.ath;
    const baseline = Number.isFinite(meta?.value) ? meta.value : Number(/** @type {any} */ (state)?.inputs?.ath);
    host.dataset.athBaseline = Number.isFinite(baseline) ? String(baseline) : '';
    // Nächstes Abschlussjahr der Vorschau (bei offenem Vorjahresabschluss das Vorjahr); ein späterer Split wartet darauf.
    const yearEnd = view && 'yearEndDate' in view ? view.yearEndDate : null;
    host.dataset.athClosingYear = yearEnd ? String(Number(yearEnd.slice(0, 4)) + 1) : '';
    syncAthTrialLock(doc, trialActive);
    updateAthLowerWarning(doc);
}

/** @param {Document} doc */
export function updateAthLowerWarning(doc) {
    const note = doc?.getElementById?.('athLowerWarning'), field = /** @type {HTMLInputElement|null} */ (doc?.getElementById?.('ath'));
    const baseline = Number(doc?.getElementById?.('athCorrections')?.dataset.athBaseline || NaN);
    if (!note || !field) return;
    const text = athLowerWarningText(baseline, Number(String(readExactFieldValue(field)).replace(',', '.')));
    note.hidden = !text; note.textContent = text || '';
}

const boundDocuments = new WeakSet();
/** Aktionen: nicht verwenden, wieder verwenden, Split eintragen. Schreibt nur den Balance-Stand und speichert danach wie die
 * Eingabefelder. Während „Nur hier ausprobieren“ sind alle drei gesperrt (ATH-1c).
 * @param {Document} doc @param {{update: (options: object) => unknown, blocked?: () => boolean, storage?: typeof StorageManager,
 * trialActive?: () => boolean}} options */
export function bindAthCorrections(doc, { update, blocked = () => false, storage = StorageManager,
    trialActive = () => pageTrialActive(doc) }) {
    if (boundDocuments.has(doc)) return;
    boundDocuments.add(doc);
    // Start und Ende des Versuchs (auch „Zurück zum Plan“) sperren bzw. geben die Korrekturen sofort frei.
    doc.addEventListener('balance:plan-trial', () => syncAthTrialLock(doc, trialActive()));
    // Split-Felder sind keine Balance-Eingaben: kein Neurechnen und Speichern beim Tippen.
    for (const type of ['input', 'change']) doc.addEventListener(type, event => {
        if (['athSplitDate', 'athSplitRatio'].includes(/** @type {HTMLElement} */ (event.target)?.id)) event.stopPropagation();
    }, true);
    doc.addEventListener('input', event => { if (/** @type {HTMLElement} */ (event.target)?.id === 'ath') updateAthLowerWarning(doc); });
    doc.addEventListener('click', async event => {
        const target = /** @type {HTMLElement|null} */ (event.target);
        const action = target?.closest?.('[data-ath-ignore], [data-ath-restore], [data-ath-split-submit]');
        if (!action || blocked()) return;
        const data = /** @type {HTMLElement} */ (action).dataset;
        const status = doc.getElementById('athSplitStatus');
        const say = (/** @type {string} */ text) => { if (status) { status.hidden = false; status.textContent = text; } };
        if (trialActive()) { say(ATH_TRIAL_LOCKED_TEXT); return; }
        if (data.athIgnore || data.athRestore) {
            const state = storage.loadState();
            storage.saveState(data.athIgnore ? ignoreDailyClose(state, data.athIgnore) : restoreDailyClose(state, /** @type {string} */ (data.athRestore)));
            update({ mode: BALANCE_UPDATE_MODE.PREVIEW });
            return;
        }
        const read = (/** @type {string} */ id) => readExactFieldValue(doc.getElementById(id));
        try {
            const state = storage.loadState();
            const inputs = Object.fromEntries(SPLIT_MARKET_FIELDS.map(field => [field, Number(String(read(field)).replace(',', '.'))]));
            const closingYear = Number(doc.getElementById('athCorrections')?.dataset.athClosingYear || NaN);
            if (!Number.isInteger(closingYear)) throw new Error(ATH_SPLIT_YEAR_UNKNOWN_TEXT);
            const split = planSplit({ state, inputs, asOf: read('athSplitDate'), ratio: Number(String(read('athSplitRatio')).replace(',', '.')), closingYear });
            const lines = SPLIT_MARKET_FIELDS.map(field => `${({ ath: 'Allzeithoch', endeVJ: 'Ende Vorjahr', endeVJ_1: 'Ende Vorjahr − 1', endeVJ_2: 'Ende Vorjahr − 2', endeVJ_3: 'Ende Vorjahr − 3' })[field]}: ${price(split.before[field])} → ${price(split.after[field])}`);
            const confirmed = await requestPageConfirmation({ doc, title: `Split 1:${formatDisplayNumber(split.ratio, { fractionDigits: 2, minimumFractionDigits: 0 })} am ${date(split.asOf)} eintragen`,
                description: `${lines.join('\n')}\nTagesschlüsse vor dem ${date(split.asOf)} zählen danach nicht mehr für das Hoch. Stückzahlen und Einstand der Tranchen ändert der Split nicht.`,
                confirmLabel: 'Split eintragen', opener: /** @type {HTMLElement} */ (action) });
            if (!confirmed) return;
            storage.saveState(applySplit(storage.loadState(), split));
            for (const field of SPLIT_MARKET_FIELDS) { const input = /** @type {HTMLInputElement|null} */ (doc.getElementById(field)); setExactFieldValue(input, split.after[field], MARKET_DISPLAY_DECIMALS[field]); }
            update({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS });
        } catch (error) {
            say(/** @type {Error} */ (error).message);
        }
    });
}

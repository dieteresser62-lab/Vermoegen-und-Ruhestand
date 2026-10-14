// Präsentation auf den bestehenden Controls; keine eigenen Parameter oder Defaults.
import { refreshDynamicFlexControls } from './simulator-main-dynamic-flex.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';

const bindings = new WeakSet();
const segmentGroups = new WeakMap();
const numberDisplays = new WeakMap();
const observers = new WeakMap();

function refreshNumberDisplay(input) {
    const display = numberDisplays.get(input);
    if (!display) return;
    // Leere/ungültige Eingaben sind keine Null. BadInput bleibt im Editor sichtbar.
    const raw = String(input.value);
    const valid = raw.trim() !== '' && Number.isFinite(Number(raw)) && !input.validity?.badInput;
    const projected = valid ? Number(raw).toLocaleString('de-DE', { maximumFractionDigits: 20 }) : raw;
    if (display.textContent !== projected) display.textContent = projected;
    input.classList.toggle('sim-number-projected', valid);
}

// Wie bei der bestehenden Select-Volltextanzeige nur die gebundene Instanz
// erweitern. Der native Setter behält Normalisierung, Validierung und Empfänger.
function bindNumberSetters(input) {
    for (const property of ['value', 'valueAsNumber']) {
        let owner = input;
        let descriptor;
        while (owner && !descriptor) {
            descriptor = Object.getOwnPropertyDescriptor(owner, property);
            owner = Object.getPrototypeOf(owner);
        }
        if (!descriptor?.get || !descriptor?.set) continue;
        const { get, set, enumerable } = descriptor;
        Object.defineProperty(input, property, {
            configurable: true, enumerable,
            get() { return get.call(this); },
            set(value) {
                set.call(this, value);
                refreshNumberDisplay(this);
            }
        });
    }
}

// Nur Anzeigeprojektion; der native Editor behält Wert, Validierung und Events.
export function refreshAssumptionNumbers(doc = globalThis.document) {
    doc?.querySelectorAll?.('#tab-annahmen input[type="number"]').forEach(input => {
        if (!input.parentNode || !input.ownerDocument) return;
        let display = numberDisplays.get(input);
        if (!display) {
            display = doc.createElement('span');
            display.className = 'sim-number-display';
            display.setAttribute('aria-hidden', 'true');
            input.parentNode.insertBefore(display, input.nextSibling);
            input.classList.add('sim-number-editor');
            numberDisplays.set(input, display);
            bindNumberSetters(input);
        }
        refreshNumberDisplay(input);
    });
}

function refreshFieldOrigins(doc) {
    doc?.querySelectorAll?.('#tab-annahmen .ds-field-reason').forEach(reason => {
        const frame = reason.parentElement;
        if (frame?.classList.contains('ds-unit-frame')) frame.parentNode.insertBefore(reason, frame.nextSibling);
        // Der gemeinsame Feldbesitzer setzt Gründe direkt hinter den Input.
        // Im Schalterlabel muss dort der Slider für checked/focus bleiben.
        if (frame?.classList.contains('ds-toggle')) frame.parentNode.insertBefore(reason, frame.nextSibling);
    });
    doc?.querySelectorAll?.('#tab-annahmen [data-field-state="adopted"]').forEach(input => {
        if (!input.matches('input, select')) return;
        const label = doc.querySelector(`label[for="${input.id}"]`) ?? input.closest('label');
        const reason = (input.getAttribute('aria-describedby') || '').split(/\s+/)
            .map(id => doc.getElementById(id)?.textContent ?? '').filter(Boolean).join(' ');
        if (label && reason && label.title !== reason) label.title = reason;
    });
}

export function refreshAssumptionFillStatus(doc = globalThis.document) {
    const goldActive = doc?.getElementById?.('goldAllokationAktiv')?.value === 'true';
    const goldOff = doc?.getElementById?.('simGoldOff');
    const goldFrame = doc?.getElementById?.('simGoldBandFrame');
    if (goldOff) goldOff.hidden = goldActive;
    if (goldFrame) goldFrame.dataset.goldActive = String(goldActive);
    const careSummary = doc?.getElementById?.('simCareSummary');
    if (careSummary) {
        const active = doc.getElementById('pflegefallLogikAktivieren')?.checked;
        const model = doc.getElementById('pflegeModellTyp')?.value === 'akut' ? 'akut' : 'chronisch';
        const amount = Number(doc.getElementById('pflegeMaxFloor')?.value);
        const drift = Number(doc.getElementById('pflegeKostenDrift')?.value);
        const number = value => Number.isFinite(value) ? value.toLocaleString('de-DE') : '—';
        const text = active ? `${model} · bis ${number(amount)} € pro Jahr · Kostenanstieg Inflation + ${number(drift)} %`
            : 'Pflegefälle werden nicht gerechnet.';
        if (careSummary.textContent !== text) careSummary.textContent = text;
    }
    // Detail-Partnerfelder vor der Zählung an den bestehenden Host angleichen.
    const partnerHost = doc?.getElementById?.('sectionRente2');
    if (partnerHost) doc.querySelectorAll?.('.sim-partner-detail').forEach(group => {
        const hidden = partnerHost.style.display === 'none';
        if (group.hidden !== hidden) group.hidden = hidden;
    });
    doc?.querySelectorAll?.('[data-assumption-step]').forEach(step => {
        const filled = [...step.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), select')]
            .some(input => !input.disabled && input.value && input.value !== '0');
        step.classList.toggle('has-data', Boolean(filled));
        const chip = step.querySelector('.sim-step-status') ?? step.querySelector('.progress-indicator');
        chip?.setAttribute('aria-label', filled ? 'Eingaben vorhanden' : 'Keine Eingaben');
        if (chip) {
            const number = step.dataset?.assumptionStep;
            const selected = number === '1' ? doc.querySelectorAll('#simProfileList input:checked').length : 0;
            const adopted = [...step.querySelectorAll('[data-field-state="adopted"]')].length;
            const care = number === '5' ? doc.getElementById('pflegefallLogikAktivieren') : null;
            const text = selected ? `${selected} ${selected === 1 ? 'Profil' : 'Profile'}` : care ? (care.checked ? 'aktiv' : 'aus')
                : adopted ? 'teilweise aus Profilen' : filled ? 'Eingaben vorhanden' : 'Keine Eingaben';
            if (chip.textContent !== text) chip.textContent = text;
            chip.setAttribute('aria-label', `${text} · ${filled ? 'Eingaben vorhanden' : 'Keine Eingaben'}`);
            chip.dataset.fill = filled ? 'filled' : 'empty';
        }
    });
    doc?.querySelectorAll?.('#tab-annahmen .sim-parameters').forEach(detail => {
        const summary = detail.querySelector('summary');
        if (!summary) return;
        let count = summary.querySelector('.sim-parameter-count');
        if (!count) {
            count = doc.createElement('span'); count.className = 'sim-parameter-count'; summary.appendChild(count);
        }
        const additional = [...detail.querySelectorAll('input:not([type="hidden"]), select')]
            .filter(input => {
                if (input.disabled) return false;
                // Die Klappe selbst und der Schritt dürfen geschlossen sein;
                // fachlich/technisch verborgene Untergruppen zählen nicht mit.
                for (let node = input; node && node !== detail; node = node.parentElement ?? node.parentNode) {
                    const style = doc.defaultView?.getComputedStyle?.(node) ?? node.style;
                    if (node.hidden || style?.display === 'none' || style?.visibility === 'hidden') return false;
                }
                return true;
            }).length;
        const text = `${additional} weitere`;
        if (count.textContent !== text) count.textContent = text;
        if (detail.hidden !== (additional === 0)) detail.hidden = additional === 0;
    });
    const duration = doc?.getElementById?.('simCareDurationDisplay');
    if (duration) duration.hidden = doc.getElementById('pflegeModellTyp')?.value === 'akut';
    refreshAssumptionSegments(doc);
    refreshAssumptionNumbers(doc);
    refreshFieldOrigins(doc);
}

export function refreshAssumptionSegments(doc = globalThis.document) {
    doc?.querySelectorAll?.('[data-select-segment]').forEach(group => {
        const select = doc.getElementById(group.dataset.selectSegment);
        if (!select) return;
        const buttons = [...group.querySelectorAll('button[data-value]')];
        if (!buttons.length) return;
        segmentGroups.set(select, group);
        const state = select.dataset.fieldState || 'editable';
        if (group.dataset.fieldState !== state) group.dataset.fieldState = state;
        select.classList.add('sim-segment-source');
        select.setAttribute('tabindex', '-1');
        select.setAttribute('aria-hidden', 'true');
        group.classList.add('sim-segment-ready');
        const label = doc.querySelector(`label[for="${select.id}"]`);
        if (label?.textContent.trim()) group.setAttribute('aria-label', label.textContent.trim());
        buttons.forEach(button => {
            button.disabled = select.disabled;
            button.setAttribute('aria-pressed', String(select.value === button.dataset.value));
        });
    });
}

function openStep(step) {
    const button = step?.querySelector('[data-step-toggle]');
    const body = step?.querySelector('.sim-step-content');
    if (!button || !body) return;
    body.hidden = false;
    button.setAttribute('aria-expanded', 'true');
}

export function revealAssumptionControl(control) {
    openStep(control?.closest?.('[data-assumption-step]'));
    for (let parent = control?.parentElement; parent; parent = parent.parentElement) {
        if (parent.matches('details')) parent.open = true;
    }
    const group = segmentGroups.get(control);
    const buttons = group ? [...group.querySelectorAll('button[data-value]')].filter(button => !button.disabled) : null;
    const target = buttons ? buttons.find(button => button.getAttribute('aria-pressed') === 'true') ?? buttons[0] : control;
    target?.focus();
}

export function initializeAssumptionsUI(doc = globalThis.document) {
    const host = doc?.getElementById('tab-annahmen');
    if (!host || bindings.has(doc)) return;
    bindings.add(doc);
    if (doc.addEventListener) bindInfoPopovers({
        querySelectorAll: selector => host.querySelectorAll(selector),
        addEventListener: (...args) => doc.addEventListener(...args),
        get activeElement() { return doc.activeElement; }
    });
    host.addEventListener('click', event => {
        const label = event.target.closest('label[for]');
        const labelledControl = label && doc.getElementById(label.getAttribute('for'));
        if (labelledControl && segmentGroups.has(labelledControl)) {
            event.preventDefault();
            revealAssumptionControl(labelledControl);
        }
        const toggle = event.target.closest('[data-step-toggle]');
        if (toggle) {
            const body = doc.getElementById(toggle.getAttribute('aria-controls'));
            body.hidden = !body.hidden;
            toggle.setAttribute('aria-expanded', String(!body.hidden));
        }
        const segment = event.target.closest('[data-select-segment] button[data-value]');
        if (segment) {
            const select = doc.getElementById(segment.closest('[data-select-segment]').dataset.selectSegment);
            if (select && !select.disabled && select.value !== segment.dataset.value) {
                select.value = segment.dataset.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    // Die gemeinsame Klappe zeigt auch die bisherige Dynamik-Detailansicht.
    host.querySelector('[data-parameters="strategie"]')?.addEventListener('toggle', () => {
        refreshDynamicFlexControls();
        refreshAssumptionFillStatus(doc);
    });
    host.addEventListener('input', () => refreshAssumptionFillStatus(doc));
    host.addEventListener('change', () => refreshAssumptionFillStatus(doc));
    host.addEventListener('focusin', () => refreshAssumptionNumbers(doc));
    host.addEventListener('focusout', () => refreshAssumptionNumbers(doc));
    doc.addEventListener?.('simulator:tab', () => refreshAssumptionFillStatus(doc));
    // Vorhandene Controller ändern Sperren/Herkunft auch ohne Domainereignis.
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer) {
        const observer = new Observer(() => {
            observer.disconnect();
            refreshAssumptionFillStatus(doc);
            observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'data-field-state', 'style', 'hidden'] });
        });
        observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'data-field-state', 'style', 'hidden'] });
        observers.set(doc, observer);
    }
    refreshAssumptionFillStatus(doc);
}

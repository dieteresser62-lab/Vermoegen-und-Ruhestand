import { detectDynamicFlexPreset } from '../shared/dynamic-flex-presets.js';
import { syncDynamicFlexPresetSelection, refreshDynamicFlexControls } from '../simulator/simulator-main-dynamic-flex.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { UIUtils } from './balance-utils.js';

/** Lesende Kacheln verwenden dieselben Werte wie die aktuelle Balancevorschau. */
export function renderBalanceStrategyValues(doc, input, marketYear) {
    if (!doc?.getElementById) return;
    const set = (id, text) => { const node = doc?.getElementById(id); if (node) node.textContent = text; };
    const currency = value => Number.isFinite(value) ? UIUtils.formatBalanceCurrency(value) : '—';
    const price = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
    for (const [id, offset] of [['endeVJ', 0], ['endeVJ_1', 1], ['endeVJ_2', 2], ['endeVJ_3', 3]]) {
        set(`balanceMarket-${id}-value`, price(input[id]));
        set(`balanceMarket-${id}-detail`, String(marketYear - offset));
    }
    set('balanceMarket-ath-value', price(input.ath));
    set('balanceMarket-ath-detail', Number.isFinite(input.jahreSeitAth)
        ? input.jahreSeitAth === 0 ? 'aktuell'
            : input.jahreSeitAth < 0.1 ? 'vor weniger als 0,1 Jahren'
            : `vor ${formatDisplayNumber(input.jahreSeitAth)} Jahren` : 'Zeit seit Hoch nicht belegt');
    set('balanceMarket-cape-value', `${Number.isFinite(input.marketCapeRatio) ? formatDisplayNumber(input.marketCapeRatio, { fractionDigits: 2, minimumFractionDigits: 0 }) : '—'} · ${Number.isFinite(input.inflation) ? formatDisplayNumber(input.inflation, { unit: 'percent' }) : '—'}`);
    set('balanceAdopt-costs-value', [input.costBasisAlt, input.costBasisNeu, input.goldCost].every(Number.isFinite)
        ? currency(input.costBasisAlt + input.costBasisNeu + input.goldCost) : '—');
    set('balanceAdopt-costs-detail', 'Teilfreistellung je Tranche');
    const frame = doc?.getElementById('balanceGoldBandFrame'), off = doc?.getElementById('balanceGoldOff');
    if (frame) frame.dataset.goldActive = String(input.goldAktiv === true);
    if (off) off.hidden = input.goldAktiv === true || doc.getElementById('rebalancingBand')?.dataset.planTrialReadonly === 'false';
}

// Reiner DOM-Adapter. Werte und Sperren gehören weiterhin den nativen Controls;
// nur ein ausdrücklicher Segmentklick löst deren bestehendes change aus.
const bindings = new WeakMap();
const yearBindings = new WeakMap();

const sizeBindings = new WeakMap();

const whyBindings = new WeakMap();
/** Ansichtszustand gilt nur bis zum nächsten Ergebnisrender. */
export function bindBalanceBudgetWhy(button, region, available) {
    if (region) region.hidden = true;
    if (!button) return;
    button.hidden = !available;
    button.setAttribute('aria-expanded', 'false');
    let binding = whyBindings.get(button);
    if (!binding) {
        binding = { region };
        button.addEventListener('click', () => {
            if (button.hidden || !binding.region) return;
            binding.region.hidden = !binding.region.hidden;
            button.setAttribute('aria-expanded', String(!binding.region.hidden));
        });
        whyBindings.set(button, binding);
    }
    binding.region = region;
}

/** Ein Anschluss je Host; der Callback besitzt nur die letzte Anzeigeprojektion. */
export function bindBalanceDisplaySize(host, render) {
    if (!host) return;
    let binding = sizeBindings.get(host);
    if (!binding) {
        const view = host.ownerDocument?.defaultView;
        binding = { render: null, width: -1, refresh: null, observer: null };
        binding.refresh = (force = false) => {
            const style = view?.getComputedStyle?.(host);
            const width = Math.max(0, Math.floor((host.clientWidth || 0)
                - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0)));
            if (force || width !== binding.width) {
                binding.width = width;
                binding.render?.(width);
            }
        };
        const Observer = view?.ResizeObserver || globalThis.ResizeObserver;
        binding.observer = Observer ? new Observer(() => binding.refresh()) : null;
        binding.observer?.observe(host);
        sizeBindings.set(host, binding);
    }
    binding.render = render;
    binding.refresh(true);
}

// Beobachtet ausschließlich die Anzeige: Inhaltstausch und Breite, keine Datenreads.
const overflowBindings = new WeakMap();
export function bindBalanceTableOverflow(region, hint) {
    if (!region || !hint) return;
    const refresh = () => {
        const hasTable = Boolean(region.querySelector?.('table') || region.innerHTML?.includes('<table'));
        hint.hidden = !(hasTable && region.clientWidth > 0 && region.scrollWidth > region.clientWidth);
    };
    bindBalanceDisplaySize(region, refresh);
    if (!overflowBindings.has(region)) {
        const Observer = region.ownerDocument?.defaultView?.MutationObserver;
        const observer = Observer ? new Observer(refresh) : null;
        observer?.observe(region, { subtree: true, childList: true, characterData: true });
        overflowBindings.set(region, { observer });
    }
}

// Dynamische Jahressegmente spiegeln ausschließlich den bestehenden Select.
// Refresh nach Jahresrendern/Recovery erhält die fokussierte Taste, sofern
// die angebotenen Jahre gleich bleiben. Nur ein Klick löst change aus.
export function bindBalanceYearSegments(select, host, doc = globalThis.document) {
    if (!select || !host) return () => {};
    if (yearBindings.get(host)?.select === select) return yearBindings.get(host).refresh;
    const refresh = () => {
        const options = [...select.children];
        const values = options.map(option => option.value);
        if (values.join('|') !== [...host.children].map(button => button.dataset.balanceYear).join('|')) {
            const focusedYear = doc.activeElement?.parentNode === host ? doc.activeElement.dataset.balanceYear : null;
            host.replaceChildren(...options.map(option => {
                const button = doc.createElement('button');
                button.type = 'button';
                button.dataset.balanceYear = option.value;
                button.textContent = option.textContent;
                button.setAttribute('aria-label', `Ausgabenjahr ${option.textContent}`);
                return button;
            }));
            if (focusedYear && !select.disabled) {
                [...host.children].find(button => button.dataset.balanceYear === focusedYear)?.focus();
            }
        }
        for (const button of host.children) {
            button.setAttribute('aria-pressed', String(button.dataset.balanceYear === select.value));
            button.disabled = select.disabled;
        }
    };
    host.addEventListener('click', event => {
        const button = event.target.closest('button[data-balance-year]');
        if (!button || button.parentNode !== host || select.disabled) return;
        select.value = button.dataset.balanceYear;
        const EventClass = doc.defaultView?.Event || globalThis.Event;
        select.dispatchEvent(new EventClass('change', { bubbles: true }));
        refresh();
    });
    select.addEventListener('change', refresh);
    yearBindings.set(host, { select, refresh });
    return refresh;
}

function observeProperty(control, property, refresh) {
    let owner = control, descriptor;
    while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, property);
        owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor?.get || !descriptor?.set) return;
    const { get, set, enumerable } = descriptor;
    Object.defineProperty(control, property, {
        configurable: true, enumerable,
        get() { return get.call(this); },
        set(value) { set.call(this, value); refresh(); }
    });
}

export function bindBalancePresentationControls(root, { onParametersToggle = () => {} } = {}) {
    if (!root?.querySelectorAll) return null;
    if (bindings.has(root)) return bindings.get(root);
    const doc = root.ownerDocument || root;
    const pairs = [...root.querySelectorAll('[data-balance-control]')].map(host => ({
        host, control: doc.getElementById(host.dataset.balanceControl),
        buttons: [...host.querySelectorAll('[data-balance-value]')],
        reason: doc.getElementById(`${host.dataset.balanceControl}-presentation-reason`)
    })).filter(pair => pair.control);
    const parameters = doc.getElementById('balanceAllParameters');
    const dynamicCard = root.querySelector?.('.balance-dynamic-card');
    const dynamicOffNote = doc.getElementById('balanceDynamicFlexOff');
    const bundledDescriptions = new WeakMap();
    const setDescription = (node, ids) => {
        const text = [...new Set(ids)].join(' ');
        if (text && node.getAttribute('aria-describedby') !== text) node.setAttribute('aria-describedby', text);
        if (!text && node.hasAttribute('aria-describedby')) node.removeAttribute('aria-describedby');
    };
    let lastPreset;
    let customRequested = false;
    let refreshing = false;
    let pending = false;
    // Native Setter und der gemeinsame Feldbesitzer müssen ihren gesamten
    // synchronen Durchlauf abschließen, bevor wir den Detailzustand abgleichen.
    const refresh = () => {
        if (pending || refreshing) return;
        pending = true;
        queueMicrotask(project);
    };
    const project = () => {
        pending = false;
        refreshing = true;
        try {
            // Erst den vorhandenen Detailbesitzer aktualisieren, dann seine Gründe bündeln.
            const preset = doc.getElementById('dynamicFlexPreset');
            const revealCustom = customRequested && !preset?.disabled;
            customRequested = false;
            if (parameters && (revealCustom || lastPreset !== undefined && preset?.value === 'custom' && lastPreset !== 'custom') && !preset?.disabled && !parameters.open) parameters.open = true;
            lastPreset = preset?.value;
            const advanced = doc.getElementById('dynamicFlexShowAdvanced');
            if (advanced && revealCustom && !advanced.checked) onParametersToggle(true);
            const dynamicOff = detectDynamicFlexPreset({ dynamicFlex: doc.getElementById('dynamicFlex')?.checked }) === 'off';
            const offNoteHidden = !dynamicOff || doc.getElementById('dynamicFlexConfigGroup')?.style.display === 'none';
            if (dynamicOffNote && dynamicOffNote.hidden !== offNoteHidden) dynamicOffNote.hidden = offNoteHidden;
            // Der gemeinsame Feldbesitzer darf seine eigenen Gründe weiter pflegen.
            // Nur identische Ausschaltziele ersetzen; andere Tokens bleiben erhalten.
            for (const control of dynamicCard?.querySelectorAll('input, select') || []) {
                const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
                    .filter(id => id !== dynamicOffNote?.id);
                for (const id of bundledDescriptions.get(control) || []) {
                    const node = doc.getElementById(id);
                    if (node?.parentNode && !ids.includes(id)) ids.push(id);
                }
                const bundled = ids.filter(id => dynamicOff && dynamicOffNote
                    && doc.getElementById(id)?.textContent.trim() === 'Dynamic Flex ist ausgeschaltet.');
                bundledDescriptions.set(control, bundled);
                setDescription(control, [...ids.filter(id => !bundled.includes(id)), ...(bundled.length ? [dynamicOffNote.id] : [])]);
            }
            for (const { host, control, buttons, reason } of pairs) {
                const value = control.type === 'checkbox' ? String(control.checked) : control.value;
                for (const button of buttons) {
                    const pressed = String(button.dataset.balanceValue === value);
                    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
                    if (button.disabled !== control.disabled) button.disabled = control.disabled;
                }
                const state = control.getAttribute('data-field-state') || 'editable';
                if (host.getAttribute('data-field-state') !== state) host.setAttribute('data-field-state', state);
                const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
                const sharedOff = dynamicOffNote && (ids.includes(dynamicOffNote.id)
                    || control.id === 'dynamicFlexPreset' && dynamicOff);
                const description = ids.filter(id => id !== dynamicOffNote?.id)
                    .map(id => doc.getElementById(id)?.textContent || '').filter(Boolean).join(' ');
                if (reason) {
                    if (reason.getAttribute('data-field-state') !== state) reason.setAttribute('data-field-state', state);
                    if (reason.textContent !== description) reason.textContent = description;
                    if (reason.hidden !== !description) reason.hidden = !description;
                    setDescription(host, [...(description ? [reason.id] : []), ...(sharedOff ? [dynamicOffNote.id] : [])]);
                }
            }
            // Nur der identische Ausschaltgrund wird visuell gebündelt. Native
            // Beschreibungsziele und andersartige Gründe bleiben unverändert.
            for (const reason of dynamicCard?.querySelectorAll('.ds-field-reason') || []) {
                const bundled = dynamicOff && reason.textContent.trim() === 'Dynamic Flex ist ausgeschaltet.';
                if (reason.classList.contains('balance-bundled-reason') !== bundled) reason.classList.toggle('balance-bundled-reason', bundled);
            }
            // Die Klickabsicht überlebt die native Preseterkennung. Erst nach
            // dem Detailabgleich fokussieren, ohne gesperrte Felder freizugeben.
            if (revealCustom) queueMicrotask(() => {
                if (!parameters?.open || preset?.disabled) return;
                const target = [...(dynamicCard?.querySelectorAll('input, select') || [])].find(control =>
                    !control.disabled && !control.hidden && control.type !== 'hidden'
                    && !['dynamicFlex', 'dynamicFlexShowAdvanced'].includes(control.id)
                    && !control.closest?.('[hidden]'));
                target?.focus();
            });
        } finally { refreshing = false; }
    };
    for (const control of new Set([...pairs.map(pair => pair.control), parameters,
        doc.getElementById('dynamicFlexShowAdvanced')].filter(Boolean))) {
        for (const property of ['value', 'selectedIndex', 'checked', 'disabled', 'open']) observeProperty(control, property, refresh);
    }
    for (const { control, buttons } of pairs) {
        control.addEventListener('change', refresh);
        for (const button of buttons) button.addEventListener('click', () => {
            if (control.disabled) return;
            const value = button.dataset.balanceValue;
            if (control.id === 'dynamicFlexPreset' && value === 'custom') customRequested = true;
            if (control.type === 'checkbox') control.checked = value === 'true';
            else control.value = value;
            const EventClass = doc.defaultView?.Event || globalThis.Event;
            control.dispatchEvent(new EventClass('change', { bubbles: true }));
            // Der native Customhandler wendet kein Preset an. Danach nur die
            // bestehenden Detailwerte erkennen; kein zweites Formularereignis.
            if (control.id === 'dynamicFlexPreset' && value === 'custom') {
                syncDynamicFlexPresetSelection();
                refreshDynamicFlexControls();
            }
            refresh();
        });
    }
    // Ein reiner Ansichtswechsel ruft nur die vorhandene UI-Aktualisierung auf.
    // Kein change am Formular, keine Finanzpersistenz und keine Berechnung.
    parameters?.addEventListener('toggle', refresh);
    root.addEventListener?.('change', refresh);
    root.addEventListener?.('reset', () => queueMicrotask(refresh));
    const Observer = doc.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(refresh) : null;
    observer?.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['disabled', 'selected', 'checked', 'data-field-state', 'aria-describedby', 'hidden', 'style', 'open'] });
    const binding = { refresh, observer };
    bindings.set(root, binding);
    refresh();
    return binding;
}

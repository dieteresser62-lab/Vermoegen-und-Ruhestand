/** Fixiert den echten Kalendertag für datumsabhängige Tests; technische Fristen laufen weiter. */
export function installRealClock(day) {
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [day + 'T12:00:00'])); }
    };
    return () => { globalThis.Date = RealDate; };
}

import { createHash } from 'node:crypto';

// Vergleich mit eingefrorenen Laufbelegen vor Aufnahme des Familienheimabzugs ins Protokoll.
export function hashWithoutExemptHome(result) {
    const json = JSON.stringify(result, (key, value) => {
        if (key !== 'inheritance' || !Object.hasOwn(value || {}, 'exemptHome')) return value;
        const { exemptHome, ...estate } = value;
        return estate;
    });
    return createHash('sha256').update(json).digest('hex');
}

/** Erwerbsreihenfolge: Jahresbesitz, danach kurzlebiger rs-probelauf-operation-Writer.
 * Kein Storage-Read/Set-Fallback: ohne atomaren Provider bleibt der Write gesperrt.
 */
export const ANNUAL_OPERATION_LOCK = 'rs-annual-operation';
const leases = new WeakSet();

export function assertAnnualOperationLease(lease) {
    if (!lease || !leases.has(lease) || lease.released) throw new Error('ANNUAL_OPERATION_INVALID');
    return lease;
}

export function createAnnualOperationLock({ locks = globalThis.navigator?.locks } = {}) {
    return {
        async acquire() {
            if (!locks?.request) throw Object.assign(new Error('Der Jahresbesitz benötigt einen atomaren Sperrprovider. Der Schreibstart wurde verweigert.'), { code: 'ANNUAL_LOCK_UNAVAILABLE' });
            let acquired, release, settled = false;
            const ready = new Promise((resolve, reject) => { acquired = { resolve, reject }; });
            const ended = new Promise(resolve => { release = resolve; });
            const completion = Promise.resolve().then(() => locks.request(ANNUAL_OPERATION_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
                if (!lock) { settled = true; acquired.resolve(null); return; }
                const lease = { released: false, release() {
                    if (this.released) return completion;
                    this.released = true; leases.delete(this); release();
                    return completion;
                } };
                leases.add(lease); settled = true; acquired.resolve(lease);
                await ended;
            })).catch(error => { if (!settled) acquired.reject(error); });
            return ready;
        },
        async run(execute, lease) {
            if (lease) return execute(assertAnnualOperationLease(lease));
            const owned = await this.acquire();
            if (!owned) return { ok: false, status: 'in_flight', error: new Error('Eine andere Seite hält den Jahresbesitz. Bitte nach deren Abschluss erneut starten.') };
            try { return await execute(owned); }
            finally { await owned.release(); }
        }
    };
}

/** Bestehende Monats-/Probelaufwriter: ohne Web Locks ist Jahresstart ohnehin gesperrt. */
export async function withAnnualWriteAccess(execute, { annualLease, locks = globalThis.navigator?.locks } = {}) {
    if (!locks?.request && !annualLease) return execute();
    const result = await createAnnualOperationLock({ locks }).run(execute, annualLease);
    if (result?.status === 'in_flight') throw Object.assign(result.error, { code: 'ANNUAL_OPERATION_BUSY' });
    return result;
}

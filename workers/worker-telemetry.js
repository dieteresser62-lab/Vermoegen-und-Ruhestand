/** @import {WorkerTiming,WorkerPayload,TelemetryStart,MemorySnapshot,TelemetryError,JobDetail} from '../typcheck/rechenkern' */
"use strict";

/**
 * Module: Worker Telemetry
 * Purpose: Lightweight metrics collection for worker pool runs.
 *          Tracks job durations, idle times, chunk sizes, and recent errors.
 * Usage: Enabled via ?telemetry=true or localStorage flag.
 */

function safeNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    // Fallback auf Date.now() wenn performance.now nicht verfügbar ist (z.B. Worker/Tests).
    return Date.now();
}

function safeTimestamp() {
    return Date.now();
}

/** @template T
 * @param {T[]} arr
 * @param {number} maxLen */
function clampArray(arr, maxLen) {
    if (arr.length > maxLen) {
        arr.splice(0, arr.length - maxLen);
    }
}


/** @param {unknown} value */
function safeString(value) {
    if (value == null) return "";
    return String(value);
}

export class WorkerTelemetry {
    constructor(name = "default") {
        this.name = name;
        this.enabled = WorkerTelemetry.isEnabled();
        if (!this.enabled) return;

        const registry = WorkerTelemetry.getRegistry();
        registry.set(this.name, this);

        this.createdAt = safeNow();
        this.workerCount = 0;

        this.totalJobs = 0;
        this.completedJobs = 0;
        this.failedJobs = 0;

        this.totalWorkTime = 0;
        this.minJobTime = /** @type {number|null} */ (null);
        this.maxJobTime = /** @type {number|null} */ (null);

        // jobStarts mappt Job-ID -> {start, workerId, payload}
        this.jobStarts = /** @type {Map<string,TelemetryStart>} */ (new Map());
        this.workerStats = /** @type {Map<string,WorkerTiming>} */ (new Map());

        // Arrays werden absichtlich kurz gehalten (siehe clampArray).
        this.chunkSizes = /** @type {number[]} */ ([]);
        this.errors = /** @type {TelemetryError[]} */ ([]);
        this.memorySnapshots = /** @type {MemorySnapshot[]} */ ([]);
        this.memoryStart = /** @type {MemorySnapshot|null} */ (null);
        this.jobDetails = /** @type {JobDetail[]} */ ([]);
    }

    static isEnabled() {
        let enabled = false;
        try {
            const search = typeof location !== "undefined" ? location.search : "";
            if (search && search.includes("telemetry=true")) {
                enabled = true;
            }
        } catch (e) {
            enabled = false;
        }

        if (enabled) return true;

        try {
            if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
                enabled = localStorage.getItem("enableWorkerTelemetry") === "true";
            }
        } catch (e) {
            enabled = false;
        }

        return enabled;
    }

    static getRegistry() {
        const globalObj = typeof globalThis !== "undefined" ? globalThis : window;
        if (!globalObj.__workerTelemetryRegistry) {
            globalObj.__workerTelemetryRegistry = new Map();
        }
        return globalObj.__workerTelemetryRegistry;
    }


    /** @param {string} workerId
 * @returns {WorkerTiming} */
    _ensureWorker(workerId) {
        const id = safeString(workerId || "unknown");
        if (!/** @type {NonNullable<WorkerTelemetry['workerStats']>} */ (this.workerStats).has(id)) {
            /** @type {NonNullable<WorkerTelemetry['workerStats']>} */ (this.workerStats).set(id, {
                jobsCompleted: 0,
                jobsFailed: 0,
                totalTime: 0,
                idleTime: 0,
                lastJobEnd: null
            });
        }
        return /** @type {WorkerTiming} */ (/** @type {NonNullable<WorkerTelemetry['workerStats']>} */ (this.workerStats).get(id));
    }

    /** @param {number} jobId
 * @param {string} workerId
 * @param {WorkerPayload} payload */
    recordJobStart(jobId, workerId, payload) {
        if (!this.enabled) return;
        const id = safeString(jobId);
        const now = safeNow();

        if (/** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).has(id)) {
            const entry = /** @type {TelemetryStart} */ (/** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).get(id));
            if (entry.workerId === "pending" && workerId !== "pending") {
                entry.workerId = safeString(workerId);
                const stats = this._ensureWorker(entry.workerId);
                if (stats.lastJobEnd != null) {
                    stats.idleTime += Math.max(0, now - stats.lastJobEnd);
                }
            }
            return;
        }

        /** @type {NonNullable<WorkerTelemetry['totalJobs']>} */ (this.totalJobs) += 1;
        const workerKey = safeString(workerId || "pending");
        /** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).set(id, { start: now, workerId: workerKey, payload });

        if (workerKey !== "pending") {
            const stats = this._ensureWorker(workerKey);
            if (stats.lastJobEnd != null) {
                stats.idleTime += Math.max(0, now - stats.lastJobEnd);
            }
        }
    }

    /** @param {number} jobId
 * @param {string} workerId
 * @param {unknown} elapsedMs */
    recordJobComplete(jobId, workerId, elapsedMs) {
        if (!this.enabled) return;
        const now = safeNow();
        const id = safeString(jobId);
        const workerKey = safeString(workerId || "unknown");
        const stats = this._ensureWorker(workerKey);

        /** @type {NonNullable<WorkerTelemetry['completedJobs']>} */ (this.completedJobs) += 1;

        const entry = /** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).get(id);
        // Wenn Worker schon gemessen hat, nutze elapsedMs; sonst aus jobStarts ableiten.
        const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0
            ? elapsedMs
            : this._resolveElapsedFromEntry(entry, now);
        const runCount = this._resolveRunCount(entry);
        this._recordJobDetail(elapsed, runCount);

        stats.jobsCompleted += 1;
        stats.totalTime += elapsed;
        stats.lastJobEnd = now;

        /** @type {NonNullable<WorkerTelemetry['totalWorkTime']>} */ (this.totalWorkTime) += elapsed;
        this.minJobTime = this.minJobTime == null ? elapsed : Math.min(this.minJobTime, elapsed);
        this.maxJobTime = this.maxJobTime == null ? elapsed : Math.max(this.maxJobTime, elapsed);

        /** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).delete(id);
    }

    /** @param {number} jobId
 * @param {string} workerId
 * @param {Error} error */
    recordJobFailed(jobId, workerId, error) {
        if (!this.enabled) return;
        const now = safeNow();
        const id = safeString(jobId);
        const workerKey = safeString(workerId || "unknown");
        const stats = this._ensureWorker(workerKey);

        /** @type {NonNullable<WorkerTelemetry['failedJobs']>} */ (this.failedJobs) += 1;
        stats.jobsFailed += 1;
        stats.lastJobEnd = now;

        const entry = /** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).get(id);
        const elapsed = this._resolveElapsedFromEntry(entry, now);
        if (elapsed > 0) {
            stats.totalTime += elapsed;
            /** @type {NonNullable<WorkerTelemetry['totalWorkTime']>} */ (this.totalWorkTime) += elapsed;
        }

        // Fehlerliste begrenzen, um Speicher klein zu halten.
        if (/** @type {NonNullable<WorkerTelemetry['errors']>} */ (this.errors).length < 10) {
            const message = safeString(error && error.message ? error.message : error);
            const stack = safeString(error && error.stack ? error.stack : "");
            /** @type {NonNullable<WorkerTelemetry['errors']>} */ (this.errors).push({
                timestamp: safeTimestamp(),
                workerId: workerKey,
                message,
                stack: stack.slice(0, 500)
            });
        }

        /** @type {NonNullable<WorkerTelemetry['jobStarts']>} */ (this.jobStarts).delete(id);
    }


    /** @param {TelemetryStart|undefined} entry
 * @param {number} now */
    _resolveElapsedFromEntry(entry, now) {
        if (!entry) return 0;
        return Math.max(0, now - entry.start);
    }

    /** @param {TelemetryStart|undefined} entry */
    _resolveRunCount(entry) {
        if (!entry || !entry.payload) return null;
        return entry.payload.runRange?.count ?? entry.payload.comboRange?.count ?? null;
    }

    /**
* @param {unknown} elapsedMs
* @param {unknown} runCount
*/
    _recordJobDetail(elapsedMs, runCount) {
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
        if (!Number.isFinite(runCount) || runCount <= 0) return;
        /** @type {NonNullable<WorkerTelemetry['jobDetails']>} */ (this.jobDetails).push({
            elapsedMs,
            runCount,
            // msPerRun: einfache Kennzahl für Chunk-Effizienz.
            msPerRun: elapsedMs / runCount
        });
        clampArray(/** @type {NonNullable<WorkerTelemetry['jobDetails']>} */ (this.jobDetails), 200);
    }

    /**
* @param {unknown} chunkSize
*/
    recordChunkSize(chunkSize) {
        if (!this.enabled) return;
        if (!Number.isFinite(chunkSize)) return;
        /** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes).push(chunkSize);
        clampArray(/** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes), 100);
    }

    recordMemorySnapshot() {
        if (!this.enabled) return;
        if (typeof performance === "undefined" || !performance.memory) return;
        const memory = performance.memory;
        const snapshot = {
            timestamp: safeTimestamp(),
            usedMB: (memory.usedJSHeapSize || 0) / (1024 * 1024),
            totalMB: (memory.totalJSHeapSize || 0) / (1024 * 1024),
            limitMB: (memory.jsHeapSizeLimit || 0) / (1024 * 1024)
        };
        if (!this.memoryStart) {
            this.memoryStart = snapshot;
        }
        /** @type {NonNullable<WorkerTelemetry['memorySnapshots']>} */ (this.memorySnapshots).push(snapshot);
        clampArray(/** @type {NonNullable<WorkerTelemetry['memorySnapshots']>} */ (this.memorySnapshots), 20);
    }

    getReport() {
        if (!this.enabled) {
            return { enabled: false, name: this.name };
        }

        const now = safeNow();
        const elapsedSec = Math.max(0.001, (now - /** @type {NonNullable<WorkerTelemetry['createdAt']>} */ (this.createdAt)) / 1000);
        const completed = /** @type {NonNullable<WorkerTelemetry['completedJobs']>} */ (this.completedJobs);
        const total = /** @type {NonNullable<WorkerTelemetry['totalJobs']>} */ (this.totalJobs);
        const failed = /** @type {NonNullable<WorkerTelemetry['failedJobs']>} */ (this.failedJobs);
        const successRate = total > 0 ? (completed / total) * 100 : 0;

        const avgJobTime = completed > 0 ? /** @type {NonNullable<WorkerTelemetry['totalWorkTime']>} */ (this.totalWorkTime) / completed : 0;
        const throughput = completed / elapsedSec;

        const workerEntries = [];
        let utilizationSum = 0;
        let workerCount = /** @type {NonNullable<WorkerTelemetry['workerStats']>} */ (this.workerStats).size;
        let minJobs = null;
        let maxJobs = null;

        for (const [workerId, stats] of /** @type {NonNullable<WorkerTelemetry['workerStats']>} */ (this.workerStats).entries()) {
            const jobCount = stats.jobsCompleted + stats.jobsFailed;
            const denom = stats.totalTime + stats.idleTime;
            const utilization = denom > 0 ? (stats.totalTime / denom) * 100 : 0;
            utilizationSum += utilization;
            minJobs = minJobs == null ? jobCount : Math.min(minJobs, jobCount);
            maxJobs = maxJobs == null ? jobCount : Math.max(maxJobs, jobCount);
            workerEntries.push({
                workerId,
                jobsCompleted: stats.jobsCompleted,
                jobsFailed: stats.jobsFailed,
                totalTimeMs: stats.totalTime,
                idleTimeMs: stats.idleTime,
                utilizationPct: utilization
            });
        }

        if (/** @type {NonNullable<WorkerTelemetry['workerCount']>} */ (this.workerCount) > workerCount) {
            workerCount = /** @type {NonNullable<WorkerTelemetry['workerCount']>} */ (this.workerCount);
        }

        const avgUtilization = workerEntries.length > 0 ? (utilizationSum / workerEntries.length) : 0;
        const loadBalanceScore = maxJobs && minJobs != null ? (minJobs / maxJobs) * 100 : 0;

        const chunkingStats = this._summarizeChunking();
        const memoryStats = this._summarizeMemory();
        const jobVariance = this._summarizeJobVariance();

        return {
            enabled: true,
            name: this.name,
            jobs: {
                total,
                completed,
                failed,
                successRatePct: successRate
            },
            performance: {
                avgJobTimeMs: avgJobTime,
                minJobTimeMs: this.minJobTime ?? 0,
                maxJobTimeMs: this.maxJobTime ?? 0,
                throughputJobsPerSec: throughput
            },
            workers: {
                count: workerCount,
                utilizationPct: avgUtilization,
                loadBalanceScorePct: loadBalanceScore,
                stats: workerEntries
            },
            chunking: chunkingStats,
            memory: memoryStats,
            jobVariance,
            errors: [.../** @type {NonNullable<WorkerTelemetry['errors']>} */ (this.errors)]
        };
    }

    _summarizeChunking() {
        if (!/** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes).length) {
            return { avg: 0, min: 0, max: 0, current: 0 };
        }
        /**
* @type {number}
*/
        const sum = /** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes).reduce((acc, val) => acc + val, 0);
        const avg = sum / /** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes).length;
        const min = Math.min(.../** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes));
        const max = Math.max(.../** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes));
        const current = /** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes)[/** @type {NonNullable<WorkerTelemetry['chunkSizes']>} */ (this.chunkSizes).length - 1];
        return { avg, min, max, current };
    }

    _summarizeMemory() {
        if (!/** @type {NonNullable<WorkerTelemetry['memorySnapshots']>} */ (this.memorySnapshots).length) {
            return { current: null, limit: null, usagePct: null, deltaSinceStartMB: 0 };
        }
        /**
* @type {{ limitMB: number; usedMB: number; }}
*/
        const current = /** @type {NonNullable<WorkerTelemetry['memorySnapshots']>} */ (this.memorySnapshots)[/** @type {NonNullable<WorkerTelemetry['memorySnapshots']>} */ (this.memorySnapshots).length - 1];
        const limit = current.limitMB || 0;
        const usagePct = limit > 0 ? (current.usedMB / limit) * 100 : null;
        const startUsed = this.memoryStart ? this.memoryStart.usedMB : current.usedMB;
        return {
            current: current.usedMB,
            limit: limit || null,
            usagePct,
            deltaSinceStartMB: current.usedMB - startUsed
        };
    }

    _summarizeJobVariance() {
        if (!/** @type {NonNullable<WorkerTelemetry['jobDetails']>} */ (this.jobDetails).length) {
            return { meanMsPerRun: 0, stdDevMsPerRun: 0, coefficient: 0, outliers: [] };
        }
        const values = /** @type {NonNullable<WorkerTelemetry['jobDetails']>} */ (this.jobDetails).map(entry => entry.msPerRun).filter(v => Number.isFinite(v));
        if (!values.length) {
            return { meanMsPerRun: 0, stdDevMsPerRun: 0, coefficient: 0, outliers: [] };
        }
        const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const coefficient = mean > 0 ? stdDev / mean : 0;
        const outliers = /** @type {NonNullable<WorkerTelemetry['jobDetails']>} */ (this.jobDetails).filter(entry => entry.msPerRun > mean * 2).slice(-10);
        return {
            meanMsPerRun: mean,
            stdDevMsPerRun: stdDev,
            coefficient,
            outliers
        };
    }

    printReport() {
        if (!this.enabled) return;
        const report = /** @type {Required<ReturnType<WorkerTelemetry["getReport"]>>} */ (this.getReport());
        console.group(`[WorkerTelemetry] ${report.name}`);
        console.table([report.jobs]);
        console.table([report.performance]);
        console.table([report.chunking]);
        console.table([report.memory]);
        console.table([report.jobVariance]);
        if (report.workers.stats && report.workers.stats.length) {
            console.table(report.workers.stats);
        }
        if (report.errors && report.errors.length) {
            console.table(report.errors);
        }
        console.groupEnd();
    }

    exportJSON() {
        if (!this.enabled) return JSON.stringify({ enabled: false, name: this.name });
        return JSON.stringify(this.getReport(), null, 2);
    }
}

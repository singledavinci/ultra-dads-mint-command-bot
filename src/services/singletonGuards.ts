const started = new Set<string>();

export function once(key: string, fn: () => void | Promise<void>): boolean {
    if (started.has(key)) return false;
    started.add(key);
    void Promise.resolve(fn()).catch(() => {
        started.delete(key);
    });
    return true;
}

export function resetGuard(key: string): void {
    started.delete(key);
}

export function isGuarded(key: string): boolean {
    return started.has(key);
}

export function getSingletonStatus(): Record<string, boolean> {
    const keys = ['tracker', 'pending-scanner', 'block-scanner', 'executor', 'bot-init'];
    return Object.fromEntries(keys.map((k) => [k, started.has(k)]));
}

export const PROCESS_START_ID = 'ps-' + String(process.pid) + '-' + String(Date.now());

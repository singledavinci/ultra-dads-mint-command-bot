export const OEGP_CONTRACT = '0x460d7dfa7aefb52ddb7b87a767485325b31272d9';

export function parseBlockTarget(arg: string, currentBlock: number): number {
    let a = arg.trim().toLowerCase();
    if (a.startsWith('at ')) a = a.slice(3).trim();
    if (a === 'next' || a === 'now' || a === '+1') return currentBlock + 1;
    if (a.startsWith('+')) {
        const n = parseInt(a.slice(1), 10);
        if (!Number.isNaN(n) && n >= 0) return currentBlock + n;
    }
    const abs = parseInt(a, 10);
    if (!Number.isNaN(abs) && abs > 1_000_000) return abs;
    return currentBlock + 1;
}

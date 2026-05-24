/**
 * Reservoir API key — never use a hardcoded demo key in production paths.
 */

export function getReservoirApiKey(): string | undefined {
    const key = process.env.RESERVOIR_API_KEY?.trim();
    return key || undefined;
}

export function reservoirRequestHeaders(): Record<string, string> | undefined {
    const key = getReservoirApiKey();
    if (!key) return undefined;
    return { 'x-api-key': key };
}

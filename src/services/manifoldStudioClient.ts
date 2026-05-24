/**
 * Manifold Studio public API — same data source as @manifoldxyz/client-sdk getProduct(),
 * without wagmi/viem/ethers v5 peer dependencies.
 */
import { StudioAppsClientForPublic } from '@manifoldxyz/studio-apps-client-public';
import type { InstancePreview, PublicInstance } from '@manifoldxyz/studio-apps-client-public';

const ETHEREUM_MAINNET_NETWORK_ID = 1;

const MANIFOLD_SYSTEM_CONTRACTS = new Set(
    [
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc',
        '0x0000000000664ceffed39244a8312556a900b938',
    ].map(a => a.toLowerCase())
);

let studioClient: StudioAppsClientForPublic | null = null;

export function isManifoldStudioSdkEnabled(): boolean {
    return process.env.MANIFOLD_STUDIO_SDK_ENABLED !== 'false';
}

function studioApiBaseUrl(): string {
    const raw = (process.env.MANIFOLD_STUDIO_API_URL || 'https://apps.api.manifold.xyz/').trim();
    return raw.endsWith('/') ? raw : `${raw}/`;
}

function getStudioClient(): StudioAppsClientForPublic {
    if (!studioClient) {
        studioClient = new StudioAppsClientForPublic({
            baseUrl: studioApiBaseUrl(),
            defaultTimeout: parseInt(process.env.MANIFOLD_STUDIO_API_TIMEOUT_MS || '10000', 10),
        });
    }
    return studioClient;
}

/** manifold.xyz/@user/id/123 or app links with /id/123 */
export function extractManifoldInstanceIdFromUrl(input: string): string | null {
    const m = input.trim().match(/\/id\/(\d+)/i);
    return m ? m[1] : null;
}

function pickContractFromJsonBlob(blob: string): string | null {
    const patterns = [
        /"contractAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"contract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"tokenAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"nftContract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"collectionAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
    ];
    for (const re of patterns) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(blob)) !== null) {
            const addr = match[1].toLowerCase();
            if (!MANIFOLD_SYSTEM_CONTRACTS.has(addr)) return addr;
        }
    }
    return null;
}

function isEthereumNetwork(network: number | undefined): boolean {
    return network === undefined || network === ETHEREUM_MAINNET_NETWORK_ID;
}

function contractFromPreview(preview: InstancePreview): { contract: string; label: string } | null {
    const addr = preview.contract?.contractAddress?.toLowerCase();
    if (!addr?.startsWith('0x') || MANIFOLD_SYSTEM_CONTRACTS.has(addr)) return null;
    const network = preview.contract?.network ?? preview.network;
    if (!isEthereumNetwork(network)) return null;
    const label = preview.title?.trim() || preview.app?.name || `Manifold ${preview.instanceId}`;
    return { contract: addr, label };
}

function contractFromPublicInstance(instance: PublicInstance<Record<string, unknown>>): {
    contract: string;
    label: string;
} | null {
    const blob = JSON.stringify(instance.publicData ?? {});
    const contract = pickContractFromJsonBlob(blob);
    if (!contract) return null;
    const label = instance.appName || `Manifold ${instance.id}`;
    return { contract, label };
}

export interface ManifoldStudioProduct {
    contract: string;
    label: string;
    instanceId: string;
    slug?: string;
}

/**
 * Resolve NFT contract via Studio public API (getInstance / getPreviews).
 */
export async function resolveManifoldProductByInstanceId(
    instanceId: string
): Promise<ManifoldStudioProduct | null> {
    if (!isManifoldStudioSdkEnabled()) return null;
    const id = instanceId.trim();
    if (!/^\d+$/.test(id)) return null;

    try {
        const client = getStudioClient();

        const previews = await client.public.getPreviews({ instanceIds: [id], maxSize: 1 });
        const preview = previews.instancePreviews?.[0];
        if (preview) {
            const fromPreview = contractFromPreview(preview);
            if (fromPreview) {
                return {
                    ...fromPreview,
                    instanceId: id,
                    slug: preview.slug,
                };
            }
        }

        const instance = await client.public.getInstance<Record<string, unknown>>({ instanceId: id });
        if (!instance) return null;
        const fromInstance = contractFromPublicInstance(instance);
        if (!fromInstance) return null;
        return {
            ...fromInstance,
            instanceId: id,
            slug: instance.appSlug,
        };
    } catch {
        return null;
    }
}

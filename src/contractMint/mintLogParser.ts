import { id, Interface, type Log } from 'ethers';

const ERC1155_IFACE = new Interface([
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
    'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
]);

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)').toLowerCase();
const TRANSFER_SINGLE = id('TransferSingle(address,address,address,uint256,uint256)').toLowerCase();
const TRANSFER_BATCH = id('TransferBatch(address,address,address,uint256[],uint256[])').toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

function isZeroAddressTopic(topic: string | undefined): boolean {
    if (!topic) return false;
    const t = topic.toLowerCase();
    return t === ZERO_TOPIC || t.endsWith('0000000000000000000000000000000000000000');
}

export interface ParsedMintLog {
    tokenContract: string;
    tokenStandard: 'ERC721' | 'ERC1155';
    to: string;
    quantity: number;
    tokenId?: bigint;
}

export function parseMintLogs(logs: readonly Log[]): ParsedMintLog[] {
    const out: ParsedMintLog[] = [];
    for (const log of logs) {
        const topic0 = (log.topics[0] || '').toLowerCase();
        if (topic0 === TRANSFER_TOPIC && log.topics.length >= 4) {
            if (!isZeroAddressTopic(log.topics[1])) continue;
            const to = '0x' + log.topics[2]!.slice(-40);
            out.push({
                tokenContract: log.address.toLowerCase(),
                tokenStandard: 'ERC721',
                to,
                quantity: 1,
                tokenId: BigInt(log.topics[3]!),
            });
            continue;
        }
        if (topic0 === TRANSFER_SINGLE) {
            try {
                const parsed = ERC1155_IFACE.parseLog(log);
                if (!parsed || parsed.name !== 'TransferSingle') continue;
                if (String(parsed.args.from).toLowerCase() !== ZERO) continue;
                out.push({
                    tokenContract: log.address.toLowerCase(),
                    tokenStandard: 'ERC1155',
                    to: String(parsed.args.to).toLowerCase(),
                    quantity: Number(parsed.args.value) || 1,
                    tokenId: BigInt(parsed.args.id),
                });
            } catch {
                /* skip */
            }
        } else if (topic0 === TRANSFER_BATCH) {
            try {
                const parsed = ERC1155_IFACE.parseLog(log);
                if (!parsed || parsed.name !== 'TransferBatch') continue;
                if (String(parsed.args.from).toLowerCase() !== ZERO) continue;
                const values = parsed.args.values as unknown as bigint[];
                out.push({
                    tokenContract: log.address.toLowerCase(),
                    tokenStandard: 'ERC1155',
                    to: String(parsed.args.to).toLowerCase(),
                    quantity: values.reduce((a, b) => a + Number(b), 0) || 1,
                });
            } catch {
                /* skip */
            }
        }
    }
    return out;
}

export function pickPrimaryMintLog(logs: readonly Log[], whaleAddress?: string): ParsedMintLog | null {
    const mints = parseMintLogs(logs);
    if (!mints.length) return null;
    if (whaleAddress) {
        const w = whaleAddress.toLowerCase();
        const match = mints.find(m => m.to.toLowerCase() === w);
        if (match) return match;
    }
    return mints[0];
}

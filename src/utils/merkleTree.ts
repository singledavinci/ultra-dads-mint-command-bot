/**
 * OpenZeppelin-style sorted Merkle tree (keccak256 pair hashing).
 * Used for SeaDrop allowlist proof generation from published address lists.
 */

import { keccak256, solidityPacked } from 'ethers';

function sortPair(a: string, b: string): [string, string] {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    return al <= bl ? [a, b] : [b, a];
}

export function hashMerklePair(a: string, b: string): string {
    const [x, y] = sortPair(a, b);
    return keccak256(solidityPacked(['bytes32', 'bytes32'], [x, y]));
}

/** Build merkle proof for `targetLeaf` from sorted leaf hashes. */
export function merkleProofForLeaf(leaves: string[], targetLeaf: string): string[] | null {
    if (leaves.length === 0) return null;
    const normalized = leaves.map(l => l.toLowerCase());
    const target = targetLeaf.toLowerCase();
    const index = normalized.indexOf(target);
    if (index < 0) return null;

    const proof: string[] = [];
    let layer = [...normalized];
    let idx = index;

    while (layer.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            const left = layer[i];
            const right = i + 1 < layer.length ? layer[i + 1] : left;
            next.push(hashMerklePair(left, right).toLowerCase());
        }

        const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
        if (siblingIdx < layer.length) {
            proof.push(layer[siblingIdx]);
        } else if (idx === layer.length - 1 && layer.length % 2 === 1) {
            proof.push(layer[idx]);
        }

        idx = Math.floor(idx / 2);
        layer = next;
    }

    return proof;
}

export function merkleRootFromLeaves(leaves: string[]): string | null {
    if (leaves.length === 0) return null;
    let layer = leaves.map(l => l.toLowerCase());
    while (layer.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            const left = layer[i];
            const right = i + 1 < layer.length ? layer[i + 1] : left;
            next.push(hashMerklePair(left, right).toLowerCase());
        }
        layer = next;
    }
    return layer[0] ?? null;
}

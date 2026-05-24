#!/usr/bin/env npx tsx
/**
 * CLI: broadcast a message to all configured Discord channels in parallel.
 * Usage: npm run discord:broadcast -- "Hello everyone"
 *        echo "msg" | npm run discord:broadcast
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { broadcastToDiscordChannels } from '../services/discordBroadcastService.js';

async function readMessageFromStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<void> {
    const argvMsg = process.argv.slice(2).join(' ').trim();
    const message = argvMsg || (await readMessageFromStdin());
    if (!message) {
        console.error('Usage: npm run discord:broadcast -- "<message>"');
        console.error('   or: echo "message" | npm run discord:broadcast');
        process.exit(1);
    }

    try {
        const result = await broadcastToDiscordChannels(message);
        if (result.skippedDuplicate) {
            console.log('Skipped: duplicate broadcast (ledger)');
            process.exit(0);
        }
        console.log(
            `Discord broadcast: ${result.sent}/${result.totalTargets} sent in ${result.elapsedMs}ms`
        );
        for (const r of result.results) {
            if (!r.ok) {
                console.error(`  FAIL ${r.label ?? '?'}: ${r.error ?? 'unknown'} (${r.status ?? 'n/a'})`);
            }
        }
        if (result.failed > 0) process.exit(1);
    } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
    }
}

main();

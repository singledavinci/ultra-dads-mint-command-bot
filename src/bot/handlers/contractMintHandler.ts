import type { Context, Telegraf } from 'telegraf';
import type { JsonRpcProvider } from 'ethers';
import { ContractMintPipeline } from '../../contractMint/ContractMintPipeline.js';
import { getContractMintConfig } from '../../contractMint/config.js';
import { formatPreview } from '../../contractMint/alertFormatter.js';
import { normalizeContractMintInput } from '../../contractMint/inputNormalizer.js';

export function registerContractMintHandler(
    bot: Telegraf,
    deps: {
        requireUnlocked: (ctx: Context) => Promise<boolean>;
        getProvider: (userId: string) => JsonRpcProvider;
        getUserWallets: (userId: string) => { address: string; privateKey: string }[];
        isAdmin: (userId: string) => boolean;
    }
) {
    bot.command('mint_contract', async ctx => {
        if (!(await deps.requireUnlocked(ctx))) return;
        const userId = ctx.from?.id?.toString() || '';
        const args = (ctx.message && 'text' in ctx.message ? ctx.message.text : '')
            .split(/\s+/)
            .slice(1);
        const target = args[0];
        if (!target) {
            return ctx.reply(
                'Usage: /mint_contract <contract_or_link> [quantity] [max_eth] [mode]\n' +
                    'Example: /mint_contract 0xabc... 1 0.05'
            );
        }
        const qty = args[1] ? parseInt(args[1], 10) : undefined;
        const maxEth = args[2] ? parseFloat(args[2]) : undefined;
        const provider = deps.getProvider(userId);
        const wallets = deps.getUserWallets(userId);
        if (!wallets.length) {
            return ctx.reply('No wallets configured.');
        }

        const cfg = getContractMintConfig();
        const input = normalizeContractMintInput({
            rawText: target,
            contractAddress: target.startsWith('0x') ? target : undefined,
            quantity: qty,
            maxEth,
            signerAddress: wallets[0].address,
        });

        const pipeline = new ContractMintPipeline(provider);
        const preview = await pipeline.processInput(input);
        if (!preview.plan) {
            return ctx.reply(preview.alertText || 'Could not build mint plan.');
        }

        let text = formatPreview(preview.plan);
        if (cfg.allowUnverifiedContracts) {
            text += '\n\n⚠️ Unverified contracts allowed — simulation must pass before send.';
        }

        if (cfg.autoExecuteContractDrops && preview.plan.executable) {
            const live = await pipeline.processInput(input, {
                privateKeys: wallets.map(w => w.privateKey),
            });
            text += `\n\n${live.alertText}`;
            if (live.executed) text += '\n✅ Execution attempted.';
        } else if (preview.plan.executable) {
            text += '\n\nReply with /mint_contract_confirm to execute (not implemented — set AUTO_EXECUTE_CONTRACT_DROPS=true or use automint).';
        }

        await ctx.reply(text, { parse_mode: 'HTML' });
    });
}

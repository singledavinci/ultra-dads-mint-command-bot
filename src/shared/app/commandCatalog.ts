/**
 * Command allowlists per bot role — used for Telegram setMyCommands + middleware gate.
 */
import type { BotRole } from './role.js';

export type CommandDescriptor = { command: string; description: string };

/** Shared on both bots (access, menus, health). */
export const SHARED_COMMANDS: CommandDescriptor[] = [
    { command: 'start', description: 'Boot the bot and view the main menu' },
    { command: 'menu', description: 'Open the main menu' },
    { command: 'unlock', description: 'Authenticate using the master passcode' },
    { command: 'help', description: 'Command reference' },
    { command: 'guide', description: 'Interactive guide' },
    { command: 'ping', description: 'Health ping' },
    { command: 'checkdb', description: 'Verify MongoDB persistence' },
    { command: 'db', description: 'Alias for /checkdb' },
    { command: 'wallets', description: 'View balances + manage sub-wallets' },
    { command: 'wallet', description: 'DM wallet #N address + key' },
    { command: 'status', description: 'Live bot status' },
    { command: 'version', description: 'Bot version and uptime' },
    { command: 'rpc', description: 'RPC health and latency' },
    { command: 'myrpc', description: 'Your personal RPC node' },
    { command: 'setrpc', description: 'Set your private RPC URL' },
];

/** Copy-mint bot only — tracking + automint. */
export const COPY_MINT_COMMANDS: CommandDescriptor[] = [
    { command: 'track', description: 'Add a whale to your personal tracking list' },
    { command: 'untrack', description: 'Remove a whale from your personal list' },
    { command: 'mytracks', description: 'View your tracked wallets' },
    { command: 'trackingprefs', description: 'Alert/auto-mint sources + payment filter' },
    { command: 'followglobal', description: 'Toggle global list alerts + auto-mint' },
    { command: 'globaltrack', description: '(Admin) Add whale to global list' },
    { command: 'globaluntrack', description: '(Admin) Remove whale from global list' },
    { command: 'cleartrack', description: '(Admin) Clear all tracked wallets' },
    { command: 'clearpersonaltracks', description: '(Admin) Clear personal tracks for all users' },
    { command: 'trackingaudit', description: '(Admin) Tracker vs state audit' },
    { command: 'automint', description: 'Toggle whale copy-mint on/off' },
    { command: 'forcesim', description: 'Toggle simulation (blind = skip sim)' },
    { command: 'bind', description: 'Bind alerts to this chat' },
    { command: 'pause', description: '(Admin) Pause auto-mint' },
    { command: 'resume', description: '(Admin) Resume auto-mint' },
    { command: 'kill', description: '(Admin) Emergency stop tracker + automint' },
    { command: 'freerpc', description: '(Admin) Pause mempool + clear scheduled load' },
    { command: 'capacity', description: '(Admin) Capacity menu + live RPC pressure' },
    { command: 'debug_automint', description: '(Admin) Automint readiness debug' },
    { command: 'debug_tracker', description: '(Admin) Tracker debug' },
    { command: 'debug_capacity', description: '(Admin) Alias for /capacity' },
    { command: 'debug_lastskip', description: '(Admin) Last automint skip reason' },
    { command: 'lastexec', description: 'Last copy-mint execution summary' },
    { command: 'execution', description: 'Recent copy-mint results' },
    { command: 'maxmint', description: '(Admin) Max ETH per mint cap' },
    { command: 'bribe', description: '(Admin) Priority fee bribe (gwei)' },
    { command: 'overdrive', description: 'Toggle aggressive gas padding' },
    { command: 'inclusion', description: '(Admin) Inclusion mode' },
    { command: 'mev', description: '(Admin) Legacy MEV toggle' },
    { command: 'gas', description: 'Gas advisor snapshot' },
    { command: 'speed', description: 'Network gas speed' },
];

/** Mint command bot — manual, scheduled, link, block mint. */
export const MINT_COMMAND_COMMANDS: CommandDescriptor[] = [
    { command: 'mint', description: 'Manual batch mint (interactive or one-liner)' },
    { command: 'custommint', description: 'Custom mint calldata wizard' },
    { command: 'dropmint', description: 'Schedule or run a drop mint' },
    { command: 'scheduled', description: 'List scheduled drop mints' },
    { command: 'cancelschedule', description: 'Cancel a scheduled drop' },
    { command: 'blockmint', description: 'Mint at target block(s)' },
    { command: 'globalmint', description: '(Admin) Mint link/contract for all users' },
    { command: 'mintall', description: '(Admin) Alias for global mint' },
    { command: 'scattermint', description: '(Admin) Scatter.art collection mint' },
    { command: 'distribute', description: 'Split ETH from wallet #1 to fleet' },
    { command: 'sweep', description: 'Sweep ETH to wallet #1' },
    { command: 'sweepnfts', description: 'Sweep collection NFTs' },
    { command: 'sweepcollection', description: 'Alias for NFT sweep' },
    { command: 'listingstatus', description: 'Floor monitor + offer accept status' },
    { command: 'monitor', description: '(Admin) Watch NFT floor price' },
    { command: 'unmonitor', description: '(Admin) Stop floor monitor' },
    { command: 'walletname', description: 'Label wallet #N' },
    { command: 'deletewallet', description: 'Remove wallet #N' },
    { command: 'compromised', description: 'Mark drained wallets' },
    { command: 'uncompromised', description: 'Clear compromised flag' },
    { command: 'cleanwallets', description: 'Remove empty tail wallets' },
    { command: 'importwallet', description: 'Import external private key' },
    { command: 'clearimported', description: 'Remove imported keys' },
    { command: 'exportwallets', description: 'Export keys (DM)' },
    { command: 'chain', description: '(Admin) Global RPC URL' },
    { command: 'setcode', description: '(Admin) Set access code' },
    { command: 'listusers', description: '(Admin) List unlocked users' },
    { command: 'lockuser', description: '(Admin) Revoke user access' },
    { command: 'broadcast', description: '(Admin) Broadcast to users' },
    { command: 'discordbroadcast', description: '(Admin) Discord channel broadcast' },
    { command: 'discordbroadcast_status', description: '(Admin) Discord targets list' },
    { command: 'announceversion', description: '(Admin) Version announce' },
    { command: 'kick', description: '(Admin) Kick recent members' },
    { command: 'clearseed', description: '(Admin) Purge stored seed' },
    { command: 'exportseed', description: '(Admin) Show MNEMONIC (DM)' },
    { command: 'freshadminwallets', description: '(Admin) Reset admin HD fleet' },
    { command: 'funding', description: 'Wallet funding summary' },
    { command: 'panic', description: 'Engine panic stop' },
    { command: 'debug_status', description: '(Admin) Full debug status' },
    { command: 'debug_rpc', description: '(Admin) RPC budget debug' },
    { command: 'debug_messages', description: '(Admin) Message dedupe stats' },
    { command: 'debug_execution', description: '(Admin) Engine execution debug' },
    { command: 'lastmint', description: 'Last mint metadata' },
];

const COPY_COMMAND_SET = new Set([
    ...SHARED_COMMANDS.map(c => c.command),
    ...COPY_MINT_COMMANDS.map(c => c.command),
]);

const MINT_COMMAND_SET = new Set([
    ...SHARED_COMMANDS.map(c => c.command),
    ...MINT_COMMAND_COMMANDS.map(c => c.command),
]);

export function getTelegramCommandsForRole(role: BotRole): CommandDescriptor[] {
    if (role === 'copy') {
        return [...SHARED_COMMANDS, ...COPY_MINT_COMMANDS];
    }
    if (role === 'mint') {
        return [...SHARED_COMMANDS, ...MINT_COMMAND_COMMANDS];
    }
    return dedupeCommands([...SHARED_COMMANDS, ...COPY_MINT_COMMANDS, ...MINT_COMMAND_COMMANDS]);
}

function dedupeCommands(list: CommandDescriptor[]): CommandDescriptor[] {
    const seen = new Set<string>();
    const out: CommandDescriptor[] = [];
    for (const item of list) {
        if (seen.has(item.command)) continue;
        seen.add(item.command);
        out.push(item);
    }
    return out;
}

export function isCommandAllowedForRole(command: string, role: BotRole): boolean {
    const name = command.toLowerCase().replace(/^\//, '');
    if (role === 'all') return true;
    if (role === 'copy') return COPY_COMMAND_SET.has(name);
    return MINT_COMMAND_SET.has(name);
}

export function extractCommandFromText(text: string | undefined): string | null {
    if (!text?.startsWith('/')) return null;
    const first = text.split(/\s/)[0];
    const base = first.slice(1).split('@')[0];
    return base.toLowerCase() || null;
}

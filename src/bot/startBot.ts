/**
 * Shared boot — invoked by monolith (start:bot) or split apps (start:copy / start:mint).
 */
import { resolveBotRole, getServiceName, isRoleEnabled } from '../shared/app/role.js';

const role = resolveBotRole();

if (!isRoleEnabled(role)) {
    console.error(`[Boot] Service disabled for role=${role} (COPY_BOT_ENABLED / MINT_BOT_ENABLED).`);
    process.exit(1);
}

console.log(`[Boot] service=${getServiceName(role)} role=${role}`);

await import('./index.js');

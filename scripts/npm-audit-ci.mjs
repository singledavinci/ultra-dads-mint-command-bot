#!/usr/bin/env node
/**
 * CI npm audit — fail on high/critical in production deps.
 * Moderate advisories in known transitive chains can be allowlisted below.
 */

import { execSync } from 'node:child_process';

/** package name → max allowed severity (moderate | high never allowed if listed as moderate cap) */
const ALLOWLIST = new Map([
    [
        'ws',
        {
            reason: 'Transitive via ethers@6 WebSocket provider; fix requires ethers major change',
            maxSeverity: 'moderate',
        },
    ],
]);

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function rank(sev) {
    return SEVERITY_RANK[sev] ?? 0;
}

function parseAuditJson() {
    const raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(raw);
}

function collectVulns(report) {
    const out = [];
    const vulns = report.vulnerabilities || {};
    for (const [name, entry] of Object.entries(vulns)) {
        if (entry.via && typeof entry.via === 'object' && !Array.isArray(entry.via)) {
            for (const [pkg, detail] of Object.entries(entry.via)) {
                if (detail && typeof detail === 'object' && detail.title) {
                    out.push({
                        name: pkg,
                        severity: detail.severity || entry.severity,
                        title: detail.title,
                    });
                }
            }
        } else {
            out.push({
                name,
                severity: entry.severity,
                title: entry.name,
            });
        }
    }
    return out;
}

function isAllowed(name, severity) {
    const rule = ALLOWLIST.get(name);
    if (!rule) return false;
    return rank(severity) <= rank(rule.maxSeverity);
}

function main() {
    let report;
    try {
        report = parseAuditJson();
    } catch (e) {
        const err = e;
        if (err.stdout) {
            try {
                report = JSON.parse(err.stdout);
            } catch {
                console.error('npm audit failed to run');
                process.exit(1);
            }
        } else {
            console.error(err.message || err);
            process.exit(1);
        }
    }

    const metadata = report.metadata?.vulnerabilities || {};
    console.log(
        `npm audit (production): critical=${metadata.critical || 0} high=${metadata.high || 0} ` +
            `moderate=${metadata.moderate || 0} low=${metadata.low || 0}`
    );

    const vulns = collectVulns(report);
    const blocking = [];
    const allowed = [];

    for (const v of vulns) {
        if (isAllowed(v.name, v.severity)) {
            allowed.push(v);
            continue;
        }
        if (rank(v.severity) >= rank('high')) {
            blocking.push(v);
        }
    }

    for (const v of allowed) {
        const rule = ALLOWLIST.get(v.name);
        console.log(`  allowlisted ${v.name} (${v.severity}): ${rule?.reason}`);
    }

    if (blocking.length > 0) {
        console.error('\nBlocking vulnerabilities (production deps):');
        for (const v of blocking) {
            console.error(`  [${v.severity}] ${v.name}: ${v.title}`);
        }
        process.exit(1);
    }

    if (rank('moderate') <= rank('high') && (metadata.moderate || 0) > 0) {
        const unlistedModerate = vulns.filter(
            v => v.severity === 'moderate' && !isAllowed(v.name, v.severity)
        );
        if (unlistedModerate.length > 0) {
            console.warn('\nModerate advisories (non-blocking; review periodically):');
            for (const v of unlistedModerate.slice(0, 10)) {
                console.warn(`  ${v.name}: ${v.title?.slice(0, 80)}`);
            }
        }
    }

    console.log('\naudit:ci OK (no high/critical in production dependencies)\n');
}

main();

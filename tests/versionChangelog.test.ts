/**
 * Per-version release notes for auto-announce
 * Run: npx tsx tests/versionChangelog.test.ts
 */
import assert from 'node:assert';

const { buildVersionAnnounceMessage, getVersionChangelogBody, listVersionsWithChangelog } = await import(
    '../src/bot/versionChangelog'
);

console.log('Test 1: mapped version returns body...');
{
    const body = getVersionChangelogBody('3.4.3');
    assert.ok(body && body.includes('Duplicate DMs'));
    console.log('  ✅ 3.4.3 notes present');
}

console.log('Test 2: unknown version without env returns null...');
{
    const prev = process.env.VERSION_CHANGELOG;
    const prevFor = process.env.VERSION_CHANGELOG_FOR;
    delete process.env.VERSION_CHANGELOG;
    delete process.env.VERSION_CHANGELOG_FOR;
    assert.strictEqual(getVersionChangelogBody('99.99.99'), null);
    assert.strictEqual(buildVersionAnnounceMessage('99.99.99'), null);
    if (prev) process.env.VERSION_CHANGELOG = prev;
    if (prevFor) process.env.VERSION_CHANGELOG_FOR = prevFor;
    console.log('  ✅ missing version blocked');
}

console.log('Test 3: VERSION_CHANGELOG env override...');
{
    process.env.VERSION_CHANGELOG = 'Custom\\nline';
    process.env.VERSION_CHANGELOG_FOR = '9.9.8';
    const body = getVersionChangelogBody('9.9.8');
    assert.ok(body?.includes('Custom'));
    assert.ok(body?.includes('\nline'));
    const msg = buildVersionAnnounceMessage('9.9.8');
    assert.ok(msg?.includes('v9.9.8'));
    delete process.env.VERSION_CHANGELOG;
    delete process.env.VERSION_CHANGELOG_FOR;
    console.log('  ✅ env override works');
}

console.log('Test 4: listVersionsWithChangelog is non-empty...');
{
    assert.ok(listVersionsWithChangelog().length >= 1);
    console.log('  ✅ version list ok');
}

console.log('\n✅ All version changelog tests passed.\n');

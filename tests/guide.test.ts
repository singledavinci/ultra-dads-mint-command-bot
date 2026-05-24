/**
 * Guide content smoke tests
 * Run: npx tsx tests/guide.test.ts
 */
import assert from 'node:assert';
import { getGuideContent, getGuideKeyboard, parseGuideSection } from '../src/bot/ui/guide';

console.log('Test 1: all sections under Telegram limit...');
{
    for (const section of ['overview', 'mint', 'whales', 'wallets', 'engine', 'alerts', 'admin'] as const) {
        const text = getGuideContent(section, { isAdmin: section === 'admin', version: '3.3.2' });
        assert(text.length < 4000, `${section} too long: ${text.length}`);
    }
    console.log('  ✅ section lengths ok');
}

console.log('Test 2: parseGuideSection...');
{
    assert.strictEqual(parseGuideSection('guide_mint'), 'mint');
    assert.strictEqual(parseGuideSection('guide_bad'), null);
    console.log('  ✅ parse ok');
}

console.log('Test 3: admin section hidden content for non-admin...');
{
    const text = getGuideContent('admin', { isAdmin: false, version: '1' });
    assert(text.includes('only available'));
    console.log('  ✅ admin gate text');
}

console.log('Test 4: keyboard includes admin row when admin...');
{
    const kb = getGuideKeyboard('overview', true);
    assert(
        kb.reply_markup.inline_keyboard.some(row =>
            row.some(b => 'callback_data' in b && b.callback_data === 'guide_admin')
        )
    );
    console.log('  ✅ admin keyboard');
}

console.log('\n✅ All guide tests passed.\n');

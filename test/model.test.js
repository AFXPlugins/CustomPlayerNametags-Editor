/* Run: node test/model.test.js   (no dependencies) */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ctx = {};
ctx.globalThis = ctx;
ctx.setTimeout = setTimeout;
ctx.window = { matchMedia: () => ({ matches: false }) };
vm.createContext(ctx);
for (const f of ['00-model.js', '05-doc.js', '10-render.js', '20-bridge.js', '30-app.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), ctx, { filename: f });
}
const { model: M, mini, preview: P } = ctx.NT;

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.message)); process.exitCode = 1; }
}
const later = [];
function ta(name, fn) { later.push([name, fn]); }
const roundTrip = (raw) => M.serializeLines(M.parseLines(raw));
const plain = (built) => built.plain;
// Values created inside the vm context have a different Array prototype; compare via JSON.
assert.deepStrictEqual = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

console.log('model');

t('round-trips a plain format', () => assert.strictEqual(roundTrip('{player}'), '{player}'));
t('round-trips colors, placeholders, text', () => {
  const raw = '<red>%luckperms_prefix%{player} <gray>[&a&l%player_ping%&r]';
  assert.strictEqual(roundTrip(raw), raw);
});
t('round-trips literal \\n line breaks', () => {
  const raw = 'a\\nb\\n\\nc';
  assert.strictEqual(roundTrip(raw), raw);
  assert.strictEqual(M.parseLines(raw).length, 4);
});
t('real newlines are normalised to the literal \\n', () => assert.strictEqual(roundTrip('a\nb'), 'a\\nb'));
t('trailing line break keeps an empty last line', () => {
  const l = M.parseLines('abc\\n');
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[1].length, 0);
  assert.strictEqual(M.serializeLines(l), 'abc\\n');
});
t('empty format is one empty line', () => {
  assert.strictEqual(M.parseLines('').length, 1);
  assert.strictEqual(M.serializeLines(M.parseLines('')), '');
});
t('&#hex and &code tokens become COLOR chunks', () => {
  const flat = M.parseFlat('&#ff8800Hi&c!');
  assert.deepStrictEqual(flat.map((c) => c.kind), ['color', 'text', 'color', 'text']);
});
t('kinds: text / placeholder / color / limit', () => {
  const kinds = M.parseFlat('Hi %x_y%{player}<red>{chars 12}').map((c) => c.kind);
  assert.deepStrictEqual(kinds, ['text', 'placeholder', 'placeholder', 'color', 'limit']);
});
t('{chars N} is preserved verbatim', () => assert.strictEqual(roundTrip('a{chars   16}b'), 'a{chars   16}b'));
t('a lone % and < stay text', () => assert.strictEqual(roundTrip('50 % off < now'), '50 % off < now'));

console.log('widgets');
const W = '{widget id=abc12345 colors=false placeholders=true text=true limit=12}%guild_tag%{/widget}';
t('parses widget attributes and contents', () => {
  const [w] = M.parseFlat(W);
  assert.strictEqual(w.kind, 'widget');
  assert.strictEqual(w.widgetId, 'abc12345');
  assert.strictEqual(w.colors, false);
  assert.strictEqual(w.placeholders, true);
  assert.strictEqual(w.limit, 12);
  assert.strictEqual(w.contents.length, 1);
  assert.strictEqual(w.contents[0].kind, 'placeholder');
});
t('widget round-trips exactly (attribute order as the plugin writes it)', () => assert.strictEqual(roundTrip(W), W));
t('unlimited widget omits limit=', () => {
  const tag = M.encodeWidget('id1', true, true, false, -1, '');
  assert.strictEqual(tag, '{widget id=id1 colors=true placeholders=true text=false}{/widget}');
});
t('widget missing an id gets one minted', () => {
  const [w] = M.parseFlat('{widget colors=true}{/widget}');
  assert.ok(/^[0-9a-f]{8}$/.test(w.widgetId));
});
t('{Widget} (wrong case) and {widgetx} are not widgets', () => {
  assert.strictEqual(M.parseFlat('{Widget}x{/widget}')[0].kind, 'text');
  assert.strictEqual(M.widgetAt('{widgetx}a{/widget}', 0), null);
});
t('malformed limit is ignored, negative clamps to 0', () => {
  assert.strictEqual(M.parseAttrs(' limit=abc').limit, -1);
  assert.strictEqual(M.parseAttrs(' limit=-4').limit, 0);
});
t('widget is a single chunk on its line, not split by inner tags', () => {
  const lines = M.parseLines('a{widget id=z colors=true placeholders=true text=true}<red>x\\ny{/widget}b');
  assert.strictEqual(lines.length, 1); // \n inside a widget does not split the line
});
t('stripTagText removes typed widget/chars tags', () => {
  assert.strictEqual(M.stripTagText('hi {widget}{/widget} {chars 5} there'), 'hi   there');
  assert.strictEqual(M.stripTagText('{player} stays'), '{player} stays');
});
t('extractWidgetContents / overlayWidgetFills', () => {
  const raw = 'A{widget id=a1 colors=true placeholders=true text=true}old{/widget}B{widget id=b2 colors=true placeholders=true text=true}x{/widget}';
  assert.deepStrictEqual({ ...M.extractWidgetContents(raw) }, { a1: 'old', b2: 'x' });
  const over = M.overlayWidgetFills(raw, { a1: '<red>new' });
  assert.ok(over.includes('{widget id=a1 colors=true placeholders=true text=true}<red>new{/widget}'));
  assert.ok(over.includes('x{/widget}'));
});

console.log('minimessage');
const runs = (s) => mini.parse(mini.fromLegacy(s));
t('colors apply and stop at the closing tag', () => {
  const [line] = runs('<red>a</red>b');
  assert.deepStrictEqual(line.map((r) => [r.t, r.c]), [['a', '#ff5555'], ['b', '#ffffff']]);
});
t('legacy & codes convert', () => {
  const [line] = runs('&cHi');
  assert.strictEqual(line[0].c, '#ff5555');
});
t('bold is NOT reset by a later colour (plugin converts & codes to plain tags)', () => {
  const [line] = runs('&l&cHi');
  assert.strictEqual(line[0].b, true);
  assert.strictEqual(line[0].c, '#ff5555');
});
t('<reset> clears everything', () => {
  const [line] = runs('<red><bold>a<reset>b');
  assert.strictEqual(line[1].b, false);
  assert.strictEqual(line[1].c, '#ffffff');
});
t('hex colour', () => assert.strictEqual(runs('<#12abef>x')[0][0].c, '#12abef'));
t('gradient interpolates across the visible characters', () => {
  const [line] = runs('<gradient:#000000:#ffffff>abc</gradient>');
  const colours = line.flatMap((r) => [...r.t].map(() => r.c));
  assert.strictEqual(line.length, 3);
  assert.strictEqual(line[0].c, '#000000');
  assert.strictEqual(line[2].c, '#ffffff');
  assert.ok(line[1].c > '#000000' && line[1].c < '#ffffff');
});
t('rainbow varies per character', () => {
  const [line] = runs('<rainbow>abcd</rainbow>');
  assert.strictEqual(new Set(line.map((r) => r.c)).size, 4);
});
t('unknown tags render literally', () => assert.strictEqual(mini.parse('<foo>bar')[0][0].t, '<foo>bar'));
t('escaped \\< is literal', () => assert.strictEqual(mini.parse('\\<red>x')[0][0].t, '<red>x'));
t('newline splits lines', () => assert.strictEqual(mini.parse('a\nb').length, 2));
t('visibleLength ignores tags', () => assert.strictEqual(mini.visibleLength('<red>ab<bold>c</bold>'), 3));
t('truncateSource keeps tags, closes them, adds ellipsis', () => {
  const out = mini.truncateSource('<red>abcdef', 3, true);
  assert.strictEqual(out, '<red>abc</red><white>...</white>');
  assert.strictEqual(mini.visibleLength(out), 6); // 3 + "..."
  assert.strictEqual(mini.truncateSource('<red>abcdef', 3, false), '<red>abc</red>');
  assert.strictEqual(mini.truncateSource('abc', 3, true), 'abc');
});
t('describeTag', () => {
  assert.strictEqual(mini.describeTag('<dark_red>').label, 'Dark Red');
  assert.strictEqual(mini.describeTag('&c').label, 'Red');
  assert.strictEqual(mini.describeTag('<bold>').kind, 'style');
  assert.strictEqual(mini.describeTag('<gradient:#ff0000:#0000ff>').kind, 'gradient');
  assert.strictEqual(mini.describeTag('</bold>').kind, 'close');
});

console.log('preview pipeline (parseFormat + truncateToCharacterLimit)');
const ctxBase = { name: 'Pixelpaw', values: { player_ping: '42', luckperms_prefix: '&c[Owner] ', guild_tag: 'DRAGON' }, lineLimit: 24, ellipsis: true, widgetEllipsis: true };
t('{player} and %placeholders% resolve', () => {
  const b = P.build('%luckperms_prefix%{player} %player_ping%ms', ctxBase);
  assert.deepStrictEqual(plain(b), ['[Owner] Pixelpaw 42ms']);
});
t('unknown placeholders are left as typed (PlaceholderAPI behaviour)', () => {
  assert.deepStrictEqual(plain(P.build('%nope%', ctxBase)), ['%nope%']);
});
t('literal \\n makes lines', () => assert.deepStrictEqual(plain(P.build('a\\nb', ctxBase)), ['a', 'b']));
t('widget unwraps to its content', () => {
  assert.deepStrictEqual(plain(P.build('X ' + W, ctxBase)), ['X DRAGON']);
});
t('an unfilled widget-only line is dropped, leaving no gap', () => {
  const raw = 'top\\n{widget id=q colors=true placeholders=true text=true}{/widget}\\nbottom';
  assert.deepStrictEqual(plain(P.build(raw, ctxBase)), ['top', 'bottom']);
});
t('a blank line WITHOUT a widget is kept', () => {
  assert.deepStrictEqual(plain(P.build('top\\n\\nbottom', ctxBase)), ['top', '', 'bottom']);
});
t('a widget beside literal text on its line is kept even when the widget is empty', () => {
  assert.deepStrictEqual(plain(P.build('Hi {widget id=q colors=true placeholders=true text=true}{/widget}', ctxBase)), ['Hi ']);
});
t('widget limit truncates its own content with an ellipsis', () => {
  const raw = '{widget id=q colors=true placeholders=true text=true limit=4}abcdefgh{/widget}';
  assert.deepStrictEqual(plain(P.build(raw, ctxBase)), ['abcd...']);
  assert.deepStrictEqual(plain(P.build(raw, { ...ctxBase, widgetEllipsis: false })), ['abcd']);
});
t('line limit truncates with ellipsis (visible characters, not markup)', () => {
  const raw = '<red>' + 'x'.repeat(30);
  const b = P.build(raw, ctxBase);
  assert.strictEqual(b.plain[0], 'x'.repeat(24) + '...');
  assert.strictEqual(b.info[0].truncated, true);
  assert.strictEqual(b.info[0].length, 30);
});
t('colour codes do not count toward the limit', () => {
  const raw = '&c&l' + 'y'.repeat(24);
  assert.strictEqual(P.build(raw, ctxBase).info[0].truncated, false);
});
t('no ellipsis when the indicator is off', () => {
  assert.strictEqual(P.build('z'.repeat(30), { ...ctxBase, ellipsis: false }).plain[0], 'z'.repeat(24));
});
t('{chars N} overrides the line limit for just that line', () => {
  const b = P.build('{chars 5}abcdefghij\\nabcdefghij', ctxBase);
  assert.deepStrictEqual(b.plain, ['abcde...', 'abcdefghij']);
});
t('limit -1 means unlimited', () => {
  assert.strictEqual(P.build('q'.repeat(60), { ...ctxBase, lineLimit: -1 }).plain[0].length, 60);
});
t('bedrock prefix/suffix wrap the raw format', () => {
  const b = P.build('{player}', { ...ctxBase, platform: 'bedrock', applyAffix: true, bedrockPrefix: '[B] ', bedrockSuffix: '!' });
  assert.deepStrictEqual(plain(b), ['[B] Pixelpaw!']);
});
t('empty format renders nothing', () => assert.deepStrictEqual(P.build('', ctxBase).lines, []));
t('placeholder value carrying colour codes styles the text', () => {
  const b = P.build('%luckperms_prefix%x', ctxBase);
  assert.strictEqual(b.lines[0][0].c, '#ff5555');
});

console.log('widget text sanitising');
const wid = (o) => ({ colors: true, placeholders: true, text: true, limit: -1, ...o });
t('strips colours when the widget disallows them', () => {
  assert.strictEqual(M.sanitizeWidgetText('&chi <red>there', wid({ colors: false }), {}), 'hi there');
});
t('strips placeholders when disallowed', () => {
  assert.strictEqual(M.sanitizeWidgetText('a %x% b', wid({ placeholders: false }), {}), 'a  b');
});
t('cuts to the limit, ellipsis optional', () => {
  assert.strictEqual(M.sanitizeWidgetText('abcdefgh', wid({ limit: 3 }), { ellipsis: false }), 'abc');
  assert.strictEqual(M.sanitizeWidgetText('abcdefgh', wid({ limit: 3 }), { ellipsis: true }), 'abc<white>...</white>');
});

console.log('rail tabs and edition switch');
const A = ctx.NT.app;
const S = A.S;
A.view = { updateStage() {} }; // the DOM view isn't loaded here; picking a player refreshes the stage
async function bootApp(settings) {
  const bridge = new ctx.NT.MockBridge();
  bridge.latency = 0;
  Object.assign(bridge.state.settings, settings);
  await A.boot(bridge);
  return bridge;
}

ta('the edition choice follows the matching server setting', async () => {
  const cases = [[false, false], [true, false], [false, true], [true, true]];
  for (const [g, gr] of cases) {
    await bootApp({ separateBedrockGlobal: g, separateBedrockGroups: gr });
    assert.strictEqual(A.editionEnabled('global'), g, 'global with ' + [g, gr]);
    assert.strictEqual(A.editionEnabled('group'), gr, 'group with ' + [g, gr]);
    assert.strictEqual(A.editionEnabled('player'), false, 'player formats have no Bedrock version, with ' + [g, gr]);
    assert.strictEqual(A.editionEnabled('self'), false);
  }
});
ta('Bedrock cannot be picked for a format that has no Bedrock version', async () => {
  await bootApp({ separateBedrockGlobal: false, separateBedrockGroups: true });
  await A.setPlatform('bedrock');
  assert.strictEqual(S.target.platform, 'java');
  await A.goto({ type: 'player', id: 'p-2' });
  await A.setPlatform('bedrock');
  assert.strictEqual(S.target.platform, 'java', 'never for a player format');
  await A.goto({ type: 'global' });
  await bootApp({ separateBedrockGlobal: true, separateBedrockGroups: false });
  await A.setPlatform('bedrock');
  assert.strictEqual(S.target.platform, 'bedrock');
});
ta('the rail opens on the tab of the format being edited', async () => {
  await bootApp({});
  assert.strictEqual(A.railTab(), 'global');
  await A.goto({ type: 'group', id: 'vip' });
  assert.strictEqual(A.railTab(), 'group');
  await A.goto({ type: 'player', id: 'p-2' });
  assert.strictEqual(A.railTab(), 'player');
});
ta('clicking a tab opens the first group or player, then remembers the last one', async () => {
  await bootApp({});
  await A.openTab('group');
  assert.strictEqual(S.target.type + ':' + S.target.id, 'group:admin');
  await A.goto({ type: 'group', id: 'vip' });
  await A.openTab('player');
  assert.strictEqual(S.target.type + ':' + S.target.id, 'player:p-1');
  await A.goto({ type: 'player', id: 'p-3' });
  await A.openTab('global');
  assert.strictEqual(S.target.type, 'global');
  await A.openTab('group');
  assert.strictEqual(S.target.id, 'vip');
  await A.openTab('player');
  assert.strictEqual(S.target.id, 'p-3');
});
ta('clicking the tab that is already open does nothing', async () => {
  await bootApp({});
  const before = S.target;
  await A.openTab('global');
  assert.strictEqual(S.target, before);
});
ta('an empty tab is shown without leaving the current format', async () => {
  await bootApp({});
  S.data.players = [];
  await A.openTab('player');
  assert.strictEqual(S.target.type, 'global');
  assert.strictEqual(A.railTab(), 'player');
  const before = S.target;
  await A.openTab('global');
  assert.strictEqual(A.railTab(), 'global');
  assert.strictEqual(S.target, before, 'no reload when the format is already open');
  S.data.groups.java = [];
  S.data.players = [];
  await A.openTab('group');
  assert.strictEqual(A.railTab(), 'group');
});

ta('selectRef keeps a chip selected where select would toggle it off', async () => {
  await bootApp({});
  const ref = { l: 0, w: null, i: 1 };
  A.selectRef(ref);
  assert.strictEqual(S.sel.i, 1);
  A.selectRef({ l: 0, w: null, i: 1 });
  assert.strictEqual(S.sel.i, 1, 'right-clicking the selected chip must not deselect it');
  A.select({ l: 0, w: null, i: 1 });
  assert.strictEqual(S.sel, null, 'a plain click still toggles');
});

(async () => {
  for (const [name, fn] of later) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.message)); process.exitCode = 1; }
  }
  console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' — WITH FAILURES' : ''));
})();

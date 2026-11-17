// スタンプの色・言葉と SVG の形を、外のファイルやパッケージなしで確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stamps = [
  { id: 'a', color: '#17877B', background: '#F1FBF9', top: 'よく がんばりました', bottom: '見ました！' },
  { id: 'b', color: '#6A52C4', background: '#F6F3FF', top: 'しっかり 書けたね', bottom: 'ばっちり！' },
  { id: 'c', color: '#C4680C', background: '#FFF7EA', top: 'その調子 その調子', bottom: 'いいね！' },
  { id: 'd', color: '#D8453B', background: '#FFF8F6', top: 'よく 考えました', bottom: 'すごい！' },
  { id: 'e', color: '#2563C9', background: '#F1F6FF', top: 'ていねいに 書けたね', bottom: 'ＯＫ！' },
  { id: 'f', color: '#2E8540', background: '#F2FAF2', top: 'いい気づき だね', bottom: 'なるほど！' },
];
const readStamp = (id) => readFileSync(new URL(`../assets/stamps/seen-${id}.svg`, import.meta.url), 'utf8');
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((m) => [m[1], m[3]]));

function parts(svg) {
  const circles = [...svg.matchAll(/<circle\b[^>]*>/g)].map(([tag]) => attributes(tag));
  const texts = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map(([tag]) => tag);
  const top = texts.find((tag) => tag.includes('<textPath'));
  const bottom = texts.find((tag) => !tag.includes('<textPath'));
  const band = [...svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => attributes(tag)).find((rect) => rect.y === '296');
  return {
    root: attributes(svg.match(/<svg\b[^>]*>/)[0]),
    outer: circles.find((circle) => circle.r === '188'),
    dotted: circles.find((circle) => circle.r === '168'),
    top: attributes(top.match(/<text\b[^>]*>/)[0]),
    path: attributes(top.match(/<textPath\b[^>]*>/)[0]),
    topWord: top.match(/<textPath\b[^>]*>([^<]*)<\/textPath>/)[1],
    band,
    bottom: attributes(bottom.match(/<text\b[^>]*>/)[0]),
    bottomWord: bottom.match(/>([^<]*)<\/text>/)[1],
  };
}

// XML パーサーの代わりに、この SVG で使うタグの対応と文字参照を確かめる。
function checkXml(svg) {
  const source = svg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(source, /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/);
  const stack = [];
  let roots = 0;
  let end = 0;
  for (const match of source.matchAll(/<(\/?)([\w:-]+)\b[^>]*>/g)) {
    assert.doesNotMatch(source.slice(end, match.index), /[<>]/);
    const [tag, closing, name] = match;
    if (closing) {
      assert.match(tag, /^<\/[\w:-]+\s*>$/);
      assert.equal(stack.pop(), name, `閉じるタグ: ${name}`);
    } else {
      if (!stack.length) { roots++; assert.equal(name, 'svg'); }
      if (!/\/\s*>$/.test(tag)) stack.push(name);
    }
    end = match.index + tag.length;
  }
  assert.equal(source.slice(end).trim(), '');
  assert.equal(roots, 1);
  assert.deepEqual(stack, []);
}

for (const stamp of stamps) {
  test(`seen-${stamp.id}: ファイルがあり、色・言葉・大きさ・配置の指定を保つ`, () => {
    const svg = readStamp(stamp.id);
    const p = parts(svg);
    assert.equal(p.root.xmlns, 'http://www.w3.org/2000/svg');
    assert.equal(p.root.viewBox, '0 0 400 400');
    assert.equal(p.root.width, '400');
    assert.equal(p.root.height, '400');
    assert.equal(p.root.role, 'img');
    assert.equal(p.root['aria-label'], '先生が見ました');
    assert.match(svg, /<g transform="rotate\(-8 200 200\)">/);
    assert.match(svg, /<!-- 先生の「見ました」スタンプ（[^）]+）。[\s\S]*?-->/);
    assert.equal(p.outer.fill, stamp.background);
    for (const actual of [p.outer.stroke, p.dotted.stroke, p.top.fill, p.band.fill]) assert.equal(actual, stamp.color);
    assert.equal(p.dotted.fill, 'none');
    assert.equal(p.dotted['stroke-dasharray'], '2 9');
    assert.equal(p.topWord, stamp.top);
    assert.equal(p.bottomWord, stamp.bottom);
    assert.match(svg, /<path\b[^>]*\bid="arc-top"/);
    assert.equal(p.path.href, '#arc-top');
    assert.equal(p.path.startOffset, '50%');
    assert.equal(p.top['text-anchor'], 'middle');
    assert.ok(Number(p.top['font-size']) >= 28 && Number(p.top['font-size']) <= 34);
    assert.ok(Number(p.top['letter-spacing']) >= 0 && Number(p.top['letter-spacing']) <= 6);
    assert.equal(p.band.width, '216');
    assert.equal(p.band.x, '92');
    assert.equal(p.bottom.fill, '#FFFFFF');
    assert.equal(p.bottom.x, '200');
    assert.equal(p.bottom['text-anchor'], 'middle');
    assert.ok(Number(p.bottom['font-size']) >= 26 && Number(p.bottom['font-size']) <= 34);
    for (const text of [p.top, p.bottom]) {
      assert.equal(text['font-family'], "'Hiragino Maru Gothic ProN','Yu Gothic','Meiryo',sans-serif");
    }
    assert.doesNotMatch(svg, /@import|@font-face/);
  });

  test(`seen-${stamp.id}: XML の開き・閉じが対応し、不正な & がない`, () => {
    checkXml(readStamp(stamp.id));
  });
}

test('スタンプ 6 枚の色・背景色・上の言葉・下の言葉は、それぞれ重複しない', () => {
  const actual = stamps.map((stamp) => parts(readStamp(stamp.id)));
  for (const values of [actual.map((p) => p.outer.stroke), actual.map((p) => p.outer.fill), actual.map((p) => p.topWord), actual.map((p) => p.bottomWord)]) {
    assert.equal(new Set(values).size, 6);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, htmlToText } from '../src/lib/text.ts';

test('reader entities: author accents, math, long names and multi-codepoint references decode', () => {
  assert.equal(decodeEntities('D&iacute;az &eacute; &Aacute; &alpha; &rarr;'), 'Díaz é Á α →');
  assert.equal(decodeEntities('&CounterClockwiseContourIntegral; &NotEqualTilde;'), '∳ ≂̸');
  assert.equal(decodeEntities('&frac12; &sup2; &AMP; &apos;'), "½ ² & '");
  assert.equal(htmlToText('<p>Credit: &copy; Jos&eacute; &amp; Ana</p>'), 'Credit: © José & Ana');
});

test('reader entities: unknown and unterminated references stay text; decoding is single pass', () => {
  assert.equal(decodeEntities('&unknown; &Amp; &iacute &amp;iacute;'), '&unknown; &Amp; &iacute &iacute;');
  assert.equal(decodeEntities('&#x1f984; &#128512;'), '🦄 😀');
  assert.equal(decodeEntities('&#xD800; &#1114112; &#0;'), '&#xD800; &#1114112; &#0;');
});

test('reader entities: excessive malformed reference names remain bounded plain text', () => {
  const input = '&' + 'a'.repeat(100_000) + ';';
  assert.equal(decodeEntities(input), input);
});

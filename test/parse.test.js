import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, extractCode } from '../src/parse.js';

test('yes/no accepts Y, yes, N, NO in any case', () => {
  for (const [t, v] of [['y', true], ['YES', true], ['Yes!', true], ['n', false], ['No', false], [' no. ', false]]) {
    assert.equal(parseReply(t, 'yes_no').valueBool, v, t);
  }
});

test('yes/no rejects other text', () => {
  for (const t of ['maybe', 'yesterday', 'nope', '']) assert.equal(parseReply(t, 'yes_no').ok, false, t);
});

test('rating stores value and comment', () => {
  const r = parseReply('3 tough day, needed help', 'rating');
  assert.deepEqual(r, { ok: true, valueInt: 3, comment: 'tough day, needed help' });
  assert.equal(parseReply('4', 'rating').comment, null);
});

test('rating rejects out of range and multi-digit', () => {
  for (const t of ['6', '10', '4.5', 'five']) assert.equal(parseReply(t, 'rating').ok, false, t);
});

test('goal code is extracted and stripped', () => {
  assert.deepEqual(extractCode('Goal 2: y'), { code: 2, rest: 'y' });
  assert.deepEqual(extractCode('4 did great'), { code: null, rest: '4 did great' });
});

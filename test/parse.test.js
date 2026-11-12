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

test('duration stores minutes and ignores extra text', () => {
  assert.deepEqual(parseReply('15 tough day, needed help', 'duration'), { ok: true, valueMinutes: 15 });
  assert.deepEqual(parseReply('0', 'duration'), { ok: true, valueMinutes: 0 });
  assert.deepEqual(parseReply('20 min', 'duration'), { ok: true, valueMinutes: 20 });
  assert.deepEqual(parseReply('1440', 'duration'), { ok: true, valueMinutes: 1440 });
});

test('duration rejects non-numbers, decimals and values above a day', () => {
  for (const t of ['1441', '4.5', 'fifteen', '', 'about 15']) assert.equal(parseReply(t, 'duration').ok, false, t);
});

test('goal code is extracted and stripped', () => {
  assert.deepEqual(extractCode('Goal 2: y'), { code: 2, rest: 'y' });
  assert.deepEqual(extractCode('4 did great'), { code: null, rest: '4 did great' });
});

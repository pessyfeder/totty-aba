import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPercent, movingAverage } from '../public/charts.js';

test('weekly percent ignores unanswered days (never counted as No)', () => {
  const pts = [
    { date: '2026-11-01', answered: true, value_bool: true },   // Sunday
    { date: '2026-11-02', answered: true, value_bool: false },
    { date: '2026-11-03', answered: false, value_bool: null },
    { date: '2026-11-08', answered: true, value_bool: true },   // next Sunday
  ];
  const w = weeklyPercent(pts);
  assert.equal(w.length, 2);
  assert.deepEqual([w[0].pct, w[0].n], [50, 2]);
  assert.deepEqual([w[1].pct, w[1].n], [100, 1]);
});

test('moving average skips missing values', () => {
  assert.deepEqual(movingAverage([2, null, 4], 3), [2, 2, 3]);
});

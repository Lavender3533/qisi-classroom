import test from 'node:test';
import assert from 'node:assert/strict';

import { formatJavaAccumulatorTrace, traceSimpleJavaAccumulator } from '../frontend/code-trace.js';

test('Java accumulator trace separates final sum from the loop exit value', () => {
  const trace = traceSimpleJavaAccumulator(`
    int sum = 1;
    for (int i = 1; i <= 6; i++) {
      sum += i;
    }
  `);
  assert.equal(trace.finalSum, 22);
  assert.equal(trace.lastIncludedI, 6);
  assert.equal(trace.exitI, 7);
  assert.equal(trace.iterations, 6);
  assert.match(formatJavaAccumulatorTrace(trace), /最终 sum=22/);
  assert.match(formatJavaAccumulatorTrace(trace), /退出循环时 i=7/);
});

test('Java accumulator trace computes the original 3 through 7 task as 25', () => {
  const trace = traceSimpleJavaAccumulator('int sum = 0; for (int i = 3; i <= 7; i++) { sum += i; }');
  assert.equal(trace.finalSum, 25);
  assert.deepEqual(trace.rounds.map(item => item.sum), [3, 7, 12, 18, 25]);
  assert.equal(trace.exitI, 8);
});

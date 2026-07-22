import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabSubmission, createJavaLabForFocus, normalizeCodingLab, updateLabAfterRun } from '../frontend/programming-lab.js';

test('Java lab presets cover increment order and String reference semantics', () => {
  const increment = createJavaLabForFocus('Java表达式求值顺序与 ++i、i++');
  assert.match(increment.initialCode, /int r = \+\+i \+ i\+\+/);
  const stringLab = createJavaLabForFocus('String 对象的引用比较与 == 运算符');
  assert.match(stringLab.initialCode, /s1\.equals\(s2\)/);
  assert.match(stringLab.initialCode, /s1 == s3/);
});

test('coding lab normalization accepts Java source but rejects other languages and incomplete entrypoints', () => {
  const lab = normalizeCodingLab({ language: 'java', title: '引用实验', initial_code: 'public class Demo { public static void main(String[] args) {} }', observations: ['先预测', '再运行'], task_key: 'untrusted-key' }, { taskKey: 'task-1' });
  assert.equal(lab.fileName, 'Demo.java');
  assert.equal(lab.taskKey, 'task-1');
  assert.equal(normalizeCodingLab({ language: 'python', code: 'print(1)' }), null);
  assert.equal(normalizeCodingLab({ language: 'java', code: 'class Demo {}' }), null);
});

test('exploratory runs stay separate from task-bound submissions', () => {
  const exploratory = normalizeCodingLab(createJavaLabForFocus('++i'));
  const ran = updateLabAfterRun(exploratory, { success: true, stdout: 'r = 8\ni = 5', execution_time_ms: 42 });
  assert.equal(ran.status, 'succeeded');
  assert.equal(buildLabSubmission(ran), null);
  const bound = { ...ran, taskKey: 'lesson-task' };
  assert.equal(buildLabSubmission(bound).stdout, 'r = 8\ni = 5');
});

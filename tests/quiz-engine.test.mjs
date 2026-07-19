import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateQuizAnswer,
  formatStudentMessageForDisplay,
  getCodeExerciseSubmission,
  formatCodeForDisplay,
  getQuizCorrectAnswer,
  isEditableCodeExercise,
  isInternalTeacherCommand,
  planQuizAttempt,
  splitQuestionContent,
} from '../frontend/quiz-engine.js';

test('code submission hides internal teacher instructions from the student bubble', () => {
  const message = '老师，请点评我刚完成的代码练习。\n我的代码：\n```java\nint sum = 0;\n```\n请先检查我补全的位置，再指出一个最关键的改进点。';
  assert.deepEqual(getCodeExerciseSubmission(message), { language: 'java', code: 'int sum = 0;' });
  assert.equal(formatStudentMessageForDisplay(message), '我的代码练习\n```java\nint sum = 0;\n```');
  assert.equal(getCodeExerciseSubmission('我觉得答案是 15'), null);
  assert.equal(formatStudentMessageForDisplay('我觉得答案是 15'), '我觉得答案是 15');
});

test('application orchestration commands are not treated as student speech', () => {
  assert.equal(isInternalTeacherCommand('老师，请根据当前目标“循环累加”给我一个两分钟内能完成的小任务。'), true);
  assert.equal(isInternalTeacherCommand('老师，请根据本节目标开始章节评估。一次只出一道题。'), true);
  assert.equal(isInternalTeacherCommand('老师，我还是不理解 sum += i，请再讲一次。'), false);
});

test('choice quiz validates selection and reports correctness', () => {
  const quiz = { type: 'choice', options: ['A', 'B', 'C'], answer: 1 };
  assert.equal(evaluateQuizAnswer(quiz, null).valid, false);
  assert.deepEqual(evaluateQuizAnswer(quiz, 1), { valid: true, correct: true, answer: 1 });
  assert.equal(evaluateQuizAnswer(quiz, 0).correct, false);
  assert.equal(getQuizCorrectAnswer(quiz), 'B');
});

test('fill quiz normalizes case and whitespace', () => {
  const quiz = { type: 'fill', answer: 'System.out.println' };
  assert.equal(evaluateQuizAnswer(quiz, '  system.OUT.println  ').correct, true);
  assert.equal(evaluateQuizAnswer(quiz, '').valid, false);
});

test('quiz uses guided retry before revealing the answer', () => {
  const quiz = { type: 'choice', options: ['10', '15'], answer: 1, hint: '逐轮写出 sum 的变化。', explanation: '循环会累加 1 到 5。' };
  const wrong = evaluateQuizAnswer(quiz, 0);
  const first = planQuizAttempt(quiz, wrong, 1);
  assert.equal(first.retry, true);
  assert.equal(first.revealAnswer, false);
  assert.match(first.message, /先不公布答案/);
  const second = planQuizAttempt(quiz, wrong, 2);
  assert.equal(second.complete, true);
  assert.equal(second.revealAnswer, true);
  assert.match(second.message, /正确答案：15/);
  const corrected = planQuizAttempt(quiz, evaluateQuizAnswer(quiz, 1), 2);
  assert.equal(corrected.complete, true);
  assert.match(corrected.message, /修正正确/);
});

test('question formatter separates Java code from the instruction', () => {
  const content = splitQuestionContent('执行以下代码后，控制台会输出什么？ int score = 75; if (score >= 60) { System.out.println("及格"); }');
  assert.equal(content.prompt, '执行以下代码后，控制台会输出什么？');
  assert.match(content.code, /^int score = 75;/);
  assert.match(content.code, /System\.out\.println/);
  assert.match(content.code, /if \(score >= 60\) \{\n {4}System/);
});

test('code formatter preserves for-loop semicolons while restoring indentation', () => {
  const code = formatCodeForDisplay('for (int i = 0; i < 3; i++) { System.out.println(i); }');
  assert.match(code, /^for \(int i = 0; i < 3; i\+\+\) \{/);
  assert.match(code, /\n {4}System\.out\.println\(i\);\n}/);
});

test('only incomplete code is promoted to an editable exercise', () => {
  assert.equal(isEditableCodeExercise('sum += i;'), false);
  assert.equal(isEditableCodeExercise('for (...) {\n    _______;\n}'), true);
  assert.equal(isEditableCodeExercise('// TODO: 补全循环体'), true);
});

test('question formatter supports fenced code and leaves prose untouched', () => {
  assert.deepEqual(splitQuestionContent('这段代码有什么问题？\n```java\nint x = ;\n```'), {
    prompt: '这段代码有什么问题？', code: 'int x = ;',
  });
  assert.deepEqual(splitQuestionContent('Java 的入口方法叫什么？'), {
    prompt: 'Java 的入口方法叫什么？', code: '',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTeachingReplay, replayInstructionalDecisions } from '../frontend/teaching-quality-eval.js';

const instructionBlock = {
  prior_connection: '已经见过变量赋值', mental_model: '表达式先产生值，再产生副作用',
  worked_example: 'i++ 先交出旧值，再让 i 加一', subgoals: ['记录旧值', '变量加一'],
  contrast_or_boundary: '++i 先加一再交出新值', summary: '区分表达式值和变量最终值',
};

test('healthy replay teaches, transfers, and stops without another task', () => {
  const replay = evaluateTeachingReplay([
    { role: 'assistant', teacher_move: 'explain', instruction_block: instructionBlock, knowledge_point: '前置与后置自增', student_task: { kind: 'none' } },
    { role: 'user', message: '我理解表达式值和变量值是两件事了' },
    { role: 'assistant', teacher_move: 'question', knowledge_point: '前置与后置自增', evidence_stage: 'transferred', correct: true, student_task: { kind: 'none' } },
    { role: 'assistant', teacher_move: 'summary', knowledge_point: '下一知识点', checkpoint: '进入下一节新内容', can_advance: true, student_task: { kind: 'none' } },
  ]);
  assert.equal(replay.passed, true);
  assert.equal(replay.stopDelay, 0);
  assert.equal(replay.explanationCompleteness, 1);
});

test('student experience gate rejects teacher monologue streaks and missing next lesson exit', () => {
  const replay = evaluateTeachingReplay([
    { role: 'user', message: '我看完了' },
    { role: 'assistant', teacher_move: 'practice', student_task: { kind: 'practice', prompt: '判断 p.show() 的输出' } },
    { role: 'assistant', teacher_move: 'practice', student_task: { kind: 'practice', prompt: '判断 p.show() 的输出' } },
    { role: 'assistant', teacher_move: 'summary', message: '本节结束', checkpoint: '查看复习安排', student_task: { kind: 'none' } },
  ]);
  assert.equal(replay.passed, false);
  assert.equal(replay.longestTeacherStreak, 3);
  assert.equal(replay.summariesWithoutNextStep, 1);
});

test('student experience gate rejects a substantial lesson dominated by tasks', () => {
  const task = index => ({
    role: 'assistant', teacher_move: 'question', knowledge_point: `知识点${index}`,
    student_task: { kind: 'knowledge_check', prompt: `计算第${index}个不同问题` },
  });
  const replay = evaluateTeachingReplay([
    { role: 'assistant', teacher_move: 'explain', instruction_block: instructionBlock, student_task: { kind: 'none' } },
    { role: 'user', message: '继续' }, task(1), { role: 'user', message: '1' }, task(2),
    { role: 'user', message: '2' }, task(3), { role: 'user', message: '3' }, task(4),
    { role: 'user', message: '4' }, task(5), { role: 'user', message: '5' },
  ]);
  assert.equal(replay.passed, false);
  assert.ok(replay.taskRate > 0.45);
  assert.ok(replay.explanationToTaskRatio < 0.25);
});

test('replay rejects repeated task chains and checks after transfer', () => {
  const task = { kind: 'knowledge_check', prompt: '请写出 i++ 的结果', knowledge_point: '前置与后置自增' };
  const replay = evaluateTeachingReplay([
    { role: 'assistant', teacher_move: 'question', knowledge_point: '前置与后置自增', student_task: task },
    { role: 'assistant', teacher_move: 'question', knowledge_point: 'i++ 和 ++i', evidence_stage: 'transferred', correct: true, student_task: task },
    { role: 'assistant', teacher_move: 'question', knowledge_point: 'i++ 和 ++i', student_task: task },
  ]);
  assert.equal(replay.passed, false);
  assert.ok(replay.longestTaskChain >= 3);
  assert.ok(replay.duplicateSemanticTasks >= 1);
  assert.equal(replay.stopDelay, 1);
});

test('decision replay covers support, direct correction, intent, and prerequisite fallback', () => {
  const decisions = replayInstructionalDecisions([
    { correct: true, stage: 'guided', supportLevel: 'prompted' },
    { correct: false, consecutiveDifficulty: 1 },
    { studentIntent: 'concept_question' },
    { studentIntent: 'advance' },
    { correct: false, consecutiveDifficulty: 3 },
  ]);
  assert.deepEqual(decisions.map(item => item.action), [
    'independent_recheck', 'correct_and_explain', 'explain',
    'advance_and_schedule_review', 'check_prerequisite',
  ]);
});

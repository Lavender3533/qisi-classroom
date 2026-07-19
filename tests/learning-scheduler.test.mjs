import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLearnerProfile,
  buildReviewQueue,
  buildTeachingMemory,
  deriveTeachingPreferenceSignal,
  deriveTeachingStrategyOutcome,
  normalizeTeachingPreferences,
  updateTeachingPreferences,
} from '../frontend/learning-scheduler.js';

const NOW = new Date('2026-07-15T12:00:00Z');

test('very weak knowledge is due immediately', () => {
  const [item] = buildReviewQueue([{
    id: 1, name: '二次函数顶点', mastery: 0.2, last_reviewed: '2026-07-15T10:00:00Z', practice_count: 2, correct_count: 0,
  }], [], NOW);
  assert.equal(item.urgency, 'due');
  assert.equal(item.label, '今天复习');
});

test('older mistakes raise review priority', () => {
  const queue = buildReviewQueue([
    { id: 1, name: '变量', mastery: 0.45, last_reviewed: '2026-07-14T12:00:00Z' },
    { id: 2, name: '循环', mastery: 0.45, last_reviewed: '2026-07-14T12:00:00Z' },
  ], [
    { knowledge_point: '循环', created_at: '2026-07-15T08:00:00Z' },
    { knowledge_point: '循环', created_at: '2026-07-14T08:00:00Z' },
  ], NOW);
  assert.equal(queue[0].name, '循环');
  assert.equal(queue[0].mistakeCount, 2);
});

test('well-mastered recent knowledge is scheduled later', () => {
  const [item] = buildReviewQueue([{
    id: 1, name: '列表', mastery: 0.85, last_reviewed: '2026-07-15T10:00:00Z', practice_count: 8, correct_count: 7,
  }], [], NOW);
  assert.equal(item.urgency, 'later');
  assert.match(item.label, /天后/);
});

test('recent failed evidence raises priority without inventing mastery changes', () => {
  const queue = buildReviewQueue([
    { name: '变量', mastery: 0.5, last_reviewed: '2026-07-14T12:00:00Z' },
    { name: '循环', mastery: 0.5, last_reviewed: '2026-07-14T12:00:00Z' },
  ], [], NOW, [
    { event_type: 'quiz_answer', knowledge_points_json: '["循环"]', detail_json: '{"correct":false}' },
  ]);
  assert.equal(queue[0].name, '循环');
  assert.equal(queue[0].recentFailureCount, 1);
  assert.equal(queue[0].mastery, 0.5);
});

test('learner profile combines strengths, recurring errors, hint dependence, and next focus', () => {
  const profile = buildLearnerProfile([
    { name: '变量', mastery: 0.9, last_reviewed: '2026-07-15T10:00:00Z' },
    { name: '循环边界', mastery: 0.3, last_reviewed: '2026-07-14T10:00:00Z' },
  ], [
    { knowledge_point: '循环边界', error_type: 'off_by_one' },
    { knowledge_point: '循环边界', error_type: 'off_by_one' },
  ], [
    { event_type: 'practice_submit', detail_json: '{"hintCount":1}' },
    { event_type: 'practice_submit', detail_json: '{"hintCount":2}' },
  ], { next_lesson_focus: '循环边界迁移' }, NOW);
  assert.equal(profile.strengths[0].name, '变量');
  assert.equal(profile.priorities[0].name, '循环边界');
  assert.deepEqual(profile.recurringPatterns.map(item => item.pattern), ['hint_dependence', 'off_by_one']);
  assert.equal(profile.nextFocus, '循环边界迁移');
});

test('grounded teacher diagnoses become longitudinal patterns and review evidence', () => {
  const events = [
    {
      event_type: 'teacher_diagnosis', knowledge_points_json: '["循环边界"]',
      detail_json: '{"category":"concept_confusion","evidenceQuote":"会把 5 也算进去"}',
    },
    {
      event_type: 'teacher_diagnosis', knowledge_points_json: '["循环边界"]',
      detail_json: '{"category":"concept_confusion","evidenceQuote":"结束值也会执行"}',
    },
  ];
  const profile = buildLearnerProfile([
    { name: '循环边界', mastery: 0.55, last_reviewed: '2026-07-15T10:00:00Z' },
  ], [], events, null, NOW);
  assert.equal(profile.priorities[0].recentFailureCount, 2);
  assert.deepEqual(profile.recurringPatterns[0], { pattern: 'concept_confusion', count: 2 });
});

test('explicit pace and representation requests become bounded teaching preferences', () => {
  const slower = deriveTeachingPreferenceSignal('太快了，请一步一步讲');
  assert.equal(slower.pace, 'slower');
  const compact = deriveTeachingPreferenceSignal('我只有十分钟，只讲重点');
  assert.equal(compact.pace, 'compact');
  const exampleChoice = deriveTeachingPreferenceSignal('B', {
    pendingStudentTask: {
      kind: 'learning_choice',
      prompt: '选择 A 慢一点逐步讲，或 B 先看完整例子',
    },
  });
  assert.equal(exampleChoice.representation, 'worked_example');
  const visualChoice = deriveTeachingPreferenceSignal('B', {
    pendingStudentTask: {
      kind: 'learning_choice',
      prompt: 'A. 加快节奏，只看重点；B. 慢一点，用表格逐步追踪',
    },
  });
  assert.equal(visualChoice.pace, 'slower');
  assert.equal(visualChoice.representation, 'visual');

  const preferences = updateTeachingPreferences(null, slower, '2026-07-16T10:00:00Z');
  assert.equal(preferences.pace.label, '放慢并拆成小步');
  assert.match(preferences.pace.evidence, /太快了/);
  assert.deepEqual(normalizeTeachingPreferences(preferences), preferences);
});

test('strategy outcome is attributed only to verified responses to mastery tasks', () => {
  const base = {
    lastTeacherMove: { move: 'model', teachingStrategy: 'state_trace' },
    pendingStudentTask: { kind: 'knowledge_check', evidenceScope: 'mastery', knowledgePoint: '循环累加' },
    studentTurnType: 'attempt',
  };
  const independent = deriveTeachingStrategyOutcome({
    ...base,
    studentStateUpdate: {
      knowledgePoint: '循环累加', delta: 0.08, supportLevel: 'independent',
      evidence: '学生独立写出每轮 sum 的值',
    },
  });
  assert.equal(independent.strategy, 'state_trace');
  assert.equal(independent.outcome, 'independent_success');

  const prompted = deriveTeachingStrategyOutcome({
    ...base,
    studentStateUpdate: { knowledgePoint: '循环累加', delta: 0.03, supportLevel: 'prompted', evidence: '根据提示修正' },
  });
  assert.equal(prompted.outcome, 'prompted_success');
  assert.equal(deriveTeachingStrategyOutcome({ ...base, studentTurnType: 'uncertain_attempt' }), null);
  assert.equal(deriveTeachingStrategyOutcome({
    ...base,
    pendingStudentTask: { kind: 'learning_choice', evidenceScope: 'preference' },
    studentStateUpdate: { delta: 0.1 },
  }), null);
});

test('teaching memory promotes independent success and avoids repeated failure', () => {
  const events = [
    {
      event_type: 'teaching_preference', created_at: '2026-07-14T08:00:00Z',
      detail_json: '{"pace":"slower","evidence":"太快了"}',
    },
    {
      event_type: 'teacher_strategy_outcome', created_at: '2026-07-14T09:00:00Z',
      detail_json: '{"strategy":"direct_explanation","outcome":"difficulty","knowledgePoint":"循环","evidence":"仍无法追踪"}',
    },
    {
      event_type: 'teacher_strategy_outcome', created_at: '2026-07-14T09:05:00Z',
      detail_json: '{"strategy":"direct_explanation","outcome":"difficulty","knowledgePoint":"循环","evidence":"再次卡住"}',
    },
    {
      event_type: 'teacher_strategy_outcome', created_at: '2026-07-14T09:10:00Z',
      detail_json: '{"strategy":"state_trace","outcome":"prompted_success","knowledgePoint":"循环","evidence":"按表格修正"}',
    },
    {
      event_type: 'teacher_strategy_outcome', created_at: '2026-07-14T09:15:00Z',
      detail_json: '{"strategy":"state_trace","outcome":"independent_success","knowledgePoint":"循环","evidence":"独立追踪变量"}',
    },
  ];
  const memory = buildTeachingMemory(events);
  assert.equal(memory.preferences.pace.value, 'slower');
  assert.equal(memory.effectiveStrategies[0].strategy, 'state_trace');
  assert.equal(memory.effectiveStrategies[0].independentSuccesses, 1);
  assert.equal(memory.avoidStrategies[0].strategy, 'direct_explanation');
  assert.equal(memory.avoidStrategies[0].difficulties, 2);

  const profile = buildLearnerProfile([], [], events, null, NOW);
  assert.equal(profile.teachingMemory.effectiveStrategies[0].label, '状态追踪');
});

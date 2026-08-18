import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideInstructionalAction,
  deriveEvidenceStage,
  deriveTaskEvidenceStage,
  normalizeCanonicalKnowledgeComponent,
  normalizeEvidenceRecords,
  projectMasteryFromEvidence,
  validateInstructionBlock,
} from '../frontend/evidence-driven-instruction.js';

test('an explicit independent transfer task outranks the current lesson phase', () => {
  assert.equal(deriveTaskEvidenceStage({
    studentUpdate: { delta: 0.12, supportLevel: 'independent' },
    task: { supportContext: 'independent', cadenceRole: 'transfer_check' },
    lessonPhase: 'explain',
  }), 'transferred');
  assert.equal(deriveTaskEvidenceStage({
    studentUpdate: { delta: 0.04, supportLevel: 'prompted' },
    task: { supportContext: 'independent', cadenceRole: 'transfer_check' },
    lessonPhase: 'check',
  }), 'guided');
});

const base = { subject_id: 'java', canonical_key: 'java.increment', source: 'independent_verifier', task_key: 'task-1', created_at: '2026-07-20T08:00:00Z', trusted: true };

test('canonical component uses stable identity and normalized curriculum fields', () => {
  const component = normalizeCanonicalKnowledgeComponent({
    subject_id: 'java', key: ' Java Increment ', name: '前置与后置自增',
    prerequisites: ['变量赋值', '变量赋值'], performance_goals: ['追踪表达式值与变量值'],
  });
  assert.equal(component.key, 'java-increment');
  assert.deepEqual(component.prerequisites, ['变量赋值']);
  assert.equal(component.performanceGoals[0], '追踪表达式值与变量值');
});

test('prompted success never becomes independent or transferred', () => {
  const result = deriveEvidenceStage([{ ...base, stage: 'transferred', support_level: 'prompted', correct: true }]);
  assert.equal(result.stage, 'unknown');
  const guided = deriveEvidenceStage([{ ...base, stage: 'guided', support_level: 'prompted', correct: true }]);
  assert.equal(guided.stage, 'guided');
});

test('retained requires prior advanced evidence and minimum delay', () => {
  const records = [
    { ...base, stage: 'transferred', support_level: 'none', correct: true },
    { ...base, id: 'later', stage: 'retained', support_level: 'none', correct: true, task_key: 'retrieval-2', created_at: '2026-07-20T22:00:00Z' },
  ];
  assert.equal(deriveEvidenceStage(records).stage, 'retained');
  assert.equal(deriveEvidenceStage(records, { retainedMinimumHours: 24 }).stage, 'transferred');
});

test('a later failure does not erase historical transfer evidence', () => {
  const result = deriveEvidenceStage([
    { ...base, stage: 'transferred', support_level: 'none', correct: true },
    { ...base, id: 'failed', stage: 'independent', correct: false, created_at: '2026-07-21T08:00:00Z' },
  ]);
  assert.equal(result.stage, 'transferred');
  assert.equal(result.failures, 1);
  assert.equal(result.pendingRetention, true);
});

test('evidence normalization is append-safe and idempotently deduplicated', () => {
  const record = { ...base, id: 'same', stage: 'independent', support_level: 'none', correct: true };
  assert.equal(normalizeEvidenceRecords([record, record]).length, 1);
});

test('mastery is a stable compatibility projection', () => {
  assert.equal(projectMasteryFromEvidence('guided'), 0.5);
  assert.equal(projectMasteryFromEvidence('transferred'), 0.86);
  assert.equal(projectMasteryFromEvidence([], { legacyMastery: 0.43 }), 0.43);
});

test('instructional policy directly corrects first error and changes course after repeats', () => {
  assert.deepEqual(decideInstructionalAction({ correct: false, consecutiveDifficulty: 1 }).action, 'correct_and_explain');
  assert.equal(decideInstructionalAction({ correct: false, consecutiveDifficulty: 2 }).action, 'change_representation');
  assert.equal(decideInstructionalAction({ correct: false, consecutiveDifficulty: 3 }).action, 'check_prerequisite');
});

test('instructional policy stops immediately after transfer and respects student intent', () => {
  const transferred = decideInstructionalAction({ correct: true, stage: 'transferred' });
  assert.equal(transferred.action, 'advance');
  assert.equal(transferred.closeTask, true);
  const next = decideInstructionalAction({ studentIntent: 'advance', stage: 'guided' });
  assert.equal(next.action, 'advance_and_schedule_review');
  assert.equal(next.scheduleReview, true);
});

test('concept question suspends the old task without grading', () => {
  const decision = decideInstructionalAction({ studentIntent: 'concept_question', correct: false });
  assert.equal(decision.action, 'explain');
  assert.equal(decision.allowEvidenceStage, null);
  assert.equal(decision.closeTask, true);
});

test('instruction block must contain every teaching element', () => {
  const incomplete = validateInstructionBlock({ mental_model: '变量像一个有名字的盒子' });
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.missing.includes('worked_example'));
  const complete = validateInstructionBlock({
    prior_connection: '你已经见过变量赋值', mental_model: '变量保存当前值',
    worked_example: '前置与后置自增：先读取 i，再观察变化', subgoals: ['记录旧值', '执行加一'],
    contrast_or_boundary: '单独成句时相同，参与表达式时不同', summary: '区分表达式结果与变量最终值',
  }, { name: '前置与后置自增' });
  assert.equal(complete.valid, true);
});

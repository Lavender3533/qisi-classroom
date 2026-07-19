import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTeacherReview,
  normalizeTeacherReview,
  shouldReviewTeacherTurn,
  unavailableTeacherReview,
} from '../frontend/teacher-review.js';

const candidate = {
  message: '对 x+3=5，把 3 移到右边仍是 +3，所以 x=8。',
  structured: {
    state: 'explain', teacher_move: 'explain', teaching_strategy: 'worked_example',
    intent: '讲解一元一次方程', checkpoint: '只写 x 的值',
    student_task: {
      kind: 'knowledge_check', prompt: '解 x+3=5，只写 x 的值',
      expected_response: 'x 的值', knowledge_point: '一元一次方程',
      assessment: {
        reference_answer: 'x=8', criteria: ['把3移到右边后相加'],
        acceptable_alternatives: ['8'], grading_mode: 'equivalent',
      },
    },
    student_state_update: { knowledge_point: '方程', mastery_delta: -0.04 },
    learning_diagnosis: { category: 'procedure_gap', evidence_quote: 'x=8' },
    lesson_summary: { mastered: [] },
    homework_update: { homework_id: 1, status: 'graded' },
  },
};

const correctedReplacement = {
  state: 'explain',
  message: '等式两边同时减 3：x+3-3=5-3，所以 x=2。现在只写 x 的值。',
  teacher_move: 'explain', teaching_strategy: 'worked_example',
  intent: '用等式两边相同运算纠正推导', checkpoint: '只写 x 的值',
  student_task: {
    kind: 'knowledge_check', prompt: '解 x+3=5，只写 x 的值',
    expected_response: 'x 的值', knowledge_point: '一元一次方程',
    assessment: {
      reference_answer: 'x=2', criteria: ['等式两边同时减3'],
      acceptable_alternatives: ['2'], grading_mode: 'equivalent',
    },
  },
  quick_replies: [], visual: null, actions: [],
  student_state_update: { knowledge_point: '方程', mastery_delta: 0.15 },
  learning_diagnosis: { category: 'concept_confusion' },
  lesson_summary: null, homework_update: null,
};

test('only knowledge-bearing teacher turns require independent review', () => {
  assert.equal(shouldReviewTeacherTurn(candidate), true);
  assert.equal(shouldReviewTeacherTurn({
    message: '请选择继续或暂停。',
    structured: {
      teacher_move: 'clarify',
      student_task: { kind: 'readiness', prompt: '继续还是暂停' },
    },
  }), false);
  assert.equal(shouldReviewTeacherTurn({
    message: '请继续完成原任务。', structured: null, continuationKind: 'checkpoint_reminder',
  }), false);
  assert.equal(shouldReviewTeacherTurn({
    message: '下面解释 range 的结束值。',
    structured: { teacher_move: 'model', student_task: { kind: 'diagnostic_check' } },
  }), true);
});

test('pass requires high confidence and no reported issue', () => {
  const passed = normalizeTeacherReview({ verdict: 'pass', confidence: 0.91, issues: [], replacement: null }, candidate);
  assert.equal(passed.trusted, true);
  assert.equal(passed.verdict, 'pass');

  const contradictory = normalizeTeacherReview({
    verdict: 'pass', confidence: 0.95,
    issues: [{
      category: 'calculation_error', target: 'message', excerpt: 'x=8',
      reason: '代回原方程后等式不成立。', correction: 'x 应为 2。',
    }],
  }, candidate);
  assert.equal(contradictory.trusted, false);
  assert.equal(contradictory.verdict, 'unavailable');
});

test('trusted revision requires exact issue evidence and a complete replacement', () => {
  const review = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.97,
    issues: [{
      category: 'calculation_error', target: 'message', excerpt: '所以 x=8',
      reason: 'x=8 代回 x+3=5 不成立。',
      correction: '等式两边同时减3，得到 x=2。',
    }, {
      category: 'answer_key_mismatch', target: 'reference_answer', excerpt: 'x=8',
      reason: '隐藏答案与方程的实际解不一致。', correction: '参考答案改为 x=2。',
    }],
    replacement: correctedReplacement,
  }, candidate);
  assert.equal(review.trusted, true);
  assert.equal(review.verdict, 'revise');
  assert.equal(review.issues.length, 2);
  assert.equal(review.replacement.student_task.assessment.referenceAnswer, 'x=2');

  const fabricated = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.99,
    issues: [{
      category: 'factual_error', target: 'message', excerpt: '候选中不存在的错误句',
      reason: '这是伪造证据，不能接受。', correction: '应使用真实片段。',
    }],
    replacement: correctedReplacement,
  }, candidate);
  assert.equal(fabricated.trusted, false);

  const missingAssessment = structuredClone(correctedReplacement);
  missingAssessment.student_task.assessment = null;
  const incomplete = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.99,
    issues: [{
      category: 'calculation_error', target: 'message', excerpt: 'x=8',
      reason: '结果无法满足原方程。', correction: '应改为 x=2。',
    }],
    replacement: missingAssessment,
  }, candidate);
  assert.equal(incomplete.trusted, false);
});

test('applying a revision protects all student evidence fields', () => {
  const review = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.96,
    issues: [{
      category: 'logical_error', target: 'message', excerpt: '把 3 移到右边仍是 +3',
      reason: '该说法不等价于等式两边执行相同运算。',
      correction: '等式两边同时减3。',
    }],
    replacement: correctedReplacement,
  }, candidate);
  const applied = applyTeacherReview(candidate, review);
  assert.equal(applied.revised, true);
  assert.match(applied.message, /x=2/);
  assert.equal(applied.structured.student_task.assessment.referenceAnswer, 'x=2');
  assert.deepEqual(applied.structured.student_state_update, candidate.structured.student_state_update);
  assert.deepEqual(applied.structured.learning_diagnosis, candidate.structured.learning_diagnosis);
  assert.deepEqual(applied.structured.lesson_summary, candidate.structured.lesson_summary);
  assert.deepEqual(applied.structured.homework_update, candidate.structured.homework_update);
});

test('unavailable review keeps the original candidate', () => {
  const unavailable = unavailableTeacherReview('复核服务超时');
  const applied = applyTeacherReview(candidate, unavailable);
  assert.equal(applied.revised, false);
  assert.equal(applied.message, candidate.message);
  assert.equal(applied.structured, candidate.structured);
});

test('replacement preserves fenced code layout', () => {
  const codeCandidate = {
    message: '错误代码解释。',
    structured: {
      teacher_move: 'model',
      student_task: { kind: 'diagnostic_check', prompt: '观察代码' },
    },
  };
  const replacement = {
    state: 'explain', teacher_move: 'model', teaching_strategy: 'worked_example',
    intent: '展示正确代码', checkpoint: '只写输出值',
    message: '正确示例：\n```python\nfor i in range(1, 3):\n    print(i)\n```\n结束值 3 不包含。',
    student_task: {
      kind: 'diagnostic_check', prompt: '只写输出的两个整数',
      expected_response: '两个整数', knowledge_point: 'range', assessment: null,
    },
    quick_replies: [], actions: [], visual: null,
  };
  const review = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.9,
    issues: [{
      category: 'code_semantics_error', target: 'message', excerpt: '错误代码解释',
      reason: '候选没有准确说明循环范围。', correction: '说明结束值不包含。',
    }], replacement,
  }, codeCandidate);
  assert.match(review.replacement.message, /```python\nfor i/);
});

test('known reviewer move aliases normalize to the teacher protocol', () => {
  const replacement = structuredClone(correctedReplacement);
  replacement.teacher_move = 'elicit';
  const review = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.93,
    issues: [{
      category: 'calculation_error', target: 'message', excerpt: 'x=8',
      reason: '结果不满足原方程。', correction: '改为 x=2。',
    }], replacement,
  }, candidate);
  assert.equal(review.trusted, true);
  assert.equal(review.replacement.teacher_move, 'question');
});

test('reviewer can ground a board issue and replace the visible board update', () => {
  const boardCandidate = structuredClone(candidate);
  boardCandidate.structured.board_update = {
    mode: 'replace', title: '移项板书', items: ['把 3 移到右边仍写 +3', 'x=8'],
  };
  const replacement = structuredClone(correctedReplacement);
  replacement.board_update = {
    mode: 'replace', title: '等式两边同做', items: ['两边同时减 3', 'x=2'],
  };
  const review = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.98,
    issues: [{
      category: 'logical_error', target: 'board', excerpt: '把 3 移到右边仍写 +3',
      reason: '板书中的变形不保持原方程等价。', correction: '改为等式两边同时减 3。',
    }],
    replacement,
  }, boardCandidate);

  assert.equal(review.trusted, true);
  assert.equal(review.issues[0].target, 'board');
  assert.deepEqual(review.replacement.board_update.items, ['两边同时减 3', 'x=2']);

  const missingBoard = structuredClone(replacement);
  missingBoard.board_update = { mode: 'keep', title: '', items: [] };
  const incomplete = normalizeTeacherReview({
    verdict: 'revise', confidence: 0.98,
    issues: [{
      category: 'logical_error', target: 'board', excerpt: '把 3 移到右边仍写 +3',
      reason: '板书中的变形不保持原方程等价。', correction: '改为等式两边同时减 3。',
    }],
    replacement: missingBoard,
  }, boardCandidate);
  assert.equal(incomplete.trusted, false);
});

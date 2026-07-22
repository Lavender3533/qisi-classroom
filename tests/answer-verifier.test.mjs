import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAnswerVerificationToTeacherTurn,
  buildAnswerVerificationDirective,
  enforceRepairClosureTurn,
  enforceStepwiseCorrectionTask,
  enforceVerifiedTeacherMessage,
  learningDiagnosisFromVerification,
  normalizeAnswerVerification,
  planRepairContinuation,
  shouldVerifyStudentAnswer,
  studentStateUpdateFromVerification,
  unavailableAnswerVerification,
} from '../frontend/answer-verifier.js';
import { normalizeStudentTask } from '../frontend/teacher-engine.js';

const task = {
  kind: 'knowledge_check', evidenceScope: 'mastery', knowledgePoint: '一元一次方程移项',
  prompt: '解 2x+3=11，写出关键步骤和 x 的值', expectedResponse: '一个等式和 x 的值',
  supportContext: 'independent', key: 'equation-check',
  assessment: {
    referenceAnswer: '两边同时减3得到2x=8，再同时除以2得到x=4',
    criteria: ['等式两边同时减3', '两边同时除以2'],
    acceptableAlternatives: ['x=4'], gradingMode: 'process',
  },
};

test('only real responses to mastery tasks use independent verification', () => {
  assert.equal(shouldVerifyStudentAnswer(task, 'attempt'), true);
  assert.equal(shouldVerifyStudentAnswer({ ...task, kind: 'practice' }, 'submitted_work'), true);
  assert.equal(shouldVerifyStudentAnswer({ ...task, evidenceScope: 'diagnosis' }, 'attempt'), false);
  assert.equal(shouldVerifyStudentAnswer(task, 'question'), false);
  assert.equal(shouldVerifyStudentAnswer(null, 'attempt'), false);
});

test('definitive verdict requires confidence and an excerpt from this answer', () => {
  const correct = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.92, answer_excerpt: 'x=4',
    reason: '代回原方程得到 2×4+3=11。', feedback: '结果和等价变形都正确。',
  }, { studentAnswer: '我算出 x=4。' });
  assert.equal(correct.verdict, 'correct');
  assert.equal(correct.trusted, true);

  const fabricated = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.95, answer_excerpt: 'x=6',
    reason: '模型声称答案正确。', feedback: '答案正确。',
  }, { studentAnswer: '我算出 x=4。' });
  assert.equal(fabricated.verdict, 'insufficient');
  assert.equal(fabricated.trusted, false);

  const uncertain = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.5, answer_excerpt: 'x=4',
    reason: '置信度不足以判定。', feedback: '需要再检查。',
  }, { studentAnswer: 'x=4' });
  assert.equal(uncertain.verdict, 'insufficient');

  const noLeak = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.9, answer_excerpt: 'x=5',
    reason: '代回后等式不成立。', feedback: '正确答案其实是 x=4。',
  }, {
    studentAnswer: 'x=5',
    task: { assessment: { referenceAnswer: 'x=4' } },
  });
  assert.doesNotMatch(noLeak.feedback, /x=4/);
});

test('client constructs mastery evidence from the verifier, not the teacher claim', () => {
  const verification = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.9, answer_excerpt: 'x=5',
    reason: '代回得到 13，不等于方程右边 11。', feedback: '把 x=5 代回后等式不成立。',
  }, { studentAnswer: 'x=5' });
  const rawUpdate = studentStateUpdateFromVerification(verification, task);
  assert.equal(rawUpdate.mastery_delta, -0.04);
  assert.match(rawUpdate.evidence, /x=5/);
  const guarded = applyAnswerVerificationToTeacherTurn({
    student_state_update: { mastery_delta: 0.15, evidence: '教师错误地宣布正确' },
  }, verification, task);
  assert.equal(guarded.student_state_update.mastery_delta, -0.04);

  const prompted = studentStateUpdateFromVerification({
    ...verification, verdict: 'correct', feedback: '提示后修正正确。',
  }, { ...task, supportContext: 'scaffolded' });
  assert.equal(prompted.mastery_delta, 0.03);
  assert.equal(prompted.support_level, 'prompted');
});

test('incorrect multi-step work localizes the first error and preserves the valid prefix', () => {
  const studentAnswer = '两边同时减3，得到2x=8；然后两边除以2，我写成x=6。';
  const verification = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.96, answer_excerpt: 'x=6',
    verified_part_excerpt: '得到2x=8', first_error_excerpt: 'x=6',
    error_category: 'careless_error',
    correction_focus: '从 2x=8 求 x 时，两边必须同时除以 2。',
    reason: '第一步保持等式成立，最后的除法结果不成立。',
    feedback: '前面的等式成立，最后一步需要重新核对。',
  }, { studentAnswer, task });

  assert.equal(verification.trusted, true);
  assert.equal(verification.diagnosisTrusted, true);
  assert.equal(verification.verifiedPartExcerpt, '得到2x=8');
  assert.equal(verification.firstErrorExcerpt, 'x=6');
  const diagnosis = learningDiagnosisFromVerification(verification, task);
  assert.equal(diagnosis.category, 'careless_error');
  assert.equal(diagnosis.evidence_quote, 'x=6');
  assert.equal(diagnosis.source, 'independent_verifier');

  const guarded = applyAnswerVerificationToTeacherTurn({
    learning_diagnosis: { category: 'concept_confusion', evidence_quote: '两边同时减3' },
  }, verification, task);
  assert.equal(guarded.learning_diagnosis.category, 'careless_error');

  const localized = enforceStepwiseCorrectionTask({
    teacher_move: 'feedback', checkpoint: '请从头重做整题',
    student_task: { kind: 'practice', prompt: '重新解出完整方程' },
    learning_diagnosis: guarded.learning_diagnosis,
  }, verification, task);
  assert.equal(localized.student_task.kind, 'none');
  assert.equal(localized.instructional_correction.stage, 'explained');
  assert.equal(localized.student_state_update, null);
  const continuation = planRepairContinuation({ task, verification });
  assert.equal(continuation.kind, 'instructional_recheck');
  assert.match(continuation.command, /新同构题/);

  const transferTask = { ...task, cadenceRole: 'transfer_check' };
  assert.equal(planRepairContinuation({ task: transferTask, verification }), null);

  const visible = enforceVerifiedTeacherMessage('答案错误，我来讲清最后一步。', verification, localized, task);
  assert.match(visible, /得到2x=8/);
  assert.match(visible, /x=6/);
  assert.match(visible, /两边必须同时除以 2/);
  assert.match(visible, /正确答案.*x=4/);
});

test('invalid or absent localization never becomes a specific diagnosis', () => {
  const studentAnswer = '先得到2x=8，最后写x=6。';
  const reversed = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.9, answer_excerpt: 'x=6',
    verified_part_excerpt: 'x=6', first_error_excerpt: '2x=8',
    error_category: 'procedure_gap', correction_focus: '核对最后一步除法。',
    reason: '最终结果与前一步不一致。', feedback: '请核对最后一步。',
  }, { studentAnswer });
  assert.equal(reversed.trusted, true);
  assert.equal(reversed.diagnosisTrusted, false);
  assert.equal(learningDiagnosisFromVerification(reversed, task), null);

  const legacy = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.9, answer_excerpt: 'x=6',
    reason: '代回后不成立。', feedback: '请重新核对。',
  }, { studentAnswer });
  assert.equal(legacy.trusted, true);
  assert.equal(legacy.diagnosisTrusted, false);

  const finalOnly = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.91, answer_excerpt: 'x=5',
    verified_part_excerpt: '', first_error_excerpt: '5', error_category: 'execution_error',
    correction_focus: '先把常数项移到等号另一边，再除以未知数的系数。',
    reason: '代回原方程后两边不相等。', feedback: '先用代回检查结果。',
  }, { studentAnswer: 'x=5', task });
  assert.equal(finalOnly.diagnosisTrusted, true);
  assert.equal(finalOnly.verifiedPartExcerpt, '');
  assert.equal(finalOnly.firstErrorExcerpt, 'x=5');
  assert.equal(finalOnly.errorCategory, 'procedure_gap');
  assert.match(finalOnly.correctionFocus, /等式两边执行相同运算/);
  assert.doesNotMatch(finalOnly.correctionFocus, /移到|另一边/);
});

test('classroom correction explains the answer and immediately plans a new recheck', () => {
  const originalAnswer = '两边同时减3得到2x=8，然后写成x=6。';
  const wrong = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.96, answer_excerpt: 'x=6',
    verified_part_excerpt: '2x=8', first_error_excerpt: 'x=6',
    error_category: 'careless_error', correction_focus: '从 2x=8 求 x 时，两边同时除以 2。',
    reason: '最后一步除法结果不成立。', feedback: '只核对最后一步。',
  }, { studentAnswer: originalAnswer, task });
  const rawRepair = enforceStepwiseCorrectionTask({
    teacher_move: 'feedback', learning_diagnosis: learningDiagnosisFromVerification(wrong, task),
  }, wrong, task);
  assert.equal(rawRepair.student_task.kind, 'none');
  assert.equal(rawRepair.instructional_correction.stage, 'explained');
  const visible = enforceVerifiedTeacherMessage('最后一步不对。', wrong, rawRepair, task);
  assert.match(visible, /正确答案.*x=4/);
  const continuation = planRepairContinuation({ task, verification: wrong });
  assert.equal(continuation.kind, 'instructional_recheck');
  assert.match(continuation.command, /禁止再次要求学生重答/);
});

test('legacy repair tasks close instead of returning to the original problem', () => {
  const wrong = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.95, answer_excerpt: 'x=6',
    verified_part_excerpt: '2x=8', first_error_excerpt: 'x=6', error_category: 'careless_error',
    correction_focus: '两边同时除以 2。', reason: '最后一步不成立。', feedback: '核对最后一步。',
  }, { studentAnswer: '2x=8，所以x=6', task });
  const legacyTask = normalizeStudentTask({
    kind: 'diagnostic_check', prompt: '只改写 x=6', expected_response: '一个等式',
    repair_context: {
      id: 'legacy-repair', stage: 'repair_step', attempts: 1,
      first_error_excerpt: 'x=6', original_error_excerpt: 'x=6',
      correction_focus: '两边同时除以 2。',
      original_task: task,
    },
  }, { teacherMove: 'feedback' });
  const corrected = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.94, answer_excerpt: 'x=4', reason: '局部结果正确。', feedback: '已修正。',
  }, { studentAnswer: 'x=4', task: legacyTask });
  const closed = enforceRepairClosureTurn({}, corrected, legacyTask);
  assert.equal(closed.student_task.kind, 'none');
  assert.equal(closed.student_state_update, null);
});

test('wrong answers are taught directly without completeness labels or original-task retries', () => {
  const formatTask = normalizeStudentTask({
    kind: 'knowledge_check',
    prompt: '计算 int i=3; int r=++i + i++; 执行后 i 和 r 的值。',
    expected_response: '一行：i=数字，r=数字',
    knowledge_point: '前置与后置自增',
    assessment: { reference_answer: 'i=5,r=8', criteria: ['同时给出 i 和 r'], grading_mode: 'equivalent' },
  });
  const incomplete = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.96, answer_excerpt: '7',
    verified_part_excerpt: '', first_error_excerpt: '7', error_category: 'unknown',
    correction_focus: '答案必须同时给出 i 和 r。', reason: '只给出一个数字。', feedback: '补全两个变量。',
  }, { studentAnswer: '7', task: formatTask });
  const repaired = enforceStepwiseCorrectionTask({ teacher_move: 'feedback' }, incomplete, formatTask);
  assert.equal(repaired.student_task.kind, 'none');
  const firstVisible = enforceVerifiedTeacherMessage('请重新完成原任务。', incomplete, repaired, formatTask);
  assert.doesNotMatch(firstVisible, /答案不完整|答案还不完整/);
  assert.match(firstVisible, /正确答案.*i=5,r=8/);

  const completeButWrong = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.96, answer_excerpt: 'i 是4 r是7',
    verified_part_excerpt: '', first_error_excerpt: 'i 是4 r是7', error_category: 'unknown',
    correction_focus: '重新跟踪前置与后置自增后的两个变量值。',
    reason: '两个字段都已给出，但数值不正确。', feedback: '格式完整，请重新核对结果。',
  }, { studentAnswer: 'i 是4 r是7', task: formatTask });
  const retry = enforceStepwiseCorrectionTask({ teacher_move: 'feedback' }, completeButWrong, formatTask);
  assert.equal(retry.student_task.kind, 'none');
  const visible = enforceVerifiedTeacherMessage(
    '第一处需要修正的是“i 是4 r是7”。答案还不完整。',
    completeButWrong,
    retry,
    formatTask,
  );
  assert.match(visible, /按题目要求拆分并核对/);
  assert.doesNotMatch(visible, /答案还不完整/);
  assert.doesNotMatch(visible, /需要(?:你)?纠正/);
  assert.match(visible, /正确答案.*i=5,r=8/);
  assert.match(visible, /表达式本次拿到的值/);
  assert.match(visible, /先把变量加 1，再把新值交给表达式/);
  assert.match(visible, /先把旧值交给表达式，再把变量加 1/);
  assert.match(visible, /表达式相加的是 4\+4=8/);

  const partiallyCorrect = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.96, answer_excerpt: 'i 是4 r是6',
    verified_part_excerpt: '', first_error_excerpt: 'r是6', error_category: 'execution_error',
    correction_focus: '后置自增先取旧值参与表达式，再把 i 增加 1。',
    reason: 'i 正确，r 的数值错误。', feedback: '逐项核对变量。',
  }, { studentAnswer: 'i 是4 r是6', task: {
    ...formatTask,
    assessment: { ...formatTask.assessment, referenceAnswer: 'i=4,r=8' },
  } });
  const partialVisible = enforceVerifiedTeacherMessage(
    '需要你纠正的是 r。', partiallyCorrect, retry,
    { ...formatTask, assessment: { ...formatTask.assessment, referenceAnswer: 'i=4,r=8' } },
  );
  assert.match(partialVisible, /i=4 正确/);
  assert.match(partialVisible, /r：你写的是 6，正确值是 8/);
  assert.doesNotMatch(partialVisible, /需要你纠正|需要纠正的是/);
});

test('unavailable or insufficient verification fails closed without blocking feedback', () => {
  const unavailable = unavailableAnswerVerification('判卷服务超时');
  assert.equal(studentStateUpdateFromVerification(unavailable, task), null);
  assert.match(buildAnswerVerificationDirective(unavailable), /不得更新掌握度/);
  const guarded = applyAnswerVerificationToTeacherTurn({
    student_state_update: { mastery_delta: 0.1 }, learning_diagnosis: { category: 'concept_confusion' },
  }, unavailable, task);
  assert.equal(guarded.student_state_update, null);
  assert.equal(guarded.learning_diagnosis, null);
});

test('visible feedback cannot contradict the trusted verifier verdict', () => {
  const correct = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.9, answer_excerpt: '6',
    reason: '1+2+3 的和为 6。', feedback: '1+2+3 的结果确实是 6。',
  }, { studentAnswer: '6' });
  assert.equal(
    enforceVerifiedTeacherMessage('你的答案错误，请重新计算。', correct),
    '这次作答正确。1+2+3 的结果确实是 6。',
  );
  const incorrect = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.9, answer_excerpt: '7',
    reason: '1+2+3 的和不是 7。', feedback: '重新检查 2+3 这一步。',
  }, { studentAnswer: '7' });
  const correctedIncorrect = enforceVerifiedTeacherMessage('你的答案正确，可以继续。', incorrect);
  assert.match(correctedIncorrect, /结果有误，我直接给你纠正/);
  assert.doesNotMatch(correctedIncorrect, /答案正确|可以继续/);
  for (const contradictory of ['这个结果不对，再算一次。', '你的回答有误。', '你答错了。']) {
    assert.equal(
      enforceVerifiedTeacherMessage(contradictory, correct),
      '这次作答正确。1+2+3 的结果确实是 6。',
    );
  }
  for (const contradictory of ['这个结果没错。', '你的回答无误。', '你算对了。']) {
    const corrected = enforceVerifiedTeacherMessage(contradictory, incorrect);
    assert.match(corrected, /结果有误，我直接给你纠正/);
    assert.doesNotMatch(corrected, /没错|无误|算对/);
  }
  assert.match(
    enforceVerifiedTeacherMessage('这个结果需要纠正。', incorrect),
    /结果有误，我直接给你纠正/,
  );
});

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
  assert.equal(localized.student_task.kind, 'diagnostic_check');
  assert.match(localized.student_task.prompt, /x=6/);
  assert.doesNotMatch(localized.student_task.prompt, /从头|整题|最终答案/);

  const visible = enforceVerifiedTeacherMessage('答案错误，请重新计算。', verification, localized);
  assert.match(visible, /得到2x=8/);
  assert.match(visible, /x=6/);
  assert.match(visible, /两边必须同时除以 2/);
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

test('guided repair restores the original task and requires an independent recheck', () => {
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
  const repairTask = normalizeStudentTask(rawRepair.student_task, {
    teacherMove: rawRepair.teacher_move, checkpoint: rawRepair.checkpoint,
  });
  assert.equal(repairTask.kind, 'diagnostic_check');
  assert.equal(repairTask.repairContext.stage, 'repair_step');
  assert.equal(repairTask.repairContext.originalTask.prompt, task.prompt.normalize('NFKC'));
  assert.equal(
    repairTask.repairContext.originalTask.assessment.referenceAnswer,
    task.assessment.referenceAnswer.normalize('NFKC'),
  );
  assert.equal(shouldVerifyStudentAnswer(repairTask, 'attempt'), true);

  const repaired = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.94, answer_excerpt: 'x=4',
    verified_part_excerpt: '', first_error_excerpt: '', error_category: 'unknown', correction_focus: '',
    reason: '由 2x=8 两边同时除以2可得 x=4。', feedback: '这一处已经修正。',
  }, { studentAnswer: 'x=4', task: repairTask });
  const guardedRepair = applyAnswerVerificationToTeacherTurn({
    student_state_update: { mastery_delta: 0.15 },
    student_task: { kind: 'practice', prompt: '做一道新题' },
  }, repaired, repairTask);
  assert.equal(guardedRepair.student_state_update, null);
  const restoredRaw = enforceRepairClosureTurn(guardedRepair, repaired, repairTask);
  const restoredTask = normalizeStudentTask(restoredRaw.student_task, {
    teacherMove: restoredRaw.teacher_move, checkpoint: restoredRaw.checkpoint,
  });
  assert.equal(restoredTask.kind, task.kind);
  assert.equal(restoredTask.prompt, task.prompt.normalize('NFKC'));
  assert.equal(restoredTask.supportContext, 'scaffolded');
  assert.equal(restoredTask.repairContext.stage, 'retry_original');
  assert.equal(restoredTask.assessment.referenceAnswer, task.assessment.referenceAnswer.normalize('NFKC'));
  assert.match(
    enforceVerifiedTeacherMessage('再做一道新题。', repaired, restoredRaw, repairTask),
    /回到原任务/,
  );

  const retryAnswer = '两边同时减3得到2x=8，再同时除以2得到x=4。';
  const retryCorrect = normalizeAnswerVerification({
    verdict: 'correct', confidence: 0.97, answer_excerpt: 'x=4',
    verified_part_excerpt: '', first_error_excerpt: '', error_category: 'unknown', correction_focus: '',
    reason: '每一步都保持等式成立。', feedback: '完整作答成立。',
  }, { studentAnswer: retryAnswer, task: restoredTask });
  const retryGuarded = applyAnswerVerificationToTeacherTurn({
    student_task: { kind: 'knowledge_check', prompt: '直接进入下一章' },
  }, retryCorrect, restoredTask);
  assert.equal(retryGuarded.student_state_update.support_level, 'prompted');
  const closed = enforceRepairClosureTurn(retryGuarded, retryCorrect, restoredTask);
  assert.equal(closed.student_task.kind, 'none');
  const continuation = planRepairContinuation({ task: restoredTask, verification: retryCorrect });
  assert.equal(continuation.kind, 'independent_recheck');
  assert.match(continuation.command, /不带提示|同构题/);
});

test('failed repair keeps the original task and increments the same repair context', () => {
  const wrong = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.95, answer_excerpt: 'x=6',
    verified_part_excerpt: '2x=8', first_error_excerpt: 'x=6', error_category: 'careless_error',
    correction_focus: '两边同时除以 2。', reason: '最后一步不成立。', feedback: '核对最后一步。',
  }, { studentAnswer: '2x=8，所以x=6', task });
  const first = normalizeStudentTask(
    enforceStepwiseCorrectionTask({}, wrong, task).student_task,
    { teacherMove: 'feedback', checkpoint: '修正第一处错误' },
  );
  const stillWrong = normalizeAnswerVerification({
    verdict: 'incorrect', confidence: 0.91, answer_excerpt: 'x=8',
    verified_part_excerpt: '', first_error_excerpt: 'x=8', error_category: 'careless_error',
    correction_focus: '仍需将 8 同时除以 2。', reason: '修正结果仍不成立。', feedback: '继续核对除法。',
  }, { studentAnswer: 'x=8', task: first });
  const second = normalizeStudentTask(
    enforceStepwiseCorrectionTask({}, stillWrong, first).student_task,
    { teacherMove: 'feedback', checkpoint: '继续修正' },
  );
  assert.equal(second.repairContext.id, first.repairContext.id);
  assert.equal(second.repairContext.originalTask.prompt, task.prompt.normalize('NFKC'));
  assert.equal(second.repairContext.attempts, first.repairContext.attempts + 1);
  assert.equal(second.repairContext.firstErrorExcerpt, 'x=8');
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
  assert.equal(
    enforceVerifiedTeacherMessage('你的答案正确，可以继续。', incorrect),
    '这次还不能判为正确。重新检查 2+3 这一步。',
  );
  for (const contradictory of ['这个结果不对，再算一次。', '你的回答有误。', '你答错了。']) {
    assert.equal(
      enforceVerifiedTeacherMessage(contradictory, correct),
      '这次作答正确。1+2+3 的结果确实是 6。',
    );
  }
  for (const contradictory of ['这个结果没错。', '你的回答无误。', '你算对了。']) {
    assert.equal(
      enforceVerifiedTeacherMessage(contradictory, incorrect),
      '这次还不能判为正确。重新检查 2+3 这一步。',
    );
  }
  assert.equal(
    enforceVerifiedTeacherMessage('你的答案不正确，请检查。', incorrect),
    '你的答案不正确，请检查。',
  );
});

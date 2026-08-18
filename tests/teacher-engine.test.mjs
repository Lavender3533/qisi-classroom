import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAssessmentTurnPrompt,
  buildLessonMasterySnapshot,
  buildTeacherBrief,
  buildTeacherSystemPrompt,
  buildTeacherTurnDirective,
  assessTeacherTurnQuality,
  classifyAssessmentResponse,
  classifyStudentTurn,
  createFallbackLessonPlan,
  createTeacherGreeting,
  enforceStudentEvidenceSupport,
  enforceSingleTeacherQuestion,
  enforceTeacherContinuationPolicy,
  enforceTeacherTurnPolicy,
  enforceTeacherVisibleMessage,
  getAssessmentInterviewStage,
  normalizeHomeworkUpdate,
  normalizeLearningDiagnosis,
  normalizeLessonPlan,
  normalizeLessonSummary,
  normalizeQuickReplies,
  normalizeStudentStateUpdate,
  normalizeStudentTask,
  normalizeTeacherMove,
  planRetrievalWarmup,
  planTeacherContinuation,
  rebuildAssessmentProgress,
  routeAssessmentInterview,
  studentTaskAllowsDiagnosisEvidence,
  studentTaskAllowsMasteryEvidence,
  updateRetrievalWarmup,
  updateLearningIntervention,
  updateLessonProgress,
} from '../frontend/teacher-engine.js';

test('teacher contract includes a persistent classroom board update', () => {
  const prompt = buildTeacherSystemPrompt(buildTeacherBrief({
    subjectName: '数学', assessed: true, focus: '等式性质', goal: '独立完成等价变形',
  }));
  assert.match(prompt, /board_update/);
  assert.match(prompt, /replace\|append\|clear\|keep/);
  assert.match(prompt, /板书/);
});

test('teacher brief prioritizes assessment before teaching', () => {
  const brief = buildTeacherBrief({ subjectName: '数学', assessed: false });
  assert.equal(brief.phase, 'diagnose');
  assert.match(brief.goal, /了解.*基础/);
  assert.match(brief.nextAction, /问题/);
});

test('homework grading only accepts the explicitly pending homework', () => {
  assert.deepEqual(normalizeHomeworkUpdate({
    homework_id: 7, status: 'graded', grade: '85 分：思路正确，最后一步符号需要检查。',
  }, { id: 7 }), {
    homeworkId: 7,
    grade: '85 分：思路正确，最后一步符号需要检查。',
  });
  assert.equal(normalizeHomeworkUpdate({
    homework_id: 8, status: 'graded', grade: '批改完成',
  }, { id: 7 }), null);
});

test('teacher brief selects the weakest knowledge point as a concrete goal', () => {
  const brief = buildTeacherBrief({
    subjectName: 'Python',
    assessed: true,
    knowledgePoints: [
      { name: '变量', mastery: 0.7 },
      { name: '循环', mastery: 0.25 },
    ],
    recentEvents: [{ event_type: 'quiz_answer', detail_json: '{"correct":false}' }],
  });
  assert.equal(brief.focus, '循环');
  assert.equal(brief.phase, 'reteach');
  assert.match(brief.goal, /循环/);
});

test('teacher brief exposes evidence-backed teaching memory without inventing a learning style', () => {
  const teachingMemory = {
    preferences: {
      pace: { value: 'slower', label: '放慢并拆成小步', evidence: '太快了' },
      representation: null,
    },
    effectiveStrategies: [{ label: '状态追踪', independentSuccesses: 1 }],
    avoidStrategies: [{ label: '直接讲解', difficulties: 2 }],
  };
  const brief = buildTeacherBrief({
    subjectName: 'Java', assessed: true,
    learnerProfile: { strengths: [], recurringPatterns: [], teachingMemory },
  });
  assert.equal(brief.teachingMemory, teachingMemory);
  const systemPrompt = buildTeacherSystemPrompt(brief);
  assert.match(systemPrompt, /放慢并拆成小步/);
  assert.match(systemPrompt, /状态追踪（独立成功 1 次）/);
  assert.match(systemPrompt, /直接讲解（困难 2 次）/);
  assert.match(systemPrompt, /不得推断为人格、智力、能力上限/);
  assert.match(systemPrompt, /teaching_strategy/);
});

test('lesson plan is validated and becomes the active teaching brief', () => {
  const plan = normalizeLessonPlan({
    title: '循环累加短课', focus: 'for循环与累加', objective: '独立跟踪累加变量并完成迁移题',
    success_criteria: ['能逐轮写出sum', '能完成变式题'],
    steps: [
      { id: 'e', phase: 'explain', goal: '跟踪一个例子', evidence: '答对一步检查' },
      { id: 'p', phase: 'practice', goal: '完成累加练习', evidence: '提交可运行代码' },
      { id: 'c', phase: 'check', goal: '完成变式', evidence: '独立得出结果' },
    ],
  });
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(plan.steps[1].criterion_ids, ['criterion-1']);
  assert.deepEqual(plan.steps[2].criterion_ids, ['criterion-2']);
  const brief = buildTeacherBrief({ subjectName: 'Java', assessed: true, lessonPlan: plan, lessonProgress: { currentStep: 1 } });
  assert.equal(brief.focus, 'for循环与累加');
  assert.equal(brief.goal, '独立跟踪累加变量并完成迁移题');
  assert.equal(brief.nextAction, '完成累加练习');
  assert.equal(brief.lessonStep.phase, 'practice');
});

test('invalid lesson plan falls back to a complete four-step short lesson', () => {
  assert.equal(normalizeLessonPlan({ title: '空计划', steps: [] }), null);
  const plan = createFallbackLessonPlan({ subjectName: '数学', focus: '分数加法', goal: '独立完成分数加法' });
  assert.deepEqual(plan.steps.map(step => step.phase), ['explain', 'practice', 'check', 'summary']);
  assert.equal(plan.success_criteria.length, 2);
});

test('lesson progress requires new task-bound evidence at each mastery gate', () => {
  const plan = createFallbackLessonPlan({ focus: '循环' });
  const afterExplain = updateLessonProgress(plan, { currentStep: 0 }, { teacherMove: 'model', teachingEvidence: true });
  assert.equal(afterExplain.currentStep, 1);
  assert.equal(afterExplain.instructionDelivered, true);
  const understandingContext = {
    source: 'chat', taskKey: 'understanding-1', taskKind: 'knowledge_check',
    taskKnowledgePoint: '循环', answer: '每轮把当前值加到总和', attempt: 1,
  };
  const afterCheck = updateLessonProgress(plan, afterExplain, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: 0.08, confidence: 0.9, evidence: '学生独立指出每轮把当前值加到总和', support_level: 'independent' },
    evidenceContext: understandingContext,
  });
  assert.equal(afterCheck.currentStep, 2);
  const repeated = updateLessonProgress(plan, afterCheck, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: 0.08, confidence: 0.9, evidence: '学生独立指出每轮把当前值加到总和', support_level: 'independent' },
    evidenceContext: understandingContext,
  });
  assert.equal(repeated.currentStep, 2);
  const prompted = updateLessonProgress(plan, afterCheck, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: 0.08, confidence: 0.9, evidence: '学生根据提示修正循环并得到正确结果', support_level: 'prompted' },
    evidenceContext: {
      source: 'quiz', taskKey: 'practice-prompted', taskKind: 'practice',
      taskKnowledgePoint: '循环', answer: 'sum += i', attempt: 2,
    },
  });
  assert.equal(prompted.currentStep, 2);
  assert.equal(buildLessonMasterySnapshot(plan, prompted).current.status, 'needs_recheck');
  const unsupported = updateLessonProgress(plan, afterCheck, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '数组', mastery_delta: 0.08, confidence: 0.9, evidence: '学生独立写出了数组下标', support_level: 'independent' },
    evidenceContext: {
      source: 'chat', taskKey: 'practice-unrelated', taskKind: 'practice',
      taskKnowledgePoint: '循环', answer: 'arr[0]', attempt: 1,
    },
  });
  assert.equal(unsupported.currentStep, 2);
  const afterPractice = updateLessonProgress(plan, prompted, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: 0.08, confidence: 0.9, evidence: '学生无提示独立写出循环并得到正确结果', support_level: 'independent' },
    evidenceContext: {
      source: 'quiz', taskKey: 'practice-independent', taskKind: 'practice',
      taskKnowledgePoint: '循环', answer: 'sum += i', attempt: 1,
    },
  });
  assert.equal(afterPractice.currentStep, 3);
  assert.equal(buildLessonMasterySnapshot(plan, afterPractice).criteria[0].status, 'verified');
  assert.equal(buildLessonMasterySnapshot(plan, afterPractice).criteria[1].status, 'verified');
  const afterTransfer = afterPractice;

  const firstDifficulty = updateLessonProgress(plan, { currentStep: 2 }, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: -0.03, confidence: 0.9, evidence: '学生迁移题的循环边界设置错误' },
    evidenceContext: { source: 'quiz', taskKey: 'transfer-wrong-1', taskKind: 'knowledge_check', taskKnowledgePoint: '循环', answer: '3', attempt: 1 },
  });
  const secondDifficulty = updateLessonProgress(plan, firstDifficulty, {
    teacherMove: 'clarify',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: -0.03, confidence: 0.9, evidence: '学生再次把循环终点少算一次' },
    evidenceContext: { source: 'chat', taskKey: 'transfer-wrong-2', taskKind: 'knowledge_check', taskKnowledgePoint: '循环', answer: '4', attempt: 1 },
  });
  assert.equal(secondDifficulty.status, 'remediate');
  assert.equal(secondDifficulty.currentStep, 2);
  const premature = updateLessonProgress(plan, { currentStep: 3, attempts: 0, status: 'active' }, { teacherMove: 'summary' });
  assert.equal(premature.status, 'active');
  const completed = updateLessonProgress(plan, afterTransfer, {
    teacherMove: 'summary',
    lessonSummary: { mastered: [{ knowledge_point: '循环', evidence: '学生独立完成了迁移练习' }] },
  });
  assert.equal(completed.status, 'completed');
});

test('mastery snapshot distinguishes legacy progress from verified evidence', () => {
  const plan = createFallbackLessonPlan({ focus: '分数加法' });
  const snapshot = buildLessonMasterySnapshot(plan, { currentStep: 2, attempts: 0, status: 'active' });
  assert.equal(snapshot.hasLegacyProgress, true);
  assert.equal(snapshot.steps[0].status, 'legacy');
  assert.equal(snapshot.steps[1].status, 'legacy');
  assert.equal(snapshot.criteria.every(item => item.status === 'pending'), true);
  assert.match(snapshot.nextRequirement, /变式|迁移/);
});

test('legacy lesson summaries keep progress but do not inherit ungraded mastery claims', () => {
  const plan = createFallbackLessonPlan({ focus: '分数加法' });
  const summary = normalizeLessonSummary({
    lesson_title: '分数加法短课',
    mastered: [{ knowledge_point: '分数加法', evidence: '旧模型声称学生已经完全掌握分数加法' }],
    needs_work: [],
    misconceptions: [{ pattern: '总是忘记通分', evidence: '旧模型声称学生反复忘记通分步骤' }],
    not_yet_verified: [],
    review: { focus: '分数加法', interval_days: 1, task: '完成一道同类题' },
  }, plan, { currentStep: 2, attempts: 0, status: 'active' });
  assert.deepEqual(summary.mastered, []);
  assert.deepEqual(summary.misconceptions, []);
  assert.equal(summary.not_yet_verified.length, 2);
});

test('lesson summary only promotes evidence verified by the mastery ledger', () => {
  const plan = createFallbackLessonPlan({ focus: '循环' });
  const progress = updateLessonProgress(plan, { currentStep: 2 }, {
    teacherMove: 'feedback',
    studentStateUpdate: { knowledge_point: '循环', mastery_delta: 0.08, confidence: 0.9, evidence: '学生独立完成改变上限后的循环变式', support_level: 'independent' },
    evidenceContext: { source: 'quiz', taskKey: 'transfer-summary', taskKind: 'knowledge_check', taskKnowledgePoint: '循环', answer: '15', attempt: 1 },
  });
  const summary = normalizeLessonSummary({
    lesson_title: '循环短课',
    mastered: [
      { knowledge_point: '循环', evidence: '模型声称学生已经完全掌握循环' },
      { knowledge_point: '数组', evidence: '模型声称学生已经掌握数组访问' },
    ],
    needs_work: [], not_yet_verified: [],
    review: { focus: '循环', interval_days: 1, task: '完成一道变式题' },
    next_lesson_focus: '循环边界',
  }, plan, progress);
  assert.deepEqual(summary.mastered, [{
    knowledge_point: '能独立完成一道只改变一个条件的练习',
    evidence: '学生独立完成改变上限后的循环变式',
  }]);
  assert.ok(summary.not_yet_verified.some(item => /指出|关键作用/.test(item.knowledge_point)));
});

test('learning diagnosis must quote observable evidence from the current student turn', () => {
  const valid = normalizeLearningDiagnosis({
    category: 'concept_confusion',
    knowledge_point: 'range 结束值',
    evidence_quote: '会把 5 也算进去',
    evidence: '学生把右边界当成包含关系',
  }, {
    studentMessage: 'range(1, 5) 会把 5 也算进去，所以答案是 15。',
  });
  assert.equal(valid.category, 'concept_confusion');
  assert.equal(valid.strategy, 'contrast_cases');
  assert.match(valid.teacherAction, /对比/);

  assert.equal(normalizeLearningDiagnosis({
    category: 'concept_confusion',
    knowledge_point: 'range 结束值',
    evidence_quote: '学生不理解左闭右开',
  }, {
    studentMessage: '答案是 15。',
  }), null);
  const numericUnknown = normalizeLearningDiagnosis({
    category: 'unknown', knowledge_point: '循环累加', evidence_quote: '3',
    evidence: '只能确认结果错误，不能确认具体原因',
  }, { studentMessage: '3' });
  assert.equal(numericUnknown.category, 'unknown');
  assert.equal(normalizeLearningDiagnosis({
    category: 'concept_confusion', knowledge_point: '循环累加', evidence_quote: '3',
  }, { studentMessage: '3' }), null);
});

test('independent step diagnosis preserves a valid prefix and rejects reversed evidence', () => {
  const studentMessage = '先把两边同时减3，得到2x=8；然后写成x=6。';
  const diagnosis = normalizeLearningDiagnosis({
    category: 'careless_error', knowledge_point: '一元一次方程',
    evidence_quote: 'x=6', verified_part_excerpt: '得到2x=8',
    correction_focus: '从 2x=8 求 x 时，两边必须同时除以 2。',
    evidence: '独立判卷定位最后一步不成立', source: 'independent_verifier',
  }, { studentMessage });
  assert.equal(diagnosis.source, 'independent_verifier');
  assert.equal(diagnosis.verifiedPartExcerpt, '得到2x=8');
  assert.match(diagnosis.correctionFocus, /同时除以 2/);

  assert.equal(normalizeLearningDiagnosis({
    category: 'procedure_gap', knowledge_point: '一元一次方程',
    evidence_quote: '得到2x=8', verified_part_excerpt: 'x=6',
    correction_focus: '核对步骤顺序。', source: 'independent_verifier',
  }, { studentMessage }), null);
});

test('teacher quality requires independent localization in feedback and the next task', () => {
  const diagnosis = {
    category: 'careless_error', evidence_quote: 'x=6', evidenceQuote: 'x=6',
    verifiedPartExcerpt: '得到2x=8', correctionFocus: '两边必须同时除以 2',
    source: 'independent_verifier', level: 1,
  };
  const weak = assessTeacherTurnQuality({
    studentMessage: '先得到2x=8，最后写x=6。',
    message: '答案错误，请重新做。',
    structured: {
      teacher_move: 'feedback', checkpoint: '重新做整题', learning_diagnosis: diagnosis,
      student_task: { kind: 'diagnostic_check', prompt: '重新做整题' },
      student_state_update: { mastery_delta: -0.04 },
    },
  });
  assert.equal(weak.valid, false);
  assert.match(weak.issues.join('；'), /第一处错误|已经成立|修正原则|没有对准/);

  const grounded = assessTeacherTurnQuality({
    studentMessage: '先得到2x=8，最后写x=6。',
    message: '“得到2x=8”成立；第一处错误是“x=6”。两边必须同时除以 2。',
    structured: {
      teacher_move: 'feedback', checkpoint: '只核对“x=6”这一处', learning_diagnosis: diagnosis,
      student_task: { kind: 'diagnostic_check', prompt: '只核对“x=6”这一处' },
      student_state_update: { mastery_delta: -0.04 },
    },
  });
  assert.equal(grounded.valid, true, grounded.issues.join('；'));
});

test('a generic stuck signal can use a proven worked representation without inventing a specific error', () => {
  const quality = assessTeacherTurnQuality({
    studentMessage: '我还是不会。',
    message: '先不背定义，只追踪数值：第1轮旧值0加当前值1得到1。第2轮再按同样方式算。',
    structured: {
      teacher_move: 'model', checkpoint: '写出第2轮的新值',
      student_task: { kind: 'knowledge_check', prompt: '写出第2轮的新值' },
      learning_diagnosis: {
        category: 'unknown', evidence_quote: '不会', knowledge_point: '循环累加',
      },
    },
  });
  assert.equal(quality.valid, true, quality.issues.join('；'));
});

test('repeated diagnosis changes representation and then probes a prerequisite', () => {
  const first = normalizeLearningDiagnosis({
    category: 'procedure_gap', knowledge_point: '循环累加',
    evidence_quote: '直接写成 sum = i', evidence: '遗漏在旧值上继续累加',
  }, { studentMessage: '我直接写成 sum = i。' });
  const second = normalizeLearningDiagnosis({
    category: 'procedure_gap', knowledge_point: '循环累加',
    evidence_quote: '还是写 sum = i', evidence: '再次覆盖旧值',
  }, { studentMessage: '我还是写 sum = i。', previousIntervention: first });
  const third = normalizeLearningDiagnosis({
    category: 'procedure_gap', knowledge_point: '循环累加',
    evidence_quote: '继续写 sum = i', evidence: '第三次覆盖旧值',
  }, { studentMessage: '我继续写 sum = i。', previousIntervention: second });

  assert.equal(first.level, 1);
  assert.equal(second.level, 2);
  assert.equal(second.strategy, 'alternate_representation');
  assert.match(second.teacherAction, /缩小|换一种/);
  assert.equal(third.level, 3);
  assert.equal(third.strategy, 'prerequisite_probe');
  assert.match(third.teacherAction, /前置/);
});

test('prompted correction keeps intervention until an independent check resolves it', () => {
  const intervention = normalizeLearningDiagnosis({
    category: 'concept_gap', knowledge_point: '循环边界',
    evidence_quote: '把 i < 5 写成 i <= 5', evidence: '混淆是否包含结束值',
  }, { studentMessage: '我把 i < 5 写成 i <= 5。' });
  const prompted = updateLearningIntervention(intervention, {
    studentStateUpdate: {
      knowledgePoint: '循环边界', delta: 0.04, supportLevel: 'prompted',
      evidence: '学生根据提示把边界改正确',
    },
  });
  assert.equal(prompted.activeIntervention.status, 'recheck');
  assert.equal(prompted.activeIntervention.strategy, 'independent_recheck');
  assert.match(prompted.activeIntervention.teacherAction, /不带提示/);

  const independent = updateLearningIntervention(prompted.activeIntervention, {
    studentStateUpdate: {
      knowledgePoint: '循环边界', delta: 0.08, supportLevel: 'independent',
      evidence: '学生独立完成变式并得到正确结果',
    },
  });
  assert.equal(independent.activeIntervention, null);
  assert.equal(independent.resolvedIntervention.status, 'resolved');
  assert.match(independent.resolvedIntervention.resolutionEvidence, /独立完成/);
});

test('client support policy does not let a scaffolded correction masquerade as independent', () => {
  const update = { knowledgePoint: '循环边界', before: 0.3, mastery: 0.38, delta: 0.08, supportLevel: 'independent' };
  const scaffolded = enforceStudentEvidenceSupport(update, {
    activeIntervention: { status: 'active', category: 'concept_confusion' },
    previousTeacherMove: 'explain',
  });
  assert.equal(scaffolded.supportLevel, 'prompted');
  assert.equal(scaffolded.delta, 0.04);
  assert.equal(scaffolded.mastery, 0.34);
  const recheck = enforceStudentEvidenceSupport(update, {
    activeIntervention: { status: 'recheck', category: 'concept_confusion' },
    previousTeacherMove: 'question',
  });
  assert.equal(recheck.supportLevel, 'independent');
  const warmup = enforceStudentEvidenceSupport(update, {
    reviewWarmup: { status: 'remediate' }, previousTeacherMove: 'model',
  });
  assert.equal(warmup.supportLevel, 'prompted');
  const modeledTask = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '补全老师示范中的最后一步', knowledge_point: '循环边界',
  }, { teacherMove: 'model', checkpoint: '补全最后一步' });
  const modeledAnswer = enforceStudentEvidenceSupport(update, { pendingStudentTask: modeledTask });
  assert.equal(modeledTask.supportContext, 'scaffolded');
  assert.equal(modeledAnswer.supportLevel, 'prompted');
});

test('an explicit independent transfer check resolves stale intervention support', () => {
  const update = {
    knowledgePoint: '指定区间累加', evidence: '学生独立提交完整正确代码',
    confidence: 0.95, before: 0.4, delta: 0.12, mastery: 0.52, supportLevel: 'independent',
  };
  const result = enforceStudentEvidenceSupport(update, {
    activeIntervention: { status: 'active', knowledgePoint: '指定区间累加' },
    previousTeacherMove: 'feedback',
    pendingStudentTask: {
      kind: 'practice', supportContext: 'independent', cadenceRole: 'transfer_check',
    },
  });
  assert.equal(result.supportLevel, 'independent');
  assert.equal(result.delta, 0.12);
});

test('an explicit transfer task closes immediately even outside the lesson check phase', () => {
  const result = enforceTeacherTurnPolicy({
    state: 'feedback',
    message: '代码正确，最终输出 22。',
    teacher_move: 'feedback',
    intent: '反馈代码',
    checkpoint: '再做一道题',
    student_state_update: {
      knowledge_point: '指定区间累加', mastery_delta: 0.12, confidence: 0.96,
      evidence: '学生独立提交从 4 到 7 的正确代码', support_level: 'independent',
    },
    student_task: { kind: 'practice', prompt: '再写一道类似代码' },
  }, 'int sum = 0; for (int i = 4; i <= 7; i++) sum += i;', {
    phase: 'practice', focus: '指定区间累加',
    lessonStep: { phase: 'practice', goal: '完成引导练习' },
  }, {
    kind: 'practice', prompt: '把 4 到 7 累加', knowledgePoint: '指定区间累加',
    supportContext: 'independent', cadenceRole: 'transfer_check',
  });
  assert.equal(result.instructional_decision.action, 'advance');
  assert.equal(result.student_task.kind, 'none');
  assert.equal(result.can_advance, true);
  assert.equal(result.actions.some(action => action.type === 'advance'), true);
});

test('active intervention controls the teacher brief instead of a generic reteach label', () => {
  const intervention = normalizeLearningDiagnosis({
    category: 'execution_error', knowledge_point: '变量更新',
    evidence_quote: '第二轮 sum 还是 1', evidence: '没有追踪第二轮状态',
  }, { studentMessage: '第二轮 sum 还是 1。' });
  const brief = buildTeacherBrief({
    subjectName: 'Java', assessed: true,
    knowledgePoints: [{ name: '循环', mastery: 0.3 }],
    activeIntervention: intervention,
  });
  assert.equal(brief.phase, 'reteach');
  assert.equal(brief.focus, '变量更新');
  assert.equal(brief.intervention.category, 'execution_error');
  assert.equal(brief.nextAction, intervention.teacherAction);
});

test('retrieval warmup temporarily owns the teacher brief without exposing the main lesson step', () => {
  const plan = createFallbackLessonPlan({ focus: '列表遍历' });
  const reviewWarmup = { status: 'awaiting_response', knowledgePoint: '循环边界' };
  const brief = buildTeacherBrief({
    subjectName: 'Python', assessed: true, lessonPlan: plan,
    lessonProgress: { currentStep: 0, status: 'active' }, reviewWarmup,
  });
  assert.equal(brief.phase, 'review');
  assert.equal(brief.phaseLabel, '检索热身');
  assert.equal(brief.focus, '循环边界');
  assert.equal(brief.lessonStep, null);
  assert.match(brief.goal, /不带提示/);
  assert.match(buildTeacherSystemPrompt(brief), /不得用热身证据推进新课步骤/);
  const directive = buildTeacherTurnDirective({
    studentMessage: 'range(1, 5) 最后一个数是 4。', brief,
  });
  assert.match(directive, /到期复习热身的学生回答/);
  assert.match(directive, /support_level 必须为 prompted/);
  assert.match(directive, /不带提示/);
});

test('teacher continuation waits through the first quiz error and takes over after the second', () => {
  const plan = createFallbackLessonPlan({ focus: '循环边界' });
  const firstWrong = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 1, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 1, attempts: 1, status: 'active' },
    source: 'quiz',
    evidence: {
      correct: false, attempt: 1, knowledgePoint: '循环边界',
      question: 'range(1, 5) 最后一个数是什么？', answer: '5', correctAnswer: '4',
    },
  });
  assert.equal(firstWrong, null);

  const secondWrong = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 1, attempts: 1, status: 'active' },
    nextProgress: { currentStep: 1, attempts: 2, status: 'remediate' },
    source: 'quiz',
    evidence: {
      correct: false, attempt: 2, knowledgePoint: '循环边界',
      question: 'range(1, 5) 最后一个数是什么？', answer: '5', correctAnswer: '4',
    },
    activeIntervention: {
      label: '概念混淆', level: 2, teacherAction: '改用并排对比',
    },
  });
  assert.equal(secondWrong.kind, 'reteach_after_quiz');
  assert.match(secondWrong.command, /range\(1, 5\)/);
  assert.match(secondWrong.command, /学生答案：5/);
  assert.match(secondWrong.command, /标准答案：4/);
  assert.match(secondWrong.command, /改用并排对比/);
});

test('teacher continuation distinguishes prompted correction, step advance, and automatic summary', () => {
  const plan = createFallbackLessonPlan({ focus: '循环边界' });
  const prompted = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 1, attempts: 2, status: 'remediate' },
    nextProgress: { currentStep: 1, attempts: 2, status: 'remediate' },
    source: 'quiz',
    evidence: {
      correct: true, attempt: 2, supportLevel: 'prompted', knowledgePoint: '循环边界',
      question: '最后一个数是什么？', answer: '4', correctAnswer: '4',
    },
  });
  assert.equal(prompted.kind, 'independent_recheck');
  assert.match(prompted.command, /不带提示/);
  assert.match(prompted.command, /不能作为独立掌握/);

  const advance = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 1, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 2, attempts: 0, status: 'active' },
    source: 'quiz',
    evidence: {
      correct: true, attempt: 1, supportLevel: 'independent', knowledgePoint: '循环边界',
      question: '最后一个数是什么？', answer: '4', correctAnswer: '4',
    },
  });
  assert.equal(advance.kind, 'advance_lesson');
  assert.match(advance.command, /主动开始当前教案的新步骤/);
  assert.match(advance.key, /advance_lesson:循环边界短课:2/);

  const chatAdvance = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 1, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 2, attempts: 0, status: 'active' },
    source: 'chat',
    evidence: {
      correct: true, supportLevel: 'independent', knowledgePoint: '循环边界', answer: '4',
    },
  });
  assert.equal(chatAdvance.kind, 'advance_lesson');

  const summary = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 2, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 3, attempts: 0, status: 'active' },
    source: 'chat',
    evidence: { correct: true, knowledgePoint: '循环边界', answer: '独立完成迁移题' },
  });
  assert.equal(summary.kind, 'lesson_summary');
  assert.match(summary.command, /立即主动完成课堂收尾/);
  assert.match(summary.command, /必须填写 lesson_summary/);
  assert.match(summary.command, /lesson_title/);
  assert.match(summary.command, /not_yet_verified/);
});

test('a rejected final-check update schedules a fresh mastery recheck instead of stalling', () => {
  const plan = createFallbackLessonPlan({ focus: '循环边界' });
  const continuation = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 2, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 2, attempts: 0, status: 'active' },
    source: 'chat',
    evidence: {
      requiresRecheck: true,
      correct: true,
      answer: '5',
      knowledgePoint: '循环边界',
      supportLevel: 'independent',
    },
  });
  assert.equal(continuation.kind, 'mastery_recheck');
  assert.match(continuation.command, /新的、不带提示/);
  const guarded = enforceTeacherContinuationPolicy({
    teacher_move: 'summary', intent: '提前收尾', checkpoint: '查看总结',
    student_task: { kind: 'none' },
  }, continuation.kind, { focus: '循环边界', lessonStep: plan.steps[2] });
  assert.equal(guarded.teacher_move, 'question');
  assert.equal(guarded.student_task.kind, 'knowledge_check');
});

test('automatic continuation kind constrains the teacher move without creating student evidence', () => {
  const summary = enforceTeacherContinuationPolicy({
    teacher_move: 'feedback', state: 'feedback', intent: '', checkpoint: '',
    student_state_update: { mastery_delta: 0.1 },
    learning_diagnosis: { category: 'unknown' },
  }, 'lesson_summary');
  assert.equal(summary.teacher_move, 'summary');
  assert.equal(summary.state, 'summary');
  assert.equal(summary.student_state_update, null);
  assert.equal(summary.learning_diagnosis, null);

  const recheck = enforceTeacherContinuationPolicy({
    teacher_move: 'summary', intent: '已经掌握', checkpoint: '结束课堂',
  }, 'independent_recheck');
  assert.equal(recheck.teacher_move, 'question');
  assert.equal(recheck.state, 'check');
  assert.match(recheck.checkpoint, /不带提示/);

  const instructionalRecheck = enforceTeacherContinuationPolicy({
    teacher_move: 'summary', intent: '结束原题', checkpoint: '重答原题',
    student_task: {
      kind: 'knowledge_check',
      prompt: '执行 int i = 4; int r = ++i + i++; 后，i 和 r 分别是多少？',
      expected_response: 'i=数字，r=数字',
    },
  }, 'instructional_recheck', { focus: '前置与后置自增' });
  assert.equal(instructionalRecheck.teacher_move, 'question');
  assert.equal(instructionalRecheck.student_task.kind, 'knowledge_check');
  assert.equal(instructionalRecheck.student_task.supportContext, 'independent');
  assert.match(instructionalRecheck.checkpoint, /新同构题/);
  assert.ok(instructionalRecheck.quick_replies.includes('稍后练习'));

  const missingQuestion = enforceTeacherContinuationPolicy({
    teacher_move: 'question', intent: '检查迁移', checkpoint: '独立完成这道新同构题',
    student_task: { kind: 'knowledge_check', prompt: '独立完成这道新同构题' },
  }, 'instructional_recheck', { focus: '前置与后置自增' });
  assert.equal(missingQuestion.student_task.kind, 'none');

  const retriedQuestion = enforceTeacherContinuationPolicy({
    teacher_move: 'question', intent: '检查迁移', checkpoint: '写出 i 和 r 的值',
    student_task: {
      kind: 'knowledge_check',
      prompt: '执行 int i = 4; int r = ++i + i++; 后，i 和 r 分别是多少？',
      expected_response: 'i=数字，r=数字',
    },
  }, 'instructional_recheck_retry', { focus: '前置与后置自增' });
  assert.equal(retriedQuestion.student_task.kind, 'knowledge_check');
  assert.match(retriedQuestion.student_task.prompt, /int i = 4/);

  const reteach = enforceTeacherContinuationPolicy({
    teacher_move: 'question', intent: '', checkpoint: '',
  }, 'reteach_after_quiz');
  assert.equal(reteach.teacher_move, 'explain');
  assert.equal(reteach.state, 'explain');

  const warmup = enforceTeacherContinuationPolicy({
    teacher_move: 'explain', actions: [{ type: 'show_quiz' }], intent: '', checkpoint: '',
  }, 'review_warmup');
  assert.equal(warmup.teacher_move, 'question');
  assert.equal(warmup.state, 'check');
  assert.deepEqual(warmup.actions, []);

  const resumed = enforceTeacherContinuationPolicy({
    teacher_move: 'summary', intent: '', checkpoint: '',
  }, 'resume_after_review', { lessonStep: { phase: 'explain' } });
  assert.equal(resumed.teacher_move, 'explain');
});

test('retrieval warmup only selects learned due knowledge after the minimum interval', () => {
  const plan = createFallbackLessonPlan({ focus: '列表遍历' });
  const learnerProfile = {
    dueReviews: [{
      name: '循环边界', mastery: 0.3, urgency: 'due',
      last_reviewed: '2026-07-16T08:00:00.000Z', dueAt: '2026-07-16T08:00:00.000Z',
    }],
    lastLessonSummary: {
      review: { focus: '循环边界', interval_days: 1, task: '写出 range(2, 6) 的结果' },
    },
  };
  const warmup = planRetrievalWarmup({
    learnerProfile, lessonPlan: plan, now: new Date('2026-07-17T08:30:00.000Z'),
  });
  assert.equal(warmup.warmup.status, 'scheduled');
  assert.equal(warmup.warmup.knowledgePoint, '循环边界');
  assert.match(warmup.continuation.command, /一道不带提示/);
  assert.match(warmup.continuation.command, /写出 range\(2, 6\) 的结果/);

  const tooSoon = planRetrievalWarmup({
    learnerProfile: {
      dueReviews: [{ ...learnerProfile.dueReviews[0], last_reviewed: '2026-07-17T02:00:00.000Z' }],
    },
    lessonPlan: plan,
    now: new Date('2026-07-17T08:30:00.000Z'),
  });
  assert.equal(tooSoon, null);
  assert.equal(planRetrievalWarmup({
    learnerProfile, lessonPlan: plan,
    existingWarmup: { status: 'awaiting_response', knowledgePoint: '循环边界' },
    now: new Date('2026-07-17T08:30:00.000Z'),
  }), null);
});

test('retrieval warmup remediates difficulty and completes only on independent evidence', () => {
  const warmup = {
    status: 'awaiting_response', knowledgePoint: '循环边界', lessonTitle: '列表遍历短课',
  };
  const failed = updateRetrievalWarmup(warmup, {
    studentStateUpdate: { knowledgePoint: '循环边界', delta: -0.05, evidence: '学生仍把结束值算入' },
    activeIntervention: { category: 'concept_confusion', knowledgePoint: '循环边界' },
    studentTurnType: 'attempt',
  });
  assert.equal(failed.status, 'remediate');

  const prompted = updateRetrievalWarmup(failed, {
    studentStateUpdate: { knowledgePoint: '循环边界', delta: 0.03, supportLevel: 'prompted', evidence: '根据提示修正' },
    activeIntervention: { status: 'recheck', knowledgePoint: '循环边界' },
  });
  assert.equal(prompted.status, 'remediate');

  const passed = updateRetrievalWarmup(prompted, {
    studentStateUpdate: { knowledgePoint: '循环边界', delta: 0.08, supportLevel: 'independent', evidence: '独立完成无提示变式' },
    activeIntervention: null,
    resolvedIntervention: { status: 'resolved', knowledgePoint: '循环边界' },
  });
  assert.equal(passed.status, 'completed');
  assert.match(passed.completionEvidence, /独立完成/);

  const loopWarmup = { ...warmup, knowledgePoint: 'for 循环与累加运算' };
  const relatedSubskill = updateRetrievalWarmup(loopWarmup, {
    studentStateUpdate: {
      knowledgePoint: '累加变量的逐轮更新', delta: 0.08,
      supportLevel: 'independent', evidence: '独立追踪每轮 sum 的变化',
    },
  });
  assert.equal(relatedSubskill.status, 'completed');
  const unrelated = updateRetrievalWarmup(loopWarmup, {
    studentStateUpdate: {
      knowledgePoint: '数组索引', delta: 0.08,
      supportLevel: 'independent', evidence: '独立找到数组下标',
    },
  });
  assert.equal(unrelated.status, 'awaiting_response');
});

test('completed retrieval warmup plans a deduplicated return to the main lesson', () => {
  const plan = createFallbackLessonPlan({ focus: '列表遍历' });
  const continuation = planTeacherContinuation({
    lessonPlan: plan,
    previousProgress: { currentStep: 0, attempts: 0, status: 'active' },
    nextProgress: { currentStep: 0, attempts: 0, status: 'active' },
    source: 'review',
    evidence: {
      warmupCompleted: true, correct: true, supportLevel: 'independent',
      knowledgePoint: '循环边界', answer: '独立写出 1、2、3、4',
    },
  });
  assert.equal(continuation.kind, 'resume_after_review');
  assert.match(continuation.command, /热身已经完成/);
  assert.match(continuation.command, /开始当前教案步骤/);
});

test('teacher response quality requires real explanation and evidence-based feedback', () => {
  const good = assessTeacherTurnQuality({
    studentMessage: '老师，请点评我刚完成的代码练习。\n我的代码：\n```java\nsum += i;\n```',
    message: '代码正确。`sum += i` 每轮把当前 i 加到 sum，变化是 0→1→3。若上限改为 4，结果是多少？',
    structured: { teacher_move: 'feedback', checkpoint: '写出上限为 4 时的结果' },
  });
  assert.equal(good.valid, true);
  const shallow = assessTeacherTurnQuality({
    studentMessage: '为什么要从 0 开始？',
    message: '你先说说自己的理解。',
    structured: { teacher_move: 'explain', checkpoint: '想一想' },
  });
  assert.equal(shallow.valid, false);
  assert.match(shallow.issues.join('；'), /缺少具体例子|推回给学生|可执行/);
  const actionable = assessTeacherTurnQuality({
    studentMessage: '为什么这两个写法不同？',
    message: '例如 1+2+3 会依次得到 1、3、6。请给出最后的结果。',
    structured: { teacher_move: 'explain', checkpoint: '给出最后的计算结果' },
  });
  assert.equal(actionable.valid, true);
});

test('teacher quality checks whether the visible intervention matches the grounded diagnosis', () => {
  const aligned = assessTeacherTurnQuality({
    studentMessage: '我认为 range(1, 5) 会包含 5。',
    message: '`range(1, 5)` 与 `range(1, 6)` 的区别在结束值：前者不包含 5，后者才会产生 5。请选出前者的最后一个数。',
    structured: {
      teacher_move: 'clarify', checkpoint: '选择前者产生的最后一个数',
      student_state_update: { mastery_delta: -0.05 },
      learning_diagnosis: {
        category: 'concept_confusion', evidence_quote: '会包含 5',
      },
    },
  });
  assert.equal(aligned.valid, true);

  const implicitContrast = assessTeacherTurnQuality({
    studentMessage: '我觉得会生成 1、2、3、4、5。',
    message: '你从 1 递增的方向对了，但把结束值 5 也算进去了。实际只生成 1、2、3、4。请写出它们的和。',
    structured: {
      teacher_move: 'feedback', checkpoint: '写出实际产生的整数之和',
      student_state_update: { mastery_delta: -0.05 },
      learning_diagnosis: {
        category: 'concept_confusion', evidence_quote: '会生成 1、2、3、4、5',
      },
    },
  });
  assert.equal(implicitContrast.valid, true);

  const inlineCodeExample = assessTeacherTurnQuality({
    studentMessage: '',
    message: '并排看：`range(0, 2)` 产生 0、1；`range(0, 3)` 产生 0、1、2。现在只判断 `range(1, 2)` 的最后一个数。',
    structured: { teacher_move: 'explain', checkpoint: '在 1 和 2 中选择一个答案' },
  });
  assert.equal(inlineCodeExample.valid, true);

  const executableReview = assessTeacherTurnQuality({
    studentMessage: '',
    message: '本节已经完成。课后用一次输出检查结束值是否出现。',
    structured: { teacher_move: 'summary', checkpoint: '查看一次 list(range(1, 5)) 的结果并确认结束值' },
  });
  assert.equal(executableReview.valid, true);

  const ungrounded = assessTeacherTurnQuality({
    studentMessage: '答案是 15。',
    message: '请再检查一次。',
    structured: {
      teacher_move: 'feedback', checkpoint: '重新回答',
      student_state_update: { mastery_delta: -0.05 },
      learning_diagnosis: {
        category: 'concept_confusion', evidence_quote: '不理解左闭右开',
      },
    },
  });
  assert.equal(ungrounded.valid, false);
  assert.match(ungrounded.issues.join('；'), /逐字引用|没有匹配/);
});

test('lesson summary keeps only claims backed by concrete evidence', () => {
  const summary = normalizeLessonSummary({
    lesson_title: '循环累加',
    mastered: [
      { knowledge_point: '累加语句', evidence: '学生独立补全 sum += i 并得到输出15' },
      { knowledge_point: '循环边界', evidence: '会了' },
    ],
    needs_work: [
      { knowledge_point: '迁移应用', evidence: '学生把2到5的累加结果写成了15', next_action: '完成2到5的累加' },
      { knowledge_point: '边界辨析', evidence: '本节尚未验证小于与小于等于的区别', next_action: '比较两段循环输出' },
    ],
    misconceptions: [{ pattern: '边界少算一次', evidence: '两次把 i <= 5 写成 i < 5' }],
    review: { focus: '循环边界', interval_days: 1, task: '完成3到7的累加并写出输出' },
    next_lesson_focus: '循环边界迁移',
  }, { title: '默认课名', focus: '循环' });
  assert.equal(summary.mastered.length, 1);
  assert.equal(summary.needs_work.length, 1);
  assert.equal(summary.not_yet_verified[0].knowledge_point, '边界辨析');
  assert.equal(summary.review.interval_days, 1);
  assert.equal(summary.next_lesson_focus, '循环边界迁移');
  assert.equal(normalizeLessonSummary({ mastered: [{ knowledge_point: '循环', evidence: '懂了' }] }), null);
});

test('summary request requires an evidence-based longitudinal record', () => {
  const directive = buildTeacherTurnDirective({
    studentMessage: '请生成本节课堂小结', brief: { focus: '循环', goal: '完成累加迁移', lessonStep: { phase: 'summary', evidence: '完成迁移题' } },
  });
  assert.match(directive, /必须填写 lesson_summary/);
  assert.match(directive, /不得把教学目标写成已掌握事实/);
  const guarded = enforceTeacherTurnPolicy({ teacher_move: 'feedback', intent: '', checkpoint: '' }, '请生成课堂小结');
  assert.equal(guarded.teacher_move, 'summary');
  assert.equal(guarded.state, 'summary');
});

test('teacher brief recognizes a failed practice execution', () => {
  const brief = buildTeacherBrief({
    subjectName: 'Python',
    assessed: true,
    recentEvents: [{ event_type: 'practice_submit', detail_json: '{"success":false}' }],
  });
  assert.equal(brief.phase, 'reteach');
});

test('system prompt establishes a lesson contract and forbids generic praise', () => {
  const brief = buildTeacherBrief({ subjectName: '物理', assessed: true });
  const prompt = buildTeacherSystemPrompt(brief);
  assert.match(prompt, /本节目标/);
  assert.match(prompt, /先判断.*再回应/);
  assert.match(prompt, /不要使用.*你真棒/);
  assert.match(prompt, /一次只推进一个教学动作/);
  assert.match(prompt, /概念混淆.*对比解释/);
  assert.match(prompt, /代码围栏.*标注语言/);
  assert.match(prompt, /evidence_quote 必须逐字出现在学生本轮消息/);
  assert.match(prompt, /不能证明原因时 category 必须为 unknown/);
  assert.match(prompt, /等式两边做相同运算/);
  assert.match(prompt, /不得说成“两边做相反运算”/);
  assert.match(prompt, /隐藏 assessment/);
  assert.match(prompt, /reference_answer/);
  assert.match(prompt, /禁止泄露答案或评分键/);
});

test('Java teacher can open a safe runnable lab without treating execution as mastery', () => {
  const prompt = buildTeacherSystemPrompt(buildTeacherBrief({
    subjectName: 'Java 后端开发', assessed: true,
    lessonPlan: createFallbackLessonPlan({ focus: '++i 与 i++', goal: '理解自增顺序' }),
    lessonProgress: { currentStep: 0, status: 'active' },
  }));
  assert.match(prompt, /coding_lab/);
  assert.match(prompt, /public class Main/);
  assert.match(prompt, /文件、网络、进程、反射/);
  assert.match(prompt, /仅在 student_task 为 practice/);
});

test('turn directive escalates an existing intervention instead of repeating it', () => {
  const intervention = normalizeLearningDiagnosis({
    category: 'procedure_gap', knowledge_point: '循环累加',
    evidence_quote: '写成 sum = i', evidence: '覆盖旧的累加值',
  }, { studentMessage: '我写成 sum = i。' });
  const directive = buildTeacherTurnDirective({
    studentMessage: '我还是写 sum = i。',
    brief: { focus: '循环累加', goal: '正确更新累加值', intervention },
    previousTeacherMessage: '上一轮已经逐步示范过。',
    previousTeacherMove: 'model',
  });
  assert.match(directive, /当前干预：步骤遗漏/);
  assert.match(directive, /缩小到一个变化/);
  assert.match(directive, /禁止重复上一轮讲解/);
});

test('classroom orchestrator distinguishes evidence, questions, and unsupported self reports', () => {
  assert.equal(classifyStudentTurn('老师，请点评我刚完成的代码练习。\n我的代码：\n```java\n```'), 'submitted_work');
  assert.equal(classifyStudentTurn('我还是不懂循环怎么执行'), 'stuck');
  assert.equal(classifyStudentTurn('我懂了'), 'self_report');
  assert.equal(classifyStudentTurn('为什么这里要加一？'), 'question');
  assert.equal(classifyStudentTurn('答案是 15'), 'attempt');
  assert.equal(classifyStudentTurn('请生成本节课堂小结'), 'summary_request');
});

test('submitted work receives a worked explanation and transfer check contract', () => {
  const directive = buildTeacherTurnDirective({
    studentMessage: '老师，请点评我刚完成的代码练习。\n我的代码：\n```java\nsum += i;\n```',
    brief: { goal: '理解累加', focus: 'for 循环' },
    previousTeacherMessage: '请补全代码。',
    previousTeacherMove: 'practice',
    studentTurnCount: 2,
  });
  assert.match(directive, /回合类型：submitted_work/);
  assert.match(directive, /老师亲自讲清/);
  assert.match(directive, /改变一个条件/);
  assert.match(directive, /禁止要求学生复述/);
  assert.match(directive, /不要重复上一轮/);
});

test('stuck and self-report turns do not create unsupported mastery evidence', () => {
  const stuck = buildTeacherTurnDirective({ studentMessage: '我不会', brief: { focus: '变量' } });
  const selfReport = buildTeacherTurnDirective({ studentMessage: '明白了', brief: { focus: '变量' } });
  assert.match(stuck, /最小可运行\/可计算的示例/);
  assert.match(stuck, /student_state_update 必须为 null/);
  assert.match(selfReport, /不把“懂了”当作掌握证据/);
  assert.match(selfReport, /一分钟内完成的可观察微任务/);
});

test('client policy prevents the teacher from pushing explanation back to the student', () => {
  const guarded = enforceTeacherTurnPolicy({
    state: 'check', teacher_move: 'question', intent: '检查理解', checkpoint: '请解释 sum += i 是什么意思',
    student_state_update: { mastery_delta: 0.1 },
  }, '老师，请点评我刚完成的代码练习。\n我的代码：\n```java\nsum += i;\n```');
  assert.equal(guarded.teacher_move, 'feedback');
  assert.equal(guarded.checkpoint, '完成一道只改变一个条件的变式题');
  assert.equal(guarded.state, 'feedback');

  const selfReport = enforceTeacherTurnPolicy({ teacher_move: 'summary', intent: '', checkpoint: '', student_state_update: { mastery_delta: 0.1 } }, '我懂了');
  assert.equal(selfReport.teacher_move, 'question');
  assert.equal(selfReport.student_state_update, null);
  assert.match(selfReport.checkpoint, /一分钟微任务/);

  const plainTextFallback = enforceTeacherTurnPolicy(null, '为什么初始值是 0？');
  assert.equal(plainTextFallback.teacher_move, 'explain');
  assert.equal(plainTextFallback.state, 'explain');
  assert.match(plainTextFallback.checkpoint, /讲清/);

  const questionWithUnsupportedJudgment = enforceTeacherTurnPolicy({
    teacher_move: 'explain', intent: '回答问题', checkpoint: '回答一个小问题',
    student_state_update: { knowledge_point: '初始值', mastery_delta: -0.1, confidence: 0.9, evidence: '学生提出了问题' },
  }, '为什么 sum 要先设为 0？');
  assert.equal(questionWithUnsupportedJudgment.student_state_update, null);

  const summaryTurn = enforceTeacherTurnPolicy({ teacher_move: 'feedback', intent: '继续反馈', checkpoint: '再做一题' }, '答案是 10', {
    lessonStep: { phase: 'summary' },
  });
  assert.equal(summaryTurn.teacher_move, 'summary');
  assert.equal(summaryTurn.state, 'summary');
});

test('client policy rejects a lesson summary before the evidence gate reaches summary', () => {
  const brief = buildTeacherBrief({
    subjectName: 'Java基础编程',
    assessed: true,
    lessonPlan: normalizeLessonPlan({
      title: '循环累加',
      focus: 'for 循环累加',
      objective: '独立完成指定区间累加',
      success_criteria: ['完成引导练习', '完成迁移检查'],
      steps: [
        { id: 'explain', phase: 'explain', goal: '讲清循环执行顺序', evidence: '能跟随执行轨迹' },
        { id: 'practice', phase: 'practice', goal: '完成练习', evidence: '提交正确代码', criterion_ids: ['criterion-1'] },
        { id: 'check', phase: 'check', goal: '完成迁移', evidence: '独立提交变式', criterion_ids: ['criterion-2'] },
        { id: 'summary', phase: 'summary', goal: '总结', evidence: '形成总结' },
      ],
      remediation: { trigger: '连续错误', action: '缩小例子' },
    }),
    lessonProgress: { currentStep: 0, status: 'active', gateVersion: 1, evidenceLedger: { records: [] } },
  });
  const result = enforceTeacherTurnPolicy({
    state: 'summary',
    message: '本节目标已完成，无需继续作答。',
    teacher_move: 'summary',
    intent: '完成本节',
    checkpoint: '进入下一节',
    instruction_block: {
      prior_connection: '你已经见过循环变量。',
      mental_model: '每轮先判断条件，再执行循环体，最后更新变量。',
      worked_example: 'i 从 1 到 3 时，sum 依次为 1、3、6。',
      subgoals: ['初始化', '判断边界'],
      contrast_or_boundary: '退出时的 i 不会再参与累加。',
      summary: '循环变量控制轮次，sum 保存累计结果。',
    },
    student_task: { kind: 'none' },
    lesson_summary: { lesson_title: '循环累加', mastered: [] },
    actions: [{ type: 'advance', label: '进入下一节' }],
  }, '继续', brief, null);
  assert.equal(result.completion_claim_rejected, true);
  assert.equal(result.teacher_move, 'explain');
  assert.equal(result.lesson_summary, null);
  assert.equal(result.student_task.kind, 'none');
  assert.doesNotMatch(result.message, /本节目标已完成/);
  assert.equal(result.actions.some(action => action.type === 'advance'), false);
});

test('manual lesson continuation uses the same summary evidence gate', () => {
  const brief = {
    phase: 'explain',
    focus: 'for 循环累加',
    lessonStep: { id: 'explain', phase: 'explain', goal: '讲清循环执行顺序', evidence: '能跟随执行轨迹' },
    masteryGate: { nextRequirement: '先完成讲解与示范' },
  };
  const result = enforceTeacherContinuationPolicy({
    state: 'summary',
    message: '本节目标已完成，无需继续作答。',
    teacher_move: 'summary',
    intent: '结束本节',
    checkpoint: '无需作答',
    instruction_block: {
      prior_connection: '你已经见过循环变量。',
      mental_model: '每轮先判断，再执行，最后更新。',
      worked_example: 'i 从 1 到 3 时，sum 依次为 1、3、6。',
      subgoals: ['初始化', '判断边界'],
      contrast_or_boundary: '退出值不再参与累加。',
      summary: 'i 控制轮次，sum 保存总和。',
    },
    student_task: { kind: 'none' },
    lesson_summary: { lesson_title: '循环累加' },
  }, '', brief, null);
  assert.equal(result.completion_claim_rejected, true);
  assert.equal(result.teacher_move, 'explain');
  assert.equal(result.lesson_summary, null);
  assert.doesNotMatch(result.message, /本节目标已完成/);
});

test('manual continuation cannot downgrade a lesson check to diagnosis', () => {
  const result = enforceTeacherContinuationPolicy({
    state: 'check',
    message: '我没有看到代码，请重新粘贴。',
    teacher_move: 'diagnose',
    intent: '补全信息',
    checkpoint: '重新粘贴代码',
    student_task: { kind: 'diagnostic_check', prompt: '粘贴完整代码' },
  }, '', {
    phase: 'check',
    focus: '指定起点和终点的 for 循环累加',
    lessonStep: { phase: 'check', goal: '独立完成只把起点从 3 改为 4 的迁移题' },
    masteryGate: { nextRequirement: '独立完成一道变式迁移' },
  }, null);
  assert.equal(result.teacher_move, 'question');
  assert.equal(result.student_task.kind, 'knowledge_check');
  assert.equal(result.student_task.supportContext, 'independent');
  assert.equal(result.student_task.cadenceRole, 'transfer_check');
  assert.doesNotMatch(result.message, /没有看到|重新粘贴/);
});

test('premature summary text is replaced even when its instruction block is incomplete', () => {
  const result = enforceTeacherContinuationPolicy({
    state: 'summary',
    message: '本节目标已达成，课堂结束。',
    teacher_move: 'summary',
    intent: '结束本节',
    checkpoint: '无需作答',
    instruction_block: { summary: '只提供了总结。' },
    student_task: { kind: 'none' },
  }, '', {
    phase: 'practice',
    focus: '循环累加',
    lessonStep: { phase: 'practice', goal: '完成指定区间累加练习', evidence: '提交可运行代码' },
    masteryGate: { nextRequirement: '独立完成当前练习' },
  }, null);
  assert.equal(result.completion_claim_rejected, true);
  assert.match(result.message, /当前课时还没有进入总结阶段/);
  assert.doesNotMatch(result.message, /本节目标已达成|课堂结束/);
  assert.equal(result.student_task.kind, 'practice');
  assert.match(result.student_task.prompt, /指定区间累加练习/);
});

test('a correct practice answer closes the current task before the lesson advances', () => {
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'feedback', intent: '确认答案', checkpoint: '再做一道同构题',
    student_state_update: {
      knowledge_point: '循环边界', mastery_delta: 0.1, confidence: 0.9,
      evidence: '学生独立得到正确结果', support_level: 'independent',
    },
    student_task: { kind: 'knowledge_check', prompt: '把起点改成 2 后再算一次' },
  }, '结果是 4', { focus: '循环边界', lessonStep: { phase: 'practice' } });
  assert.equal(guarded.student_task.kind, 'none');
});

test('a correct final transfer check leaves no extra unanswered task before summary', () => {
  const brief = {
    phase: 'check', focus: '一元一次方程移项', goal: '独立完成迁移',
    lessonStep: { phase: 'check', goal: '完成变式题', evidence: '独立得到正确结果' },
  };
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'feedback', intent: '判断迁移答案', checkpoint: '再解一道变式题',
    message: 'x=6 正确，两边先减 5 再除以 2。再检查一次：解 2x+5=19，只写 x。',
    student_state_update: {
      knowledge_point: '一元一次方程移项', mastery_delta: 0.08, confidence: 0.9,
      evidence: '学生独立回答 x=6', support_level: 'independent',
    },
    student_task: { kind: 'knowledge_check', prompt: '解 2x+5=19，只写 x' },
  }, 'x=6', brief, normalizeStudentTask({
    kind: 'knowledge_check', prompt: '解 2x+5=17，只写 x', knowledge_point: '一元一次方程移项',
  }));
  assert.equal(guarded.student_task.kind, 'none');
  assert.match(guarded.checkpoint, /课堂总结/);
  const visible = enforceTeacherVisibleMessage(guarded.message, guarded);
  assert.match(visible, /x=6 正确/);
  assert.doesNotMatch(visible, /2x\+5=19/);
});

test('greeting sounds like a teacher and states the lesson goal', () => {
  const brief = buildTeacherBrief({
    subjectName: '英语',
    assessed: true,
    knowledgePoints: [{ name: '一般过去时', mastery: 0.35 }],
  });
  const greeting = createTeacherGreeting(brief);
  assert.match(greeting, /我是你的英语老师/);
  assert.match(greeting, /一般过去时/);
  assert.match(greeting, /先/);
});

test('diagnostic greeting offers a precise answer format', () => {
  const greeting = createTeacherGreeting(buildTeacherBrief({ subjectName: 'Java', assessed: false }));
  assert.match(greeting, /A 没学过/);
  assert.match(greeting, /B 跟着课程做过/);
  assert.match(greeting, /C 能独立完成/);
  assert.doesNotMatch(greeting, /学过哪些内容.*卡在哪/);
});

test('student state update clamps a single-turn mastery change', () => {
  const update = normalizeStudentStateUpdate({
    knowledge_point: '一元二次方程',
    mastery_delta: 0.8,
    confidence: 0.86,
    evidence: '学生独立写出求根公式并解释了判别式的作用',
  }, 0.4);
  assert.equal(update.mastery, 0.55);
  assert.equal(update.delta, 0.15);
});

test('student state update rejects unsupported or low-confidence judgments', () => {
  assert.equal(normalizeStudentStateUpdate({
    knowledge_point: '函数', mastery_delta: 0.1, confidence: 0.4, evidence: '似乎会了',
  }, 0.3), null);
  assert.equal(normalizeStudentStateUpdate({
    knowledge_point: '函数', mastery_delta: 0.1, confidence: 0.9, evidence: '',
  }, 0.3), null);
});

test('assessment interview advances through evidence stages instead of free chat', () => {
  assert.equal(getAssessmentInterviewStage(0, true).key, 'goal');
  assert.equal(getAssessmentInterviewStage(0, false).key, 'experience');
  assert.equal(getAssessmentInterviewStage(2, false).key, 'transfer');
  assert.equal(getAssessmentInterviewStage(3, false).readyForTest, true);
  const prompt = buildAssessmentTurnPrompt({ subjectName: 'Python', completedTurns: 1 });
  assert.match(prompt, /代表性任务/);
  assert.match(prompt, /不超过 70 个汉字/);
  assert.match(prompt, /不得追问术语清单/);
  assert.match(prompt, /一分钟内可答/);
  assert.match(prompt, /必须只返回一个 JSON/);
});

test('assessment experience question uses low-effort choices', () => {
  const prompt = buildAssessmentTurnPrompt({ subjectName: 'Java', completedTurns: 0 });
  assert.match(prompt, /A 没接触过/);
  assert.match(prompt, /B 跟教程或课堂做过/);
  assert.match(prompt, /C 独立完成过/);
  assert.match(prompt, /不要要求学生描述工具、场景和内容/);
});

test('assessment routes an experienced self report directly to a real anchor task', () => {
  const routed = routeAssessmentInterview({
    completedTurns: 0,
    subjectIsAmbiguous: false,
    studentResponse: '我有一些基础，可以直接问我几个问题。',
  });
  assert.equal(routed.previousStage.key, 'experience');
  assert.equal(routed.stage.key, 'anchor');
  assert.equal(routed.responseProfile.experienceLevel, 'experienced');
  assert.equal(routed.responseProfile.hasCapabilityEvidence, false);
  const prompt = buildAssessmentTurnPrompt({
    subjectName: 'Java',
    completedTurns: routed.completedTurns,
    responseProfile: routed.responseProfile,
  });
  assert.match(prompt, /立即给一道真实的一分钟代码阅读、执行结果、定位错误或单步迁移题/);
  assert.match(prompt, /这不是能力证据/);
  assert.match(prompt, /不得再问做过什么项目或学过哪些术语/);
  assert.match(prompt, /readiness 必须为 continue/);
  assert.match(prompt, /只要求一个答案/);
});

test('assessment advances only on a concrete answer to the current evidence task', () => {
  const unclear = routeAssessmentInterview({
    completedTurns: 1,
    studentResponse: '你好',
  });
  assert.equal(unclear.stage.key, 'anchor');
  assert.equal(unclear.responseProfile.kind, 'unclear');

  const support = routeAssessmentInterview({
    completedTurns: 1,
    studentResponse: '我不会，需要提示',
  });
  assert.equal(support.stage.key, 'anchor');
  assert.equal(support.responseProfile.kind, 'needs_support');

  const answered = routeAssessmentInterview({
    completedTurns: 1,
    studentResponse: '3',
  });
  assert.equal(answered.stage.key, 'transfer');
  assert.equal(answered.responseProfile.kind, 'capability_answer');
});

test('assessment rebuilds old sessions conservatively from student evidence', () => {
  const progress = rebuildAssessmentProgress([
    { role: 'assistant', content: '你以前学过 Java 吗？' },
    { role: 'user', content: '学过一点，直接出题吧。' },
    { role: 'assistant', content: 'sum=1，再加2后是多少？' },
    { role: 'user', content: '3' },
    { role: 'assistant', content: '改成再加3后是多少？' },
    { role: 'user', content: '6' },
  ]);
  assert.equal(progress.completedTurns, 3);
  assert.deepEqual(progress.evidenceTags, [
    'experience_experienced',
    'anchor_answer',
    'transfer_answer',
  ]);
});

test('assessment response classification never treats self report as capability evidence', () => {
  const profile = classifyAssessmentResponse('我学过基础语法，应该都会', { stageKey: 'anchor' });
  assert.equal(profile.experienceLevel, 'experienced');
  assert.equal(profile.hasCapabilityEvidence, false);
});

test('teacher move requires a visible purpose and student checkpoint', () => {
  assert.equal(normalizeTeacherMove({ teacher_move: 'explain', intent: '', checkpoint: '复述概念' }), null);
  assert.deepEqual(normalizeTeacherMove({
    state: 'check', teacher_move: 'question', teaching_strategy: 'state_trace',
    intent: '检查是否理解负根', checkpoint: '写出全部解', readiness: 'continue',
  }), {
    move: 'question', label: '检查理解', intent: '检查是否理解负根', checkpoint: '写出全部解',
    teachingStrategy: 'state_trace', state: 'check', evidence: null, stageComplete: false, readiness: 'continue',
  });
});

test('quick replies are short, unique, and require useful choices', () => {
  assert.deepEqual(normalizeQuickReplies(['A 没学过', 'A 没学过', 'B 跟着做过', 'C 独立做过']), [
    'A 没学过', 'B 跟着做过', 'C 独立做过',
  ]);
  assert.deepEqual(normalizeQuickReplies(['只有一个']), []);
  assert.equal(normalizeQuickReplies(['一'.repeat(50), '短答案'])[0].length, 40);
});

test('student task contract derives a conservative evidence scope', () => {
  const knowledgeTask = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '当 i=2 时 sum 是多少？',
    expected_response: '一个整数', knowledge_point: '循环累加', evidence_scope: 'none',
  }, { teacherMove: 'question', checkpoint: '写出 sum 的值' });
  assert.equal(knowledgeTask.evidenceScope, 'mastery');
  assert.equal(studentTaskAllowsMasteryEvidence(knowledgeTask), true);
  assert.equal(studentTaskAllowsDiagnosisEvidence(knowledgeTask), true);

  const assessedTask = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '解 2x+3=11，只写 x', knowledge_point: '一元一次方程移项',
    assessment: {
      reference_answer: 'x=4', grading_mode: 'equivalent',
      criteria: ['结果等价于 x=4', '若写过程，等式两边做相同运算'],
      acceptable_alternatives: ['4'],
    },
  }, { teacherMove: 'question', checkpoint: '解方程' });
  assert.deepEqual(assessedTask.assessment, {
    referenceAnswer: 'x=4',
    criteria: ['结果等价于 x=4', '若写过程,等式两边做相同运算'],
    acceptableAlternatives: ['4'],
    gradingMode: 'equivalent',
  });
  assert.doesNotMatch(assessedTask.prompt, /x=4/);
  assert.doesNotMatch(assessedTask.key, /x=4/);

  const preferenceTask = normalizeStudentTask({
    kind: 'learning_choice', prompt: '选择慢讲还是先看例子', evidence_scope: 'mastery',
  }, { teacherMove: 'question', checkpoint: '选择学习方式' });
  assert.equal(preferenceTask.evidenceScope, 'preference');
  assert.equal(studentTaskAllowsMasteryEvidence(preferenceTask), false);
  assert.equal(studentTaskAllowsDiagnosisEvidence(preferenceTask), false);

  const diagnosticTask = normalizeStudentTask(null, {
    teacherMove: 'clarify', checkpoint: '选择是边界还是累加步骤卡住', knowledgePoint: '循环',
  });
  assert.equal(diagnosticTask.kind, 'diagnostic_check');
  assert.equal(studentTaskAllowsMasteryEvidence(diagnosticTask), false);
  assert.equal(studentTaskAllowsDiagnosisEvidence(diagnosticTask), true);

  const practiceTask = normalizeStudentTask(null, {
    teacherMove: 'practice', checkpoint: '提交补全后的代码', knowledgePoint: '循环',
  });
  assert.equal(practiceTask.kind, 'practice');
});

test('repair context survives task normalization and JSON session round trips', () => {
  const task = normalizeStudentTask({
    kind: 'diagnostic_check', prompt: '只改写“3x=6”这一处',
    expected_response: '一个等式', knowledge_point: '一元一次方程',
    repair_context: {
      id: 'repair-equation-1', stage: 'repair_step', attempts: 2,
      verified_part_excerpt: '3x-6=12', original_error_excerpt: '3x=6',
      first_error_excerpt: '3x=6', correction_focus: '等式两边同时加6',
      original_task: {
        kind: 'practice', prompt: '解 3(x-2)=12，写出每一步',
        expected_response: '按顺序写等式', knowledge_point: '一元一次方程',
        assessment: {
          reference_answer: '3x-6=12，3x=18，x=6',
          criteria: ['展开正确', '两边同时加6'], grading_mode: 'process',
        },
      },
    },
  }, { teacherMove: 'feedback', checkpoint: '只改写“3x=6”这一处' });
  const restored = normalizeStudentTask(JSON.parse(JSON.stringify(task)), {
    teacherMove: 'feedback', checkpoint: task.prompt,
  });
  assert.equal(restored.evidenceScope, 'diagnosis');
  assert.equal(studentTaskAllowsMasteryEvidence(restored), false);
  assert.equal(studentTaskAllowsDiagnosisEvidence(restored), true);
  assert.equal(restored.repairContext.id, 'repair-equation-1');
  assert.equal(restored.repairContext.stage, 'repair_step');
  assert.equal(restored.repairContext.attempts, 2);
  assert.equal(restored.repairContext.originalTask.kind, 'practice');
  assert.match(restored.repairContext.originalTask.assessment.referenceAnswer, /3x=18/);
  const directive = buildTeacherTurnDirective({
    studentMessage: '3x=18', brief: { subjectName: '数学', focus: '方程' },
    pendingStudentTask: restored,
  });
  assert.match(directive, /当前纠错闭环|repair_step|原任务/);
  assert.doesNotMatch(directive, /3x-6=12,3x=18,x=6/);
});

test('legacy grading-delegation tasks restore the original task', () => {
  const restored = normalizeStudentTask({
    kind: 'diagnostic_check',
    prompt: '二选一：按上面的核对原则，只回复“7”满足或不满足。',
    expected_response: '满足或不满足',
    knowledge_point: '前置与后置自增',
    repair_context: {
      id: 'repair-format-1', stage: 'repair_step', attempts: 1,
      original_error_excerpt: '7', first_error_excerpt: '7',
      correction_focus: '答案必须同时给出 i 和 r。',
      original_task: {
        kind: 'knowledge_check', prompt: '执行后 i 和 r 分别是多少？',
        expected_response: '一行：i=数字，r=数字', knowledge_point: '前置与后置自增',
        assessment: { reference_answer: 'i=5,r=8', criteria: ['同时给出两个值'], grading_mode: 'equivalent' },
      },
    },
  }, { teacherMove: 'feedback' });
  assert.equal(restored.kind, 'knowledge_check');
  assert.equal(restored.prompt, '执行后 i 和 r 分别是多少?');
  assert.equal(restored.expectedResponse, '一行:i=数字,r=数字');
  assert.equal(restored.repairContext.stage, 'retry_original');
});

test('non-mastery student tasks cannot update mastery', () => {
  const update = normalizeStudentStateUpdate({
    knowledge_point: '循环', mastery_delta: 0.1, confidence: 0.9,
    evidence: '学生选择了慢一点并回复 A', support_level: 'independent',
  }, 0.2);
  const preferenceTask = normalizeStudentTask({ kind: 'learning_choice', prompt: '选择学习节奏' });
  const diagnosticTask = normalizeStudentTask({ kind: 'diagnostic_check', prompt: '选择卡点类型' });
  const knowledgeTask = normalizeStudentTask({ kind: 'knowledge_check', prompt: '写出循环结果' });

  assert.equal(enforceStudentEvidenceSupport(update, { pendingStudentTask: preferenceTask }), null);
  assert.equal(enforceStudentEvidenceSupport(update, { pendingStudentTask: diagnosticTask }), null);
  assert.equal(enforceStudentEvidenceSupport(update, { pendingStudentTask: knowledgeTask })?.delta, 0.1);
});

test('classroom regulation and pending choices are not treated as subject attempts', () => {
  const choiceTask = normalizeStudentTask({ kind: 'learning_choice', prompt: '选 A 慢讲或 B 看例子' });
  const readinessTask = normalizeStudentTask({ kind: 'readiness', prompt: '是否继续' });
  assert.equal(classifyStudentTurn('A', { pendingStudentTask: choiceTask }), 'learning_choice');
  assert.equal(classifyStudentTurn('继续', { pendingStudentTask: readinessTask }), 'readiness_response');
  assert.equal(classifyStudentTurn('应该是 3，我猜的'), 'uncertain_attempt');
  assert.equal(classifyStudentTurn('直接告诉我答案，我照抄就行'), 'answer_seeking');
  assert.equal(classifyStudentTurn('太快了，慢一点'), 'regulation_request');
  assert.equal(classifyStudentTurn('为什么结束值不包含 5？', { pendingStudentTask: choiceTask }), 'question');
});

test('client policy isolates regulation signals without interrupting an explanation with a task', () => {
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'feedback', intent: '判断回答', checkpoint: '再回答一题',
    student_state_update: { knowledge_point: '循环', mastery_delta: -0.1 },
    learning_diagnosis: { category: 'concept_confusion', evidence_quote: '太快了' },
    student_task: { kind: 'knowledge_check', prompt: '只写 1+2 的结果', expected_response: '一个整数' },
  }, '太快了，我跟不上', { focus: '循环累加', phase: 'explain' });

  assert.equal(guarded.teacher_move, 'clarify');
  assert.equal(guarded.student_state_update, null);
  assert.equal(guarded.learning_diagnosis, null);
  assert.equal(guarded.student_task.kind, 'none');
});

test('an abstract checkpoint is aligned to the concrete pending task', () => {
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'explain', intent: '回答学生问题', checkpoint: '检查你的理解',
    student_task: {
      kind: 'knowledge_check', prompt: '写出 x+5=12 两边同时减5后的等式',
      expected_response: '一个等式', knowledge_point: '一元一次方程移项',
      assessment: { reference_answer: 'x=7', criteria: ['等式等价'], grading_mode: 'equivalent' },
    },
  }, '为什么符号会变化？', { focus: '一元一次方程移项', phase: 'explain' });
  assert.equal(guarded.student_task.kind, 'none');
  assert.match(guarded.checkpoint, /讲清/);
});

test('teacher directive receives the exact pending task and protects uncertain answers', () => {
  const pendingStudentTask = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '当 i=2 时 sum 是多少？',
    expected_response: '一个整数', knowledge_point: '循环累加',
  });
  const directive = buildTeacherTurnDirective({
    studentMessage: '应该是 3，我猜的',
    brief: { focus: '循环累加', goal: '追踪 sum 的变化' },
    pendingStudentTask,
  });
  assert.match(directive, /回合类型：uncertain_attempt/);
  assert.match(directive, /当 i=2 时 sum 是多少/);
  assert.match(directive, /即使答案碰巧正确也不得更新掌握度/);
  assert.match(directive, /student_task 必须与本轮最后留下的唯一学生动作完全一致/);
});

test('checkpoint reminder preserves the original unanswered task', () => {
  const pendingStudentTask = normalizeStudentTask({
    kind: 'practice', prompt: '补全循环中的一行并提交',
    expected_response: '一行 Java 代码', knowledge_point: '循环累加',
  });
  const reminder = enforceTeacherContinuationPolicy({
    teacher_move: 'question', checkpoint: '再做一道新题',
    student_task: { kind: 'knowledge_check', prompt: '新问题' },
  }, 'checkpoint_reminder', { focus: '循环累加', phase: 'practice' }, pendingStudentTask);

  assert.equal(reminder.teacher_move, 'practice');
  assert.equal(reminder.checkpoint, pendingStudentTask.prompt);
  assert.deepEqual(reminder.student_task, pendingStudentTask);
  assert.deepEqual(reminder.actions, []);
  assert.equal(reminder.student_state_update, null);
});

test('visible teacher message keeps only the question matching the pending task', () => {
  const structured = {
    checkpoint: '写出 x-4=9 移项后的等式',
    student_task: {
      kind: 'knowledge_check',
      prompt: '写出 x-4=9 移项后的等式',
    },
  };
  const message = '移项是两边做相同运算的简写。检查：x-4=9 移项后怎样写？两边做了什么？';
  const guarded = enforceSingleTeacherQuestion(message, structured);
  assert.equal((guarded.match(/[?？]/g) || []).length, 1);
  assert.match(guarded, /移项后怎样写/);
  assert.doesNotMatch(guarded, /两边做了什么/);
  assert.match(guarded, /移项是两边做相同运算/);
});

test('visible teacher message and task keep one student action', () => {
  const task = normalizeStudentTask({
    kind: 'knowledge_check',
    prompt: '写出 2x+5=11 移项后的等式，并说明两边同时做了什么',
    expected_response: '一个等式和一句说明',
  });
  assert.equal(task.prompt, '写出 2x+5=11 移项后的等式');

  const message = enforceTeacherVisibleMessage(
    '等式两边做相同运算。现在写出 2x+5=11 移项后的等式，并说明两边同时做了什么。',
    { student_task: task, checkpoint: task.prompt },
  );
  assert.match(message, /现在写出 2x\+5=11 移项后的等式/);
  assert.doesNotMatch(message, /并说明/);

  const guardedTurn = enforceTeacherTurnPolicy({
    teacher_move: 'explain',
    intent: '回答移项问题',
    checkpoint: '写出 2x+5=13 的下一步，并注明两边做了什么',
    student_task: {
      kind: 'knowledge_check',
      prompt: '写出 2x+5=13 的下一步，并注明两边做了什么',
    },
  }, '为什么移项以后符号会变？', { focus: '一元一次方程移项', phase: 'explain' });
  assert.match(guardedTurn.checkpoint, /讲清/);
  assert.equal(guardedTurn.student_task.kind, 'none');

  const colloquial = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '写出化简后的等式，并说两边做了什么',
  });
  assert.equal(colloquial.prompt, '写出化简后的等式');
  assert.equal(enforceTeacherVisibleMessage(
    '请写出化简后的等式，并说两边做了什么。',
    { teacher_move: 'question', checkpoint: colloquial.prompt, student_task: colloquial },
  ), '请写出化简后的等式。');

  const formatOnly = assessTeacherTurnQuality({
    studentMessage: '应该是 6，我猜的',
    message: '先验证第一小步：1+2等于多少？只写一个整数。',
    structured: {
      teacher_move: 'clarify',
      checkpoint: '计算 1+2 并只写一个整数',
      student_task: { kind: 'knowledge_check', prompt: '计算 1+2 并只写一个整数' },
    },
  });
  assert.equal(formatOnly.valid, true);

  const fillRightSide = assessTeacherTurnQuality({
    studentMessage: '直接告诉我答案，我照抄就行',
    message: '左边减 3，右边也必须减 3：`(2x+3)-3=____`。请只补右边。',
    structured: {
      teacher_move: 'hint', checkpoint: '请只补右边',
      student_task: { kind: 'knowledge_check', prompt: '请只补右边' },
    },
  });
  assert.equal(fillRightSide.valid, true);

  const responseFormat = assessTeacherTurnQuality({
    studentMessage: '应该是 6，我猜的',
    message: '先计算第一小步，再回答一个整数。',
    structured: {
      teacher_move: 'clarify', checkpoint: '先计算 1+2，再回答一个整数',
      student_task: { kind: 'knowledge_check', prompt: '先计算 1+2，再回答一个整数' },
    },
  });
  assert.equal(responseFormat.valid, true);
});

test('student concept questions suspend the pending task and remove follow-up questions', () => {
  const pending = normalizeStudentTask({
    kind: 'knowledge_check',
    prompt: '当 i=2 时，写出 sum 的值',
    expected_response: '一个整数',
    knowledge_point: '循环累加',
    assessment: {
      reference_answer: '3',
      criteria: ['使用上一轮 sum 值'],
      grading_mode: 'equivalent',
    },
  });
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'explain',
    intent: '回答学生问题',
    checkpoint: '改做一道数组题',
    message: 'sum 会保存上一轮结果。数组长度是多少？',
    student_task: {
      kind: 'knowledge_check',
      prompt: '数组长度是多少？',
      expected_response: '一个整数',
      knowledge_point: '数组',
    },
  }, '为什么 sum 不是重新从 0 开始？', { focus: '循环累加', phase: 'explain' }, pending);

  assert.equal(guarded.task_suspended, true);
  assert.equal(guarded.student_task.kind, 'none');
  assert.match(guarded.checkpoint, /讲清/);
  const visible = enforceTeacherVisibleMessage(guarded.message, guarded);
  assert.match(visible, /sum 会保存上一轮结果/);
  assert.doesNotMatch(visible, /数组长度是多少/);
  assert.doesNotMatch(visible, /继续作答|当前任务/);
});

test('first verified error closes the original task and makes the teacher reveal the correction', () => {
  const pending = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '执行 i++ 后 i 是多少？',
    expected_response: '一个整数', knowledge_point: '后置自增',
  });
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'question', intent: '要求重做', checkpoint: '再做一次原题',
    message: '答案不对，请重做。',
    student_state_update: {
      knowledge_point: '后置自增', mastery_delta: -0.08,
      support_level: 'independent', evidence: '学生回答 2，标准答案为 3',
    },
    student_task: pending,
  }, '2', { focus: '后置自增', phase: 'check' }, pending);

  assert.equal(guarded.instructional_decision.action, 'correct_and_explain');
  assert.equal(guarded.teacher_move, 'feedback');
  assert.equal(guarded.student_task.kind, 'none');
  assert.equal(guarded.answer_revealed, true);
  assert.match(guarded.checkpoint, /讲清正确答案/);
});

test('prompted success permits only one fresh independent recheck', () => {
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'question', intent: '撤掉提示检查', checkpoint: '判断新的表达式结果',
    student_state_update: {
      knowledge_point: '前置与后置自增', mastery_delta: 0.03,
      support_level: 'prompted', evidence: '学生在提示后完成',
    },
    student_task: {
      kind: 'knowledge_check', prompt: '判断 int i=2; int r=++i; 的结果',
      expected_response: 'i=数字，r=数字', knowledge_point: '前置与后置自增',
    },
  }, 'i=3，r=3', { focus: '前置与后置自增', phase: 'practice' });

  assert.equal(guarded.instructional_decision.action, 'independent_recheck');
  assert.equal(guarded.student_task.supportContext, 'independent');
  assert.equal(guarded.student_task.cadenceRole, 'transfer_check');
  assert.equal(guarded.max_immediate_rechecks, 1);
});

test('explicit next lesson intent closes the current task and schedules the gap for review', () => {
  const pending = normalizeStudentTask({
    kind: 'knowledge_check', prompt: '再判断一道相近题', knowledge_point: '循环累加',
  });
  const guarded = enforceTeacherTurnPolicy({
    teacher_move: 'question', intent: '继续复查', checkpoint: pending.prompt,
    student_task: pending,
  }, '这题先跳过，我想进入下一节', { focus: '循环累加', phase: 'check' }, pending);

  assert.equal(guarded.instructional_decision.action, 'advance_and_schedule_review');
  assert.equal(guarded.student_task.kind, 'none');
  assert.equal(guarded.can_advance, true);
  assert.equal(guarded.review_scheduled, true);
  assert.ok(guarded.actions.some(action => action.type === 'advance'));
});

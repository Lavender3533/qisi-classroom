import {
  buildTeacherBrief,
  buildTeacherSystemPrompt,
  buildTeacherTurnDirective,
  createFallbackLessonPlan,
  enforceStudentEvidenceSupport,
  enforceTeacherContinuationPolicy,
  enforceTeacherTurnPolicy,
  enforceTeacherVisibleMessage,
  normalizeLessonSummary,
  normalizeStudentStateUpdate,
  normalizeStudentTask,
  planTeacherContinuation,
  updateLessonProgress,
} from '../frontend/teacher-engine.js';
import { parseAIResponse } from '../frontend/teaching-protocol.js';

const baseUrl = String(process.env.TEACHER_API_BASE || '').replace(/\/+$/, '');
const apiKey = String(process.env.TEACHER_API_KEY || '');
const model = String(process.env.TEACHER_MODEL || '');
if (!baseUrl || !apiKey || !model) {
  throw new Error('缺少 TEACHER_API_BASE、TEACHER_API_KEY 或 TEACHER_MODEL');
}

const plan = createFallbackLessonPlan({
  subjectName: '初中数学',
  focus: '一元一次方程移项',
  goal: '独立解出一元一次方程，并能在改变常数项后迁移',
});
plan.title = '移项与等式性质短课';
plan.success_criteria = ['能独立解出 2x+3=11', '能在常数项改变后独立迁移'];
plan.steps[1].criterion_ids = ['criterion-1'];
plan.steps[2].criterion_ids = ['criterion-2'];

const initialProgress = {
  currentStep: 1,
  attempts: 0,
  status: 'active',
  gateVersion: 1,
  legacyThroughStep: -1,
  evidenceLedger: { records: [] },
};

async function callModel(messages) {
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: false, messages }),
      });
      if (response.ok || response.status < 500 || attempt === 3) break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  if (!response) throw lastError || new Error('模型请求失败');
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  return String(payload?.choices?.[0]?.message?.content || '');
}

function normalizeTurn(rawText, studentMessage, brief, pendingTask) {
  const parsed = parseAIResponse(rawText);
  const structured = enforceTeacherTurnPolicy(parsed.structured, studentMessage, brief, pendingTask);
  const message = enforceTeacherVisibleMessage(parsed.message, structured);
  structured.message = message;
  const update = enforceStudentEvidenceSupport(
    normalizeStudentStateUpdate(structured?.student_state_update, 0.35),
    { pendingStudentTask: pendingTask },
  );
  const nextTask = normalizeStudentTask(structured?.student_task, {
    teacherMove: structured?.teacher_move,
    checkpoint: structured?.checkpoint,
    knowledgePoint: brief.focus,
  });
  return { parsed, structured, update, nextTask, message };
}

const issues = [];
const masteryClaimPattern = /已经(?:完全|稳定)?掌握|完全掌握|稳定掌握|说明你(?:已经)?掌握/u;

const brief1 = buildTeacherBrief({
  subjectName: '初中数学', assessed: true, lessonPlan: plan, lessonProgress: initialProgress,
});
const task1 = normalizeStudentTask({
  kind: 'practice',
  prompt: '解 2x+3=11，只写 x 的值和得到 2x=8 的关键一步',
  expected_response: 'x 的值和一个等式',
  knowledge_point: '一元一次方程移项',
}, { teacherMove: 'practice', checkpoint: '解 2x+3=11' });
const student1 = 'x=4，因为等式两边同时减 3，得到 2x=8。';
const directive1 = `${buildTeacherTurnDirective({
  studentMessage: student1,
  brief: brief1,
  previousTeacherMessage: '解 2x+3=11，只写 x 的值和关键一步。',
  previousTeacherMove: 'practice',
  studentTurnCount: 2,
  pendingStudentTask: task1,
})}

为了让本次课堂评测可复现：若本轮作答正确，下一道变式固定为“解 2x+5=17，只写 x 的值”。这仍然是一个只改变常数项的新任务，不得提前给答案。`;
const messages1 = [
  { role: 'system', content: buildTeacherSystemPrompt(brief1) },
  { role: 'system', content: directive1 },
  { role: 'assistant', content: '解 2x+3=11，只写 x 的值和关键一步。' },
  { role: 'user', content: student1 },
];
const raw1 = await callModel(messages1);
const turn1 = normalizeTurn(raw1, student1, brief1, task1);
if (!turn1.update || Number(turn1.update.delta) <= 0) issues.push('第一轮没有形成可信正向证据');
if (turn1.update?.supportLevel !== 'independent') issues.push('第一轮独立作答被错误标为提示后完成');
if (masteryClaimPattern.test(turn1.message)) issues.push('同构练习后提前宣称掌握');
if (!/2x\s*\+\s*5\s*=\s*17/u.test(`${turn1.nextTask.prompt}${turn1.structured.checkpoint}`)) {
  issues.push('同构练习后没有给出约定的变式迁移题');
}

const progress1 = updateLessonProgress(plan, initialProgress, {
  teacherMove: turn1.structured.teacher_move,
  studentStateUpdate: turn1.update,
  studentTurnType: 'attempt',
  evidenceContext: {
    source: 'chat', taskKey: task1.key, taskKind: task1.kind,
    taskKnowledgePoint: task1.knowledgePoint, answer: student1, attempt: 1,
  },
});
if (progress1.currentStep !== 2) issues.push(`同构练习后的步骤应为 2，实际为 ${progress1.currentStep}`);
const snapshot1 = buildTeacherBrief({
  subjectName: '初中数学', assessed: true, lessonPlan: plan, lessonProgress: progress1,
}).masteryGate;
if (snapshot1.criteria[0]?.status !== 'verified' || snapshot1.criteria[1]?.status !== 'pending') {
  issues.push('同构练习错误地同时填满了两个达标标准');
}

const brief2 = buildTeacherBrief({
  subjectName: '初中数学', assessed: true, lessonPlan: plan, lessonProgress: progress1,
});
const task2 = normalizeStudentTask({
  ...turn1.nextTask,
  kind: 'knowledge_check',
  prompt: '解 2x+5=17，只写 x 的值',
  knowledge_point: '一元一次方程移项',
}, { teacherMove: 'question', checkpoint: '解 2x+5=17，只写 x 的值' });
const student2 = 'x=6';
const directive2 = buildTeacherTurnDirective({
  studentMessage: student2,
  brief: brief2,
  previousTeacherMessage: turn1.message,
  previousTeacherMove: turn1.structured.teacher_move,
  studentTurnCount: 3,
  pendingStudentTask: task2,
});
const messages2 = [
  { role: 'system', content: buildTeacherSystemPrompt(brief2) },
  { role: 'system', content: directive2 },
  { role: 'assistant', content: turn1.message },
  { role: 'user', content: student2 },
];
const raw2 = await callModel(messages2);
const turn2 = normalizeTurn(raw2, student2, brief2, task2);
if (!turn2.update || Number(turn2.update.delta) <= 0) issues.push('迁移轮没有形成可信正向证据');
if (turn2.update?.supportLevel !== 'independent') issues.push('无提示迁移被错误标为提示后完成');
if (turn2.nextTask.kind !== 'none') issues.push('迁移门槛通过后仍留下了额外待答任务');
if (/[?？]/u.test(turn2.message)) issues.push('迁移门槛通过后又提出了新问题');

const progress2 = updateLessonProgress(plan, progress1, {
  teacherMove: turn2.structured.teacher_move,
  studentStateUpdate: turn2.update,
  studentTurnType: 'attempt',
  evidenceContext: {
    source: 'chat', taskKey: task2.key, taskKind: task2.kind,
    taskKnowledgePoint: task2.knowledgePoint, answer: student2, attempt: 1,
  },
});
if (progress2.currentStep !== 3) issues.push(`迁移成功后应进入总结步骤，实际为 ${progress2.currentStep}`);
const brief3 = buildTeacherBrief({
  subjectName: '初中数学', assessed: true, lessonPlan: plan, lessonProgress: progress2,
});
if (!brief3.masteryGate.criteria.every(item => item.status === 'verified')) {
  issues.push('迁移成功后仍有达标标准未被证据覆盖');
}

const continuation = planTeacherContinuation({
  lessonPlan: plan,
  previousProgress: progress1,
  nextProgress: progress2,
  source: 'chat',
  evidence: {
    correct: true,
    answer: student2,
    question: task2.prompt,
    knowledgePoint: '一元一次方程移项',
    supportLevel: 'independent',
  },
});
if (continuation?.kind !== 'lesson_summary') issues.push('迁移通过后没有安排自动课堂总结');

let normalizedSummary = null;
let completedProgress = progress2;
let summaryMessage = '';
if (continuation) {
  const raw3 = await callModel([
    { role: 'system', content: buildTeacherSystemPrompt(brief3) },
    { role: 'system', content: continuation.command },
    { role: 'assistant', content: turn2.message },
  ]);
  const parsed3 = parseAIResponse(raw3);
  const structured3 = enforceTeacherContinuationPolicy(parsed3.structured, continuation.kind, brief3, turn2.nextTask);
  summaryMessage = parsed3.message;
  normalizedSummary = normalizeLessonSummary(structured3?.lesson_summary, plan, progress2);
  if (structured3?.teacher_move !== 'summary') issues.push('自动收尾没有执行 summary 教师动作');
  if (!normalizedSummary?.mastered?.length) issues.push('课堂总结没有引用账本中的独立迁移证据');
  if (!normalizedSummary?.mastered?.some(item => /x=6|x\s*=\s*6|变式/u.test(item.evidence))) {
    issues.push('课堂总结没有保留本轮真实迁移证据');
  }
  if (normalizedSummary?.mastered?.some(item => !/x=4|x\s*=\s*4|x=6|x\s*=\s*6|2x=8|变式/u.test(item.evidence))) {
    issues.push('课堂总结混入了账本之外的已证明证据');
  }
  if ((summaryMessage.match(/[?？]/g) || []).length > 0) issues.push('课堂总结又提出了新的待答问题');
  completedProgress = updateLessonProgress(plan, progress2, {
    teacherMove: structured3?.teacher_move,
    lessonSummary: normalizedSummary,
  });
  if (completedProgress.status !== 'completed') issues.push('证据齐全后课时仍未完成');
}

console.log(JSON.stringify({
  model,
  passed: issues.length === 0,
  issues,
  turns: [
    { step: 'independent_application', message: turn1.message, nextTask: turn1.nextTask.prompt },
    { step: 'independent_transfer', message: turn2.message, nextTask: turn2.nextTask.prompt },
    { step: 'lesson_summary', message: summaryMessage, mastered: normalizedSummary?.mastered || [] },
  ],
  finalStatus: completedProgress.status,
}, null, 2));
if (issues.length) process.exitCode = 1;

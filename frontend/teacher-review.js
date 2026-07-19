import { normalizeTeachingBoardUpdate } from './classroom-workspace.js';

const REVIEW_VERDICTS = new Set(['pass', 'revise']);
const REVIEW_CATEGORIES = new Set([
  'factual_error', 'logical_error', 'calculation_error', 'code_semantics_error',
  'task_invalid', 'answer_key_mismatch', 'criteria_mismatch', 'unsafe_instruction',
]);
const REVIEW_TARGETS = new Set([
  'message', 'task_prompt', 'reference_answer', 'criteria', 'visual', 'board',
]);
const TEACHER_MOVES = new Set([
  'diagnose', 'clarify', 'explain', 'model', 'question', 'hint',
  'practice', 'feedback', 'summary',
]);
const TEACHER_MOVE_ALIASES = Object.freeze({
  ask: 'question', elicit: 'question', prompt: 'question', probe: 'question', check: 'question',
  check_understanding: 'question', knowledge_check: 'question', quiz: 'question',
  teach: 'explain', instruct: 'explain', demonstrate: 'model', demo: 'model',
  correct: 'feedback', respond: 'feedback', assign: 'practice', exercise: 'practice',
});
const TASK_KINDS = new Set([
  'knowledge_check', 'practice', 'diagnostic_check', 'learning_choice', 'readiness', 'none',
]);
const PROTECTED_FIELDS = [
  'student_state_update', 'learning_diagnosis', 'lesson_summary', 'homework_update',
];

function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function boundedText(value, maximum) {
  return normalizedText(value).slice(0, maximum);
}

function boundedBlock(value, maximum) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, maximum);
}

function parseReview(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

function taskAssessment(raw, kind) {
  if (!['knowledge_check', 'practice'].includes(kind) || !raw || typeof raw !== 'object') return null;
  const referenceAnswer = boundedText(raw.reference_answer || raw.referenceAnswer, 240);
  const criteria = Array.isArray(raw.criteria)
    ? raw.criteria.map(item => boundedText(item, 160)).filter(Boolean).slice(0, 4)
    : [];
  const alternatives = raw.acceptable_alternatives || raw.acceptableAlternatives;
  const acceptableAlternatives = Array.isArray(alternatives)
    ? alternatives.map(item => boundedText(item, 160)).filter(Boolean).slice(0, 4)
    : [];
  const requestedMode = boundedText(raw.grading_mode || raw.gradingMode, 32).toLowerCase();
  const gradingMode = ['exact', 'equivalent', 'process'].includes(requestedMode)
    ? requestedMode
    : 'equivalent';
  if (!referenceAnswer || !criteria.length) return null;
  return { referenceAnswer, criteria, acceptableAlternatives, gradingMode };
}

function replacementTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = boundedText(raw.kind, 40).toLowerCase();
  if (!TASK_KINDS.has(kind)) return null;
  if (kind === 'none') {
    return {
      kind: 'none', prompt: '', expected_response: '', knowledge_point: '', assessment: null,
    };
  }
  const prompt = boundedText(raw.prompt, 180);
  const expectedResponse = boundedText(raw.expected_response || raw.expectedResponse, 100);
  const knowledgePoint = boundedText(raw.knowledge_point || raw.knowledgePoint, 100);
  if (!prompt || !expectedResponse) return null;
  const assessment = taskAssessment(raw.assessment, kind);
  if (['knowledge_check', 'practice'].includes(kind) && !assessment) return null;
  return {
    kind,
    prompt,
    expected_response: expectedResponse,
    knowledge_point: knowledgePoint,
    assessment,
  };
}

function normalizeReplacement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.structured && typeof raw.structured === 'object' ? raw.structured : raw;
  const message = boundedBlock(source.message || raw.message, 1000);
  const requestedMove = boundedText(source.teacher_move || source.teacherMove, 40).toLowerCase();
  const teacherMove = TEACHER_MOVES.has(requestedMove)
    ? requestedMove
    : TEACHER_MOVE_ALIASES[requestedMove];
  const intent = boundedText(source.intent, 120);
  const checkpoint = boundedText(source.checkpoint, 180);
  const studentTask = replacementTask(source.student_task || source.studentTask);
  if (message.length < 12 || !TEACHER_MOVES.has(teacherMove) || !intent || !checkpoint || !studentTask) {
    return null;
  }
  return {
    ...source,
    message,
    teacher_move: teacherMove,
    intent,
    checkpoint,
    student_task: studentTask,
    quick_replies: Array.isArray(source.quick_replies)
      ? source.quick_replies.map(item => boundedText(item, 40)).filter(Boolean).slice(0, 4)
      : [],
    actions: Array.isArray(source.actions) ? source.actions.slice(0, 4) : [],
    visual: source.visual && typeof source.visual === 'object' ? source.visual : null,
    board_update: source.board_update && typeof source.board_update === 'object'
      ? normalizeTeachingBoardUpdate(source.board_update)
      : null,
  };
}

function reviewTargetText(target, message, structured) {
  const task = structured?.student_task || structured?.studentTask || {};
  const assessment = task.assessment || {};
  const targets = {
    message,
    task_prompt: task.prompt,
    reference_answer: assessment.reference_answer || assessment.referenceAnswer,
    criteria: Array.isArray(assessment.criteria) ? assessment.criteria.join('；') : '',
    visual: structured?.visual ? JSON.stringify(structured.visual) : '',
    board: structured?.board_update ? JSON.stringify(structured.board_update) : '',
  };
  return normalizedText(targets[target]);
}

export function shouldReviewTeacherTurn({
  message = '', structured = null, continuationKind = '',
} = {}) {
  if (continuationKind === 'checkpoint_reminder') return false;
  const move = String(structured?.teacher_move || '').trim();
  const task = structured?.student_task || {};
  const hasScoredTask = ['knowledge_check', 'practice'].includes(task.kind)
    && task.assessment && typeof task.assessment === 'object';
  const boardUpdate = normalizeTeachingBoardUpdate(structured?.board_update);
  if (['replace', 'append'].includes(boardUpdate.mode)) return true;
  if (hasScoredTask) return true;
  if (['explain', 'model', 'hint'].includes(move)) return true;
  if (move === 'feedback' && /不正确|错误|不成立|原因|因为|应当|应该|必须|执行|等式|计算/u.test(message)) {
    return true;
  }
  if (!structured && /```|\b(?:range|for|while|def|class)\b|\d+\s*[+\-*/=<>]|[A-Za-z]\w*\s*=\s*\d/iu.test(message)) {
    return true;
  }
  return false;
}

export function unavailableTeacherReview(reason = '教学复核暂时不可用') {
  return {
    verdict: 'unavailable', confidence: 0, issues: [], replacement: null,
    trusted: false, reason: boundedText(reason, 240) || '教学复核暂时不可用',
  };
}

export function normalizeTeacherReview(raw, { message = '', structured = null } = {}) {
  const source = parseReview(raw);
  if (!source) return unavailableTeacherReview('教学复核结果不是有效 JSON');
  const verdict = boundedText(source.verdict, 32).toLowerCase();
  const confidence = Number(source.confidence);
  if (!REVIEW_VERDICTS.has(verdict) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return unavailableTeacherReview('教学复核结论或置信度无效');
  }
  const issues = [];
  if (Array.isArray(source.issues)) {
    for (const item of source.issues.slice(0, 4)) {
      const category = boundedText(item?.category, 48).toLowerCase();
      const target = boundedText(item?.target, 48).toLowerCase();
      const excerpt = boundedText(item?.excerpt, 180);
      const reason = boundedText(item?.reason, 320);
      const correction = boundedText(item?.correction, 320);
      const targetText = REVIEW_TARGETS.has(target)
        ? reviewTargetText(target, message, structured)
        : '';
      if (!REVIEW_CATEGORIES.has(category) || !targetText || !excerpt
        || !targetText.includes(excerpt) || reason.length < 6 || correction.length < 4) continue;
      issues.push({ category, target, excerpt, reason, correction });
    }
  }
  if (verdict === 'pass') {
    if (confidence < 0.72 || issues.length || (Array.isArray(source.issues) && source.issues.length)) {
      return unavailableTeacherReview('教学复核的通过结论缺少足够置信度或仍包含问题');
    }
    return { verdict, confidence, issues: [], replacement: null, trusted: true, reason: '' };
  }
  const replacement = normalizeReplacement(source.replacement);
  if (confidence < 0.75 || !issues.length || !replacement) {
    return unavailableTeacherReview('教学复核的修订结论缺少有效问题证据或完整替代回合');
  }
  if (issues.some(item => item.target === 'board')
    && !['replace', 'append', 'clear'].includes(replacement.board_update?.mode)) {
    return unavailableTeacherReview('板书问题没有提供可应用的替代板书更新');
  }
  return { verdict, confidence, issues, replacement, trusted: true, reason: '' };
}

export function applyTeacherReview({ message = '', structured = null } = {}, review = null) {
  if (!review?.trusted || review.verdict !== 'revise' || !review.replacement) {
    return { message: String(message || '').trim(), structured, revised: false };
  }
  const candidate = structured && typeof structured === 'object' ? structured : {};
  const merged = { ...candidate, ...review.replacement };
  for (const field of PROTECTED_FIELDS) {
    if (Object.hasOwn(candidate, field)) merged[field] = candidate[field];
    else delete merged[field];
  }
  merged.message = review.replacement.message;
  return { message: review.replacement.message, structured: merged, revised: true };
}

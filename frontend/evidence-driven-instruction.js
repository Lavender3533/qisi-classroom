export const EVIDENCE_STAGES = Object.freeze([
  'introduced',
  'recognized',
  'guided',
  'independent',
  'transferred',
  'retained',
]);

export const EVIDENCE_STAGE_META = Object.freeze({
  unknown: { label: '尚无证据', mastery: 0, next: '先完成一次完整讲解' },
  introduced: { label: '已经讲解', mastery: 0.18, next: '辨认关键概念' },
  recognized: { label: '能够辨认', mastery: 0.34, next: '在提示下完成' },
  guided: { label: '提示下完成', mastery: 0.5, next: '撤除提示独立完成' },
  independent: { label: '能够独立完成', mastery: 0.7, next: '更换条件完成迁移' },
  transferred: { label: '能够迁移', mastery: 0.86, next: '进入下一内容，稍后复习' },
  retained: { label: '延迟后仍会', mastery: 1, next: '按计划间隔复习' },
});

const STAGE_INDEX = new Map(EVIDENCE_STAGES.map((stage, index) => [stage, index]));
const SUCCESS_STAGES = new Set(EVIDENCE_STAGES);
const SUPPORT_LEVELS = new Set(['none', 'prompted', 'modeled', 'answer_exposed']);
const TRUSTED_SOURCES = new Set([
  'instruction_block', 'independent_verifier', 'quiz', 'retrieval_warmup',
  'programming_lab', 'lesson_ledger', 'teacher_review',
]);

function text(value, maxLength = 240) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeCanonicalKnowledgeComponent(raw = {}) {
  const subjectId = text(raw.subject_id ?? raw.subjectId, 120);
  const key = text(raw.key ?? raw.canonical_key ?? raw.canonicalKey, 160)
    .toLowerCase().replace(/[^\p{Letter}\p{Number}._:-]+/gu, '-').replace(/^-+|-+$/g, '');
  const name = text(raw.name, 100);
  if (!subjectId || !key || !name) return null;
  const list = (value, limit = 12) => Array.isArray(value)
    ? [...new Set(value.map(item => text(item, 180)).filter(Boolean))].slice(0, limit)
    : [];
  return {
    key, subjectId, name,
    description: text(raw.description, 500),
    prerequisites: list(raw.prerequisites ?? raw.prerequisite_keys),
    mentalModel: text(raw.mental_model ?? raw.mentalModel, 1200),
    boundaries: list(raw.boundaries),
    exampleSubgoals: list(raw.example_subgoals ?? raw.exampleSubgoals),
    contrasts: list(raw.contrasts),
    misconceptions: list(raw.misconceptions),
    performanceGoals: list(raw.performance_goals ?? raw.performanceGoals),
    version: Math.max(1, Math.trunc(Number(raw.version) || 1)),
  };
}

export function normalizeKnowledgeEvidenceRecord(raw = {}) {
  const stage = text(raw.stage, 32).toLowerCase();
  const canonicalKey = text(raw.canonical_key ?? raw.canonicalKey, 160);
  const subjectId = text(raw.subject_id ?? raw.subjectId, 120);
  const source = text(raw.source, 60).toLowerCase();
  const supportLevel = text(raw.support_level ?? raw.supportLevel ?? 'none', 32).toLowerCase();
  const createdAt = timestamp(raw.created_at ?? raw.createdAt);
  if (!STAGE_INDEX.has(stage) || !canonicalKey || !subjectId || !createdAt) return null;
  const correct = raw.correct === true ? true : raw.correct === false ? false : null;
  const record = {
    id: text(raw.id, 180), subjectId, canonicalKey, stage,
    taskKey: text(raw.task_key ?? raw.taskKey, 220),
    source, supportLevel: SUPPORT_LEVELS.has(supportLevel) ? supportLevel : 'none',
    correct, excerpt: text(raw.excerpt ?? raw.evidence_excerpt, 500), createdAt,
    delayHours: Math.max(0, Number(raw.delay_hours ?? raw.delayHours) || 0),
    trusted: raw.trusted === true || TRUSTED_SOURCES.has(source),
  };
  if (stage === 'introduced' && source !== 'instruction_block') record.trusted = false;
  if (['independent', 'transferred', 'retained'].includes(stage)
    && (record.supportLevel !== 'none' || correct === null || !record.taskKey)) record.trusted = false;
  return record;
}

export function evidenceRecordKey(record) {
  return record?.id || [record?.subjectId, record?.canonicalKey, record?.stage,
    record?.taskKey, record?.source, record?.createdAt].join('|');
}

export function normalizeEvidenceRecords(records = []) {
  const unique = new Map();
  for (const raw of Array.isArray(records) ? records : []) {
    const record = normalizeKnowledgeEvidenceRecord(raw);
    if (!record) continue;
    const key = evidenceRecordKey(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function deriveEvidenceStage(records = [], { retainedMinimumHours = 12 } = {}) {
  const normalized = normalizeEvidenceRecords(records);
  let highest = 'unknown';
  let firstAdvancedAt = null;
  for (const record of normalized) {
    if (!record.trusted || record.correct === false) continue;
    if (!SUCCESS_STAGES.has(record.stage)) continue;
    if (record.stage === 'retained') {
      const prior = normalized.find(item => item.trusted && item.correct === true
        && item.canonicalKey === record.canonicalKey
        && ['independent', 'transferred'].includes(item.stage)
        && item.createdAt < record.createdAt);
      const elapsed = prior ? (Date.parse(record.createdAt) - Date.parse(prior.createdAt)) / 36e5 : 0;
      if (!prior || Math.max(record.delayHours, elapsed) < retainedMinimumHours) continue;
    }
    if ((STAGE_INDEX.get(record.stage) ?? -1) > (STAGE_INDEX.get(highest) ?? -1)) {
      highest = record.stage;
      if (['independent', 'transferred'].includes(record.stage)) firstAdvancedAt ||= record.createdAt;
    }
  }
  const failures = normalized.filter(record => record.trusted && record.correct === false);
  return {
    stage: highest,
    ...EVIDENCE_STAGE_META[highest],
    canAdvance: ['transferred', 'retained'].includes(highest),
    pendingRetention: highest === 'transferred',
    failures: failures.length,
    latestFailure: failures.at(-1) || null,
    firstAdvancedAt,
    recordCount: normalized.length,
  };
}

export function projectMasteryFromEvidence(recordsOrStage, { legacyMastery = 0, confidence = 1 } = {}) {
  const stage = typeof recordsOrStage === 'string'
    ? recordsOrStage
    : deriveEvidenceStage(recordsOrStage).stage;
  if (stage === 'unknown') return Math.max(0, Math.min(1, Number(legacyMastery) || 0));
  const base = EVIDENCE_STAGE_META[stage]?.mastery ?? 0;
  const boundedConfidence = Math.max(0.6, Math.min(1, Number(confidence) || 1));
  return Math.round(base * boundedConfidence * 100) / 100;
}

export function deriveTaskEvidenceStage({
  instructionValid = false,
  studentUpdate = null,
  task = null,
  lessonPhase = '',
} = {}) {
  if (instructionValid && !studentUpdate) return 'introduced';
  if (!studentUpdate) return null;
  const supportLevel = text(studentUpdate.supportLevel ?? studentUpdate.support_level ?? 'none', 32).toLowerCase();
  const correct = Number(studentUpdate.delta ?? studentUpdate.mastery_delta) > 0;
  const supportContext = text(task?.supportContext ?? task?.support_context, 32).toLowerCase();
  const cadenceRole = text(task?.cadenceRole ?? task?.cadence_role, 40).toLowerCase();
  if (supportLevel === 'prompted' || supportContext === 'scaffolded') return 'guided';
  if (correct && supportContext === 'independent' && cadenceRole === 'transfer_check') return 'transferred';
  if (correct && String(lessonPhase).toLowerCase() === 'check') return 'transferred';
  return 'independent';
}

export function decideInstructionalAction(input = {}) {
  const intent = text(input.studentIntent, 40).toLowerCase();
  const stage = text(input.stage || 'unknown', 32).toLowerCase();
  const support = text(input.supportLevel || 'none', 32).toLowerCase();
  const difficultyCount = Math.max(0, Math.trunc(Number(input.consecutiveDifficulty) || 0));
  const correct = input.correct === true ? true : input.correct === false ? false : null;

  if (['concept_question', 'principle_question', 'clarification'].includes(intent)) {
    return { action: 'explain', closeTask: true, allowEvidenceStage: null, canAdvance: false, reason: '学生提出概念问题，暂停原任务并先讲清原理' };
  }
  if (['advance', 'skip_recheck', 'next'].includes(intent)) {
    return { action: 'advance_and_schedule_review', closeTask: true, allowEvidenceStage: null, canAdvance: true, scheduleReview: true, reason: '尊重学生主动前进意图，未验证缺口进入复习计划' };
  }
  if (correct === true && ['transferred', 'retained'].includes(stage)) {
    return { action: 'advance', closeTask: true, allowEvidenceStage: stage, canAdvance: true, reason: '迁移证据已满足，立即停止即时检查' };
  }
  if (correct === true && (stage === 'guided' || support !== 'none')) {
    return { action: 'independent_recheck', closeTask: true, allowEvidenceStage: 'guided', canAdvance: false, maxRechecks: 1, reason: '提示后完成，只安排一次新无提示检查' };
  }
  if (correct === false && difficultyCount >= 3) {
    return { action: 'check_prerequisite', closeTask: true, allowEvidenceStage: null, canAdvance: false, reason: '连续三次同类困难，检查最小前置知识' };
  }
  if (correct === false && difficultyCount === 2) {
    return { action: 'change_representation', closeTask: true, allowEvidenceStage: null, canAdvance: false, reason: '第二次同类困难，缩小任务并更换表示方式' };
  }
  if (correct === false) {
    return { action: 'correct_and_explain', closeTask: true, allowEvidenceStage: null, canAdvance: false, revealAnswer: true, reason: '第一次错误，指出关键差异并直接给出正确答案' };
  }
  if (stage === 'unknown') {
    return { action: 'teach', closeTask: true, allowEvidenceStage: 'introduced', canAdvance: false, reason: '尚无可信证据，先完成结构化讲解' };
  }
  return { action: 'collect_next_evidence', closeTask: false, allowEvidenceStage: null, canAdvance: false, reason: '按当前证据缺口选择下一活动' };
}

export function validateInstructionBlock(raw = {}, canonicalComponent = null) {
  const block = {
    priorConnection: text(raw.prior_connection ?? raw.priorConnection, 800),
    mentalModel: text(raw.mental_model ?? raw.mentalModel, 1200),
    workedExample: text(raw.worked_example ?? raw.workedExample, 1800),
    subgoals: Array.isArray(raw.subgoals) ? raw.subgoals.map(item => text(item, 240)).filter(Boolean).slice(0, 6) : [],
    contrastOrBoundary: text(raw.contrast_or_boundary ?? raw.contrastOrBoundary, 1000),
    summary: text(raw.summary, 500),
  };
  const missing = [];
  if (!block.priorConnection) missing.push('prior_connection');
  if (!block.mentalModel) missing.push('mental_model');
  if (!block.workedExample || !block.subgoals.length) missing.push('worked_example');
  if (!block.contrastOrBoundary) missing.push('contrast_or_boundary');
  if (!block.summary) missing.push('summary');
  const componentName = text(canonicalComponent?.name, 100);
  const combined = Object.values(block).flat().join(' ');
  const aligned = !componentName || combined.includes(componentName)
    || (canonicalComponent?.performanceGoals || []).some(goal => combined.includes(text(goal, 180)));
  return { valid: missing.length === 0 && aligned, block, missing, aligned, hasGradedTask: false };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const TEACHING_STRATEGY_LABELS = Object.freeze({
  direct_explanation: '直接讲解',
  worked_example: '分步示范',
  guided_question: '引导提问',
  scaffolded_hint: '分层提示',
  hands_on_practice: '动手练习',
  specific_feedback: '具体反馈',
  diagnostic_question: '诊断小题',
  contrast_cases: '对比例子',
  worked_step: '补关键步骤',
  syntax_focus: '语法聚焦',
  state_trace: '状态追踪',
  self_check: '自主核对',
  prerequisite_step: '前置回退',
  fade_hint: '逐步撤提示',
  discriminate: '区分性检查',
  alternate_representation: '换一种表示',
  prerequisite_probe: '前置知识检查',
  independent_recheck: '无提示复查',
});

const MOVE_STRATEGIES = Object.freeze({
  diagnose: 'diagnostic_question',
  clarify: 'diagnostic_question',
  explain: 'direct_explanation',
  model: 'worked_example',
  question: 'guided_question',
  hint: 'scaffolded_hint',
  practice: 'hands_on_practice',
  feedback: 'specific_feedback',
});

const PACE_LABELS = Object.freeze({
  slower: '放慢并拆成小步',
  faster: '加快讲解节奏',
  compact: '只保留当前重点',
  challenge: '提高一个挑战层级',
});

const REPRESENTATION_LABELS = Object.freeze({
  alternate: '换一种表示方式',
  worked_example: '先看一个完整例子',
  visual: '优先使用图示或表格',
});

function intervalDays(point) {
  const mastery = Number(point.mastery || 0);
  if (mastery < 0.3) return 0;
  if (mastery < 0.5) return 1;
  if (mastery < 0.7) return 3;
  if (mastery < 0.85) return 7;
  return 14;
}

function parseEventDetail(event) {
  try {
    return typeof event?.detail_json === 'string' ? JSON.parse(event.detail_json) : (event?.detail_json || {});
  } catch {
    return {};
  }
}

function normalizedPreferenceEvidence(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function deriveTeachingPreferenceSignal(studentMessage, { pendingStudentTask = null } = {}) {
  const text = normalizedPreferenceEvidence(studentMessage);
  if (!text) return null;
  const signal = { pace: null, representation: null, evidence: text, source: 'explicit' };
  if (/赶时间|只有.{0,8}分钟|只讲重点|直接讲重点/u.test(text)) signal.pace = 'compact';
  else if (/太简单|增加难度|难一点|提高难度/u.test(text)) signal.pace = 'challenge';
  else if (/太快|慢一点|一步一步|跟不上|信息太多|内容太多|太难了|拆开讲/u.test(text)) signal.pace = 'slower';
  else if (/快一点|加快|不用讲这么细/u.test(text)) signal.pace = 'faster';

  if (/换一种讲法|换个方式|换一种表示/u.test(text)) signal.representation = 'alternate';
  else if (/先看例子|完整例子|示范一遍/u.test(text)) signal.representation = 'worked_example';
  else if (/画图|图示|表格|列表对比/u.test(text)) signal.representation = 'visual';

  if (pendingStudentTask?.kind === 'learning_choice' && /^[A-DＡ-Ｄ](?:[，,。.\s]|$)/iu.test(text)) {
    const choice = text[0].normalize('NFKC').toUpperCase();
    const prompt = String(pendingStudentTask.prompt || '');
    const segment = prompt.match(new RegExp(`${choice}[.、：:\\s]*([^ABCDＡ-Ｄ]{1,60})`, 'iu'))?.[1] || text;
    if (/慢|一步|拆/u.test(segment)) signal.pace = 'slower';
    else if (/快|重点|简短/u.test(segment)) signal.pace = 'faster';
    if (/例子|示范/u.test(segment)) signal.representation = 'worked_example';
    else if (/图|表格|对比/u.test(segment)) signal.representation = 'visual';
  }
  return signal.pace || signal.representation ? signal : null;
}

export function normalizeTeachingPreferences(raw = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalizeDimension = (entry, labels) => {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(labels, entry.value)) return null;
    return {
      value: entry.value,
      label: labels[entry.value],
      evidence: normalizedPreferenceEvidence(entry.evidence),
      updatedAt: String(entry.updatedAt || entry.updated_at || '').slice(0, 40),
    };
  };
  return {
    pace: normalizeDimension(source.pace, PACE_LABELS),
    representation: normalizeDimension(source.representation, REPRESENTATION_LABELS),
  };
}

export function updateTeachingPreferences(previous = null, signal = null, recordedAt = new Date().toISOString()) {
  const next = normalizeTeachingPreferences(previous);
  if (!signal || typeof signal !== 'object') return next;
  if (Object.hasOwn(PACE_LABELS, signal.pace)) {
    next.pace = {
      value: signal.pace,
      label: PACE_LABELS[signal.pace],
      evidence: normalizedPreferenceEvidence(signal.evidence),
      updatedAt: String(recordedAt),
    };
  }
  if (Object.hasOwn(REPRESENTATION_LABELS, signal.representation)) {
    next.representation = {
      value: signal.representation,
      label: REPRESENTATION_LABELS[signal.representation],
      evidence: normalizedPreferenceEvidence(signal.evidence),
      updatedAt: String(recordedAt),
    };
  }
  return next;
}

export function deriveTeachingStrategyOutcome({
  lastTeacherMove = null,
  activeIntervention = null,
  pendingStudentTask = null,
  studentTurnType = '',
  studentStateUpdate = null,
} = {}) {
  if (!lastTeacherMove || pendingStudentTask?.evidenceScope !== 'mastery') return null;
  if (['question', 'summary_request', 'self_report', 'uncertain_attempt', 'answer_seeking', 'regulation_request', 'learning_choice', 'readiness_response', 'internal'].includes(studentTurnType)) return null;
  const strategy = String(lastTeacherMove.teachingStrategy || activeIntervention?.strategy
    || MOVE_STRATEGIES[lastTeacherMove.move] || '').trim();
  if (!strategy) return null;
  const delta = Number(studentStateUpdate?.delta ?? studentStateUpdate?.mastery_delta);
  let outcome = '';
  if (delta > 0) {
    outcome = studentStateUpdate?.supportLevel === 'prompted' || studentStateUpdate?.support_level === 'prompted'
      ? 'prompted_success' : 'independent_success';
  } else if (delta < 0 || studentTurnType === 'stuck') {
    outcome = 'difficulty';
  }
  if (!outcome) return null;
  return {
    strategy,
    label: TEACHING_STRATEGY_LABELS[strategy] || strategy,
    teacherMove: String(lastTeacherMove.move || ''),
    outcome,
    knowledgePoint: String(studentStateUpdate?.knowledgePoint || studentStateUpdate?.knowledge_point
      || pendingStudentTask.knowledgePoint || '').trim().slice(0, 100),
    evidence: String(studentStateUpdate?.evidence || '').trim().slice(0, 240),
    supportLevel: studentStateUpdate?.supportLevel || studentStateUpdate?.support_level || 'independent',
  };
}

function eventTime(event) {
  const value = new Date(event?.created_at || event?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function buildTeachingMemory(events = [], teachingPreferences = null) {
  const orderedEvents = [...events].sort((left, right) => eventTime(left) - eventTime(right));
  let preferences = { pace: null, representation: null };
  const strategyStats = new Map();
  for (const event of orderedEvents) {
    const detail = parseEventDetail(event);
    if (event.event_type === 'teaching_preference') {
      preferences = updateTeachingPreferences(preferences, detail, event.created_at || event.createdAt || '');
      continue;
    }
    if (event.event_type !== 'teacher_strategy_outcome') continue;
    const strategy = String(detail.strategy || '').trim();
    if (!strategy || !['independent_success', 'prompted_success', 'difficulty'].includes(detail.outcome)) continue;
    const current = strategyStats.get(strategy) || {
      strategy,
      label: TEACHING_STRATEGY_LABELS[strategy] || strategy,
      independentSuccesses: 0,
      promptedSuccesses: 0,
      difficulties: 0,
      knowledgePoints: new Set(),
      lastEvidence: '',
      lastObservedAt: '',
    };
    if (detail.outcome === 'independent_success') current.independentSuccesses += 1;
    else if (detail.outcome === 'prompted_success') current.promptedSuccesses += 1;
    else current.difficulties += 1;
    if (detail.knowledgePoint) current.knowledgePoints.add(String(detail.knowledgePoint));
    current.lastEvidence = String(detail.evidence || '').slice(0, 200);
    current.lastObservedAt = String(event.created_at || event.createdAt || '');
    strategyStats.set(strategy, current);
  }
  const normalizedStored = normalizeTeachingPreferences(teachingPreferences);
  preferences = {
    pace: normalizedStored.pace || preferences.pace,
    representation: normalizedStored.representation || preferences.representation,
  };
  const stats = [...strategyStats.values()].map(item => ({
    ...item,
    attempts: item.independentSuccesses + item.promptedSuccesses + item.difficulties,
    knowledgePoints: [...item.knowledgePoints].slice(0, 4),
  }));
  return {
    preferences,
    effectiveStrategies: stats
      .filter(item => item.independentSuccesses >= 1)
      .sort((a, b) => b.independentSuccesses - a.independentSuccesses || a.difficulties - b.difficulties)
      .slice(0, 3),
    avoidStrategies: stats
      .filter(item => item.difficulties >= 2 && item.independentSuccesses === 0)
      .sort((a, b) => b.difficulties - a.difficulties)
      .slice(0, 3),
  };
}

export function buildReviewQueue(knowledgePoints = [], mistakes = [], now = new Date(), events = []) {
  const nowMs = now.getTime();
  const mistakeCounts = mistakes.reduce((counts, mistake) => {
    const name = String(mistake.knowledge_point || '').trim();
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());
  const recentFailures = new Map();
  for (const event of events.slice(-30)) {
    const detail = parseEventDetail(event);
    const isFailure = detail.correct === false
      || detail.success === false
      || event.event_type === 'teacher_diagnosis';
    if (!isFailure) continue;
    let points = [];
    try { points = JSON.parse(event.knowledge_points_json || '[]'); } catch {}
    for (const name of points) {
      const key = String(name || '').trim();
      if (key) recentFailures.set(key, (recentFailures.get(key) || 0) + 1);
    }
  }

  return knowledgePoints.map(point => {
    const mastery = Math.min(1, Math.max(0, Number(point.mastery || 0)));
    const days = intervalDays(point);
    const reviewedAt = point.last_reviewed ? new Date(point.last_reviewed).getTime() : 0;
    const dueAt = reviewedAt ? reviewedAt + days * DAY_MS : nowMs;
    const remainingDays = Math.max(0, Math.ceil((dueAt - nowMs) / DAY_MS));
    const urgency = dueAt <= nowMs ? 'due' : remainingDays <= 2 ? 'soon' : 'later';
    const mistakeCount = mistakeCounts.get(point.name) || 0;
    const recentFailureCount = recentFailures.get(point.name) || 0;
    const priority = (urgency === 'due' ? 300 : urgency === 'soon' ? 200 : 100)
      + mistakeCount * 20 + recentFailureCount * 25 + Math.round((1 - mastery) * 100);
    return {
      ...point,
      mastery,
      mistakeCount,
      recentFailureCount,
      dueAt: new Date(dueAt).toISOString(),
      urgency,
      label: urgency === 'due' ? '今天复习' : remainingDays === 1 ? '明天复习' : `${remainingDays} 天后`,
      priority,
    };
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'zh-CN'));
}

export function buildLearnerProfile(
  knowledgePoints = [], mistakes = [], events = [], lastLessonSummary = null,
  now = new Date(), teachingPreferences = null,
) {
  const reviewQueue = buildReviewQueue(knowledgePoints, mistakes, now, events);
  const strengths = [...knowledgePoints]
    .filter(point => Number(point.mastery || 0) >= 0.8)
    .sort((a, b) => Number(b.mastery || 0) - Number(a.mastery || 0))
    .slice(0, 4)
    .map(point => ({ name: point.name, mastery: Number(point.mastery || 0) }));
  const priorities = reviewQueue.slice(0, 4).map(point => ({
    name: point.name,
    mastery: point.mastery,
    dueAt: point.dueAt,
    label: point.label,
    mistakeCount: point.mistakeCount,
    recentFailureCount: point.recentFailureCount,
  }));

  const patternCounts = new Map();
  for (const mistake of mistakes) {
    const pattern = String(mistake.error_type || '').trim();
    if (pattern) patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  }
  for (const event of events) {
    if (event.event_type !== 'teacher_diagnosis') continue;
    const pattern = String(parseEventDetail(event).category || '').trim();
    if (pattern) patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  }
  const practiceEvents = events.filter(event => event.event_type === 'practice_submit');
  const hintedAttempts = practiceEvents.filter(event => Number(parseEventDetail(event).hintCount || 0) > 0).length;
  const recurringPatterns = [...patternCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, count]) => ({ pattern, count }));
  if (practiceEvents.length >= 2 && hintedAttempts / practiceEvents.length >= 0.5) {
    recurringPatterns.unshift({ pattern: 'hint_dependence', count: hintedAttempts });
  }

  const summaryFocus = String(lastLessonSummary?.next_lesson_focus || '').trim();
  return {
    strengths,
    priorities,
    recurringPatterns: recurringPatterns.slice(0, 4),
    dueReviews: reviewQueue.filter(item => item.urgency === 'due').slice(0, 4),
    nextFocus: summaryFocus || priorities[0]?.name || '',
    lastLessonSummary: lastLessonSummary || null,
    teachingMemory: buildTeachingMemory(events, teachingPreferences),
  };
}

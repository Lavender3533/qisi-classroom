const BOARD_MODES = new Set(['replace', 'append', 'clear', 'keep']);
const DEDICATED_ACTIONS = new Set(['show_quiz', 'open_practice_panel']);
const SUPPORTABLE_TASKS = new Set(['knowledge_check', 'practice', 'diagnostic_check']);
const DRAFT_OBSERVABLE_TASKS = new Set(['knowledge_check', 'practice']);
const DRAFT_OBSERVATION_LIMIT = 2;
const DRAFT_OBSERVATION_COOLDOWN_MS = 30_000;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const DRAFT_OBSERVER_PREFERENCE_KEY = 'qisi.classroom.draft-observer';

function boundedText(value, maximum) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function canonicalDraft(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim().slice(0, 12_000);
}

function deriveAnswerMode(kind, expectedResponse) {
  return kind === 'practice'
    || /代码|过程|步骤|解释|推导|完整|多行|作品/u.test(expectedResponse)
    ? 'extended'
    : 'short';
}

function hasTaskAssessment(task) {
  const assessment = task?.assessment;
  if (!assessment || typeof assessment !== 'object') return false;
  const reference = boundedText(assessment.referenceAnswer || assessment.reference_answer, 240);
  const criteria = Array.isArray(assessment.criteria)
    ? assessment.criteria.map(item => boundedText(item, 160)).filter(Boolean)
    : [];
  return Boolean(reference && criteria.length);
}

function deriveTaskQuickReplies(task) {
  const stored = Array.isArray(task?.quickReplies || task?.quick_replies)
    ? (task.quickReplies || task.quick_replies).map(item => boundedText(item, 40)).filter(Boolean).slice(0, 4)
    : [];
  if (stored.length >= 2) return [...new Set(stored)];
  const expected = boundedText(task?.expectedResponse || task?.expected_response, 100);
  if (!/选|A|B|C/u.test(`${expected} ${task?.prompt || ''}`)) return [];
  const reference = boundedText(task?.assessment?.referenceAnswer || task?.assessment?.reference_answer, 40);
  if (!/^-?\d+(?:\.\d+)?$/u.test(reference)) return [];
  const answer = Number(reference);
  return [answer - 1, answer, answer + 1].map(String);
}

function deriveTaskHints(task) {
  const stored = Array.isArray(task?.hints)
    ? task.hints.map(item => String(item || '').trim().slice(0, 240)).filter(Boolean).slice(0, 3)
    : [];
  if (stored.length) return stored;
  const text = `${task?.prompt || ''} ${task?.expectedResponse || task?.expected_response || ''}`;
  if (!/(?:代码|程序|Java|Python|JavaScript|C\+\+)/iu.test(text)) return [];
  const range = text.match(/(-?\d+)\s*(?:到|至)\s*(-?\d+)/u);
  if (/Java/iu.test(text) && range) {
    return [`for (int i = ${range[1]}; i <= ${range[2]}; i++) {\n    // 在这里更新累计变量\n}`];
  }
  return ['// 先写初始化，再补充循环主体和最终输出'];
}

function hasMeaningfulDraftChange(previousValue, nextValue) {
  const previous = canonicalDraft(previousValue);
  const next = canonicalDraft(nextValue);
  if (!previous) return next.replace(/\s/g, '').length >= 6;
  if (previous === next) return false;

  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const removed = previous.slice(prefix, previous.length - suffix);
  const added = next.slice(prefix, next.length - suffix);
  if (/[+\-*/%=<>]/u.test(`${removed}${added}`)) return true;
  return `${removed}${added}`.replace(/\s/g, '').length >= 3;
}

function normalizeBoardItems(raw, maximum = 6) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  const seen = new Set();
  for (const source of raw.slice(0, 12)) {
    const value = typeof source === 'string'
      ? source
      : source?.content || source?.detail || source?.label || source?.title;
    const item = boundedText(value, 180);
    const key = item.toLocaleLowerCase('zh-CN');
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length === maximum) break;
  }
  return items;
}

function normalizeStoredBoard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const items = normalizeBoardItems(raw.items);
  if (!items.length) return null;
  return {
    lessonKey: boundedText(raw.lessonKey || raw.lesson_key, 180),
    title: boundedText(raw.title, 80) || '课堂板书',
    items,
  };
}

export function normalizeTeachingBoardUpdate(raw) {
  if (!raw || typeof raw !== 'object') return { mode: 'keep', title: '', items: [] };
  const requestedMode = boundedText(raw.mode, 24).toLowerCase();
  const mode = BOARD_MODES.has(requestedMode) ? requestedMode : 'keep';
  const title = boundedText(raw.title, 80);
  const items = normalizeBoardItems(raw.items);
  if (['replace', 'append'].includes(mode) && !items.length) {
    return { mode: 'keep', title: '', items: [] };
  }
  return { mode, title, items };
}

export function applyTeachingBoardUpdate(current, rawUpdate, { lessonKey = '' } = {}) {
  const normalizedLessonKey = boundedText(lessonKey, 180);
  const stored = normalizeStoredBoard(current);
  const base = stored && (!normalizedLessonKey || stored.lessonKey === normalizedLessonKey)
    ? stored
    : null;
  const update = normalizeTeachingBoardUpdate(rawUpdate);
  if (update.mode === 'clear') return null;
  if (update.mode === 'keep') return base;
  if (update.mode === 'replace' || !base) {
    return {
      lessonKey: normalizedLessonKey,
      title: update.title || base?.title || '课堂板书',
      items: update.items,
    };
  }

  const items = normalizeBoardItems([...base.items, ...update.items], 12);
  return {
    lessonKey: normalizedLessonKey || base.lessonKey,
    title: update.title || base.title,
    items: items.slice(-6),
  };
}

export function deriveLessonWorkspaceKey({ lessonPlan = null, brief = null } = {}) {
  const title = boundedText(lessonPlan?.title, 80);
  const focus = boundedText(lessonPlan?.focus || brief?.focus, 100);
  return [title, focus].filter(Boolean).join('｜').slice(0, 180);
}

export function deriveClassroomTaskWorkspace(task, { pendingAction = null } = {}) {
  const actionType = boundedText(pendingAction?.type, 48);
  if (DEDICATED_ACTIONS.has(actionType)) {
    return { visible: false, reason: 'dedicated-action' };
  }
  if (!task || typeof task !== 'object') return { visible: false, reason: 'no-task' };
  const kind = boundedText(task.kind, 40).toLowerCase();
  const prompt = boundedText(task.prompt, 180);
  if (!kind || kind === 'none' || !prompt) return { visible: false, reason: 'no-task' };
  const expectedResponse = boundedText(task.expectedResponse || task.expected_response, 100)
    || '一个可检查的短答案';
  const answerMode = deriveAnswerMode(kind, expectedResponse);
  return {
    visible: true,
    kind,
    label: boundedText(task.label, 40) || '当前任务',
    prompt,
    expectedResponse,
    knowledgePoint: boundedText(task.knowledgePoint || task.knowledge_point, 100),
    taskKey: boundedText(task.key, 220),
    answerMode,
    quickReplies: deriveTaskQuickReplies(task),
    hints: deriveTaskHints(task),
    originalPrompt: boundedText(task?.repairContext?.originalTask?.prompt, 180),
    allowSupportActions: SUPPORTABLE_TASKS.has(kind),
    allowDraftObservation: isDraftObservableTask(task, { pendingAction }),
  };
}

export function isCurrentTaskSubmission(task, boundTaskKey) {
  const currentKey = boundedText(task?.key, 220);
  const submittedKey = boundedText(boundTaskKey, 220);
  return Boolean(currentKey && submittedKey && currentKey === submittedKey);
}

export function isDraftObservableTask(task, { pendingAction = null } = {}) {
  if (DEDICATED_ACTIONS.has(boundedText(pendingAction?.type, 48))) return false;
  const kind = boundedText(task?.kind, 40).toLowerCase();
  const expectedResponse = boundedText(task?.expectedResponse || task?.expected_response, 100);
  return DRAFT_OBSERVABLE_TASKS.has(kind)
    && deriveAnswerMode(kind, expectedResponse) === 'extended'
    && hasTaskAssessment(task)
    && Boolean(boundedText(task?.key, 220));
}

export function draftFingerprint(value) {
  const draft = canonicalDraft(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < draft.length; index += 1) {
    hash ^= draft.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${draft.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createDraftObservationState(taskKey = '') {
  return {
    taskKey: boundedText(taskKey, 220),
    count: 0,
    lastFingerprint: '',
    lastDraft: '',
    lastObservedAt: 0,
  };
}

export function shouldObserveStudentDraft({
  task = null,
  draft = '',
  enabled = true,
  state = null,
  now = Date.now(),
  pendingAction = null,
} = {}) {
  const content = canonicalDraft(draft);
  const fingerprint = draftFingerprint(content);
  if (!enabled) return { eligible: false, reason: 'paused', fingerprint };
  if (!isDraftObservableTask(task, { pendingAction })) {
    return { eligible: false, reason: 'unsupported-task', fingerprint };
  }
  if (content.replace(/\s/g, '').length < 6) {
    return { eligible: false, reason: 'too-short', fingerprint };
  }
  const currentTaskKey = boundedText(task?.key, 220);
  const sameTask = boundedText(state?.taskKey, 220) === currentTaskKey;
  const count = sameTask ? Math.max(0, Number(state?.count) || 0) : 0;
  const lastFingerprint = sameTask ? boundedText(state?.lastFingerprint, 80) : '';
  const lastDraft = sameTask ? canonicalDraft(state?.lastDraft) : '';
  const lastObservedAt = sameTask ? Math.max(0, Number(state?.lastObservedAt) || 0) : 0;
  if (count >= DRAFT_OBSERVATION_LIMIT) return { eligible: false, reason: 'limit', fingerprint };
  if (lastFingerprint === fingerprint) return { eligible: false, reason: 'same-draft', fingerprint };
  if (!hasMeaningfulDraftChange(lastDraft, content)) {
    return { eligible: false, reason: 'minor-change', fingerprint };
  }
  const timestamp = Number(now);
  if (lastObservedAt && Number.isFinite(timestamp)
    && timestamp - lastObservedAt < DRAFT_OBSERVATION_COOLDOWN_MS) {
    return { eligible: false, reason: 'cooldown', fingerprint };
  }
  return { eligible: true, reason: 'ready', fingerprint };
}

export function isDraftObservationSnapshotCurrent(snapshot, {
  task = null,
  draft = '',
  enabled = true,
  requestId = 0,
} = {}) {
  if (!enabled || !snapshot) return false;
  const currentDraft = canonicalDraft(draft);
  return boundedText(snapshot.taskKey, 220) === boundedText(task?.key, 220)
    && Number(snapshot.requestId) === Number(requestId)
    && canonicalDraft(snapshot.draft) === currentDraft
    && boundedText(snapshot.fingerprint, 80) === draftFingerprint(currentDraft);
}

function safeDraftFeedbackText(value, maximum) {
  const text = boundedText(value, maximum);
  if (/参考答案|标准答案|评分标准|reference[_ ]?answer|assessment|criteria/iu.test(text)) return '';
  return text;
}

export function deriveDraftCoachingFeedback(verification) {
  if (!verification || typeof verification !== 'object') return null;
  if (verification.verdict === 'correct' && verification.trusted) {
    return {
      tone: 'on-track',
      title: '这一步目前成立',
      message: '当前草稿能通过临时核对。确认已经完整回答题目后再提交。',
    };
  }
  if (verification.verdict === 'insufficient') {
    return {
      tone: 'continue',
      title: '继续写下一步',
      message: '老师看到了当前草稿，但信息还不足以判断。继续写出下一步或结论。',
    };
  }
  if (verification.verdict !== 'incorrect' || !verification.trusted
    || !verification.diagnosisTrusted) return null;
  const verifiedPart = safeDraftFeedbackText(verification.verifiedPartExcerpt, 120);
  const firstError = safeDraftFeedbackText(verification.firstErrorExcerpt, 120);
  const correctionFocus = safeDraftFeedbackText(verification.correctionFocus, 220);
  if (!firstError || correctionFocus.length < 6) return null;
  return {
    tone: 'check',
    title: '先检查这一处',
    message: `${verifiedPart ? `前面的“${verifiedPart}”仍成立。` : ''}先检查“${firstError}”：${correctionFocus}`,
  };
}

export function taskDraftStorageKey(subjectId) {
  return `qisi.classroom.task-draft:${encodeURIComponent(String(subjectId ?? '').normalize('NFC'))}`;
}

export function serializeTaskDraft({ taskKey = '', content = '', updatedAt = Date.now() } = {}) {
  return JSON.stringify({
    taskKey: boundedText(taskKey, 220),
    content: canonicalDraft(content),
    updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : Date.now(),
  });
}

export function restoreTaskDraft(raw, {
  taskKey = '',
  now = Date.now(),
  maxAgeMs = DRAFT_MAX_AGE_MS,
} = {}) {
  let source = raw;
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw); } catch { return ''; }
  }
  if (!source || typeof source !== 'object') return '';
  const expectedKey = boundedText(taskKey, 220);
  if (!expectedKey || boundedText(source.taskKey, 220) !== expectedKey) return '';
  const updatedAt = Number(source.updatedAt);
  const currentTime = Number(now);
  if (!Number.isFinite(updatedAt) || !Number.isFinite(currentTime)
    || updatedAt > currentTime + 60_000 || currentTime - updatedAt > Number(maxAgeMs)) return '';
  return canonicalDraft(source.content);
}

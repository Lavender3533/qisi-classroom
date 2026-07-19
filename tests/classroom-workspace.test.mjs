import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTeachingBoardUpdate,
  createDraftObservationState,
  deriveDraftCoachingFeedback,
  deriveClassroomTaskWorkspace,
  deriveLessonWorkspaceKey,
  draftFingerprint,
  isDraftObservationSnapshotCurrent,
  isCurrentTaskSubmission,
  isDraftObservableTask,
  normalizeTeachingBoardUpdate,
  restoreTaskDraft,
  serializeTaskDraft,
  shouldObserveStudentDraft,
} from '../frontend/classroom-workspace.js';

test('teaching board updates are bounded, deduplicated, and isolated by lesson', () => {
  const first = applyTeachingBoardUpdate(null, {
    mode: 'replace',
    title: '等式性质',
    items: ['两边同时减 3', '保持等号成立', '两边同时减 3'],
  }, { lessonKey: 'lesson-equation' });
  assert.deepEqual(first, {
    lessonKey: 'lesson-equation',
    title: '等式性质',
    items: ['两边同时减 3', '保持等号成立'],
  });

  const appended = applyTeachingBoardUpdate(first, {
    mode: 'append', title: '', items: ['得到 2x=8', '两边同时除以 2'],
  }, { lessonKey: 'lesson-equation' });
  assert.deepEqual(appended.items, ['两边同时减 3', '保持等号成立', '得到 2x=8', '两边同时除以 2']);

  const fullBoard = {
    lessonKey: 'lesson-equation', title: '完整板书',
    items: ['要点1', '要点2', '要点3', '要点4', '要点5', '要点6'],
  };
  const refreshed = applyTeachingBoardUpdate(fullBoard, {
    mode: 'append', items: ['最新纠错'],
  }, { lessonKey: 'lesson-equation' });
  assert.deepEqual(refreshed.items, ['要点2', '要点3', '要点4', '要点5', '要点6', '最新纠错']);

  assert.equal(applyTeachingBoardUpdate(appended, { mode: 'keep' }, { lessonKey: 'lesson-loop' }), null);
  assert.equal(applyTeachingBoardUpdate(appended, { mode: 'clear' }, { lessonKey: 'lesson-equation' }), null);
});

test('invalid board updates keep the current reviewed board', () => {
  const current = { lessonKey: 'lesson-a', title: '当前板书', items: ['有效内容'] };
  assert.deepEqual(normalizeTeachingBoardUpdate({ mode: 'replace', items: [] }), { mode: 'keep', title: '', items: [] });
  assert.deepEqual(applyTeachingBoardUpdate(current, { mode: 'replace', items: [] }, { lessonKey: 'lesson-a' }), current);
});

test('classroom task workspace exposes only student-facing task data', () => {
  const task = {
    kind: 'knowledge_check', label: '理解检查', prompt: '解 2x+3=11，只写 x 的值',
    expectedResponse: '一个数值', knowledgePoint: '一元一次方程', key: 'task-equation',
    assessment: { referenceAnswer: 'x=4', criteria: ['结果为4'] },
  };
  const workspace = deriveClassroomTaskWorkspace(task);

  assert.equal(workspace.visible, true);
  assert.equal(workspace.taskKey, 'task-equation');
  assert.equal(workspace.prompt, task.prompt);
  assert.equal(workspace.expectedResponse, '一个数值');
  assert.equal(workspace.answerMode, 'short');
  assert.equal(workspace.allowSupportActions, true);
  assert.equal(Object.hasOwn(workspace, 'assessment'), false);
  assert.doesNotMatch(JSON.stringify(workspace), /x=4|结果为4/);
});

test('dedicated exercise panels suppress the generic task editor', () => {
  const task = { kind: 'practice', prompt: '补全代码', expectedResponse: '一段代码', key: 'code-task' };
  assert.equal(deriveClassroomTaskWorkspace(task, {
    pendingAction: { type: 'open_practice_panel' },
  }).visible, false);
  assert.equal(deriveClassroomTaskWorkspace(task, {
    pendingAction: { type: 'show_quiz' },
  }).visible, false);
});

test('restored tasks keep choices and conservatively rebuild legacy numeric options', () => {
  const stored = deriveClassroomTaskWorkspace({
    kind: 'knowledge_check', prompt: 'x++ 后是多少？', expectedResponse: '选择一个', key: 'choice-stored',
    quickReplies: ['2', '3', '4'], assessment: { referenceAnswer: '3', criteria: ['结果正确'] },
  });
  assert.deepEqual(stored.quickReplies, ['2', '3', '4']);

  const legacy = deriveClassroomTaskWorkspace({
    kind: 'knowledge_check', prompt: 'x++ 后是多少，选一个？', expectedResponse: '选择最终值', key: 'choice-legacy',
    assessment: { referenceAnswer: '3', criteria: ['结果正确'] },
  });
  assert.deepEqual(legacy.quickReplies, ['2', '3', '4']);
});

test('code tasks expose prepared ghost hints without returning the answer key', () => {
  const workspace = deriveClassroomTaskWorkspace({
    kind: 'practice', prompt: '独立写 Java 代码，将 3 到 7 的整数累加到 sum',
    expectedResponse: '一段 Java 代码', key: 'java-loop',
    assessment: { referenceAnswer: 'sum=25', criteria: ['循环边界正确'] },
  });
  assert.match(workspace.hints[0], /for \(int i = 3; i <= 7; i\+\+\)/);
  assert.doesNotMatch(JSON.stringify(workspace), /sum=25|循环边界正确/);
});

test('task submissions require the exact current task key', () => {
  const task = { kind: 'diagnostic_check', prompt: '选择卡点', key: 'current-task' };
  assert.equal(isCurrentTaskSubmission(task, 'current-task'), true);
  assert.equal(isCurrentTaskSubmission(task, 'old-task'), false);
  assert.equal(isCurrentTaskSubmission(null, 'current-task'), false);
});

test('lesson workspace key follows the actual lesson instead of UI phase', () => {
  const key = deriveLessonWorkspaceKey({
    lessonPlan: { title: '移项短课', focus: '一元一次方程移项' },
    brief: { phase: 'practice', focus: '另一个显示重点' },
  });
  assert.match(key, /移项短课/);
  assert.match(key, /一元一次方程移项/);
  assert.doesNotMatch(key, /practice/);
});

test('draft observation is limited to scored process tasks', () => {
  const processTask = {
    kind: 'knowledge_check', prompt: '写出完整推导过程', expectedResponse: '两行推导过程',
    key: 'process-task', assessment: { referenceAnswer: 'x=4', criteria: ['过程等价'] },
  };
  assert.equal(isDraftObservableTask(processTask), true);
  assert.equal(isDraftObservableTask({ ...processTask, expectedResponse: '一个数值' }), false);
  assert.equal(isDraftObservableTask({ ...processTask, assessment: null }), false);
  assert.equal(isDraftObservableTask(processTask, {
    pendingAction: { type: 'show_quiz' },
  }), false);

  const workspace = deriveClassroomTaskWorkspace(processTask);
  assert.equal(workspace.allowDraftObservation, true);
  assert.equal(Object.hasOwn(workspace, 'assessment'), false);
  assert.doesNotMatch(JSON.stringify(workspace), /x=4|过程等价/);
});

test('draft observation deduplicates, cools down, and caps each task', () => {
  const task = {
    kind: 'practice', prompt: '解方程并写出每一步', expectedResponse: '完整步骤和结论',
    key: 'task-equation-process', assessment: { referenceAnswer: 'x=4', criteria: ['步骤成立'] },
  };
  const draft = '2x+3=11\n2x=11-3';
  const initial = createDraftObservationState(task.key);
  const first = shouldObserveStudentDraft({ task, draft, state: initial, now: 100_000 });
  assert.equal(first.eligible, true);

  const observed = {
    ...initial,
    count: 1,
    lastFingerprint: first.fingerprint,
    lastDraft: draft,
    lastObservedAt: 100_000,
  };
  assert.equal(shouldObserveStudentDraft({ task, draft, state: observed, now: 140_000 }).reason, 'same-draft');
  assert.equal(shouldObserveStudentDraft({
    task, draft: `${draft}\nx=4`, state: observed, now: 110_000,
  }).reason, 'cooldown');
  assert.equal(shouldObserveStudentDraft({
    task, draft: `${draft}\nx=4`, state: { ...observed, count: 2 }, now: 140_000,
  }).reason, 'limit');
  assert.equal(shouldObserveStudentDraft({
    task, draft: `${draft}\nx=4`, state: observed, now: 140_000, enabled: false,
  }).reason, 'paused');
});

test('draft observation results require the exact request snapshot', () => {
  const task = { kind: 'practice', key: 'current-task' };
  const draft = 'sum = 0\nfor i in range(5):';
  const snapshot = {
    taskKey: task.key,
    draft,
    fingerprint: draftFingerprint(draft),
    requestId: 3,
  };
  assert.equal(isDraftObservationSnapshotCurrent(snapshot, {
    task, draft, enabled: true, requestId: 3,
  }), true);
  assert.equal(isDraftObservationSnapshotCurrent(snapshot, {
    task: { ...task, key: 'new-task' }, draft, enabled: true, requestId: 3,
  }), false);
  assert.equal(isDraftObservationSnapshotCurrent(snapshot, {
    task, draft: `${draft}\n    pass`, enabled: true, requestId: 3,
  }), false);
  assert.equal(isDraftObservationSnapshotCurrent(snapshot, {
    task, draft, enabled: false, requestId: 3,
  }), false);
});

test('draft coaching feedback stays provisional and does not expose answer keys', () => {
  const correction = deriveDraftCoachingFeedback({
    verdict: 'incorrect', trusted: true, diagnosisTrusted: true,
    verifiedPartExcerpt: '2x+3=11', firstErrorExcerpt: '2x=11+3',
    correctionFocus: '等式两边同时减 3，先消去左边的加数。',
    feedback: '隐藏参考答案是 x=4',
  });
  assert.equal(correction.tone, 'check');
  assert.match(correction.message, /2x=11\+3/);
  assert.match(correction.message, /等式两边同时减 3/);
  assert.doesNotMatch(JSON.stringify(correction), /x=4|隐藏参考答案/);

  const onTrack = deriveDraftCoachingFeedback({ verdict: 'correct', trusted: true });
  assert.match(onTrack.message, /当前草稿|完整回答|提交/);
  assert.doesNotMatch(onTrack.message, /正式正确|已经掌握/);
  assert.equal(deriveDraftCoachingFeedback({ verdict: 'invalid_task', trusted: false }), null);
});

test('task drafts restore only for the exact unexpired task', () => {
  const saved = serializeTaskDraft({
    taskKey: 'task-a', content: '第一步\n第二步', updatedAt: 1_000,
  });
  assert.equal(restoreTaskDraft(saved, { taskKey: 'task-a', now: 2_000 }), '第一步\n第二步');
  assert.equal(restoreTaskDraft(saved, { taskKey: 'task-b', now: 2_000 }), '');
  assert.equal(restoreTaskDraft(saved, {
    taskKey: 'task-a', now: 1_000 + (8 * 24 * 60 * 60 * 1000),
  }), '');
  assert.equal(restoreTaskDraft('{not-json', { taskKey: 'task-a', now: 2_000 }), '');
});

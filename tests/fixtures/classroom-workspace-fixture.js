import {
  applyTeachingBoardUpdate,
  deriveDraftCoachingFeedback,
  deriveClassroomTaskWorkspace,
  isCurrentTaskSubmission,
  restoreTaskDraft,
  serializeTaskDraft,
} from '/frontend/classroom-workspace.js';

const board = applyTeachingBoardUpdate(null, {
  mode: 'replace', title: '等式性质',
  items: ['目标：消去等式一边的加数', '操作：等式两边执行相同运算', '不变量：等号两边仍然相等', '检验：变形后应能还原到原等式'],
}, { lessonKey: 'fixture-equation' });
const task = {
  kind: 'knowledge_check', label: '过程练习', prompt: '解 2x+3=11。请写出每一步等价变形，并在最后单独写出 x 的值。',
  expectedResponse: '至少两行推导过程和最终结论', knowledgePoint: '一元一次方程移项', key: 'fixture-task-current',
  assessment: { referenceAnswer: 'x=4', criteria: ['每一步保持等式成立', '最终结果为4'] },
};
const taskView = deriveClassroomTaskWorkspace(task);
const fixtureParams = new URLSearchParams(location.search);
if (fixtureParams.has('dark')) document.documentElement.setAttribute('data-theme', 'dark');
const currentTask = fixtureParams.has('stale')
  ? { ...task, key: 'fixture-task-new' }
  : task;

document.getElementById('classroomBoardTitle').textContent = board.title;
const boardItems = document.getElementById('classroomBoardItems');
board.items.forEach((item, index) => {
  const row = document.createElement('div');
  row.className = 'classroom-board-item';
  row.innerHTML = `<span aria-hidden="true">${index + 1}</span><span></span>`;
  row.lastElementChild.textContent = item;
  boardItems.appendChild(row);
});

document.getElementById('taskWorkspace').dataset.taskKey = taskView.taskKey;
document.getElementById('taskWorkspace').dataset.answerMode = taskView.answerMode;
document.getElementById('taskWorkspace').dataset.editorType = 'code';
document.getElementById('taskLabel').textContent = taskView.label;
document.getElementById('taskKnowledgePoint').textContent = taskView.knowledgePoint;
document.getElementById('taskExpected').textContent = `回答格式：${taskView.expectedResponse}`;
document.getElementById('taskPrompt').textContent = taskView.prompt;
document.getElementById('messages').classList.add('has-active-task');
document.getElementById('taskWorkspace').closest('.composer-shell').classList.add('has-active-task');
document.getElementById('taskWorkspace').closest('.composer-shell').dataset.taskEditor = 'code';

const answer = document.getElementById('taskAnswer');
const status = document.getElementById('taskStatus');
const observerToggle = document.getElementById('taskObserverToggle');
const coach = document.getElementById('draftCoach');
const draftStorageKey = 'qisi.fixture.task-draft';
let observationTimer = null;

function showCoach(feedback) {
  coach.className = `draft-coach is-${feedback.tone}`;
  document.getElementById('draftCoachTitle').textContent = feedback.title;
  document.getElementById('draftCoachMessage').textContent = feedback.message;
  coach.hidden = false;
}

answer.value = restoreTaskDraft(localStorage.getItem(draftStorageKey), { taskKey: taskView.taskKey });
if (fixtureParams.has('coach')) {
  answer.value = '2x+3=11\n2x=11+3';
  showCoach(deriveDraftCoachingFeedback({
    verdict: 'incorrect', trusted: true, diagnosisTrusted: true,
    verifiedPartExcerpt: '2x+3=11', firstErrorExcerpt: '2x=11+3',
    correctionFocus: '等式两边应执行相同运算；要消去 +3，应先检查这里使用的运算。',
  }));
  status.textContent = '草稿已保存 · 老师给了一步临时反馈';
}
if (fixtureParams.has('paused')) {
  observerToggle.checked = false;
  status.textContent = '草稿自动保存 · 老师观察已暂停';
}

answer.addEventListener('input', () => {
  localStorage.setItem(draftStorageKey, serializeTaskDraft({ taskKey: taskView.taskKey, content: answer.value }));
  coach.hidden = true;
  status.textContent = '草稿已保存 · 老师观察中';
  if (observationTimer) clearTimeout(observationTimer);
  if (!observerToggle.checked || answer.value.trim().length < 6) return;
  observationTimer = setTimeout(() => {
    showCoach(deriveDraftCoachingFeedback({ verdict: 'insufficient', trusted: false }));
    status.textContent = '草稿已保存 · 老师给了一步临时反馈';
  }, 500);
});
observerToggle.addEventListener('change', () => {
  coach.hidden = true;
  status.textContent = observerToggle.checked
    ? '草稿自动保存 · 老师观察中'
    : '草稿自动保存 · 老师观察已暂停';
});
document.getElementById('draftCoachDismiss').addEventListener('click', () => { coach.hidden = true; });
const submit = () => {
  if (!answer.value.trim()) {
    status.textContent = '请先写下你的答案';
    return;
  }
  if (!isCurrentTaskSubmission(currentTask, taskView.taskKey)) {
    status.textContent = '老师已经更新了任务，请按当前任务重新作答';
    return;
  }
  status.textContent = '已提交，老师正在阅读';
  answer.disabled = true;
  document.getElementById('taskSubmit').disabled = true;
};
document.getElementById('taskSubmit').addEventListener('click', submit);
document.getElementById('quickReplies').addEventListener('click', event => {
  const button = event.target.closest('[data-answer]');
  if (!button) return;
  answer.value = button.dataset.answer;
  answer.dispatchEvent(new Event('input', { bubbles: true }));
});
document.getElementById('taskHint').addEventListener('click', () => { status.textContent = '已向老师请求一个方向性提示'; });
document.getElementById('taskAlternate').addEventListener('click', () => { status.textContent = '已请老师换一种表示方式'; });
const composerInput = document.getElementById('input');
const composerHint = document.getElementById('composerHint');
document.getElementById('send').addEventListener('click', () => {
  if (!composerInput.value.trim()) return;
  composerHint.textContent = '已发送给老师';
  composerInput.disabled = true;
  document.getElementById('send').disabled = true;
});

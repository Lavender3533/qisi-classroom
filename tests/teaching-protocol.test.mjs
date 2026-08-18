import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SAFE_TEACHER_RESPONSE_FALLBACK,
  parseAIResponse,
  promoteAssessmentTab,
  reconcileChatHistory,
  validateAssessmentPayload,
} from '../frontend/teaching-protocol.js';

test('parseAIResponse removes fenced structured JSON from the visible message', () => {
  const raw = '先理解变量的含义。\n```json\n{"state":"explain","message":"变量像盒子","visual":null,"actions":[]}\n```';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '先理解变量的含义。');
  assert.equal(result.structured.state, 'explain');
});

test('parseAIResponse uses structured.message for a bare JSON reply', () => {
  const raw = '{"state":"quiz","message":"来做一道小测","visual":null,"actions":[]}';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '来做一道小测');
  assert.equal(result.structured.state, 'quiz');
});

test('parseAIResponse hides a real model bare JSON response with extended fields', () => {
  const raw = '{"state":"check","message":"你用 3²=9 找到了一个解。请算一算 (-3)²。","visual":null,"actions":[],"student_state_update":{"knowledge_point":"一元二次方程的负数解","mastery_delta":-0.05,"confidence":0.95,"evidence":"学生遗漏了负数解。"}}';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '你用 3²=9 找到了一个解。请算一算 (-3)²。');
  assert.equal(result.structured.state, 'check');
  assert.equal(result.structured.student_state_update.mastery_delta, -0.05);
});

test('parseAIResponse keeps invalid JSON as normal text', () => {
  const raw = '普通老师回复，不含结构化内容';
  const result = parseAIResponse(raw);
  assert.equal(result.message, raw);
  assert.equal(result.structured, null);
});

test('parseAIResponse extracts a balanced teacher turn with surrounding text', () => {
  const raw = '老师已完成检查。\n{"state":"check","message":"只写出 sum 的值。","teacher_move":"question","student_task":{"kind":"knowledge_check","prompt":"sum 是多少？"}}';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '老师已完成检查。');
  assert.equal(result.structured.message, '只写出 sum 的值。');
  assert.equal(result.structured.student_task.kind, 'knowledge_check');
  assert.equal(result.unsafe, false);
});

test('parseAIResponse repairs only bounded JSON punctuation errors', () => {
  const trailingComma = parseAIResponse('{"state":"check","message":"写出结果","quick_replies":["3",],}');
  assert.equal(trailingComma.message, '写出结果');
  assert.deepEqual(trailingComma.structured.quick_replies, ['3']);

  const smartKey = parseAIResponse('{“state”:"check",“message”:"写出结果",“teacher_move”:"question"}');
  assert.equal(smartKey.message, '写出结果');
  assert.equal(smartKey.structured.teacher_move, 'question');
});

test('parseAIResponse never exposes malformed internal teacher protocol', () => {
  const raw = '{"message":"先算一步","teacher_move":"question","student_task":BROKEN}';
  const result = parseAIResponse(raw);
  assert.equal(result.unsafe, true);
  assert.equal(result.structured, null);
  assert.equal(result.message, SAFE_TEACHER_RESPONSE_FALLBACK);
  assert.doesNotMatch(result.message, /teacher_move|student_task|BROKEN/);
});

test('parseAIResponse keeps braces inside JSON message strings', () => {
  const raw = '{"state":"practice","message":"补全代码块 { return x; }","teacher_move":"practice"}';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '补全代码块 { return x; }');
  assert.equal(result.structured.teacher_move, 'practice');
});

test('validateAssessmentPayload rejects an empty or malformed question set', () => {
  assert.equal(validateAssessmentPayload({ questions: [] }).valid, false);
  assert.equal(validateAssessmentPayload({ questions: [{ type: 'choice', question: '' }] }).valid, false);
  assert.equal(validateAssessmentPayload({ questions: [{ id: 1, type: 'choice', question: '1+1?', options: ['1', '2'], answer: 1, knowledge_point: '加法', difficulty: 1 }] }).valid, true);
});

test('promoteAssessmentTab moves a completed assessment into a real chat tab', () => {
  const state = {
    subjects: [{ id: 'sub_1', name: '编程基础', assessed: true }],
    tabs: [{ id: 'assess-sub_1', title: '编程基础 · 摸底', type: 'assess' }],
    activeTab: 'assess-sub_1',
  };

  assert.equal(promoteAssessmentTab(state, 'sub_1'), true);
  assert.deepEqual(state.tabs[0], { id: 'chat-sub_1', title: '编程基础', type: 'chat' });
  assert.equal(state.activeTab, 'chat-sub_1');
});

test('reconcileChatHistory restores persisted turns and keeps only a real unsaved tail', () => {
  const result = reconcileChatHistory({
    systemMessage: 'system',
    persistedMessages: [
      ['assistant', '先完成第一题'],
      ['user', '3'],
      ['assistant', '答案正确'],
    ],
    memoryHistory: [
      { role: 'assistant', content: '先完成第一题' },
      { role: 'user', content: '3' },
      { role: 'assistant', content: '答案正确' },
      { role: 'user', content: '为什么？' },
    ],
  });
  assert.deepEqual(result, [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: '先完成第一题' },
    { role: 'user', content: '3' },
    { role: 'assistant', content: '答案正确' },
    { role: 'user', content: '为什么？' },
  ]);
});

test('reconcileChatHistory prefers a longer persisted conversation over stale memory', () => {
  const result = reconcileChatHistory({
    systemMessage: 'new system',
    persistedMessages: [
      { role: 'assistant', content: '问题' },
      { role: 'user', content: '14' },
      { role: 'assistant', content: '课堂总结' },
    ],
    memoryHistory: [{ role: 'assistant', content: '问题' }],
  });
  assert.equal(result.length, 4);
  assert.equal(result[3].content, '课堂总结');
});

test('parseAIResponse strips leaked model safety wrappers before parsing', () => {
  const raw = '<ds_safety>用户消息是课堂对话中的数学教学内容，不涉及政治敏感内容。</ds_safety>{"state":"explain","message":"去括号时括号前是负号才变号","visual":null,"actions":[]}';
  const result = parseAIResponse(raw);
  assert.equal(result.message, '去括号时括号前是负号才变号');
  assert.equal(result.structured.state, 'explain');
});

test('parseAIResponse treats a safety-verdict-only reply as empty', () => {
  const result = parseAIResponse('.vrtx <ds_safety>正常教学交流。</ds_safety>Safe');
  assert.equal(result.message, '');
  assert.equal(result.structured, null);
});

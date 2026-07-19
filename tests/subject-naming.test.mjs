import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubjectNamingMessages,
  getDisplaySubjectName,
  normalizeSubjectCategory,
  parseSubjectNamingResponse,
  sanitizeLegacySubjectMessage,
  validateSubjectName,
} from '../frontend/subject-naming.js';

test('subject names reject numeric and placeholder input', () => {
  assert.equal(validateSubjectName('1').valid, false);
  assert.equal(validateSubjectName('课程').valid, false);
  assert.equal(validateSubjectName('Python 入门').valid, true);
  assert.equal(validateSubjectName('C').valid, true);
});

test('invalid historical names use a neutral display name', () => {
  assert.equal(getDisplaySubjectName('1'), '待命名课程');
  assert.equal(getDisplaySubjectName('线性代数'), '线性代数');
});

test('AI naming response must contain a valid semantic name', () => {
  assert.equal(parseSubjectNamingResponse('{"name":"1"}').valid, false);
  assert.deepEqual(parseSubjectNamingResponse('{"name":"基础数学与方程","description":"从数的概念学习一元一次方程","category":"math"}'), {
    valid: true,
    name: '基础数学与方程',
    description: '从数的概念学习一元一次方程',
    category: 'math',
  });
  assert.match(buildSubjectNamingMessages('想学方程', 'math')[0].content, /无法确定学习对象.*不得猜测/);
});

test('naming does not confuse a subject icon with an academic category', () => {
  assert.equal(normalizeSubjectCategory('book'), 'other');
  assert.equal(normalizeSubjectCategory('programming'), 'programming');
  const messages = buildSubjectNamingMessages('java', 'book');
  assert.match(messages[0].content, /Java.*本身已经足够/);
  assert.match(messages[1].content, /学习方向：java\n领域：other/);
  assert.doesNotMatch(messages[1].content, /领域：book/);
});

test('legacy assistant messages hide invalid historical subject names', () => {
  assert.equal(
    sanitizeLegacySubjectMessage('你好，我是你的1老师。', '1'),
    '你好，我是你的课程老师。',
  );
  assert.equal(
    sanitizeLegacySubjectMessage('你知道“1”主要用来做什么吗？', '1'),
    '你知道“这门课程”主要用来做什么吗？',
  );
  assert.equal(
    sanitizeLegacySubjectMessage('第1题还没做完。', '1'),
    '第1题还没做完。',
  );
  assert.equal(
    sanitizeLegacySubjectMessage('我是你的1老师，你知道“1”是什么吗？', 'Java基础编程'),
    '我是你的课程老师，你知道“这门课程”是什么吗？',
  );
  assert.equal(
    sanitizeLegacySubjectMessage('我创建了一个叫“1”的课程。', '1', 'user'),
    '我创建了一个叫“1”的课程。',
  );
});

test('legacy subject cleanup preserves structured numeric answers', () => {
  const raw = JSON.stringify({
    state: 'check',
    message: '你知道“1”是什么吗？',
    quick_replies: ['1', '3', '需要提示'],
    student_task: {
      prompt: '执行 sum += 2 后，sum 是多少？',
      assessment: { reference_answer: '3', acceptable_alternatives: ['sum=3'] },
    },
  });
  const cleaned = sanitizeLegacySubjectMessage(raw, '1');
  const parsed = JSON.parse(cleaned);

  assert.equal(parsed.message, '你知道“这门课程”是什么吗？');
  assert.deepEqual(parsed.quick_replies, ['1', '3', '需要提示']);
  assert.equal(parsed.student_task.assessment.reference_answer, '3');
  assert.deepEqual(parsed.student_task.assessment.acceptable_alternatives, ['sum=3']);
});

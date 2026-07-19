import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEACHER_VOICE_MODES,
  createTeacherVoice,
  isTeacherVoiceAutoplayBlocked,
  normalizeTeacherVoiceRate,
  readTeacherVoiceSettings,
  selectChineseVoice,
  shouldAutoSpeakTeacherMessage,
  splitTeacherSpeechText,
  toTeacherSpeechText,
  writeTeacherVoiceSettings,
} from '../frontend/teacher-voice.js';

test('toTeacherSpeechText removes markdown noise and does not spell code blocks', () => {
  const source = `## 循环累加\n\n请观察 **sum** 的变化。\n\n\`sum\` 保存当前结果。\n\n\`\`\`python\nsum += i\n\`\`\`\n\n[查看讲义](https://example.com)`;
  const spoken = toTeacherSpeechText(source);

  assert.match(spoken, /循环累加/);
  assert.match(spoken, /sum 保存当前结果/);
  assert.match(spoken, /这里有一段代码，请看屏幕/);
  assert.match(spoken, /查看讲义/);
  assert.doesNotMatch(spoken, /sum \+= i|https:\/\//);
});

test('splitTeacherSpeechText preserves order and limits long chunks', () => {
  const source = `第一句讲清目标。${'这一段需要继续解释，'.repeat(20)}最后检查理解。`;
  const chunks = splitTeacherSpeechText(source, 60);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(chunk => chunk.length <= 60));
  assert.match(chunks[0], /^第一句讲清目标/);
  assert.match(chunks.at(-1), /最后检查理解/);
});

test('selectChineseVoice prefers local simplified Chinese voices', () => {
  const selected = selectChineseVoice([
    { name: 'English', lang: 'en-US', localService: true },
    { name: '普通话在线', lang: 'zh-CN', localService: false },
    { name: 'Microsoft Xiaoxiao', lang: 'zh-CN', localService: true },
  ]);

  assert.equal(selected.name, 'Microsoft Xiaoxiao');
});

test('teacher voice exposes speaking, pause, resume and sequential completion states', () => {
  const spoken = [];
  const synthesis = {
    active: null,
    cancelCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    getVoices: () => [{ name: 'Microsoft Xiaoxiao', lang: 'zh-CN', localService: true }],
    cancel() { this.cancelCount += 1; },
    pause() { this.pauseCount += 1; },
    resume() { this.resumeCount += 1; },
    speak(utterance) {
      this.active = utterance;
      spoken.push(utterance);
      utterance.onstart?.();
    },
  };
  const voice = createTeacherVoice({ synthesis, createUtterance: text => ({ text }) });

  assert.equal(voice.speak({ id: 'message-1', text: '先看第一点。再看第二点。', rate: 1.1 }), true);
  assert.deepEqual(voice.getSnapshot(), { supported: true, status: 'speaking', activeId: 'message-1' });
  assert.equal(spoken[0].voice.name, 'Microsoft Xiaoxiao');
  assert.equal(spoken[0].rate, 1.1);

  assert.equal(voice.toggle({ id: 'message-1' }), true);
  assert.equal(voice.getSnapshot().status, 'paused');
  assert.equal(synthesis.pauseCount, 1);
  assert.equal(voice.toggle({ id: 'message-1' }), true);
  assert.equal(voice.getSnapshot().status, 'speaking');
  assert.equal(synthesis.resumeCount, 1);

  synthesis.active.onend();
  assert.deepEqual(voice.getSnapshot(), { supported: true, status: 'idle', activeId: null });
});

test('starting another teacher message cancels the previous message', () => {
  const synthesis = {
    cancelCount: 0,
    getVoices: () => [],
    cancel() { this.cancelCount += 1; },
    pause() {},
    resume() {},
    speak(utterance) { utterance.onstart?.(); },
  };
  const voice = createTeacherVoice({ synthesis, createUtterance: text => ({ text }) });

  voice.speak({ id: 'first', text: '第一条。' });
  voice.speak({ id: 'second', text: '第二条。' });

  assert.equal(synthesis.cancelCount, 2);
  assert.equal(voice.getSnapshot().activeId, 'second');
});

test('unsupported environments remain explicit and inert', () => {
  const voice = createTeacherVoice();
  assert.deepEqual(voice.getSnapshot(), { supported: false, status: 'unsupported', activeId: null });
  assert.equal(voice.speak({ id: 'message', text: '不会播放' }), false);
});

test('voice settings default to auto while preserving explicit existing choices', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.deepEqual(readTeacherVoiceSettings(storage), { mode: TEACHER_VOICE_MODES.AUTO, rate: 1 });
  const saved = writeTeacherVoiceSettings({ mode: 'manual', rate: 9 }, storage);
  assert.deepEqual(saved, { mode: TEACHER_VOICE_MODES.MANUAL, rate: 1.25 });
  assert.deepEqual(readTeacherVoiceSettings(storage), saved);
  assert.equal(normalizeTeacherVoiceRate('bad'), 1);
});

test('automatic speech requires a final visible current turn and an available teacher floor', () => {
  const ready = {
    autoSpeak: true,
    mode: TEACHER_VOICE_MODES.AUTO,
    visible: true,
    connected: true,
    currentContext: true,
    studentHasFloor: false,
    autoplayBlocked: false,
  };

  assert.equal(shouldAutoSpeakTeacherMessage(ready), true);
  for (const override of [
    { autoSpeak: false },
    { mode: TEACHER_VOICE_MODES.MANUAL },
    { visible: false },
    { connected: false },
    { currentContext: false },
    { studentHasFloor: true },
    { autoplayBlocked: true },
  ]) {
    assert.equal(shouldAutoSpeakTeacherMessage({ ...ready, ...override }), false);
  }
});

test('only browser permission rejection blocks later automatic speech attempts', () => {
  assert.equal(isTeacherVoiceAutoplayBlocked('not-allowed'), true);
  assert.equal(isTeacherVoiceAutoplayBlocked({ error: 'not-allowed' }), true);
  assert.equal(isTeacherVoiceAutoplayBlocked('canceled'), false);
  assert.equal(isTeacherVoiceAutoplayBlocked('interrupted'), false);
});

test('teacher voice exposes synthesis errors for automatic-playback fallback', () => {
  let active = null;
  const synthesis = {
    cancel() {},
    pause() {},
    resume() {},
    getVoices: () => [],
    speak(utterance) {
      active = utterance;
      utterance.onstart?.();
    },
  };
  const voice = createTeacherVoice({ synthesis, createUtterance: text => ({ text }) });

  voice.speak({ id: 'automatic-message', text: '现在开始讲解。' });
  active.onerror({ error: 'not-allowed' });

  assert.equal(voice.getSnapshot().status, 'error');
  assert.equal(voice.getSnapshot().activeId, 'automatic-message');
  assert.equal(voice.getSnapshot().error, 'not-allowed');
});

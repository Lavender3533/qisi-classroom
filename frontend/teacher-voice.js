export const TEACHER_VOICE_STORAGE_KEYS = Object.freeze({
  mode: 'warmclassroom.teacher.voiceMode',
  rate: 'warmclassroom.teacher.voiceRate',
});

export const TEACHER_VOICE_MODES = Object.freeze({
  OFF: 'off',
  MANUAL: 'manual',
  AUTO: 'auto',
});

export function normalizeTeacherVoiceMode(value) {
  return Object.values(TEACHER_VOICE_MODES).includes(value)
    ? value
    : TEACHER_VOICE_MODES.AUTO;
}

export function normalizeTeacherVoiceRate(value) {
  if (value === null || value === undefined || value === '') return 1;
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1.25, Math.max(0.75, Math.round(rate * 100) / 100));
}

export function readTeacherVoiceSettings(storage = globalThis.localStorage) {
  try {
    return {
      mode: normalizeTeacherVoiceMode(storage?.getItem(TEACHER_VOICE_STORAGE_KEYS.mode)),
      rate: normalizeTeacherVoiceRate(storage?.getItem(TEACHER_VOICE_STORAGE_KEYS.rate)),
    };
  } catch {
    return { mode: TEACHER_VOICE_MODES.AUTO, rate: 1 };
  }
}

export function shouldAutoSpeakTeacherMessage({
  autoSpeak = false,
  mode = TEACHER_VOICE_MODES.AUTO,
  visible = true,
  connected = true,
  currentContext = true,
  studentHasFloor = false,
  autoplayBlocked = false,
} = {}) {
  return Boolean(
    autoSpeak
    && mode === TEACHER_VOICE_MODES.AUTO
    && visible
    && connected
    && currentContext
    && !studentHasFloor
    && !autoplayBlocked
  );
}

export function isTeacherVoiceAutoplayBlocked(value) {
  const reason = typeof value === 'string' ? value : value?.error;
  return String(reason || '').toLowerCase() === 'not-allowed';
}

export function writeTeacherVoiceSettings(settings, storage = globalThis.localStorage) {
  const normalized = {
    mode: normalizeTeacherVoiceMode(settings?.mode),
    rate: normalizeTeacherVoiceRate(settings?.rate),
  };
  try {
    storage?.setItem(TEACHER_VOICE_STORAGE_KEYS.mode, normalized.mode);
    storage?.setItem(TEACHER_VOICE_STORAGE_KEYS.rate, String(normalized.rate));
  } catch {
    // 设置仍会在当前界面生效；存储不可用时不阻断课堂。
  }
  return normalized;
}

export function toTeacherSpeechText(value) {
  return String(value || '')
    .replace(/```[^\n]*\n[\s\S]*?```/g, '。这里有一段代码，请看屏幕。')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+] |\d+[.)]\s+)/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, '')
    .replace(/\|/g, '，')
    .replace(/[*_~]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '和')
    .replace(/&lt;/gi, '小于')
    .replace(/&gt;/gi, '大于')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n+\s*/g, '。')
    .replace(/。{2,}/g, '。')
    .trim();
}

function splitOversizedSentence(sentence, maxLength) {
  const pieces = [];
  let rest = sentence.trim();
  while (rest.length > maxLength) {
    const windowText = rest.slice(0, maxLength + 1);
    const candidates = ['，', ',', '、', '：', ':', ' ']
      .map(mark => windowText.lastIndexOf(mark))
      .filter(index => index >= Math.floor(maxLength * 0.45));
    const cutAt = candidates.length ? Math.max(...candidates) + 1 : maxLength;
    pieces.push(rest.slice(0, cutAt).trim());
    rest = rest.slice(cutAt).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function splitTeacherSpeechText(value, maxLength = 180) {
  const text = toTeacherSpeechText(value);
  if (!text) return [];
  const limit = Math.min(300, Math.max(40, Number(maxLength) || 180));
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  const chunks = [];
  let current = '';

  for (const rawSentence of sentences) {
    for (const sentence of splitOversizedSentence(rawSentence, limit)) {
      if (!current) {
        current = sentence;
      } else if (current.length + sentence.length <= limit) {
        current += sentence;
      } else {
        chunks.push(current);
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function selectChineseVoice(voices = []) {
  const score = voice => {
    const lang = String(voice?.lang || '').toLowerCase().replace('_', '-');
    const name = String(voice?.name || '');
    let value = lang === 'zh-cn' ? 120 : lang.startsWith('zh-cn') ? 110 : lang.startsWith('zh') ? 90 : 0;
    if (voice?.localService) value += 18;
    if (/Microsoft|Xiaoxiao|Yunxi|Yunyang|Huihui|晓晓|云希|云扬/i.test(name)) value += 12;
    if (voice?.default) value += 2;
    return value;
  };
  return [...voices].sort((left, right) => score(right) - score(left))[0] || null;
}

export function createTeacherVoice({ synthesis = null, createUtterance = null } = {}) {
  const supported = Boolean(synthesis && typeof synthesis.speak === 'function' && createUtterance);
  let snapshot = { supported, status: supported ? 'idle' : 'unsupported', activeId: null };
  let generation = 0;
  const listeners = new Set();

  const publish = update => {
    snapshot = { ...snapshot, ...update };
    if (update.error === null) delete snapshot.error;
    listeners.forEach(listener => listener({ ...snapshot }));
  };

  const stop = () => {
    generation += 1;
    if (supported) synthesis.cancel();
    publish({ status: supported ? 'idle' : 'unsupported', activeId: null, error: null });
  };

  const speak = ({ id, text, rate = 1 } = {}) => {
    if (!supported) return false;
    const chunks = splitTeacherSpeechText(text);
    if (!id || !chunks.length) return false;

    generation += 1;
    const activeGeneration = generation;
    synthesis.cancel();
    let index = 0;
    const voices = typeof synthesis.getVoices === 'function' ? synthesis.getVoices() : [];
    const voice = selectChineseVoice(voices);

    const speakNext = () => {
      if (activeGeneration !== generation) return;
      if (index >= chunks.length) {
        publish({ status: 'idle', activeId: null, error: null });
        return;
      }
      const utterance = createUtterance(chunks[index]);
      index += 1;
      utterance.lang = voice?.lang || 'zh-CN';
      utterance.rate = normalizeTeacherVoiceRate(rate);
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      utterance.onstart = () => {
        if (activeGeneration === generation) publish({ status: 'speaking', activeId: id, error: null });
      };
      utterance.onend = speakNext;
      utterance.onerror = event => {
        if (activeGeneration !== generation || event?.error === 'canceled' || event?.error === 'interrupted') return;
        publish({ status: 'error', activeId: id, error: String(event?.error || 'synthesis-failed') });
      };
      synthesis.speak(utterance);
    };

    publish({ status: 'speaking', activeId: id, error: null });
    speakNext();
    return true;
  };

  const pause = () => {
    if (!supported || snapshot.status !== 'speaking') return false;
    synthesis.pause();
    publish({ status: 'paused' });
    return true;
  };

  const resume = () => {
    if (!supported || snapshot.status !== 'paused') return false;
    synthesis.resume();
    publish({ status: 'speaking' });
    return true;
  };

  const toggle = options => {
    if (snapshot.activeId === options?.id && snapshot.status === 'speaking') return pause();
    if (snapshot.activeId === options?.id && snapshot.status === 'paused') return resume();
    return speak(options);
  };

  return {
    getSnapshot: () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => listeners.delete(listener);
    },
    speak,
    pause,
    resume,
    toggle,
    stop,
  };
}

export function createBrowserTeacherVoice(windowLike = globalThis) {
  const synthesis = windowLike?.speechSynthesis || null;
  const Utterance = windowLike?.SpeechSynthesisUtterance;
  return createTeacherVoice({
    synthesis,
    createUtterance: typeof Utterance === 'function' ? text => new Utterance(text) : null,
  });
}

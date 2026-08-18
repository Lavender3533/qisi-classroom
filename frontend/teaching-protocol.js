export const SAFE_TEACHER_RESPONSE_FALLBACK = '老师这次的回复格式不完整，请重新发送。';

// 部分网关/思维链模型会把内部安全分类包装（<ds_safety>…</ds_safety>）或
// ".vrtx" 等路由残留泄漏进可见回复；展示与解析前统一剥离。
export function stripModelSafetyWrappers(value) {
  const stripped = String(value ?? '')
    .replace(/<ds_safety>[\s\S]*?<\/ds_safety>/giu, '')
    .replace(/<ds[^>]*>[\s\S]*?<\/ds[^>]*>/giu, '')
    .replace(/^\.vrtx\b/iu, '')
    .trim();
  if (/^(safe|vrtx)?$/iu.test(stripped)) return '';
  return stripped;
}

function normalizeSmartJsonKeys(value) {
  return String(value || '').replace(
    /(^|[{,]\s*)[“”]([^“”:\r\n]+)[“”]\s*:/gu,
    '$1"$2":',
  );
}

function removeTrailingJsonCommas(value) {
  const source = String(value || '');
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (/\s/u.test(source[cursor] || '')) cursor += 1;
      if (source[cursor] === '}' || source[cursor] === ']') continue;
    }
    result += char;
  }
  return result;
}

function parseStructuredCandidate(value) {
  const raw = String(value || '').trim();
  const candidates = [
    raw,
    removeTrailingJsonCommas(normalizeSmartJsonKeys(raw)),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const structured = JSON.parse(candidate);
      if (structured && typeof structured === 'object'
        && typeof structured.message === 'string'
        && structured.message.trim()) {
        return structured;
      }
    } catch {
      // Try the next bounded repair candidate.
    }
  }
  return null;
}

function extractBalancedJsonObjects(source) {
  const objects = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        objects.push({ start, end: index + 1, raw: source.slice(start, index + 1) });
        start = index;
        break;
      }
    }
  }
  return objects;
}

function looksLikeInternalTeacherProtocol(value) {
  return /["“”']?(?:teacher_move|student_task|student_state_update|learning_diagnosis|board_update)["“”']?\s*:/u.test(String(value || ''));
}

export function parseAIResponse(text) {
  const source = stripModelSafetyWrappers(text);
  const fencedMatch = source.match(/```json\s*([\s\S]*?)```/iu);
  const candidates = [];
  if (fencedMatch?.[1]) {
    candidates.push({
      raw: fencedMatch[1],
      start: fencedMatch.index,
      end: fencedMatch.index + fencedMatch[0].length,
    });
  }
  candidates.push(...extractBalancedJsonObjects(source));

  for (const candidate of candidates) {
    const structured = parseStructuredCandidate(candidate.raw);
    if (!structured) continue;
    const visibleText = `${source.slice(0, candidate.start)}${source.slice(candidate.end)}`.trim();
    return {
      message: visibleText || structured.message.trim(),
      structured,
      unsafe: false,
      repaired: candidate.raw.trim() !== JSON.stringify(structured),
    };
  }

  if (looksLikeInternalTeacherProtocol(source)) {
    return {
      message: SAFE_TEACHER_RESPONSE_FALLBACK,
      structured: null,
      unsafe: true,
      repaired: false,
    };
  }
  return { message: source, structured: null, unsafe: false, repaired: false };
}

export function validateAssessmentPayload(payload) {
  if (!payload || !Array.isArray(payload.questions) || payload.questions.length === 0) {
    return { valid: false, error: '摸底题集为空' };
  }

  for (const [index, question] of payload.questions.entries()) {
    if (!question || !['choice', 'fill'].includes(question.type)) {
      return { valid: false, error: `第 ${index + 1} 题类型无效` };
    }
    if (typeof question.question !== 'string' || !question.question.trim()) {
      return { valid: false, error: `第 ${index + 1} 题缺少题目内容` };
    }
    if (typeof question.knowledge_point !== 'string' || !question.knowledge_point.trim()) {
      return { valid: false, error: `第 ${index + 1} 题缺少知识点` };
    }
    const difficulty = Number(question.difficulty);
    if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) {
      return { valid: false, error: `第 ${index + 1} 题难度无效` };
    }

    if (question.type === 'choice') {
      if (!Array.isArray(question.options) || question.options.length < 2) {
        return { valid: false, error: `第 ${index + 1} 题缺少选项` };
      }
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
        return { valid: false, error: `第 ${index + 1} 题答案索引无效` };
      }
    } else if (typeof question.answer !== 'string' || !question.answer.trim()) {
      return { valid: false, error: `第 ${index + 1} 题缺少填空答案` };
    }
  }

  return { valid: true, error: null };
}

export function promoteAssessmentTab(appState, subjectId) {
  const subject = appState.subjects.find(item => item.id === subjectId);
  if (!subject) return false;

  const tab = appState.tabs.find(item => item.id === `assess-${subjectId}`);
  if (tab) {
    tab.id = `chat-${subjectId}`;
    tab.title = subject.name;
    tab.type = 'chat';
  }
  appState.activeTab = `chat-${subjectId}`;
  return true;
}

export function reconcileChatHistory({ systemMessage, persistedMessages = [], memoryHistory = [] } = {}) {
  const normalizeEntries = entries => (Array.isArray(entries) ? entries : [])
    .map(entry => Array.isArray(entry)
      ? { role: entry[0], content: entry[1] }
      : { role: entry?.role, content: entry?.content })
    .filter(entry => ['user', 'assistant'].includes(entry.role) && typeof entry.content === 'string')
    .map(entry => ({ role: entry.role, content: entry.content }));
  const persisted = normalizeEntries(persistedMessages);
  const memory = normalizeEntries(memoryHistory);
  let commonPrefix = 0;
  while (commonPrefix < persisted.length && commonPrefix < memory.length
    && persisted[commonPrefix].role === memory[commonPrefix].role
    && persisted[commonPrefix].content === memory[commonPrefix].content) {
    commonPrefix += 1;
  }
  const unsavedTail = commonPrefix === persisted.length ? memory.slice(commonPrefix) : [];
  return [
    { role: 'system', content: String(systemMessage || '') },
    ...persisted,
    ...unsavedTail,
  ];
}

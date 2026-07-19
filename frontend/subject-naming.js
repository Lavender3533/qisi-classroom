const PLACEHOLDER_NAMES = new Set([
  '课程', '学习', '科目', '其他', '未命名', '新课程', '测试', 'test', 'demo', '默认',
]);

const SUBJECT_CATEGORIES = new Set([
  'programming', 'math', 'language', 'design', 'science', 'other',
]);

export function normalizeSubjectCategory(value) {
  const category = String(value ?? '').trim().toLowerCase();
  return SUBJECT_CATEGORIES.has(category) ? category : 'other';
}

export function validateSubjectName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { valid: false, name, reason: '请输入具体学习方向' };
  if (name.length > 32) return { valid: false, name, reason: '科目名称请控制在 32 个字以内' };
  if (/^\d+$/.test(name)) return { valid: false, name, reason: '仅有数字无法说明要学习什么' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { valid: false, name, reason: '科目名称需要包含文字' };
  if (name.length === 1 && !/^[CR]$/i.test(name)) return { valid: false, name, reason: '请补充更具体的学习内容' };
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return { valid: false, name, reason: '请说明具体要学习的内容' };
  return { valid: true, name, reason: '' };
}

export function getDisplaySubjectName(value) {
  const result = validateSubjectName(value);
  return result.valid ? result.name : '待命名课程';
}

function sanitizeLegacySubjectText(text, rawName) {
  const sanitizedNumericName = String(text ?? '')
    .replace(/你的\s*\d+\s*老师/g, '你的课程老师')
    .replace(/[“”"'‘’]\s*\d+\s*[“”"'‘’]/g, '“这门课程”');
  if (!rawName || validateSubjectName(rawName).valid) return sanitizedNumericName;

  const escapedName = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sanitizedNumericName
    .replace(new RegExp(`你的\\s*${escapedName}\\s*老师`, 'g'), '你的课程老师')
    .replace(new RegExp(`${escapedName}\\s*老师`, 'g'), '课程老师')
    .replace(new RegExp(`[“”"'‘’]\\s*${escapedName}\\s*[“”"'‘’]`, 'g'), '“这门课程”');
}

function sanitizeStructuredSubjectValue(value, rawName) {
  if (typeof value === 'string') return sanitizeLegacySubjectText(value, rawName);
  if (Array.isArray(value)) return value.map(item => sanitizeStructuredSubjectValue(item, rawName));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeStructuredSubjectValue(item, rawName)]),
  );
}

export function sanitizeLegacySubjectMessage(content, rawSubjectName, role = 'assistant') {
  const text = String(content ?? '');
  const rawName = String(rawSubjectName ?? '').trim();
  if (role !== 'assistant') return text;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(sanitizeStructuredSubjectValue(parsed, rawName));
    } catch {
      // Fall through for legacy plain text or malformed model output.
    }
  }
  return sanitizeLegacySubjectText(text, rawName);
}

export function parseSubjectNamingResponse(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').replace(/```json?\s*/gi, '').replace(/```/g, '').trim());
    if (parsed?.needs_clarification) {
      return { valid: false, reason: String(parsed.question || '请补充更具体的学习内容和目标') };
    }
    const name = validateSubjectName(parsed?.name);
    if (!name.valid) return { valid: false, reason: name.reason };
    const description = String(parsed?.description || '').trim();
    return {
      valid: true,
      name: name.name,
      description: description || `围绕“${name.name}”制定的个性化学习课程`,
      category: ['programming', 'math', 'language', 'design', 'science', 'other'].includes(parsed?.category)
        ? parsed.category
        : 'other',
    };
  } catch {
    return { valid: false, reason: 'AI 返回的名称格式无效' };
  }
}

export function buildSubjectNamingMessages(userHint, category = 'other') {
  const normalizedCategory = normalizeSubjectCategory(category);
  return [
    {
      role: 'system',
      content: `你是教育课程规划师。根据学生的学习内容和目标，生成一个自然、具体、适合显示在课程列表中的中文名称。
名称应为 4-16 个字，说明学什么；不得使用纯数字、单字占位、"未命名课程"或营销口号。Java、Python、C++、线性代数、英语口语等公认学科或技术名称本身已经足够，应直接生成“Java 编程入门”一类课程名，不要追问教材、项目或用途。只有输入无法确定学习对象时才返回 {"needs_clarification":true,"question":"需要补充的问题"}，不得猜测。
信息充分时只返回 JSON：{"name":"精准科目名","description":"一句话课程描述","category":"programming|math|language|design|science|other"}。`,
    },
    { role: 'user', content: `学习方向：${String(userHint).trim()}\n领域：${normalizedCategory}` },
  ];
}

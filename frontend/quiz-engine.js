export function normalizeQuizAnswer(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isEditableCodeExercise(value) {
  return /_{3,}|\bTODO\b|待补充|在此填写/i.test(String(value ?? ''));
}

export function getCodeExerciseSubmission(value) {
  const text = String(value ?? '').trim();
  const codeExercise = text.match(/^老师，请点评我刚完成的代码练习。\s*\n我的代码：\s*\n```([^\n`]*)\n?([\s\S]*?)```[\s\S]*$/);
  if (!codeExercise) return null;
  return { language: codeExercise[1].trim() || 'text', code: codeExercise[2].replace(/^\n|\n$/g, '') };
}

export function formatStudentMessageForDisplay(value) {
  const submission = getCodeExerciseSubmission(value);
  return submission ? `我的代码练习\n\`\`\`${submission.language}\n${submission.code}\n\`\`\`` : String(value ?? '').trim();
}

export function isInternalTeacherCommand(value) {
  const text = String(value ?? '').trim();
  return [
    /^老师，先围绕“[^”]+”给我一道两分钟复习题。只出题，不要先给答案。$/,
    /^老师，请从上次的“[^”]+”继续。先用一句话回顾，再给我一个具体任务。$/,
    /^老师，请根据当前目标“[^”]+”给我一个两分钟内能完成的小任务。$/,
    /^老师，请根据本节课的真实对话、练习和小测表现做课堂小结：/,
    /^老师，请根据本节目标开始章节评估。/,
  ].some(pattern => pattern.test(text));
}

export function evaluateQuizAnswer(quiz, answer) {
  if (!quiz || !['choice', 'fill'].includes(quiz.type)) {
    return { valid: false, correct: false, reason: '不支持的题目类型' };
  }
  if (quiz.type === 'choice') {
    if (answer === null || answer === undefined || answer === '') {
      return { valid: false, correct: false, reason: '请先选择一个答案' };
    }
    const selected = Number(answer);
    if (!Number.isInteger(selected) || selected < 0 || selected >= (quiz.options || []).length) {
      return { valid: false, correct: false, reason: '请先选择一个答案' };
    }
    return { valid: true, correct: selected === Number(quiz.answer), answer: selected };
  }
  const normalized = normalizeQuizAnswer(answer);
  if (!normalized) return { valid: false, correct: false, reason: '请先填写答案' };
  const accepted = Array.isArray(quiz.accepted_answers) && quiz.accepted_answers.length
    ? quiz.accepted_answers
    : [quiz.answer];
  return {
    valid: true,
    correct: accepted.some(item => normalizeQuizAnswer(item) === normalized),
    answer: String(answer).trim(),
  };
}

export function getQuizCorrectAnswer(quiz) {
  if (!quiz) return '';
  if (quiz.type === 'choice') return String((quiz.options || [])[Number(quiz.answer)] ?? quiz.answer ?? '');
  return String(quiz.answer ?? '');
}

export function planQuizAttempt(quiz, result, attemptNumber = 1) {
  if (!result?.valid) {
    return { complete: false, retry: false, revealAnswer: false, tone: 'invalid', message: result?.reason || '请先完成作答' };
  }
  const attempt = Math.max(1, Number(attemptNumber) || 1);
  if (result.correct) {
    return {
      complete: true,
      retry: false,
      revealAnswer: false,
      tone: 'correct',
      message: attempt === 1 ? '这道检查答对了，老师会继续验证你能否迁移。' : '修正正确。你已经找到刚才的卡点，接下来还要独立验证一次。',
    };
  }
  if (attempt === 1) {
    return {
      complete: false,
      retry: true,
      revealAnswer: false,
      tone: 'guidance',
      message: `先不公布答案。${String(quiz?.hint || '回到题干，找出决定结果的那个条件，再试一次。').trim()}`,
    };
  }
  const correctAnswer = getQuizCorrectAnswer(quiz);
  const explanation = String(quiz?.explanation || '先比较题目条件与正确答案，再回到当前知识点。').trim();
  return {
    complete: true,
    retry: false,
    revealAnswer: true,
    tone: 'wrong',
    message: `两次作答都没有命中。正确答案：${correctAnswer}。${explanation}`,
  };
}

function looksLikeCode(value) {
  const text = String(value || '').trim();
  return /[{};]/.test(text)
    || /\b(System\.out|console\.log|print\s*\(|public\s+class|static\s+void|if\s*\(|for\s*\(|while\s*\(|int\s+\w+|String\s+\w+|def\s+\w+)\b/.test(text);
}

export function formatCodeForDisplay(value) {
  const code = String(value ?? '').trim();
  if (!code || /\r?\n/.test(code)) return code;
  const lines = [];
  let current = '';
  let indent = 0;
  let parenDepth = 0;
  let quote = '';
  let escaped = false;
  const flush = () => {
    const line = current.trim();
    if (line) lines.push(`${'    '.repeat(Math.max(0, indent))}${line}`);
    current = '';
  };

  for (const char of code) {
    if (quote) {
      current += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '(') {
      parenDepth += 1;
      current += char;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
    } else if (char === '{') {
      current = `${current.trimEnd()} {`;
      flush();
      indent += 1;
    } else if (char === '}') {
      flush();
      indent = Math.max(0, indent - 1);
      current = '}';
      flush();
    } else if (char === ';' && parenDepth === 0) {
      current += char;
      flush();
    } else if (/\s/.test(char)) {
      if (current && !current.endsWith(' ')) current += ' ';
    } else {
      current += char;
    }
  }
  flush();
  return lines.length > 1 ? lines.join('\n') : code;
}

export function splitQuestionContent(value) {
  const text = String(value ?? '').trim();
  const fenced = text.match(/^([\s\S]*?)```(?:\w+)?\s*\n?([\s\S]*?)```\s*$/);
  if (fenced) return { prompt: fenced[1].trim(), code: formatCodeForDisplay(fenced[2]) };

  const questionBoundary = text.match(/^([\s\S]*?[？?])\s+([\s\S]+)$/);
  if (questionBoundary && looksLikeCode(questionBoundary[2])) {
    return { prompt: questionBoundary[1].trim(), code: formatCodeForDisplay(questionBoundary[2]) };
  }

  const lines = text.split(/\r?\n/);
  const codeIndex = lines.findIndex((line, index) => index > 0 && looksLikeCode(line));
  if (codeIndex > 0) {
    return {
      prompt: lines.slice(0, codeIndex).join('\n').trim(),
      code: formatCodeForDisplay(lines.slice(codeIndex).join('\n')),
    };
  }
  return { prompt: text, code: '' };
}

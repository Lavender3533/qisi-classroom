import { decideInstructionalAction, validateInstructionBlock } from './evidence-driven-instruction.js';

function normalizedTask(value) {
  const source = String(value || '').normalize('NFKC').toLowerCase();
  const incrementTerms = ['i++', '++i', '前置自增', '后置自增', '前置与后置自增', '前置和后置自增'];
  if (incrementTerms.filter(term => source.includes(term)).length >= 2
    || source.includes('前置与后置自增') || source.includes('前置和后置自增')) {
    return 'increment-prefix-postfix';
  }
  return source
    .replace(/[\p{Punctuation}\p{Separator}\d]/gu, '')
    .replace(/(?:请|只|写出|回答|计算|判断|结果|是多少)/gu, '');
}

export function evaluateTeachingReplay(turns = []) {
  const replayTurns = Array.isArray(turns) ? turns : [];
  const teacherTurns = replayTurns.filter(turn => turn?.role === 'assistant');
  let consecutiveTaskChain = 0;
  let longestTaskChain = 0;
  let consecutiveTeacherTurns = 0;
  let longestTeacherStreak = 0;
  let stopDelay = 0;
  let transferredAt = -1;
  const taskSignatures = [];
  let explanationCount = 0;
  let completeExplanations = 0;
  let summariesWithoutNextStep = 0;
  for (const turn of replayTurns) {
    consecutiveTeacherTurns = turn?.role === 'assistant' ? consecutiveTeacherTurns + 1 : 0;
    longestTeacherStreak = Math.max(longestTeacherStreak, consecutiveTeacherTurns);
  }
  for (const [index, turn] of teacherTurns.entries()) {
    const task = turn.student_task?.kind && turn.student_task.kind !== 'none' ? turn.student_task : null;
    consecutiveTaskChain = task ? consecutiveTaskChain + 1 : 0;
    longestTaskChain = Math.max(longestTaskChain, consecutiveTaskChain);
    if (task) taskSignatures.push(normalizedTask(task.prompt));
    if (['explain', 'model'].includes(turn.teacher_move)) {
      explanationCount += 1;
      if (validateInstructionBlock(turn.instruction_block || {}).valid) completeExplanations += 1;
    }
    if (turn.teacher_move === 'summary') {
      const hasNextAction = turn.can_advance === true
        || (Array.isArray(turn.actions) && turn.actions.some(action => ['next_lesson', 'advance'].includes(action?.type || action)))
        || /(?:进入|开始|继续).{0,8}(?:下一|下节|新内容)/u.test(`${turn.checkpoint || ''} ${turn.message || ''}`);
      if (!hasNextAction) summariesWithoutNextStep += 1;
    }
    if (turn.evidence_stage === 'transferred' && turn.correct === true) transferredAt = index;
    else if (transferredAt >= 0 && task && normalizedTask(task.knowledge_point) === normalizedTask(teacherTurns[transferredAt]?.knowledge_point)) stopDelay += 1;
  }
  const duplicateSemanticTasks = taskSignatures.reduce((count, signature, index) => (
    signature && taskSignatures.indexOf(signature) < index ? count + 1 : count
  ), 0);
  const componentNames = teacherTurns.map(turn => normalizedTask(turn.knowledge_point)).filter(Boolean);
  const fragmentation = new Set(componentNames).size;
  const taskRate = teacherTurns.length ? taskSignatures.length / teacherTurns.length : 0;
  const explanationToTaskRatio = taskSignatures.length ? explanationCount / taskSignatures.length : 1;
  const isSubstantialLesson = teacherTurns.length >= 6;
  return {
    teacherTurns: teacherTurns.length,
    studentTurns: replayTurns.filter(turn => turn?.role === 'user').length,
    longestTeacherStreak,
    longestTaskChain,
    taskTurns: taskSignatures.length,
    taskRate,
    explanationCount,
    explanationToTaskRatio,
    duplicateSemanticTasks,
    stopDelay,
    summariesWithoutNextStep,
    explanationCompleteness: explanationCount ? completeExplanations / explanationCount : 0,
    componentFragmentation: fragmentation,
    passed: longestTeacherStreak <= 2 && longestTaskChain <= 2
      && (!isSubstantialLesson || taskRate <= 0.45)
      && (!isSubstantialLesson || explanationToTaskRatio >= 0.25)
      && duplicateSemanticTasks === 0 && stopDelay === 0 && summariesWithoutNextStep === 0
      && (!explanationCount || completeExplanations === explanationCount),
  };
}

export function replayInstructionalDecisions(events = []) {
  return events.map(event => decideInstructionalAction(event));
}

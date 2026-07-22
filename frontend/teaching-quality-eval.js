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
  const teacherTurns = (Array.isArray(turns) ? turns : []).filter(turn => turn?.role === 'assistant');
  let consecutiveTaskChain = 0;
  let longestTaskChain = 0;
  let stopDelay = 0;
  let transferredAt = -1;
  const taskSignatures = [];
  let explanationCount = 0;
  let completeExplanations = 0;
  for (const [index, turn] of teacherTurns.entries()) {
    const task = turn.student_task?.kind && turn.student_task.kind !== 'none' ? turn.student_task : null;
    consecutiveTaskChain = task ? consecutiveTaskChain + 1 : 0;
    longestTaskChain = Math.max(longestTaskChain, consecutiveTaskChain);
    if (task) taskSignatures.push(normalizedTask(task.prompt));
    if (['explain', 'model'].includes(turn.teacher_move)) {
      explanationCount += 1;
      if (validateInstructionBlock(turn.instruction_block || {}).valid) completeExplanations += 1;
    }
    if (turn.evidence_stage === 'transferred' && turn.correct === true) transferredAt = index;
    else if (transferredAt >= 0 && task && normalizedTask(task.knowledge_point) === normalizedTask(teacherTurns[transferredAt]?.knowledge_point)) stopDelay += 1;
  }
  const duplicateSemanticTasks = taskSignatures.reduce((count, signature, index) => (
    signature && taskSignatures.indexOf(signature) < index ? count + 1 : count
  ), 0);
  const componentNames = teacherTurns.map(turn => normalizedTask(turn.knowledge_point)).filter(Boolean);
  const fragmentation = new Set(componentNames).size;
  return {
    teacherTurns: teacherTurns.length,
    longestTaskChain,
    duplicateSemanticTasks,
    stopDelay,
    explanationCompleteness: explanationCount ? completeExplanations / explanationCount : 0,
    componentFragmentation: fragmentation,
    passed: longestTaskChain <= 2 && duplicateSemanticTasks === 0 && stopDelay === 0
      && (!explanationCount || completeExplanations === explanationCount),
  };
}

export function replayInstructionalDecisions(events = []) {
  return events.map(event => decideInstructionalAction(event));
}

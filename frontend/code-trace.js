function numberValue(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function traceSimpleJavaAccumulator(source) {
  const code = String(source || '').replace(/\/\/.*$/gm, ' ');
  const sumMatch = code.match(/\bint\s+sum\s*=\s*(-?\d+)\s*;?/u);
  const loopMatch = code.match(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*;\s*\1\s*(<=|<|>=|>)\s*(-?\d+)\s*;\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)/u,
  );
  if (!sumMatch || !loopMatch || !new RegExp(`\\bsum\\s*\\+=\\s*${loopMatch[1]}\\b`, 'u').test(code)) return null;
  const initialSum = numberValue(sumMatch[1]);
  let current = numberValue(loopMatch[2]);
  const boundary = numberValue(loopMatch[4]);
  if (initialSum === null || current === null || boundary === null) return null;
  const compare = { '<=': (a, b) => a <= b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '>': (a, b) => a > b }[loopMatch[3]];
  const updateText = loopMatch[5].replace(/\s+/g, '');
  const step = updateText === '++' ? 1 : updateText === '--' ? -1
    : updateText.startsWith('+=') ? Number(updateText.slice(2)) : -Number(updateText.slice(2));
  if (!Number.isFinite(step) || step === 0) return null;
  let sum = initialSum;
  const rounds = [];
  while (compare(current, boundary) && rounds.length < 1000) {
    sum += current;
    rounds.push({ round: rounds.length + 1, i: current, sum });
    current += step;
  }
  if (rounds.length === 1000) return null;
  return {
    initialSum,
    rounds,
    finalSum: sum,
    lastIncludedI: rounds.at(-1)?.i ?? null,
    exitI: current,
    iterations: rounds.length,
  };
}

export function formatJavaAccumulatorTrace(trace) {
  if (!trace) return '';
  const rounds = trace.rounds.map(item => `第${item.round}轮 i=${item.i}, sum=${item.sum}`).join('；');
  return `客户端确定性执行追踪：初始 sum=${trace.initialSum}；${rounds || '循环未执行'}；最终 sum=${trace.finalSum}；最后参与累加的 i=${trace.lastIncludedI ?? '无'}；退出循环时 i=${trace.exitI}；共执行 ${trace.iterations} 轮。退出时 i 不是输出结果，除非代码明确输出 i。此追踪只验证数值执行，不代表代码语法完整。`;
}

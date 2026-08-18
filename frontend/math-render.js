import katex from 'katex';
import 'katex/dist/katex.min.css';

// 支持 \(...\)、\[...\] 与 $$...$$；故意不支持单 $ 定界，避免误伤普通文本中的货币符号。
const MATH_PATTERN = /(`[^`\n]+`)|(\\\([\s\S]*?\\\))|(\\\[[\s\S]*?\\\])|(\$\$[\s\S]*?\$\$)/g;

function renderMathSource(source, displayMode) {
  try {
    return katex.renderToString(String(source).trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return null;
  }
}

function mathSpan(source, displayMode, fallbackText) {
  const rendered = renderMathSource(source, displayMode);
  if (rendered === null) {
    return document.createTextNode(fallbackText);
  }
  const node = document.createElement(displayMode ? 'div' : 'span');
  node.className = displayMode ? 'math-display' : 'math-inline';
  node.innerHTML = rendered;
  return node;
}

/** 把一段含行内代码与 LaTeX 公式的文本渲染进容器（renderRichMessage 的行内部分）。 */
export function renderInlineRich(container, text) {
  const source = String(text ?? '');
  MATH_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match;
  while ((match = MATH_PATTERN.exec(source))) {
    if (match.index > cursor) {
      container.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    }
    const [full, tick, inlineParen, displayBracket, displayDollar] = match;
    if (tick) {
      const code = document.createElement('code');
      code.className = 'inline-code';
      code.textContent = tick.slice(1, -1);
      container.appendChild(code);
    } else if (inlineParen) {
      container.appendChild(mathSpan(inlineParen.slice(2, -2), false, full));
    } else {
      const raw = (displayBracket || displayDollar).slice(2, -2);
      container.appendChild(mathSpan(raw, true, full));
    }
    cursor = MATH_PATTERN.lastIndex;
  }
  if (cursor < source.length) {
    container.appendChild(document.createTextNode(source.slice(cursor)));
  }
}

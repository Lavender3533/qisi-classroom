/**
 * CodeMirror 6 编辑器封装 — 用于 Python 练习面板
 * 提供：语法高亮、自动补全、Tab 缩进、暗色主题
 */
import { EditorView, hoverTooltip, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { linter, lintGutter } from '@codemirror/lint';
import { invoke } from '@tauri-apps/api/core';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { lineNumbers, highlightActiveLineGutter, highlightActiveLine, rectangularSelection } from '@codemirror/view';

/** 创建课堂代码任务使用的通用编辑器。 */
export function createTaskCodeEditor(parent, options = {}) {
  const { initialCode = '', placeholder = '在这里编写代码…', onChange = () => {}, onSubmit = () => {} } = options;
  const theme = EditorView.theme({
    '&': { height: '100%', backgroundColor: '#17201E', color: '#E7F2EE', fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'Cascadia Code', 'Consolas', monospace", lineHeight: '1.65' },
    '.cm-content': { padding: '10px 0', caretColor: '#5EEAD4' },
    '.cm-gutters': { backgroundColor: '#111A18', color: '#719087', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(94, 234, 212, .07)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(94, 234, 212, .16) !important' },
  }, { dark: true });
  const state = EditorState.create({
    doc: initialCode,
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), history(), indentOnInput(), bracketMatching(),
      closeBrackets(), highlightActiveLine(), oneDark, theme, cmPlaceholder(placeholder),
      keymap.of([{ key: 'Ctrl-Enter', run: () => { onSubmit(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent });
  return {
    getValue: () => view.state.doc.toString(),
    setValue(code) {
      const value = String(code || '');
      if (value === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

/**
 * 创建一个 CodeMirror 6 Python 编辑器
 * @param {HTMLElement} parent - 挂载容器
 * @param {Object} options
 * @param {string} options.initialCode - 初始代码
 * @param {string} options.placeholder - 占位文字
 * @returns {{ getValue: () => string, setValue: (code: string) => void, destroy: () => void, dom: HTMLElement }}
 */
export function createPracticeEditor(parent, options = {}) {
  const { initialCode = '', placeholder = '在这里写 Python 代码…' } = options;
  let contextualCompletions = Array.isArray(options.completions) ? options.completions : [];
  const completionCompartment = new Compartment();
  const pythonHelp = {
    print: '输出一个或多个值。示例：print(name)',
    input: '读取用户输入，返回字符串。示例：name = input("姓名：")',
    range: '生成整数序列，常用于 for 循环。示例：range(1, 6)',
    len: '返回字符串、列表等对象的长度。',
    append: '在列表末尾添加一个元素。示例：items.append(value)',
    enumerate: '遍历时同时得到索引和值。示例：for i, value in enumerate(items)',
    zip: '把多个序列按位置配对。',
  };

  const completionSource = context => {
    const word = context.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const pythonBuiltins = [
      'print', 'input', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple',
      'bool', 'type', 'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
      'min', 'max', 'sum', 'abs', 'round', 'None', 'True', 'False', 'self', 'def', 'class',
      'return', 'yield', 'lambda', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
      'pass', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'and', 'or',
      'not', 'in', 'is', 'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'sort', 'copy',
      'keys', 'values', 'items', 'get', 'update', 'split', 'join', 'strip', 'replace', 'find',
      'startswith', 'endswith', 'upper', 'lower', 'format',
    ];
    const lessonOptions = contextualCompletions.map(item => typeof item === 'string'
      ? { label: item, type: 'variable', detail: '本题上下文' }
      : { label: item.label, type: item.type || 'variable', detail: item.detail || '本题上下文', apply: item.apply });
    const builtinOptions = pythonBuiltins.map(label => ({ label, type: 'keyword' }));
    return {
      from: word.from,
      options: [...lessonOptions, ...builtinOptions]
        .filter(item => item.label?.startsWith(word.text) && item.label !== word.text),
    };
  };

  // 自定义暗色主题样式，匹配项目配色
  const customTheme = EditorView.theme({
    '&': {
      fontSize: '13px',
      fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
      height: '100%',
      backgroundColor: '#17201E',
    },
    '.cm-content': {
      caretColor: '#5EEAD4',
      padding: '8px 0',
    },
    '.cm-cursor': {
      borderLeftColor: '#5EEAD4',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(94, 234, 212, 0.15) !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(94, 234, 212, 0.06)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(94, 234, 212, 0.08)',
    },
    '.cm-gutters': {
      backgroundColor: '#111A18',
      border: 'none',
      color: '#4A6B63',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 4px',
      fontSize: '11px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: '#4A6B63',
    },
    '.cm-tooltip-autocomplete': {
      backgroundColor: '#1E2B2A',
      border: '1px solid #33433F',
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(94, 234, 212, 0.15)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(94, 234, 212, 0.2)',
      outline: '1px solid rgba(94, 234, 212, 0.4)',
    },
  }, { dark: true });

  const state = EditorState.create({
    doc: initialCode,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      hoverTooltip((view, position) => {
        const line = view.state.doc.lineAt(position);
        const offset = position - line.from;
        const before = line.text.slice(0, offset).match(/[A-Za-z_]\w*$/)?.[0] || '';
        const after = line.text.slice(offset).match(/^\w*/)?.[0] || '';
        const word = before + after;
        const help = pythonHelp[word];
        if (!help) return null;
        return {
          pos: position - before.length,
          end: position + after.length,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-python-help';
            dom.textContent = help;
            return { dom };
          },
        };
      }),
      lintGutter(),
      linter(async view => {
        const code = view.state.doc.toString();
        if (!code.trim()) return [];
        try {
          const diagnostics = await invoke('check_python_syntax', { code });
          return diagnostics.map(diagnostic => {
            const lineNumber = Math.min(view.state.doc.lines, Math.max(1, Number(diagnostic.line) || 1));
            const line = view.state.doc.line(lineNumber);
            const from = Math.min(line.to, line.from + Math.max(0, (Number(diagnostic.column) || 1) - 1));
            return { from, to: Math.min(line.to, from + 1), severity: 'error', message: diagnostic.message };
          });
        } catch {
          return [];
        }
      }, { delay: 400 }),
      completionCompartment.of(autocompletion({ override: [completionSource] })),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      python(),
      oneDark,
      customTheme,
      cmPlaceholder(placeholder),
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(code) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    },
    setCompletions(items) {
      contextualCompletions = Array.isArray(items) ? items.slice(0, 30) : [];
      view.dispatch({ effects: completionCompartment.reconfigure(autocompletion({ override: [completionSource] })) });
    },
    destroy() {
      view.destroy();
    },
    dom: view.dom,
    view,
  };
}

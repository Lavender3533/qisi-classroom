const COMMAND_DEFINITIONS = [
  { id: 'file.newSubject', menu: 'file', label: '新建科目', kbd: 'Ctrl+N', shortcut: { ctrl: true, key: 'n' }, action: 'newSubject' },
  { id: 'file.closeTab', menu: 'file', label: '关闭当前标签', kbd: 'Ctrl+W', shortcut: { ctrl: true, key: 'w' }, action: 'closeTab', enabled: 'canCloseTab' },
  { id: 'file.settings', menu: 'file', label: '打开设置', kbd: 'Ctrl+,', shortcut: { ctrl: true, key: ',' }, action: 'openSettings' },
  { id: 'file.exit', menu: 'file', label: '退出启思学堂', action: 'exitApp', separatorBefore: true },

  { id: 'view.classroom', menu: 'view', label: '课堂', kbd: 'Ctrl+1', shortcut: { ctrl: true, key: '1' }, action: 'openClassroom' },
  { id: 'view.notes', menu: 'view', label: '笔记', kbd: 'Ctrl+2', shortcut: { ctrl: true, key: '2' }, action: 'openNotes' },
  { id: 'view.homework', menu: 'view', label: '作业', kbd: 'Ctrl+3', shortcut: { ctrl: true, key: '3' }, action: 'openHomework' },
  { id: 'view.review', menu: 'view', label: '复习', kbd: 'Ctrl+4', shortcut: { ctrl: true, key: '4' }, action: 'openReview' },
  { id: 'view.settings', menu: 'view', label: '设置', kbd: 'Ctrl+5', shortcut: { ctrl: true, key: '5' }, action: 'openSettings' },
  { id: 'view.toggleSidebar', menu: 'view', label: '切换主侧栏', kbd: 'Ctrl+B', shortcut: { ctrl: true, key: 'b' }, action: 'toggleSidebar', separatorBefore: true },
  { id: 'view.toggleInspector', menu: 'view', label: '切换学习检查器', kbd: 'Ctrl+Shift+I', shortcut: { ctrl: true, shift: true, key: 'i' }, action: 'toggleInspector' },
  { id: 'view.commandCenter', menu: 'view', label: '打开命令中心', kbd: 'Ctrl+K', shortcut: { ctrl: true, key: 'k' }, action: 'openCommandCenter' },

  { id: 'learning.resume', menu: 'learning', label: '继续当前课堂', action: 'resumeLearning', enabled: 'canResumeLearning' },
  { id: 'learning.openSubject', menu: 'learning', label: '打开当前科目', action: 'openCurrentSubject', enabled: 'canResumeLearning' },
  { id: 'learning.checkConnection', menu: 'learning', label: '检查 AI 老师连接', action: 'checkConnection', separatorBefore: true },
  { id: 'learning.newSubject', menu: 'learning', label: '添加学习科目', action: 'newSubject' },

  { id: 'help.shortcuts', menu: 'help', label: '键盘快捷键', action: 'showShortcuts' },
  { id: 'help.commandCenter', menu: 'help', label: '命令中心', kbd: 'Ctrl+K', action: 'openCommandCenter' },
  { id: 'help.about', menu: 'help', label: '关于启思学堂', action: 'showAbout', separatorBefore: true },
];

function matchesShortcut(event, shortcut) {
  return Boolean(shortcut)
    && event.key.toLowerCase() === shortcut.key
    && Boolean(event.ctrlKey) === Boolean(shortcut.ctrl)
    && Boolean(event.shiftKey) === Boolean(shortcut.shift)
    && Boolean(event.altKey) === Boolean(shortcut.alt)
    && Boolean(event.metaKey) === Boolean(shortcut.meta);
}

export function createCommandRegistry(actions) {
  const commandById = new Map(COMMAND_DEFINITIONS.map(command => [command.id, command]));

  const resolve = command => ({
    ...command,
    enabled: command.enabled ? Boolean(actions[command.enabled]?.()) : true,
  });

  const execute = id => {
    const command = commandById.get(id);
    if (!command || !resolve(command).enabled) return false;
    const action = actions[command.action];
    if (typeof action !== 'function') return false;
    action();
    return true;
  };

  return {
    all: () => COMMAND_DEFINITIONS.map(resolve),
    forMenu: menu => COMMAND_DEFINITIONS.filter(command => command.menu === menu).map(resolve),
    search: query => {
      const normalized = query.trim().toLowerCase();
      const commands = COMMAND_DEFINITIONS.map(resolve);
      return normalized ? commands.filter(command => command.label.toLowerCase().includes(normalized)) : commands;
    },
    execute,
    handleKeydown: event => {
      const command = COMMAND_DEFINITIONS.find(item => matchesShortcut(event, item.shortcut));
      return command ? execute(command.id) : false;
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../frontend/command-registry.js';

function createActions(overrides = {}) {
  const calls = [];
  const actions = new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key];
      return () => calls.push(String(key));
    },
  });
  return { actions, calls };
}

test('command registry supplies unique working commands to every desktop menu', () => {
  const { actions } = createActions({ canCloseTab: () => true, canResumeLearning: () => true });
  const registry = createCommandRegistry(actions);
  const ids = registry.all().map(command => command.id);

  assert.equal(new Set(ids).size, ids.length);
  for (const menu of ['file', 'view', 'learning', 'help']) {
    assert.ok(registry.forMenu(menu).length > 0, `${menu} menu must not be empty`);
  }
});

test('menu execution and keyboard shortcuts invoke the same registered action', () => {
  const { actions, calls } = createActions({ canCloseTab: () => true, canResumeLearning: () => true });
  const registry = createCommandRegistry(actions);

  assert.equal(registry.execute('file.newSubject'), true);
  assert.deepEqual(calls, ['newSubject']);

  const event = { key: 'b', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(registry.handleKeydown(event), true);
  assert.deepEqual(calls, ['newSubject', 'toggleSidebar']);
});

test('disabled contextual commands are visible but cannot execute', () => {
  const { actions, calls } = createActions({ canCloseTab: () => false, canResumeLearning: () => false });
  const registry = createCommandRegistry(actions);

  const close = registry.forMenu('file').find(command => command.id === 'file.closeTab');
  assert.equal(close.enabled, false);
  assert.equal(registry.execute(close.id), false);
  assert.deepEqual(calls, []);
});

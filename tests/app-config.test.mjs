import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfigPayload,
  connectionPresentation,
} from '../frontend/app-config.js';

test('connectionPresentation distinguishes online from configuration failures', () => {
  assert.deepEqual(connectionPresentation({ status: 'online', message: 'AI 老师在线' }), {
    tone: 'ok',
    text: 'AI 老师在线',
  });
  assert.deepEqual(connectionPresentation({ status: 'unconfigured', message: '尚未配置 AI 模型' }), {
    tone: 'warn',
    text: 'AI 老师未配置',
  });
  assert.deepEqual(connectionPresentation({ status: 'auth_error', message: 'API 密钥无效或没有权限' }), {
    tone: 'err',
    text: 'AI 配置错误',
  });
  assert.deepEqual(connectionPresentation({ status: 'endpoint_error', message: 'API 地址不支持模型接口' }), {
    tone: 'err',
    text: 'AI 地址错误',
  });
});

test('buildConfigPayload updates gateway and chat model without dropping task routes', () => {
  const current = {
    base_url: 'http://old.example',
    api_key: 'old-key',
    models: {
      chat: 'old-chat',
      fast: 'fast-model',
      vision: 'vision-model',
      tts: 'tts-model',
    },
  };

  const payload = buildConfigPayload(current, {
    baseUrl: 'http://new.example',
    apiKey: 'new-key',
    chatModel: 'new-chat',
  });

  assert.equal(payload.base_url, 'http://new.example');
  assert.equal(payload.api_key, 'new-key');
  assert.equal(payload.models.chat, 'new-chat');
  assert.equal(payload.models.fast, 'fast-model');
  assert.equal(payload.models.vision, 'vision-model');
  assert.equal(payload.models.tts, 'tts-model');
});

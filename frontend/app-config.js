export function connectionPresentation(health = {}) {
  switch (health.status) {
    case 'online':
      return { tone: 'ok', text: 'AI 老师在线' };
    case 'unconfigured':
      return { tone: 'warn', text: 'AI 老师未配置' };
    case 'auth_error':
      return { tone: 'err', text: 'AI 配置错误' };
    case 'endpoint_error':
      return { tone: 'err', text: 'AI 地址错误' };
    case 'service_error':
      return { tone: 'err', text: 'AI 服务异常' };
    case 'transport_error':
      return { tone: 'err', text: 'AI 老师离线' };
    default:
      return { tone: 'neutral', text: '连接中…' };
  }
}

export function buildConfigPayload(current, fields) {
  return {
    base_url: fields.baseUrl,
    api_key: fields.apiKey,
    models: {
      ...current.models,
      chat: fields.chatModel,
    },
  };
}

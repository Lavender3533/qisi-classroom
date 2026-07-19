# Change: 改进实时课堂可靠性与授课体验

## Why
学生发送消息后可能长时间只看到加载圆点，模型网关返回非标准流时也可能丢失完整回复。课堂中心区缺少明确的教师状态、开场引导和失败恢复，容易显得像普通聊天工具。

## What Changes
- 兼容 SSE、普通 OpenAI JSON 和无换行结尾的流式响应。
- 为等待过程提供分阶段状态、有限超时、明确错误和一键重试。
- 增加开场诊断快捷回答、教师身份与教学阶段标识、输入提示。
- 保持桌面工作台密度，不引入营销页、装饰卡片或无关功能。

## Impact
- Affected specs: continuous-teaching
- Affected code: frontend/app.js、frontend/style.css、src-tauri/src/main.rs

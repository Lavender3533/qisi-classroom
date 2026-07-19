# Change: 强化端到端教学质量闭环

## Why
当前系统已有教师动作、独立判题和纠错闭环，但摸底仍可能按固定轮次追问低信息量经历，教师回合偶尔会脱离当前任务，结构化输出一旦被兼容逻辑破坏还可能泄露内部字段。系统需要把“学生真实作答证据”提升为摸底与课堂推进的统一依据。

## What Changes
- 摸底根据学生回答类型与已获得证据动态跳过低价值阶段；学生声明有基础时直接进入一分钟能力任务。
- 当前待答任务、纠错阶段和迁移复查由客户端约束，教师不得在未完成时换题或宣称掌握。
- 结构化教师输出支持合法 JSON、围栏 JSON、带前后文本 JSON 和常见轻微格式异常；解析失败时安全降级且不显示内部协议。
- 增加覆盖摸底、连续任务、纠错迁移、协议容错和恢复场景的自动评测。

## Impact
- Affected specs: formative-assessment、continuous-teaching、teacher-response-safety
- Affected code: `frontend/teacher-engine.js`、`frontend/teaching-protocol.js`、`frontend/subject-naming.js`、`frontend/app.js`、真实模型评测与契约测试

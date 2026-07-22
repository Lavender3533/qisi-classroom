# Change: 增加可步进的运行时状态图

## Why
纯文字很难让初学者同时区分变量当前值、表达式本次取值和状态更新时机；后续学习对象、引用、栈帧与堆时，这个问题会更明显。课堂需要一套可逐步播放、概念准确且能接受独立复核的运行时状态图，而不是把 Java 局部变量误画成固定内存地址。

## What Changes
- 扩展教师可视化协议，增加 `runtime_state` 图示类型和受限的执行步骤、变量槽、表达式值、栈帧与堆节点结构。
- 在教师消息中渲染可前进、后退和重置的状态演示，并始终显示当前步骤说明与最终结果。
- 对简单 Java 自增和累加表达式优先使用客户端确定性追踪生成状态，模型只决定何时教学使用，不负责臆测执行结果。
- 更复杂的模型生成状态图必须经过现有独立教学复核后才能显示；不确定时降级为静态步骤图。
- 遵守减少动态效果设置，并提供完整的键盘操作和静态文本等价内容。

## Impact
- Affected specs: `interactive-runtime-visualization`
- Affected code: `frontend/code-trace.js`、`frontend/teacher-engine.js`、`frontend/teacher-review.js`、`frontend/app.js`、`frontend/style.css`、相关测试
- Data migration: 无；旧 `visual` 数据继续按静态图示渲染
- External services: 无新增依赖

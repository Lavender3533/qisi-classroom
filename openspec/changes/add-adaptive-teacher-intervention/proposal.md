# Change: 新增自适应教师干预闭环

## Why
当前课堂能判断对错，但教师简报只知道“最近失败”，小测错误还会统一记录为 `concept_gap`。系统无法稳定区分概念混淆、步骤遗漏、语法错误、执行追踪困难、粗心和前置知识缺口，也无法根据重复失败换一种教法，因此仍像会回答问题的聊天模型，而不是持续诊断并调整教学的老师。

## What Changes
- 为教师结构化回合增加有证据约束的 `learning_diagnosis`，记录错因类别、学生原始证据和当前知识点。
- 客户端验证诊断是否引用本轮学生作答，并确定性选择对比讲解、分步示范、语法定位、执行追踪、自检或前置补讲。
- 将当前干预持久化到课堂会话；重复同类错误时缩小任务并换表示方式，再次失败时退回前置知识检查。
- 提示后修正只进入“无提示再检查”，只有同知识点的独立正确证据才能解除干预并继续课程。
- 不再把无法归因的小测错误伪装成概念混淆，保存为待诊断错误。

## Impact
- Affected specs: continuous-teaching、formative-assessment
- Affected code: frontend/teacher-engine.js、frontend/app.js、tests、OpenSpec


# Change: 建立证据驱动教学模型

## Why
真实 Java 课堂中，56 个教师回合有 40 个附带学生任务，而明确讲解仅 3 个；同一自增能力还被保存为多个近义知识点。当前系统虽然已有教案阶段和证据门槛，但知识点名称仍由模型自由生成，单一 `mastery` 数值混合了识别、提示完成、独立完成、迁移和延迟保持，客户端也缺少覆盖推进、停止和降级的完整决策状态机。这会持续造成重复出题、过度检查和错误的课程推进。

## What Changes
- 为每个科目建立持久化的规范知识成分目录，使用稳定 ID、别名、前置关系、心智模型、边界、常见误解和表现目标组织教学。
- 对旧知识点执行保守映射：保留原始记录作为历史来源，只有高置信同义项才归并到同一规范知识成分，歧义项不自动合并。
- 新增追加式学习证据账本，区分 `introduced`、`recognized`、`guided`、`independent`、`transferred` 和 `retained`；所有状态从可信证据派生，不允许模型直接写最终阶段。
- 将现有 `mastery` 百分比降为兼容投影，旧 UI 和调度器迁移期间仍可运行，但不得继续作为课程推进的唯一真相。
- 建立客户端确定性教学决策状态机，统一决定讲解、引导、独立迁移、直接纠错、换表示、退回前置、停止检查和进入下一知识成分。
- 达到独立迁移后立即允许推进；延迟保持通过后续检索确认，不阻塞当天课程；学生明确要求前进时允许推进并安排复习。
- 用结构化讲解合同验证“连接旧知、心智模型、带子目标示例、关键对比/边界和小结”，替代仅凭 `teacher_move=explain` 标记已经讲授。
- 在学习档案中优先展示证据阶段和下一证据缺口，不再把一个模糊百分比作为主要状态。
- 增加真实课堂回放评测，覆盖重复知识点、连续任务、提示后正确、答错直接纠正、概念追问、主动前进、连续失败和延迟复习。

## Impact
- Affected specs: `evidence-driven-instruction`
- Affected code: `src-tauri/src/main.rs`、数据库迁移、`frontend/teacher-engine.js`、`frontend/learning-scheduler.js`、`frontend/app.js`、新增知识成分与教学策略模块、相关测试
- Data migration: 新增规范知识成分、别名和追加式证据表；保留旧 `knowledge_points` 与历史事件，不执行破坏性删除
- Compatibility: `mastery` 在迁移期作为派生投影保留；现有 Tauri 命令保持向后兼容
- Research basis: `docs/TEACHING_QUALITY_RESEARCH.md`


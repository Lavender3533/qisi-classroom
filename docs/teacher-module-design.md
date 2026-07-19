# 启思学堂 · 老师模块设计文档 v2

> 学生端 AI 私教平台，聚焦编程语言教学（首期 Python）。

---

## 一、产品分层

### MVP（首期必须有）
- Python 摸底（聊天 + 测试题）
- 知识画像初版
- 动态教学计划
- 结构化教案 + 校验
- 讲解 + 练习 + 小测
- 底部代码编辑器（安全沙箱）
- 提示链
- 学习事件持久化

### V1.1（后续做）
- 章节考试、错题归因、复习调度、情绪关怀规则、学习报告

### 后续增强
- 遗忘曲线精细建模、多学科、手写识别、家长/教师端

---

## 二、MVP 用户路径

```
1.  学生选择 Python
2.  老师聊天摸底 3-5 个问题
3.  系统生成 5-8 道摸底题
4.  生成知识画像（每个知识点的掌握度）
5.  生成 5-10 节动态学习计划
6.  自动备第一节课（教案 JSON + 校验）
7.  进入课堂
8.  老师讲解一个知识点（结构化输出）
9.  底部弹出代码练习
10. 学生运行代码（沙箱执行）
11. 老师反馈并更新画像
12. 小测
13. 生成本节课总结和下节课建议
```

---

## 三、Python 知识图谱

```json
{
  "subject": "python",
  "version": "python-v0.1",
  "nodes": [
    {
      "id": "python.setup",
      "title": "认识 Python 环境",
      "prerequisites": [],
      "next": ["python.output.print"],
      "difficulty": 1,
      "common_misconceptions": ["不知道在哪里写代码"],
      "assessment_methods": ["quiz"]
    },
    {
      "id": "python.output.print",
      "title": "print 输出",
      "prerequisites": ["python.setup"],
      "next": ["python.variable.assignment"],
      "difficulty": 1,
      "common_misconceptions": ["忘记括号", "忘记引号"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.variable.assignment",
      "title": "变量赋值",
      "prerequisites": ["python.output.print"],
      "next": ["python.type.string", "python.type.number", "python.input.basic"],
      "difficulty": 2,
      "common_misconceptions": ["把等号理解成数学相等", "忘记字符串要加引号"],
      "assessment_methods": ["quiz", "code_practice", "explain_back"]
    },
    {
      "id": "python.type.string",
      "title": "字符串类型",
      "prerequisites": ["python.variable.assignment"],
      "next": ["python.type.string_methods", "python.operator.concat"],
      "difficulty": 2,
      "common_misconceptions": ["单双引号混用", "数字字符串和数字混淆"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.type.number",
      "title": "数字类型",
      "prerequisites": ["python.variable.assignment"],
      "next": ["python.operator.arithmetic", "python.type.bool"],
      "difficulty": 2,
      "common_misconceptions": ["整除和除法混淆"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.input.basic",
      "title": "input 输入",
      "prerequisites": ["python.variable.assignment"],
      "next": ["python.condition.if"],
      "difficulty": 2,
      "common_misconceptions": ["input 返回的永远是字符串"],
      "assessment_methods": ["code_practice"]
    },
    {
      "id": "python.operator.arithmetic",
      "title": "算术运算",
      "prerequisites": ["python.type.number"],
      "next": ["python.condition.if"],
      "difficulty": 2,
      "common_misconceptions": ["运算优先级", "整除 //"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.type.bool",
      "title": "布尔类型",
      "prerequisites": ["python.type.number"],
      "next": ["python.condition.if", "python.logic.bool_ops"],
      "difficulty": 2,
      "common_misconceptions": ["True/False 首字母大写"],
      "assessment_methods": ["quiz"]
    },
    {
      "id": "python.condition.if",
      "title": "if 条件判断",
      "prerequisites": ["python.type.bool", "python.input.basic"],
      "next": ["python.condition.if_else", "python.condition.nested"],
      "difficulty": 3,
      "common_misconceptions": ["用 = 而不是 ==", "缩进错误", "冒号忘记"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.condition.if_else",
      "title": "if-else",
      "prerequisites": ["python.condition.if"],
      "next": ["python.condition.if_elif_else"],
      "difficulty": 3,
      "common_misconceptions": ["else 也必须有冒号"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.condition.if_elif_else",
      "title": "if-elif-else",
      "prerequisites": ["python.condition.if_else"],
      "next": ["python.loop.for"],
      "difficulty": 3,
      "common_misconceptions": ["elif 拼写错误"],
      "assessment_methods": ["code_practice"]
    },
    {
      "id": "python.logic.bool_ops",
      "title": "布尔运算 (and/or/not)",
      "prerequisites": ["python.type.bool"],
      "next": ["python.condition.if"],
      "difficulty": 3,
      "common_misconceptions": ["短路求值不理解"],
      "assessment_methods": ["quiz"]
    },
    {
      "id": "python.loop.for",
      "title": "for 循环",
      "prerequisites": ["python.condition.if_elif_else"],
      "next": ["python.loop.while", "python.list.basic", "python.func.range"],
      "difficulty": 3,
      "common_misconceptions": ["range 的范围", "循环变量作用域"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.loop.while",
      "title": "while 循环",
      "prerequisites": ["python.loop.for"],
      "next": ["python.loop.break_continue"],
      "difficulty": 3,
      "common_misconceptions": ["死循环", "忘记更新条件变量"],
      "assessment_methods": ["quiz", "code_practice"]
    },
    {
      "id": "python.func.basic",
      "title": "函数定义 (def)",
      "prerequisites": ["python.loop.for"],
      "next": ["python.func.params", "python.func.return"],
      "difficulty": 4,
      "common_misconceptions": ["忘记调用", "参数和变量搞混"],
      "assessment_methods": ["quiz", "code_practice", "explain_back"]
    }
  ]
}
```

---

## 四、学生画像数据结构

```json
{
  "student_profile": {
    "knowledge": {
      "python.variable.assignment": {
        "mastery": 0.72,
        "confidence": 0.65,
        "last_practiced_at": "2026-07-10T10:00:00+08:00",
        "practice_count": 5,
        "correct_count": 3,
        "mistake_patterns": ["missing_quotes"]
      }
    },
    "learning_behavior": {
      "average_response_time_sec": 38,
      "hint_usage_rate": 0.35,
      "run_error_rate": 0.42,
      "total_lessons": 3,
      "total_practice_time_min": 45
    },
    "emotion_state": {
      "current": "normal",
      "confidence": 0.6,
      "signals": [],
      "updated_at": "2026-07-10T10:00:00+08:00"
    },
    "preferences": {
      "interests": [],
      "teaching_style": "balanced"
    }
  }
}
```

---

## 五、课堂状态机

```
PREPARE_LESSON     准备阶段：加载教案
       ↓
EXPLAIN            老师讲解知识点（文字 + 配图）
       ↓
CHECK_UNDERSTANDING 确认理解（老师问一个判断题）
       ↓
PRACTICE           弹出代码编辑器，学生动手
       ↓
RUN_CODE           执行代码，获取结果
       ↓
FEEDBACK           老师点评代码（正确/错误 + 建议）
       ↓
QUIZ               小测（选择/填空/代码题）
       ↓
NEXT_STEP          答对→下一个知识点 / 答错→补讲
       ↓
LESSON_SUMMARY     本节课总结 + 下节课预告
```

每个状态规定：
- 学生可以做什么（输入/选择/运行代码/查看提示）
- AI 输出格式（结构化 JSON）
- 是否弹出代码编辑器
- 是否更新知识画像
- 是否记录事件

---

## 六、AI 输出协议（课堂结构化输出）

```json
{
  "state": "explain",
  "message": "变量就像一个贴了名字的盒子...",
  "visual": {
    "type": "memory-diagram",
    "data": { "variables": [{"name": "x", "value": "5"}] }
  },
  "actions": [],
  "student_state_update": {
    "emotion_signal": "normal"
  }
}
```

```json
{
  "state": "practice",
  "message": "来试试创建一个变量吧！",
  "visual": null,
  "actions": [
    {
      "type": "open_practice_panel",
      "practice": {
        "id": "p001",
        "prompt": "创建一个变量 name，存入你的名字",
        "starter_code": "name = ",
        "hints": [
          "字符串需要用引号包起来",
          "name = \"你的名字\"",
          "直接写 name = \"小明\" 即可"
        ],
        "expected_output": null,
        "validation_type": "ast_check",
        "validation_rule": "uses_variable_assignment"
      }
    }
  ],
  "student_state_update": null
}
```

```json
{
  "state": "quiz",
  "message": "来做一道小测题吧！",
  "visual": null,
  "actions": [
    {
      "type": "show_quiz",
      "quiz": {
        "id": "q001",
        "type": "choice",
        "question": "下面哪个是合法的变量名？",
        "options": ["2name", "my_name", "my-name", "class"],
        "answer": 1,
        "knowledge_point": "python.variable.assignment",
        "difficulty": 2
      }
    }
  ],
  "student_state_update": null
}
```

---

## 七、教案校验机制

生成教案后自动校验：
1. **Schema 校验**：JSON 结构符合教案格式
2. **知识点覆盖**：覆盖计划中的知识点
3. **代码运行校验**：代码题的参考答案能正确运行
4. **选择题答案校验**：答案索引在选项范围内
5. **前置知识校验**：知识点的前置依赖已学过

```json
{
  "validation": {
    "schema_valid": true,
    "code_examples_passed": true,
    "quiz_answers_checked": true,
    "prerequisites_satisfied": true,
    "risk_flags": []
  }
}
```

---

## 八、错因分类标准

| 代码 | 含义 | 说明 |
|------|------|------|
| concept_gap | 概念不清 | 不理解知识点本身 |
| syntax_error | 语法错误 | 拼写、标点、缩进 |
| runtime_error | 运行错误 | 代码能写但跑不了 |
| careless | 粗心 | 明显会但不小心 |
| misread_prompt | 读题偏差 | 没看清题目要求 |
| missing_prereq | 前置知识缺失 | 缺少必要的基础 |
| overfit_example | 只会照抄 | 换个形式就不会 |

---

## 九、老师人格规范

- 不羞辱、不讽刺、不说"这么简单"
- 不过度夸奖，表扬要具体（"你这次变量命名很规范"）
- 不直接给答案，除非提示链到最后
- 零基础学生避免术语堆叠
- 每次讲解控制长度（一段不超过 150 字）
- 每个概念必须有例子
- 学生连续失败时先降难度，再鼓励
- 不假装知道学生未表达过的事实
- 情绪判断必须基于行为信号，不能武断诊断

---

## 十、代码执行安全策略

### MVP 方案：受限子进程
- 执行超时：5 秒
- 内存限制：64MB
- 禁止网络访问
- 禁止文件系统写入
- 禁止危险模块（os, sys, subprocess, socket）
- 输出截断：最大 10KB
- 非生产方案，仅限开发/演示

### 判题方式
- 输出匹配
- 单元测试断言
- AST 检查（检查是否用了目标语法）
- 错误类型分析

---

## 十一、学习事件日志

```json
{
  "event_type": "practice_submit",
  "subject_id": "python",
  "knowledge_points": ["python.variable.assignment"],
  "input_code": "name = xiaoming",
  "run_result": {
    "success": false,
    "error_type": "NameError",
    "output": ""
  },
  "hint_level_used": 2,
  "timestamp": "2026-07-10T10:15:00+08:00"
}
```

---

## 十二、版本管理

```json
{
  "curriculum_version": "python-v0.1",
  "lesson_plan_version": "2026-07-10-001",
  "generated_by": "mimo-v2.5-pro",
  "review_status": "auto_validated"
}
```

---

## 十三、系统架构

```
前端课堂界面
├─ 讲解区（结构化渲染）
├─ 可视化渲染器（SVG/HTML）
├─ 底部代码编辑器
└─ 测验/提示组件

Rust 后端（Tauri Commands）
├─ 学生画像服务
├─ 教学计划服务
├─ 教案生成服务 + 校验
├─ 课堂编排服务（状态机）
├─ 判题/代码运行服务（沙箱）
├─ 错因分析服务
└─ 事件日志服务

数据层（SQLite）
├─ 科目表
├─ 知识图谱表
├─ 学生知识画像表
├─ 学习事件表
├─ 教案表
├─ 对话历史表
└─ 错题表

模型层
├─ mimo-v2.5-pro：教案生成、讲解、分析
├─ mimo-v2.5：短回复、提示
└─ mimo-v2-omni：未来识图
```

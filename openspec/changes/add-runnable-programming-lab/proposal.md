# Change: 增加可运行编程实验区

## Why
编程课目前主要依赖文字讲解、代码阅读和提交后反馈。学生无法在讲解旁亲手创建类、修改表达式并立即观察真实编译与运行结果，导致 `++i`、`i++`、对象引用等执行语义仍停留在抽象描述。

## What Changes
- 在编程课堂增加可调整尺寸的实验区：宽屏停靠在教学内容右侧，窄屏自动转为底部面板，不覆盖学习档案。
- 教师可随教案创建一个最小实验工程；学生直接编辑文件、运行、查看标准输出、编译错误和执行耗时。
- 第一阶段支持本机 JDK 21 的单文件 Java 实验，并复用现有 CodeMirror 与课程项目文件能力；后续语言通过统一运行协议扩展。
- 为 `++i/i++`、String 引用比较等课堂概念提供可运行的最小模板，但必须由学生亲手运行或修改，不把预设输出当作学习证据。
- 将学生代码、真实运行结果与当前任务键绑定；只有经过任务判定的结果才进入掌握证据，单纯点击运行不改变掌握度。
- Java 运行采用临时工作目录、无外部依赖 classpath、输入大小限制、进程超时、输出上限和危险 API 拒绝；仅执行本机学生明确点击运行的代码，不自动执行模型回复中的任意代码。

## Impact
- Affected specs: `runnable-programming-lab`、`student-app`
- Affected code: `frontend/app.js`、`frontend/codemirror-setup.js`、新增实验区状态模块、`frontend/style.css`、`src-tauri/src/main.rs`、测试
- Data migration: 无；教学会话和学习事件增加可选实验记录，保持向后兼容
- Runtime dependency: 本机 JDK（`javac` 与 `java`）；缺失时显示明确安装提示，课堂讲解仍可继续


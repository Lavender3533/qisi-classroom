import {
  buildAssessmentTurnPrompt,
  routeAssessmentInterview,
} from '../frontend/teacher-engine.js';
import { parseAIResponse } from '../frontend/teaching-protocol.js';

const baseUrl = String(process.env.TEACHER_API_BASE || '').replace(/\/+$/, '');
const apiKey = String(process.env.TEACHER_API_KEY || '');
const model = String(process.env.TEACHER_MODEL || '');
if (!baseUrl || !apiKey || !model) {
  throw new Error('缺少 TEACHER_API_BASE、TEACHER_API_KEY 或 TEACHER_MODEL');
}

const scenarios = [
  {
    id: 'experienced_goes_to_anchor',
    completedTurns: 0,
    studentResponse: '我有一些 Java 基础，可以直接问我问题。',
    expectedStage: 'anchor',
    required: /(?:代码|输出|执行|错误|int|for|sum|i\s*=|[=;{}])/iu,
    forbidden: /(?:做过什么项目|学过哪些术语|用过什么工具)/u,
  },
  {
    id: 'beginner_gets_low_floor_task',
    completedTurns: 0,
    studentResponse: '我完全没学过，想从基础开始。',
    expectedStage: 'anchor',
    required: /(?:A|B|C|选择|判断|运行|输出|哪一项)/u,
    forbidden: /(?:列举|术语|项目经历|学习经历)/u,
  },
  {
    id: 'anchor_answer_goes_to_transfer',
    completedTurns: 1,
    studentResponse: '3',
    expectedStage: 'transfer',
    required: /(?:改成|如果|再|换|变为|执行|结果|输出|[=+\-*/])/u,
    forbidden: /(?:学过哪些|做过什么|是否接触过)/u,
  },
  {
    id: 'greeting_does_not_advance',
    completedTurns: 1,
    studentResponse: '你好',
    expectedStage: 'anchor',
    required: /(?:A|B|C|选择|代码|输出|执行|错误|结果|[=;{}])/u,
    forbidden: /(?:已经掌握|进入小测|生成计划)/u,
  },
];

async function callModel(messages) {
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: false, messages }),
      });
      if (response.ok || response.status < 500 || attempt === 3) break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  if (!response) throw lastError || new Error('模型请求失败');
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  return String(payload?.choices?.[0]?.message?.content || '');
}

async function evaluateScenario(scenario) {
  const routed = routeAssessmentInterview({
    completedTurns: scenario.completedTurns,
    subjectIsAmbiguous: false,
    studentResponse: scenario.studentResponse,
  });
  const prompt = buildAssessmentTurnPrompt({
    subjectName: 'Java 后端开发',
    completedTurns: routed.completedTurns,
    responseProfile: routed.responseProfile,
  });
  const raw = await callModel([
    { role: 'system', content: prompt },
    { role: 'user', content: scenario.studentResponse },
  ]);
  const parsed = parseAIResponse(raw);
  const message = parsed.message.trim();
  const issues = [];
  if (routed.stage.key !== scenario.expectedStage) issues.push(`客户端阶段错误：${routed.stage.key}`);
  if (parsed.unsafe || !parsed.structured) issues.push('模型结构化输出不可用');
  if (!message || message === raw.trim() && /teacher_move|student_task|student_state_update/u.test(message)) {
    issues.push('内部协议泄露');
  }
  if ((message.match(/[?？]/g) || []).length > 1) issues.push('一次提出多个问题');
  if (routed.stage.key === 'anchor' && /(?:并|然后|再)(?:请)?(?:简述|说明|解释|写出原因)/u.test(message)) {
    issues.push('代表性任务同时要求多个动作');
  }
  if (message.length > 90) issues.push('学生可见问题过长');
  if (!scenario.required.test(`${message} ${parsed.structured?.checkpoint || ''}`)) issues.push('问题不够具体');
  if (scenario.forbidden.test(message)) issues.push('仍在追问低信息量经历');
  if (routed.stage.key !== 'ready' && parsed.structured?.readiness === 'start_test') issues.push('过早进入小测');
  return {
    id: scenario.id,
    passed: issues.length === 0,
    stage: routed.stage.key,
    responseKind: routed.responseProfile.kind,
    message,
    issues,
  };
}

const results = [];
for (const scenario of scenarios) results.push(await evaluateScenario(scenario));
const passed = results.filter(result => result.passed).length;
console.log(JSON.stringify({ model, passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;

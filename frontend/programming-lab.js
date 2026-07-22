const MAX_SOURCE_LENGTH = 64 * 1024;

function clean(value, limit = 160) {
  return String(value || '').trim().slice(0, limit);
}

export function createJavaLabForFocus(focus = '') {
  const normalizedFocus = clean(focus, 100);
  if (/string|引用|equals|==/iu.test(normalizedFocus)) {
    return {
      id: 'java-string-reference', language: 'java', title: 'String 引用实验', fileName: 'Main.java',
      goal: '运行并比较 == 与 equals() 的结果',
      observations: ['先预测三行输出', '运行后比较引用相同与内容相同'],
      initialCode: `public class Main {
    public static void main(String[] args) {
        String s1 = new String("Java");
        String s2 = new String("Java");
        String s3 = s1;

        System.out.println("s1 == s2: " + (s1 == s2));
        System.out.println("s1.equals(s2): " + s1.equals(s2));
        System.out.println("s1 == s3: " + (s1 == s3));
    }
}`,
    };
  }
  return {
    id: 'java-increment-order', language: 'java', title: '自增运算实验', fileName: 'Main.java',
    goal: '观察 ++i 与 i++ 在表达式中的取值和更新顺序',
    observations: ['先预测 r 与 i', '修改初始值后再次运行'],
    initialCode: `public class Main {
    public static void main(String[] args) {
        int i = 3;
        int r = ++i + i++;

        System.out.println("r = " + r);
        System.out.println("i = " + i);
    }
}`,
  };
}

export function normalizeCodingLab(raw, { focus = '', taskKey = '' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (clean(raw.language || 'java', 20).toLowerCase() !== 'java') return null;
  const fallback = createJavaLabForFocus(focus);
  const initialCode = String(raw.initial_code || raw.initialCode || raw.code || fallback.initialCode).slice(0, MAX_SOURCE_LENGTH);
  if (!/public\s+class\s+[A-Za-z_]\w*/u.test(initialCode) || !/public\s+static\s+void\s+main/u.test(initialCode)) return null;
  const publicClass = initialCode.match(/public\s+class\s+([A-Za-z_]\w*)/u)?.[1] || 'Main';
  const observations = (Array.isArray(raw.observations) ? raw.observations : fallback.observations)
    .map(item => clean(item, 100)).filter(Boolean).slice(0, 4);
  return {
    id: clean(raw.id || fallback.id, 100), language: 'java', title: clean(raw.title || fallback.title, 80),
    fileName: `${publicClass}.java`, goal: clean(raw.goal || fallback.goal, 180), observations, initialCode,
    code: initialCode, taskKey: clean(taskKey, 220),
    status: 'ready', runResult: null, dirty: false,
  };
}

export function updateLabAfterRun(lab, result) {
  if (!lab) return null;
  return {
    ...lab, status: result?.success ? 'succeeded' : 'failed',
    runResult: {
      success: Boolean(result?.success), stdout: String(result?.stdout || '').slice(0, 32 * 1024),
      stderr: String(result?.stderr || '').slice(0, 32 * 1024),
      errorType: clean(result?.error_type || result?.errorType, 40),
      executionTimeMs: Math.max(0, Number(result?.execution_time_ms || result?.executionTimeMs) || 0),
      ranAt: new Date().toISOString(),
    },
  };
}

export function buildLabSubmission(lab) {
  if (!lab?.taskKey || !lab?.runResult) return null;
  return {
    taskKey: lab.taskKey, code: String(lab.code || ''), stdout: lab.runResult.stdout,
    stderr: lab.runResult.stderr, success: lab.runResult.success,
  };
}

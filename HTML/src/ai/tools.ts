/**
 * AI 工具注册表 —— 让 AI 助手能够调用本软件的不同模块（function calling）。
 *
 * 设计：
 *   - 每个工具 = 一个 JSON Schema + 一个 executor（最终落到 taskAPI 对应命名空间）
 *   - 安全边界：写操作走「预演 → 用户确认」（与旧版 ai.plan / ai.confirm 语义一致），
 *     executor 不直接写库；确认后由 confirmToolCall 走 taskAPI 唯一写入口
 *   - 读工具可直接执行（列表/统计/查询）
 */
import type { AiToolDef } from '../cloud/aiGateway';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  /** 传回模型的 JSON 字符串 */
  payload: string;
  /** 写操作：待确认的预演信息（diff） */
  pendingAction?: PendingAction;
}

export interface PendingAction {
  kind: string;
  label: string;
  params: Record<string, any>;
  diff: Array<{ field: string; before: string; after: string }>;
  danger?: boolean;
}

// ===== 工具定义（发给模型的 schema）=====

export const TOOL_DEFS: AiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'query_courses',
      description: '查询课程列表（含 id/name/teacher/semester/color）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_tasks',
      description: '查询作业/待办列表，可按状态过滤（pending/in_progress/done/overdue）',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '状态过滤，可选' },
          dueWithinDays: { type: 'number', description: '只看 N 天内到期，可选' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_events',
      description: '查询日程/考试安排，可按时间范围（毫秒时间戳）',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'number', description: '起始时间戳 ms' },
          to: { type: 'number', description: '结束时间戳 ms' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stats',
      description: '查询仪表盘统计（待办数/逾期数/今日日程/进行中项目）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '新建作业/待办（写操作，需要用户确认后才会落库）',
      parameters: {
        type: 'object',
        properties: {
          courseName: { type: 'string', description: '课程名（找不到会自动建课）' },
          title: { type: 'string', description: '作业标题' },
          dueDate: { type: 'number', description: '截止时间戳 ms' },
          type: { type: 'string', description: 'homework/exam/project/reading/other' },
          priority: { type: 'number', description: '1高 2中 3低' },
          description: { type: 'string' },
        },
        required: ['title', 'dueDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: '新建日程/考试（写操作，需要用户确认后才会落库）',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startAt: { type: 'number', description: '开始时间戳 ms' },
          endAt: { type: 'number', description: '结束时间戳 ms' },
          location: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['title', 'startAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'import_timetable_hint',
      description: '给出课表 Excel 导入的建议（AI 智能识别模式说明）；当用户想导入课表时调用',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// ===== 执行器（只读直接跑；写操作生成预演）=====

export interface ToolExecContext {
  api: any; // window.taskAPI
}

export async function executeToolCall(call: ToolCall, ctx: ToolExecContext): Promise<ToolResult> {
  let params: any = {};
  try { params = call.arguments ? JSON.parse(call.arguments) : {}; } catch { /* 空参 */ }
  const api = ctx.api;
  const base = { toolCallId: call.id, name: call.name };

  try {
    switch (call.name) {
      case 'query_courses': {
        const rows = await api.db.courses.list();
        return { ...base, ok: true, payload: JSON.stringify({ courses: rows.slice(0, 50) }) };
      }
      case 'query_tasks': {
        let rows = await api.db.requirements.list();
        if (params.status) rows = rows.filter((r: any) => r.status === params.status);
        if (params.dueWithinDays) {
          const limit = Date.now() + params.dueWithinDays * 86400000;
          rows = rows.filter((r: any) => r.due_date <= limit);
        }
        return { ...base, ok: true, payload: JSON.stringify({ tasks: rows.slice(0, 50) }) };
      }
      case 'query_events': {
        const rows = await api.db.events.list({ from: params.from ?? Date.now() - 7 * 86400000, to: params.to ?? Date.now() + 30 * 86400000 });
        return { ...base, ok: true, payload: JSON.stringify({ events: rows.slice(0, 50) }) };
      }
      case 'query_stats': {
        const s = await api.db.stats.dashboard();
        return { ...base, ok: true, payload: JSON.stringify(s) };
      }
      case 'create_task': {
        const action: PendingAction = {
          kind: 'create_task',
          label: `新建作业：${params.title}`,
          params,
          diff: [
            { field: '课程', before: '—', after: params.courseName || '（未指定）' },
            { field: '标题', before: '—', after: params.title },
            { field: '截止', before: '—', after: params.dueDate ? new Date(params.dueDate).toLocaleString() : '—' },
            { field: '优先级', before: '—', after: ['', '高', '中', '低'][params.priority || 2] },
          ],
        };
        return { ...base, ok: true, payload: JSON.stringify({ status: 'pending_confirmation', hint: '已生成待确认操作，请用户点击确认卡片' }), pendingAction: action };
      }
      case 'create_event': {
        const action: PendingAction = {
          kind: 'create_event',
          label: `新建日程：${params.title}`,
          params,
          diff: [
            { field: '标题', before: '—', after: params.title },
            { field: '开始', before: '—', after: new Date(params.startAt).toLocaleString() },
            { field: '地点', before: '—', after: params.location || '—' },
          ],
        };
        return { ...base, ok: true, payload: JSON.stringify({ status: 'pending_confirmation' }), pendingAction: action };
      }
      case 'import_timetable_hint': {
        return {
          ...base, ok: true,
          payload: JSON.stringify({
            hint: '课程页 → Excel 导入按钮 → 向导支持「AI 智能识别」：把表格内容发给 AI 自动推断列映射与学期信息，也支持手动选学校档案（通用/齐鲁）。',
          }),
        };
      }
      default:
        return { ...base, ok: false, payload: JSON.stringify({ error: `未知工具: ${call.name}` }) };
    }
  } catch (e: any) {
    return { ...base, ok: false, payload: JSON.stringify({ error: e?.message || String(e) }) };
  }
}

/** 用户确认后执行写操作（唯一写入口） */
export async function confirmToolCall(action: PendingAction, ctx: ToolExecContext): Promise<{ ok: boolean; message: string; id?: number }> {
  const api = ctx.api;
  if (action.kind === 'create_task') {
    let courseId: number | null = null;
    if (action.params.courseName) {
      const courses = await api.db.courses.list();
      const hit = courses.find((c: any) => c.name === action.params.courseName);
      if (hit) courseId = hit.id;
      else {
        const created = await api.db.courses.create({ name: action.params.courseName });
        courseId = created?.id ?? null;
      }
    }
    const row = await api.db.requirements.create({
      course_id: courseId,
      title: action.params.title,
      type: action.params.type || 'homework',
      description: action.params.description ?? null,
      due_date: action.params.dueDate,
      priority: action.params.priority ?? 2,
      status: 'pending',
    });
    return { ok: true, message: `已创建作业「${action.params.title}」`, id: row?.id };
  }
  if (action.kind === 'create_event') {
    const row = await api.db.events.create({
      title: action.params.title,
      start_at: action.params.startAt,
      end_at: action.params.endAt ?? null,
      location: action.params.location ?? null,
      notes: action.params.notes ?? null,
    });
    return { ok: true, message: `已创建日程「${action.params.title}」`, id: row?.id };
  }
  return { ok: false, message: `未知操作: ${action.kind}` };
}

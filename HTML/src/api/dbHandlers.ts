/**
 * db.* 命名空间实现（76 个方法）—— tauri / sqljs 共用的 SQL 数据访问层。
 *
 * 【契约兼容】返回形状与 electron/ipc/index.ts 逐一对齐：
 *   create/update 返回**整行**（SELECT * WHERE id），不是 {ok}；
 *   列名以 migrations/001_init.sql 为准（events.start_at / project_tasks.order_index / …）。
 * courseKey / guid 计算规则与旧版完全一致（同名同教师课程跨设备一致）。
 */
import type { SqlExecutor } from './platform';

const GUID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** CK- + sha256(name|teacher) 映射 32 字符表取 10 位（与 electron/db computeCourseKey 一致） */
export async function computeCourseKey(name: string, teacher: string): Promise<string> {
  const enc = new TextEncoder().encode(`${name}|${teacher ?? ''}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < 10; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return 'CK-' + out;
}

export function generateGuid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = 'C-';
  for (const b of bytes) out += GUID_ALPHABET[b % GUID_ALPHABET.length];
  return out;
}

export function createDbHandlers(sql: SqlExecutor) {
  async function lastRow<T = any>(table: string): Promise<T | null> {
    const idRow = await sql.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    if (!idRow?.id) return null;
    return sql.get<T>(`SELECT * FROM ${table} WHERE id = ?`, [idRow.id]);
  }
  /** 建课/改课后刷新 course_key（确定性派生） */
  async function refreshCourseKeys(): Promise<void> {
    const rows = await sql.all<{ id: number; name: string; instructor: string | null }>('SELECT id, name, instructor FROM courses');
    for (const r of rows) {
      const key = await computeCourseKey(r.name, r.instructor || '');
      await sql.run('UPDATE courses SET course_key = ? WHERE id = ?', [key, r.id]);
    }
  }

  return {
    // ===== courses =====
    'db:courses:list': () => sql.all('SELECT * FROM courses ORDER BY created_at DESC'),
    'db:courses:get': (id: number) => sql.get('SELECT * FROM courses WHERE id = ?', [id]),
    'db:courses:create': async (data: any) => {
      await sql.run(
        `INSERT INTO courses (name, code, instructor, semester, color, description, tags, guid, credit, category, course_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.name, data.code ?? null, data.instructor ?? null, data.semester ?? null,
         data.color ?? '#00FF88', data.description ?? null,
         JSON.stringify(data.tags || []), data.guid || generateGuid(),
         data.credit ?? 0, data.category ?? 'elective', data.course_status ?? 'taking', Date.now()],
      );
      await refreshCourseKeys();
      return lastRow('courses');
    },
    'db:courses:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE courses SET name=?, code=?, instructor=?, semester=?, color=?, description=?, tags=?, credit=?, category=?, course_status=? WHERE id=?`,
        [data.name, data.code ?? null, data.instructor ?? null, data.semester ?? null,
         data.color ?? null, data.description ?? null, JSON.stringify(data.tags || []),
         data.credit ?? 0, data.category ?? 'elective', data.course_status ?? 'taking', id],
      );
      await refreshCourseKeys();
      return sql.get('SELECT * FROM courses WHERE id = ?', [id]);
    },
    'db:courses:delete': async (id: number) => {
      await sql.run('DELETE FROM events WHERE course_id = ?', [id]);
      await sql.run('DELETE FROM course_requirements WHERE course_id = ?', [id]);
      await sql.run('DELETE FROM course_notes WHERE course_id = ?', [id]);
      await sql.run('DELETE FROM courses WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== requirements =====
    'db:requirements:list': (filter?: any) => {
      let where = '';
      const params: any[] = [];
      if (filter?.courseId) { where = ' WHERE r.course_id = ?'; params.push(filter.courseId); }
      return sql.all(
        `SELECT r.*, c.name AS course_name, c.color AS course_color
         FROM course_requirements r LEFT JOIN courses c ON r.course_id = c.id${where}
         ORDER BY r.due_date ASC`,
        params,
      );
    },
    'db:requirements:create': async (data: any) => {
      await sql.run(
        `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, estimated_hours, actual_hours, notes, created_at, completed_at, recurrence, source, remote_id, session_date, publisher)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.course_id, data.title, data.type ?? 'homework', data.description ?? null,
         data.due_date, data.priority ?? 2, data.status ?? 'pending',
         data.estimated_hours ?? null, data.actual_hours ?? null, data.notes ?? null,
         Date.now(), data.status === 'done' ? Date.now() : null, data.recurrence ?? null,
         data.source ?? 'local', data.remote_id ?? null, data.session_date ?? null, data.publisher ?? null],
      );
      return lastRow('course_requirements');
    },
    'db:requirements:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE course_requirements SET title=?, type=?, description=?, due_date=?, priority=?, status=?,
           estimated_hours=?, actual_hours=?, notes=?, completed_at=?, recurrence=? WHERE id=?`,
        [data.title, data.type ?? 'homework', data.description ?? null, data.due_date,
         data.priority ?? 2, data.status ?? 'pending', data.estimated_hours ?? null,
         data.actual_hours ?? null, data.notes ?? null,
         data.status === 'done' ? (data.completed_at ?? Date.now()) : null,
         data.recurrence ?? null, id],
      );
      return sql.get('SELECT * FROM course_requirements WHERE id = ?', [id]);
    },
    'db:requirements:delete': async (id: number) => {
      await sql.run('DELETE FROM course_requirements WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== events =====
    'db:events:list': (filter?: any) => {
      let where = '';
      const params: any[] = [];
      if (filter?.from && filter?.to) {
        where = ' WHERE e.start_at >= ? AND e.start_at < ?';
        params.push(filter.from, filter.to);
      } else if (filter?.from) {
        where = ' WHERE e.start_at >= ?';
        params.push(filter.from);
      }
      return sql.all(
        `SELECT e.*, c.name AS course_name, c.color AS course_color,
                cat.name AS category_name, cat.color AS category_color, cat.emoji AS category_emoji
         FROM events e
         LEFT JOIN courses c ON e.course_id = c.id
         LEFT JOIN categories cat ON e.category_id = cat.id${where}
         ORDER BY e.start_at ASC`,
        params,
      );
    },
    'db:events:create': async (data: any) => {
      await sql.run(
        `INSERT INTO events (title, start_at, end_at, location, recurrence, recurrence_end, course_id, color, notes, all_day, reminder_minutes, category_id, type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.title, data.start_at, data.end_at ?? null, data.location ?? null,
         data.recurrence ?? null, data.recurrence_end ?? null, data.course_id ?? null,
         data.color ?? null, data.notes ?? null, data.all_day ? 1 : 0,
         data.reminder_minutes ?? null, data.category_id ?? null, data.type ?? 'event'],
      );
      return lastRow('events');
    },
    'db:events:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE events SET title=?, start_at=?, end_at=?, location=?, recurrence=?, recurrence_end=?,
           course_id=?, color=?, notes=?, all_day=?, reminder_minutes=?, category_id=?, type=? WHERE id=?`,
        [data.title, data.start_at, data.end_at ?? null, data.location ?? null,
         data.recurrence ?? null, data.recurrence_end ?? null, data.course_id ?? null,
         data.color ?? null, data.notes ?? null, data.all_day ? 1 : 0,
         data.reminder_minutes ?? null, data.category_id ?? null, data.type ?? 'event', id],
      );
      return sql.get('SELECT * FROM events WHERE id = ?', [id]);
    },
    'db:events:delete': async (id: number) => {
      await sql.run('DELETE FROM events WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== categories =====
    'db:categories:list': () => sql.all('SELECT * FROM categories ORDER BY id'),
    'db:categories:create': async (data: any) => {
      await sql.run('INSERT INTO categories (name, color, emoji, created_at) VALUES (?, ?, ?, ?)',
        [data.name, data.color ?? '#00FF88', data.emoji ?? null, Date.now()]);
      return lastRow('categories');
    },
    'db:categories:update': async (id: number, data: any) => {
      await sql.run('UPDATE categories SET name=?, color=?, emoji=? WHERE id=?',
        [data.name, data.color ?? null, data.emoji ?? null, id]);
      return sql.get('SELECT * FROM categories WHERE id = ?', [id]);
    },
    'db:categories:delete': async (id: number) => {
      await sql.run('DELETE FROM categories WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== userProfiles =====
    'db:userProfiles:list': () => sql.all('SELECT * FROM user_profiles ORDER BY updated_at DESC'),
    'db:userProfiles:getActive': () => sql.get('SELECT * FROM user_profiles WHERE is_active = 1 LIMIT 1'),
    'db:userProfiles:getByOpenid': (openid: string) =>
      sql.get('SELECT * FROM user_profiles WHERE wx_openid = ?', [openid]),
    'db:userProfiles:create': async (data: any) => {
      const now = Date.now();
      await sql.run(
        `INSERT INTO user_profiles (username, password_hash, wx_openid, wx_nickname, wx_avatar, student_id, real_name, school, college, major, class_name, enroll_year, graduate_year, program, degree_level, custom_fields, encrypted_fields, privacy_mode, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.username ?? null, data.password_hash ?? null,
         data.wx_openid ?? null, data.wx_nickname ?? null, data.wx_avatar ?? null,
         data.student_id ?? null, data.real_name ?? null, data.school ?? null,
         data.college ?? null, data.major ?? null, data.class_name ?? null,
         data.enroll_year ?? null, data.graduate_year ?? null, data.program ?? null,
         data.degree_level ?? null, JSON.stringify(data.custom_fields || []), data.encrypted_fields ?? null,
         data.privacy_mode ? 1 : 0, data.is_active ? 1 : 0, now, now],
      );
      return lastRow('user_profiles');
    },
    'db:userProfiles:update': async (id: number, data: any) => {
      const now = Date.now();
      await sql.run(
        `UPDATE user_profiles SET username=?, password_hash=?, wx_openid=?, wx_nickname=?, wx_avatar=?,
           student_id=?, real_name=?, school=?, college=?, major=?, class_name=?, enroll_year=?, graduate_year=?,
           program=?, degree_level=?, custom_fields=?, encrypted_fields=?, privacy_mode=?, is_active=?, updated_at=?
         WHERE id=?`,
        [data.username ?? null, data.password_hash ?? null,
         data.wx_openid ?? null, data.wx_nickname ?? null, data.wx_avatar ?? null,
         data.student_id ?? null, data.real_name ?? null, data.school ?? null,
         data.college ?? null, data.major ?? null, data.class_name ?? null,
         data.enroll_year ?? null, data.graduate_year ?? null, data.program ?? null,
         data.degree_level ?? null, JSON.stringify(data.custom_fields || []), data.encrypted_fields ?? null,
         data.privacy_mode ? 1 : 0, data.is_active ? 1 : 0, now, id],
      );
      return sql.get('SELECT * FROM user_profiles WHERE id = ?', [id]);
    },
    'db:userProfiles:delete': async (id: number) => {
      await sql.run('DELETE FROM user_profiles WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:userProfiles:setActive': async (id: number) => {
      await sql.run('UPDATE user_profiles SET is_active = 0 WHERE is_active = 1');
      await sql.run('UPDATE user_profiles SET is_active = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
      return sql.get('SELECT * FROM user_profiles WHERE id = ?', [id]);
    },

    // ===== courseNotes =====
    'db:courseNotes:list': (courseId: number) =>
      sql.all('SELECT * FROM course_notes WHERE course_id = ? ORDER BY created_at DESC', [courseId]),
    'db:courseNotes:create': async (data: any) => {
      await sql.run('INSERT INTO course_notes (course_id, content, created_at) VALUES (?, ?, ?)',
        [data.course_id, data.content, Date.now()]);
      return lastRow('course_notes');
    },
    'db:courseNotes:update': async (id: number, data: any) => {
      await sql.run('UPDATE course_notes SET content=? WHERE id=?', [data.content, id]);
      return sql.get('SELECT * FROM course_notes WHERE id = ?', [id]);
    },
    'db:courseNotes:delete': async (id: number) => {
      await sql.run('DELETE FROM course_notes WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== projects / tasks =====
    'db:projects:list': () => sql.all('SELECT * FROM projects ORDER BY id'),
    'db:projects:get': (id: number) => sql.get('SELECT * FROM projects WHERE id = ?', [id]),
    'db:projects:create': async (data: any) => {
      await sql.run(
        `INSERT INTO projects (name, description, status, start_date, due_date, progress, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.name, data.description ?? null, data.status ?? 'active',
         data.start_date ?? null, data.due_date ?? null, data.progress ?? 0, Date.now()],
      );
      return lastRow('projects');
    },
    'db:projects:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE projects SET name=?, description=?, status=?, start_date=?, due_date=?, progress=?, completed_at=? WHERE id=?`,
        [data.name, data.description ?? null, data.status ?? 'active',
         data.start_date ?? null, data.due_date ?? null, data.progress ?? 0,
         data.status === 'done' ? Date.now() : null, id],
      );
      return sql.get('SELECT * FROM projects WHERE id = ?', [id]);
    },
    'db:projects:delete': async (id: number) => {
      await sql.run('DELETE FROM project_tasks WHERE project_id = ?', [id]);
      await sql.run('DELETE FROM projects WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:tasks:list': (filter?: any) => {
      if (filter?.projectId) return sql.all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index ASC, id ASC', [filter.projectId]);
      return sql.all('SELECT * FROM project_tasks ORDER BY order_index ASC, id ASC');
    },
    'db:tasks:create': async (data: any) => {
      await sql.run(
        `INSERT INTO project_tasks (project_id, course_id, title, status, assignee, due_date, order_index, priority, description, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.project_id, data.course_id ?? null, data.title, data.status ?? 'todo',
         data.assignee ?? null, data.due_date ?? null, data.order_index ?? 0,
         data.priority ?? 1, data.description ?? null,
         data.status === 'done' ? Date.now() : null],
      );
      return lastRow('project_tasks');
    },
    'db:tasks:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE project_tasks SET title=?, status=?, assignee=?, due_date=?, order_index=?, priority=?, description=?, done_at=? WHERE id=?`,
        [data.title, data.status ?? 'todo', data.assignee ?? null, data.due_date ?? null,
         data.order_index ?? 0, data.priority ?? 1, data.description ?? null,
         data.status === 'done' ? Date.now() : null, id],
      );
      return sql.get('SELECT * FROM project_tasks WHERE id = ?', [id]);
    },
    'db:tasks:delete': async (id: number) => {
      await sql.run('DELETE FROM project_tasks WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== canvases（画布编辑器）=====
    'db:canvases:list': () => sql.all('SELECT * FROM canvases ORDER BY id'),
    'db:canvases:get': (id: number) => sql.get('SELECT * FROM canvases WHERE id = ?', [id]),
    'db:canvases:getByProject': (projectId: number) =>
      sql.all('SELECT * FROM canvases WHERE project_id = ? ORDER BY id', [projectId]),
    'db:canvases:create': async (data: any) => {
      const now = Date.now();
      await sql.run(
        'INSERT INTO canvases (name, description, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [data.name, data.description ?? null, data.project_id ?? null, now, now],
      );
      return lastRow('canvases');
    },
    'db:canvases:update': async (id: number, data: any) => {
      await sql.run(
        'UPDATE canvases SET name=?, description=?, viewport_x=?, viewport_y=?, viewport_zoom=?, updated_at=? WHERE id=?',
        [data.name ?? null, data.description ?? null,
         data.viewport_x ?? 0, data.viewport_y ?? 0, data.viewport_zoom ?? 1, Date.now(), id],
      );
      return sql.get('SELECT * FROM canvases WHERE id = ?', [id]);
    },
    'db:canvases:delete': async (id: number) => {
      await sql.run('DELETE FROM canvas_nodes WHERE canvas_id = ?', [id]);
      await sql.run('DELETE FROM canvas_edges WHERE canvas_id = ?', [id]);
      await sql.run('DELETE FROM canvases WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:canvasNodes:listByCanvas': (canvasId: number) =>
      sql.all('SELECT * FROM canvas_nodes WHERE canvas_id = ? ORDER BY id', [canvasId]),
    'db:canvasNodes:create': async (data: any) => {
      const now = Date.now();
      await sql.run(
        `INSERT INTO canvas_nodes (canvas_id, node_type, entity_id, pos_x, pos_y, width, height, title, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.canvas_id, data.node_type ?? 'custom', data.entity_id ?? null,
         data.pos_x ?? 0, data.pos_y ?? 0, data.width ?? 220, data.height ?? 80,
         data.title, JSON.stringify(data.data || {}), now, now],
      );
      return lastRow('canvas_nodes');
    },
    'db:canvasNodes:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE canvas_nodes SET node_type=?, entity_id=?, pos_x=?, pos_y=?, width=?, height=?, title=?, data_json=?, updated_at=? WHERE id=?`,
        [data.node_type ?? 'custom', data.entity_id ?? null, data.pos_x ?? 0, data.pos_y ?? 0,
         data.width ?? 220, data.height ?? 80, data.title, JSON.stringify(data.data || {}), Date.now(), id],
      );
      return sql.get('SELECT * FROM canvas_nodes WHERE id = ?', [id]);
    },
    'db:canvasNodes:updatePositions': async (batch: Array<{ id: number; pos_x: number; pos_y: number }>) => {
      for (const b of batch) await sql.run('UPDATE canvas_nodes SET pos_x=?, pos_y=? WHERE id=?', [b.pos_x, b.pos_y, b.id]);
      return { ok: true };
    },
    'db:canvasNodes:delete': async (id: number) => {
      await sql.run('DELETE FROM canvas_nodes WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:canvasEdges:listByCanvas': (canvasId: number) =>
      sql.all('SELECT * FROM canvas_edges WHERE canvas_id = ? ORDER BY id', [canvasId]),
    'db:canvasEdges:create': async (data: any) => {
      await sql.run(
        `INSERT INTO canvas_edges (canvas_id, source_node_id, target_node_id, edge_type, label, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.canvas_id, data.source_node_id, data.target_node_id,
         data.edge_type ?? 'sequence', data.label ?? null, JSON.stringify(data.data || {}), Date.now()],
      );
      return lastRow('canvas_edges');
    },
    'db:canvasEdges:update': async (id: number, data: any) => {
      await sql.run(
        `UPDATE canvas_edges SET source_node_id=?, target_node_id=?, edge_type=?, label=?, data_json=? WHERE id=?`,
        [data.source_node_id, data.target_node_id, data.edge_type ?? 'sequence',
         data.label ?? null, JSON.stringify(data.data || {}), id],
      );
      return sql.get('SELECT * FROM canvas_edges WHERE id = ?', [id]);
    },
    'db:canvasEdges:delete': async (id: number) => {
      await sql.run('DELETE FROM canvas_edges WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== settings / stats =====
    'db:settings:getAll': async () => {
      const rows = await sql.all<{ key: string; value: string }>('SELECT * FROM settings');
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    'db:settings:set': async (key: string, value: string) => {
      await sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
      return { ok: true };
    },
    'db:stats:dashboard': async () => {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7);
      const c1 = await sql.get<{ c: number }>('SELECT COUNT(*) AS c FROM course_requirements');
      const c2 = await sql.get<{ c: number }>("SELECT COUNT(*) AS c FROM course_requirements WHERE status='pending'");
      const c3 = await sql.get<{ c: number }>("SELECT COUNT(*) AS c FROM course_requirements WHERE status IN ('pending','in_progress') AND due_date < ?", [todayStart.getTime()]);
      const c4 = await sql.get<{ c: number }>('SELECT COUNT(*) AS c FROM course_requirements WHERE due_date >= ? AND due_date < ?', [todayStart.getTime(), tomorrowStart.getTime()]);
      const c5 = await sql.get<{ c: number }>("SELECT COUNT(*) AS c FROM course_requirements WHERE due_date >= ? AND due_date < ? AND status IN ('pending','in_progress')", [todayStart.getTime(), weekEnd.getTime()]);
      const c6 = await sql.get<{ c: number }>('SELECT COUNT(*) AS c FROM courses');
      const c7 = await sql.get<{ c: number }>("SELECT COUNT(*) AS c FROM projects WHERE status='active'");
      const c8 = await sql.get<{ c: number }>('SELECT COUNT(*) AS c FROM events WHERE start_at >= ? AND start_at < ?', [todayStart.getTime(), tomorrowStart.getTime()]);
      return {
        totalReq: c1?.c || 0, pendingReq: c2?.c || 0, overdueReq: c3?.c || 0,
        dueTodayReq: c4?.c || 0, dueWeekReq: c5?.c || 0,
        totalCourses: c6?.c || 0, activeProjects: c7?.c || 0, todayEvents: c8?.c || 0,
      };
    },
    'db:stats:report': async (from: number, to: number) => {
      const reqDoneByDay = await sql.all(
        `SELECT strftime('%Y-%m-%d', completed_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
         FROM course_requirements WHERE completed_at >= ? AND completed_at < ? GROUP BY day ORDER BY day`, [from, to]);
      const reqDoneByCourse = await sql.all(
        `SELECT r.course_id AS courseId, c.name AS courseName, c.color AS courseColor, COUNT(*) AS n
         FROM course_requirements r LEFT JOIN courses c ON r.course_id = c.id
         WHERE r.completed_at >= ? AND r.completed_at < ? GROUP BY r.course_id ORDER BY n DESC`, [from, to]);
      const habitCheckinsByDay = await sql.all(
        `SELECT date AS day, COUNT(*) AS n FROM habit_checkins WHERE date >= ? AND date < ? GROUP BY date ORDER BY date`,
        [dayStr(from), dayStr(to)]);
      const rows = await sql.all<{ status: string; n: number }>(
        'SELECT status, COUNT(*) AS n FROM attendance WHERE date >= ? AND date < ? GROUP BY status', [dayStr(from), dayStr(to)]);
      const attendanceSummary: Record<string, number> = { present: 0, late: 0, absent: 0, leave: 0 };
      for (const r of rows) attendanceSummary[r.status] = r.n;
      return { reqDoneByDay, reqDoneByCourse, habitCheckinsByDay, attendanceSummary, range: { from, to } };
    },

    // ===== grades / exams =====
    'db:grades:list': (filter?: any) => {
      let where = ''; const params: any[] = [];
      if (filter?.courseId) { where = ' WHERE g.course_id = ?'; params.push(filter.courseId); }
      return sql.all(`SELECT g.*, c.name AS course_name, c.color AS course_color FROM grades g LEFT JOIN courses c ON g.course_id = c.id${where} ORDER BY g.id DESC`, params);
    },
    'db:grades:create': async (data: any) => {
      const now = Date.now();
      await sql.run(
        'INSERT INTO grades (course_id, semester, component, score, credit, full_score, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [data.course_id, data.semester ?? null, data.component ?? 'total',
         data.score ?? null, data.credit ?? 0, data.full_score ?? 100, data.notes ?? null, now, now],
      );
      return lastRow('grades');
    },
    'db:grades:update': async (id: number, data: any) => {
      await sql.run(
        'UPDATE grades SET course_id=?, semester=?, component=?, score=?, credit=?, full_score=?, notes=?, updated_at=? WHERE id=?',
        [data.course_id, data.semester ?? null, data.component ?? 'total', data.score ?? null,
         data.credit ?? 0, data.full_score ?? 100, data.notes ?? null, Date.now(), id],
      );
      return sql.get('SELECT * FROM grades WHERE id = ?', [id]);
    },
    'db:grades:delete': async (id: number) => {
      await sql.run('DELETE FROM grades WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:exams:list': (filter?: any) => {
      if (filter?.status) return sql.all('SELECT * FROM exams WHERE status = ? ORDER BY exam_date ASC', [filter.status]);
      return sql.all('SELECT * FROM exams ORDER BY exam_date ASC');
    },
    'db:exams:create': async (data: any) => {
      await sql.run(
        'INSERT INTO exams (course_id, title, exam_date, location, duration_minutes, notes, status, exam_room, seat_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [data.course_id ?? null, data.title, data.exam_date, data.location ?? null,
         data.duration_minutes ?? null, data.notes ?? null, data.status ?? 'upcoming',
         data.exam_room ?? null, data.seat_no ?? null, Date.now()],
      );
      return lastRow('exams');
    },
    'db:exams:update': async (id: number, data: any) => {
      await sql.run(
        'UPDATE exams SET course_id=?, title=?, exam_date=?, location=?, duration_minutes=?, notes=?, status=?, exam_room=?, seat_no=? WHERE id=?',
        [data.course_id ?? null, data.title, data.exam_date, data.location ?? null,
         data.duration_minutes ?? null, data.notes ?? null, data.status ?? 'upcoming',
         data.exam_room ?? null, data.seat_no ?? null, id],
      );
      return sql.get('SELECT * FROM exams WHERE id = ?', [id]);
    },
    'db:exams:delete': async (id: number) => {
      await sql.run('DELETE FROM exams WHERE id = ?', [id]);
      return { ok: true };
    },

    // ===== pomodoro =====
    'db:pomodoro:list': (filter?: any) => {
      if (filter?.from != null && filter?.to != null) {
        return sql.all('SELECT * FROM pomodoro_sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC', [filter.from, filter.to]);
      }
      return sql.all('SELECT * FROM pomodoro_sessions ORDER BY started_at DESC LIMIT 100');
    },
    'db:pomodoro:create': async (data: any) => {
      await sql.run(
        'INSERT INTO pomodoro_sessions (course_id, ref_type, ref_id, label, started_at, ended_at, minutes, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [data.course_id ?? null, data.ref_type ?? null, data.ref_id ?? null, data.label ?? null,
         data.started_at ?? Date.now(), data.ended_at ?? null, data.minutes ?? 25, data.mode ?? 'work', Date.now()],
      );
      return lastRow('pomodoro_sessions');
    },
    'db:pomodoro:stop': async (id: number, minutes: number) => {
      await sql.run('UPDATE pomodoro_sessions SET ended_at = ?, minutes = ? WHERE id = ?', [Date.now(), minutes ?? null, id]);
      return sql.get('SELECT * FROM pomodoro_sessions WHERE id = ?', [id]);
    },
    'db:pomodoro:stats': async (from: number, to: number) => {
      const byDay = await sql.all(
        `SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS day,
                SUM(minutes) AS minutes, COUNT(*) AS sessions
         FROM pomodoro_sessions WHERE mode = 'work' AND started_at >= ? AND started_at < ?
         GROUP BY day ORDER BY day`, [from, to]);
      const byCourse = await sql.all(
        `SELECT p.course_id AS courseId, c.name AS courseName, c.color AS courseColor,
                SUM(p.minutes) AS minutes, COUNT(*) AS sessions
         FROM pomodoro_sessions p LEFT JOIN courses c ON p.course_id = c.id
         WHERE p.mode = 'work' AND p.started_at >= ? AND p.started_at < ?
         GROUP BY p.course_id ORDER BY minutes DESC`, [from, to]);
      return { byDay, byCourse };
    },

    // ===== habits =====
    'db:habits:list': async () => {
      const habits = await sql.all<any>('SELECT * FROM habits WHERE archived = 0 ORDER BY sort_order ASC, id ASC');
      const checkins = await sql.all<{ habit_id: number; date: string }>('SELECT habit_id, date FROM habit_checkins');
      const byHabit = new Map<number, string[]>();
      for (const c of checkins) {
        if (!byHabit.has(c.habit_id)) byHabit.set(c.habit_id, []);
        byHabit.get(c.habit_id)!.push(c.date);
      }
      return habits.map((h) => ({ ...h, checkinDates: (byHabit.get(h.id) || []).sort() }));
    },
    'db:habits:create': async (data: any) => {
      await sql.run(
        'INSERT INTO habits (name, emoji, color, frequency, target_per_week, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [data.name, data.emoji ?? '🔥', data.color ?? '#00FF88', data.frequency ?? 'daily',
         data.target_per_week ?? null, data.sort_order ?? 0, Date.now()],
      );
      return lastRow('habits');
    },
    'db:habits:update': async (id: number, data: any) => {
      await sql.run(
        'UPDATE habits SET name=?, emoji=?, color=?, frequency=?, target_per_week=?, archived=?, sort_order=? WHERE id=?',
        [data.name, data.emoji ?? '🔥', data.color ?? '#00FF88', data.frequency ?? 'daily',
         data.target_per_week ?? null, data.archived ? 1 : 0, data.sort_order ?? 0, id],
      );
      return sql.get('SELECT * FROM habits WHERE id = ?', [id]);
    },
    'db:habits:delete': async (id: number) => {
      await sql.run('DELETE FROM habit_checkins WHERE habit_id = ?', [id]);
      await sql.run('DELETE FROM habits WHERE id = ?', [id]);
      return { ok: true };
    },
    'db:habits:toggleCheckin': async (habitId: number, date: string) => {
      const ex = await sql.get<{ id: number }>('SELECT id FROM habit_checkins WHERE habit_id = ? AND date = ?', [habitId, date]);
      if (ex) {
        await sql.run('DELETE FROM habit_checkins WHERE id = ?', [ex.id]);
        return { ok: true, checked: false };
      }
      await sql.run('INSERT INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)', [habitId, date, Date.now()]);
      return { ok: true, checked: true };
    },

    // ===== attendance =====
    'db:attendance:list': (filter?: any) => {
      if (filter?.courseId) return sql.all('SELECT * FROM attendance WHERE course_id = ? ORDER BY date DESC', [filter.courseId]);
      return sql.all('SELECT * FROM attendance ORDER BY date DESC');
    },
    'db:attendance:upsert': async (data: { course_id: number; date: string; status: string; note?: string }) => {
      await sql.run(
        `INSERT INTO attendance (course_id, date, status, note, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(course_id, date) DO UPDATE SET status=excluded.status, note=excluded.note`,
        [data.course_id, data.date, data.status, data.note ?? null, Date.now()],
      );
      return { ok: true };
    },
    'db:attendance:stats': async (courseId?: number) => {
      const rows = courseId
        ? await sql.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM attendance WHERE course_id = ? GROUP BY status', [courseId])
        : await sql.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM attendance GROUP BY status');
      const out: Record<string, number> = { present: 0, late: 0, absent: 0, leave: 0 };
      for (const r of rows) out[r.status] = r.n;
      return out;
    },

    // ===== 学业增强（002）：培养方案 / 排名记录 =====
    'db:studyPlan:list': () => sql.all('SELECT * FROM study_plan ORDER BY id'),
    'db:studyPlan:save': async (rows: Array<{ category: string; required_credit: number; note?: string | null }>) => {
      for (const r of rows) {
        await sql.run(
          `INSERT INTO study_plan (category, required_credit, note, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(category) DO UPDATE SET required_credit=excluded.required_credit, note=excluded.note, updated_at=excluded.updated_at`,
          [r.category, r.required_credit ?? 0, r.note ?? null, Date.now()],
        );
      }
      return { ok: true };
    },
    'db:ranks:list': () => sql.all('SELECT * FROM rank_records ORDER BY semester DESC, id DESC'),
    'db:ranks:create': async (data: { semester: string; rank?: number | null; total?: number | null; gpa?: number | null; note?: string | null }) => {
      await sql.run(
        'INSERT INTO rank_records (semester, rank, total, gpa, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [data.semester, data.rank ?? null, data.total ?? null, data.gpa ?? null, data.note ?? null, Date.now()],
      );
      return sql.get('SELECT * FROM rank_records ORDER BY id DESC LIMIT 1');
    },
    'db:ranks:delete': async (id: number) => {
      await sql.run('DELETE FROM rank_records WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}

function dayStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

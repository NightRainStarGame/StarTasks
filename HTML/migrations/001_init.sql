-- TaskManager 初始结构（v2 / Tauri）
-- 与旧版 electron/db/index.ts 的「CREATE TABLE + addColumnIfMissing 增量列」合并后的最终形态：
-- 全新库一次建全，不再需要 ALTER 补列。已删除 billing 月卡表（monthly_subscriptions / voucher_purchases）。
-- 兼容 tauri-plugin-sql (SQLite) 与 sql.js。
PRAGMA foreign_keys = ON;

-- ===== 课程 =====
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  instructor TEXT,
  semester TEXT,
  color TEXT DEFAULT '#00FF88',
  description TEXT,
  tags TEXT DEFAULT '[]',
  guid TEXT,
  course_key TEXT,
  created_at INTEGER NOT NULL
);

-- ===== 课程要求 / 作业 =====
CREATE TABLE IF NOT EXISTS course_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT CHECK(type IN ('homework','exam','project','reading','other')) DEFAULT 'homework',
  description TEXT,
  due_date INTEGER NOT NULL,
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT 'pending',
  estimated_hours REAL,
  actual_hours REAL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  recurrence TEXT,
  source TEXT DEFAULT 'local',
  remote_id TEXT,
  session_date TEXT,
  publisher TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- ===== 日程 / 事件 =====
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  location TEXT,
  recurrence TEXT,
  recurrence_end INTEGER,
  course_id INTEGER,
  color TEXT,
  notes TEXT,
  all_day INTEGER DEFAULT 0,
  reminder_minutes INTEGER,
  category_id INTEGER,
  type TEXT DEFAULT 'event',
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
);

-- ===== 项目 / 任务 =====
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  start_date INTEGER,
  due_date INTEGER,
  progress INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  course_id INTEGER,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'todo',
  assignee TEXT,
  due_date INTEGER,
  order_index INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 1,
  description TEXT,
  done_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
);

-- ===== 设置 =====
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ===== AI 调用审计 =====
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  charged_tokens INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  error_code TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  snapshot_chars INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0
);

-- ===== 分类 =====
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#00FF88',
  emoji TEXT,
  created_at INTEGER NOT NULL
);

-- ===== 课程笔记 =====
CREATE TABLE IF NOT EXISTS course_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- ===== 用户档案 =====
CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  password_hash TEXT,
  wx_openid TEXT UNIQUE,
  wx_nickname TEXT,
  wx_avatar TEXT,
  student_id TEXT,
  real_name TEXT,
  school TEXT,
  college TEXT,
  major TEXT,
  class_name TEXT,
  enroll_year INTEGER,
  graduate_year INTEGER,
  program TEXT,
  degree_level TEXT,
  custom_fields TEXT DEFAULT '[]',
  encrypted_fields TEXT,
  privacy_mode INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ===== 回收站 =====
CREATE TABLE IF NOT EXISTS recycle_bin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  entity_id INTEGER,
  snapshot TEXT NOT NULL,
  extra TEXT,
  reason TEXT,
  deleted_at INTEGER NOT NULL,
  purge_at INTEGER NOT NULL
);

-- ===== 画布编辑器 =====
CREATE TABLE IF NOT EXISTS canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  project_id INTEGER,
  viewport_x REAL DEFAULT 0,
  viewport_y REAL DEFAULT 0,
  viewport_zoom REAL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('task','course','homework','event','note','group','custom')) DEFAULT 'custom',
  entity_id INTEGER,
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  width REAL DEFAULT 220,
  height REAL DEFAULT 80,
  title TEXT NOT NULL,
  data_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canvas_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'sequence' CHECK(edge_type IN ('sequence','dependency','relation','critical')),
  label TEXT,
  data_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE
);

-- ===== 成绩 / 考试 =====
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  semester TEXT,
  component TEXT DEFAULT 'total',
  score REAL,
  credit REAL DEFAULT 0,
  full_score REAL DEFAULT 100,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER,
  title TEXT NOT NULL,
  exam_date INTEGER NOT NULL,
  location TEXT,
  duration_minutes INTEGER,
  notes TEXT,
  status TEXT DEFAULT 'upcoming',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
);

-- ===== 番茄钟 =====
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  label TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  minutes INTEGER NOT NULL,
  mode TEXT DEFAULT 'work',
  created_at INTEGER NOT NULL
);

-- ===== 习惯打卡 =====
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🔥',
  color TEXT DEFAULT '#00FF88',
  frequency TEXT DEFAULT 'daily',
  target_per_week INTEGER,
  archived INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(habit_id, date),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);

-- ===== 出勤 =====
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','late','absent','leave')),
  note TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(course_id, date),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- ===== 旧小组共享（兼容数据，无新 UI）=====
CREATE TABLE IF NOT EXISTS group_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  remote_key TEXT,
  title TEXT NOT NULL,
  assignee TEXT,
  status TEXT DEFAULT 'todo',
  due_date INTEGER,
  sort_order INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (list_id) REFERENCES group_lists(id) ON DELETE CASCADE
);

-- ===== 班级（本地缓存镜像；v2 起后端为 SSIO 服务端 API）=====
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  share_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  owner_token TEXT,
  role TEXT DEFAULT 'owner',
  member_count INTEGER DEFAULT 1,
  max_members INTEGER DEFAULT 50,
  cloud_synced INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  joined_at INTEGER NOT NULL,
  dissolved INTEGER DEFAULT 0,
  alias TEXT DEFAULT '',
  invite_code TEXT,
  owner_alias TEXT DEFAULT '',
  last_announcement_id INTEGER DEFAULT 0,
  last_task_id INTEGER DEFAULT 0,
  manifest_sha TEXT,
  members_json TEXT DEFAULT '[]',
  member_synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS class_announcements (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  author_alias TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  read_at INTEGER
);

CREATE TABLE IF NOT EXISTS class_tasks (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  due_at INTEGER,
  author_alias TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS class_chains (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  author_alias TEXT DEFAULT '',
  items_json TEXT DEFAULT '[]',
  closed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS class_polls (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  options_json TEXT DEFAULT '[]',
  votes_json TEXT DEFAULT '{}',
  multi INTEGER DEFAULT 0,
  deadline_at INTEGER,
  author_alias TEXT DEFAULT '',
  closed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- ===== 设备档案 =====
CREATE TABLE IF NOT EXISTS device_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_token TEXT NOT NULL,
  nickname TEXT,
  created_at INTEGER NOT NULL
);

-- ===== 索引 =====
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_guid ON courses(guid) WHERE guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_courses_course_key ON courses(course_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_req_remote ON course_requirements(remote_id) WHERE remote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_req_course ON course_requirements(course_id);
CREATE INDEX IF NOT EXISTS idx_req_due ON course_requirements(due_date);
CREATE INDEX IF NOT EXISTS idx_evt_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_evt_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_pt_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_pt_priority ON project_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_note_course ON course_notes(course_id);
CREATE INDEX IF NOT EXISTS idx_profile_openid ON user_profiles(wx_openid);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas ON canvas_nodes(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_canvas ON canvas_edges(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_source ON canvas_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_target ON canvas_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvases(project_id);
CREATE INDEX IF NOT EXISTS idx_bin_purge ON recycle_bin(purge_at);
CREATE INDEX IF NOT EXISTS idx_bin_kind ON recycle_bin(kind);
CREATE INDEX IF NOT EXISTS idx_grades_course ON grades(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date);
CREATE INDEX IF NOT EXISTS idx_pomo_started ON pomodoro_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_checkin_habit ON habit_checkins(habit_id);
CREATE INDEX IF NOT EXISTS idx_checkin_date ON habit_checkins(date);
CREATE INDEX IF NOT EXISTS idx_att_course ON attendance(course_id);
CREATE INDEX IF NOT EXISTS idx_gli_list ON group_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_class_ann_class ON class_announcements(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_tasks_class ON class_tasks(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_chains_class ON class_chains(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_polls_class ON class_polls(class_id, created_at DESC);

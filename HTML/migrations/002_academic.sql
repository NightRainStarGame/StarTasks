-- 002：学业增强（参考 The-Beike 功能面：查成绩/查考场/选课/培养方案）
-- 幂等：ADD COLUMN 前 SQLite 无 IF NOT EXISTS，执行器对失败语句跳过（列已存在时报错即忽略）。

-- 课程：学分 / 性质（必修/限选/选修/通识）/ 修读状态（计划选课/修读中/已完成）
ALTER TABLE courses ADD COLUMN credit REAL DEFAULT 0;
ALTER TABLE courses ADD COLUMN category TEXT DEFAULT 'elective';
ALTER TABLE courses ADD COLUMN course_status TEXT DEFAULT 'taking';

-- 考试：考场号 / 座位号（教务「查考场」的本地镜像）
ALTER TABLE exams ADD COLUMN exam_room TEXT;
ALTER TABLE exams ADD COLUMN seat_no TEXT;

-- 培养方案：分类学分要求（必修 X 学分 / 限选 Y / 选修 Z / 通识 W）
CREATE TABLE IF NOT EXISTS study_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL UNIQUE,          -- required | limited | elective | general
  required_credit REAL NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL
);

-- 排名记录（每学期一条：专业排名 / 人数，手动记录）
CREATE TABLE IF NOT EXISTS rank_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester TEXT NOT NULL,
  rank INTEGER,
  total INTEGER,
  gpa REAL,
  note TEXT,
  created_at INTEGER NOT NULL
);

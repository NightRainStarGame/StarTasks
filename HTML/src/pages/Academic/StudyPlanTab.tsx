/**
 * 培养方案 Tab —— 学分要求管理 + 课程修读状态（对应教务「选课 / 培养方案」体验）。
 * 数据：study_plan 表（分类学分要求）+ courses.credit/category/course_status。
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from '../../utils/clsx';
import { useStore } from '@/store';
import { Target, Save, BookOpen } from 'lucide-react';

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  required: { label: '必修', color: 'text-neon-green border-neon-green/40' },
  limited: { label: '限选', color: 'text-neon-yellow border-neon-yellow/40' },
  elective: { label: '选修', color: 'text-sky-400 border-sky-400/40' },
  general: { label: '通识', color: 'text-purple-400 border-purple-400/40' },
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  planned: { label: '计划选课', cls: 'text-neon-yellow border-neon-yellow/40' },
  taking: { label: '修读中', cls: 'text-neon-green border-neon-green/40' },
  done: { label: '已完成', cls: 'text-text-dim border-text-dim/40' },
};

interface PlanRow { category: string; required_credit: number; note?: string | null }

export function StudyPlanTab() {
  const courses = useStore(s => s.courses);
  const refreshAll = useStore(s => s.refreshAll);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    const rows = await (window.taskAPI as any).db.studyPlan?.list?.().catch?.(() => []) ?? [];
    // 默认四类
    const map = new Map<string, PlanRow>((rows as PlanRow[]).map(r => [r.category, r]));
    setPlan(['required', 'limited', 'elective', 'general'].map(c =>
      map.get(c) || { category: c, required_credit: 0, note: null }
    ));
  };
  useEffect(() => { load(); }, []);

  const savePlan = async () => {
    const api = (window.taskAPI as any).db.studyPlan;
    if (api?.save) await api.save(plan);
    setDirty(false);
  };

  // 已获学分（按课程性质聚合，只算已完成/修读中的有学分课）
  const earned = useMemo(() => {
    const m: Record<string, number> = { required: 0, limited: 0, elective: 0, general: 0 };
    courses.forEach((c: any) => {
      const cat = (c.category as string) || 'elective';
      if (m[cat] == null) m[cat] = 0;
      if (c.course_status === 'done') m[cat] += Number(c.credit) || 0;
    });
    return m;
  }, [courses]);

  const setCredit = (cat: string, v: number) => {
    setPlan(p => p.map(r => r.category === cat ? { ...r, required_credit: v } : r));
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      {/* 学分完成度 */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="label-tag flex items-center gap-1.5"><Target size={13} /> 培养方案 · 学分要求</p>
          <button onClick={savePlan} disabled={!dirty} className={clsx('btn-neon px-3 py-1.5 text-xs', !dirty && 'opacity-50 cursor-not-allowed')}>
            <Save size={12} /> 保存要求
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {plan.map(r => {
            const meta = CATEGORY_LABELS[r.category] || CATEGORY_LABELS.elective;
            const got = earned[r.category] || 0;
            const pct = r.required_credit > 0 ? Math.min(100, got / r.required_credit * 100) : 0;
            return (
              <div key={r.category} className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${meta.color}`}>{meta.label}</span>
                  <span className="font-mono text-[10px] text-text-dim">{got}/{r.required_credit || '—'} 学分</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={r.required_credit || ''}
                  onChange={e => setCredit(r.category, Number(e.target.value) || 0)}
                  placeholder="要求学分"
                  className="input-neon w-full text-sm py-1"
                />
                <div className="h-1.5 bg-ink-900/70 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 课程修读状态（选课管理） */}
      <div className="glass-panel p-4 space-y-3">
        <p className="label-tag flex items-center gap-1.5"><BookOpen size={13} /> 课程修读状态（选课管理）</p>
        {courses.length === 0 && (
          <p className="text-xs text-text-dim font-mono">还没有课程，先到「课程」页建课或从教务导入。</p>
        )}
        <div className="space-y-2">
          {courses.map((c: any) => (
            <CoursePlanRow key={c.id} course={c} onChanged={refreshAll} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CoursePlanRow({ course, onChanged }: { course: any; onChanged: () => Promise<void> }) {
  const [credit, setCredit] = useState(course.credit ?? 0);
  const [category, setCategory] = useState(course.category || 'elective');
  const [status, setStatus] = useState(course.course_status || 'taking');
  const [saving, setSaving] = useState(false);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await window.taskAPI.db.courses.update(course.id, {
        name: course.name, code: course.code, instructor: course.instructor,
        semester: course.semester, color: course.color, description: course.description,
        tags: course.tags,
        credit, category, course_status: status,
        ...patch,
      });
      await onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: course.color }} />
      <span className="text-sm font-medium min-w-0 flex-1 truncate">{course.name}</span>
      <select value={category} onChange={e => { setCategory(e.target.value); void save({ category: e.target.value }); }}
        className="input-neon text-[11px] py-1 w-20" disabled={saving}>
        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <input type="number" min={0} step={0.5} value={credit || ''} placeholder="学分"
        onChange={e => setCredit(Number(e.target.value) || 0)}
        onBlur={() => void save({ credit })}
        className="input-neon text-[11px] py-1 w-16 text-right" disabled={saving} />
      <select value={status} onChange={e => { setStatus(e.target.value); void save({ course_status: e.target.value }); }}
        className="input-neon text-[11px] py-1 w-24" disabled={saving}>
        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
    </div>
  );
}

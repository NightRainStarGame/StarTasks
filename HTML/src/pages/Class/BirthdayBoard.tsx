/**
 * 星露谷风格生日日历 + 公告板 —— 班级页的「活」区域。
 *
 * 视觉：星露谷 UI 的木牌 / 羊皮纸 / 手写体质感（暖黄底 + 深棕描边 + 圆角木牌），
 * 与主界面的霓虹科技风刻意区分 —— 班级是「生活区」，单独一套氛围。
 *
 * 功能：
 *   · 生日日历：本月格子视图，🎂 标记成员生日；今天生日的成员放「生日星」横幅
 *   · 生日提醒：有成员今天生日 → 顶部横幅 + toast
 *   · 公告板：最近公告贴在羊皮纸卡片上（星露谷杂货店告示板风格）
 */
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Cake, Gift, Megaphone } from 'lucide-react';
import { toast } from '@/utils/toast';

interface Props {
  members: Array<{ alias: string; birthday?: string | null }>;
  announcements: Array<{ id: number; title: string; body?: string; createdAt: number; authorAlias?: string }>;
  onOpenAnnouncement?: (id: number) => void;
  /** 点某天的寿星「送祝福」→ 由父级跳聊天并预填祝福语 */
  onSendWish?: (to: string, text: string) => void;
}

/** 星露谷纸板配色（scoped class，不影响全局主题） */
const SV = {
  board: 'linear-gradient(180deg, #5C3A21 0%, #4A2E19 100%)',   // 木板
  paper: 'linear-gradient(175deg, #F5E6C8 0%, #E8D4A8 100%)',   // 羊皮纸
  ink: '#4A2E19',
  accent: '#C0392B',
  gold: '#D4A017',
};

export default function BirthdayBoard({ members, announcements, onOpenAnnouncement, onSendWish }: Props) {
  const today = dayjs();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 点开某天：查看当天寿星
  const [openDay, setOpenDay] = useState<number | null>(null);
  const dayBirthdays = useMemo(() => {
    if (openDay == null) return [];
    const key = `${today.format('MM')}-${String(openDay).padStart(2, '0')}`;
    return members.filter(m => (m.birthday || '').trim() === key).map(m => m.alias);
  }, [openDay, members, today]);

  // 本月生日（birthday: MM-DD）
  const monthDays = useMemo(() => {
    const daysInMonth = today.daysInMonth();
    const firstDow = today.startOf('month').day(); // 0=周日
    const cells: Array<{ day: number | null; birthdays: string[] }> = [];
    for (let i = 0; i < firstDow; i++) cells.push({ day: null, birthdays: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${today.format('MM')}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        birthdays: members.filter(m => (m.birthday || '').trim() === key).map(m => m.alias),
      });
    }
    return cells;
  }, [members, today]);

  // 今天生日的人（提醒）
  const todayKey = today.format('MM-DD');
  const birthdayStars = members.filter(m => (m.birthday || '').trim() === todayKey);

  useEffect(() => {
    if (mounted && birthdayStars.length > 0) {
      toast.success(`🎂 今天是 ${birthdayStars.map(b => b.alias).join('、')} 的生日！快去祝福～`, 6000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const recent = announcements.slice(0, 3);

  return (
    <div className="space-y-4">
      {/* 生日星横幅 */}
      {birthdayStars.length > 0 && (
        <div
          className="rounded-xl p-4 flex items-center gap-3 shadow-lg"
          style={{
            background: `linear-gradient(135deg, #F9E79F 0%, #F4D03F 100%)`,
            border: '3px solid #B7950B',
            boxShadow: '0 4px 0 #B7950B, 0 8px 16px rgba(0,0,0,0.25)',
          }}
        >
          <div className="text-3xl" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))' }}>🎂</div>
          <div>
            <div className="font-bold text-lg" style={{ color: '#7D6608', fontFamily: 'serif' }}>
              今天是 {birthdayStars.map(b => b.alias).join('、')} 的生日！
            </div>
            <div className="text-sm" style={{ color: '#9A7D0A' }}>全村人都在庆祝 · 快送上你的祝福</div>
          </div>
          <Gift size={28} className="ml-auto" style={{ color: '#B7950B' }} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 生日日历（木牌） */}
        <div
          className="rounded-xl p-4 shadow-lg"
          style={{ background: SV.board, border: '3px solid #2E1B0E', boxShadow: '0 4px 0 #2E1B0E, 0 8px 16px rgba(0,0,0,0.3)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Cake size={18} style={{ color: '#F0C674' }} />
            <span className="font-bold text-base" style={{ color: '#F0E0B8', fontFamily: 'serif' }}>
              {today.format('YYYY 年 M 月')} · 生日历
            </span>
          </div>
          <div
            className="rounded-lg p-2"
            style={{ background: SV.paper, border: '2px solid #A67C52' }}
          >
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                <div key={d} className="text-[10px] font-bold py-1" style={{ color: '#8B6914' }}>{d}</div>
              ))}
              {monthDays.map((c, i) => {
                const isToday = c.day === today.date();
                return (
                  <div
                    key={i}
                    onClick={() => c.day && setOpenDay(openDay === c.day ? null : c.day)}
                    className="min-h-[2.2rem] rounded flex flex-col items-center justify-center text-xs relative cursor-pointer hover:brightness-110 transition-all"
                    style={{
                      background: c.birthdays.length ? '#F9E79F' : isToday ? '#E8D4A8' : openDay === c.day ? '#EDE0C0' : 'transparent',
                      border: isToday ? '2px solid #C0392B' : openDay === c.day ? '2px solid #8B6914' : '1px solid transparent',
                      color: SV.ink,
                    }}
                  >
                    {c.day && <span className={c.birthdays.length ? 'font-bold' : ''}>{c.day}</span>}
                    {c.birthdays.map((alias, j) => (
                      <span key={j} className="text-[8px] leading-tight truncate max-w-full px-0.5" style={{ color: SV.accent }} title={`${alias} 的生日`}>
                        🎂{alias}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 text-[10px]" style={{ color: '#C8B089' }}>
            · 格子上有 🎂 的是成员生日 · 点日期看当天寿星 · 自己的生日在「成员」里设置
          </div>

          {/* 点开某天：当天寿星 + 送祝福 */}
          {openDay != null && (
            <div
              className="mt-2 rounded-lg p-3"
              style={{ background: '#EDE0C0', border: '2px dashed #8B6914' }}
            >
              <div className="text-sm font-bold mb-2" style={{ color: SV.ink }}>
                {today.format('M 月')} {openDay} 日
              </div>
              {dayBirthdays.length === 0 ? (
                <div className="text-xs" style={{ color: '#8B6914' }}>这天没有人过生日</div>
              ) : (
                <div className="space-y-1.5">
                  {dayBirthdays.map((alias) => (
                    <div key={alias} className="flex items-center gap-2">
                      <span className="text-lg">🎂</span>
                      <span className="text-sm font-bold" style={{ color: SV.ink }}>{alias}</span>
                      <button
                        onClick={() => onSendWish?.(alias, `🎂 生日快乐，${alias}！祝你新的一岁万事顺意～`)}
                        className="ml-auto px-2.5 py-1 rounded text-xs font-bold transition-transform hover:-translate-y-0.5"
                        style={{ background: SV.accent, color: '#FFF5E0', boxShadow: '2px 2px 0 rgba(0,0,0,0.25)' }}
                      >
                        <Gift size={11} className="inline mr-1" />送祝福
                      </button>
                    </div>
                  ))}
                  <div className="text-[9px] pt-1" style={{ color: '#8B6914' }}>
                    送祝福会跳到班级聊天并自动填好祝福语
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 公告板（羊皮纸告示） */}
        <div
          className="rounded-xl p-4 shadow-lg"
          style={{ background: SV.board, border: '3px solid #2E1B0E', boxShadow: '0 4px 0 #2E1B0E, 0 8px 16px rgba(0,0,0,0.3)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Megaphone size={18} style={{ color: '#F0C674' }} />
            <span className="font-bold text-base" style={{ color: '#F0E0B8', fontFamily: 'serif' }}>
              村务告示板
            </span>
          </div>
          {recent.length === 0 ? (
            <div
              className="rounded-lg p-4 text-center text-sm"
              style={{ background: SV.paper, border: '2px dashed #A67C52', color: '#8B6914' }}
            >
              告示板空空如也<br />发布一条公告贴上来吧
            </div>
          ) : (
            <div className="space-y-2">
              {recent.map(a => (
                <div
                  key={a.id}
                  onClick={() => onOpenAnnouncement?.(a.id)}
                  className="rounded-lg p-3 cursor-pointer transition-transform hover:-translate-y-0.5"
                  style={{
                    background: SV.paper,
                    border: '2px solid #A67C52',
                    boxShadow: '2px 2px 0 rgba(0,0,0,0.2)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-sm truncate" style={{ color: SV.ink }}>{a.title}</div>
                    <span className="text-[9px] shrink-0" style={{ color: '#8B6914' }}>
                      {dayjs(a.createdAt).format('MM-DD')}
                    </span>
                  </div>
                  {a.body && (
                    <div className="text-xs mt-1 line-clamp-2" style={{ color: '#6B4423' }}>{a.body}</div>
                  )}
                  {a.authorAlias && (
                    <div className="text-[9px] mt-1 text-right" style={{ color: '#A67C52' }}>—— {a.authorAlias}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

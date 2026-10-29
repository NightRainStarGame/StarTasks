/**
 * 手机端底部导航栏（md 以上隐藏）。
 *
 * 之前手机上只有左上角汉堡 → 抽屉才能切页，单手几乎不可达；
 * 底部固定 5 个高频入口，符合移动端习惯。设置仍在抽屉里（汉堡）。
 *
 * 注意：不使用 backdrop-blur —— Android WebView 对 backdrop-filter 支持差，
 * 会把底栏和上面的内容一起渲染成糊状。
 */
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, BookOpen, GraduationCap, Users } from 'lucide-react';
import { useIsCompact } from '@/hooks/useMediaQuery';

const ITEMS = [
  { to: '/', label: '总览', icon: LayoutDashboard },
  { to: '/calendar', label: '日历', icon: Calendar },
  { to: '/courses', label: '课程', icon: BookOpen },
  { to: '/academic', label: '学业', icon: GraduationCap },
  { to: '/class', label: '班级', icon: Users },
];

export default function MobileTabBar() {
  // 平板（768–1099）也要底部导航：以前用 md:hidden，平板一上来就只剩 64px 图标栏
  const compact = useIsCompact();
  if (!compact) return null;
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-neon-green/20 bg-ink-900 pb-[var(--sab)]"
      aria-label="主导航"
    >
      <div className="grid grid-cols-5">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-14 font-mono text-[10px] transition-colors ${
                isActive ? 'text-neon-green' : 'text-text-dim active:text-text-secondary'
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

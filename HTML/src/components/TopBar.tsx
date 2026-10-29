import { useEffect, useState } from 'react';
import { Plus, Search, Minus, Square, X, Maximize2, Menu } from 'lucide-react';
import dayjs from 'dayjs';
import { toast } from '@/utils/toast';

/**
 * 窗口按钮统一包一层错误提示 —— 打包版里 core:window 的写操作需要显式 ACL 授权，
 * 之前被拒后 Promise 静默 reject，用户看到的就是「点了没反应」。
 */
function windowAction(label: string, fn: () => Promise<unknown> | undefined) {
  const p = fn();
  if (p && typeof (p as Promise<unknown>).catch === 'function') {
    (p as Promise<unknown>).catch((e: any) => {
      toast.error(`${label}失败：${e?.message || e}`);
    });
  }
}

interface Props {
  onPlus: () => void;
  onSearch: () => void;
  /** 手机（<768px）呼出侧栏抽屉 */
  onMenu?: () => void;
}

export default function TopBar({ onPlus, onSearch, onMenu }: Props) {
  const [now, setNow] = useState(dayjs());
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // 移动端无窗口控制 IPC，reject 时静默（按钮本就隐藏）
    window.taskAPI.window.isMaximized().then(setMaximized).catch(() => {});
  }, []);

  const handleMax = async () => {
    await window.taskAPI.window.maximize();
    setMaximized(await window.taskAPI.window.isMaximized().catch(() => false));
  };

  return (
    <header
      className="relative h-14 flex items-center gap-2 px-2 md:gap-3 md:px-4 bg-ink-900/60 backdrop-blur-md border-b border-neon-green/15 select-none"
    >
      {/* 左侧：菜单（手机）+ 加号 + 搜索 */}
      <div className="flex items-center gap-1 md:gap-2">
        <button
          onClick={onMenu}
          className="md:hidden w-9 h-9 rounded flex items-center justify-center text-text-secondary hover:text-neon-green hover:bg-neon-green/10 transition-colors"
          title="菜单"
          aria-label="打开菜单"
        >
          <Menu size={20} />
        </button>
        <button onClick={onPlus} className="btn-neon py-1.5 px-3" title="新建 (Ctrl+N)">
          <Plus size={16} />
        </button>
        <button onClick={onSearch} className="btn-ghost" title="全局搜索 (Ctrl+K)">
          <Search size={15} />
          <span className="hidden md:inline">搜索</span>
          <span className="hidden lg:inline font-mono text-[10px] text-text-dim ml-1 px-1.5 py-0.5 rounded border border-text-dim/30">⌘K</span>
        </button>
      </div>

      {/* 拖拽区：Tauri 用 data-tauri-drag-region（WebkitAppRegion 是 Electron 写法，在 Tauri 无效） */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* 中部：统计胶囊已按用户要求移除（今日/逾期/课程/项目） */}

      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* 右侧：时钟 + 窗口控制（移动端隐藏窗口控制） */}
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex flex-col items-end leading-none font-mono">
          <span className="text-xs md:text-sm text-neon-green text-glow-green tracking-widest">
            {now.format('HH:mm:ss')}
          </span>
          <span className="hidden sm:block text-[10px] text-text-dim mt-0.5">{now.format('YYYY-MM-DD ddd')}</span>
        </div>
        <div className="hidden md:flex items-center gap-1 ml-2">
          <WindowBtn onClick={() => windowAction('最小化', () => window.taskAPI.window.minimize())} title="最小化">
            <Minus size={14} />
          </WindowBtn>
          <WindowBtn onClick={() => windowAction('最大化', handleMax)} title={maximized ? '还原' : '最大化'}>
            {maximized ? <Square size={12} /> : <Maximize2 size={12} />}
          </WindowBtn>
          <WindowBtn onClick={() => windowAction('关闭窗口', () => window.taskAPI.window.close())} title="关闭" danger>
            <X size={14} />
          </WindowBtn>
        </div>
      </div>
    </header>
  );
}

function WindowBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded flex items-center justify-center transition-colors
        ${danger ? 'hover:bg-neon-danger/20 hover:text-neon-danger text-text-secondary' : 'hover:bg-neon-green/10 hover:text-neon-green text-text-secondary'}`}
    >
      {children}
    </button>
  );
}
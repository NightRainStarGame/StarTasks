import { useEffect, useState } from 'react';

/** CSS 媒体查询响应式 hook */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

/**
 * 响应式断点约定（三形态）：
 *  <768px    手机   —— 抽屉侧栏 + 底部导航 + 全部"手机优化"布局
 *  768-1099  平板   —— **也算紧凑形态**：同样用底部导航与手机优化布局
 *  ≥1100px   桌面   —— 全宽侧栏 + 表格/网格
 *
 * ⚠ 之前只有 <768 一条判定，768-1099 的平板既拿不到手机优化、桌面版又装不下：
 *   课表 8 列每列 ~100px（课程名仍被截断）、学业 6 列表格被裁切、日历强制横向滚动。
 */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

/** 触摸优先（手机/平板，无 hover 精确指针）——与宽度无关 */
export const useIsCoarsePointer = () => useMediaQuery('(hover: none), (pointer: coarse)');

/**
 * 「紧凑形态」：窄屏 **或** 触摸设备。
 * 页面级布局（课表清单/成绩卡片/日历月视图/底部导航）都应该用它，而不是 useIsMobile，
 * 否则平板会掉进"桌面版装不下、手机版又没启用"的空档。
 */
export const useIsCompact = () => {
  const narrow = useMediaQuery('(max-width: 1099px)');
  const coarse = useIsCoarsePointer();
  return narrow || coarse;
};

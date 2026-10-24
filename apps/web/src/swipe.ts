import { useEffect, useRef } from "react";

/** iOS 默认的减速/弹性曲线（cubic-bezier(.32,.72,0,1)），松手后的滑入/回弹都用它 */
export const SWIPE_EASE = "cubic-bezier(.32,.72,0,1)";

/** 模块签横向滑动切换参数：起点判定、纵向优先比、提交阈值、最大跟手位移、
 *  左边缘保护区（clientX<32 的右滑归「边缘返回」，不抢手势）、
 *  正常/贴边跟手阻尼（已在上/下边界时给 0.18 的「拉不动」阻尼） */
const TAB_SWIPE = { START: 12, RATIO: 1.2, THRESHOLD: 56, MAX: 56, EDGE: 32, NORMAL: 0.45, EDGE_DRAG: 0.18, REBOUND: 240 };

/** 模块签左右滑动切换（报表 / 规划）：
 *  在 tab 内容区横向滑动 → 切换到上 / 下一个模块签，内容层跟手位移，松手过阈值即切换。
 *  与「左边缘右滑返回」的分工：起点 clientX < 32 的右滑归返回（useEdgeSwipeBack 挂在
 *  页面容器上，靠冒泡仍能收到）；其余水平滑动归本 hook。签条自身可横向滚动，不参与切换。
 *  @param onChange 传入目标索引（越界时调用方自行忽略）
 *  @param resetKey 调用方 tab 内容层的重挂载信号（key 序号）：内容层靠 key 重挂载来重放
 *    入场动画，监听也必须跟着重绑，否则旧节点被卸载后新手势全部失效——2026-10-24 踩过：
 *    挂载即触发的周期重置让 seq 0→1，div 换新节点而 effect 依赖没变，整页手势静默死亡。 */
export function useTabSwipe({ enabled, count, index, onChange, resetKey }: {
  enabled: boolean;
  count: number;
  index: number;
  onChange: (next: number) => void;
  resetKey: number;
}) {
  /** 跟手位移层：调用方把它包住 tab 内容（不能包签条——签条要吸顶，transform 会破坏 sticky） */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stateRef = useRef({ startX: 0, startY: 0, engaged: false, dead: false, dx: 0 });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !enabled || count <= 1) return;
    const s = stateRef.current;
    const reset = () => {
      s.engaged = false;
      s.dead = false;
      s.dx = 0;
      s.startX = 0;
      s.startY = 0;
    };
    const clearDrag = () => {
      const body = bodyRef.current;
      if (!body) return;
      body.style.transition = "";
      body.style.transform = "";
    };
    const applyDrag = () => {
      const body = bodyRef.current;
      if (!body) return;
      const atEdge = (s.dx > 0 && indexRef.current <= 0) || (s.dx < 0 && indexRef.current >= count - 1);
      const factor = atEdge ? TAB_SWIPE.EDGE_DRAG : TAB_SWIPE.NORMAL;
      const shift = Math.max(-TAB_SWIPE.MAX, Math.min(TAB_SWIPE.MAX, s.dx * factor));
      body.style.transition = "none";
      body.style.transform = `translateX(${shift}px)`;
    };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const target = event.target as HTMLElement | null;
      // 签条自己横滚；表单元素不抢手势；左边缘右滑归「边缘返回」
      if (target?.closest?.(".page-tabs")) return;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (touch.clientX < TAB_SWIPE.EDGE) return;
      s.startX = touch.clientX;
      s.startY = touch.clientY;
      s.engaged = false;
      s.dead = false;
      s.dx = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (s.dead) return;
      if (s.startX === 0 && s.startY === 0) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;
      if (!s.engaged) {
        if (Math.abs(dx) > TAB_SWIPE.START && Math.abs(dx) > Math.abs(dy) * TAB_SWIPE.RATIO) {
          s.engaged = true;
        } else if (Math.abs(dy) > TAB_SWIPE.START && Math.abs(dy) > Math.abs(dx)) {
          // 纵向滚动：放弃接管，让页面正常滚动
          s.dead = true;
          return;
        } else {
          return;
        }
      }
      event.preventDefault();
      s.dx = dx;
      applyDrag();
    };
    const onEnd = () => {
      if (!s.engaged) {
        reset();
        return;
      }
      const dx = s.dx;
      const current = indexRef.current;
      if (Math.abs(dx) >= TAB_SWIPE.THRESHOLD) {
        const next = current + (dx < 0 ? 1 : -1);
        clearDrag(); // 先清跟手位移，再让入场动画接管，否则新内容会带着 translateX 进场
        reset();
        if (next >= 0 && next < count) onChangeRef.current(next);
        return;
      }
      // 未过阈值：弹回原位
      const body = bodyRef.current;
      if (body) {
        body.style.transition = `transform ${TAB_SWIPE.REBOUND}ms ${SWIPE_EASE}`;
        body.style.transform = "translateX(0)";
        window.setTimeout(clearDrag, TAB_SWIPE.REBOUND + 20);
      }
      reset();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      reset();
    };
  }, [enabled, count, resetKey]);
  return { bodyRef };
}

import { useCallback, useEffect, useRef } from "react";

/** iOS 默认的减速/弹性曲线（cubic-bezier(.32,.72,0,1)），松手后的滑入/回弹都用它 */
export const SWIPE_EASE = "cubic-bezier(.32,.72,0,1)";

/** 模块签横向滑动切换参数：起点判定、纵向优先比、提交阈值、左边缘保护区
 * （clientX<32 的右滑归「边缘返回」，不抢手势）、贴边阻尼（已在首/末签时拉不动）、
 * 松手后位移到目标页/弹回的时长 */
const TAB_SWIPE = { START: 12, RATIO: 1.2, THRESHOLD: 56, EDGE: 32, EDGE_DRAG: 0.2, COMMIT: 240, REBOUND: 240 };

/**
 * 模块签左右滑动切换（报表 / 规划），iOS 分页式：
 * 各模块内容横向排成一条轨道挨在一起，拖动时与手指 1:1 跟手：往左拖则右侧露出
 * 下一个模块的左半、往右拖则左侧露出上一个模块的右半（iOS 分页式），
 * 松手过阈值即滑到相邻页、未过阈值按 iOS 曲线弹回。
 * 与「左边缘右滑返回」的分工：起点 clientX < 32 的右滑归返回（useEdgeSwipeBack 挂在
 * 页面容器上，靠冒泡仍能收到）；其余水平滑动归本 hook。签条自身可横向滚动，不参与切换。
 *
 * 位移用**百分比**（相对轨道自身宽度）而非像素：这样屏幕旋转 / 容器宽度变化都不用
 * 重新测量，也不会在拖动时因为测宽度而抖动。注意百分比相对的是**轨道自己的边框盒**
 * （各页 flex:0 0 100%，溢出的是轨道、轨道并不会被撑宽），所以一页 = 100% 而不是
 * 100/count %——错算成后者的表现是「切过去了但停在半路」。
 *
 * @param onChange 传入目标索引（越界时调用方自行忽略）
 * @param resetKey 调用方容器 DOM 节点的重挂载信号（如 key 序号），可省略。
 *    分页式下各页按 tab.id 常驻、容器不重挂载，故不需要；但**如果哪天给容器加了
 *    key 让它换新节点，必须把那个序号传进来**——2026-10-24 踩过：内容层靠 key
 *    重挂载时监听不跟着重绑，旧节点卸载后新手势全部静默死亡（表象：第一次能滑、后续全失效）。 */
export function useTabSwipe({ enabled, count, index, onChange, resetKey }: {
  enabled: boolean;
  count: number;
  index: number;
  onChange: (next: number) => void;
  resetKey?: number;
}) {
  /** 手势监听层 + 视口（overflow:hidden 裁掉两侧，只留当前页宽度可看） */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 横向轨道：所有模块页横排，靠 translateX 位移到目标页 */
  const trackRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stateRef = useRef({ startX: 0, startY: 0, engaged: false, dead: false, dx: 0, animating: false });

  /** 第 i 页的轨道位移（百分比）。
   *  坑：百分比是相对**元素自身边框盒**算的，而轨道宽度就是一页宽（各页 flex:0 0 100%，
   *  溢出的是轨道而不是被撑宽），所以一页 = 100% 而不是 100/count %——
   *  后者位移只有 1/count，表现出来就是「切过去了但停在半路」。 */
  const pageShift = (i: number) => -i * 100;
  /** 最近一次写入的位移串：用来在外部改变当前签时判断是否需要归位（避免打断手势动画） */
  const shiftRef = useRef("");

  const apply = (shift: string, animated: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = animated ? `transform ${TAB_SWIPE.COMMIT}ms ${SWIPE_EASE}` : "none";
    track.style.transform = `translateX(${shift})`;
    shiftRef.current = shift;
  };

  /** 外部（点模块签）切换时调用：相邻一页才做位移动画 */
  const snapTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    // 相隔 2 签以上（点签条跳远）不滑：中间页根本没渲染，滑过去要穿过一片空白。
    // iOS 的分页控件也是点击即切，只有手势才逐页跟手滑动。
    const animated = Math.abs(clamped - indexRef.current) === 1;
    apply(`${pageShift(clamped)}%`, animated);
  }, [count]);

  /** 视口高度跟随当前页 + 外部改签后轨道归位：
   *  高度不跟随会被最高的那页撑高，切到短页面时底部一大片空白。
   *  注意：只渲染当前页 ±1 页，所以 DOM 顺序 ≠ 签顺序，必须按 data-page 取页。 */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const target = `${pageShift(index)}%`;
    // 手势提交 / 点击切签已经把轨道放到目标位置了，这里再写一遍会打断过渡动画
    if (shiftRef.current !== target) apply(target, false);
    const page = body.querySelector<HTMLElement>(`.tab-swipe-page[data-page="${index}"]`);
    if (!page) return undefined;
    const sync = () => {
      body.style.height = `${page.offsetHeight}px`;
    };
    sync();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(page);
    return () => observer.disconnect();
  }, [index, count, resetKey]);

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
    const applyDrag = () => {
      const current = indexRef.current;
      const atEdge = (s.dx > 0 && current <= 0) || (s.dx < 0 && current >= count - 1);
      const factor = atEdge ? TAB_SWIPE.EDGE_DRAG : 1; // 分页滑动是 1:1 跟手
      // 与手指 1:1 位移（混合 % 与 px，CSS calc 支持），两侧相邻模块随之一同露出
      apply(`calc(${pageShift(current)}% + ${s.dx * factor}px)`, false);
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
      if (s.dead || s.animating) return;
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
        reset();
        if (next >= 0 && next < count) {
          s.animating = true;
          apply(`${pageShift(next)}%`, true);
          onChangeRef.current(next);
          window.setTimeout(() => {
            s.animating = false;
          }, TAB_SWIPE.COMMIT);
          return;
        }
      }
      // 未过阈值（或已在首/末签）：弹回当前页
      s.animating = true;
      apply(`${pageShift(current)}%`, true);
      window.setTimeout(() => {
        s.animating = false;
      }, TAB_SWIPE.REBOUND);
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

  return { bodyRef, trackRef, snapTo };
}

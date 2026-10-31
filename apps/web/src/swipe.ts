import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** iOS 默认的减速/弹性曲线（cubic-bezier(.32,.72,0,1)），松手后的滑入/回弹都用它 */
export const SWIPE_EASE = "cubic-bezier(.32,.72,0,1)";

/** 切页「停留」专用曲线（cubic-bezier(.37,.25,.63,1)）——用户要随手记那种「缓慢放置」。
 *  为什么不能沿用 SWIPE_EASE：那条曲线前重后轻，20% 时间就走完 66%、40% 就走完 92%，
 *  运动其实在 ~40% 处就结束了，剩下全是蠕变——400ms 体感只有 ~150ms，「迅速停留」。
 *  这条是缓入缓出家族（起止速度都为 0，软着陆不硬戳），但起步推力比 easeInOutSine 大
 *  （10% 时间走 8% 而非 2%），松手后不会先愣一下；中段接近匀速，位移摊满整个时长。 */
export const SETTLE_EASE = "cubic-bezier(.37,.25,.63,1)";

/** 模块签横向滑动切换参数：起点判定、纵向优先比、提交阈值、左边缘保护区
 * （clientX<32 的右滑归「边缘返回」，不抢手势）、贴边阻尼（已在首/末签时拉不动）、
 * 松手后位移到目标页/弹回的时长（600/340ms：240ms 收尾太急，400ms 仍「迅速停留」，
 * 用户要求随手记那种缓慢放置——配 SETTLE_EASE 把位移摊满全程；弹回是回家不是放置，
 * 保持快弹） */
const TAB_SWIPE = { START: 12, RATIO: 1.2, THRESHOLD: 56, EDGE: 32, EDGE_DRAG: 0.2, COMMIT: 600, REBOUND: 340 };

/**
 * 模块签左右滑动切换（报表 / 规划），iOS 分页式：
 * 各模块内容横向排成一条轨道挨在一起，拖动时与手指 1:1 跟手：往左拖则右侧露出
 * 下一个模块的左半、往右拖则左侧露出上一个模块的右半（iOS 分页式），
 * 松手过阈值即**缓慢放置**到相邻页（600ms + SETTLE_EASE，位移摊满全程、零速软着陆）、
 * 未过阈值按 iOS 曲线快弹回（放置与回弹是两种性格，曲线时长都不同）。
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
export function useTabSwipe({ enabled, count, index, onChange, resetKey, stripRef }: {
  enabled: boolean;
  count: number;
  index: number;
  onChange: (next: number) => void;
  resetKey?: number;
  /** 顶部签条（.page-tabs）的 ref：传入后签条会**跟随内容一起滑**——
   *  拖动时按小数索引把对应签居中，切页/点签时平滑滚到位。不传则签条不动。 */
  stripRef?: React.RefObject<HTMLElement | null>;
}) {
  /** 手势监听层 + 视口（overflow:hidden 裁掉两侧，只留当前页宽度可看） */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 横向轨道：所有模块页横排，靠 translateX 位移到目标页 */
  const trackRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stateRef = useRef({ startX: 0, startY: 0, engaged: false, dead: false, dx: 0, baseX: 0 });

  /** 第 i 页的轨道位移（百分比）。
   *  坑：百分比是相对**元素自身边框盒**算的，而轨道宽度就是一页宽（各页 flex:0 0 100%，
   *  溢出的是轨道而不是被撑宽），所以一页 = 100% 而不是 100/count %——
   *  后者位移只有 1/count，表现出来就是「切过去了但停在半路」。 */
  const pageShift = (i: number) => -i * 100;

  const apply = (shift: string, duration: number | null, ease: string = SETTLE_EASE) => {
    const track = trackRef.current;
    if (!track) return;
    // duration 为 null = 不过渡（跟手 / 归位）；切页用 SETTLE_EASE 缓慢放置，弹回用
    // SWIPE_EASE 快弹——两条曲线不同，别写死成一个
    track.style.transition = duration === null ? "none" : `transform ${duration}ms ${ease}`;
    track.style.transform = `translateX(${shift})`;
  };

  /** 签条跟随内容：把「第 t 个签」（t 可含小数，拖动时用）居中到签条可视区。
   *  为什么按住 t 而不是 index：拖动过程中内容与手指 1:1 位移，签条若只在落位时跳一次，
   *  就会出现「下面在滑、上面不动」的割裂感（用户 2026-10-30 反馈）。小数索引让签条
   *  与内容同步滑，落位时再平滑滚到整数签。
   *  用 getBoundingClientRect 求相对签条的居中位置，不依赖 offsetParent（签条是 sticky）。
   *
   *  ⚠️ 平滑居中必须用**自驱动的 rAF 动画**，绝不能用 `scrollTo({behavior:"smooth"})`：
   *  iOS Safari 不会因写入 `scrollLeft` 而取消进行中的原生平滑滚动，它会把动画在层被
   *  隐藏（停靠 opacity:0 / overflow:hidden）期间**挂起**，等返回变可见时**续播**——
   *  表现就是「返回时签条从右边滑到中间」（用户 2026-10-31 第七轮 iPhone 13 真机复现）。
   *  rAF 动画由我们完全掌控，进子页前 cancelAnimationFrame 即可彻底掐断，iOS 没有可挂起的
   *  原生滚动动画，自然无从续播。 */
  const followStripRef = useRef<(t: number, smooth: boolean) => void>(() => undefined);
  /** 自驱动平滑滚动的动画句柄（唯一真相，cancel 它就能在任何时刻掐断） */
  const stripAnimRef = useRef<number>(0);
  const animateStripTo = (to: number, duration: number) => {
    const strip = stripRef?.current;
    if (!strip) return;
    const from = strip.scrollLeft;
    if (Math.abs(from - to) < 0.5) {
      strip.scrollLeft = to;
      return;
    }
    const startTs = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startTs) / duration);
      const e = 1 - (1 - p) * (1 - p); // easeOutQuad：起手快、落位缓，贴合「缓慢放置」手感
      strip.scrollLeft = from + (to - from) * e;
      if (p < 1) stripAnimRef.current = requestAnimationFrame(step);
      else stripAnimRef.current = 0;
    };
    stripAnimRef.current = requestAnimationFrame(step);
  };
  followStripRef.current = (t: number, smooth: boolean) => {
    const strip = stripRef?.current;
    if (!strip || count <= 1) return;
    const tabs = Array.from(strip.children) as HTMLElement[];
    if (tabs.length === 0) return;
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    if (maxScroll <= 1) return; // 签条不需要滚动（签少于一屏）
    const clamped = Math.max(0, Math.min(count - 1, t));
    const lo = Math.floor(clamped);
    const hi = Math.min(tabs.length - 1, lo + 1);
    const frac = clamped - lo;
    const centerOf = (el?: HTMLElement) => {
      if (!el) return 0;
      const navRect = strip.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return rect.left - navRect.left + strip.scrollLeft + rect.width / 2;
    };
    const center = centerOf(tabs[lo]) + (centerOf(tabs[hi]) - centerOf(tabs[lo])) * frac;
    const target = Math.max(0, Math.min(maxScroll, center - strip.clientWidth / 2));
    // 任何一次（无论 smooth 与否）都先掐断正在跑的 rAF 动画，确保「进子页前钉死」能真正停下
    if (stripAnimRef.current) {
      cancelAnimationFrame(stripAnimRef.current);
      stripAnimRef.current = 0;
    }
    if (!smooth) {
      if (Math.abs(strip.scrollLeft - target) >= 0.5) strip.scrollLeft = target;
      return;
    }
    if (Math.abs(strip.scrollLeft - target) < 1) return;
    animateStripTo(target, 360);
  };

  /** 外部（点模块签）切换时调用：相邻一页才做位移动画 */
  const snapTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    // 相隔 2 签以上（点签条跳远）不滑：中间页根本没渲染，滑过去要穿过一片空白。
    // iOS 的分页控件也是点击即切，只有手势才逐页跟手滑动。
    const animated = Math.abs(clamped - indexRef.current) === 1;
    apply(`${pageShift(clamped)}%`, animated ? TAB_SWIPE.COMMIT : null);
    followStripRef.current(clamped, true);
  }, [count]);

  /** 视口高度跟随当前页 + 外部改签后轨道归位：
   *  高度不跟随会被最高的那页撑高，切到短页面时底部一大片空白。
   *  注意：只渲染当前页 ±1 页，所以 DOM 顺序 ≠ 签顺序，必须按 data-page 取页。
   *  首次写入不过渡：刚进页面容器是 auto 高（= 已渲染页里最高的那位），直接过渡会看到
   *  内容区莫名收缩一下；之后的写入（切签 / 内容增减）才走 CSS 的 400ms 柔和收敛。 */
  const heightInited = useRef(false);
  /** 上一次用的视口节点：用**节点身份**识别「容器刚被重建」。
   *  注意：报表页改成「列表层停靠不卸载」之后**不再重建**，这个判据恒为 false，
   *  所以它不能是唯一判据——必须同时看 `resetKey` 是否变化（见下）。 */
  const lastBodyRef = useRef<HTMLDivElement | null>(null);
  /** 上一次的 resetKey（调用方用「是否在子页」或「月/年」当它）：
   *  它一变就说明页面**换了层级**（进/出子页、月↔年切签数），这种时候一切都要
   *  **瞬时到位**，不能有任何过渡/平滑滚动——否则用户就会看到「恢复到点击前状态」
   *  的过程（用户 2026-10-31 连三轮反馈的就是这个）。 */
  const lastResetKeyRef = useRef<number | undefined>(undefined);
  /** 上一次的签号 / 签数：用来区分「真的换签了」和「只是进出子页」。
   *  进出子页时签条位置由停靠层原样保留（见 .report-list-layer.parked），**不该重新居中**：
   *  重新居中 = 用当下的几何重新算一遍目标，真机上字体/宽度微差会让它跟原位置差几像素，
   *  表现出来就是「返回时标题位置动了一下」（用户 2026-10-31 第五轮）。 */
  const lastIndexRef = useRef<number | undefined>(undefined);
  const lastCountRef = useRef<number | undefined>(undefined);
  /** 瞬时抑制窗口的截止时间戳：resetKey 变化后的一小段时间内，连 ResizeObserver
   *  引起的高度写入也一律瞬时。真机上字体加载/图表二次布局会让内容高度在首帧之后
   *  再变一次，那一次如果走 600ms 过渡，看起来就是「内容在慢慢恢复」。 */
  const instantUntilRef = useRef(0);
  // 用 layout effect：重建后要在**绘制前**就把位移/高度/签条摆好，否则会闪一帧「第 0 页 + 签条在最左」
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const rebuilt = lastBodyRef.current !== body;
    lastBodyRef.current = body;
    const resetChanged = lastResetKeyRef.current !== resetKey;
    lastResetKeyRef.current = resetKey;
    /** 本次 effect 里的所有写入是否必须瞬时（不留任何动画） */
    const instant = rebuilt || resetChanged;
    if (instant) instantUntilRef.current = performance.now() + 400;
    const target = `${pageShift(index)}%`;
    // 手势提交 / 点击切签已经把轨道放到目标位置了，这里再写一遍会打断过渡动画。
    // 判据必须比对 **DOM 上的实际 inline transform**，不能只记「上次写了什么」：
    // 容器被卸载重建后（报表进子页时 .tab-swipe-body/.tab-swipe-track 整个换新节点）
    // 新节点上没有任何 transform，记忆值还是旧的，会被误判成「已在目标位置」而跳过归位。
    // 表现：从子页返回后轨道停在第 0 页——开头几签看起来「返回到了别的模块」，
    // 末尾几签（核心洞察/异常分析）因为第 0 页压根没渲染 → 整页一片空白。
    const track = trackRef.current;
    if (track && track.style.transform !== `translateX(${target})`) apply(target, null);
    // 签条归位：**只有「真的换签了」才动签条**。
    // ① 进出子页（index/count 都没变）→ 一根手指都不碰：停靠层把 scrollLeft 原样留着，
    //    重新居中反而会用当下几何算出几像素的偏差，于是「返回时标题位置动了一下」；
    // ② 换签 / 月年切换（index 或 count 变了）→ 照旧，换层级期间一律瞬时（别用 smooth：
    //    以前用 `!rebuilt` 当判据，列表层改成常驻后恒为 false → 返回时又变 smooth，
    //    签条会自己滚一下）；正常点签/滑动切签走 smooth，别打断 snapTo 启动的滚动。
    const stripNeedsReflow = lastIndexRef.current !== index || lastCountRef.current !== count;
    lastIndexRef.current = index;
    lastCountRef.current = count;
    if (stripNeedsReflow) followStripRef.current(index, !instant);
    const page = body.querySelector<HTMLElement>(`.tab-swipe-page[data-page="${index}"]`);
    if (!page) return undefined;
    /** 高度写入是否必须瞬时：进/出子页、月年切换期间一律瞬时；正常切签才走 CSS 过渡
     *  （切到矮页时容器柔和收敛）。切签时只让**第一次**写入过渡，之后同一签内
     *  展开/收起内容引起的高度变化照旧过渡。 */
    let allowTransition = !instant;
    const mustBeInstant = () => instant || performance.now() < instantUntilRef.current;
    const sync = () => {
      const next = `${page.offsetHeight}px`;
      if (body.style.height === next) return;
      if (!heightInited.current || mustBeInstant() || !allowTransition) {
        heightInited.current = true;
        body.style.transition = "none";
        body.style.height = next;
        void body.offsetHeight; // 强制回流，让「不过渡」即时生效后再恢复
        body.style.transition = "";
        return;
      }
      allowTransition = false;
      body.style.height = next;
    };
    sync();
    // 顺手把横向滚动钉回 0（见下方 pinBodyScroll 的说明）
    if (body.scrollLeft !== 0) body.scrollLeft = 0;
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(page);
    return () => observer.disconnect();
  }, [index, count, resetKey]);

  /** .tab-swipe-body 只是裁剪容器，本不该被滚动。但 `overflow:hidden` 的元素**仍是滚动容器**，
   *  浏览器会把获得焦点的元素滚进可视区，于是它会被横向（实测 12px）或**纵向**滚开一段：
   *  横向 → 当前页左偏、右邻页在右边缘露出一条边（早先「页面只有一半」那类观感）；
   *  纵向 → 整块内容在容器里上下滑一下（用户 2026-10-31 第四轮「返回时有个回到该标题的
   *  动作」的真凶：轨道比容器高 300+px，纵向余量足够滑）。
   *  首选机制层的 `overflow: clip`（见 styles.css，clip 不创建滚动容器、根本没法被滚）；
   *  这里给没有 `@supports` 的旧 Safari 兜底，**两轴都要钉**——只钉横向等于没修。 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const pin = () => {
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
      if (el.scrollTop !== 0) el.scrollTop = 0;
    };
    pin();
    el.addEventListener("scroll", pin, { passive: true });
    return () => el.removeEventListener("scroll", pin);
  }, []);

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
    /** 轨道当前的实际位移（px）：切页动画途中被新手势接管时当基准用 */
    const readTrackX = () => {
      const track = trackRef.current;
      if (!track) return 0;
      const cs = getComputedStyle(track);
      const m = new DOMMatrixReadOnly(cs.transform === "none" ? "matrix(1,0,0,1,0,0)" : cs.transform);
      return m.m41;
    };
    const applyDrag = () => {
      const current = indexRef.current;
      const atEdge = (s.dx > 0 && current <= 0) || (s.dx < 0 && current >= count - 1);
      const factor = atEdge ? TAB_SWIPE.EDGE_DRAG : 1; // 分页滑动是 1:1 跟手
      // 与手指 1:1 位移。基准用 engage 时读到的实际位移（可能是上一次动画途中的位置），
      // 而不是 pageShift(current)%——后者会把页面瞬移到「目标页 + dx」，接管时看到跳变。
      // 松手提交时再切回百分比（apply 的目标值），窗口缩放依旧安全。
      apply(`${s.baseX + s.dx * factor}px`, null);
      // 签条同步滑：dx<0 往下一页 → 小数索引向右走
      const pageWidth = bodyRef.current?.clientWidth || 1;
      followStripRef.current(indexRef.current - (s.dx / pageWidth) * factor, false);
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
      // 注意：不拦「上一次切页/弹回动画途中」的新手势——600ms 的放置动画期间吞掉输入，
      // 快速连滑会每隔一次就失灵（iOS 的行为是新手势直接接管进行中的动画）。
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
          s.baseX = readTrackX();
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
          apply(`${pageShift(next)}%`, TAB_SWIPE.COMMIT);
          followStripRef.current(next, true);
          onChangeRef.current(next);
          return;
        }
      }
      // 未过阈值（或已在首/末签）：弹回当前页（时长用 REBOUND，比切页略短；弹回是
      // 「回家」不是「放置」，保持快弹用 SWIPE_EASE）
      apply(`${pageShift(current)}%`, TAB_SWIPE.REBOUND, SWIPE_EASE);
      followStripRef.current(current, true);
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

  return { bodyRef, trackRef, snapTo, followStrip: followStripRef };
}

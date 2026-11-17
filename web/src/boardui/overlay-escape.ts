// 浮层的两个「兜底」：焦点与 Esc。
//
// 真机（.218）上撞出来的问题：面板挂在宿主页面里，抽屉打开后 `document.activeElement`
// 是 `<body>`（焦点没进抽屉）。react-aria 的 Esc 处理要求事件发生在浮层内部，
// 焦点在 body 上时它直接忽略 —— 结果按 Esc 关不掉抽屉，键盘用户也被留在页面上。
// 假宿主上跑不出来（那边没有宿主的全局焦点处理），所以这两个兜底必须写在组件里：
//
//   1. useFocusOnMount —— 打开后如果焦点不在浮层里，把浮层自己聚焦（tabIndex=-1）
//   2. useEscapeFallback —— 在 window 上补一个 Esc 监听，只关「最上层」的那个浮层
//
// 两个都是幂等的：react-aria 自己关掉时再调一次 onClose 也不会有副作用。
import { useEffect, useRef, type RefObject } from "react";

/** 给浮层的根节点打标记，用来判断谁在最上层。 */
export const OVERLAY_ATTR = "data-boardui-overlay";

export function topOverlay(): Element | null {
  const all = document.querySelectorAll(`[${OVERLAY_ATTR}]`);
  return all.length === 0 ? null : all[all.length - 1];
}

export function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.contains(document.activeElement)) {
      // 浮层容器本身是 tabIndex=-1，先站住焦点，Tab 再往里走。
      element.focus({ preventScroll: true });
    }
  }, [ref]);
}

export function useEscapeFallback(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 只有最上层那个浮层响应，避免「关一个弹窗把底下的抽屉也关了」
      if (topOverlay() !== ref.current) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref, enabled]);
}

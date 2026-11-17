// 右侧抽屉 —— 官方 BoardUI Drawer（registry: www.boardui.com/r/drawer.json）。
//
// 上一版是「按公开文档自己拼的等价物」（react-aria ModalOverlay + Modal + Dialog）。
// 官方把 Drawer 公开后直接用它：焦点锁定、滚动锁定、Esc/遮罩关闭、退出动画、
// 24px 出屏位移都由组件负责，我们只保留两件它不管的事：
//   1. 宿主页面上焦点可能落到 <body>（真机踩过）—— 保留 useFocusOnMount / useEscapeFallback
//   2. [data-boardui-overlay] 标记 —— overlay-escape.ts 靠它找「最上层浮层」
//
// 尺寸：官方 side drawer 只有 320 / 400 / 600（max-w 加在 AriaModal 上、className 只落到
// 内层 ModalDialog，所以**改不动宽度**）。当前用 lg = 600px，已确认接受。
import type { ReactNode } from "react";
import { useRef } from "react";
import {
  Drawer as BoarduiDrawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
} from "../components/base/drawer/drawer";
import { useEscapeFallback, useFocusOnMount, OVERLAY_ATTR } from "./overlay-escape";

export interface DrawerProps {
  title: ReactNode;
  hint?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** 已废弃：官方尺寸只有 320/400/600，这里保留参数只为不破坏调用点。 */
  width?: number;
  children?: ReactNode;
}

export function Drawer({ title, hint, onClose, footer, children }: DrawerProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  useFocusOnMount(panel);
  useEscapeFallback(panel, onClose);
  return (
    <BoarduiDrawer
      isOpen
      placement="end"
      size="lg"
      /* 没有 onOpenChange 的话，遮罩点击与右上角关闭键都是空操作（官方内部调 close()） */
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      className="bg-background-primary-default text-text-primary"
      overlayClassName="ds-drawer-overlay"
    >
      {/* 这一层只负责「焦点落点」与「最上层浮层标记」，不参与布局 */}
      <div
        ref={panel}
        tabIndex={-1}
        {...{ [OVERLAY_ATTR]: "" }}
        className="flex h-full min-h-0 w-full flex-col outline-none"
      >
        <DrawerHeader
          title={typeof title === "string" ? title : undefined}
          description={hint === undefined || hint === null || hint === "" ? undefined : hint}
          closeLabel="关闭"
        />
        <DrawerBody>{children}</DrawerBody>
        {footer === undefined || footer === null ? null : (
          <DrawerFooter className="justify-start">{footer}</DrawerFooter>
        )}
      </div>
    </BoarduiDrawer>
  );
}

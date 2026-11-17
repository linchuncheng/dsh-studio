// 右侧抽屉 —— **我们自己写的**，不是抄 BoardUI 的源码。
//
// BoardUI 的 Drawer / Modal 是 Pro 组件，公共仓库里没有（curl 过 404），按既定约束
// 「不买、不复制付费源码」，这里按它们公开文档里的视觉与行为拼一个等价物：
//   · 遮罩 bg-black/45 + 轻微 blur，点遮罩就关
//   · 面板从右侧滑出，左边一条分隔线，宽 min(760px, 96vw)
//   · 头部标题 + 说明 + 右上角关闭（用他们 MIT 的 Button 源码）
//   · 内容区独立滚动，页脚固定
// 行为交给 react-aria 的 ModalOverlay + Modal + Dialog（免费、与 Select/Input 同一套
// 无障碍实现）：Esc 关闭、焦点锁定在抽屉内、关闭后焦点归还触发元素。
// 浮层走 bridge.jsx 里 UNSAFE_PortalProvider 指定的容器，所以作用域化的 Tailwind 照样生效。
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { RiCloseLine } from "@remixicon/react";
import { Button } from "../components/base/buttons/button";
import { cx } from "../utils/cx";
import { useEscapeFallback, useFocusOnMount, OVERLAY_ATTR } from "./overlay-escape";

export interface DrawerProps {
  title: ReactNode;
  hint?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** 面板宽度；默认 760，最大不超过视口的 96%。 */
  width?: number;
  children?: ReactNode;
}

export function Drawer({ title, hint, onClose, footer, width = 760, children }: DrawerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusOnMount(dialogRef);
  useEscapeFallback(dialogRef, onClose);
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={({ isEntering, isExiting }) =>
        cx(
          "fixed inset-0 z-[95] flex justify-end bg-black/45 backdrop-blur-[1px]",
          isEntering && "animate-in fade-in duration-150",
          isExiting && "animate-out fade-out duration-150",
        )
      }
    >
      <Modal
        className={({ isEntering, isExiting }) =>
          cx(
            "flex h-full flex-col border-l border-separator-border",
            "bg-background-primary-default text-text-primary",
            "shadow-[0_0_60px_rgba(0,0,0,.35)] outline-none",
            isEntering && "animate-in slide-in-from-right duration-200",
            isExiting && "animate-out slide-out-to-right duration-150",
          )
        }
        style={{ width: `min(${width}px, 96vw)` }}
      >
        <Dialog ref={dialogRef} tabIndex={-1} {...{ [OVERLAY_ATTR]: "" }} className="flex h-full min-h-0 w-full flex-col outline-none">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-separator-border px-5 py-3.5">
            <div className="min-w-0">
              <Heading slot="title" className="truncate text-title-3-semibold text-text-primary">
                {title}
              </Heading>
              {hint === undefined || hint === null || hint === "" ? null : (
                <div className="mt-1 text-caption-1-medium leading-relaxed text-text-secondary">{hint}</div>
              )}
            </div>
            <Button
              variant="ghost"
              size="small"
              iconOnly
              leadingIcon={RiCloseLine}
              aria-label="关闭"
              onClick={onClose}
              className="shrink-0"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer === undefined || footer === null ? null : (
            <div className="shrink-0 border-t border-separator-border px-5 py-3">{footer}</div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

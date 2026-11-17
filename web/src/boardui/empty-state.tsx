// 空态 —— **我们自己写的**等价物（BoardUI 没有空态组件，它家的空态是各页面自带的插画）。
//
// 用他们的 token 拼一个通用的：浅底 + 描边 + 圆角，中间一段说明文字，可选一个行动按钮。
// 视觉上跟面板里的卡片一致，不再用「虚线框 + 斜体提示」那套上个时代的空态语言。
import type { ComponentType, ReactNode } from "react";
import { cx } from "../utils/cx";

export interface EmptyStateProps {
  /** 一句话说明「这里为什么是空的」。 */
  title?: ReactNode;
  /** 可选的第二步：怎么办。 */
  hint?: ReactNode;
  /** 可选图标（Remix Icon 组件）。 */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** 可选行动按钮 / 链接。 */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function EmptyState({ title, hint, icon: Icon, action, className, children }: EmptyStateProps) {
  const body = title ?? children;
  return (
    <div
      data-empty-state=""
      className={cx(
        "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl",
        "border border-separator-border bg-background-secondary-default px-4 py-6 text-center",
        className,
      )}
    >
      {Icon ? <Icon className="mb-1 size-5 text-text-tertiary" aria-hidden /> : null}
      {body === undefined || body === null || body === "" ? null : (
        <div className="text-body-2-regular text-text-secondary">{body}</div>
      )}
      {hint === undefined || hint === null || hint === "" ? null : (
        <div className="text-caption-1-regular text-text-tertiary">{hint}</div>
      )}
      {action === undefined || action === null ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

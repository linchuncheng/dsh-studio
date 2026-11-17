// 任务列表 —— **我们自己写的** Pro 等价物（BoardUI 的 task list 是 Pro，不买不抄）。
//
// 和 chart-card.tsx 的 ChartCard 共用同一个外壳（标题 + 附注 + 脚注），只是内容变成
// 一行一条任务：左边标题 + 一行说明，右边放一个动作按钮。用在效能页「返工最多的卡」
// 这类列表上；看板列里的卡片不走这里（它绑着拖拽 / WIP / 分页，单独一套）。
import type { ReactNode } from "react";
import { ChartCard } from "./chart-card";
import { cx } from "../utils/cx";

export interface TaskListProps {
  title: ReactNode;
  aside?: ReactNode;
  hint?: ReactNode;
  footer?: ReactNode;
  /** 空态文案；给了且没有 children 时显示。 */
  empty?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function TaskList({ title, aside, hint, footer, empty, className, children }: TaskListProps) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : children !== undefined && children !== null;
  return (
    <ChartCard title={title} aside={aside} hint={hint} footer={footer} className={className}>
      <div data-task-list="" className="flex min-w-0 flex-col">
        {hasChildren ? children : <div className="text-caption-1-regular text-text-tertiary">{empty ?? "暂无数据。"}</div>}
      </div>
    </ChartCard>
  );
}

export interface TaskRowProps {
  title: ReactNode;
  hint?: ReactNode;
  /** 右侧动作（通常是一个 ghost 小按钮）。 */
  action?: ReactNode;
  /** 整行点击（不给就用 action 按钮）。 */
  onClick?: () => void;
  className?: string;
}

export function TaskRow({ title, hint, action, onClick, className }: TaskRowProps) {
  return (
    <div
      data-task-row=""
      onClick={onClick}
      className={cx(
        "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150",
        onClick ? "cursor-pointer hover:bg-background-primary-hover" : "",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-2-medium text-text-primary">{title}</div>
        {hint === undefined || hint === null || hint === "" ? null : (
          <div className="mt-0.5 text-caption-1-regular text-text-tertiary">{hint}</div>
        )}
      </div>
      {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

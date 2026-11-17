// BoardUI 适配层：原样引入的组件（TSX 未改）在这里接到我们现有调用点。
// 我们的调用方用 variant="default|secondary|ghost|destructive|link"、size="default|sm|lg|icon"，
// BoardUI 用 primary|secondary|ghost|danger 与 medium|small|xs —— 这里只做名字映射，不重写样式。
import { Button as BoarduiButton, ButtonLink as BoarduiButtonLink } from "../components/base/buttons/button";

const VARIANT = {
  default: "primary",
  primary: "primary",
  secondary: "secondary",
  outline: "secondary",
  ghost: "ghost",
  destructive: "danger",
  link: "ghost",
} as const;

const SIZE = { default: "medium", sm: "small", xs: "xs", lg: "medium", icon: "medium" } as const;

/** 与原来 shadcn Button 同名的薄适配：传进来的 variant/size 自动翻译成 BoardUI 的取值。 */
export function Button({ variant = "default", size = "default", ...rest }: any) {
  return <BoarduiButton variant={VARIANT[variant] ?? "primary"} size={SIZE[size] ?? "medium"} {...rest} />;
}

/** 原样导出，想直接用他们 API（leadingIcon / iconOnly）时走这个。 */
export { BoarduiButton as ButtonBase, BoarduiButtonLink as ButtonLink };

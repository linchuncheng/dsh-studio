// BoardUI 适配层：原样引入的组件（TSX 未改）在这里接到我们现有调用点。
// 我们的调用方用 variant="default|secondary|ghost|destructive|link"、size="default|sm|lg|icon"，
// BoardUI 用 primary|secondary|ghost|danger 与 medium|small|xs —— 这里只做名字映射，不重写样式。
import { Button as BoarduiButton, ButtonLink as BoarduiButtonLink } from "../components/base/buttons/button";
import { TextField as BoarduiField, InputBase as BoarduiInputBase } from "../components/base/input/input";
import { TextareaBase as BoarduiTextareaBase } from "../components/base/textarea/textarea";
import { Checkbox as BoarduiCheckboxBase } from "../components/base/checkbox/checkbox";
import { Select as BoarduiSelect, SelectItem as BoarduiSelectItem } from "../components/base/select/select";

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

/* -------------------------------------------------------------------------- */
/* 表单控件：把 legacy 的 value / onChange(e) / className:'ds-input' 语义      */
/* 翻译成 react-aria 的 value / onChange(string) / 组件 className。            */
/* 组件本体仍是 BoardUI 源码（TextField + InputBase），一行没改。                */
/* -------------------------------------------------------------------------- */

/** legacy 的样式类由我们自己的 CSS 负责，不往 BoardUI 的壳子上挂。 */
const LEGACY_CLASS = new Set(["ds-input", "ds-textarea", "ds-field", "ds-select"]);

function extraClasses(className: unknown): string {
  return String(className ?? "")
    .split(/\s+/)
    .filter((name) => name !== "" && !LEGACY_CLASS.has(name))
    .join(" ");
}

/** react-aria 要求字段有可访问名：没给 aria-label 就退到 placeholder / title。 */
function fieldLabel(rest: Record<string, any>, key = "placeholder"): string | undefined {
  const explicit = rest["aria-label"] ?? rest["aria-labelledby"];
  if (typeof explicit === "string" && explicit !== "") return explicit;
  const fallback = rest[key] ?? rest.title;
  return typeof fallback === "string" && fallback !== "" ? fallback : undefined;
}

/** 把 DOM 事件语义的 onChange 包一层，保持 e.target.value。 */
function valueHandler(onChange: unknown) {
  return (next: string) => {
    if (typeof onChange === "function") onChange({ target: { value: next } });
  };
}

export function Input({
  className,
  style,
  value,
  defaultValue,
  onChange,
  disabled,
  readOnly,
  required,
  ...rest
}: any) {
  return (
    <BoarduiField
      className={["w-full", extraClasses(className)].filter(Boolean).join(" ")}
      style={style}
      value={value === undefined || value === null ? undefined : String(value)}
      defaultValue={defaultValue === undefined || defaultValue === null ? undefined : String(defaultValue)}
      onChange={valueHandler(onChange)}
      isDisabled={disabled === true}
      isReadOnly={readOnly === true}
      isRequired={required === true}
      aria-label={fieldLabel(rest)}
    >
      <BoarduiInputBase {...rest} />
    </BoarduiField>
  );
}

export function Textarea({
  className,
  style,
  value,
  defaultValue,
  onChange,
  disabled,
  readOnly,
  required,
  rows,
  ...rest
}: any) {
  const rowCount = Number(rows) > 0 ? Number(rows) : 4;
  return (
    <BoarduiField
      className={["w-full", extraClasses(className)].filter(Boolean).join(" ")}
      style={style}
      value={value === undefined || value === null ? undefined : String(value)}
      defaultValue={defaultValue === undefined || defaultValue === null ? undefined : String(defaultValue)}
      onChange={valueHandler(onChange)}
      isDisabled={disabled === true}
      isReadOnly={readOnly === true}
      isRequired={required === true}
      aria-label={fieldLabel(rest)}
    >
      <BoarduiTextareaBase rows={rowCount} {...rest} />
    </BoarduiField>
  );
}

export function Checkbox({ className, checked, onChange, disabled, bare, ...rest }: any) {
  void className;
  void bare; // legacy 的 SwitchBox 开关标记，BoardUI 的 Checkbox 不需要
  return (
    <BoarduiCheckboxBase
      isSelected={checked === true}
      isDisabled={disabled === true}
      aria-label={typeof rest["aria-label"] === "string" ? rest["aria-label"] : rest.title}
      onChange={(next: boolean) => {
        if (typeof onChange === "function") onChange({ target: { checked: next } });
      }}
    />
  );
}

/** react-aria 的 key 不接受空字符串当可选项，空值统一走这个哨兵再映射回 ''。 */
const EMPTY_KEY = "__empty__";

export function Select({
  className,
  style,
  value,
  onChange,
  disabled,
  options,
  ...rest
}: any) {
  const list: Array<{ value: string; label: string }> =
    Array.isArray(options) && options.length > 0 ? options : [{ value: "", label: "—" }];
  const hasEmpty = list.some((option) => option.value === "");
  const toKey = (raw: string) => (hasEmpty && raw === "" ? EMPTY_KEY : raw);
  const current = value === undefined || value === null ? "" : String(value);
  const selected = list.find((option) => option.value === current);
  return (
    <BoarduiSelect
      {...rest}
      className={extraClasses(className)}
      style={style}
      isDisabled={disabled === true}
      aria-label={
        (typeof rest["aria-label"] === "string" && rest["aria-label"]) ||
        (typeof rest.title === "string" && rest.title) ||
        selected?.label ||
        "下拉选择"
      }
      selectedKey={toKey(current)}
      onSelectionChange={(key: any) => {
        if (typeof onChange !== "function") return;
        onChange({ target: { value: key === EMPTY_KEY ? "" : String(key) } });
      }}
    >
      {list.map((option) => (
        <BoarduiSelectItem key={option.value} id={toKey(option.value)} textValue={option.label}>
          {option.label}
        </BoarduiSelectItem>
      ))}
    </BoarduiSelect>
  );
}

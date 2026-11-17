/* Small form/display adapters: prefer the host-provided shadcn component,
   fall back to the plain DOM element when the host did not hand one over.
   They only need `h` and `kit`, so they are created by a factory instead of
   importing the panel runtime. */

// 表单控件换成 BoardUI 的源码实现（TextField + InputBase / TextareaBase / Checkbox）。
// 适配层负责把 legacy 的 value / onChange(e) 语义翻译成 react-aria 的 value / onChange(string)。
import { Input as BoarduiInput, Textarea as BoarduiTextarea, Checkbox as BoarduiCheckbox, Select as BoarduiSelect } from '../boardui/index'

export function createFields({ h, kit, React }) {
    function TextField(props) {
      return h(BoarduiInput, props)
    }
    function TextAreaField(props) {
      return h(BoarduiTextarea, props)
    }
    function ChipField({ className, variant, ...rest }) {
      const Badge = kit('Badge')
      if (Badge === null) return h('span', { className, ...rest })
      const into = String(className ?? '')
      const next = variant ?? (into.indexOf('ds-chip-blocked') >= 0 || into.indexOf('ds-chip-bug') >= 0 || rest['data-blocked'] === '1' || rest['data-danger'] === '1'
        ? 'destructive'
        : into.indexOf('ds-chip-code') >= 0 || rest['data-svc-missing'] === '1'
          ? 'outline'
          : 'secondary')
      return h(Badge, { ...rest, variant: next, className })
    }
    /* 布尔开关。legacy 写法是 h(CheckField, { checked, onChange(e) })， */
    /* BoardUI 的 Checkbox 用 isSelected + onChange(boolean)，适配层已翻译。 */
    function CheckField(props) {
      return h(BoarduiCheckbox, props)
    }
    function optionListOf(children) {
    const out = []
    React.Children.forEach(children, child => {
      if (!React.isValidElement(child)) return
      if (child.type === 'option') {
        out.push({ value: String(child.props.value ?? ''), label: String(React.Children.toArray(child.props.children).join('')) })
      } else if (child.type === 'optgroup') {
        optionListOf(child.props.children).forEach(item => out.push(item))
      }
    })
    return out
  }
  /* 下拉：调用点写的是原生 <option> 子节点，这里先拍平成 {value,label}，
     再交给 BoardUI 的 Select（react-aria 的 Select 要 id + textValue）。
     空字符串选项的哨兵映射在适配层里做。 */
  function SelectField({ className, children, value, onChange, disabled, ...rest }) {
      const options = optionListOf(children)
      return h(BoarduiSelect, { ...rest, className, options, value, onChange, disabled })
    }

  return { TextField, TextAreaField, ChipField, CheckField, SelectField }
}

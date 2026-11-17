/* Small form/display adapters: prefer the host-provided shadcn component,
   fall back to the plain DOM element when the host did not hand one over.
   They only need `h` and `kit`, so they are created by a factory instead of
   importing the panel runtime. */

// 表单控件换成 BoardUI 的源码实现（TextField + InputBase / TextareaBase / Checkbox）。
// 适配层负责把 legacy 的 value / onChange(e) 语义翻译成 react-aria 的 value / onChange(string)。
import { Input as BoarduiInput, Textarea as BoarduiTextarea, Checkbox as BoarduiCheckbox, Select as BoarduiSelect, Chip as BoarduiChip, SwitchField as BoarduiSwitchField, DateField as BoarduiDateField, SearchInput as BoarduiSearchInput } from '../boardui/index'

export function createFields({ h, kit, React }) {
    function TextField(props) {
      return h(BoarduiInput, props)
    }
    function TextAreaField(props) {
      return h(BoarduiTextarea, props)
    }
    /* 状态标签。legacy 写法 h(ChipField, { className: 'ds-chip ds-chip-blocked' }, 文本)，
       语义（阻塞 / 缺陷 / 代码 / 普通）由适配层翻成 BoardUI Chip 的颜色。 */
    function ChipField({ className, variant, ...rest }) {
      return h(BoarduiChip, { className, variant, ...rest })
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

  /* 开关：启用/停用这类即时生效的布尔状态，用官方 Switch（不是勾选框） */
  function SwitchToggle(props) {
    return h(BoarduiSwitchField, props)
  }

  /* 日期：官方 DatePicker（字符串 'YYYY-MM-DD' 进出） */
  function DateField(props) {
    return h(BoarduiDateField, props)
  }

  /* 搜索框：官方 SearchField（放大镜 + 清除键 + role=searchbox），
     看板工具栏那一个输入框用它，其余文本输入仍是 Input。 */
  function SearchField(props) {
    return h(BoarduiSearchInput, props)
  }

  return { TextField, TextAreaField, ChipField, CheckField, SelectField, SwitchToggle, DateField, SearchField }
}

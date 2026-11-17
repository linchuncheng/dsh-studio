import tailwindcss from '@tailwindcss/postcss'
import scopeToStudio from './scripts/scope-css.mjs'

// Tailwind v4 走官方 postcss 插件；autoprefixer 不再需要（v4 内部已经按 browserslist 加前缀）。
// scopeToStudio 必须留在最后：它把每条选择器改写成 [data-dsh-studio] 前缀，注入宿主页面时不污染宿主 UI。
export default {
  plugins: [tailwindcss(), scopeToStudio()],
}

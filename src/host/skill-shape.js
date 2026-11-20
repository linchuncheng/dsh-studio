// 技能的数据形状：名字规则、清洗、SKILL.md 的读写。
//
// 原来这七个函数在 index.js 里，谁也用不上（除了 index.js 自己和 skills 路由）。
// 抽出来的原因：① 加了 `projects` 之后要能单测「存进去 → 写成 SKILL.md → 读回来」不丢字段；
// ② skill-mine.js 要把草稿写成同一个形状，形状只能有一份。
import { createHash } from 'node:crypto'

/** The skill-name grammar the DSH registry validates against (kebab-case). */
export function isSkillName(value) {
  const name = String(value ?? '')
  return name.length > 0 && name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

/** kebab-case slug from arbitrary text; non-ASCII text falls back to a hash. */
export function slugifySkill(value) {
  const ascii = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (ascii.length >= 2) return ascii
  return `skill-${createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 6)}`
}

/** 项目范围：空 = 全局技能，任何项目都能用；非空 = 只在这些项目里注入。 */
function skillProjects(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,，\s]+/)
  const out = []
  for (const item of list.slice(0, 12)) {
    const id = String(item ?? '').trim().slice(0, 60)
    if (id.length === 0 || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/** Coerce whatever the caller sent into a storable skill row. */
export function sanitizeSkill(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const name = String(raw.name ?? '').trim().toLowerCase()
  if (!isSkillName(name)) return undefined
  const content = String(raw.content ?? '')
  const description = (String(raw.description ?? '').trim() || content.trim().split('\n')[0] || name).slice(0, 300)
  const tags = (Array.isArray(raw.tags) ? raw.tags : String(raw.tags ?? '').split(/[,，\s]+/))
    .map(tag => String(tag ?? '').trim().slice(0, 30))
    .filter(tag => tag.length > 0)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 8)
  return {
    name,
    description,
    whenToUse: String(raw.whenToUse ?? '').trim().slice(0, 400),
    content: content.slice(0, 60_000),
    tags,
    /** 只在卡的项目命中这些 id 时注入；空数组 = 全局。 */
    projects: skillProjects(raw.projects),
    enabled: raw.enabled !== false,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0 ? raw.updatedAt : new Date().toISOString(),
  }
}

/** Coerce a saved library file into skill rows. */
export function sanitizeSkills(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input.slice(0, 200)) {
    const skill = sanitizeSkill(raw)
    if (skill === undefined || seen.has(skill.name)) continue
    seen.add(skill.name)
    out.push(skill)
  }
  return out
}

/** The SKILL.md text (YAML frontmatter + body) for one library row. */
export function skillMarkdown(skill) {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description.replace(/\n/g, ' ')}`]
  if (skill.whenToUse.length > 0) lines.push(`whenToUse: ${skill.whenToUse.replace(/\n/g, ' ')}`)
  if (skill.tags.length > 0) lines.push(`tags: ${skill.tags.join(', ')}`)
  if ((skill.projects ?? []).length > 0) lines.push(`projects: ${skill.projects.join(', ')}`)
  lines.push('---', '', skill.content.trim(), '')
  return lines.join('\n')
}

/** Split `---` frontmatter into `{fields, body}`; no frontmatter → all body. */
export function splitFrontmatter(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (match === null) return { fields: {}, body: text }
  const fields = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1)
    }
    if (key.length > 0) fields[key] = value
  }
  return { fields, body: match[2] }
}

/**
 * Turn an uploaded `SKILL.md` into a library row.
 *
 * Precedence for the name: frontmatter `name` → filename → heading → hash, so
 * a skill exported by another tool keeps its identity on the way in.
 */
export function skillFromMarkdown(fileName, source) {
  const { fields, body } = splitFrontmatter(source)
  const base = String(fileName ?? '').split('/').pop().replace(/\.(md|markdown|txt)$/i, '')
  const declared = String(fields.name ?? '').trim().toLowerCase()
  const name = isSkillName(declared) ? declared : slugifySkill(declared || base)
  const heading = (body.match(/^#\s+(.+)$/m) ?? [])[1] ?? ''
  const description = String(fields.description ?? '').trim() || heading.trim() || name
  return {
    name,
    description,
    whenToUse: String(fields.whenToUse ?? fields.when_to_use ?? '').trim(),
    content: body.trim(),
    tags: String(fields.tags ?? '').replace(/[[\]]/g, '').split(/[,，\s]+/).filter(Boolean),
    projects: skillProjects(String(fields.projects ?? '')),
    enabled: true,
  }
}

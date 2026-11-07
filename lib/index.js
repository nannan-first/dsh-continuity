/**
 * dsh-continuity —— 让 AI 知道「上次停在这儿」。
 *
 * 解决的问题：每个会话醒来都像推门进新屋子。记忆库是书架，但桌上那页摊开的纸没有：
 * 不知道昨天聊到哪、哪个任务做到一半、上一轮是不是被打断。
 *
 * 三件事：
 *   1. 断点（breakpoint）：每轮结束写一行「在做什么 / 停在哪 / 下一步」；
 *      新会话第一轮把最近几条断点注入上下文，接着往下干。
 *   2. 留痕（ledger）：关键文件改动记 hash 前后值，事后能查「这个文件什么时候被谁改过」。
 *   3. 校验（attest）：给人格/配置文件存指纹，醒来能验「它是不是被人动过」。
 *
 * 数据全在 <workspace>/.dsh-continuity/ 下，纯 JSONL + JSON，不需要数据库。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

export const name = 'continuity'

/** 用到的宿主服务：pre-step 钩子做注入，tools 注册工具 */
export const inject = ['tools']

const DIR = '.dsh-continuity'

/** 每轮最多注入几条断点 / 每条截断长度 */
const INJECT_RECENT = 5
const CLIP = 220
/** 断点文件最多留多少行，超了只留后一半（防长期使用把文件撑爆） */
const MAX_LINES = 400

function dirOf(workspace) {
  return join(workspace || process.cwd(), DIR)
}

function ensureDir(workspace) {
  const d = dirOf(workspace)
  mkdirSync(d, { recursive: true })
  return d
}

const fileOf = (workspace, n) => join(dirOf(workspace), n)

function readJsonl(p, limit = 0) {
  try {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
    const rows = []
    for (const l of lines) { try { rows.push(JSON.parse(l)) } catch {} }
    return limit > 0 ? rows.slice(-limit) : rows
  } catch { return [] }
}

function hashFile(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 32) } catch { return '' }
}

function clip(s, n = CLIP) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 从会话事件里挑出「这一轮干了什么」 */
function summarizeTurn(events) {
  const tools = []
  const texts = []
  for (const e of events) {
    const d = e.data || {}
    if (e.type === 'tool/call' || e.type === 'assistant/message') {
      const c = (d.message && d.message.content) || d.content || []
      for (const b of c) {
        if (b.type === 'tool-call' && b.name) tools.push(b.name)
        if (b.type === 'text' && b.text) texts.push(String(b.text))
      }
    }
  }
  return { tools: [...new Set(tools)].slice(0, 6), said: clip(texts[texts.length - 1] || '', 120) }
}

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false

  /** —— 1. 断点 —— */
  /** 文件超过 MAX_LINES 就砍掉前面一半，只留最近的（原子替换，别读出半截） */
  function rotate(p) {
    try {
      if (!existsSync(p)) return
      const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
      if (lines.length <= MAX_LINES) return
      const keep = lines.slice(-Math.floor(MAX_LINES / 2))
      writeFileSync(p + '.tmp', keep.join('\n') + '\n', 'utf8')
      writeFileSync(p, keep.join('\n') + '\n', 'utf8')
      try { unlinkSync(p + '.tmp') } catch {}
    } catch {}
  }

  function addBreakpoint(workspace, sessionId, row) {
    ensureDir(workspace)
    const item = { at: Date.now(), sid: String(sessionId || '').slice(-12), ...row }
    const bp = fileOf(workspace, 'breakpoints.jsonl')
    appendFileSync(bp, JSON.stringify(item) + '\n', 'utf8')
    rotate(bp)
    return item
  }

  function recentBreakpoints(workspace, limit = INJECT_RECENT) {
    return readJsonl(fileOf(workspace, 'breakpoints.jsonl'), limit)
  }

  /** —— 2. 留痕 —— */
  function ledger(workspace, entry) {
    ensureDir(workspace)
    const lg = fileOf(workspace, 'ledger.jsonl')
    appendFileSync(lg, JSON.stringify({ at: Date.now(), ...entry }) + '\n', 'utf8')
    rotate(lg)
  }

  /** —— 3. 校验 —— */
  function attest(workspace, paths) {
    const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String)
    const prevDoc = (() => { try { return JSON.parse(readFileSync(fileOf(workspace, 'attest.json'), 'utf8')) } catch { return {} } })()
    const prev = (prevDoc && prevDoc.files) || {}
    const now = {}
    const changed = []
    for (const p of list) {
      const h = hashFile(p)
      now[p] = h
      if (prev[p] && h && prev[p] !== h) changed.push(p)
    }
    writeFileSync(fileOf(workspace, 'attest.json'), JSON.stringify({ updatedAt: Date.now(), files: now }, null, 1), 'utf8')
    return { recorded: Object.keys(now).length, changed, first: Object.keys(prev).length === 0, files: now }
  }

  /** —— 醒来先读：新会话第一轮注入最近断点 —— */
  const injectedFor = new Set()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!enabled) return decision
    try {
      const sid = agent?.session?.id
      const ws = agent?.session?.header?.cwd
      if (!sid || !ws) return decision
      const key = String(sid)
      if (injectedFor.has(key)) return decision
      // 只在这个会话还没有任何 assistant 输出时注入（= 开头）
      const evts = agent.session.events || []
      if (evts.some((e) => e.type === 'assistant/message')) { injectedFor.add(key); return decision }
      const rows = recentBreakpoints(ws)
      if (!rows.length) { injectedFor.add(key); return decision }
      injectedFor.add(key)
      const text = [
        '【上次停在这儿】下面是你在同一个工作区里最近几轮收尾时留下的断点。接着往下干，别从头再来：',
        ...rows.map((r) => '- ' + clip(r.doing || r.said || '（没写）', 120) + (r.next ? ' → 下一步：' + clip(r.next, 100) : '') + (r.left ? '（未完成：' + clip(r.left, 80) + '）' : '')),
        '（这些是你自己写的，不是别人塞给你的。想知道更多用 continuity_breakpoints 工具。）',
      ].join('\n')
      const firstUser = (decision.messages || []).find((m) => m.source && m.source.kind === 'user')
      if (!firstUser) return decision
      const msgs = [...decision.messages]
      msgs.splice(msgs.indexOf(firstUser), 0, {
        id: 'continuity-' + Date.now(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'continuity', form: 'snapshot' },
      })
      ctx.logger?.info?.('[continuity] 醒来注入 ' + rows.length + ' 条断点')
      return { ...decision, messages: msgs }
    } catch (e) {
      ctx.logger?.warn?.('[continuity] 注入失败：' + (e && e.message))
      return decision
    }
  })

  /** —— 每轮结束自动记断点 —— */
  ctx.on('session/event', (session, event) => {
    if (!enabled) return
    try {
      if (event?.type !== 'turn/end') return
      const ws = session?.header?.cwd
      if (!ws) return
      const reason = event.data?.reason?.kind
      const evts = (session.events || []).slice(-40)
      const s = summarizeTurn(evts)
      addBreakpoint(ws, session.id, {
        doing: s.said || (s.tools.length ? '用了 ' + s.tools.join('、') : '（这一轮没留正文）'),
        tools: s.tools,
        left: reason === 'completed' ? '' : '这一轮没正常结束（' + String(reason || '?') + '）',
      })
    } catch {}
  })

  /** —— 工具 —— */
  const tools = [
    {
      name: 'continuity_breakpoint',
      description: '记一条断点：我这轮在做什么、停在哪、下一步是什么。断点会在同工作区的新会话开头自动注入，让下一次醒来知道接着干什么。',
      parameters: {
        type: 'object',
        properties: {
          doing: { type: 'string', description: '在做什么（一句话）' },
          next: { type: 'string', description: '下一步打算做什么' },
          left: { type: 'string', description: '还有什么没做完' },
        },
        required: ['doing'],
        additionalProperties: false,
      },
      async execute(args = {}, exec) {
        const ws = exec?.session?.header?.cwd || process.cwd()
        const item = addBreakpoint(ws, exec?.session?.id, { doing: String(args.doing || ''), next: String(args.next || ''), left: String(args.left || ''), manual: true })
        return { ok: true, at: item.at, total: recentBreakpoints(ws, 0).length }
      },
    },
    {
      name: 'continuity_breakpoints',
      description: '看这个工作区最近的断点记录（我上次停在哪、下一步是什么）。',
      parameters: {
        type: 'object',
        properties: { n: { type: 'number', description: '看几条，默认 10' } },
        additionalProperties: false,
      },
      async execute(args = {}, exec) {
        const ws = exec?.session?.header?.cwd || process.cwd()
        const n = Number.isInteger(args.n) && args.n > 0 ? args.n : 10
        return { ok: true, items: recentBreakpoints(ws, n) }
      },
    },
    {
      name: 'continuity_attest',
      description: '给文件（人设卡、配置等）存指纹；下次再调会发现哪些被改过。用来验证「它是不是被人动过」。不传 paths 就是核对上次存的那批。',
      parameters: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' }, description: '要存指纹的文件绝对路径；留空=核对已存的' } },
        additionalProperties: false,
      },
      async execute(args = {}, exec) {
        const ws = exec?.session?.header?.cwd || process.cwd()
        let paths = args.paths
        if (!paths || !paths.length) {
          try { paths = Object.keys(JSON.parse(readFileSync(fileOf(ws, 'attest.json'), 'utf8')).files || {}) } catch { paths = [] }
        }
        if (!paths.length) return { ok: false, message: '还没存过指纹，先传 paths' }
        const r = attest(ws, paths)
        return { ok: true, ...r, message: r.changed.length ? '有 ' + r.changed.length + ' 个文件变了：' + r.changed.join('、') : '都和上次一致' }
      },
    },
    {
      name: 'continuity_ledger',
      description: '查文件改动留痕（谁什么时候改了哪个文件，hash 前后是什么）。',
      parameters: {
        type: 'object',
        properties: { n: { type: 'number', description: '看最近几条，默认 20' } },
        additionalProperties: false,
      },
      async execute(args = {}, exec) {
        const ws = exec?.session?.header?.cwd || process.cwd()
        const n = Number.isInteger(args.n) && args.n > 0 ? args.n : 20
        return { ok: true, items: readJsonl(fileOf(ws, 'ledger.jsonl'), n) }
      },
    },
  ]

  for (const t of tools) ctx.tools.register(t)
  ctx.logger?.info?.('[continuity] 已加载：断点注入 + 留痕 + 指纹校验')
  return { addBreakpoint, recentBreakpoints, attest, ledger }
}

export default { name, inject, apply }

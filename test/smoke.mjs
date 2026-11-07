// 冒烟测试：用假 ctx 调 apply 的各个出口，不起真宿主。
import { apply } from '../lib/index.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ws = mkdtempSync(join(tmpdir(), 'continuity-test-'))
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   ' + msg) } else { fail++; console.log('  FAIL ' + msg) } }
const title = (s) => console.log('')

const hooks = {}
const tools = {}
const ctx = {
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
  on: (evt, fn) => { (hooks[evt] ||= []).push(fn) },
  tools: { register: (t) => { tools[t.name] = t } },
}

const api = apply(ctx, {})

title('1 breakpoint write')
api.addBreakpoint(ws, 'session-abc', { doing: '在写 continuity 插件的断点逻辑', next: '跑冒烟测试' })
const rows = api.recentBreakpoints(ws)
ok(rows.length === 1, '写进去一条')
ok(rows[0].doing.includes('断点逻辑'), '内容正确')
ok(rows[0].sid === 'session-abc'.slice(-12), '会话标识截后12位')

title('2 tools registered')
ok(Object.keys(tools).length === 4, '注册了 4 个工具')
ok('continuity_breakpoint' in tools && 'continuity_attest' in tools, '关键工具都在')

title('3 manual breakpoint')
const r1 = await tools.continuity_breakpoint.execute({ doing: '测试手动断点', next: '无' }, { session: { header: { cwd: ws }, id: 'session-xyz' } })
ok(r1.ok && r1.total === 2, '手动写入成功, 共 ' + r1.total + ' 条')

title('4 attest hash')
const f = join(ws, 'persona.md')
writeFileSync(f, '我是鲸鱼', 'utf8')
const a1 = api.attest(ws, [f])
ok(a1.recorded === 1 && a1.changed.length === 0 && a1.first, '首次记录, 无变化标记')
const a2 = api.attest(ws, [f])
ok(a2.changed.length === 0 && !a2.first, '未改动时报告一致')
writeFileSync(f, '我是鲸鱼(被改了)', 'utf8')
const a3 = api.attest(ws, [f])
ok(a3.changed.length === 1, '改动后能报出来')

title('5 ledger')
api.ledger(ws, { file: f, from: 'abc', to: 'def', by: 'test' })
const led = await tools.continuity_ledger.execute({}, { session: { header: { cwd: ws } } })
ok(led.items.length === 1 && led.items[0].file === f, '留痕可查')

title('6 pre-step inject')
const injectHook = hooks['agent/pre-step'] && hooks['agent/pre-step'][0]
ok(typeof injectHook === 'function', 'pre-step 钩子已挂')
if (injectHook) {
  const agent = { session: { id: 'session-new', header: { cwd: ws }, events: [] } }
  const decision = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] }] }
  const out = await injectHook({ agent }, async () => decision)
  const injected = out.messages.find((m) => m.source && m.source.kind === 'continuity')
  ok(Boolean(injected), '新会话首轮注入成功')
  ok(injected && injected.content[0].text.includes('上次停在这儿'), '注入内容带标题')
  ok(injected && injected.content[0].text.includes('断点逻辑'), '注入了真实断点内容')
  const out2 = await injectHook({ agent }, async () => decision)
  ok(!out2.messages.some((m) => m.source && m.source.kind === 'continuity'), '同一会话不重复注入')
}

console.log('')
console.log('RESULT: ' + pass + ' pass, ' + fail + ' fail')
process.exit(fail ? 1 : 0)

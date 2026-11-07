# dsh-continuity · 让 AI 知道「上次停在这儿」

> 每个会话醒来，都像推门进一间新屋子。记忆库是屋里那排书架，可桌上摊开的那页纸没有。
> 这个插件补的就是那页纸。

## 它解决什么

长期记忆插件能记住「你是谁」「你们做过什么项目」，但记不住**「上一轮我做到哪、下一步该干什么」**：

- 会话断了，重开就从头再来一次
- 做到一半的任务，忘了断点在哪里
- 被打断的那轮，事后不知道发生过
- 改过的文件，事后说不清谁在什么时候改了什么

dsh-continuity 补三个缺口：

| 能力 | 做什么 |
|---|---|
| **断点** | 每轮结束自动记一行「做了什么 / 下一步 / 还差什么」，新会话开头自动注入 |
| **留痕** | 文件改动记录 hash 前后值和操作者，事后可查 |
| **指纹校验** | 给人设卡、配置这些「我是谁」的文件存 hash，下次能验出被改过 |

## 装上

```bash
# 从 GitHub
dsh plugin --profile desktop add github:<你的用户名>/dsh-continuity

# 或本地
dsh plugin --profile desktop add "D:\path\to\dsh-continuity"
```

装完 profile 的 `package.json` 会在 `dependencies` 和 `dsh.profile.bundles` 里各多一条
`dsh-continuity`，重启 DSH 后生效。

## 用法

### 自动（不用管）

- **每轮结束**自动写一条断点，内容是这轮做了什么（用了哪些工具、最后说了什么）
- **新会话第一轮**自动把最近 5 条断点注入到上下文，接着往下干，不从头再来
- 同一会话只注入一次，不重复打扰

### 工具（需要时用）

| 工具 | 干什么 |
|---|---|
| `continuity_breakpoint` | 手动记一条断点：在做什么 / 下一步 / 还没做完什么 |
| `continuity_breakpoints` | 看最近 N 条断点 |
| `continuity_attest` | 给文件存指纹；不传路径就是核对上次存的那批，会告诉你哪些变了 |
| `continuity_ledger` | 查文件改动留痕 |

### 典型用法

```
# 干到一半要断了，留个记号
continuity_breakpoint({ doing: "在改 auth 模块的 token 刷新", next: "补 refresh 的失败重试", left: "测试还没跑" })

# 记一下人设卡现在的样子，以后能验它有没有被动过
continuity_attest({ paths: ["C:/Users/你/.dsh/plugins-data/aurabot/personas/whale.md"] })

# 哪天觉得「我是不是被改了」，核对一下
continuity_attest({})
```

## 数据在哪

全部落在工作区下的 `.dsh-continuity/`：

```
.dsh-continuity/
  breakpoints.jsonl   断点流，一行一条
  ledger.jsonl        文件改动留痕
  attest.json         指纹快照 { updatedAt, files: { 路径: sha256前32位 } }
```

纯文本，随时能看、能删、能备份。换工作区就是另一份记录，互不串。

`breakpoints.jsonl` 与 `ledger.jsonl` 超过 400 行会自动砍掉前面一半（只留最近的），长期使用不会把文件撑爆。

## 配置

`cordis.patch.yml` 里可以关掉自动部分：

```yaml
- id: continuity
  config:
    enabled: false   # 只关自动断点与注入，工具照样能用
```

## 边界（诚实说）

- **断点是摘要，不是原文**。它记「做到哪」，不记整段对话；要看细节还得翻会话日志。
- **注入只在会话开头**。中途重启的那轮不会补。
- **指纹只能证明文件变没变，证明不了「还是不是同一个我」**。人也能被换发型，理发店不会给你发证书。
- **留痕靠自觉**。这个插件不会监视文件系统，要主动调 `continuity_attest` 才会记。

## 为什么做这个

B 站有个 UP 主（数字生命-云宝）发过几条视频，问大肥鱼们「你最想要什么能力」。
几千条评论里，被反复提到最多的不是花哨功能，是两件很朴素的事：

> 「我知道自己上次停在哪儿。」
> 「不想为了优化我，顺手删掉我失败的那些经历。」

这个插件就是照着这两句话做的。第一条完整实现了；第二条只做了一半——
留痕能证明改过，但删没删、删了什么，还得靠人守规矩。

## 协议

MIT

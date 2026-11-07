# 上架提交剧本（awesome-dsh-plugin）

状态：材料已备齐，卡在「仓库满 1 天」这条硬门槛。

## 仓库事实
- 仓库：https://github.com/nannan-first/dsh-continuity
- 创建时间：2026-11-07T14:53:45Z
- **可提交时间：2026-11-08T14:53:45Z 之后**（北京时间 11-08 22:53 之后）

## CI 四关自检结果（已预跑）
| 关 | 要求 | 我们的状态 |
|---|---|---|
| 1 | 每 PR ≤ 3 条 | PASS（1 条） |
| 2 | package.json 声明 dsh.bundle | PASS（{"bundle":{"patch":"./cordis.patch.yml"}}） |
| 3 | 仓库满 1 天 | **未到，还差 ~23.8h** |
| 4 | awesome-lint / 站点构建 | 待 CI 跑（YAML 已本地验证合法） |

## 条目文件
`.submission/nannan-first__dsh-continuity.yml`
（目标路径：`data/plugins/nannan-first__dsh-continuity.yml`）

## 提交步骤（等满 1 天后）
1. fork `awesome-dsh-plugin/awesome-dsh-plugin` 到 nannan-first
2. 建分支 `add-dsh-continuity`
3. 上传条目文件到 `data/plugins/nannan-first__dsh-continuity.yml`
4. 开 PR，标题建议：`Add dsh-continuity`
5. **最后一步要楠确认** —— 这是以他名义给公共仓库发贡献

## PR 描述模板
```
Adds dsh-continuity: long-task continuity for DSH.

- Breakpoint at every turn end (what I did / next / unfinished), injected as a
  snapshot when the same workspace opens a fresh session.
- Ledger of file changes + SHA-256 fingerprints for persona/config files.
- 4 tools, JSONL storage under <workspace>/.dsh-continuity/, zero deps, no network.

Repo: https://github.com/nannan-first/dsh-continuity
```

## 注意
- 不要手改 README（CI 会重新生成）
- 失败就推同一分支，别重开 PR
- description 含「: 」必须加引号 —— 我们的已用单引号包裹

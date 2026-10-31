# 单份资料的修改历史与回退

这里恢复单份资料的旧内容，生成新的当前版本，保留原有历史。它不恢复整个数据库，不建立任何全量备份。标签库、属性模板和图谱布局暂未独立记录历史；不能凭空找回从未保存的版本。

通过 HTTP `commands/{操作名}` 或 MCP `call_operation` 调用。每项操作都只接收一个对象，放在 `args` 数组内；具体类型以软件返回的契约为准。

| 操作 | 输入 | 结果 |
| --- | --- | --- |
| `listHistory` | `{kind,entityId,beforeVersion?}` | 倒序最多 50 个版本、`currentVersion`、`hasMore`。下一页传末条的 `version` 为 `beforeVersion` |
| `getHistory` | `{kind,entityId,version}` | 当前内容与所选历史版本的字段差异 |
| `previewHistoryRestore` | `{kind,entityId,version}` | 实际回退差异、关联影响、说明、有效期 10 分钟的 `token`；不写入资料 |
| `restoreHistory` | `{token}` | 生成新版本，返回资料类型、编号和新版本号 |

`kind` 可用：`item`、`technique`、`place`、`character`、`worldEntry`、`worldCategory`、`relation`、`relationType`、`map`、`timeline`、`chapter`、`outline`、`media`、`mediaCatalog`、`dashboard`、`work`、`world`。普通资料的 `entityId` 是其 `id`；大纲和创作计划使用 `workId`，素材分类与标签使用 `worldId`。

只在用户要求的范围内回退。先读取最新资料和历史，定位正确对象及版本，再调用预览。向用户说明实际将恢复的内容和关联影响；已有明确的回退授权时可继续执行，范围或目标不明确时先澄清。不能把客户端自造快照当作历史版本发送。

预览返回的 `differences` 才是实际结果：人物后来新增的身份、形态保留为停用，新增阶段保留为归档；旧阶段快照可以恢复。关联的标签、图片、分类、属性模板沿用当前库。旧版本如试图移除已有地点或事件、引用失效资料，或违反当前属性范围，软件会拒绝整个回退，不应绕过校验。

使用本次读取的 `generation` 调用预览及恢复（MCP 的全部 `call_operation` 都须携带它）。任何资料在预览后又被修改，或预览超时、被使用、软件重启，都会使旧 token 失效。遇到 `CONFLICT` 重新读取、比较并重新预览；遇到 `RESTORED` 重新核对资料库，不能盲目刷新 token 后覆盖。完成后再读当前资料及历史，确认结果。

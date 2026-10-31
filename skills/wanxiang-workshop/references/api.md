# 本机 API

所有 JSON 响应为 `{ok:true,value:...}` 或 `{ok:false,error:{code,message}}`。HTTP 409 表示版本冲突，401 表示连接令牌失效。默认监听 `127.0.0.1`，用户可在桌面开启 `0.0.0.0` 局域网模式。从连接文件读取实际本机地址，不能假定默认端口一定可用。开启局域网不会改变本机脚本的用法，连接文件的临时令牌仅用于回环访问。

| 读取 | 用途 |
| --- | --- |
| `GET /api/v1/health` | 无敏感信息的名称、API 版本和实例 ID |
| `GET /api/v1/snapshot` | 作品、世界及各模块的完整资料与版本 |
| `GET /api/v1/schema` | 所有内容操作签名及输入类型 |
| `GET /api/v1/info` | 本机访问地址；不返回令牌 |
| `GET /api/v1/revision` | 实例与更新计数，用于判断是否需要重新读取 |

`POST /api/v1/commands/{操作名}` 的正文为 `{"args":[参数1,参数2,...],"generation":"本次编辑所依据的 snapshot.value.generation"}`。例如 `saveWorld` 接收一个 `WorldInput`，`archiveWork` 接收编号、当前版本、布尔归档标记。完整操作以实时 `schema` 为准。恢复之后写入必须携带代次，过期代次返回 `RESTORED`（409），恢复过程中返回 `BUSY`（409）。

## 使用辅助脚本保存

`-ArgumentsFile` 指向 UTF-8 JSON **参数数组**，脚本负责包装 `args`。假设最新读取的世界版本为 7：

```json
[
  {
    "id": "从 snapshot 读取的世界编号",
    "name": "保留当前名称",
    "description": "用户确认后的完整简介",
    "expectedVersion": 7
  }
]
```

```powershell
& '<技能目录>\scripts\invoke-workshop.ps1' -Endpoint command -Operation saveWorld -ArgumentsFile '<工作目录>\arguments.json' -Generation '<本次编辑所依据的 generation>'
```

例子中的编号、版本与内容必须替换为当前实际资料。输出文件可用 `-OutputFile` 保存；不指定时返回 JSON 文本到标准输出。测试时可显式指定 `-DescriptorPath`，不要误用测试连接修改正式资料。

## 图片

`POST /api/v1/assets?worldId={编号}&name={文件名}` 接收原始 PNG/JPEG/WebP 字节，最大 25 MiB，返回 `Asset`。同一世界内重复图片自动去重。上传不会自动替换角色图片，需再保存引用。

```powershell
& '<技能目录>\scripts\invoke-workshop.ps1' -Endpoint upload -WorldId '<实际世界编号>' -ImagePath '<图片绝对路径>' -Generation '<本次编辑所依据的 generation>'
```

用已认证的 `GET /api/v1/assets/{编号}` 可读取原图。本机浏览器自动建立同源会话；其他设备按桌面设置直接进入，或输入桌面生成的临时密码，可选择记住登录 30 天。AI 使用 Bearer 方式，不调用浏览器会话接口。局域网 AI 使用桌面 MCP 配置中的独立密钥，不使用浏览器临时密码或连接文件临时令牌。

直接 HTTP 上传使用 `X-Wanxiang-Generation` 请求头。读取接口不需要 generation。备份接口说明见 [backups.md](backups.md)。

## 常见依赖

- 世界分类、关系类型、属性模板：先读其版本，再保存关联资料。
- 人物身份、形态和阶段：使用人物本体版本；一次成功保存会使之前的人物版本失效。
- 章节：除章节版本外，携带所属作品大纲的 `expectedOutlineVersion`。
- 地图和年表：保存整个输入结构；保留原节点、事件、笔画和它们的编号。
- `snapshot` 中名称供展示，跨资料关联使用稳定编号。不要用同名对象替代已关联对象。

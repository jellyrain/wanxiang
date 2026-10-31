# MCP 连接与调用

桌面「软件设置 → 浏览器与 AI 连接 → 查看 MCP 配置」提供实际 URL 和 Authorization 请求头。服务使用官方 `@modelcontextprotocol/sdk`，传输方式为 Streamable HTTP，端点 `/mcp`。只支持旧 SSE、stdio 或仅支持 OAuth 自动登录的客户端不能直接使用这一入口。保留原有 HTTP + PowerShell 方式作为备选。

密钥由应用独立保存，重启不会更换；更换 MCP 密钥后更新客户端配置，浏览器登录不受影响。无论浏览器选择直接访问还是密码保护，MCP 都需要独立的 Bearer 密钥，不能用临时密码代替。不能把密钥、完整含密钥配置或 connection.json 输出到对话和日志。不要代用户开启局域网或更换密钥来完成普通内容编辑。

| 工具 | 用途 |
| --- | --- |
| `read_library` | 读取快照；结果包含当前 `generation` 与各对象版本 |
| `describe_operations` | 获取操作列表和 TypeScript 输入类型，可用 `operation` 过滤 |
| `call_operation` | 传 `operation`、按契约顺序排列的 `args`、本次快照的 `generation` |
| `import_image` | 传 `worldId`、文件名 `name`、原始 `base64` 和 `generation`；PNG/JPEG/WebP 最大 25 MiB |

先读取快照与操作类型，再构造完整保存输入；不要因为 MCP 接入而省略版本、关联和未修改字段。工具返回 `isError:true` 时读取其中的业务错误码；`CONFLICT`、`RESTORED` 的处理遵守 SKILL.md，不盲目重发。

`call_operation` 同时覆盖内容和备份操作。恢复、删除恢复点、手动建立基准的约束与 [backups.md](backups.md) 一致。设备连接设置、临时密码、登录设备、MCP 密钥和软件退出没有开放给内容工具。

局域网模式监听 `0.0.0.0`，其他设备使用软件显示的实际 IPv4 地址；`0.0.0.0` 本身不是访问地址。HTTP 不加密，仅用于可信局域网。浏览器可选择直接访问，或使用 8 位临时密码登录；临时密码 5 分钟有效、一次使用、10 次输错后失效。

密码模式勾选「记住这台设备」后，登录保留 30 天且跨软件重启有效；不勾选时会话最长 24 小时，软件重启需重新登录。重新生成临时密码不影响已登录设备。「清除登录设备」或切换访问方式会撤销旧登录，MCP 密钥不受影响。关闭局域网停止远程访问，已记住设备仍可在重新开启后、有效期内使用。

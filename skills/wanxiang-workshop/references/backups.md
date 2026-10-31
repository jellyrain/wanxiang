# 资料库备份与恢复

API 使用 `POST /api/v1/commands/{name}`；本机辅助脚本使用 `-Endpoint command -Operation <name> -ArgumentsFile <数组文件>`。MCP 使用 `call_operation`，传 `operation`、下表的 `args` 和当前快照的 `generation`。完整输入类型通过 API 的 `schema` 或 MCP 的 `describe_operations` 查询。

| 操作 | args | 作用 |
| --- | --- | --- |
| getBackupStatus | [] | 当前目录、自动开关、频率、恢复点、依赖与错误 |
| saveBackupSettings | [BackupSettings] | 保存完整设置，未要求修改的设置保持原值 |
| estimateBackup | [] | 手动基准的范围、大小、generation 和 sequence |
| createBackupBaseline | [{generation,sequence}] | 显式手动基准；参数取自刚刚的 estimateBackup |
| runIncrementalBackup | [] | 仅保存变更和新增图片；没有变化则 skipped:true |
| previewBackupRestore | [恢复点编号] | 校验整条链及图片，返回范围、token、有效期 |
| restoreBackup | [预览 token] | 恢复全部作品和世界；token 限一次、十分钟有效 |
| deleteBackupPoint | [恢复点编号] | 仅允许删除没有后续依赖、且非当前链头的恢复点 |

自动备份仅增量，不使用 Git。首次或重新建立全量基准必须来自用户明确的手动建立基准请求；缺少基准时先说明原因，不把普通自动备份请求升级为全量。

恢复以整个资料库为范围，不是当前作品。先预览，说明恢复时间、范围及其他窗口草稿需要保留。已有可用基准时软件会先补存尚未备份的增量，留下旧分支；没有可用基准时不会自动保存当前库的全量副本。用户明确授权的范围与预览一致即可执行；若范围尚未明确，先向用户澄清。不要把预览接口本身当作恢复成功。

预览之后若有新的资料保存，恢复返回 CONFLICT，重新预览并核对变化，不能盲目重试旧 token。恢复成功后重新获取 snapshot，后续编辑使用新的 generation 与版本。BUSY 时等待当前操作完成；文件或链损坏时保留现状，报告错误，不改数据库或手动删链来绕过校验。

备份目录是运行软件的这台 Windows 电脑上的绝对路径。图片由所有恢复点共用，不能通过文件删除来清理空间；使用保留设置或 deleteBackupPoint，软件会保护基准与依赖，并清理不再被任何恢复点引用的图片。

软件关闭时定时备份停止。0.1.2 支持恢复当前结构及已发布旧结构的备份；其他不兼容结构会拒绝恢复。恢复旧格式后需手动新建基准，不能继续在旧链后追加新结构。结构升级后若需新基准，必须手动建立，不自动生成全量或合并旧链。

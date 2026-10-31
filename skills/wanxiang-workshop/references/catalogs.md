# 物品、功法与地点（0.1.2 起）

这三个模块使用独立记录，不保存到 `worldEntries`。从当前实例的 snapshot 与 schema / describe_operations 核对能力；没有下列接口的旧版需要升级，不能绕过 API 写数据库或自行改放世界档案。

| 模块 | 快照数组 / 保存接口 / 归档接口 | 专用字段 |
| --- | --- | --- |
| 物品库 | items / saveItem / archiveItem | kind=item；itemType 为 equipment、prop、material、consumable、other；rarity、effect、usage、cost；holders |
| 功法库 | techniques / saveTechnique / archiveTechnique | kind=technique；school、requirements、effect、cost、levels；practitioners |
| 地点库 | places / savePlace / archivePlace | kind=place；placeType、region、environment、access；characterIds、positions |

共同字段：`worldId`、`name`、`aliases`、`summary`、`body`、`pending`、`source`、`status`、`imageId`、`entryIds`。状态为 `draft` / `pending` / `adopted`。`body` 支持 Markdown；`entryIds` 仅引用影响此资料的世界规则/制度。图片和所有关联必须来自同一世界。

保存接口接收一个完整输入对象，新增 `expectedVersion:0`、不传 id；修改保留 id，传当前 version 为 expectedVersion。用当前记录构建完整输入，保留未修改字段和数组；不提交局部补丁。归档接口参数为 `[id,expectedVersion,archived]`，恢复传 false。已归档资料先恢复再编辑。

## 人物状态与地图关联

- `holders` 每行是 `{id,characterId,quantity,state,notes}`。quantity 为 0–1000000000 的整数；state 为 stored（持有）、equipped（装备中）、spent（已消耗）、lost（已失去）。一件物品中同一人物只保留一行，修改时沿用该行编号。需要清除关联时移除该行再保存，旧版本仍保留。
- `practitioners` 每行是 `{id,characterId,progress,state,notes}`。state 为 learning（修习中）、mastered（已掌握）、paused（暂停）、abandoned（已放弃）。progress 保存实际已知的层级或进度文字，不编造百分比，不自动更新人物能力。
- `positions` 每行是 `{mapId,locationId}`，引用已保存的地图与标记。地点可没有地图；不能把地点库 id 当作 locationId。`characterIds` 记录关联人物。人物页与地图页可直接打开对应资料。
- 已保留的归档关联可以继续维护；新增关联前需要恢复目标。不要为了通过校验擅自恢复用户已归档的资料。

年表和章节当前没有物品、功法、地点库对象的专用引用字段；其地图地点引用仍是 mapId/locationId。不要自造 itemIds、techniqueIds、placeIds，也不要把正文提及报告成结构化关联。

人物页展示当前持有、修习和地点关联，这些不会随人物阶段切换。不要把软件修改历史当作故事时间；事件经过保存到年表，实际叙事保存到章节，是否记录由任务需要决定。

## 删除、历史、转移与备份

三个顶层对象的删除与历史类型分别为 item、technique、place；操作遵循 [deletion.md](deletion.md) 和 [history.md](history.md)。被三库引用的人物、图片、世界条目或地图标记会阻止单独永久删除，归档保留关联。

资料包包含三库、持有/修习记录、地点关联及历史；导入独立副本会重绑所有编号。备份同样覆盖这些内容。它们按世界共享；删除一部作品不会删除三库，删除整个世界则包含三库。

旧库升级只增加空专库，不自行迁移旧条目。用户要求整理旧资料时先核对重复、关联和已采用范围，再说明每项从哪里到哪里；不因新功能出现就自动归档或删除旧设定。

# 物品、功法与地点（0.1.2 起）

这三个模块使用独立记录，不保存到 `worldEntries`。从当前实例的 snapshot 与 schema / describe_operations 核对能力；没有下列接口的旧版需要升级，不能绕过 API 写数据库或自行改放世界档案。

| 模块 | 快照数组 / 保存接口 / 归档接口 | 专用字段 |
| --- | --- | --- |
| 物品库 | items / saveItem / archiveItem | kind=item；categoryId 引用世界资料配置中的物品类别（null 为未分类）；itemType 保留兼容输出，不再是固定枚举；rarity、effect、usage、cost；holders |
| 功法库 | techniques / saveTechnique / archiveTechnique | kind=technique；school、requirements、effect、cost、levels；practitioners |
| 地点库 | places / savePlace / archivePlace | kind=place；placeType、region、environment、access；characterIds、positions |

共同字段：`categoryId`、`worldId`、`name`、`aliases`、`summary`、`body`、`pending`、`source`、`status`、`imageId`、`entryIds`。状态为 `draft` / `pending` / `adopted`。`body` 支持 Markdown；`entryIds` 保存关联的世界条目编号。图片和所有关联必须来自同一世界。

保存接口接收一个完整输入对象，新增 `expectedVersion:0`、不传 id；修改保留 id，传当前 version 为 expectedVersion。用当前记录构建完整输入，保留未修改字段和数组；不提交局部补丁。归档接口参数为 `[id,expectedVersion,archived]`，恢复传 false。已归档资料先恢复再编辑。

## 类别与资料默认项

当前实例提供 `saveLibraryConfig` 时，从 snapshot.libraryConfigs 找到当前 worldId 的配置。groups.character / item / technique / place 分别含 categories（id、name、active，数组顺序即显示顺序）、fields（补充字段及初始内容）、templateId（数值默认模板或 null）。配置保存传完整 groups 和 expectedVersion；切勿用旧配置覆盖未修改项。

- 类别世界内共用。初始 equipment、prop、material、consumable、other 只是初始物品选项，可改名、排序、停用和删除；删空后不会自动补回。
- 新建资料使用所选组的默认数值模板，已有资料不自动切换。界面会带入补充字段默认内容；完整 API 输入中明确传入的 facts / attributes 优先，空数组表示明确留空。
- 三库保存优先传 categoryId；只可选择当前世界、当前资料类型中启用的类别，已保留的停用类别可继续编辑。旧 school / placeType 名称输入仍兼容，但应优先读取配置并传 ID。
- 删除类别必须 previewDeletion({kind:'catalogCategory',parentId:worldId,catalogKind:'item'|'technique'|'place',id,replacementId})，replacementId 为其他启用类别 ID 或 null（清空类别）。核对影响后 deleteContent 确认名称与一次性令牌。转移含已归档资料，保留内容、编号和历史；不能通过 saveLibraryConfig 直接移除已有类别。
- 配置历史使用 history kind=libraryConfig，entityId=worldId；回退前仍须预览。删除类别后恢复旧资料前应核对类别是否存在，不以重新建类或改版本号绕过校验。

## 人物状态与地图关联

关联从使用资料的一方发起：角色页、世界条目页选择物品/功法/地点；已保存的地图标记选择地点。三库编辑页只编辑定义，详情页保留反向查看入口。新建定义时不主动为它挑选角色或地图。

当前实例提供 `saveCatalogLink` 时，用该接口修改一条关联，避免重写整份资料。输入为 `{target,kind,catalogId,expectedVersion,linked,holding?,practice?}`：

- `target` 为 `{kind:'character'|'worldEntry',id,expectedVersion}`，地图标记则为 `{kind:'mapLocation',id:mapId,locationId,expectedVersion:mapVersion}`。
- 外层 `kind` 是 item / technique / place，`catalogId` 和 `expectedVersion` 来自所选资料；`linked:false` 解除当前关联。
- 角色关联物品时传 `holding:{quantity,state,notes}`；关联功法时传 `practice:{progress,state,notes}`。行编号由服务保留或创建。地图标记只能关联 place。
- 来源和资料均须属于同一世界且未归档。保存同时核对来源版本、资料版本及恢复代次；冲突后重新读取并核对用户意图，不替换版本号重发旧草稿。其他关联、资料字段和历史保留，新的历史记录保存在对应三库资料中。
- 先查 schema / describe_operations 确认接口存在。旧接口继续用于完整资料保存；编辑定义时原样保留已有关系数组，不因界面入口调整清空关联。

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

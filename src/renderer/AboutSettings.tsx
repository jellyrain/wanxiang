import React from 'react';
import {BRAND} from '../shared/brand.ts';
import {isDesktop} from './runtime.ts';

const changes=[
  ['独立的物品、功法与地点库','装备和道具可管理人物持有、数量与装备状态；功法可管理修习进度；地点可独立编辑并关联地图标记。人物页与地图页可直接打开关联资料。'],
  ['完整的资料管理','三个资料库同步支持 Markdown、编辑、归档、永久删除、版本历史、导入导出和备份，AI 使用相同保存接口。旧资料原位保留。'],
  ['Markdown 阅读与预览','章节、大纲、人物档案、世界设定等支持标题、列表、表格、引用与代码块。章节编辑可切换 Markdown 预览，原始文本完整保留。'],
  ['永久删除资料','新增统一的“删除资料”入口，覆盖作品、世界、人物、章节、素材等 26 类资料。先预览影响范围，再输入名称确认；仍被引用的资料会提示引用位置。'],
  ['AI 操作同步','API 与 MCP 同步支持删除预览和执行。手动与 AI 创建的内容使用相同规则，配套操作说明已更新。'],
  ['空书架与关于页','删除最后一部作品后可重新新建，重启保持空书架。软件设置新增“关于”，集中展示版本和软件说明。']
];

export function AboutSettings(){
  return <div className="about-settings">
    <section className="about-identity" aria-label="软件信息">
      <img src={`./brand/${BRAND.iconFile}`} alt=""/>
      <div><span className="about-tagline">{BRAND.tagline}</span><h2>{BRAND.name}</h2><p>本地小说与原创人物资料库</p><div className="about-badges"><span className="tag gold" aria-label="软件版本">版本 {__APP_VERSION__}</span><span className="tag">{isDesktop?'Windows 桌面端':'浏览器端'}</span></div></div>
    </section>
    <section className="about-section"><h3>软件说明</h3><p>围绕作品与世界，整理人物档案、关系图谱、世界设定、地图、年表、章节和素材，让创作资料彼此关联，随故事一起成长。</p><div className="about-principles"><div><h4>资料保存在本机</h4><p>桌面、浏览器与 AI 连接共用当前资料库，修改后同步查看。</p></div><div><h4>作品独立，世界共用</h4><p>每部作品有自己的章节、大纲和计划，同一世界的作品共用人物与设定。</p></div><div><h4>保留创作的过程</h4><p>通过归档、修改历史、导入导出和备份管理不同阶段的资料。</p></div></div></section>
    <section className="about-section"><header><h3>本次更新</h3><span>0.1.2 · 2026-10-31</span></header><ul className="about-changes">{changes.map(([title,description])=><li key={title}><h4>{title}</h4><p>{description}</p></li>)}</ul></section>
    <p className="about-footnote">Markdown 图片以链接展示，HTML 按原文显示。删除前请核对预览；归档内容可恢复，永久删除需依靠已有备份找回。</p>
  </div>;
}

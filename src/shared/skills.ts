export const SKILL_PACKAGES = {
  api:{name:'API Skill',fileName:'wanxiang-workshop-api.zip',description:'供本机 AI 使用'},
  mcp:{name:'MCP Skill',fileName:'wanxiang-workshop-mcp.zip',description:'供已连接 MCP 的 AI 使用'}
} as const;
export type SkillKind=keyof typeof SKILL_PACKAGES;

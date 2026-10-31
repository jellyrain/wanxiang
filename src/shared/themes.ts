export const THEMES = [
  { id:'ink', name:'墨金', description:'深色图鉴 · 暖金点缀', background:'#111619', foreground:'#a2aaa9', accent:'#d7ba80' },
  { id:'paper', name:'月白', description:'暖白纸面 · 沉静阅读', background:'#f4f1ea', foreground:'#615d56', accent:'#866431' },
  { id:'ocean', name:'深海', description:'午夜蓝调 · 清透青色', background:'#0e1926', foreground:'#a6bacb', accent:'#86cbd4' },
  { id:'plum', name:'暮紫', description:'柔和暗紫 · 玫瑰银色', background:'#1a1520', foreground:'#b8aabb', accent:'#d6aecb' },
  { id:'sakura', name:'樱粉', description:'樱花与奶油', background:'#fff3f6', foreground:'#75515f', accent:'#a43e69' },
  { id:'mint', name:'薄荷', description:'清透夏日', background:'#edf8f3', foreground:'#4e6b60', accent:'#28745d' },
  { id:'lilac', name:'浅紫', description:'柔雾花园', background:'#f4f0fc', foreground:'#665777', accent:'#7650a1' },
  { id:'sunset', name:'暮橙', description:'落日放映室', background:'#241916', foreground:'#c9afa0', accent:'#edb083' },
  { id:'neon', name:'霓虹', description:'粉紫夜航', background:'#151324', foreground:'#b9b0d0', accent:'#ef9dd7' },
  { id:'starry', name:'星夜', description:'蓝紫星光', background:'#12182b', foreground:'#afb9d9', accent:'#b0b7ff' }
] as const;
export type ThemeId = typeof THEMES[number]['id'];
export function isTheme(value: unknown): value is ThemeId { return THEMES.some(theme => theme.id === value); }

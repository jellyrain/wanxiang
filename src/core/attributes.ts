import type { AttributeTemplate, CharacterAttributes } from '../shared/types.ts';

export const emptyAttributes = ():CharacterAttributes => ({templateId:null,values:{},versions:{}});
export function attributesForRead(stored:CharacterAttributes, templates:AttributeTemplate[]):CharacterAttributes {
  const ids = new Set([...Object.keys(stored.values),...(stored.templateId ? [stored.templateId] : [])]);
  return {...stored,versions:Object.fromEntries(templates.filter(t=>ids.has(t.id)).map(t=>[t.id,t.version]))};
}

/** Keep banks from previously selected templates; only explicit null clears a value. */
export function validateAttributes(raw:unknown, previous:CharacterAttributes, templates:AttributeTemplate[], reject:(message:string)=>never):CharacterAttributes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reject('属性格式不正确。');
  const input = raw as CharacterAttributes;
  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values) || !input.versions || typeof input.versions !== 'object' || Array.isArray(input.versions)) return reject('属性数值格式不正确。');
  if (input.templateId !== null && !templates.some(t=>t.id===input.templateId)) return reject('请选择当前世界的属性模板。');
  const values:CharacterAttributes['values'] = structuredClone(previous.values);
  const ids = new Set([...Object.keys(input.values),...(input.templateId ? [input.templateId] : [])]);
  for (const id of ids) {
    const template = templates.find(t=>t.id===id);
    if (!template) return reject('属性引用了不存在或其他世界的模板。');
    if (input.versions[id] !== template.version) return reject('属性模板已有修改，请重新打开资料后填写。');
    const bank = input.values[id] ?? {};
    if (!bank || typeof bank !== 'object' || Array.isArray(bank)) return reject('属性数值格式不正确。');
    const next = {...(values[id] ?? {})};
    for (const [dimensionId,value] of Object.entries(bank)) {
      const dimension = template.dimensions.find(d=>d.id===dimensionId);
      if (!dimension) return reject('属性中包含未配置的维度。');
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return reject(`“${dimension.name}”应填写数值，或留空。`);
      const old = previous.values[id]?.[dimensionId] ?? null;
      if (!dimension.enabled && value !== old) return reject(`“${dimension.name}”已停用，请恢复维度后再修改。`);
      // A narrower range must not silently overwrite old values or block unrelated edits.
      if (value !== null && (value < dimension.min || value > dimension.max) && value !== old) return reject(`“${dimension.name}”应在 ${dimension.min} 至 ${dimension.max} 之间。`);
      next[dimensionId] = value;
    }
    values[id] = next;
  }
  return attributesForRead({templateId:input.templateId,values,versions:{}},templates);
}

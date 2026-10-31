import type { TimelineInput, WorldTimeline, TimelineEvent } from './types.ts';

export const eventStatuses={draft:'草稿',pending:'待定',confirmed:'已确认'} as const;
export function timelineInput(timeline:WorldTimeline):TimelineInput {
  const {id,worldId,name,description,eras,events,version}=timeline;
  return structuredClone({id,worldId,name,description,eras,events,expectedVersion:version});
}
export function orderedEvents(timeline:Pick<WorldTimeline,'eras'|'events'>):TimelineEvent[] {
  return timeline.eras.flatMap(era=>timeline.events.filter(event=>event.eraId===era.id));
}
export function moveTimelineEvent(events:TimelineEvent[],id:string,offset:-1|1,includeArchived=false):TimelineEvent[] {
  const index=events.findIndex(e=>e.id===id);if(index<0)return events;
  const siblings=events.map((e,i)=>({e,i})).filter(({e})=>e.eraId===events[index].eraId&&(includeArchived||!e.archived));
  const sibling=siblings.findIndex(({i})=>i===index),target=siblings[sibling+offset];
  if(sibling<0||!target)return events;const result=[...events];[result[index],result[target.i]]=[result[target.i],result[index]];return result;
}
export function eventPeriod(event:TimelineEvent):string {
  return event.endPeriod?`${event.period||'起始未定'} — ${event.endPeriod}`:event.period||'时间待定';
}

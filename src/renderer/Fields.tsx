import React from 'react';
import { Select, Checkbox } from 'radix-ui';
import { Icon } from './Icon.tsx';

export function Input({ className='', ...props }:React.ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`ui-input ${className}`}/>;
}

export function Textarea({ className='', ...props }:React.ComponentPropsWithRef<'textarea'>) {
  return <textarea {...props} className={`ui-textarea ${className}`}/>;
}

type Choice={ value:string; label:React.ReactNode; disabled?:boolean };
function readOptions(children:React.ReactNode):Choice[] {
  return React.Children.toArray(children).flatMap(child=>{
    if(!React.isValidElement<{value?:string; children?:React.ReactNode; disabled?:boolean}>(child))return [];
    if(child.type===React.Fragment)return readOptions(child.props.children);
    if(child.type!=='option')return [];
    return [{value:String(child.props.value??''),label:child.props.children,disabled:child.props.disabled}];
  });
}

type SelectFieldProps={
  value:string; onValueChange:(value:string)=>void; children:React.ReactNode;
  disabled?:boolean; required?:boolean; name?:string; id?:string; className?:string;
  'aria-label'?:string; 'aria-describedby'?:string;
};
export function SelectField({value,onValueChange,children,disabled,required,name,className='',...triggerProps}:SelectFieldProps) {
  const options=readOptions(children),empty=options.find(option=>option.value==='');
  // Keep the underlying form value empty for required-field validation. Radix items
  // need non-empty IDs, so the explicit reset choice has its own internal value.
  return <Select.Root value={value?`item:${value}`:''} onValueChange={next=>onValueChange(next==='empty'?'':next.slice(5))} disabled={disabled} required={required} name={name}>
    <Select.Trigger {...triggerProps} className={`ui-select-trigger ${className}`} aria-required={required}>
      <Select.Value placeholder={empty?.label??'请选择'}/><Select.Icon><Icon name="down"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="ui-select-content" position="popper" sideOffset={5} collisionPadding={12}>
      <Select.ScrollUpButton className="ui-select-scroll"><Icon name="down"/></Select.ScrollUpButton>
      <Select.Viewport className="ui-select-viewport">{options.map(option=><Select.Item key={option.value} className="ui-select-item" value={option.value?`item:${option.value}`:'empty'} disabled={option.disabled}>
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Icon name="check"/></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className="ui-select-scroll"><Icon name="down"/></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

type CheckFieldProps=Omit<React.ComponentPropsWithoutRef<typeof Checkbox.Root>,'checked'|'onCheckedChange'> & {
  checked?:boolean; onCheckedChange:(checked:boolean)=>void;
};
export function CheckField({checked=false,onCheckedChange,className='',...props}:CheckFieldProps) {
  return <Checkbox.Root {...props} checked={checked} onCheckedChange={value=>onCheckedChange(value===true)} className={`ui-check ${className}`}>
    <Checkbox.Indicator><Icon name="check"/></Checkbox.Indicator>
  </Checkbox.Root>;
}

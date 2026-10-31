import {crc32,deflateRawSync} from 'node:zlib';

/** Small deterministic UTF-8 ZIPs (no ZIP64); used only for bundled text skills. */
export function zipFiles(files){
  const local=[],central=[],names=new Set();let offset=0;
  if(files.length>65535)throw Error('Too many ZIP entries');
  for(const {name,bytes} of files){
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||names.has(name))throw Error('Invalid ZIP entry');
    names.add(name);
    const filename=Buffer.from(name),content=Buffer.from(bytes),compressed=deflateRawSync(content),crc=crc32(content);
    if(filename.length>65535||content.length>0xffffffff||offset>0xffffffff)throw Error('ZIP too large');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);
    header.writeUInt16LE(0x5c21,12); // 2026-01-01, stable across host timezones.
    header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,compressed);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);header.copy(record,6,4,30);record.writeUInt32LE(offset,42);
    central.push(record,filename);offset+=header.length+filename.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

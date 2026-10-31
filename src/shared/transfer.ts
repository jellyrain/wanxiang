export interface TransferExportInput { format:'package'|'markdown'|'text'; scope:'library'|'world'|'work'; id?:string; includeArchived?:boolean }
export interface TransferFile { name:string; content:string }
export interface TransferImportInput extends TransferFile { workId?:string; split?:'headings'|'single' }
export interface TransferPreview {
  token:string; expiresAt:string; kind:'package'|'chapters'; name:string;
  worlds:string[]; works:string[]; characters:number; entries:number; items:number; techniques:number; places:number; images:number; chapters:number; histories:number;
  chapterPreviews:{name:string;characters:number;excerpt:string}[]; warnings:string[];
}
export interface TransferResult { workIds:string[]; worldIds:string[]; chapterIds:string[] }
export const TRANSFER_LIMIT=64*1024*1024;

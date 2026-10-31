export interface WindowActions {
  close():void;
  hide():void;
}
interface Options {
  getWindow:()=>WindowActions|null;
  canHide:()=>boolean;
  closeToTray:()=>boolean;
  showWindow:()=>void;
  stopWork:()=>Promise<void>;
  resumeWork:()=>void;
  finishQuit:()=>void|Promise<void>;
  changed:()=>void;
  failed:(error:unknown)=>void;
}

/** Window hiding never unloads the renderer. Only a completed close begins shutdown. */
export class DesktopLifecycle {
  phase:'running'|'checking'|'stopping'|'ready'='running';
  private readonly options:Options;
  constructor(options:Options){this.options=options;}
  show(){if(this.phase==='running')this.options.showWindow();}
  hide():boolean {
    if(this.phase!=='running'||!this.options.canHide())return false;
    this.options.getWindow()?.hide();this.options.changed();return true;
  }
  onClose(event:{preventDefault():void}) {
    if(this.phase==='running'&&this.options.closeToTray()&&this.options.canHide()){
      event.preventDefault();this.hide();return;
    }
    if(this.phase==='running'){this.phase='checking';this.options.changed();}
  }
  requestQuit(){
    if(this.phase!=='running')return;
    this.phase='checking';this.options.changed();
    const window=this.options.getWindow();
    if(window)window.close();else void this.windowClosed();
  }
  cancelQuit(){
    if(this.phase!=='checking')return;
    this.phase='running';this.options.changed();this.options.showWindow();
  }
  async windowClosed(){
    if(this.phase==='stopping'||this.phase==='ready')return;
    this.phase='stopping';this.options.changed();
    try{
      await this.options.stopWork();
      this.phase='ready';this.options.changed();await this.options.finishQuit();
    }catch(error){
      this.phase='running';this.options.resumeWork();this.options.changed();
      this.options.showWindow();this.options.failed(error);
    }
  }
}

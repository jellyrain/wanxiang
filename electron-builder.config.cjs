const path = require('node:path');
const config = {
  // Preserve the installed application's identity across the project rename.
  appId: 'local.oc-studio',
  productName: '万象工坊',
  artifactName: 'WanxiangWorkshop-${version}-win-${arch}-Setup.${ext}',
  directories: { output: 'release/windows', buildResources: 'build-resources' },
  electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
  asar: false,
  npmRebuild: false,
  afterPack: async context => {if(context.electronPlatformName==='win32')(await import('./scripts/package-layout.mjs')).afterPack(context);},
  files: [
    'dist-desktop/**/*',
    'dist-ui/index.html',
    'dist-ui/assets/**/*',
    'dist-ui/brand/app-icon-v1.png',
    'public/brand/app-icon-v1.png',
    'resources/api-contract.json',
    'resources/release-config.json',
    'resources/skills/*.zip',
    'resources/updater/*.ps1',
    'package.json',
    '!resources/seed/**/*',
    '!.local-data/**/*',
    '!test-results/**/*'
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build-resources/app.ico' },
  mac: {
    target: ['dmg','zip'],
    artifactName: 'WanxiangWorkshop-${version}-mac-${arch}.${ext}',
    icon: 'public/brand/app-icon-v1.png',
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    entitlements: 'installer/entitlements.mac.plist',
    entitlementsInherit: 'installer/entitlements.mac.plist'
  },
  linux: {
    target: ['AppImage'],
    artifactName: 'WanxiangWorkshop-${version}-linux-${arch}.${ext}',
    executableName: 'wanxiang',
    icon: 'public/brand/app-icon-v1.png',
    category: 'Office',
    synopsis: 'Local novel and character library'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '万象工坊',
    uninstallDisplayName: '万象工坊',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    installerLanguages: ['zh_CN', 'en_US'],
    include: 'installer/installer.nsh'
  },
  // A placeholder generates latest.yml without enabling network checks in the app.
  publish: [{ provider: 'generic', url: process.env.WANXIANG_UPDATE_URL || 'https://updates.invalid/wanxiang/' }]
};
// electron-builder 27 groups file and native-module options; 26 uses root keys.
let major=26;
try{major=Number(require('electron-builder/package.json').version.split('.')[0]);}catch{}
if(major>=27){config.fileOptions={files:config.files};delete config.files;config.nativeModules={npmRebuild:false};delete config.npmRebuild;}
module.exports=config;

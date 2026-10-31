# 万象工坊

本地小说与原创人物资料库，支持作品、人物、物品、功法、地点、世界设定、地图、年表、章节、Markdown 阅读、素材、历史和备份。桌面端可提供本机网页及 HTTP / MCP 连接。

## 三端发布

| 系统 | 架构 | 包格式 |
| --- | --- | --- |
| Windows | x64 | NSIS 安装包、免安装 ZIP |
| macOS | Intel x64、Apple Silicon arm64 | DMG、更新用 ZIP |
| Linux | x64 | AppImage |

三端构建和发布配置已加入；Mac、Linux 成品及原生运行结果以 GitHub Actions 实际完成的构建为准。

Windows 资料仍在程序旁的 `data`。Mac 资料在 `~/Library/Application Support/wanxiang`，Linux 在 `$XDG_CONFIG_HOME/wanxiang`（通常为 `~/.config/wanxiang`）。设置中的“打开资料目录”显示实际路径；存在旧 `oc-studio` 用户目录时继续沿用。

## 开发与打包

使用 Node.js 24 和 package.json 指定的 pnpm 版本，在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm test
pnpm build
pnpm dev
```

在对应系统执行 `pnpm package:windows`、`pnpm package:mac` 或 `pnpm package:linux`，随后执行 `node scripts/verify-platform-package.mjs` 检查包内原生数据库和资源。Mac / Linux 包在各自系统构建。Linux 使用桌面环境；AppImage 需要系统支持 FUSE，并赋予文件执行权限。Linux 登录启动可通过桌面环境的启动应用设置，软件内暂不提供开关。

GitHub 仓库创建、测试包、正式签名、公证、发布草稿、更新地址和免安装升级步骤，见 [GitHub 三端发布指南](docs/GitHub三端发布指南.md)。

HTTP / MCP 服务在三端使用相同协议。随软件提供的 API Skill 的 PowerShell 辅助脚本目前面向 Windows；Mac / Linux 可按软件设置中的 MCP 信息连接。

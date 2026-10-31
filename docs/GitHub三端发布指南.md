# GitHub 三端发布指南

本次准备版本：0.1.4。Windows 保留安装包和文件夹免安装版；Mac 分 Intel、Apple 芯片；Linux 提供 x64 AppImage。

## 1. 创建仓库和上传源码

在 GitHub 新建一个空仓库，例如 `wanxiang-workshop`。不要预先生成 README，以免与本地文件冲突。**仓库根目录应对应本机 `wanxiang` 文件夹，不要上传上一级创作资料目录。**

当前自动发布流程按“源码与 Release 在同一个公共仓库”配置。公共仓库会公开源码；如果不想公开源码，可用私有仓库先完成测试构建，再另建公共仓库存放成品，并调整发布目标和更新地址。私有仓库 Release 无法供当前无凭据更新器直接下载。

在项目目录执行下列命令；把 `你的账号` 替换为实际账号：

```sh
git init -b main
git add .
git status --short
git commit -m "Prepare Wanxiang Workshop desktop releases"
git remote add origin https://github.com/你的账号/wanxiang-workshop.git
git push -u origin main
```

提交前查看 `git status`，确认是程序源码。`.gitignore` 已排除程序成品、依赖、真实 data、SQLite、备份目录、资料导出包、连接文件、环境变量、签名私钥和本地示例资料。不要使用 `git add -f` 上传这些内容。

## 2. 先运行不签名的测试构建

推送 main 或在 Actions → Desktop builds → Run workflow 运行。默认不要求 Apple 证书。

四个任务分别使用 Windows x64、macOS Intel、macOS arm64 和 Linux x64 原生运行器。每个任务执行测试、编译、打包，并用包内 Electron 验证 SQLite 读写、重新打开资料和资源完整性。

成功后在该次 Actions 页面底部下载四组 Artifacts。Mac 测试包使用临时签名，未经 Apple 公证；可能被 Gatekeeper 阻止，不能作为正常分发版本或用于应用内自动更新。测试不应全局关闭系统安全设置。

本机 Windows 无法替代 Mac、Linux 原生验收。正式发布前仍应在三种系统实际打开界面，检查保存、导入图片、重启、备份恢复、托盘、中文路径和更新。CI 当前的包检查覆盖原生数据库与资源，不等于三端界面或真实升级已验收。

## 3. Mac 正式签名和公证

在仓库 Settings → Secrets and variables → Actions 配置以下 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application 证书（含私钥）的 `.p12` 文件 Base64 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | 用于公证的 Apple 开发者账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的应用专用密码 |
| `APPLE_TEAM_ID` | Apple 开发者 Team ID |

证书与密码仅放 GitHub Secrets。构建时映射为 electron-builder 的 `CSC_LINK`、`CSC_KEY_PASSWORD`，两种 Mac 架构共用同一发布身份。可手动勾选 `signed_mac` 验证签名和公证；失败会停止任务。

Windows 签名可另外设置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`；未配置时生成未签名安装包，Windows 可能显示未知发布者。

Mac 自动更新要求签名；官方说明见 [electron-builder v26 Auto Update](https://www.electron.build/v26/docs/features/auto-update/)。公证由 electron-builder 调用 Apple 服务，流程在产出后再次检查签名和公证票据。

## 4. 生成正式发布草稿

确认 package.json 的版本号是本次要发布的版本。以当前 0.1.4 为例：

```sh
git tag v0.1.4
git push origin v0.1.4
```

标签必须与 package.json 一致。标签构建要求 Mac 正式证书和公证配置；没有证书可继续使用上一步的测试构建，不要把测试 Mac 包当成已签名正式包。

全部任务成功后，流程会合并两种 Mac 更新清单，逐一核对文件名、版本、大小和 SHA-512，生成 SHA256SUMS.txt，创建 **Draft Release**。不会自动公开发布，也不会直接影响现有用户。

发布草稿应包含以下七个程序文件和更新文件：

| 程序文件 | 用途 |
| --- | --- |
| `WanxiangWorkshop-0.1.4-win-x64-Setup.exe` | Windows 安装版 |
| `WanxiangWorkshop-0.1.4-win-x64-Portable.zip` | Windows 免安装版 |
| `WanxiangWorkshop-0.1.4-mac-x64.dmg` | Intel Mac 安装 |
| `WanxiangWorkshop-0.1.4-mac-x64.zip` | Intel Mac 自动更新 |
| `WanxiangWorkshop-0.1.4-mac-arm64.dmg` | Apple 芯片 Mac 安装 |
| `WanxiangWorkshop-0.1.4-mac-arm64.zip` | Apple 芯片 Mac 自动更新 |
| `WanxiangWorkshop-0.1.4-linux-x64.AppImage` | Linux 运行和更新 |

同一 Release 还需保留 `latest.yml`、`latest-portable.json`、`latest-mac.yml`、`latest-linux.yml`、生成的 `.blockmap` 和 `SHA256SUMS.txt`。不要分别覆盖两份 `latest-mac.yml`；合并脚本已将两个架构的下载条目放入一份清单。

完成原生验收后，在 Releases 编辑草稿、写更新说明、发布为正式版并设为 Latest。若草稿已存在，工作流不会覆盖它，重跑前先处理旧草稿。正式发布后修正程序请增加版本号，不替换相同版本的二进制。

## 5. 更新地址与已有免安装版

三端共用一个目录地址：

```text
https://github.com/你的账号/wanxiang-workshop/releases/latest/download/
```

GitHub 构建时会自动写入本仓库地址。新用户首次打开可直接检查更新；“启动时自动检查”默认关闭。已有用户保存过的地址或关闭设置不会被覆盖，需要在软件设置中手动保存一次地址。

旧 Windows 免安装版首次手动升级：退出软件及托盘 → 备份旧 `data` → 解压新 ZIP → 将内部 `WanxiangWorkshop` 文件夹里的程序文件覆盖到原程序目录 → 保留原 `data` → 启动检查。不要把新文件夹嵌套在旧目录中，否则会打开一份空资料库。

Mac 把应用放入 Applications，资料独立存于用户目录；Linux 把 AppImage 放在用户可写的固定目录、赋予执行权限后启动。AppImage 应从原文件启动才能执行软件内更新，解压后的程序需手动更新。Linux 有些桌面环境不提供托盘，届时关闭窗口会正常退出。

这些资料目录是本地存储；GitHub 发布只更新程序，不会同步作品。迁移电脑使用软件备份或资料导出功能。

官方参考：[GitHub 发布管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[Latest 下载链接](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)、[运行器和架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

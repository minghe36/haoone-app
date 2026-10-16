# HaoOne DaVinci Resolve 插件

基于复制的 HaoCut Workflow Integration 插件改造。开发插件标识为 `com.haoai.haoone_dev`，发布包标识为 `com.haoai.haoone`。插件无独立窗口，在 Resolve 工作区 → 流程整合中打开，后台连接 HaoOne。

## 使用

1. 打开达芬奇项目和时间线，从“工作区 → 流程整合 → haoone_dev”启动插件。
2. 插件连接已有 HaoOne 时会显示并聚焦 HaoOne；未连接时启动系统安装的 HaoOne，然后自动重连。
3. 在支持此插件的新版 HaoOne 左侧点击“导入达芬奇音频”。合成后的音频保存在当前 HaoOne 项目的 media 目录，保留达芬奇项目/时间线身份以及源片段数据，并自动加载到字幕编辑区。
4. 用现有本地或远程转录流程生成字幕。点击“发送字幕到达芬奇”，插件新建字幕轨道，导入当前编辑语言的 SRT，确认新增字幕后返回数量。

HaoOne 必须包含新增的 socket 服务端；仅更新插件不能使旧版安装的 HaoOne 支持通信。macOS 根据真实的 `com.haoone` bundle ID 查找应用。Windows 从安装注册表读取 InstallLocation，无固定安装目录。开发时可通过环境变量 `HAOONE_APP_PATH` 指定真实可执行文件。

5. 配置当前素材的字幕动画后，点击“发送字幕动画到达芬奇”。每种已配置语言创建一个新视频轨道，插入原生 OGraf 动画，起点和时长与整条音频一致。

## 通信协议

默认连接 `ws://127.0.0.1:9800`，避免与 HaoCut 的 9797 端口冲突。两端都可用 `HAOONE_RESOLVE_PORT` 配置端口。插件就绪消息：

```json
{"event":"ready","app":"HaoOne Resolve Plugin","version":"1.0.1","protocol":1}
```

命令：`{ id: string, method, params }`；结果：`{ id, method, ok, result | error }`。

- `get_timeline_audio`：返回 projectId/projectName、timelineId/timelineName、精确 frameRate、startFrame/endFrame、audioTracks 和 timelineData。可传 excludedTrackIndices 排除轨道。只读取启用的音频轨道和片段，不重复读取视频的链接音频。
- `import_subtitles`：参数为绝对 SRT filePath、projectId、timelineId。校验当前项目与时间线，随后创建并填入新的字幕轨道。复用 HaoCut 的 Resolve 20/21 SRT 原点准备和实际字幕枚举验证，不传导致宿主崩溃的视频 trim 字段。

- `import_ograf_subtitles`：参数为 projectId、timelineId、duration（音频秒数）和 animations（language/directory 列表）。要求 Resolve 21+。严格同步最新字幕与样式后生成同目录时间戳 manifest 副本，并写入 v_bmd.duration；插入请求不传 source trim 字段。读回目标轨道的名称、位置与时长才能确认成功。Windows 使用来自参考 Lua 的源轨道选择器，支持 V1–V8，选择失败即停止插入。

音频合成基于本地源文件与裁切入点，保留相对时间线位置、重叠和前后空隙；不是 Resolve Fairlight 的最终混音导出，不包含总线效果、轨道/片段音量自动化和复杂声道映射。嵌套、多机位或变速片段请先渲染音频再导入，缺失素材会明确报错。默认整条时间线，不使用 Mark In/Out。

## 开发与验证

```sh
pnpm test
pnpm build:macos
pnpm build:windows
```

运行时只有 Node 内置模块和平台对应的 WorkflowIntegration.node，没有第三方运行时依赖。ZIP 包位于 dist，包含新标识和正确平台原生模块。第三方原生模块需按下文说明自行准备。

宿主测试请使用独立验证项目，覆盖音频片段裁切、不同帧率、启用/禁用轨道、时间线切换、字幕轨道追加与重新打开插件。源码测试与 ZIP 成功不等同于所有宿主/媒体的验收。

2026-10-14 macOS / Resolve 21.1 宿主验证：通过新版 HaoOne 按钮经 socket 插入原生 highlight_bg 动画到 V2，24 fps 下片段为 86400–86544（6 秒）。暂时关闭 SRT 轨道后，检视器在 01:00:01:12 实际显示 OGraf 字幕。Windows 尚未宿主实测。

## 全项目时间线同步

插件就绪后发送 `{event:"sync_timelines",syncId,catalog:{projectId,projectName,timelines:[{timelineId,timelineName}]}}`。syncId 每次插件启动生成，重连重复通知由 HaoOne 去重。HaoOne 暂存未消费的通知，界面就绪后自动同步所有时间线。

`get_project_timelines` 返回当前项目及全部时间线目录；`get_timeline_audio` 可指定 projectId/timelineId。Workflow Integration 的轨道启用状态读取依赖当前 sequence scene，因此同步时临时激活目标时间线，读取完成后恢复原时间线；用户主动切换时停止读取，不覆盖用户选择。

HaoOne 的“同步时间线”按钮每次重新生成全部时间线音频，按项目和时间线 ID 更新已有媒体记录，不因改名或同名混淆。记录写入 `new_from: "dav"`，保留已有字幕/动画配置与媒体 ID；替换音频路径并清除旧预处理音频缓存。正时长无声时间线生成等长静音音频，零时长空时间线报告错误。

macOS / Resolve 21.1 已验证启动自动同步两条时间线和手动重复同步：记录总数为 2，两条音频重新生成，ID 不变，已有字幕保留，原时间线恢复。


## 本地构建与安装

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build:all
```

仓库不包含上传发布脚本、云存储配置、凭据、构建产物和第三方 SDK 二进制。
构建前，请从你已安装的 DaVinci Resolve Workflow Integration SDK 获取对应平台的 `WorkflowIntegration.node`，分别放入：

- `native/macos-universal/WorkflowIntegration.node`
- `native/windows-x64/WorkflowIntegration.node`

只构建一个平台时，只需准备该平台模块并执行 `pnpm build:macos` 或 `pnpm build:windows`。
SDK 二进制的使用与分发须遵循 Blackmagic Design 的相应许可。
本地构建输出位于 `dist/`，不纳入版本管理。安装包根目录为 `com.haoai.haoone`，
解压后放入本机 Resolve 的 Workflow Integration Plugins 目录，在“工作区 → 流程整合 → haoone”中打开。
正式包与 `com.haoai.haoone_dev` 分开安装。

## 1.0.1

- 独立使用 9800 连接端口，修复与 HaoOgraf 冲突。
- 同步时返回当前时间线标识，支持 HaoOne 自动选中对应文件。
- 新增播放头位置同步及达芬奇原生 WAV 音频渲染。
- 修复字幕修改的起始位置；生成其他语言字幕时隔离新轨道，避免混入已有字幕。
- 字幕轨道以日期时间命名，去掉“同步”前缀。

## 1.0.2（Windows，2026-10-15）

- 修复 NSIS 注册表 InstallLocation 带引号时无法启动 HaoOne；支持空格及中文安装目录。
- Windows OGraf PowerShell 辅助脚本使用 UTF-8 BOM，保留 PowerShell 5.1 下的中文菜单匹配。
- Windows Resolve 宿主已验证原生桥初始化及连接本机 HaoOne（9800）；字幕导入、音频渲染与 OGraf 插入尚未在本次进行端到端宿主验收。
- 单独发布 Windows x64 1.0.2，macOS 继续使用已发布的 1.0.1。

## 1.0.3（Windows）

修复生成字幕动画时因 Windows 拒绝后台激活而出现 Resolve main window is not foreground 的错误：最小化时恢复 Resolve，直接激活失败时临时连接前台输入线程并在 finally 中解除连接。菜单使用 UI Automation，激活被拒绝不再提前终止；实际菜单选择失败仍停止插入。辅助进程超时调整为 25 秒，覆盖菜单等待。新增模拟 Win32 拒绝激活、最小化恢复、异常清理的回归测试。此次桌面截图接口连续超时，尚未验证实际动画插入结果。

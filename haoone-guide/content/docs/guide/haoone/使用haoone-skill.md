---
title: "使用haoone-skill"
---

`haoone-skill` 使用此技能可以在 claude code 、codex、openclaw等 agent中调用 haoone-cli 处理字幕工作流.

github 仓库：[haoone-skill](https://github.com/minghe36/haoone-skill)

安装 skill ：

``` text
npx skills add minghe36/haoone-skill
```

## 使用 haoone-skill 的前置条件

1 安装了 [haoone](https://www.haoai.pro/haoone/download) 软件，并完成登录

2 在软件中下载本地模型

3 点击软件的设置按钮，启动命令行工具

先确认命令可用：

```bash
haoone-cli --help
```

如果失败，再检查：

```bash
which haoone-cli
```

## 提示词举例

下面这些提示词可以直接作为你在 Codex / ChatGPT / 其他支持 skill 的智能体中的输入参考。

### 转录单个文件

- 帮我用将这个视频转录出字幕：`/path/to/demo.mp4`
- 用 `haoone` 把 `/path/to/interview.wav` 转成字幕
- 转录 `/path/to/lesson.mov`，输出 `srt`

### 批量转录

- 批量转录这个目录下的所有音视频文件：`/path/to/media/`
- 帮我扫描 `/path/to/videos/`，把里面的文件全部转成字幕

### 查看环境和模型

- 帮我检查 `haoone-cli` 是否可用
- 列出当前已安装的模型
- 读取 haoone 的配置给我看看

### 热词管理

- 读取当前haoone的热词配置
- 把这些热词批量加入haoone的热词配置：`cursor=科舍, claude=克劳德`
- 帮我添加2个常用大模型热词，格式：热词=最有可能错误的3个同音词

### 文稿整理

- 把这份转录文稿做格式化整理
- 用 `format-draft` 处理这段文稿，让标点和分段更自然
- 对这个字幕草稿做文稿匹配
- 用已有文稿和字幕做 `manuscript-matching`

### 项目管理

- 列出当前所有 haoone 项目
- 创建一个项目，名字叫 `播客第12期`
- 删除项目 `测试项目`
- 读取项目 `播客第12期` 下的 `srt` 文件列表

### 组合型提示词

- 先检查 `haoone-cli` 是否可用，再列出已安装模型
- 帮我创建项目 `2026-05-采访稿`，然后批量转录 `/path/to/interview-files/`
- 转录 `/path/to/talk.mp4`，然后把结果做格式化整理


## 集成 haoone-cli 的功能范围

当前支持以下 `haoone-cli` 子命令：

- `transcribe`：转录单个音频或视频
- `installed-models`：列出所有已安装模型
- `manuscript-matching`：文稿匹配
- `format-draft`：格式化文稿
- `batch-transcribe`：批量转录媒体文件
- `batch-add-hotwords`：批量添加热词
- `get-hotwords`：读取热词配置
- `get-config`：读取软件关键配置信息
- `get-project-list`：读取项目列表
- `get-project-srt-list`：读取指定项目下的 `.srt` 文件路径
- `create-project`：创建项目并切换为当前项目
- `delete-project`：删除项目



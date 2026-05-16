# haoone-app

<div align="center">
  <img src="https://cdn.haoai.pro/assets/haoone_logo.png" alt="VideoCaptioner Logo" width="100">
  <h1>haoone</h1>
  <p>新一代 AI 专业字幕软件，中英转录识别准确率96%，词语音频对齐率98%</p>

  [官网](https://www.haoai.pro/haoone) / [免费下载软件](https://www.haoai.pro/haoone/download)  /  [命令行工具](https://github.com/minghe36/haoone-cli)  /  [skill](https://github.com/minghe36/haoone-skill)  / [english](./README-en.md)
</div>

## haoone 软件介绍

覆盖剪辑字幕与字幕翻译工作流的所有核心需求，可能是市面上功能最全面的字幕软件。

haoone 软件支持基础功能永久免费使用，增强功能一次性买断，无订阅费用。弃用 whisper 方案，基于 qwen3-asr 深入优化，中文高识别准确率，转录引擎基于 rust+c++，转录速度快，自动开启 GPU 加速。自研词语级音频对齐。
中英识别准确率与稳定性、词语级对齐精度吊打市面上所有 whisper 套壳软件。

本地转录、远程转录、文稿匹配、智能拆行、AI校正、AI 智能热词、翻译、双语字幕、专业字幕编辑器、字幕合成、自定义大模型 API...

让工具适配你的工作流：达芬奇字幕插件、PR字幕插件、命令行工具、skill 封装

多文件一键批量化操作

长音视频优化：2 小时的文件都能转录（mac 耗时仅需 10 分钟）

快：本地转录3分钟视频，mac mini m4 16G 20 秒内完成

准：中英转录识别准确率96%以上，带智能热词，越用越准

齐：自研词语级对齐算法，词语音频对齐率98%

windows 与 mac 双平台支持

[下载软件](https://www.haoai.pro/haoone/download)

![介绍图片](https://cdn.haoai.pro/assets/haoone%20%E4%BB%8B%E7%BB%8D.png)

## 软件截图

![软件截图](https://cdn.haoai.pro/assets/h-1.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-2.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-3.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-4.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-5.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-6.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-7.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-8.hao.webp)
![软件截图](https://cdn.haoai.pro/assets/h-9.hao.webp)

达芬奇字幕插件：[视频介绍](https://www.bilibili.com/video/BV1eq6uBnEXj/?vd_source=50c41c1bed77ff65f5947e5b52ba3e85)

PR字幕插件：[视频介绍](https://www.bilibili.com/video/BV1kG9cBrEaz/?vd_source=50c41c1bed77ff65f5947e5b52ba3e85)

## 功能列表

haoone 是专业的字幕软件，功能非常强大，核心功能：

* 本地转录：基于 qwen3-asr 深度优化，支持多语种，自研的词语级对齐算法
* 远程转录：快准齐的远程转录服务
* 模型下载：一键下载，也支持网盘下载
* AI 智能拆行
* AI 热词替换
* AI 校正
* 达芬奇字幕插件
* PR字幕插件
* haoone-cli 命令行工具
* 字幕 skill
* 文稿匹配：不限字数、支持自动格式化文稿，拆行双模式
* 字幕合成
* 双语字幕
* 专业字幕编辑器
* 多视图：快速编辑视图、章节视图
* 双语字幕
* 翻译
* 一键批量操作
* 搜索与批量替换
* ...


## 功能介绍

- [haoone9与剪映对比转录正确率](https://guide.haoai.pro/guide/haoone/haoone9%E4%B8%8E%E5%89%AA%E6%98%A0%E5%AF%B9%E6%AF%94%E8%BD%AC%E5%BD%95%E6%AD%A3%E7%A1%AE%E7%8E%87)
- [付费权益说明](https://guide.haoai.pro/guide/haoone/%E4%BB%98%E8%B4%B9%E6%9D%83%E7%9B%8A%E8%AF%B4%E6%98%8E)
- [1 安装与更新软件](https://guide.haoai.pro/guide/haoone/1%20%E5%AE%89%E8%A3%85%E4%B8%8E%E6%9B%B4%E6%96%B0%E8%BD%AF%E4%BB%B6)
- [2 激活软件与解除设备绑定](https://guide.haoai.pro/guide/haoone/2%20%E6%BF%80%E6%B4%BB%E8%BD%AF%E4%BB%B6%E4%B8%8E%E8%A7%A3%E9%99%A4%E8%AE%BE%E5%A4%87%E7%BB%91%E5%AE%9A)
- [3.1 安装达芬奇插件](https://guide.haoai.pro/guide/haoone/3.1%20%E5%AE%89%E8%A3%85%E8%BE%BE%E8%8A%AC%E5%A5%87%E6%8F%92%E4%BB%B6)
- [3.2 安装与使用 PR 插件](https://guide.haoai.pro/guide/haoone/3.2%20%E5%AE%89%E8%A3%85%E4%B8%8E%E4%BD%BF%E7%94%A8%20PR%20%E6%8F%92%E4%BB%B6)
- [使用haoone-cli命令行工具](https://guide.haoai.pro/guide/haoone/%E4%BD%BF%E7%94%A8haoone-cli%E5%91%BD%E4%BB%A4%E8%A1%8C%E5%B7%A5%E5%85%B7)
- [4 模型下载与管理](https://guide.haoai.pro/guide/haoone/4%20%E6%A8%A1%E5%9E%8B%E4%B8%8B%E8%BD%BD%E4%B8%8E%E7%AE%A1%E7%90%86)
- [5 导入与切换媒体文件](https://guide.haoai.pro/guide/haoone/5%20%E5%AF%BC%E5%85%A5%E4%B8%8E%E5%88%87%E6%8D%A2%E5%AA%92%E4%BD%93%E6%96%87%E4%BB%B6)
- [6 项目管理](https://guide.haoai.pro/guide/haoone/6%20%E9%A1%B9%E7%9B%AE%E7%AE%A1%E7%90%86)
- [7 本地转录](https://guide.haoai.pro/guide/haoone/7%20%E6%9C%AC%E5%9C%B0%E8%BD%AC%E5%BD%95)
- [8 远程转录](https://guide.haoai.pro/guide/haoone/8%20%E8%BF%9C%E7%A8%8B%E8%BD%AC%E5%BD%95)
- [9 快速修改字幕](https://guide.haoai.pro/guide/haoone/9%20%E5%BF%AB%E9%80%9F%E4%BF%AE%E6%94%B9%E5%AD%97%E5%B9%95)
- [10 时间线](https://guide.haoai.pro/guide/haoone/10%20%E6%97%B6%E9%97%B4%E7%BA%BF)
- [11 文稿匹配](https://guide.haoai.pro/guide/haoone/11%20%E6%96%87%E7%A8%BF%E5%8C%B9%E9%85%8D)
- [12 字幕翻译与双语字幕](https://guide.haoai.pro/guide/haoone/12%20%E5%AD%97%E5%B9%95%E7%BF%BB%E8%AF%91%E4%B8%8E%E5%8F%8C%E8%AF%AD%E5%AD%97%E5%B9%95)
- [13 字幕搜索与批量替换](https://guide.haoai.pro/guide/haoone/13%20%E5%AD%97%E5%B9%95%E6%90%9C%E7%B4%A2%E4%B8%8E%E6%89%B9%E9%87%8F%E6%9B%BF%E6%8D%A2)
- [14 导出字幕文件](https://guide.haoai.pro/guide/haoone/14%20%E5%AF%BC%E5%87%BA%E5%AD%97%E5%B9%95%E6%96%87%E4%BB%B6)
- [15 配置大模型 API](https://guide.haoai.pro/guide/haoone/15%20%E9%85%8D%E7%BD%AE%E5%A4%A7%E6%A8%A1%E5%9E%8B%20API)
- [16 合成字幕与批量合成](https://guide.haoai.pro/guide/haoone/16%20%E5%90%88%E6%88%90%E5%AD%97%E5%B9%95%E4%B8%8E%E6%89%B9%E9%87%8F%E5%90%88%E6%88%90)
- [17 批量转录](https://guide.haoai.pro/guide/haoone/17%20%E6%89%B9%E9%87%8F%E8%BD%AC%E5%BD%95)
- [18 AI 热词替换](https://guide.haoai.pro/guide/haoone/18%20AI%20%E7%83%AD%E8%AF%8D%E6%9B%BF%E6%8D%A2)
- [haoone8与剪映对比转录正确率](https://guide.haoai.pro/guide/haoone/haoone8%E4%B8%8E%E5%89%AA%E6%98%A0%E5%AF%B9%E6%AF%94%E8%BD%AC%E5%BD%95%E6%AD%A3%E7%A1%AE%E7%8E%87)

## 感谢以下开源产品

haoone 基于下面的开源产品，特此鸣谢：

* qwen3-asr
* tauri 2

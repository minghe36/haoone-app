import { defineConfig } from 'vitepress';

const haoonePages = [
  'haoone9与剪映对比转录正确率',
  '付费权益说明',
  '模型价格',
  '1 安装与更新软件',
  '2 激活软件与解除设备绑定',
  '3.1 安装达芬奇插件',
  '3.2 安装与使用 PR 插件',
  '使用haoone-cli命令行工具',
  '使用haoone-skill',
  '4 模型下载与管理',
  '5 导入与切换媒体文件',
  '6 项目管理',
  '7 本地转录',
  '8 远程转录',
  '9 快速修改字幕',
  '10 时间线',
  '11 文稿匹配',
  '12 字幕翻译与双语字幕',
  '13 字幕搜索与批量替换',
  '14 导出字幕文件',
  '15 配置大模型 API',
  '16 合成字幕与批量合成',
  '17 批量转录',
  '18 AI 热词替换',
  'haoone8与剪映对比转录正确率',
];

function pageTitle(page: string) {
  return page.replace(/^\d+(?:\.\d+)?\s*/, '');
}

export default defineConfig({
  title: 'haoai',
  description: 'haoone 使用指南',
  lang: 'zh-CN',
  cleanUrls: true,
  themeConfig: {
    logo: 'https://cdn.haoai.pro/assets/haoone_logo.png',
    nav: [
      { text: '首页', link: '/' },
      { text: 'haoone', link: '/guide/haoone/haoone9与剪映对比转录正确率' },
    ],
    sidebar: {
      '/guide/haoone/': [
        {
          text: 'haoone',
          items: haoonePages.map((page) => ({
            text: pageTitle(page),
            link: `/guide/haoone/${page}`,
          })),
        },
      ],
    },
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
    },
    socialLinks: [],
  },
  markdown: {
    config(md) {
      const image = md.renderer.rules.image;

      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const alt = token.content || '';
        const widthMatch = alt.match(/#w(\d+)/);

        if (widthMatch) {
          token.content = alt.replace(/#w\d+/, '').trim();
          token.attrSet('style', `max-width:${widthMatch[1]}px;width:100%;`);
        }

        return image
          ? image(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
    },
  },
});

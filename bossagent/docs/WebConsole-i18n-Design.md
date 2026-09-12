# Web Console i18n Design

## 中文化策略

Web Console 默认语言为中文。本步骤优先中文化：

- 顶部菜单
- 页面标题
- 常用按钮
- 常用状态
- Recruit Flow 页面
- Control Center 核心入口文案

代码变量名保持英文，避免影响现有业务逻辑和测试。

## 新增模块

`i18n.py` 提供：

```python
get_locale(request)
t(key, locale="zh")
```

默认语言：

```text
zh
```

支持语言：

```text
zh
en
```

## 语言切换

支持 query 参数：

```text
?lang=zh
?lang=en
```

当请求中出现合法 `lang` 参数时，Web Console 会写入 cookie：

```text
lakejob_lang
```

后续请求会优先读取 cookie。

## 模板接入

`web_console.py` 将以下函数注册为 Jinja 全局函数：

```python
templates.env.globals["get_locale"] = get_locale
templates.env.globals["t"] = t
```

模板中使用：

```jinja2
{% set locale = get_locale(request) %}
{{ t("nav.dashboard", locale) }}
```

## fallback 规则

1. 如果当前语言存在翻译，返回当前语言。
2. 如果英文缺失但中文存在，fallback 到中文。
3. 如果中文也不存在，返回 key 本身。

## 菜单中文化

当前菜单默认显示：

- 首页
- 岗位池
- 候选人
- 简历中心
- 人才库
- 画像中心
- 招聘助手
- 控制中心
- AI设置
- 日志
- 定时任务
- 系统配置

右上角提供：

```text
中文 | English
```

## 安全边界

i18n 只影响展示层，不会：

- 触发 Boss
- 发送真实消息
- 真实投递
- 修改 schema
- 展示 API Key

## 后续扩展

- 将所有旧页面逐步迁移到 translation key。
- 增加表单错误、日志字段、状态 badge 的完整翻译。
- 如需更多语言，可扩展 `TRANSLATIONS` 或迁移到独立 JSON/YAML 翻译文件。

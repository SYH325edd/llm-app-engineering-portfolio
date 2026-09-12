# Boss Post-Chat Modal Handling

## 问题现象

点击 BOSS 岗位页的“立即沟通”后，页面会弹出一个沟通小窗口。

真实现象是：

- BOSS 已经自动发送了一段默认沟通内容。
- 页面显示“已发送”或订阅/二维码提示。
- 脚本没有识别这个弹窗状态，继续等待聊天窗口或尝试发送第二条消息。
- 用户必须手动关闭弹窗，再点击“继续沟通”，流程才继续。

## 弹窗识别逻辑

新增 `handle_boss_post_chat_modal()`，检测页面中是否出现：

- 已发送
- 已开启消息订阅
- 小程序也能继续回复BOSS信息
- 使用微信扫码
- 请简短描述您的问题
- 发送
- 继续沟通
- 关闭
- ×
- 聊天输入框

## 处理逻辑

- 如果检测到“已发送”，认为 BOSS 默认沟通消息已经真实发出。
- 如果检测到“继续沟通”，优先点击继续沟通。
- 如果检测到订阅二维码或关闭按钮，尝试关闭弹窗。
- 如果检测到输入框，不再重复发送第二条消息，直接按 BOSS 已完成默认沟通处理。
- 如果弹窗无法处理，保存调试文件。

## 为什么不能重复发送

BOSS 在点击“立即沟通”后可能已经自动发出默认首句。

如果脚本继续调用 `send_message()`，会造成同一个岗位连续发送两条消息，增加风控风险，也会污染数据库记录。因此当 `real_message_sent=True` 时，脚本会跳过后续手动发送。

## 返回结构

`open_job_conversation()` 和真实投递路径会透出类似结构：

```json
{
  "opened": true,
  "real_message_sent": true,
  "modal_handled": true,
  "reason": "boss_auto_sent_message_modal"
}
```

Smoke test 日志会记录：

```json
{
  "boss_auto_sent_modal": true,
  "modal_handled": true,
  "real_message_sent": true
}
```

## 调试文件

弹窗处理失败时保存：

```text
runtime/debug_post_chat_modal.html
runtime/debug_post_chat_modal.png
```

## 当前浏览器限制说明

当前项目默认使用 Playwright 托管浏览器。

如果需要使用本机 Edge/Chrome 登录态，需要单独开发：

- `connect_over_cdp`
- 或 persistent user data dir

本步骤不处理本机 Edge/Chrome 接入。

## 后续方案方向

- 为 BOSS 弹窗状态增加更细的结构化分类。
- 将真实发送前后的页面状态快照写入审计日志。
- 如果要使用本机浏览器，新增一个独立浏览器配置层，不混入当前 smoke test 逻辑。

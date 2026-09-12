# Conversation Open Debug

## Goal

Diagnose why Real Message Smoke Test failed with:

```text
failed to open BOSS job conversation
```

The database chain was already verified. This debug change only targets the BOSS page-side conversation-opening path.

## Files Changed

- `lakejobai-job-radar/boss_automation.py`

## Added Debug Output

`open_job_conversation()` now prints:

- Current URL
- Page title
- Job URL
- Candidate communication button count
- Candidate button text, class, and selector
- Text of the button clicked
- New tab switch information, if a click opens a new tab
- Explicit blocking reason for login expiry, captcha, verification, risk control, or frequency limit

## Debug Artifacts

When opening the conversation fails, the current page is saved to:

```text
runtime/debug_conversation.html
runtime/debug_conversation.png
```

These files should be inspected after a failed Real Message Smoke Test to identify the actual BOSS page structure or blocking page.

## Button Compatibility

The conversation opener now scans multiple labels:

- 立即沟通
- 立即联系
- 聊一聊
- 沟通
- 立即咨询
- 继续沟通

It also scans class-based candidates:

- `[class*="chat"]`
- `[class*="communicate"]`
- `[class*="btn"]`

## New Tab Handling

If clicking the communication button opens a new tab, the method switches `self.page` to the new page and brings it to the front.

## Chat Open Verification

After click, the method waits for `networkidle` when possible and treats the conversation as open if:

- URL contains `/chat`
- A chat input is visible
- Page indicates an existing conversation, such as `已沟通` or `继续沟通`

## Next Run

Run:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke --send-real --confirm-send SEND_ONE_REAL_MESSAGE
```

If it still fails, inspect:

```text
runtime/debug_conversation.html
runtime/debug_conversation.png
```

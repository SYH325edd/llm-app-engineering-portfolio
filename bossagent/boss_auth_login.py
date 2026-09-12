from pathlib import Path
import argparse
import shutil
from playwright.sync_api import sync_playwright

RUNTIME_DIR = Path("runtime")
AUTH_STATE_PATH = RUNTIME_DIR / "boss_auth_state.json"
PROFILE_PATH = RUNTIME_DIR / "boss_chromium_profile"
BROWSER_PROFILE_PATH = PROFILE_PATH
BOSS_URL = "https://www.zhipin.com/"


def reset_paths(reset_auth: bool, reset_browser_profile: bool) -> None:
    RUNTIME_DIR.mkdir(exist_ok=True)

    if reset_auth and AUTH_STATE_PATH.exists():
        AUTH_STATE_PATH.unlink()
        print(f"[AUTH] removed {AUTH_STATE_PATH}")

    if reset_browser_profile and BROWSER_PROFILE_PATH.exists():
        shutil.rmtree(BROWSER_PROFILE_PATH)
        print(f"[AUTH] removed {BROWSER_PROFILE_PATH}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual BOSS auth login helper.")
    parser.add_argument("--browser-type", default="chromium", choices=["chromium"])
    parser.add_argument("--reset-auth", action="store_true")
    parser.add_argument("--reset-browser-profile", action="store_true")
    args = parser.parse_args()

    reset_paths(args.reset_auth, args.reset_browser_profile)
    BROWSER_PROFILE_PATH.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        context = None
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(BROWSER_PROFILE_PATH),
                headless=False,
                no_viewport=True,
                locale="zh-CN",
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--start-maximized",
                    "--disable-infobars",
                ],
            )

            page = context.pages[0] if context.pages else context.new_page()

            print("[AUTH] opening BOSS...")
            page.goto(BOSS_URL, wait_until="domcontentloaded", timeout=60000)

            try:
                print("[AUTH] current_url=", page.url)
                print("[AUTH] title=", page.title())
            except Exception as e:
                print("[AUTH] failed to read page status:", repr(e))

            print("[AUTH] 请在打开的 Chromium 浏览器中手动登录 BOSS。")
            print("[AUTH] 如果页面是 about:blank，请直接在地址栏输入：https://www.zhipin.com/")
            print("[AUTH] 登录成功后，不要关闭浏览器，回到终端按 Enter 保存。")

            input("[AUTH] 登录完成后按 Enter 保存 auth state...")

            try:
                context.storage_state(path=str(AUTH_STATE_PATH))
            except Exception as e:
                print("AUTH_SAVE_FAILED")
                print("[AUTH] error=", repr(e))
                return 2

            print("AUTH_SAVED")
            print("[AUTH] saved_to=", AUTH_STATE_PATH)
            return 0

        finally:
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass


if __name__ == "__main__":
    raise SystemExit(main())

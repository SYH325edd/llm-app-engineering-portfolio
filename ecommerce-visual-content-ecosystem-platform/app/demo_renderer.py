from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from .config import ROOT, PROJECTS_DIR


def _font(size: int, bold: bool = False):
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ]
    for p in candidates:
        try:
            if Path(p).exists():
                return ImageFont.truetype(p, size=size)
        except Exception:
            pass
    return ImageFont.load_default()


def _rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size[0]-1, size[1]-1), radius=radius, fill=255)
    return mask


def _cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    ratio = max(w / img.width, h / img.height)
    nw, nh = int(img.width * ratio), int(img.height * ratio)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - w)//2)
    top = max(0, (nh - h)//2)
    return img.crop((left, top, left+w, top+h))


def _fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    ratio = min(w / img.width, h / img.height)
    nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def _pick_source(source_paths: list[Path] | None) -> Image.Image | None:
    for p in source_paths or []:
        try:
            return Image.open(p).convert("RGBA")
        except Exception:
            continue
    return None


def make_demo_card(
    output_path: Path,
    title: str,
    subtitle: str,
    label: str,
    source_paths: list[Path] | None = None,
    size: tuple[int, int] = (1024, 1024),
    variant: int = 0,
):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = size
    palettes = [
        ((245, 247, 255), (216, 226, 255), (54, 82, 213)),
        ((248, 247, 252), (231, 221, 255), (104, 65, 198)),
        ((245, 250, 249), (211, 239, 232), (24, 121, 98)),
        ((252, 248, 245), (244, 225, 210), (168, 88, 42)),
        ((247, 248, 252), (226, 231, 241), (53, 61, 82)),
    ]
    c1, c2, accent = palettes[variant % len(palettes)]
    grad = Image.linear_gradient("L").resize(size)
    layer1 = Image.new("RGB", size, c1)
    layer2 = Image.new("RGB", size, c2)
    bg = Image.composite(layer2, layer1, grad)

    # decorative soft circles
    overlay = Image.new("RGBA", size, (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    for i, radius in enumerate([220, 150, 90]):
        cx = int(w * (0.80 - i * 0.05))
        cy = int(h * (0.16 + i * 0.14))
        od.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=(*accent, 20 + i*10))
    overlay = overlay.filter(ImageFilter.GaussianBlur(24))
    bg = Image.alpha_composite(bg.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(bg)

    product = _pick_source(source_paths)
    if product:
        product = _fit(product, (int(w*0.62), int(h*0.58)))
        shadow = Image.new("RGBA", product.size, (0,0,0,0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle((8, 8, product.width-8, product.height-8), radius=28, fill=(0,0,0,52))
        shadow = shadow.filter(ImageFilter.GaussianBlur(18))
        canvas = Image.new("RGBA", (product.width+80, product.height+80), (0,0,0,0))
        canvas.alpha_composite(shadow, (40, 46))
        pbg = Image.new("RGBA", product.size, (255,255,255,244))
        pbg.putalpha(_rounded_mask(product.size, 34))
        pbg.alpha_composite(product)
        canvas.alpha_composite(pbg, (40, 34))
        x = int(w*0.50 - canvas.width/2)
        y = int(h*0.25)
        bg.alpha_composite(canvas, (x,y))
    else:
        x0, y0, x1, y1 = int(w*.23), int(h*.27), int(w*.77), int(h*.70)
        draw.rounded_rectangle((x0,y0,x1,y1), radius=48, fill=(255,255,255,225), outline=(255,255,255,255), width=2)
        draw.rounded_rectangle((int(w*.38), int(h*.34), int(w*.62), int(h*.62)), radius=42, fill=(*accent, 80))

    title_font = _font(max(28, int(w*.048)), bold=True)
    sub_font = _font(max(20, int(w*.027)), bold=False)
    badge_font = _font(max(16, int(w*.019)), bold=True)
    small_font = _font(max(14, int(w*.016)), bold=False)

    draw.rounded_rectangle((48, 48, 48 + 160, 88), radius=20, fill=(255,255,255,215))
    draw.text((66, 58), "DEMO DATA", font=badge_font, fill=accent)

    y_text = int(h*.76)
    draw.text((64, y_text), title[:28], font=title_font, fill=(25,30,44))
    draw.text((64, y_text + int(w*.066)), subtitle[:52], font=sub_font, fill=(68,75,94))
    draw.text((64, h-72), label, font=small_font, fill=(*accent, 255))
    bg.convert("RGB").save(output_path, quality=94)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    try:
        box = draw.textbbox((0, 0), text, font=font)
        return int(box[2] - box[0])
    except Exception:
        return len(text) * max(8, getattr(font, "size", 16) // 2)


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int, max_lines: int = 2) -> list[str]:
    text = str(text or "").strip()
    if not text:
        return []
    lines: list[str] = []
    current = ""
    for ch in text:
        test = current + ch
        if current and _text_width(draw, test, font) > max_width:
            lines.append(current)
            current = ch
            if len(lines) >= max_lines:
                break
        else:
            current = test
    if current and len(lines) < max_lines:
        lines.append(current)
    if lines and sum(len(x) for x in lines) < len(text):
        lines[-1] = lines[-1][:-1] + "…" if len(lines[-1]) > 1 else "…"
    return lines


def _render_spec_panel(canvas: Image.Image, params: dict, price: str = "") -> dict:
    """Render only user-provided facts; never infer missing parameters."""
    draw = ImageDraw.Draw(canvas)
    x0, y0, x1, y1 = 382, 220, 716, 900
    draw.rounded_rectangle((x0, y0, x1, y1), radius=24, fill=(255, 255, 255), outline=(226, 228, 235), width=2)
    draw.text((x0 + 24, y0 + 24), "规格参数", font=_font(30, True), fill=(28, 31, 40))
    y = y0 + 82
    label_font = _font(18, False)
    value_font = _font(20, True)
    rendered: dict[str, str] = {}
    rows = [(str(k), str(v), False) for k, v in (params or {}).items() if str(k).strip() and str(v).strip()]
    if price:
        rows.append(("价格", str(price), True))
    if not rows:
        draw.text((x0 + 24, y), "暂无已确认规格数据", font=_font(18, False), fill=(120, 124, 138))
        return {"renderedParams": rendered, "priceRendered": False, "empty": True}
    for key, value, is_price in rows[:10]:
        draw.text((x0 + 24, y), key[:10], font=label_font, fill=(104, 108, 122))
        value_lines = _wrap_text(draw, value, value_font, 176, max_lines=2) or [value]
        vy = y
        for line in value_lines:
            draw.text((x0 + 134, vy), line, font=value_font, fill=(30, 33, 42))
            vy += 28
        draw.line((x0 + 24, y + 48, x1 - 24, y + 48), fill=(238, 239, 244), width=1)
        y += 62 if len(value_lines) == 1 else 82
        if not is_price:
            rendered[key] = value
        if y > y1 - 58:
            break
    return {"renderedParams": rendered, "priceRendered": bool(price), "empty": False}



def render_text_overlay(output_path: Path, visual_path: Path, copy_text: str, safe_areas: list[dict] | None = None) -> dict:
    """Render approved short copy into the declared safe area.

    The image model is never asked to draw formal marketplace copy. This
    compositor receives already-approved brief copy and places it only inside
    a safe area. If no safe area/copy exists, it simply copies the visual.
    """
    img = Image.open(visual_path).convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    areas = [a for a in (safe_areas or []) if isinstance(a, dict)]
    text = str(copy_text or "").strip()
    if not text or not areas:
        img.save(output_path, quality=94)
        return {"copyRendered": False, "renderedCopy": "", "safeArea": None}

    # Prefer a formal title/info safe area and avoid guessing layout outside it.
    area = next((a for a in areas if a.get("purpose") in {"title", "spec", "copy", "info"}), areas[0])
    w, h = img.size
    x = int(w * float(area.get("xPct", 5)) / 100)
    y = int(h * float(area.get("yPct", 5)) / 100)
    aw = int(w * float(area.get("widthPct", 40)) / 100)
    ah = int(h * float(area.get("heightPct", 20)) / 100)
    draw = ImageDraw.Draw(img, "RGBA")
    pad = max(16, int(min(w, h) * 0.018))
    radius = max(14, int(min(w, h) * 0.016))
    # Low-texture translucent plate guarantees readable deterministic copy.
    draw.rounded_rectangle((x, y, min(w-1, x+aw), min(h-1, y+ah)), radius=radius, fill=(255,255,255,222))
    font_size = max(24, min(58, int(min(w, h) * 0.046)))
    font = _font(font_size, True)
    lines = _wrap_text(draw, text, font, max(60, aw - pad*2), max_lines=3)
    line_h = int(font_size * 1.28)
    total_h = line_h * len(lines)
    ty = y + max(pad, (ah - total_h)//2)
    for line in lines:
        draw.text((x + pad, ty), line, font=font, fill=(28,31,40,255))
        ty += line_h
    img.save(output_path, quality=94)
    return {"copyRendered": True, "renderedCopy": text, "safeArea": area}

def render_detail_section(
    output_path: Path,
    visual_path: Path,
    title: str,
    subtitle: str,
    index: int,
    *,
    product_params: dict | None = None,
    price: str = "",
    spec_mode: bool = False,
) -> dict:
    """Compose the final detail asset after generation.

    Seedream provides the visual base. Formal Chinese/spec/price data are drawn
    deterministically from project data here. The function returns render
    metadata so Final Asset QC can verify that no parameter was invented.
    """
    visual = Image.open(visual_path).convert("RGB")
    canvas = Image.new("RGB", (750, 980), (249,249,251))
    draw = ImageDraw.Draw(canvas)
    draw.text((42, 34), f"0{index}", font=_font(22, True), fill=(93,78,224))
    draw.text((42, 70), title[:24], font=_font(36, True), fill=(25,27,34))
    sub_lines = _wrap_text(draw, subtitle, _font(20, False), 650, max_lines=2)
    sy = 119
    for line in sub_lines:
        draw.text((42, sy), line, font=_font(20, False), fill=(96,99,112))
        sy += 27

    meta = {"specMode": bool(spec_mode), "renderedParams": {}, "priceRendered": False, "canvas": [750, 980]}
    if spec_mode:
        fitted = _fit(visual.convert("RGBA"), (310, 650)).convert("RGB")
        px = 28 + max(0, (320 - fitted.width)//2)
        py = 220 + max(0, (650 - fitted.height)//2)
        canvas.paste(fitted, (px, py))
        meta.update(_render_spec_panel(canvas, product_params or {}, price))
    else:
        visual = _cover(visual, (750, 820))
        canvas.paste(visual, (0,160))
        # Repaint the text header so the generated visual can never cover formal copy.
        draw = ImageDraw.Draw(canvas)
        draw.rectangle((0, 0, 750, 160), fill=(249,249,251))
        draw.text((42, 34), f"0{index}", font=_font(22, True), fill=(93,78,224))
        draw.text((42, 70), title[:24], font=_font(36, True), fill=(25,27,34))
        sy = 119
        for line in sub_lines:
            draw.text((42, sy), line, font=_font(20, False), fill=(96,99,112))
            sy += 27

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, quality=94)
    return meta


def stitch_vertical(section_paths: Iterable[Path], output_path: Path):
    images = [Image.open(p).convert("RGB") for p in section_paths]
    width = max(im.width for im in images)
    height = sum(im.height for im in images)
    out = Image.new("RGB", (width, height), "white")
    y = 0
    for im in images:
        x = (width - im.width)//2
        out.paste(im, (x, y))
        y += im.height
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path, quality=92)


def create_demo_video(image_paths: list[Path], output_path: Path, duration: int = 10) -> bool:
    if not image_paths:
        return False
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return False

    concat = output_path.parent / "demo_concat.txt"
    seconds_each = max(1.2, duration / max(1, len(image_paths)))
    lines = []
    for p in image_paths:
        lines.append(f"file '{p.as_posix()}'")
        lines.append(f"duration {seconds_each:.2f}")
    lines.append(f"file '{image_paths[-1].as_posix()}'")
    concat.write_text("\n".join(lines), "utf-8")
    cmd = [
        ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p",
        "-r", "24", "-t", str(duration), "-c:v", "libx264", "-movflags", "+faststart", str(output_path)
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        return output_path.exists() and output_path.stat().st_size > 1024
    except Exception:
        return False

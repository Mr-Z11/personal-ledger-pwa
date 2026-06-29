#!/usr/bin/env python3
"""Generate deterministic iOS/PWA icons and portrait launch images."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "apps" / "web" / "public"
PWA_DIR = PUBLIC_DIR / "pwa"

BACKGROUND = "#f6f1e7"
INK = "#243127"
GREEN = "#31473a"
GOLD = "#d6b25e"
PAPER = "#fff7df"

LAUNCH_SIZES = [
    (750, 1334),
    (1242, 2208),
    (1125, 2436),
    (828, 1792),
    (1242, 2688),
    (1080, 2340),
    (1170, 2532),
    (1284, 2778),
    (1179, 2556),
    (1290, 2796),
    (1206, 2622),
    (1320, 2868),
]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def draw_ledger_mark(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    radius = max(8, int(width * 0.16))
    draw.rounded_rectangle(box, radius=radius, fill=GREEN)

    inset = int(width * 0.14)
    band_top = top + int(height * 0.26)
    band_height = max(4, int(height * 0.11))
    draw.rounded_rectangle(
        (left + inset, band_top, right - inset, band_top + band_height),
        radius=max(2, band_height // 2),
        fill=GOLD,
    )

    dot_radius = max(3, int(width * 0.052))
    dot_y = top + int(height * 0.67)
    for ratio in (0.30, 0.50, 0.70):
        dot_x = left + int(width * ratio)
        draw.ellipse(
            (dot_x - dot_radius, dot_y - dot_radius, dot_x + dot_radius, dot_y + dot_radius),
            fill=PAPER,
        )


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    y: int,
    text_font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
    canvas_width: int,
) -> None:
    bounds = draw.textbbox((0, 0), text, font=text_font)
    text_width = bounds[2] - bounds[0]
    draw.text(((canvas_width - text_width) // 2, y), text, font=text_font, fill=fill)


def make_icon(size: int, destination: Path) -> None:
    image = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(image)
    margin = int(size * 0.145)
    draw_ledger_mark(draw, (margin, margin, size - margin, size - margin))
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG", optimize=True, compress_level=9)


def make_launch(width: int, height: int) -> None:
    image = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(image)

    accent = int(width * 0.76)
    draw.ellipse((-accent // 2, -accent // 2, accent // 2, accent // 2), fill="#eee4ca")
    draw.polygon(
        ((0, height), (0, int(height * 0.78)), (width, int(height * 0.90)), (width, height)),
        fill="#efe5cf",
    )

    mark_size = int(width * 0.30)
    mark_top = int(height * 0.31)
    mark_left = (width - mark_size) // 2
    draw_ledger_mark(draw, (mark_left, mark_top, mark_left + mark_size, mark_top + mark_size))

    title_font = font(max(34, int(width * 0.057)))
    subtitle_font = font(max(24, int(width * 0.034)))
    status_font = font(max(20, int(width * 0.028)))
    draw_centered_text(draw, "Ledger Box", mark_top + mark_size + int(height * 0.038), title_font, INK, width)
    draw_centered_text(draw, "个人记账", mark_top + mark_size + int(height * 0.078), subtitle_font, GREEN, width)
    draw_centered_text(draw, "正在打开账本", int(height * 0.90), status_font, "#6f746f", width)

    PWA_DIR.mkdir(parents=True, exist_ok=True)
    image.save(PWA_DIR / f"launch-{width}x{height}.png", "PNG", optimize=True, compress_level=9)


def main() -> None:
    make_icon(180, PUBLIC_DIR / "apple-touch-icon.png")
    make_icon(192, PUBLIC_DIR / "icon-192.png")
    make_icon(512, PUBLIC_DIR / "icon-512.png")
    for width, height in LAUNCH_SIZES:
        make_launch(width, height)


if __name__ == "__main__":
    main()

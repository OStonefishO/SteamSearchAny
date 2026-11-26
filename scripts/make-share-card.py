from PIL import Image, ImageDraw, ImageFont

W, H = 1400, 720
BG = (7, 11, 17)
PANEL = (14, 23, 35)
LINE = (34, 56, 76)
ACCENT = (102, 192, 244)
GREEN = (164, 208, 7)
TEXT = (233, 241, 250)
MUTED = (139, 163, 187)
DIM = (94, 121, 148)

msyh = r"C:\Windows\Fonts\msyh.ttc"
msyhbd = r"C:\Windows\Fonts\msyhbd.ttc"
consola = r"C:\Windows\Fonts\consola.ttf"

f_title = ImageFont.truetype(msyhbd, 62)
f_sub = ImageFont.truetype(msyh, 26)
f_label = ImageFont.truetype(msyh, 22)
f_url = ImageFont.truetype(consola, 40)
f_small = ImageFont.truetype(msyh, 20)
f_tiny = ImageFont.truetype(msyh, 18)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 背景光晕
glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
gd.ellipse([-260, -320, 520, 400], fill=(14, 52, 74))
gd.ellipse([W - 420, H - 360, W + 260, H + 240], fill=(13, 44, 48))
glow = glow.filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(150))
img = Image.blend(img, glow, 0.55)
d = ImageDraw.Draw(img)

# 顶部品牌
d.rounded_rectangle([70, 62, 84, 118], radius=7, fill=ACCENT)
d.text((104, 58), "Steam 灯塔", font=f_title, fill=TEXT)
d.text((108, 132), "随机盲盒发现冷门佳作 · 多游戏加权相似检索", font=f_sub, fill=MUTED)

# 网址面板
box = [70, 228, W - 70, 372]
d.rounded_rectangle(box, radius=22, fill=PANEL, outline=LINE, width=2)
d.text((104, 254), "永久地址（电脑关机也能访问）", font=f_label, fill=DIM)
d.text((104, 288), "https://ostonefisho.github.io/SteamSearchAny-web/", font=f_url, fill=ACCENT)

# 特性
items = [
    ("9,814", "款游戏语料"),
    ("428", "个 Steam 官方标签"),
    ("2,815", "款隐藏佳作候选"),
    ("0", "依赖 / 打开即用"),
]
x = 70
for num, label in items:
    d.text((x, 420), num, font=ImageFont.truetype(msyhbd, 40), fill=GREEN)
    d.text((x, 474), label, font=f_small, fill=MUTED)
    x += 330

# 用法提示
d.rounded_rectangle([70, 536, W - 70, 606], radius=14, fill=(10, 18, 27), outline=LINE, width=1)
d.text((94, 556), "手机浏览器直接打开即可  ·  想加到桌面：Safari「分享 → 添加到主屏幕」/ Chrome「三点菜单 → 添加到主屏幕」", font=f_small, fill=MUTED)

# 署名
avatar = Image.open(r"D:\综合创作\steam-lighthouse\public\avatar.jpg").convert("RGB").resize((56, 56), Image.LANCZOS)
mask = Image.new("L", (56, 56), 0)
ImageDraw.Draw(mask).ellipse([0, 0, 55, 55], fill=255)
img.paste(avatar, (70, 636), mask)
d.ellipse([70, 636, 125, 691], outline=(60, 92, 118), width=2)
d.text((144, 646), "make with", font=f_small, fill=MUTED)
d.text((244, 644), "♥", font=ImageFont.truetype(r"C:\Windows\Fonts\seguisym.ttf", 22), fill=(255, 111, 165))
d.text((266, 646), "love", font=f_small, fill=MUTED)
d.text((W - 330, 650), "@OStonefishO", font=f_tiny, fill=DIM)

out = r"D:\综合创作\steam-lighthouse\preview\0-网址卡片.png"
img.save(out, "PNG", optimize=True)
print("saved", out)

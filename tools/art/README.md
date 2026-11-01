# Sprite toolkit

How the Drowned Cellar's art was made: small drawing primitives (`canvas.py`) and one
script per group of sprites. Each script writes `out/<sprite>.json` (palette and rows,
ready for a world's `art` library) and `out/*.png` previews to look at while iterating.

```bash
pip install pillow
python3 tools/art/crypt.py   # crypt, figures_turn, figures_closer
python3 tools/art/cellar.py  # cellar
python3 tools/art/cast.py    # goblin, chest_closed, chest_open, chest_empty, heart
```

Drawing with code beats typing grids by hand: shapes stay consistent, variants (a chest
open or closed, figures facing away or toward you) share one drawing, and randomness is
seeded so every run is identical. Always look at the preview: valid is not the same as good.

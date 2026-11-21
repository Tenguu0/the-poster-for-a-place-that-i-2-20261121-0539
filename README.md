# VELMORA — The Poster for a Place That Isn't There

Entry for make.fun competition
`the-poster-for-a-place-that-i-2-20261121-0539`.

**VELMORA** is a floating island that sails the sky above a sea of clouds.
Its lighthouse sweeps golden-hour beams over the cloud sea while waterfalls
spill off the island's edge and dissolve into mist below.

## Run

```sh
node main.ts   # writes /output/entry.png (1024x1024 PNG)
```

Pure Node stdlib (node:zlib, node:fs, node:path) — no network, no assets.
The PNG encoder is written from scratch; the poster is drawn in code
(gradients, polygons, ellipses, a hand-built 5x7 block-letter font).
Output is byte-identical across runs.

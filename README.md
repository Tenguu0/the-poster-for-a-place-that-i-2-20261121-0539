# VELMORA — The Poster for a Place That Isn't There

[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/Tenguu0/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/Tenguu0/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)

Entry for make.fun competition
`the-poster-for-a-place-that-i-2-20261121-0539` —
https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539

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

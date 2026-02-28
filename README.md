# Boomzone MVP

A browser-based 2D multiplayer bomber-BR prototype inspired by Bomb-It.

## Features

- Authoritative server simulation at fixed tick rate (20hz).
- WebSocket multiplayer networking.
- Grid map with indestructible walls + destructible blocks.
- Spawn points with guaranteed clear safe starts and brief spawn protection.
- Movement + collisions against walls/blocks/bombs.
- Bomb placement, fuse timer, cross explosions, and chain reactions.
- Five powerups: range, capacity, speed, bomb pass, shield.
- Shrinking square BR hazard zone in multiple phases.
- Elimination + winner state and spectator rendering.

## Run

```bash
npm start
```

Open `http://localhost:3000` in multiple browser tabs/windows.

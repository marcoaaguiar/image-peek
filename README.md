# image-peek

A Claude Code mod that draws PNG figures inline in the terminal, with numbered captions, the way a paper does.

- When a reply holds `![Figure 3. What the figure shows.](/absolute/path.png)` on its own line, the mod draws the picture there, with **Figure 3.** *What the figure shows.* under it.
- When Claude reads a PNG with the Read tool, the picture draws under the Read row, captioned with the file name.
- The mod adds a short section to the system prompt, so Claude numbers figures through the session, writes real captions, and refers to them in the text ("see Figure 3").

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install image-peek --marketplace marcoaaguiar/image-peek
```

Answer `y` to add the marketplace, then pick a scope.

## Terminals

Pictures draw in Ghostty, kitty 0.28 or later, and iTerm2 3.5 or later. Elsewhere the caption shows as text.

Inside tmux (3.3 or later), turn on passthrough and focus events, then restart Claude Code:

```
set -g allow-passthrough on
set -g focus-events on
```

## Limits

PNG only, at most 2 MiB, absolute paths only.

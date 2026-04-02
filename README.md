# pi-config

## Pi theme: `superset-light-contrast`

This repo includes the current local high-contrast Pi light theme so the same color scheme can be used on another machine.

Theme file:

- `themes/superset-light-contrast.json`

### Use it from this repo

Pi can load this theme file directly from the repo, or you can copy it into your global Pi themes directory.

1. Open Pi with this repo available.
2. Select the theme in `/settings`.
3. Choose `superset-light-contrast`.

### Make it your default on another machine

If you want this theme globally, copy it into your Pi themes directory and set it in settings:

```bash
mkdir -p ~/.pi/agent/themes
cp themes/superset-light-contrast.json ~/.pi/agent/themes/
```

Then set this in `~/.pi/agent/settings.json`:

```json
{
  "theme": "superset-light-contrast"
}
```

You can also keep using the project-local copy and just select it by name in `/settings` while working in this repo.

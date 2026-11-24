# Billing Cycle

Claude Code and Cursor both limit how much you can use them each week. They show how much of that limit is gone, but not how much of the week is gone, so it's hard to tell whether what's left will last. This menu-bar app shows both side by side.

The menu bar shows four thin bars in two pairs:

- **Top pair: Claude Code.**
- **Bottom pair: Cursor.**

In each pair, the solid bar is the share of the weekly limit you've used: Claude's orange for Claude Code, and black or white (matching the menu bar) for Cursor, whose brand is black and white. The faint gray bar is the share of the week that has passed. When the solid bar is longer, you're spending faster than the week allows.

Click the bars to open the panel. It shows the same numbers with percentages, when each week resets, and how many points you are over or under pace. The pace line turns red when you're over.

The bars follow the system's Light or Dark setting. In Light mode with a dark wallpaper, where macOS draws the menu bar with white text, the Cursor and week bars come out black and are hard to see.

## Install

```bash
pnpm install
pnpm installer
open "release/Billing Cycle-0.1.0-arm64.dmg"
```

Drag **Billing Cycle** to Applications. The build is unsigned, so the first time you open it, right-click it and choose Open. It then adds itself to your login items, so it starts again after a reboot. You can turn that off in the panel.

Only one copy runs at a time; opening it again while it's running does nothing.

Upgrading from the older version that showed percentages of the billing period: your reset dates are no longer used, and the panel opens once so you can connect Claude Code and Cursor.

`pnpm start` runs the app from a terminal and does not register a login item.

## Connecting

The panel opens by itself only on first launch, to ask you to connect each tool. After you click **Done**, later launches stay quiet and the panel opens only when you click the bars. Nothing is read until you click Connect, and you can skip either tool.

**Claude Code** reads the login Claude Code keeps in your Keychain (`Claude Code-credentials`). It sends that login only to `api.anthropic.com/api/oauth/usage`. Claude Code already lets macOS's `security` tool read that item, so there is no prompt. The app never renews the login, because renewing it would sign Claude Code out. If the login expires, open Claude Code once.

**Cursor** encrypts its login inside its settings database. To read it, the app needs the key stored in the Keychain item **Cursor Safe Storage**, so macOS asks once.

- Click **Allow**, not **Always Allow**. "Always Allow" would let any script on your Mac read Cursor's key.
- The app decrypts the login, keeps only the login, encrypted with its own Keychain key, and sends it only to `api2.cursor.sh`.
- The login lasts about two months. When it runs out, the panel shows **Reconnect Cursor**, and you see the prompt again only after you click it.

**Disconnect** in the panel turns a tool off and deletes anything the app saved for it.

## How it works

- Usage is fetched every 5 minutes, and again when you open the panel or wake the Mac if the last reading is over a minute old. **Refresh** in the panel fetches right away.
- When a request fails, the app waits longer before trying again, up to 30 minutes. Opening the panel doesn't cut that wait short.
- The week bars are redrawn every minute and need no network.
- The last good reading is saved, so the bars still show after a restart or while you're offline. In that case the panel marks the reading as stale.
- Each week's start and end come from the tools themselves, so there's nothing to set up.

Both usage endpoints are internal to Anthropic and Cursor and undocumented. They can change without notice, and when they do the panel says the reading failed.

## Bars not showing

If the menu bar is full, macOS hides the bars behind the notch. Newly launched apps go furthest left, so this often happens right after installing. The app is still running.

- Turn off an icon you don't need in System Settings → Menu Bar, and the bars appear.
- Or place the bars further right, near the system icons. This moves another app's icon behind the notch instead. The number is the distance from the right edge of the screen, in points:

  ```bash
  osascript -e 'quit app "Billing Cycle"'
  defaults write com.billingcycle.menu "NSStatusItem Preferred Position Item-0" -float 330
  open -a "Billing Cycle"
  ```

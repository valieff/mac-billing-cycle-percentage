# Days Percentage

A macOS menu-bar app that shows how far the current monthly billing cycle has gone.

The tray title is a whole-number percent. A reset on the 15th, with today the 17th of September, is 3 of 30 days: `10%`. The cycle runs from the reset day through the day before that day next month. Both of those days count. Today counts.

If you pick 29, 30, or 31 and a month is shorter, that month resets on its last day. A 31st reset in January 2026 runs through 27 February, and 28 February starts the next cycle.

## First launch

The app asks for the reset day the first time it opens. A disk image cannot ask that question while you drag the app to Applications. Open at login is on unless you turn it off in the panel. Click the menu-bar icon any time to change the day. If the menu bar is already full, macOS hides the percentage behind the camera notch. Hide another menu-bar icon and it appears on the right.

Open at login is registered only in the packaged app.

## Develop

```bash
pnpm install
pnpm test
pnpm start
pnpm dist
```

`pnpm start` runs the menu-bar app without adding a login item.

## Install a GitHub release

Tag `v*` builds an unsigned DMG and zip and attaches them to the GitHub release. macOS Gatekeeper will block the first open. Right-click the app, choose Open, then confirm.

Signing and notarization are not set up. They need an Apple Developer ID certificate.

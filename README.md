# Billing Cycle

Cursor shows how much of your usage is gone. It does not show how much of the billing month is gone, so it is hard to tell whether what you have left will last. This menu-bar app shows that percentage.

Set the reset day to the day your Cursor plan renews. The tray then reads a whole-number percent of the cycle that has already passed.

## Install

```bash
pnpm install
pnpm installer
open "release/Billing Cycle-0.1.0-arm64.dmg"
```

Drag **Billing Cycle** to Applications. The build is unsigned, so the first open is a right-click → Open.

## Reset day

The app asks for the day the first time it opens. Open at login stays on until you turn it off. Click the percentage to change the day.

If the menu bar is full, macOS hides the percentage behind the notch and leaves this panel open. Hide another menu-bar icon and the percentage shows on the right.

The cycle runs from the reset day through the day before that day next month. Today counts. A reset on the 29th, 30th, or 31st uses the last real day of a shorter month.

`pnpm start` runs the app from a terminal and does not register a login item.

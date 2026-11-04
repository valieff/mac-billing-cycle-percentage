# Billing Cycle

Cursor shows how much of your usage is gone. It does not show how much of the billing month is gone, so it is hard to tell whether what you have left will last. This menu-bar app shows that percentage.

Set the reset day and time to when your Cursor plan renews. The menu bar then shows two small stacked numbers:

- **Top:** percent of the billing month that has passed.
- **Bottom:** percent of the current week that has passed.

Both use local time and count the exact time of day, rounded down to a whole percent.

## Install

```bash
pnpm install
pnpm installer
open "release/Billing Cycle-0.1.0-arm64.dmg"
```

Drag **Billing Cycle** to Applications. The build is unsigned, so the first open is a right-click → Open.

## Reset day and time

The app asks for the monthly reset day the first time it opens. Open at login stays on until you turn it off. Click the percentages to change the settings.

If the menu bar is full, macOS hides the percentages behind the notch and leaves this panel open. Hide another menu-bar icon and the percentages show on the right.

**Month.** The cycle runs from the reset day at the reset time until the same day and time next month. A reset on the 29th, 30th, or 31st uses the last real day of a shorter month.

**Week.** The week runs from the chosen weekday at the chosen time for seven days. It defaults to Monday 00:00.

`pnpm start` runs the app from a terminal and does not register a login item.

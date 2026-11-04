# Billing Cycle

Cursor and Claude Code show how much of your usage is gone. They do not show how much of the billing period is gone, so it is hard to tell whether what you have left will last. This menu-bar app shows two small stacked percentages:

- **Top: Cursor.** Percent of your Cursor billing month that has passed. Enter your billing date and the local time it renews.
- **Bottom: Claude Code.** Percent of your Claude Code week that has passed. Enter the weekday and local time your weekly limit resets.

Times are entered in 24-hour format. Both percentages use your local time zone, count the exact time of day, and round down to a whole percent.

## Install

```bash
pnpm install
pnpm installer
open "release/Billing Cycle-0.1.0-arm64.dmg"
```

Drag **Billing Cycle** to Applications. The build is unsigned, so the first open is a right-click → Open.

## Settings

The app asks for your Cursor billing date the first time it opens. Open at login stays on until you turn it off. Click the percentages to change the settings.

If the menu bar is full, macOS hides the percentages behind the notch and leaves this panel open. Hide another menu-bar icon and the percentages show on the right.

**Cursor (top).** The cycle runs from the billing date at the chosen time until the same date and time next month. A billing date on the 29th, 30th, or 31st uses the last real day of a shorter month.

**Claude Code (bottom).** The week runs for seven days from the chosen weekday and time. It defaults to Monday 00:00.

`pnpm start` runs the app from a terminal and does not register a login item.

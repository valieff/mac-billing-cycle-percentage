import { BrowserWindow, nativeImage, type NativeImage } from "electron";

/** Menu-bar icons are laid out in points; macOS centers the image vertically. */
const heightPt = 22;
const widthPt = 28;
const scale = 2;
const barXPt = 1;
const barWidthPt = widthPt - 2 * barXPt;
const barHeightPt = 3;
/** Top edge of each bar: Claude used, Claude week, Cursor used, Cursor week. */
const barTopsPt = [2, 6, 13, 17];

/** Claude's brand terracotta. Cursor's brand is black and white, so its bar follows the menu bar text color. */
const claudeColor = "#D97757";
const trackAlpha = 0.14;
const weekAlpha = 0.3;

/** Usage and week-elapsed shares for one provider, 0–1, or null to draw the empty track. */
export interface BarPair {
  used: number | null;
  elapsed: number | null;
}

/**
 * Draws two pairs of thin horizontal bars for the tray: in each pair the solid bar is the share of the
 * weekly limit used and the faint bar is the share of the week gone. The image keeps its colors, so
 * it is not a template image and has to be redrawn when the menu bar switches between light and dark.
 * Rendered with a canvas in a hidden window because the main process has no drawing API.
 */
export class BarsRenderer {
  private readonly window: BrowserWindow;
  private readonly loaded: Promise<void>;
  private lastKey = "";
  private lastImage: NativeImage | null = null;

  constructor() {
    this.window = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.loaded = this.window.loadURL("about:blank");
  }

  async render(pairs: readonly [BarPair, BarPair], darkMenuBar: boolean): Promise<NativeImage> {
    const widthPx = barWidthPt * scale;
    const fills = pairs.flatMap((pair) => [pair.used, pair.elapsed]).map((fraction) =>
      fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * widthPx),
    );
    const ink = darkMenuBar ? "#FFFFFF" : "#000000";
    const colors = [claudeColor, ink, ink, ink];
    const key = `${fills.join(",")}|${ink}`;
    if (this.lastImage !== null && key === this.lastKey) {
      return this.lastImage;
    }
    await this.loaded;
    const args = JSON.stringify({
      fills,
      colors,
      ink,
      trackAlpha,
      weekAlpha,
      heightPt,
      widthPt,
      scale,
      barXPt,
      barWidthPt,
      barHeightPt,
      barTopsPt,
    });
    const result: unknown = await this.window.webContents.executeJavaScript(`(${drawInPage})(${args})`);
    if (typeof result !== "string") {
      throw new Error("Tray bar rendering returned nothing");
    }
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: scale, width: widthPt, height: heightPt, dataURL: result });
    this.lastKey = key;
    this.lastImage = image;
    return image;
  }

  destroy(): void {
    this.window.destroy();
  }
}

/**
 * Runs inside the hidden page. Kept as source text because the main-process build has no DOM types.
 * Bars are drawn in order: Claude used, Claude week, Cursor used, Cursor week. Used bars are opaque in
 * their color; week bars and tracks use the menu bar's text color, faint.
 */
const drawInPage = `(o) => {
  const canvas = document.createElement("canvas");
  canvas.width = o.widthPt * o.scale;
  canvas.height = o.heightPt * o.scale;
  const context = canvas.getContext("2d");
  const x = o.barXPt * o.scale;
  const width = o.barWidthPt * o.scale;
  const height = o.barHeightPt * o.scale;
  const radius = o.scale;
  const bar = (top, length, color, alpha) => {
    if (length <= 0) return;
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.beginPath();
    context.roundRect(x, top, length, height, radius);
    context.fill();
  };
  o.barTopsPt.forEach((topPt, index) => {
    const top = topPt * o.scale;
    const isUsed = index % 2 === 0;
    bar(top, width, o.ink, o.trackAlpha);
    bar(top, o.fills[index], o.colors[index], isUsed ? 1 : o.weekAlpha);
  });
  return canvas.toDataURL("image/png");
}`;

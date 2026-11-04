import { BrowserWindow, nativeImage, type NativeImage } from "electron";

/** Menu-bar icons are laid out in points; macOS centers the image vertically. */
const heightPt = 22;
const scale = 2;
const fontSizePt = 9.5;
/** Baselines chosen so two lines of digits sit centered in the 22pt bar with a small gap between them. */
const baselinesPt = [9.6, 19.2];

/**
 * Draws two short lines of text, right-aligned and stacked, into a template image for the tray.
 * Electron's Tray title is single-line, so the stack is rendered with a canvas in a hidden window.
 */
export class StackedTextRenderer {
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

  async render(lines: readonly [string, string]): Promise<NativeImage> {
    const key = lines.join("\n");
    if (this.lastImage !== null && key === this.lastKey) {
      return this.lastImage;
    }
    await this.loaded;
    const args = JSON.stringify({ lines, heightPt, scale, fontSizePt, baselinesPt });
    const result: unknown = await this.window.webContents.executeJavaScript(`(${drawInPage})(${args})`);
    if (typeof result !== "object" || result === null) {
      throw new Error("Tray text rendering returned nothing");
    }
    const { dataURL, widthPx } = result as { dataURL: string; widthPx: number };
    const image = nativeImage.createEmpty();
    image.addRepresentation({
      scaleFactor: scale,
      width: widthPx / scale,
      height: heightPt,
      dataURL,
    });
    image.setTemplateImage(true);
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
 * Receives { lines, heightPt, scale, fontSizePt, baselinesPt } and returns { dataURL, widthPx }.
 */
const drawInPage = `(options) => {
  const font = "600 " + options.fontSizePt * options.scale + "px -apple-system, system-ui, sans-serif";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = font;
  // Reserve room for the widest value so the icon keeps its width as the numbers change.
  const widest = Math.max(
    context.measureText("100%").width,
    ...options.lines.map((line) => context.measureText(line).width),
  );
  const widthPx = Math.ceil(widest / options.scale) * options.scale + options.scale;
  canvas.width = widthPx;
  canvas.height = options.heightPt * options.scale;
  context.font = font;
  context.fillStyle = "#000";
  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  options.lines.forEach((line, index) => {
    context.fillText(line, widthPx - options.scale / 2, options.baselinesPt[index] * options.scale);
  });
  return { dataURL: canvas.toDataURL("image/png"), widthPx };
}`;

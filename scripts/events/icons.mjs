import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
for (const size of [192, 512]) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    "<style>html,body{margin:0;padding:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>" +
      readFileSync("apps/web/public/icon.svg", "utf8"),
  );
  await page.screenshot({ path: `apps/web/public/icon-${size}.png` });
  await page.close();
}
await browser.close();

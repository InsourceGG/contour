/** Snapshot capture is opt-in and only visits the five screens requested by Task 4b. */
import { chromium, type APIRequestContext } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function captureScreenshots(input: {
  signedIn: APIRequestContext; projectId: string; consentUrl: string; appUrl: string;
}) {
  const directory = resolve(import.meta.dirname,"../.screenshots");
  await mkdir(directory,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const checks: { screen:string; width:number; theme:string; violations: { id:string; impact:string|null|undefined; targets: unknown[] }[] }[] = [];
  try {
    const storageState = await input.signedIn.storageState();
    for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440,768,390]) {
      const signedIn = await browser.newContext({storageState,viewport:{width,height:1000},colorScheme,reducedMotion:"reduce"});
      const anonymous = await browser.newContext({viewport:{width,height:1000},colorScheme,reducedMotion:"reduce"});
      const screens = [
        {name:"landing",url:input.appUrl,context:anonymous},
        {name:"projects",url:`${input.appUrl}/projects`,context:signedIn},
        {name:"link-start",url:`${input.appUrl}/link/start?project=${input.projectId}`,context:signedIn},
        {name:"owner",url:`${input.appUrl}/owner`,context:signedIn},
        {name:"consent",url:input.consentUrl,context:signedIn},
      ];
      for (const screen of screens) {
        const page = await screen.context.newPage();
        const response = await page.goto(screen.url,{waitUntil:"networkidle"});
        if (!response || response.status()!==200) throw new Error(`Unable to capture ${screen.name}`);
        await page.evaluate(async()=>{await document.fonts.ready;});
        await page.screenshot({path:resolve(directory,`${screen.name}-${width}${colorScheme === "dark" ? "-dark" : ""}.png`),fullPage:true});
        // Layout assertions validate requested snapshots without interactive navigation.
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
        if(overflow) throw new Error(`Horizontal overflow on ${screen.name} at ${width}px`);
        const accessibility = await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
        const violations = accessibility.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}));
        checks.push({screen:screen.name,width,theme:colorScheme,violations});
        await writeFile(resolve(directory,"accessibility.json"),JSON.stringify(checks,null,2));
        if(violations.some(v=>v.impact === "serious" || v.impact === "critical")) throw new Error(`Accessibility check failed on ${screen.name} at ${width}px (${colorScheme}): ${violations.map(v=>v.id).join(", ")}`);
        await page.keyboard.press("Tab");
        const skipFocused = await page.evaluate(()=>document.activeElement?.getAttribute("href") === "#content");
        if(!skipFocused) throw new Error(`Skip link is not first in the keyboard path on ${screen.name}`);
        await page.close();
      }
      await signedIn.close(); await anonymous.close();
    }
    }
  } finally { await browser.close(); }
}

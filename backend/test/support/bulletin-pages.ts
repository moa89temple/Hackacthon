import { readFileSync } from "node:fs";
import { savedCopyName } from "../../src/office-pages.ts";
import type { SavedWeb } from "./saved-web.ts";

export const PROGRAMS_PAGE = "https://bulletin.temple.edu/academic-programs/";
export const CS_BS_PAGE = "https://bulletin.temple.edu/undergraduate/science-technology/computer-science-bs/";
export const CS_BA_PAGE = "https://bulletin.temple.edu/undergraduate/science-technology/computer-science-ba/";
/** One Suggested Academic Plan, and a Student with no choice to make. */
export const BIOLOGY_BS_PAGE = "https://bulletin.temple.edu/undergraduate/science-technology/biology-bs/";
/** Two plans for one degree: the usual one and a semester abroad. */
export const MECHANICAL_PAGE = "https://bulletin.temple.edu/undergraduate/engineering/mechanical-engineering-bsme/";
/** One plan in two tables, the first with Years 1 and 2 and the second with Years 3 and 4. */
export const HISTORIC_PRESERVATION_PAGE = "https://bulletin.temple.edu/undergraduate/tyler/historic-preservation-bs/";
/** A plan with a Summer term in it. */
export const GEOLOGY_PAGE = "https://bulletin.temple.edu/undergraduate/science-technology/geology-bs/";

/** npm run save-bulletin-pages refreshes the saved copy of each. */
export const SAVED_BULLETIN_PAGES = [PROGRAMS_PAGE, CS_BS_PAGE, CS_BA_PAGE, BIOLOGY_BS_PAGE, MECHANICAL_PAGE, HISTORIC_PRESERVATION_PAGE, GEOLOGY_PAGE];

export function saveBulletinPages(web: SavedWeb): void {
  for (const url of SAVED_BULLETIN_PAGES) {
    web.save(url, readFileSync(new URL(`../fixtures/bulletin-pages/${savedCopyName(url)}`, import.meta.url), "utf8"));
  }
}

import type { Office } from "./office-pages.ts";

const OF_REGISTRAR = "https://registrar.temple.edu";
const OF_SFS = "https://sfs.temple.edu";

/**
 * The pages that give the dates every Temple Student faces. As with the office pages, each address
 * has to answer without a redirect, and test/fixtures/office-pages holds a saved copy of each.
 * The calendars and the FAFSA page are named by year, so each new year's page needs adding here.
 */
export const MILESTONE_OFFICES: Office[] = [
  {
    name: "Office of the University Registrar",
    pages: [
      `${OF_REGISTRAR}/academic-calendar/2026-2027-academic-calendar`,
      `${OF_REGISTRAR}/academic-calendar/2027-2028-academic-calendar`,
      `${OF_REGISTRAR}/priority-registration-spring`,
      `${OF_REGISTRAR}/priority-registration-summer`,
      `${OF_REGISTRAR}/priority-registration-fall`,
    ],
  },
  {
    name: "Student Financial Services",
    pages: [
      `${OF_SFS}/policies/financial-aid-deadlines`,
      `${OF_SFS}/apply/current-undergraduate`,
      `${OF_SFS}/apply/2027-28-fafsa`,
    ],
  },
];

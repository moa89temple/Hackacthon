/** One Temple office and the pages of its site that say what it offers Students. */
export interface Office {
  name: string;
  pages: string[];
}

const OF_TUTTLEMAN = "https://counseling.temple.edu";
const OF_SUCCESS_CENTER = "https://studentsuccess.temple.edu";
const OF_CAREER_CENTER = "https://careercenter.temple.edu";
const OF_SFS = "https://sfs.temple.edu";
const OF_WELLNESS = "https://wellness.temple.edu";
const OF_DISABILITY = "https://studentaffairs.temple.edu/who-we-are/departments/disability-resources-services";
const OF_DEAN = "https://studentaffairs.temple.edu/who-we-are/departments/dean-students";

/**
 * Each address has to answer without a redirect, because the web adapter won't follow one. When an
 * office moves a page, its read fails, Activity says so, and this list needs the new address.
 * test/fixtures/office-pages holds a saved copy of each: npm run save-office-pages refreshes them.
 */
export const OFFICES: Office[] = [
  {
    name: "Tuttleman Counseling Services",
    pages: [
      `${OF_TUTTLEMAN}/`,
      `${OF_TUTTLEMAN}/our-services`,
      `${OF_TUTTLEMAN}/our-services/individual`,
      `${OF_TUTTLEMAN}/our-services/lets-talk`,
      `${OF_TUTTLEMAN}/our-services/group-therapy-skills-classes`,
      `${OF_TUTTLEMAN}/about-us/contact-us`,
      `${OF_TUTTLEMAN}/about-us/overview-eligibility`,
      `${OF_TUTTLEMAN}/resources/free-online-therapy`,
    ],
  },
  {
    name: "Student Success Center",
    pages: [
      `${OF_SUCCESS_CENTER}/`,
      `${OF_SUCCESS_CENTER}/programs`,
      `${OF_SUCCESS_CENTER}/programs/writing`,
      `${OF_SUCCESS_CENTER}/programs/writing/tutoring`,
      `${OF_SUCCESS_CENTER}/programs/stem/tutoring`,
      `${OF_SUCCESS_CENTER}/programs/coaching`,
      `${OF_SUCCESS_CENTER}/programs/pass`,
    ],
  },
  {
    name: "Career Center",
    pages: [
      `${OF_CAREER_CENTER}/`,
      `${OF_CAREER_CENTER}/students`,
      `${OF_CAREER_CENTER}/students/explore/career-coaching`,
      `${OF_CAREER_CENTER}/students/explore/drop-ins`,
      `${OF_CAREER_CENTER}/students/grow/book-free-linkedin-headshot-career-center`,
      `${OF_CAREER_CENTER}/resources`,
    ],
  },
  {
    name: "Student Financial Services",
    pages: [
      `${OF_SFS}/`,
      `${OF_SFS}/about/appointments`,
      `${OF_SFS}/financial-aid-types`,
      `${OF_SFS}/tuition-billing/paying-your-bill`,
      `${OF_SFS}/tuition-billing/past-due-accounts`,
    ],
  },
  {
    name: "Wellness Resource Center",
    pages: [
      `${OF_WELLNESS}/`,
      `${OF_WELLNESS}/students`,
      `${OF_WELLNESS}/students/wellness-consultations`,
      `${OF_WELLNESS}/students/safer-sex-supplies`,
      `${OF_WELLNESS}/resources/campus-resources`,
    ],
  },
  {
    name: "Disability Resources and Services",
    pages: [
      OF_DISABILITY,
      `${OF_DISABILITY}/how-register`,
      `${OF_DISABILITY}/resources-services`,
      `${OF_DISABILITY}/resources-services/academic-accommodations`,
    ],
  },
  {
    name: "Dean of Students",
    pages: [
      OF_DEAN,
      `${OF_DEAN}/who-we-are/contact-us`,
      `${OF_DEAN}/students/support-resources`,
      `${OF_DEAN}/students/student-emergency-aid-fund`,
      `${OF_DEAN}/students/support-resources/resources-commuting-students`,
    ],
  },
];

/** The saved copy of a page, under test/fixtures/office-pages. */
export function savedCopyName(url: string): string {
  return `${url.replace(/^https:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_").replace(/_$/, "")}.html`;
}

/**
 * Research-backed UX scoring framework references
 * 
 * This file contains the 15 foundational HCI publications that inform
 * Open Design AI's UX Intelligence scoring methodology.
 */

export type ResearchReference = {
  id: string
  number: number
  authors: string
  year: number
  title: string
  publication: string
  doi?: string
  url?: string
  category: "inspection" | "measurement" | "questionnaire" | "efficiency" | "foundation"
  relevance: string
}

export const UX_RESEARCH_REFERENCES: ResearchReference[] = [
  {
    id: "nielsen-molich-1990",
    number: 1,
    authors: "Jakob Nielsen and Rolf Molich",
    year: 1990,
    title: "Heuristic evaluation of user interfaces",
    publication: "CHI '90: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems",
    doi: "10.1145/97243.97281",
    url: "https://doi.org/10.1145/97243.97281",
    category: "inspection",
    relevance: "Establishes heuristic evaluation as a method to identify interface usability problems through systematic inspection."
  },
  {
    id: "nielsen-1994",
    number: 2,
    authors: "Jakob Nielsen",
    year: 1994,
    title: "Enhancing the explanatory power of usability heuristics",
    publication: "CHI '94: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems",
    doi: "10.1145/191666.191729",
    url: "https://doi.org/10.1145/191666.191729",
    category: "inspection",
    relevance: "Defines 10 usability heuristics including visibility of system status, consistency, user control, error prevention, recognition, and error recovery."
  },
  {
    id: "polson-etal-1992",
    number: 3,
    authors: "Peter G. Polson, Clayton Lewis, John Rieman and Cathleen Wharton",
    year: 1992,
    title: "Cognitive walkthroughs: a method for theory-based evaluation of user interfaces",
    publication: "International Journal of Man-Machine Studies, 36(5), 741-773",
    doi: "10.1016/0020-7373(92)90039-N",
    url: "https://doi.org/10.1016/0020-7373(92)90039-N",
    category: "inspection",
    relevance: "Provides step-by-step evaluation framework for assessing whether users would know what to do, notice correct actions, and understand feedback."
  },
  {
    id: "hornbaek-2006",
    number: 4,
    authors: "Kasper Hornbæk",
    year: 2006,
    title: "Current practice in measuring usability: Challenges to usability studies and research",
    publication: "International Journal of Human-Computer Studies, 64(2), 79-102",
    doi: "10.1016/j.ijhcs.2005.06.002",
    url: "https://doi.org/10.1016/j.ijhcs.2005.06.002",
    category: "measurement",
    relevance: "Critical methodological warning that single metrics can miss important aspects of usability and must be properly justified."
  },
  {
    id: "schrepp-etal-2024",
    number: 5,
    authors: "Martin Schrepp et al.",
    year: 2024,
    title: "Measurement practices in user experience (UX) research: A systematic quantitative literature review",
    publication: "Frontiers in Computer Science, 6:1368860",
    doi: "10.3389/fcomp.2024.1368860",
    url: "https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2024.1368860/full",
    category: "measurement",
    relevance: "Reviews UX measurement in CHI research, documenting why each metric must be justified and validated."
  },
  {
    id: "law-etal-2009",
    number: 6,
    authors: "Effie Lai-Chong Law, Virpi Roto, Marc Hassenzahl, Arnold P.O.S. Vermeeren and Joke Kort",
    year: 2009,
    title: "Understanding, scoping and defining user experience: a survey approach",
    publication: "CHI '09: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems",
    doi: "10.1145/1518701.1518813",
    url: "https://doi.org/10.1145/1518701.1518813",
    category: "foundation",
    relevance: "Distinguishes usability from broader user experience, establishing why observable findings must be separated from satisfaction claims."
  },
  {
    id: "brooke-1996",
    number: 7,
    authors: "John Brooke",
    year: 1996,
    title: "SUS — A quick and dirty usability scale",
    publication: "Usability Evaluation in Industry, Taylor & Francis",
    url: "https://www.researchgate.net/publication/319394819_SUS_--_a_quick_and_dirty_usability_scale",
    category: "questionnaire",
    relevance: "Introduces System Usability Scale (SUS), a standardized 10-item questionnaire for measuring perceived usability from actual users."
  },
  {
    id: "laugwitz-etal-2008",
    number: 8,
    authors: "Bettina Laugwitz, Theo Held and Martin Schrepp",
    year: 2008,
    title: "Construction and Evaluation of a User Experience Questionnaire",
    publication: "HCI and Usability for Education and Work, Lecture Notes in Computer Science, vol 5298",
    doi: "10.1007/978-3-540-89350-9_6",
    url: "https://doi.org/10.1007/978-3-540-89350-9_6",
    category: "questionnaire",
    relevance: "Presents User Experience Questionnaire (UEQ) measuring pragmatic quality, hedonic quality, and appeal beyond task completion."
  },
  {
    id: "lewis-etal-2013",
    number: 9,
    authors: "James R. Lewis, Brian S. Utesch and Deborah E. Maher",
    year: 2013,
    title: "UMUX-LITE: when there's no time for the SUS",
    publication: "CHI '13: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems",
    doi: "10.1145/2470654.2481287",
    url: "https://doi.org/10.1145/2470654.2481287",
    category: "questionnaire",
    relevance: "Provides validated 2-item usability questionnaire for quick user feedback without lengthy surveys."
  },
  {
    id: "hassenzahl-2003",
    number: 10,
    authors: "Marc Hassenzahl",
    year: 2003,
    title: "The Thing and I: Understanding the Relationship Between User and Product",
    publication: "Funology: From Usability to Enjoyment, Springer",
    doi: "10.1007/1-4020-2967-5_4",
    url: "https://doi.org/10.1007/1-4020-2967-5_4",
    category: "foundation",
    relevance: "Distinguishes pragmatic quality (goal achievement) from hedonic qualities (experience), showing visual attractiveness is not a substitute for usability."
  },
  {
    id: "rodden-etal-2010",
    number: 11,
    authors: "Kerry Rodden, Hilary Hutchinson and Xin Fu",
    year: 2010,
    title: "Measuring the User Experience on a Large Scale: User-Centered Metrics for Web Applications",
    publication: "CHI '10: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems",
    url: "https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/",
    category: "measurement",
    relevance: "Presents HEART framework (Happiness, Engagement, Adoption, Retention, Task Success) connecting task-level usability to product goals."
  },
  {
    id: "sauro-lewis-2005",
    number: 12,
    authors: "Jeff Sauro and James R. Lewis",
    year: 2005,
    title: "Estimating Completion Rates from Small Samples Using Binomial Confidence Intervals",
    publication: "Proceedings of the Human Factors and Ergonomics Society Annual Meeting, 49(24)",
    doi: "10.1177/154193120504902407",
    url: "https://doi.org/10.1177/154193120504902407",
    category: "measurement",
    relevance: "Establishes that task completion percentages have uncertainty, especially with small samples, and must not be presented as statistically definitive."
  },
  {
    id: "hart-staveland-1988",
    number: 13,
    authors: "Sandra G. Hart and Lowell E. Staveland",
    year: 1988,
    title: "Development of NASA-TLX (Task Load Index): Results of Empirical and Theoretical Research",
    publication: "Advances in Psychology, 52, 139-183",
    doi: "10.1016/S0166-4115(08)62386-9",
    url: "https://doi.org/10.1016/S0166-4115(08)62386-9",
    category: "questionnaire",
    relevance: "NASA Task Load Index measures perceived workload (mental demand, effort, frustration) from actual users, not inferred from screenshots."
  },
  {
    id: "card-etal-1980",
    number: 14,
    authors: "Stuart K. Card, Thomas P. Moran and Allen Newell",
    year: 1980,
    title: "The Keystroke-Level Model for User Performance Time with Interactive Systems",
    publication: "Communications of the ACM, 23(7), 396-410",
    doi: "10.1145/358886.358895",
    url: "https://doi.org/10.1145/358886.358895",
    category: "efficiency",
    relevance: "Estimates expert task performance from operations (keystrokes, pointing, mental preparation) to identify unnecessary interaction steps."
  },
  {
    id: "fitts-1954",
    number: 15,
    authors: "Paul M. Fitts",
    year: 1954,
    title: "The Information Capacity of the Human Motor System in Controlling the Amplitude of Movement",
    publication: "Journal of Experimental Psychology, 47(6), 381-391",
    doi: "10.1037/h0055392",
    url: "https://doi.org/10.1037/h0055392",
    category: "foundation",
    relevance: "Foundational work on movement time, distance and target precision, motivating inspection of button size, spacing and target placement."
  }
]

/**
 * Generate formatted references section for UX Intelligence reports
 */
export function generateReferencesSection(): string {
  const categories = {
    inspection: "Core Inspection Methods",
    measurement: "UX Measurement & Validation",
    questionnaire: "Human Experience Questionnaires",
    efficiency: "Workflow Efficiency & Performance",
    foundation: "Foundational UX Research"
  }

  let markdown = "## Research References\n\n"
  markdown += "This UX Intelligence score is grounded in established Human-Computer Interaction (HCI) research rather than subjective AI opinions. The scoring framework draws from the following 15 peer-reviewed publications:\n\n"

  // Group by category
  for (const [categoryKey, categoryName] of Object.entries(categories)) {
    const refs = UX_RESEARCH_REFERENCES.filter(r => r.category === categoryKey)
    if (refs.length === 0) continue

    markdown += `### ${categoryName}\n\n`

    for (const ref of refs) {
      markdown += `**[${ref.number}] ${ref.title}**  \n`
      markdown += `${ref.authors} (${ref.year})  \n`
      markdown += `*${ref.publication}*  \n`
      if (ref.doi) {
        markdown += `DOI: [${ref.doi}](https://doi.org/${ref.doi})  \n`
      } else if (ref.url) {
        markdown += `[Read paper](${ref.url})  \n`
      }
      markdown += `\n*Relevance:* ${ref.relevance}\n\n`
    }
  }

  markdown += "---\n\n"
  markdown += "**Methodology Note:** This automated UX audit evaluates observable interface behavior, workflow execution, and accessibility compliance. It is distinct from perceived user experience, which requires validated questionnaires (SUS, UEQ, UMUX-LITE) administered to actual users. Both types of evidence are necessary for comprehensive UX assessment.\n\n"

  return markdown
}

/**
 * Get specific reference by ID
 */
export function getReference(id: string): ResearchReference | undefined {
  return UX_RESEARCH_REFERENCES.find(r => r.id === id)
}

/**
 * Get references by category
 */
export function getReferencesByCategory(category: ResearchReference["category"]): ResearchReference[] {
  return UX_RESEARCH_REFERENCES.filter(r => r.category === category)
}

/**
 * Generate citation for a specific reference
 */
export function formatCitation(ref: ResearchReference): string {
  let citation = `${ref.authors} (${ref.year}). ${ref.title}. ${ref.publication}.`
  if (ref.doi) {
    citation += ` https://doi.org/${ref.doi}`
  }
  return citation
}

/**
 * ISO 9241-11 reference for usability definition
 */
export const ISO_9241_11_REFERENCE = {
  standard: "ISO 9241-11:2018",
  title: "Ergonomics of human-system interaction — Part 11: Usability: Definitions and concepts",
  organization: "International Organization for Standardization",
  url: "https://www.iso.org/standard/63500.html",
  definition: "Usability: The extent to which a system, product or service can be used by specified users to achieve specified goals with effectiveness, efficiency and satisfaction in a specified context of use."
}

/**
 * WCAG reference for accessibility criteria
 */
export const WCAG_REFERENCE = {
  standard: "WCAG 2.2",
  title: "Web Content Accessibility Guidelines (WCAG) 2.2",
  organization: "W3C Web Accessibility Initiative",
  url: "https://www.w3.org/WAI/WCAG22/quickref/",
  relevance: "Defines accessibility requirements for perceivable, operable, understandable, and robust web content."
}

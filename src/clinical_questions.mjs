// SPDX-License-Identifier: Apache-2.0
//
// Topic-keyed "questions to ask your clinician" templates. When
// MedGemma's reply discusses a topic, Hearth surfaces a small card with
// 4-6 questions the patient can bring to their next clinical visit.
//
// Sources: AHA POTS scientific statement 2022 patient-facing addendum,
// Long COVID Research Initiative patient FAQ, NHS Long COVID care
// guidance, and Mount Sinai Cohen Long COVID Center patient handouts.

const TOPICS = [
  {
    topic: "Long COVID",
    keywords: [/\blong\s+covid\b/i, /\bpost[-\s]?covid\b/i, /\bpasc\b/i, /\bpost[-\s]?acute\s+sequelae\b/i],
    questions: [
      "Is post-exertional malaise (PEM) part of my picture? If yes, what pacing approach do you recommend?",
      "Should I be tested for orthostatic intolerance / POTS given my symptom pattern?",
      "Are there biomarkers worth testing (D-dimer, fibrinogen, cortisol, autonomic function studies)?",
      "What evidence-based interventions might apply to my case (low-dose naltrexone, antihistamines, anticoagulation)?",
      "What red flags should I watch for that would warrant urgent care?",
      "Are there any clinical trials enrolling that I would qualify for?",
    ],
  },
  {
    topic: "POTS (Postural Orthostatic Tachycardia Syndrome)",
    keywords: [/\bPOTS\b/i, /\bpostural\s+orthostatic\s+tachycardia\b/i, /\bdysautonomia\b/i, /\borthostatic\s+intolerance\b/i],
    questions: [
      "Should I have a tilt-table test or active-stand test confirmed before adjusting treatment?",
      "What is my fluid + sodium target per day, and how do I track it?",
      "Are compression stockings (class II, 20-30 mmHg) appropriate for me?",
      "If pharmacotherapy is indicated, which first-line agent fits my phenotype (ivabradine, propranolol, midodrine, fludrocortisone)?",
      "What activities should I avoid, and what graded recumbent exercise might help?",
      "How will we measure whether treatment is working over the next 8-12 weeks?",
    ],
  },
  {
    topic: "ME/CFS (Myalgic Encephalomyelitis / Chronic Fatigue Syndrome)",
    keywords: [/\bME\/CFS\b/i, /\bmyalgic\s+encephalomyelitis\b/i, /\bchronic\s+fatigue\s+syndrome\b/i],
    questions: [
      "Have I been formally evaluated against IOM 2015 or Canadian Consensus Criteria?",
      "What is my baseline activity envelope and how do I quantify it (heart-rate-monitored pacing, step count)?",
      "Are there comorbidities (POTS, MCAS, sleep apnea, hypothyroid) being missed?",
      "Is graded exercise therapy contraindicated for me, and what alternative do you recommend?",
      "Are there off-label options with reasonable evidence (low-dose naltrexone, antiviral trials, supplements)?",
      "How do I get accommodations at work or in school documented?",
    ],
  },
  {
    topic: "MCAS (Mast Cell Activation Syndrome)",
    keywords: [/\bMCAS\b/i, /\bmast\s+cell\s+activation\b/i, /\bhistamine\s+intolerance\b/i],
    questions: [
      "Should we run baseline labs (tryptase, n-methylhistamine, prostaglandin D2) to support the diagnosis?",
      "Is the standard H1 + H2 antihistamine combination appropriate for me?",
      "Are there mast-cell stabilizers (cromolyn, ketotifen) worth trialing?",
      "What dietary triggers should I track (low-histamine diet experiment)?",
      "Could my symptoms be explained by another condition like carcinoid or pheochromocytoma?",
      "What rescue medications should I carry?",
    ],
  },
  {
    topic: "hypertension management",
    keywords: [/\bhypertension\b/i, /\bhigh\s+blood\s+pressure\b/i],
    questions: [
      "What is my target blood pressure given my age and comorbidities?",
      "Should I be home-monitoring with a validated cuff? How often?",
      "Are my current medications optimized for my comorbidities (diabetes, kidney function)?",
      "Are there lifestyle interventions I could be doing better (DASH diet, sodium, exercise)?",
      "What side effects should I watch for and when should I report them?",
    ],
  },
  {
    topic: "diabetes (type 2)",
    keywords: [/\btype\s+2\s+diabetes\b/i, /\bT2D\b/i, /\bA1[cC]\b/i, /\bHbA1c\b/i],
    questions: [
      "What is my A1c target, and how often will we check it?",
      "Do I qualify for GLP-1 / SGLT2 therapy given my cardiac and renal profile?",
      "How do I distinguish hypoglycemia from POTS or anxiety symptoms?",
      "What foot, eye, and kidney screening should I be on, and on what schedule?",
      "What lifestyle interventions have the biggest impact for me right now?",
    ],
  },
  {
    topic: "depression / anxiety",
    keywords: [/\bdepression\b/i, /\bdepressive\b/i, /\banxiety\s+disorder\b/i, /\bgeneralized\s+anxiety\b/i],
    questions: [
      "What screening tools (PHQ-9, GAD-7) should we track over time?",
      "If medication is appropriate, which class fits my profile (SSRI, SNRI, atypical)?",
      "How do we balance medication with therapy (CBT, ACT)?",
      "What side effects from common SSRIs/SNRIs should I watch for in the first 2-4 weeks?",
      "What is the plan if the first medication does not work?",
      "Are there sleep, exercise, or social interventions I should prioritize?",
    ],
  },
];

/**
 * Detect the dominant topic in a reply and return the matching question
 * template, or null if no topic matched.
 */
export function suggestQuestions(replyText) {
  if (typeof replyText !== "string" || !replyText) return null;
  for (const topic of TOPICS) {
    for (const kw of topic.keywords) {
      if (kw.test(replyText)) {
        return { topic: topic.topic, questions: topic.questions };
      }
    }
  }
  return null;
}

export function topicsSummary() {
  return TOPICS.map((t) => ({ topic: t.topic, questionCount: t.questions.length }));
}

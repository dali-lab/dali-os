import type {
  User,
  ApplicationCycle,
  Domain,
  Challenge,
  Application,
  Rubric,
} from './types'

export const currentUser: User = {
  id: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe.26@dartmouth.edu',
  isDaliMember: false,
}

export const adminUser: User = {
  id: 'user-2',
  firstName: 'Tim',
  lastName: 'Admin',
  daliEmail: 'tim@dali.mac',
  isDaliMember: true,
}

export const domains: Domain[] = [
  { id: 'domain-dev', name: 'Software Development' },
  { id: 'domain-des', name: 'UI/UX Design' },
  { id: 'domain-pm', name: 'Product Management' },
]

export const applicationCycles: ApplicationCycle[] = [
  {
    id: 'cycle-1',
    name: 'Fall 2026 Hiring',
    status: 'Open',
    createdAt: '2026-04-01T10:00:00Z',
    closeDate: '2026-04-15T23:59:00Z',
    activeFormVersionId: 'form-v1',
    activeChallengeVersionIds: {
      'domain-dev': 'chal-dev-v1',
      'domain-des': 'chal-des-v1',
    },
    activeGeneralRubricVersionId: 'rubric-gen-v1',
    activeDomainRubricVersionIds: {
      'domain-dev': 'rubric-dev-v1',
      'domain-des': 'rubric-des-v1',
    },
  },
  {
    id: 'cycle-2',
    name: 'Spring 2026 Hiring',
    status: 'Completed',
    createdAt: '2025-11-01T10:00:00Z',
    activeFormVersionId: 'form-v1',
    activeChallengeVersionIds: {
      'domain-dev': 'chal-dev-v1',
    },
    activeGeneralRubricVersionId: 'rubric-gen-v1',
    activeDomainRubricVersionIds: {
      'domain-dev': 'rubric-dev-v1',
    },
  },
  {
    id: 'cycle-3',
    name: 'Winter 2027 Hiring',
    status: 'Draft',
    createdAt: '2026-04-05T10:00:00Z',
  },
  {
    id: 'cycle-interview-invited',
    name: 'Summer 2026 Hiring',
    status: 'UnderReview',
    createdAt: '2026-02-01T10:00:00Z',
    activeFormVersionId: 'form-v1',
    activeChallengeVersionIds: {
      'domain-dev': 'chal-dev-v1',
      'domain-des': 'chal-des-v1',
    },
    activeGeneralRubricVersionId: 'rubric-gen-v1',
    activeDomainRubricVersionIds: {
      'domain-dev': 'rubric-dev-v1',
      'domain-des': 'rubric-des-v1',
    },
  },
  {
    id: 'cycle-offer-accepted',
    name: 'Winter 2025 Hiring',
    status: 'Completed',
    createdAt: '2024-09-01T10:00:00Z',
    activeFormVersionId: 'form-v1',
    activeChallengeVersionIds: {
      'domain-dev': 'chal-dev-v1',
    },
    activeGeneralRubricVersionId: 'rubric-gen-v1',
    activeDomainRubricVersionIds: {
      'domain-dev': 'rubric-dev-v1',
    },
  },
]


export const rubrics: Rubric[] = [
  {
    id: 'rubric-gen',
    name: 'General Core Values Rubric',
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'rubric-gen-v1',
        versionNumber: 1,
        createdAt: '2025-01-15T14:30:00Z',
        createdById: 'user-2',
        criteria: [
          {
            key: 'crit-communication',
            label: 'Communication',
            description: 'Clarity of thought and expression.',
            maxScore: 5,
          },
          {
            key: 'crit-culture',
            label: 'Culture Fit',
            description: 'Alignment with DALI core values.',
            maxScore: 5,
          },
        ],
      },
    ],
  },
  {
    id: 'rubric-dev',
    name: 'Software Development Rubric',
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'rubric-dev-v1',
        domainId: 'domain-dev',
        versionNumber: 1,
        createdAt: '2025-01-20T11:00:00Z',
        createdById: 'user-2',
        criteria: [
          {
            key: 'crit-technical',
            label: 'Technical Skills',
            description: 'Coding ability and technical understanding.',
            maxScore: 5,
          },
          {
            key: 'crit-problem-solving',
            label: 'Problem Solving',
            description: 'Approach to complex technical challenges.',
            maxScore: 5,
          },
        ],
      },
    ],
  },
  {
    id: 'rubric-des',
    name: 'UI/UX Design Rubric',
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'rubric-des-v1',
        domainId: 'domain-des',
        versionNumber: 1,
        createdAt: '2025-01-22T14:30:00Z',
        createdById: 'user-2',
        criteria: [
          {
            key: 'crit-design',
            label: 'Design Sense',
            description: 'Visual design and typography skills.',
            maxScore: 5,
          },
          {
            key: 'crit-ux',
            label: 'User Experience',
            description: 'Understanding of user flows and usability.',
            maxScore: 5,
          },
        ],
      },
    ],
  },
]

export const challenges: Challenge[] = [
  {
    id: 'chal-dev',
    name: 'Social Media Challenge',
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'chal-dev-v1',
        domainId: 'domain-dev',
        versionNumber: 1,
        createdAt: '2025-01-20T11:00:00Z',
        createdById: 'user-2',
        questions: [
          {
            key: 'q-dev-exp',
            type: 'textarea',
            required: true,
            data: { label: 'Describe a technical project you built.' },
          },
          {
            key: 'q-dev-link',
            type: 'text',
            required: false,
            data: { label: 'Link to your GitHub or portfolio.' },
          },
        ],
      },
    ],
  },
  {
    id: 'chal-des',
    name: 'UI/UX Design Challenge',
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'chal-des-v1',
        domainId: 'domain-des',
        versionNumber: 1,
        createdAt: '2025-01-22T14:30:00Z',
        createdById: 'user-2',
        questions: [
          {
            key: 'q-des-portfolio',
            type: 'text',
            required: true,
            data: { label: 'Link to your design portfolio.' },
          },
          {
            key: 'q-des-critique',
            type: 'textarea',
            required: true,
            data: {
              label: 'Critique an app you use daily. What would you improve?',
            },
          },
        ],
      },
    ],
  },
]

export const mockApplications: Application[] = [
  {
    id: 'app-1',
    userId: 'user-1',
    applicationCycleId: 'cycle-1',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Draft',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2026',
      'q-why-dali': 'I love building things that matter.',
    },
    domainApplications: [
      {
        id: 'dapp-1',
        applicationId: 'app-1',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp': 'I built a React Native app for tracking habits.',
          'q-dev-link': 'github.com/janedoe',
        },
      },
    ],
    createdAt: '2026-04-05T14:30:00Z',
    updatedAt: '2026-04-06T09:15:00Z',
  },
  {
    id: 'app-2',
    userId: 'user-3',
    applicationCycleId: 'cycle-1',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Cognitive Science',
      'q-grad-year': '2027',
      'q-why-dali': 'I want to learn from the best.',
    },
    domainApplications: [
      {
        id: 'dapp-2',
        applicationId: 'app-2',
        challengeVersionId: 'chal-des-v1',
        answers: {
          'q-des-portfolio': 'dribbble.com/user3',
          'q-des-critique': 'Spotify is great but the podcast UI is cluttered.',
        },
      },
    ],
    createdAt: '2026-04-02T11:00:00Z',
    updatedAt: '2026-04-04T16:20:00Z',
  },
  {
    id: '1',
    userId: 'user-4',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Engineering Sciences',
      'q-grad-year': '2027',
      'q-why-dali':
        'I want to combine my engineering background with product development and build tools that help real people.',
    },
    domainApplications: [
      {
        id: 'dapp-mentor-1',
        applicationId: 'app-mentor-review-1',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp':
            'Built a full-stack inventory management system for a local nonprofit using Node.js and React.',
          'q-dev-link': 'github.com/user4dev',
        },
      },
    ],
    createdAt: '2026-02-10T14:30:00Z',
    updatedAt: '2026-03-10T10:00:00Z',
  },
  {
    id: '2',
    userId: 'user-5',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Mathematics',
      'q-grad-year': '2028',
      'q-why-dali':
        'I love the intersection of data and design. DALI seems like the perfect place to explore that.',
    },
    domainApplications: [
      {
        id: 'dapp-mentor-2',
        applicationId: 'app-mentor-review-2',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp':
            'Created a data visualization dashboard for Dartmouth dining hall traffic patterns.',
          'q-dev-link': 'github.com/user5viz',
        },
      },
    ],
    createdAt: '2026-02-12T09:00:00Z',
    updatedAt: '2026-02-12T09:00:00Z',
  },
  {
    id: 'app-mentor-review-3',
    userId: 'user-6',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Digital Arts',
      'q-grad-year': '2027',
      'q-why-dali':
        'I want to push the boundaries of creative technology and collaborate with diverse teams.',
    },
    domainApplications: [
      {
        id: 'dapp-mentor-3',
        applicationId: 'app-mentor-review-3',
        challengeVersionId: 'chal-des-v1',
        answers: {
          'q-des-portfolio': 'behance.net/user6art',
          'q-des-critique':
            'Instagram Reels UI is confusing — the navigation between stories and reels should be more distinct.',
        },
      },
    ],
    createdAt: '2026-02-08T11:00:00Z',
    updatedAt: '2026-03-08T14:00:00Z',
  },
  {
    id: 'app-cycle-inv-scheduled',
    userId: 'user-8',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2027',
      'q-why-dali':
        'I have been building side projects for years and want to work on something with real users.',
    },
    domainApplications: [
      {
        id: 'dapp-inv-sched',
        applicationId: 'app-cycle-inv-scheduled',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp':
            'Built a campus event discovery app with 500+ active users using React Native and Firebase.',
          'q-dev-link': 'github.com/user8apps',
        },
      },
    ],
    createdAt: '2026-02-06T10:00:00Z',
    updatedAt: '2026-03-15T09:00:00Z',
  },
  {
    id: 'app-cycle-inv-completed-1',
    userId: 'user-9',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Economics',
      'q-grad-year': '2027',
      'q-why-dali':
        'I want to bring a product management perspective and help teams ship features that users actually need.',
    },
    domainApplications: [
      {
        id: 'dapp-inv-comp-1',
        applicationId: 'app-cycle-inv-completed-1',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp':
            'Led a team of 4 to build a budgeting app for college students. Managed sprints and user research.',
          'q-dev-link': 'github.com/user9pm',
        },
      },
    ],
    createdAt: '2026-02-07T14:00:00Z',
    updatedAt: '2026-03-22T09:00:00Z',
  },
  {
    id: 'app-cycle-inv-completed-2',
    userId: 'user-10',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Neuroscience',
      'q-grad-year': '2028',
      'q-why-dali':
        'I am fascinated by how people interact with technology and want to design better experiences.',
    },
    domainApplications: [
      {
        id: 'dapp-inv-comp-2',
        applicationId: 'app-cycle-inv-completed-2',
        challengeVersionId: 'chal-des-v1',
        answers: {
          'q-des-portfolio': 'figma.com/@user10neuro',
          'q-des-critique':
            'The Apple Health app has great data but poor information hierarchy — key insights are buried.',
        },
      },
    ],
    createdAt: '2026-02-09T16:00:00Z',
    updatedAt: '2026-03-22T11:00:00Z',
  },
  {
    id: 'app-withdrawn',
    userId: 'user-1',
    applicationCycleId: 'cycle-2',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Withdrawn',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2026',
      'q-why-dali': 'I want to learn.',
    },
    domainApplications: [
      {
        id: 'dapp-withdrawn',
        applicationId: 'app-withdrawn',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp': 'Some basic HTML.',
          'q-dev-link': '',
        },
      },
    ],
    createdAt: '2025-11-05T14:30:00Z',
    updatedAt: '2025-11-20T09:15:00Z',
  },
  {
    id: 'app-interview-invited',
    userId: 'user-1',
    applicationCycleId: 'cycle-interview-invited',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2026',
      'q-why-dali': 'I love building things that matter.',
    },
    domainApplications: [
      {
        id: 'dapp-interview-invited',
        applicationId: 'app-interview-invited',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp': 'I built a React Native app for tracking habits.',
          'q-dev-link': 'github.com/janedoe',
        },
      },
    ],
    createdAt: '2026-02-05T14:30:00Z',
    updatedAt: '2026-03-01T09:15:00Z',
  },
  {
    id: 'app-offer-accepted',
    userId: 'user-1',
    applicationCycleId: 'cycle-offer-accepted',
    generalChallengeVersionId: 'cv-general-v1',
    status: 'Submitted',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2026',
      'q-why-dali': 'I love building things that matter.',
    },
    domainApplications: [
      {
        id: 'dapp-offer-accepted',
        applicationId: 'app-offer-accepted',
        challengeVersionId: 'chal-dev-v1',
        answers: {
          'q-dev-exp': 'I built a React Native app for tracking habits.',
          'q-dev-link': 'github.com/janedoe',
        },
      },
    ],
    createdAt: '2024-09-05T14:30:00Z',
    updatedAt: '2024-10-20T09:15:00Z',
  },
]

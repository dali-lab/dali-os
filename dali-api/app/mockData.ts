import type {
  User,
  ApplicationCycle,
  Domain,
  ApplicationForm,
  Challenge,
  Application,
  Rubric,
} from './types'

export const currentUser: User = {
  id: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  dartmouthEmail: 'jane.doe.26@dartmouth.edu',
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
    status: 'DecisionsReleased',
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
    status: 'DecisionsReleased',
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

export const applicationForms: ApplicationForm[] = [
  {
    id: '1',
    name: 'General Application',
    type: 'General' as const,
    createdAt: '2025-01-01T10:00:00Z',
    versions: [
      {
        id: 'form-v1',
        versionNumber: 1,
        createdAt: '2025-01-15T14:30:00Z',
        createdById: 'user-2',
        questions: [
          {
            key: 'q-major',
            type: 'text',
            required: true,
            data: { label: 'What is your major?' },
          },
          {
            key: 'q-grad-year',
            type: 'select',
            required: true,
            data: {
              label: 'Graduation Year',
              options: ['2026', '2027', '2028', '2029'],
            },
          },
          {
            key: 'q-why-dali',
            type: 'textarea',
            required: true,
            data: {
              label: 'Why do you want to join DALI?',
              description: 'Keep it under 200 words.',
            },
          },
        ],
      },
      {
        id: 'form-v2',
        versionNumber: 2,
        createdAt: '2026-01-10T09:15:00Z',
        createdById: 'user-2',
        questions: [
          {
            key: 'q-major',
            type: 'text',
            required: true,
            data: { label: 'What is your major?' },
          },
          {
            key: 'q-grad-year',
            type: 'select',
            required: true,
            data: {
              label: 'Graduation Year',
              options: ['2026', '2027', '2028', '2029'],
            },
          },
          {
            key: 'q-why-dali',
            type: 'textarea',
            required: true,
            data: {
              label: 'Why do you want to join DALI?',
              description: 'Keep it under 200 words.',
            },
          },
          {
            key: 'q-fun-fact',
            type: 'text',
            required: false,
            data: { label: 'Tell us a fun fact about yourself.' },
          },
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'Short Application',
    type: 'General' as const,
    createdAt: '2026-03-01T10:00:00Z',
    versions: [
      {
        id: 'form-short-v1',
        versionNumber: 1,
        createdAt: '2026-03-05T16:45:00Z',
        createdById: 'user-2',
        questions: [
          {
            key: 'q-name',
            type: 'text',
            required: true,
            data: { label: 'Full Name' },
          },
          {
            key: 'q-portfolio',
            type: 'text',
            required: true,
            data: { label: 'Portfolio Link' },
          },
        ],
      },
    ],
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
  // User-1: Draft application in open cycle (continue/edit until deadline)
  {
    id: 'app-1',
    userId: 'user-1',
    applicationCycleId: 'cycle-1',
    applicationFormVersionId: 'form-v1',
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
  // User-3: Submitted app (for mentor/domain lead views)
  {
    id: 'app-2',
    userId: 'user-3',
    applicationCycleId: 'cycle-1',
    applicationFormVersionId: 'form-v1',
    status: 'Submitted',
    assignedMentorId: 'user-2',
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
  // Mentor review apps (for mentor/domain lead views)
  {
    id: '1',
    userId: 'user-4',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'Submitted',
    assignedMentorId: 'user-2',
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
    mentorReviews: [
      {
        id: 'rev-m1',
        applicationId: 'app-mentor-review-1',
        mentorId: 'user-2',
        scores: { technical: 4, design: 3, communication: 5, culture: 4 },
        feedback:
          'Strong communicator with solid technical skills. Portfolio shows real-world impact.',
        overallRecommendation: 'Hire',
        createdAt: '2026-03-10T10:00:00Z',
        updatedAt: '2026-03-10T10:00:00Z',
      },
    ],
    createdAt: '2026-02-10T14:30:00Z',
    updatedAt: '2026-03-10T10:00:00Z',
  },
  {
    id: '2',
    userId: 'user-5',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'Submitted',
    assignedMentorId: 'user-2',
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
    applicationFormVersionId: 'form-v1',
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
    mentorReviews: [
      {
        id: 'rev-m3',
        applicationId: 'app-mentor-review-3',
        mentorId: 'user-7',
        scores: { technical: 2, design: 5, communication: 4, culture: 5 },
        feedback:
          'Exceptional design eye. Technical skills are developing but the creative vision is outstanding.',
        overallRecommendation: 'Lean Hire',
        createdAt: '2026-03-08T14:00:00Z',
        updatedAt: '2026-03-08T14:00:00Z',
      },
    ],
    createdAt: '2026-02-08T11:00:00Z',
    updatedAt: '2026-03-08T14:00:00Z',
  },
  {
    id: 'app-cycle-inv-scheduled',
    userId: 'user-8',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'InterviewScheduled',
    assignedMentorId: 'user-2',
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
    interview: {
      id: 'int-inv-sched',
      applicationId: 'app-cycle-inv-scheduled',
      status: 'Scheduled',
      scheduledSlotId: 'slot-inv-1',
      location: 'DALI Lab (Sudikoff 123)',
      notes: 'Very promising candidate — strong React Native experience.',
      availableSlots: [
        {
          id: 'slot-inv-1',
          startTime: '2026-04-14T14:00:00Z',
          endTime: '2026-04-14T14:30:00Z',
        },
        {
          id: 'slot-inv-2',
          startTime: '2026-04-14T15:00:00Z',
          endTime: '2026-04-14T15:30:00Z',
        },
      ],
    },
    mentorReviews: [
      {
        id: 'rev-m4',
        applicationId: 'app-cycle-inv-scheduled',
        mentorId: 'user-2',
        scores: { technical: 5, design: 3, communication: 4, culture: 5 },
        feedback:
          'Excellent technical depth. Real production experience with users. Strong culture fit.',
        overallRecommendation: 'Strong Hire',
        createdAt: '2026-03-05T10:00:00Z',
        updatedAt: '2026-03-05T10:00:00Z',
      },
    ],
    createdAt: '2026-02-06T10:00:00Z',
    updatedAt: '2026-03-15T09:00:00Z',
  },
  {
    id: 'app-cycle-inv-completed-1',
    userId: 'user-9',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'InterviewCompleted',
    assignedMentorId: 'user-2',
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
    interview: {
      id: 'int-inv-comp-1',
      applicationId: 'app-cycle-inv-completed-1',
      status: 'Completed',
      scheduledSlotId: 'slot-comp-1',
      notes:
        'Great product thinking. Needs more technical depth but strong leadership.',
      availableSlots: [
        {
          id: 'slot-comp-1',
          startTime: '2026-03-20T10:00:00Z',
          endTime: '2026-03-20T10:30:00Z',
        },
      ],
    },
    mentorReviews: [
      {
        id: 'rev-m5',
        applicationId: 'app-cycle-inv-completed-1',
        mentorId: 'user-2',
        scores: { technical: 3, design: 3, communication: 5, culture: 5 },
        feedback:
          'Outstanding communicator and leader. Technical skills are adequate for PM track.',
        overallRecommendation: 'Hire',
        createdAt: '2026-03-12T10:00:00Z',
        updatedAt: '2026-03-12T10:00:00Z',
      },
    ],
    createdAt: '2026-02-07T14:00:00Z',
    updatedAt: '2026-03-22T09:00:00Z',
  },
  {
    id: 'app-cycle-inv-completed-2',
    userId: 'user-10',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'InterviewCompleted',
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
    interview: {
      id: 'int-inv-comp-2',
      applicationId: 'app-cycle-inv-completed-2',
      status: 'Completed',
      scheduledSlotId: 'slot-comp-2',
      notes:
        'Unique perspective from neuroscience. Design portfolio is impressive for a sophomore.',
      availableSlots: [
        {
          id: 'slot-comp-2',
          startTime: '2026-03-21T14:00:00Z',
          endTime: '2026-03-21T14:30:00Z',
        },
      ],
    },
    mentorReviews: [
      {
        id: 'rev-m6',
        applicationId: 'app-cycle-inv-completed-2',
        mentorId: 'user-7',
        scores: { technical: 3, design: 4, communication: 4, culture: 4 },
        feedback:
          'Interesting cross-disciplinary background. Design work shows strong user empathy.',
        overallRecommendation: 'Lean Hire',
        createdAt: '2026-03-14T10:00:00Z',
        updatedAt: '2026-03-14T10:00:00Z',
      },
    ],
    createdAt: '2026-02-09T16:00:00Z',
    updatedAt: '2026-03-22T11:00:00Z',
  },
  // User-1: Rejected application (past)
  {
    id: 'app-rejected',
    userId: 'user-1',
    applicationCycleId: 'cycle-2',
    applicationFormVersionId: 'form-v1',
    status: 'Rejected',
    answers: {
      'q-major': 'Computer Science',
      'q-grad-year': '2026',
      'q-why-dali': 'I want to learn.',
    },
    domainApplications: [
      {
        id: 'dapp-rejected',
        applicationId: 'app-rejected',
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
  // User-1: Interview invited (needs to schedule)
  {
    id: 'app-interview-invited',
    userId: 'user-1',
    applicationCycleId: 'cycle-interview-invited',
    applicationFormVersionId: 'form-v1',
    status: 'InterviewInvited',
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
    interview: {
      id: 'int-1',
      applicationId: 'app-interview-invited',
      status: 'Pending',
      availableSlots: [
        {
          id: 'slot-1',
          startTime: '2026-04-10T14:00:00Z',
          endTime: '2026-04-10T14:30:00Z',
        },
        {
          id: 'slot-2',
          startTime: '2026-04-10T14:30:00Z',
          endTime: '2026-04-10T15:00:00Z',
        },
        {
          id: 'slot-3',
          startTime: '2026-04-11T10:00:00Z',
          endTime: '2026-04-11T10:30:00Z',
        },
        {
          id: 'slot-4',
          startTime: '2026-04-11T10:30:00Z',
          endTime: '2026-04-11T11:00:00Z',
        },
      ],
    },
    createdAt: '2026-02-05T14:30:00Z',
    updatedAt: '2026-03-01T09:15:00Z',
  },
  // User-1: Offer accepted (past)
  {
    id: 'app-offer-accepted',
    userId: 'user-1',
    applicationCycleId: 'cycle-offer-accepted',
    applicationFormVersionId: 'form-v1',
    status: 'OfferAccepted',
    offerResponse: 'Accepted',
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
    interview: {
      id: 'int-5',
      applicationId: 'app-offer-accepted',
      status: 'Completed',
      scheduledSlotId: 'slot-1',
      availableSlots: [
        {
          id: 'slot-1',
          startTime: '2024-10-10T14:00:00Z',
          endTime: '2024-10-10T14:30:00Z',
        },
      ],
    },
    createdAt: '2024-09-05T14:30:00Z',
    updatedAt: '2024-10-20T09:15:00Z',
  },
]

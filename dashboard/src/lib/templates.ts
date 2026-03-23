export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  steps: Array<{
    agentId: string;
    enabled: boolean;
    iterations?: number;
    selfReview?: boolean;
    skipGitTracking?: boolean;
  }>;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'template-standard-dev',
    name: 'Standard Development',
    category: 'Development',
    description: 'Plan, implement, refine, and review. The default software development workflow.',
    steps: [
      { agentId: 'architect', enabled: true },
      { agentId: 'coder', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 2 },
      { agentId: 'reviewer', enabled: true },
    ],
  },
  {
    id: 'template-quick-code',
    name: 'Quick Code',
    category: 'Development',
    description: 'Implement and review. Best for small, well-defined tasks.',
    steps: [
      { agentId: 'coder', enabled: true },
      { agentId: 'reviewer', enabled: true },
    ],
  },
  {
    id: 'template-deep-review',
    name: 'Deep Review',
    category: 'Development',
    description: 'Thorough planning, implementation, and heavy refinement for critical work.',
    steps: [
      { agentId: 'architect', enabled: true },
      { agentId: 'coder', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 5 },
      { agentId: 'reviewer', enabled: true },
    ],
  },

  {
    id: 'template-content-pipeline',
    name: 'Content Pipeline',
    category: 'Content & Writing',
    description: 'Research a topic, draft content, refine through iterations, then validate quality.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 3 },
      { agentId: 'validator', enabled: true },
    ],
  },
  {
    id: 'template-blog-writer',
    name: 'Blog Post Writer',
    category: 'Content & Writing',
    description: 'Plan structure, write a full draft, iterate on quality, then do a final editorial pass.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 2 },
      { agentId: 'reviewer', enabled: true },
    ],
  },
  {
    id: 'template-newsletter',
    name: 'Newsletter Generator',
    category: 'Content & Writing',
    description: 'Gather recent highlights, compose a newsletter draft, and review for tone and accuracy.',
    steps: [
      { agentId: 'aggregator', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'reviewer', enabled: true },
    ],
  },

  {
    id: 'template-research-summarise',
    name: 'Research & Summarise',
    category: 'Research & Analysis',
    description: 'Gather information from multiple sources, synthesise findings, and produce a validated report.',
    steps: [
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
      { agentId: 'reviewer', enabled: true },
    ],
  },
  {
    id: 'template-competitive-intel',
    name: 'Competitive Intelligence',
    category: 'Research & Analysis',
    description: 'Research competitors, analyse their positioning, and produce a comparative brief.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
      { agentId: 'validator', enabled: true },
    ],
  },
  {
    id: 'template-market-scan',
    name: 'Market Scan',
    category: 'Research & Analysis',
    description: 'Scan for market trends, aggregate findings, and produce an executive-ready report.',
    steps: [
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 2 },
      { agentId: 'reviewer', enabled: true },
    ],
  },

  {
    id: 'template-data-processing',
    name: 'Data Processing',
    category: 'Data & ETL',
    description: 'Plan the extraction, execute the transformation, validate the output.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'validator', enabled: true, iterations: 2 },
    ],
  },
  {
    id: 'template-data-cleanup',
    name: 'Data Cleanup',
    category: 'Data & ETL',
    description: 'Analyse messy data, clean and normalise it, then validate quality.',
    steps: [
      { agentId: 'executor', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 2 },
      { agentId: 'validator', enabled: true },
    ],
  },

  {
    id: 'template-classify-route',
    name: 'Classify & Route',
    category: 'Operations',
    description: 'Analyse incoming items, route them to the right handler, then validate the outcome.',
    steps: [
      { agentId: 'router', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'validator', enabled: true },
    ],
  },
  {
    id: 'template-multi-step-automation',
    name: 'Multi-Step Automation',
    category: 'Operations',
    description: 'Decompose a complex objective, execute each step, aggregate results, and validate.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'router', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
      { agentId: 'validator', enabled: true },
    ],
  },
  {
    id: 'template-inbox-processor',
    name: 'Inbox Processor',
    category: 'Operations',
    description: 'Classify incoming messages or files, extract action items, and produce a structured summary.',
    steps: [
      { agentId: 'router', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
    ],
  },

  {
    id: 'template-quality-review',
    name: 'Quality Review',
    category: 'General',
    description: 'Run multiple review iterations on existing work without making changes.',
    steps: [
      { agentId: 'raven', enabled: true, iterations: 3 },
      { agentId: 'reviewer', enabled: true },
    ],
  },
  {
    id: 'template-plan-only',
    name: 'Plan Only',
    category: 'General',
    description: 'Analyse and plan an objective without executing. Good for scoping work.',
    steps: [
      { agentId: 'architect', enabled: true },
    ],
  },
  {
    id: 'template-brainstorm',
    name: 'Brainstorm & Validate',
    category: 'General',
    description: 'Generate ideas, explore variations, and validate the best options.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 3 },
      { agentId: 'validator', enabled: true },
    ],
  },
];

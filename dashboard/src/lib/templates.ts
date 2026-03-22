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
    id: 'template-content-pipeline',
    name: 'Content Pipeline',
    category: 'Content',
    description: 'Plan content, generate a draft, refine through iterations, then validate quality.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'raven', enabled: true, iterations: 3 },
      { agentId: 'validator', enabled: true },
    ],
  },
  {
    id: 'template-research-summarise',
    name: 'Research & Summarise',
    category: 'Research',
    description: 'Gather information, process it, and produce a validated summary.',
    steps: [
      { agentId: 'executor', enabled: true },
      { agentId: 'aggregator', enabled: true },
      { agentId: 'reviewer', enabled: true },
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
    id: 'template-data-processing',
    name: 'Data Processing',
    category: 'Data',
    description: 'Plan the extraction, execute the transformation, validate the output.',
    steps: [
      { agentId: 'planner', enabled: true },
      { agentId: 'executor', enabled: true },
      { agentId: 'validator', enabled: true, iterations: 2 },
    ],
  },
  {
    id: 'template-review-only',
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
];

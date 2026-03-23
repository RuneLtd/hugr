
import type { TriggerTemplate, TriggerConfig } from './types.js';

const templates: TriggerTemplate[] = [

    {
        id: 'social-media-content',
        name: 'Social Media → Content Pipeline',
        description: 'When a webhook fires from a social media post (via Zapier, IFTTT, or X API), generate expanded content like blog posts, threads, or newsletters.',
        category: 'content',
        trigger: {
            type: 'webhook',
            task: 'A new social media post was published: "{{text}}"\n\nAuthor: {{author}}\nPlatform: {{platform}}\nURL: {{url}}\n\nExpand this into a well-structured blog post. Maintain the original voice and perspective but add depth, examples, and actionable insights.',
            webhook: {
                path: '/on-social-post',
                method: 'POST',
                transform: {
                    text: 'text',
                    author: 'user.name',
                    platform: 'source',
                    url: 'url',
                },
            },
            maxConcurrent: 1,
            cooldown: 300,
            tags: ['content', 'social-media'],
        },
        pipeline: {
            name: 'Content Expansion',
            description: 'Research, draft, and refine content from social media posts',
            steps: [
                {
                    agentId: 'researcher',
                    agentConfig: {
                        name: 'Researcher',
                        instructions: 'Research the topic mentioned in the social media post. Find supporting data, related articles, and expert perspectives. Output a research brief with key findings, statistics, and quotes that can strengthen the content.',
                        toolAccess: 'read-only',
                        allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                    },
                    enabled: true,
                },
                {
                    agentId: 'writer',
                    agentConfig: {
                        name: 'Writer',
                        instructions: 'Using the research brief, write an expanded blog post based on the original social media post. Include an engaging introduction, clear sections with headers, supporting evidence, and a strong conclusion. Aim for 800-1200 words. Write in a conversational but authoritative tone.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
                {
                    agentId: 'editor',
                    agentConfig: {
                        name: 'Editor',
                        instructions: 'Review the draft blog post for clarity, flow, grammar, and engagement. Check that claims are supported, transitions are smooth, and the piece has a clear narrative arc. Make direct edits to improve quality.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'text', description: 'The social media post text', required: true },
            { name: 'author', description: 'Author name', required: false, default: 'Unknown' },
            { name: 'platform', description: 'Source platform (twitter, linkedin, etc.)', required: false, default: 'social' },
            { name: 'url', description: 'Link to the original post', required: false },
        ],
    },

    {
        id: 'daily-digest',
        name: 'Daily Digest Report',
        description: 'Generate a daily summary report every morning — great for news digests, project updates, or market briefings.',
        category: 'research',
        trigger: {
            type: 'cron',
            cron: '0 8 * * 1-5',
            task: 'Generate a daily digest report for {{date}}. Scan the project directory for recent changes, open issues, and pending tasks. Produce a concise morning briefing with:\n\n1. Key updates since yesterday\n2. Items requiring attention\n3. Upcoming deadlines\n4. Quick wins available today',
            maxConcurrent: 1,
            tags: ['report', 'daily'],
        },
        pipeline: {
            name: 'Daily Digest',
            description: 'Gather information and produce a morning briefing',
            steps: [
                {
                    agentId: 'gatherer',
                    agentConfig: {
                        name: 'Information Gatherer',
                        instructions: 'Scan the project for recent activity: git commits in the last 24 hours, modified files, open TODO items, and any error logs. Compile a structured data brief.',
                        toolAccess: 'read-only',
                    },
                    enabled: true,
                },
                {
                    agentId: 'analyst',
                    agentConfig: {
                        name: 'Digest Writer',
                        instructions: 'Take the gathered information and produce a clear, scannable daily digest. Use sections with priorities (urgent, important, informational). Keep it under 500 words. Save as a markdown file named daily-digest-{date}.md.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'date', description: 'Date for the digest (auto-filled)', required: false, default: 'today' },
        ],
    },

    {
        id: 'rss-monitor',
        name: 'RSS Feed Monitor',
        description: 'Watch an RSS feed and trigger a pipeline when new articles appear. Use for competitive intelligence, news monitoring, or content curation.',
        category: 'monitoring',
        trigger: {
            type: 'poll',
            task: 'New article detected from RSS feed:\n\nTitle: {{item.title}}\nLink: {{item.link}}\nDescription: {{item.description}}\n\nAnalyze this article and produce a brief summary with key takeaways, relevance assessment, and any action items.',
            poll: {
                url: 'https://example.com/feed.xml',
                interval: 600,
                jq: 'items',
                dedup: true,
                dedupKey: 'link',
            },
            cooldown: 60,
            tags: ['monitoring', 'rss'],
        },
        pipeline: {
            name: 'Article Analysis',
            description: 'Analyze new articles from monitored feeds',
            steps: [
                {
                    agentId: 'analyzer',
                    agentConfig: {
                        name: 'Article Analyzer',
                        instructions: 'Read the linked article and produce a structured analysis: summary (3-5 sentences), key takeaways (bullet points), relevance score (1-10), and recommended actions. Save the analysis to a file.',
                        toolAccess: 'full',
                        allowedTools: ['Read', 'Write', 'WebFetch', 'WebSearch', 'Glob'],
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'item.title', description: 'Article title', required: true },
            { name: 'item.link', description: 'Article URL', required: true },
        ],
    },

    {
        id: 'file-processor',
        name: 'Folder Watcher → File Processor',
        description: 'Watch a folder for new files and automatically process them. Great for invoice processing, document conversion, data import, or media handling.',
        category: 'data',
        trigger: {
            type: 'watch',
            task: 'New file(s) detected in the watched folder:\n\n{{files}}\n\nProcess each file according to its type:\n- Documents (.pdf, .docx): Extract text and create a summary\n- Data files (.csv, .json, .xlsx): Validate structure and generate a data quality report\n- Images: Describe contents and add to the media catalog\n- Other: Log the file details for manual review',
            watch: {
                path: './inbox',
                pattern: '**/*',
                events: ['create'],
                debounce: 2000,
            },
            cooldown: 10,
            tags: ['files', 'automation'],
        },
        pipeline: {
            name: 'File Processing',
            description: 'Analyze and process incoming files',
            steps: [
                {
                    agentId: 'processor',
                    agentConfig: {
                        name: 'File Processor',
                        instructions: 'For each new file: determine the file type, extract relevant content, validate data quality if applicable, and produce a processing report. Move processed files to a ./processed folder and save reports to ./reports.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'files', description: 'List of new files detected', required: true },
        ],
    },

    {
        id: 'pr-review',
        name: 'GitHub PR → Code Review',
        description: 'Automatically review pull requests when GitHub sends a webhook. Runs architecture review, code quality checks, and produces a detailed review comment.',
        category: 'devops',
        trigger: {
            type: 'webhook',
            task: 'A new pull request needs review:\n\nTitle: {{pull_request.title}}\nAuthor: {{pull_request.user.login}}\nBranch: {{pull_request.head.ref}} → {{pull_request.base.ref}}\nDescription: {{pull_request.body}}\nDiff URL: {{pull_request.diff_url}}\n\nPerform a thorough code review covering architecture, correctness, performance, security, and maintainability.',
            webhook: {
                path: '/github/pr',
                secret: '',
                method: 'POST',
                transform: {
                    title: 'pull_request.title',
                    author: 'pull_request.user.login',
                    branch: 'pull_request.head.ref',
                },
            },
            maxConcurrent: 2,
            tags: ['code-review', 'github'],
        },
        pipeline: {
            name: 'PR Review',
            description: 'Multi-agent pull request review',
            steps: [
                {
                    agentId: 'architect',
                    enabled: true,
                },
                {
                    agentId: 'reviewer',
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'pull_request.title', description: 'PR title', required: true },
            { name: 'pull_request.body', description: 'PR description', required: false },
        ],
    },

    {
        id: 'website-monitor',
        name: 'Website Change Monitor',
        description: 'Periodically check a website for changes and trigger an analysis when content updates. Useful for competitor monitoring, pricing changes, or content tracking.',
        category: 'monitoring',
        trigger: {
            type: 'poll',
            task: 'The monitored website has changed:\n\nURL: {{sourceUrl}}\nDetected at: {{timestamp}}\n\nFetch the current page content, compare with the previous version if available, and produce a change report highlighting what was added, removed, or modified.',
            poll: {
                url: 'https://example.com/page-to-monitor',
                interval: 3600,
                dedup: false,
            },
            maxConcurrent: 1,
            cooldown: 1800,
            tags: ['monitoring', 'website'],
        },
        pipeline: {
            name: 'Change Analysis',
            description: 'Detect and analyze website changes',
            steps: [
                {
                    agentId: 'monitor',
                    agentConfig: {
                        name: 'Change Analyst',
                        instructions: 'Fetch the current version of the monitored page. Compare with the previous snapshot (stored in ./snapshots/). Identify meaningful changes (ignore timestamps, session tokens, etc.). Produce a change report and update the snapshot.',
                        toolAccess: 'full',
                        allowedTools: ['Read', 'Write', 'WebFetch', 'Bash', 'Glob', 'Grep'],
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'sourceUrl', description: 'URL being monitored', required: true },
        ],
    },

    {
        id: 'weekly-report',
        name: 'Weekly Status Report',
        description: 'Generate a comprehensive weekly report every Friday afternoon. Aggregates activity, metrics, and insights from the past week.',
        category: 'research',
        trigger: {
            type: 'cron',
            cron: '0 16 * * 5',
            task: 'Generate the weekly status report for the week ending {{date}}.\n\nGather all activity from the past 7 days including:\n- Commits and code changes\n- Files created or modified\n- Key decisions and milestones\n- Issues resolved and new issues opened\n\nProduce a professional weekly report with an executive summary, detailed sections, metrics, and next week\'s priorities.',
            maxConcurrent: 1,
            tags: ['report', 'weekly'],
        },
        pipeline: {
            name: 'Weekly Report',
            description: 'Comprehensive weekly status report generation',
            steps: [
                {
                    agentId: 'gatherer',
                    agentConfig: {
                        name: 'Data Gatherer',
                        instructions: 'Collect all activity data from the past 7 days: git log, file changes, TODO items completed, and any structured data in the project. Output a comprehensive data brief.',
                        toolAccess: 'read-only',
                    },
                    enabled: true,
                },
                {
                    agentId: 'writer',
                    agentConfig: {
                        name: 'Report Writer',
                        instructions: 'Write a professional weekly report from the gathered data. Include: executive summary (3-4 sentences), key accomplishments, metrics and trends, challenges encountered, and next week priorities. Format as a polished markdown document saved as weekly-report-{date}.md.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'date', description: 'Report date (auto-filled)', required: false, default: 'today' },
        ],
    },

    {
        id: 'email-to-task',
        name: 'Email/Message → Task Pipeline',
        description: 'Process incoming messages (via webhook from email service, Slack, or messaging API) and convert them into structured tasks with action items.',
        category: 'communication',
        trigger: {
            type: 'webhook',
            task: 'New message received:\n\nFrom: {{from}}\nSubject: {{subject}}\nBody: {{body}}\n\nAnalyze this message and:\n1. Extract any action items or requests\n2. Determine priority and urgency\n3. Create structured task entries\n4. Draft a brief acknowledgment response',
            webhook: {
                path: '/on-message',
                method: 'POST',
                transform: {
                    from: 'sender',
                    subject: 'subject',
                    body: 'body',
                },
            },
            cooldown: 30,
            tags: ['email', 'tasks', 'communication'],
        },
        pipeline: {
            name: 'Message Processing',
            description: 'Extract tasks and actions from incoming messages',
            steps: [
                {
                    agentId: 'processor',
                    agentConfig: {
                        name: 'Message Processor',
                        instructions: 'Analyze the incoming message. Extract all action items, deadlines, and requests. Categorize by priority (high/medium/low) and type (task/question/info/request). Create a structured output with tasks and a draft response. Save to tasks/ directory.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'from', description: 'Sender', required: true },
            { name: 'subject', description: 'Message subject', required: false },
            { name: 'body', description: 'Message body', required: true },
        ],
    },

    {
        id: 'data-pipeline',
        name: 'Scheduled Data Pipeline',
        description: 'Run a data processing pipeline on a schedule — great for ETL jobs, data cleanup, report generation from databases, or analytics aggregation.',
        category: 'data',
        trigger: {
            type: 'cron',
            cron: '0 2 * * *',
            task: 'Run the nightly data pipeline:\n\n1. Check for new data files in the input directory\n2. Validate data quality and schema compliance\n3. Transform and clean the data\n4. Generate summary statistics\n5. Archive processed files\n\nProduce a pipeline run report with row counts, error rates, and any anomalies detected.',
            maxConcurrent: 1,
            tags: ['data', 'etl', 'scheduled'],
        },
        pipeline: {
            name: 'Data Pipeline',
            description: 'Nightly data processing and validation',
            steps: [
                {
                    agentId: 'validator',
                    agentConfig: {
                        name: 'Data Validator',
                        instructions: 'Scan the input directory for new data files. For each file: validate the schema, check for missing values, detect outliers, and verify data types. Output a validation report listing any issues found.',
                        toolAccess: 'read-only',
                    },
                    enabled: true,
                },
                {
                    agentId: 'transformer',
                    agentConfig: {
                        name: 'Data Transformer',
                        instructions: 'Process validated data files: apply cleaning rules, normalize formats, merge related records, and compute derived fields. Save transformed data to the output directory. Archive originals.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [],
    },

    {
        id: 'deployment-gate',
        name: 'CI/CD Deployment Gate',
        description: 'Receive webhooks from your CI/CD pipeline and run validation checks before allowing deployment. Acts as an AI-powered quality gate.',
        category: 'devops',
        trigger: {
            type: 'webhook',
            task: 'Deployment request received:\n\nService: {{repository.name}}\nBranch: {{ref}}\nCommit: {{head_commit.message}}\nAuthor: {{head_commit.author.name}}\n\nRun pre-deployment validation:\n1. Review the changes in the latest commits\n2. Check for potential breaking changes\n3. Verify test coverage and documentation\n4. Assess deployment risk (low/medium/high)\n5. Produce a go/no-go recommendation',
            webhook: {
                path: '/deploy/gate',
                method: 'POST',
            },
            maxConcurrent: 3,
            tags: ['devops', 'deployment', 'ci-cd'],
        },
        pipeline: {
            name: 'Deployment Gate',
            description: 'AI-powered deployment validation',
            steps: [
                {
                    agentId: 'architect',
                    enabled: true,
                },
                {
                    agentId: 'reviewer',
                    enabled: true,
                },
            ],
        },
        variables: [
            { name: 'repository.name', description: 'Repository name', required: true },
            { name: 'ref', description: 'Git ref being deployed', required: true },
        ],
    },

    {
        id: 'content-calendar',
        name: 'Content Calendar Generator',
        description: 'Weekly content planning pipeline that generates ideas, outlines, and drafts based on trending topics and your content strategy.',
        category: 'content',
        trigger: {
            type: 'cron',
            cron: '0 9 * * 1',
            task: 'Generate this week\'s content calendar.\n\nResearch current trends and topics relevant to the project. Create a content plan with:\n- 3 blog post ideas with outlines\n- 5 social media post drafts\n- 1 newsletter topic with key points\n\nConsider the target audience, recent industry developments, and our content pillars. Save the content calendar as a structured markdown file.',
            maxConcurrent: 1,
            tags: ['content', 'planning', 'weekly'],
        },
        pipeline: {
            name: 'Content Planning',
            description: 'Research-driven content calendar generation',
            steps: [
                {
                    agentId: 'researcher',
                    agentConfig: {
                        name: 'Trend Researcher',
                        instructions: 'Research current industry trends, popular topics, and recent developments. Identify content opportunities and gaps. Output a trend brief with data-backed topic suggestions.',
                        toolAccess: 'read-only',
                        allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                    },
                    enabled: true,
                },
                {
                    agentId: 'planner',
                    agentConfig: {
                        name: 'Content Planner',
                        instructions: 'Using the trend research, create a detailed content calendar for the week. Each piece should have: title, format, target audience, key points, estimated word count, and publishing day. Save as content-calendar-{date}.md.',
                        toolAccess: 'full',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [],
    },

    {
        id: 'api-health-check',
        name: 'API Health Monitor',
        description: 'Regularly check API endpoints and trigger alerts or diagnostic pipelines when issues are detected.',
        category: 'monitoring',
        trigger: {
            type: 'poll',
            task: 'API health check detected an issue:\n\nEndpoint: {{sourceUrl}}\nStatus: {{item.status}}\nResponse Time: {{item.responseTime}}ms\n\nInvestigate the issue:\n1. Check related logs and recent deployments\n2. Identify potential root causes\n3. Suggest immediate remediation steps\n4. Draft an incident report',
            poll: {
                url: 'https://api.example.com/health',
                interval: 300,
                dedup: false,
            },
            cooldown: 900,
            maxConcurrent: 1,
            tags: ['monitoring', 'api', 'health'],
        },
        pipeline: {
            name: 'Incident Response',
            description: 'Automated incident investigation and reporting',
            steps: [
                {
                    agentId: 'investigator',
                    agentConfig: {
                        name: 'Incident Investigator',
                        instructions: 'Investigate the API health issue. Check logs, recent code changes, infrastructure status, and related services. Identify the likely root cause and produce an incident report with timeline, impact assessment, and remediation steps.',
                        toolAccess: 'read-only',
                    },
                    enabled: true,
                },
            ],
        },
        variables: [],
    },

];

const templateMap = new Map<string, TriggerTemplate>();
for (const t of templates) {
    templateMap.set(t.id, t);
}

export function getTemplate(id: string): TriggerTemplate | undefined {
    return templateMap.get(id);
}

export function listTemplates(): TriggerTemplate[] {
    return [...templates];
}

export function listTemplatesByCategory(category: string): TriggerTemplate[] {
    return templates.filter(t => t.category === category);
}

export function getCategories(): string[] {
    return [...new Set(templates.map(t => t.category))];
}

export function createTriggerFromTemplate(
    templateId: string,
    overrides: Partial<TriggerConfig> & { id: string },
): TriggerConfig | undefined {
    const template = templateMap.get(templateId);
    if (!template) return undefined;

    const { id, ...rest } = overrides;
    return {
        ...template.trigger,
        ...rest,
        id,
    } as TriggerConfig;
}

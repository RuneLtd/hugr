'use client';

import { useState, useEffect } from 'react';
import {
  Box, Flex, Text, Button, Input, VStack, HStack,
  Switch, Select, IconButton, useToast, Badge, Textarea,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader, WorkflowVisual } from '@/components';
import {
  Plus, Trash2, Save, Clock, Globe, Wifi, FolderOpen,
  Zap, ChevronRight, ChevronDown, Settings2, Copy,
} from 'lucide-react';
import { WORKFLOW_TEMPLATES } from '@/lib/templates';
import {
  type ScheduleFrequency, type ScheduleConfig,
  DAY_NAMES, scheduleToCron, cronToSchedule,
  describeSchedule, describeCronHuman, ordinal,
} from '@/lib/cronHelpers';

interface TriggerConfig {
  id: string;
  name: string;
  type: 'cron' | 'webhook' | 'poll' | 'watch';
  enabled: boolean;
  task: string;
  pipeline?: string;
  workflowId?: string;
  workflowSteps?: Array<{ agentId: string; enabled: boolean; iterations?: number }>;
  projectPath?: string;
  autonomy?: string;
  maxConcurrent?: number;
  cooldown?: number;
  cron?: string;
  webhook?: { path: string; secret?: string; method?: string };
  poll?: { url: string; interval: number; headers?: Record<string, string>; jq?: string; dedup?: boolean; dedupKey?: string };
  watch?: { path: string; pattern?: string; events?: string[]; debounce?: number };
  tags?: string[];
}

interface SavedWorkflow {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ agentId: string; enabled: boolean; iterations?: number }>;
}

interface TriggerTemplateLocal {
  id: string;
  name: string;
  description: string;
  category: string;
  type: 'cron' | 'webhook' | 'poll' | 'watch';
  task: string;
  workflowId?: string;
  cron?: string;
  webhook?: { path: string; secret?: string; method?: string };
  poll?: { url: string; interval: number; jq?: string; dedup?: boolean; dedupKey?: string };
  watch?: { path: string; pattern?: string; events?: string[]; debounce?: number };
}

const TRIGGER_TEMPLATES: TriggerTemplateLocal[] = [
  {
    id: 'tpl-social-post-log',
    name: 'Social Post Tracker',
    description: 'Logs your new social posts and suggests improvements for next time',
    category: 'Content & Social',
    type: 'poll',
    poll: { url: 'https://api.twitter.com/2/users/me/tweets', interval: 900, dedup: true, dedupKey: 'id' },
    workflowId: 'template-content-pipeline',
    task: 'A new social media post was published. Read the post content from the payload. Append it to posts/post-log.md with the date and platform. Then analyze the post for engagement potential — tone, length, hook strength, call-to-action clarity — and write 3 specific suggestions for improving the next post. Append the suggestions below the logged post.',
  },
  {
    id: 'tpl-content-calendar',
    name: 'Weekly Content Planner',
    description: 'Generates a content calendar with post ideas every Monday morning',
    category: 'Content & Social',
    type: 'cron',
    cron: '0 8 * * 1',
    workflowId: 'template-content-pipeline',
    task: "Read the posts in posts/post-log.md to understand what content has been published recently. Based on the topics, tone, and any patterns, generate a content calendar for this week with one post idea per day (Mon-Fri). For each idea include: a suggested hook/opening line, the key message, and the best time to post. Write the calendar to content/week-plan.md.",
  },
  {
    id: 'tpl-blog-draft-from-notes',
    name: 'Notes to Blog Post',
    description: 'Turns rough notes dropped into a folder into polished blog drafts',
    category: 'Content & Social',
    type: 'watch',
    watch: { path: './notes', pattern: '**/*.md', events: ['create'], debounce: 3000 },
    workflowId: 'template-blog-writer',
    task: 'A new notes file was added: {{files}}. Read the raw notes and expand them into a full blog post draft. Keep the original voice and ideas but add structure, smooth transitions, a compelling intro, and a clear conclusion. Save the draft to drafts/ with the same filename.',
  },
  {
    id: 'tpl-competitor-watch',
    name: 'Competitor Activity Monitor',
    description: 'Polls competitor websites for changes and summarizes updates',
    category: 'Business',
    type: 'poll',
    poll: { url: 'https://competitor.example.com/blog/feed', interval: 3600, dedup: true, dedupKey: 'link' },
    workflowId: 'template-competitive-intel',
    task: 'New content was detected from a competitor. Summarize what they published — the key claims, product announcements, or positioning changes. Note anything that differs from or directly competes with our offering. Append the analysis to intel/competitor-updates.md with the date.',
  },
  {
    id: 'tpl-weekly-business-report',
    name: 'Weekly Business Summary',
    description: 'Compiles a weekly summary of all activity and files in the project',
    category: 'Business',
    type: 'cron',
    cron: '0 17 * * 5',
    workflowId: 'template-research-summarise',
    task: 'Generate a weekly business summary. Review all files modified this week across the project. Identify key updates, new documents, and any outstanding items. Organize the summary by area (content, operations, development, etc.) and highlight the top 3 priorities for next week. Write the report to reports/weekly-summary.md.',
  },
  {
    id: 'tpl-invoice-processor',
    name: 'Invoice Processor',
    description: 'Processes new invoices dropped into a folder and extracts key details',
    category: 'Business',
    type: 'watch',
    watch: { path: './invoices/incoming', pattern: '**/*.pdf', events: ['create'], debounce: 2000 },
    workflowId: 'template-data-processing',
    task: 'A new invoice file was added: {{files}}. Read the invoice and extract: vendor name, invoice number, date, line items, subtotal, tax, and total amount. Append a row to invoices/invoice-log.md with these details. If the total exceeds $5,000, also create a flag file at invoices/needs-review/{{filename}}.md noting the high amount.',
  },
  {
    id: 'tpl-meeting-notes-cleanup',
    name: 'Meeting Notes Cleanup',
    description: 'Cleans up raw meeting notes into structured action items',
    category: 'Productivity',
    type: 'watch',
    watch: { path: './meetings/raw', pattern: '**/*.md', events: ['create'], debounce: 2000 },
    workflowId: 'template-quick-code',
    task: 'New meeting notes were added: {{files}}. Read the raw notes and produce a clean structured version with: a brief summary (2-3 sentences), key decisions made, action items with owners and deadlines (if mentioned), and open questions. Save the cleaned version to meetings/processed/ with the same filename.',
  },
  {
    id: 'tpl-daily-journal-prompt',
    name: 'Daily Journal Prompt',
    description: 'Creates a personalized journal prompt every morning based on recent entries',
    category: 'Productivity',
    type: 'cron',
    cron: '0 7 * * *',
    workflowId: 'template-quick-code',
    task: "Read the last 5 journal entries in journal/ to understand recent themes, goals, and mood. Generate today's journal prompt that's thoughtful and specific to what's been on the writer's mind. Include one reflection question, one forward-looking question, and one gratitude prompt. Write it to journal/prompts/{{date}}.md.",
  },
  {
    id: 'tpl-inbox-sorter',
    name: 'File Inbox Sorter',
    description: 'Automatically categorizes and moves files dropped into an inbox',
    category: 'Productivity',
    type: 'watch',
    watch: { path: './inbox', pattern: '**/*', events: ['create'], debounce: 2000 },
    workflowId: 'template-classify-route',
    task: 'New files were added to the inbox: {{files}}. For each file, read its contents and determine what category it belongs to (e.g. receipts, contracts, notes, images, reports). Create a summary entry in inbox/sorted-log.md with the filename, detected category, and a one-line description of the contents. Move or copy the file to the appropriate subfolder under sorted/ (create the subfolder if it doesn\'t exist).',
  },
  {
    id: 'tpl-nightly-tests',
    name: 'Nightly Test & Lint',
    description: 'Runs the test suite and linter every night, reports failures',
    category: 'Development',
    type: 'cron',
    cron: '0 2 * * *',
    workflowId: 'template-standard-dev',
    task: 'Run the full test suite and linter. If any tests fail or lint errors are found, create a detailed report in TEST-REPORT.md with the failures, their likely causes, and suggested fixes.',
  },
  {
    id: 'tpl-pr-review',
    name: 'PR Review Webhook',
    description: 'Automatically reviews code when a pull request webhook fires',
    category: 'Development',
    type: 'webhook',
    webhook: { path: '/pr-review', method: 'POST' },
    workflowId: 'template-deep-review',
    task: 'A pull request was opened or updated. Review the changes for code quality, potential bugs, security issues, and adherence to project conventions. Write your review findings to PR-REVIEW.md.',
  },
  {
    id: 'tpl-deploy-webhook',
    name: 'Post-Deploy Checks',
    description: 'Runs smoke tests after a deployment webhook fires',
    category: 'Development',
    type: 'webhook',
    webhook: { path: '/deploy', method: 'POST' },
    workflowId: 'template-quick-code',
    task: 'A deployment just completed. Run the smoke tests and health checks. If anything fails, create an incident report in DEPLOY-REPORT.md with the status of each check and any errors found.',
  },
  {
    id: 'tpl-doc-sync',
    name: 'Documentation Sync',
    description: 'Updates docs when source files change',
    category: 'Development',
    type: 'watch',
    watch: { path: './src', pattern: '**/*.ts', events: ['modify'], debounce: 5000 },
    workflowId: 'template-standard-dev',
    task: 'Source files were modified: {{files}}. Check if the corresponding documentation in docs/ is still accurate. Update any outdated documentation to reflect the current code. Focus on API changes, new exports, and modified function signatures.',
  },
  {
    id: 'tpl-research-digest',
    name: 'Research Feed Digest',
    description: 'Polls an RSS or API feed and creates a daily research digest',
    category: 'Research',
    type: 'poll',
    poll: { url: 'https://example.com/feed.xml', interval: 3600, dedup: true, dedupKey: 'guid' },
    workflowId: 'template-research-summarise',
    task: 'New items were found in the feed. For each new item, write a 2-3 sentence summary focused on what matters and why. Group related items together. Append the digest to research/feed-digest.md with today\'s date as a heading.',
  },
  {
    id: 'tpl-market-news',
    name: 'Market News Scanner',
    description: 'Polls a news API and flags articles relevant to your industry',
    category: 'Research',
    type: 'poll',
    poll: { url: 'https://newsapi.example.com/v2/everything?q=your-industry', interval: 1800, dedup: true, dedupKey: 'url' },
    workflowId: 'template-market-scan',
    task: 'New articles were found. For each article, assess its relevance to our business. If relevant, summarize the key points and note any implications or opportunities. Append relevant articles to research/market-news.md. Skip articles that are just noise.',
  },
];

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  cron: Clock,
  webhook: Globe,
  poll: Wifi,
  watch: FolderOpen,
};

const TRIGGER_LABELS: Record<string, string> = {
  cron: 'Scheduled',
  webhook: 'Webhook',
  poll: 'Polling',
  watch: 'File Watch',
};

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  cron: 'Runs on a schedule using a cron expression',
  webhook: 'Fires when an HTTP request hits the endpoint',
  poll: 'Checks a URL at regular intervals for changes',
  watch: 'Fires when files are created, modified, or deleted',
};

const TEMPLATE_CATEGORY_COLORS: Record<string, string> = {
  'Content & Social': 'pink',
  Business: 'orange',
  Productivity: 'blue',
  Development: 'purple',
  Research: 'green',
};

export default function TriggersPage() {
  const toast = useToast();
  const [triggers, setTriggers] = useState<TriggerConfig[]>([]);
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<TriggerConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleConfig>(() => cronToSchedule('0 9 * * 1-5'));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pickingFolder, setPickingFolder] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/triggers')
      .then((r) => r.json())
      .then((data) => {
        setTriggers(data.triggers ?? []);
        setWorkflows(data.workflows ?? []);
      })
      .catch(() => {});
    fetch('/api/workers')
      .then((r) => r.json())
      .then((data) => {
        const names: Record<string, string> = {};
        (data.workers ?? []).forEach((w: any) => { names[w.id] = w.name; });
        setAgentNames(names);
      })
      .catch(() => {});
  }, []);

  function updateSchedule(next: ScheduleConfig) {
    setSchedule(next);
    if (editing) setEditing({ ...editing, cron: scheduleToCron(next) });
  }

  const allWorkflows: SavedWorkflow[] = [
    ...workflows,
    ...WORKFLOW_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      steps: t.steps.map((s) => ({ ...s })),
    })),
  ];

  async function handleFolderPick(target: 'project' | 'watch') {
    setPickingFolder(target);
    try {
      const res = await fetch('/api/folder-picker', { method: 'POST' });
      const data = await res.json();
      if (data.path && editing) {
        if (target === 'project') {
          setEditing({ ...editing, projectPath: data.path });
        } else {
          setEditing({ ...editing, watch: { ...editing.watch!, path: data.path } });
        }
      }
    } catch {}
    setPickingFolder(null);
  }

  function createFromTemplate(tpl: TriggerTemplateLocal) {
    const trigger: TriggerConfig = {
      id: `trigger-${Date.now()}`,
      name: tpl.name,
      type: tpl.type,
      enabled: true,
      task: tpl.task,
      cron: tpl.cron,
      webhook: tpl.webhook,
      poll: tpl.poll,
      watch: tpl.watch,
    };

    if (tpl.workflowId) {
      const wf = allWorkflows.find((w) => w.id === tpl.workflowId);
      if (wf) {
        trigger.workflowId = wf.id;
        trigger.workflowSteps = wf.steps.map((s) => ({ ...s }));
      }
    }

    setEditing(trigger);
    if (trigger.type === 'cron') setSchedule(cronToSchedule(trigger.cron || '0 9 * * 1-5'));
    setShowAdvanced(false);
  }

  function createNew(type: 'cron' | 'webhook' | 'poll' | 'watch') {
    const base: TriggerConfig = {
      id: `trigger-${Date.now()}`,
      name: '',
      type,
      enabled: true,
      task: '',
    };

    if (type === 'cron') base.cron = '0 9 * * 1-5';
    if (type === 'webhook') base.webhook = { path: '/my-hook', method: 'POST' };
    if (type === 'poll') base.poll = { url: '', interval: 300 };
    if (type === 'watch') base.watch = { path: '', pattern: '**/*', events: ['create'] };

    setEditing(base);
    if (type === 'cron') setSchedule(cronToSchedule('0 9 * * 1-5'));
    setShowAdvanced(false);
  }

  async function saveTrigger() {
    if (!editing) return;

    if (!editing.name.trim()) {
      toast({ title: 'Trigger name is required', status: 'warning', duration: 2000 });
      return;
    }
    if (!editing.task.trim()) {
      toast({ title: 'Task description is required', status: 'warning', duration: 2000 });
      return;
    }

    try {
      await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      setTriggers((prev) => {
        const idx = prev.findIndex((t) => t.id === editing.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = editing;
          return next;
        }
        return [...prev, editing];
      });
      setEditing(null);
      toast({ title: 'Trigger saved', status: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Failed to save', status: 'error', duration: 2000 });
    }
  }

  async function deleteTrigger(id: string) {
    try {
      await fetch('/api/triggers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setTriggers((prev) => prev.filter((t) => t.id !== id));
      if (editing?.id === id) setEditing(null);
      toast({ title: 'Trigger deleted', status: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Failed to delete', status: 'error', duration: 2000 });
    }
  }

  async function toggleTrigger(id: string, enabled: boolean) {
    const trigger = triggers.find((t) => t.id === id);
    if (!trigger) return;
    const updated = { ...trigger, enabled };
    try {
      await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setTriggers((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch {}
  }

  function selectWorkflow(workflowId: string) {
    if (!editing) return;
    if (workflowId === '_none') {
      setEditing({ ...editing, workflowId: undefined, workflowSteps: undefined });
      return;
    }
    const wf = allWorkflows.find((w) => w.id === workflowId);
    if (wf) {
      setEditing({
        ...editing,
        workflowId: wf.id,
        workflowSteps: wf.steps.map((s) => ({ ...s })),
      });
    }
  }

  const templateCategories = [...new Set(TRIGGER_TEMPLATES.map((t) => t.category))];

  if (editing) {
    return (
      <Shell>
        <PageHeader
          title={triggers.find((t) => t.id === editing.id) ? 'Edit Trigger' : 'New Trigger'}
          subtitle={`${TRIGGER_LABELS[editing.type]} trigger`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Back
            </Button>
          }
        />

        <Card>
          <VStack spacing={6} align="stretch">
            <Flex gap={4}>
              <Box flex={1}>
                <Text fontSize="xs" color="text.muted" mb={1}>Name</Text>
                <Input
                  size="sm"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="My daily digest"
                  bg="bg.secondary"
                />
              </Box>
              <Box>
                <Text fontSize="xs" color="text.muted" mb={1}>Type</Text>
                <Flex align="center" gap={2} h="32px" px={3} bg="bg.secondary" borderRadius="md" border="1px solid" borderColor="border.subtle">
                  {(() => {
                    const Icon = TRIGGER_ICONS[editing.type] ?? Zap;
                    return <Icon size={14} />;
                  })()}
                  <Text fontSize="sm" color="text.primary">{TRIGGER_LABELS[editing.type]}</Text>
                </Flex>
              </Box>
            </Flex>

            <Box>
              <Text fontSize="xs" fontWeight="600" color="text.secondary" mb={3}>
                Trigger Settings
              </Text>

              {editing.type === 'cron' && (
                <VStack spacing={4} align="stretch">
                  <Flex gap={4}>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Frequency</Text>
                      <Select
                        size="sm"
                        value={schedule.frequency}
                        onChange={(e) => updateSchedule({ ...schedule, frequency: e.target.value as ScheduleFrequency })}
                        bg="bg.secondary"
                      >
                        <option value="every_day">Every day</option>
                        <option value="weekdays">Weekdays (Mon–Fri)</option>
                        <option value="weekends">Weekends (Sat–Sun)</option>
                        <option value="specific_days">Specific days</option>
                        <option value="monthly">Monthly</option>
                        <option value="hourly">Hourly</option>
                      </Select>
                    </Box>
                    {schedule.frequency !== 'hourly' && (
                      <Box flex={1}>
                        <Text fontSize="xs" color="text.muted" mb={1}>Time</Text>
                        <Input
                          size="sm"
                          type="time"
                          value={`${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`}
                          onChange={(e) => {
                            const [h, m] = e.target.value.split(':').map(Number);
                            updateSchedule({ ...schedule, hour: h ?? 9, minute: m ?? 0 });
                          }}
                          bg="bg.secondary"
                        />
                      </Box>
                    )}
                    {schedule.frequency === 'hourly' && (
                      <Box flex={1}>
                        <Text fontSize="xs" color="text.muted" mb={1}>Every N hours</Text>
                        <Select
                          size="sm"
                          value={schedule.hourlyInterval}
                          onChange={(e) => updateSchedule({ ...schedule, hourlyInterval: parseInt(e.target.value) || 1 })}
                          bg="bg.secondary"
                        >
                          {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                            <option key={n} value={n}>{n} hour{n > 1 ? 's' : ''}</option>
                          ))}
                        </Select>
                      </Box>
                    )}
                    {schedule.frequency === 'monthly' && (
                      <Box flex={1}>
                        <Text fontSize="xs" color="text.muted" mb={1}>Day of month</Text>
                        <Select
                          size="sm"
                          value={schedule.monthDay}
                          onChange={(e) => updateSchedule({ ...schedule, monthDay: parseInt(e.target.value) || 1 })}
                          bg="bg.secondary"
                        >
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>{ordinal(d)}</option>
                          ))}
                        </Select>
                      </Box>
                    )}
                  </Flex>
                  {schedule.frequency === 'specific_days' && (
                    <Box>
                      <Text fontSize="xs" color="text.muted" mb={2}>Days</Text>
                      <HStack spacing={2}>
                        {DAY_NAMES.map((name, idx) => (
                          <Button
                            key={idx}
                            size="xs"
                            variant={schedule.days.includes(idx) ? 'solid' : 'outline'}
                            colorScheme={schedule.days.includes(idx) ? 'blue' : 'gray'}
                            borderRadius="full"
                            minW="36px"
                            h="28px"
                            fontSize="2xs"
                            onClick={() => {
                              const next = schedule.days.includes(idx)
                                ? schedule.days.filter((d) => d !== idx)
                                : [...schedule.days, idx];
                              if (next.length > 0) updateSchedule({ ...schedule, days: next });
                            }}
                          >
                            {name}
                          </Button>
                        ))}
                      </HStack>
                    </Box>
                  )}
                  <Flex align="center" gap={2} px={3} py={2} bg="bg.secondary" borderRadius="md" border="1px solid" borderColor="border.subtle">
                    <Clock size={13} color="#6b6b6b" />
                    <Text fontSize="xs" color="text.secondary" fontWeight="500">
                      {describeSchedule(schedule)}
                    </Text>
                    <Text fontSize="2xs" color="text.subtle" fontFamily="mono" ml="auto">
                      {editing.cron}
                    </Text>
                  </Flex>
                </VStack>
              )}

              {editing.type === 'webhook' && (
                <Flex gap={4}>
                  <Box flex={2}>
                    <Text fontSize="xs" color="text.muted" mb={1}>Path</Text>
                    <Input
                      size="sm"
                      value={editing.webhook?.path ?? ''}
                      onChange={(e) => setEditing({ ...editing, webhook: { ...editing.webhook!, path: e.target.value } })}
                      placeholder="/my-webhook"
                      bg="bg.secondary"
                      fontFamily="mono"
                    />
                  </Box>
                  <Box flex={1}>
                    <Text fontSize="xs" color="text.muted" mb={1}>Method</Text>
                    <Select
                      size="sm"
                      value={editing.webhook?.method ?? 'POST'}
                      onChange={(e) => setEditing({ ...editing, webhook: { ...editing.webhook!, method: e.target.value } })}
                      bg="bg.secondary"
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                      <option value="PUT">PUT</option>
                    </Select>
                  </Box>
                  <Box flex={1}>
                    <Text fontSize="xs" color="text.muted" mb={1}>Secret</Text>
                    <Input
                      size="sm"
                      type="password"
                      value={editing.webhook?.secret ?? ''}
                      onChange={(e) => setEditing({ ...editing, webhook: { ...editing.webhook!, secret: e.target.value } })}
                      placeholder="optional"
                      bg="bg.secondary"
                    />
                  </Box>
                </Flex>
              )}

              {editing.type === 'poll' && (
                <Flex gap={4}>
                  <Box flex={3}>
                    <Text fontSize="xs" color="text.muted" mb={1}>URL</Text>
                    <Input
                      size="sm"
                      value={editing.poll?.url ?? ''}
                      onChange={(e) => setEditing({ ...editing, poll: { ...editing.poll!, url: e.target.value } })}
                      placeholder="https://api.example.com/feed"
                      bg="bg.secondary"
                    />
                  </Box>
                  <Box flex={1}>
                    <Text fontSize="xs" color="text.muted" mb={1}>Interval (sec)</Text>
                    <Input
                      size="sm"
                      type="number"
                      min={10}
                      value={editing.poll?.interval ?? 300}
                      onChange={(e) => setEditing({ ...editing, poll: { ...editing.poll!, interval: parseInt(e.target.value) || 300 } })}
                      bg="bg.secondary"
                    />
                  </Box>
                </Flex>
              )}

              {editing.type === 'watch' && (
                <VStack spacing={3} align="stretch">
                  <Flex gap={4}>
                    <Box flex={2}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Watch Path</Text>
                      <Flex gap={2}>
                        <Input
                          size="sm"
                          flex={1}
                          value={editing.watch?.path ?? ''}
                          onChange={(e) => setEditing({ ...editing, watch: { ...editing.watch!, path: e.target.value } })}
                          placeholder="/path/to/watch"
                          bg="bg.secondary"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          px={2}
                          onClick={() => handleFolderPick('watch')}
                          isLoading={pickingFolder === 'watch'}
                        >
                          <FolderOpen size={16} />
                        </Button>
                      </Flex>
                    </Box>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Pattern</Text>
                      <Input
                        size="sm"
                        value={editing.watch?.pattern ?? ''}
                        onChange={(e) => setEditing({ ...editing, watch: { ...editing.watch!, pattern: e.target.value } })}
                        placeholder="**/*"
                        bg="bg.secondary"
                        fontFamily="mono"
                      />
                    </Box>
                  </Flex>
                  <Box>
                    <Text fontSize="xs" color="text.muted" mb={1}>Events</Text>
                    <HStack spacing={3}>
                      {['create', 'modify', 'delete'].map((evt) => (
                        <HStack key={evt} spacing={1}>
                          <Switch
                            size="sm"
                            isChecked={(editing.watch?.events ?? []).includes(evt)}
                            onChange={(e) => {
                              const events = editing.watch?.events ?? [];
                              const next = e.target.checked
                                ? [...events, evt]
                                : events.filter((x) => x !== evt);
                              setEditing({ ...editing, watch: { ...editing.watch!, events: next } });
                            }}
                          />
                          <Text fontSize="xs" color="text.muted">{evt}</Text>
                        </HStack>
                      ))}
                    </HStack>
                  </Box>
                </VStack>
              )}
            </Box>

            <Box>
              <Text fontSize="xs" fontWeight="600" color="text.secondary" mb={3}>
                Workflow
              </Text>
              <Text fontSize="xs" color="text.subtle" mb={2}>
                Choose which workflow runs when this trigger fires
              </Text>
              <Select
                size="sm"
                value={editing.workflowId ?? '_none'}
                onChange={(e) => selectWorkflow(e.target.value)}
                bg="bg.secondary"
                borderColor="border.subtle"
                mb={2}
              >
                <option value="_none">Default (coder only)</option>
                {workflows.length > 0 && (
                  <optgroup label="My Workflows">
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>{wf.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Templates">
                  {WORKFLOW_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              </Select>
              {editing.workflowSteps && editing.workflowSteps.length > 0 && (
                <Box mt={2}>
                  <WorkflowVisual steps={editing.workflowSteps} agentNames={agentNames} />
                </Box>
              )}
            </Box>

            <Box>
              <Text fontSize="xs" fontWeight="600" color="text.secondary" mb={3}>
                Task
              </Text>
              <Text fontSize="xs" color="text.subtle" mb={2}>
                Describe what should happen when this trigger fires
              </Text>
              <Textarea
                size="sm"
                value={editing.task}
                onChange={(e) => setEditing({ ...editing, task: e.target.value })}
                placeholder={'Describe the task for the agents. Use {{variable}} for dynamic values from the trigger payload.\n\nExample: "A new file was detected: {{files}}. Summarize its contents and create a report."'}
                rows={5}
                bg="bg.secondary"
                fontFamily="mono"
                fontSize="xs"
              />
              <Text fontSize="2xs" color="text.subtle" mt={1}>
                {'Use {{payload.field}} to inject values from the trigger event'}
              </Text>
            </Box>

            <Box>
              <Flex
                align="center"
                gap={2}
                cursor="pointer"
                onClick={() => setShowAdvanced(!showAdvanced)}
                mb={showAdvanced ? 3 : 0}
              >
                <Settings2 size={14} color="#6b6b6b" />
                <Text fontSize="xs" color="text.subtle">Advanced Settings</Text>
                <Box color="text.subtle" transform={showAdvanced ? 'rotate(0deg)' : 'rotate(-90deg)'} transition="transform 0.15s">
                  <ChevronDown size={14} />
                </Box>
              </Flex>

              {showAdvanced && (
                <VStack spacing={3} align="stretch" pl={5}>
                  <Box>
                    <Text fontSize="xs" color="text.muted" mb={1}>Project Path</Text>
                    <Flex gap={2}>
                      <Input
                        size="sm"
                        flex={1}
                        value={editing.projectPath ?? ''}
                        onChange={(e) => setEditing({ ...editing, projectPath: e.target.value })}
                        placeholder="Defaults to trigger runner config"
                        bg="bg.secondary"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        px={2}
                        onClick={() => handleFolderPick('project')}
                        isLoading={pickingFolder === 'project'}
                      >
                        <FolderOpen size={16} />
                      </Button>
                    </Flex>
                  </Box>
                  <Flex gap={4}>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Max Concurrent</Text>
                      <Input
                        size="sm"
                        type="number"
                        min={1}
                        value={editing.maxConcurrent ?? ''}
                        onChange={(e) => setEditing({ ...editing, maxConcurrent: parseInt(e.target.value) || undefined })}
                        placeholder="unlimited"
                        bg="bg.secondary"
                      />
                    </Box>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Cooldown (seconds)</Text>
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        value={editing.cooldown ?? ''}
                        onChange={(e) => setEditing({ ...editing, cooldown: parseInt(e.target.value) || undefined })}
                        placeholder="none"
                        bg="bg.secondary"
                      />
                    </Box>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.muted" mb={1}>Autonomy</Text>
                      <Select
                        size="sm"
                        value={editing.autonomy ?? 'auto'}
                        onChange={(e) => setEditing({ ...editing, autonomy: e.target.value })}
                        bg="bg.secondary"
                      >
                        <option value="auto">Auto</option>
                        <option value="supervised">Supervised</option>
                      </Select>
                    </Box>
                  </Flex>
                  {editing.type === 'watch' && (
                    <Box>
                      <Text fontSize="xs" color="text.muted" mb={1}>Debounce (ms)</Text>
                      <Input
                        size="sm"
                        type="number"
                        min={100}
                        value={editing.watch?.debounce ?? 1000}
                        onChange={(e) => setEditing({ ...editing, watch: { ...editing.watch!, debounce: parseInt(e.target.value) || 1000 } })}
                        bg="bg.secondary"
                      />
                    </Box>
                  )}
                  {editing.type === 'poll' && (
                    <VStack spacing={3} align="stretch">
                      <Box>
                        <Text fontSize="xs" color="text.muted" mb={1}>JQ Filter</Text>
                        <Input
                          size="sm"
                          value={editing.poll?.jq ?? ''}
                          onChange={(e) => setEditing({ ...editing, poll: { ...editing.poll!, jq: e.target.value } })}
                          placeholder=".items[] | .title"
                          bg="bg.secondary"
                          fontFamily="mono"
                        />
                      </Box>
                      <HStack spacing={4}>
                        <HStack spacing={2}>
                          <Switch
                            size="sm"
                            isChecked={editing.poll?.dedup ?? false}
                            onChange={(e) => setEditing({ ...editing, poll: { ...editing.poll!, dedup: e.target.checked } })}
                          />
                          <Text fontSize="xs" color="text.muted">Deduplicate</Text>
                        </HStack>
                        {editing.poll?.dedup && (
                          <Box flex={1}>
                            <Input
                              size="sm"
                              value={editing.poll?.dedupKey ?? ''}
                              onChange={(e) => setEditing({ ...editing, poll: { ...editing.poll!, dedupKey: e.target.value } })}
                              placeholder="Dedup key (e.g. id)"
                              bg="bg.secondary"
                              fontFamily="mono"
                            />
                          </Box>
                        )}
                      </HStack>
                    </VStack>
                  )}
                </VStack>
              )}
            </Box>

            <Flex justify="flex-end" gap={2} pt={2} borderTop="1px solid" borderColor="border.subtle">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" leftIcon={<Save size={14} />} onClick={saveTrigger}>
                Save Trigger
              </Button>
            </Flex>
          </VStack>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Triggers"
        subtitle="Automate workflows with schedules, webhooks, polling, and file watchers"
        actions={
          triggers.length > 0 ? (
            <Text fontSize="xs" color="text.subtle">{triggers.length} trigger{triggers.length !== 1 ? 's' : ''}</Text>
          ) : undefined
        }
      />

      {triggers.length > 0 && (
        <Box mb={6}>
          <VStack spacing={2} align="stretch">
            {triggers.map((trigger) => {
              const Icon = TRIGGER_ICONS[trigger.type] ?? Zap;
              return (
                <Card key={trigger.id} py={3} px={4} opacity={trigger.enabled ? 1 : 0.5}>
                  <Flex justify="space-between" align="center">
                    <Flex align="center" gap={3} flex={1} minW={0} cursor="pointer" onClick={() => { setEditing({ ...trigger }); if (trigger.type === 'cron') setSchedule(cronToSchedule(trigger.cron || '0 9 * * 1-5')); setShowAdvanced(false); }}>
                      <Box color={trigger.enabled ? 'text.secondary' : 'text.subtle'}>
                        <Icon size={16} />
                      </Box>
                      <Box flex={1} minW={0}>
                        <Flex align="center" gap={2}>
                          <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                            {trigger.name || TRIGGER_LABELS[trigger.type]}
                          </Text>
                          <Badge fontSize="2xs" variant="subtle" colorScheme={trigger.enabled ? 'green' : 'gray'}>
                            {trigger.enabled ? 'active' : 'paused'}
                          </Badge>
                          <Badge fontSize="2xs" variant="outline" colorScheme="gray">
                            {TRIGGER_LABELS[trigger.type]}
                          </Badge>
                          {trigger.type === 'cron' && trigger.cron && (
                            <Text fontSize="2xs" color="text.subtle">{describeCronHuman(trigger.cron)}</Text>
                          )}
                          {trigger.type === 'webhook' && trigger.webhook && (
                            <Text fontSize="2xs" color="text.subtle" fontFamily="mono">{trigger.webhook.path}</Text>
                          )}
                        </Flex>
                        <Text fontSize="xs" color="text.muted" mt={0.5} noOfLines={1}>
                          {trigger.task.slice(0, 120)}
                        </Text>
                      </Box>
                      {trigger.workflowSteps && trigger.workflowSteps.length > 0 && (
                        <WorkflowVisual steps={trigger.workflowSteps} agentNames={agentNames} />
                      )}
                    </Flex>
                    <HStack spacing={2} ml={3}>
                      <Switch
                        size="sm"
                        isChecked={trigger.enabled}
                        onChange={(e) => toggleTrigger(trigger.id, e.target.checked)}
                      />
                      <IconButton
                        aria-label="Delete"
                        icon={<Trash2 size={14} />}
                        size="xs"
                        variant="ghost"
                        color="text.subtle"
                        _hover={{ color: 'red.400' }}
                        onClick={() => deleteTrigger(trigger.id)}
                      />
                    </HStack>
                  </Flex>
                </Card>
              );
            })}
          </VStack>
        </Box>
      )}

      <Box mb={6}>
        <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={1}>
          Create New Trigger
        </Text>
        <Text fontSize="xs" color="text.subtle" mb={4}>
          Choose a trigger type to get started
        </Text>
        <Flex gap={3} flexWrap="wrap">
          {(['cron', 'webhook', 'poll', 'watch'] as const).map((type) => {
            const Icon = TRIGGER_ICONS[type];
            return (
              <Card
                key={type}
                py={4}
                px={5}
                cursor="pointer"
                _hover={{ borderColor: 'border.default' }}
                onClick={() => createNew(type)}
                flex="1"
                minW="200px"
              >
                <VStack spacing={2} align="flex-start">
                  <Box color="text.secondary">
                    <Icon size={20} />
                  </Box>
                  <Text fontSize="sm" fontWeight="500" color="text.primary">
                    {TRIGGER_LABELS[type]}
                  </Text>
                  <Text fontSize="xs" color="text.muted">
                    {TRIGGER_DESCRIPTIONS[type]}
                  </Text>
                </VStack>
              </Card>
            );
          })}
        </Flex>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={1}>
          Templates
        </Text>
        <Text fontSize="xs" color="text.subtle" mb={4}>
          Pre-configured triggers — click to customize and save
        </Text>
        {templateCategories.map((category) => (
          <Box key={category} mb={5}>
            <Text
              fontSize="2xs"
              fontWeight="600"
              color="text.subtle"
              textTransform="uppercase"
              letterSpacing="0.05em"
              mb={2}
            >
              {category}
            </Text>
            <VStack spacing={2} align="stretch">
              {TRIGGER_TEMPLATES.filter((t) => t.category === category).map((tpl) => {
                const Icon = TRIGGER_ICONS[tpl.type] ?? Zap;
                const wf = tpl.workflowId ? allWorkflows.find((w) => w.id === tpl.workflowId) : null;
                return (
                  <Card
                    key={tpl.id}
                    py={3}
                    px={4}
                    cursor="pointer"
                    _hover={{ borderColor: 'border.default' }}
                    onClick={() => createFromTemplate(tpl)}
                  >
                    <Flex justify="space-between" align="center">
                      <Flex align="center" gap={3} flex={1} minW={0}>
                        <Box color="text.subtle">
                          <Icon size={16} />
                        </Box>
                        <Box flex={1} minW={0}>
                          <Flex align="center" gap={2}>
                            <Text fontSize="sm" fontWeight="500" color="text.primary">
                              {tpl.name}
                            </Text>
                            <Badge fontSize="2xs" variant="subtle" colorScheme={TEMPLATE_CATEGORY_COLORS[tpl.category] ?? 'gray'}>
                              {TRIGGER_LABELS[tpl.type]}
                            </Badge>
                          </Flex>
                          <Text fontSize="xs" color="text.muted" mt={0.5} noOfLines={1}>
                            {tpl.description}
                          </Text>
                        </Box>
                      </Flex>
                      {wf && (
                        <Box ml={3}>
                          <WorkflowVisual steps={wf.steps} agentNames={agentNames} />
                        </Box>
                      )}
                      <Box color="text.subtle" ml={2}>
                        <ChevronRight size={16} />
                      </Box>
                    </Flex>
                  </Card>
                );
              })}
            </VStack>
          </Box>
        ))}
      </Box>
    </Shell>
  );
}

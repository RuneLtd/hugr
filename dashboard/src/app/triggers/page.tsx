'use client';

import { useState, useEffect } from 'react';
import {
  Box, Flex, Text, Button, Input, VStack, HStack,
  Switch, Select, IconButton, useToast, Badge, Textarea,
  Tabs, TabList, TabPanels, Tab, TabPanel,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader } from '@/components';
import {
  Plus, Trash2, Save, Clock, Globe, Wifi, FolderOpen,
  Zap, Play, Square, RotateCcw, ChevronRight,
} from 'lucide-react';

interface TriggerConfig {
  id: string;
  type: 'cron' | 'webhook' | 'poll' | 'watch';
  enabled: boolean;
  task: string;
  pipeline?: string;
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

interface TriggerTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: Omit<TriggerConfig, 'id' | 'enabled'>;
  pipeline?: {
    name: string;
    description: string;
    steps: Array<{ agentId: string; agentConfig?: { name: string; instructions: string }; enabled: boolean }>;
  };
  variables?: Array<{ name: string; description: string; required: boolean; default?: string }>;
}

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

const CATEGORY_COLORS: Record<string, string> = {
  content: 'purple',
  research: 'blue',
  monitoring: 'orange',
  devops: 'green',
  data: 'yellow',
  communication: 'pink',
};

export default function TriggersPage() {
  const toast = useToast();
  const [triggers, setTriggers] = useState<TriggerConfig[]>([]);
  const [templates, setTemplates] = useState<TriggerTemplate[]>([]);
  const [editing, setEditing] = useState<TriggerConfig | null>(null);
  const [tabIndex, setTabIndex] = useState(0);

  useEffect(() => {
    fetch('/api/triggers')
      .then((r) => r.json())
      .then((data) => {
        setTriggers(data.triggers ?? []);
        setTemplates(data.templates ?? []);
      })
      .catch(() => {});
  }, []);

  function createFromTemplate(template: TriggerTemplate) {
    const trigger: TriggerConfig = {
      ...template.trigger,
      id: `trigger-${Date.now()}`,
      enabled: true,
    } as TriggerConfig;
    setEditing(trigger);
    setTabIndex(0);
  }

  function createNew(type: 'cron' | 'webhook' | 'poll' | 'watch') {
    const base: TriggerConfig = {
      id: `trigger-${Date.now()}`,
      type,
      enabled: true,
      task: '',
    };

    if (type === 'cron') base.cron = '0 9 * * *';
    if (type === 'webhook') base.webhook = { path: '/my-hook', method: 'POST' };
    if (type === 'poll') base.poll = { url: '', interval: 300 };
    if (type === 'watch') base.watch = { path: '.', pattern: '**/*', events: ['create'] };

    setEditing(base);
  }

  async function saveTrigger() {
    if (!editing || !editing.task.trim()) {
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

  const categories = [...new Set(templates.map((t) => t.category))];

  return (
    <Shell>
      <PageHeader
        title="Triggers"
        subtitle="Automate pipelines with schedules, webhooks, polling, and file watchers"
        actions={
          <HStack>
            <Select
              size="sm"
              w="160px"
              placeholder="New trigger..."
              onChange={(e) => {
                if (e.target.value) createNew(e.target.value as any);
                e.target.value = '';
              }}
              bg="bg.secondary"
              borderColor="border.subtle"
            >
              <option value="cron">Scheduled (Cron)</option>
              <option value="webhook">Webhook</option>
              <option value="poll">Polling</option>
              <option value="watch">File Watch</option>
            </Select>
          </HStack>
        }
      />

      {editing ? (
        <Card>
          <VStack spacing={5} align="stretch">
            <Flex gap={4} align="flex-end">
              <Box flex={1}>
                <Text fontSize="xs" color="text.muted" mb={1}>Type</Text>
                <Flex align="center" gap={2}>
                  {(() => {
                    const Icon = TRIGGER_ICONS[editing.type] ?? Zap;
                    return <Icon size={16} />;
                  })()}
                  <Text fontSize="sm" fontWeight="500" color="text.primary">
                    {TRIGGER_LABELS[editing.type] ?? editing.type}
                  </Text>
                </Flex>
              </Box>
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
            </Flex>

            {editing.type === 'cron' && (
              <Box>
                <Text fontSize="xs" color="text.muted" mb={1}>Cron Expression</Text>
                <Input
                  size="sm"
                  value={editing.cron ?? ''}
                  onChange={(e) => setEditing({ ...editing, cron: e.target.value })}
                  placeholder="0 9 * * 1-5"
                  bg="bg.secondary"
                  fontFamily="mono"
                />
                <Text fontSize="2xs" color="text.subtle" mt={1}>
                  minute hour day-of-month month day-of-week
                </Text>
              </Box>
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
              <Flex gap={4}>
                <Box flex={2}>
                  <Text fontSize="xs" color="text.muted" mb={1}>Watch Path</Text>
                  <Input
                    size="sm"
                    value={editing.watch?.path ?? ''}
                    onChange={(e) => setEditing({ ...editing, watch: { ...editing.watch!, path: e.target.value } })}
                    placeholder="./inbox"
                    bg="bg.secondary"
                  />
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
            )}

            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>Task Template</Text>
              <Textarea
                size="sm"
                value={editing.task}
                onChange={(e) => setEditing({ ...editing, task: e.target.value })}
                placeholder="Describe what should happen when this trigger fires. Use {{variable}} for dynamic values from the trigger payload."
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
              <Text fontSize="xs" color="text.muted" mb={1}>Project Path (optional)</Text>
              <Input
                size="sm"
                value={editing.projectPath ?? ''}
                onChange={(e) => setEditing({ ...editing, projectPath: e.target.value })}
                placeholder="/path/to/project"
                bg="bg.secondary"
              />
            </Box>

            <Flex justify="flex-end" gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" leftIcon={<Save size={14} />} onClick={saveTrigger}>
                Save Trigger
              </Button>
            </Flex>
          </VStack>
        </Card>
      ) : (
        <Tabs index={tabIndex} onChange={setTabIndex} variant="soft-rounded" size="sm">
          <TabList mb={4} gap={1}>
            <Tab
              fontSize="xs"
              _selected={{ bg: 'overlay.strong', color: 'text.primary' }}
              color="text.muted"
            >
              My Triggers ({triggers.length})
            </Tab>
            <Tab
              fontSize="xs"
              _selected={{ bg: 'overlay.strong', color: 'text.primary' }}
              color="text.muted"
            >
              Templates
            </Tab>
          </TabList>

          <TabPanels>
            <TabPanel p={0}>
              {triggers.length === 0 ? (
                <Card py={10}>
                  <VStack spacing={3}>
                    <Zap size={24} color="#6b6b6b" />
                    <Text fontSize="sm" color="text.muted" textAlign="center">
                      No triggers configured yet
                    </Text>
                    <Text fontSize="xs" color="text.subtle" textAlign="center" maxW="400px">
                      Create a trigger to automate your pipelines with schedules, webhooks, URL polling, or file watchers. Or browse the templates tab.
                    </Text>
                  </VStack>
                </Card>
              ) : (
                <VStack spacing={2} align="stretch">
                  {triggers.map((trigger) => {
                    const Icon = TRIGGER_ICONS[trigger.type] ?? Zap;
                    return (
                      <Card
                        key={trigger.id}
                        py={3}
                        px={4}
                        opacity={trigger.enabled ? 1 : 0.5}
                      >
                        <Flex justify="space-between" align="center">
                          <Flex align="center" gap={3} flex={1} minW={0} cursor="pointer" onClick={() => setEditing(trigger)}>
                            <Box color={trigger.enabled ? 'text.secondary' : 'text.subtle'}>
                              <Icon size={16} />
                            </Box>
                            <Box flex={1} minW={0}>
                              <Flex align="center" gap={2}>
                                <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                                  {TRIGGER_LABELS[trigger.type]}
                                </Text>
                                <Badge
                                  fontSize="2xs"
                                  variant="subtle"
                                  colorScheme={trigger.enabled ? 'green' : 'gray'}
                                >
                                  {trigger.enabled ? 'active' : 'paused'}
                                </Badge>
                                {trigger.type === 'cron' && trigger.cron && (
                                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                                    {trigger.cron}
                                  </Text>
                                )}
                                {trigger.type === 'webhook' && trigger.webhook && (
                                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                                    {trigger.webhook.path}
                                  </Text>
                                )}
                              </Flex>
                              <Text fontSize="xs" color="text.muted" mt={0.5} noOfLines={1}>
                                {trigger.task.slice(0, 100)}
                              </Text>
                            </Box>
                          </Flex>
                          <HStack spacing={2}>
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
              )}
            </TabPanel>

            <TabPanel p={0}>
              {categories.map((category) => (
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
                    {templates.filter((t) => t.category === category).map((tpl) => {
                      const Icon = TRIGGER_ICONS[tpl.trigger.type] ?? Zap;
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
                                  <Badge fontSize="2xs" variant="subtle" colorScheme={CATEGORY_COLORS[tpl.category] ?? 'gray'}>
                                    {tpl.trigger.type}
                                  </Badge>
                                </Flex>
                                <Text fontSize="xs" color="text.muted" mt={0.5} noOfLines={2}>
                                  {tpl.description}
                                </Text>
                              </Box>
                            </Flex>
                            <Box color="text.subtle">
                              <ChevronRight size={16} />
                            </Box>
                          </Flex>

                          {tpl.pipeline && (
                            <Flex mt={2} gap={1} flexWrap="wrap">
                              {tpl.pipeline.steps.map((step, i) => (
                                <Badge key={i} fontSize="2xs" variant="outline" colorScheme="gray">
                                  {step.agentConfig?.name ?? step.agentId}
                                </Badge>
                              ))}
                            </Flex>
                          )}
                        </Card>
                      );
                    })}
                  </VStack>
                </Box>
              ))}
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </Shell>
  );
}

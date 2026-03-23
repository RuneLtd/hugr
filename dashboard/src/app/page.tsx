'use client';

import { Box, Flex, Text, SimpleGrid, Button, Switch, useToast } from '@chakra-ui/react';
import { Shell, Card, PageHeader, StatusBadge, WorkflowVisual } from '@/components';
import { Play, GitBranch, Bot, Clock, Zap, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { describeCronHuman } from '@/lib/cronHelpers';

interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  registeredWorkers: number;
  savedWorkflows: number;
  activeTriggers: number;
  totalTriggers: number;
}

interface RecentSession {
  id: string;
  task: string;
  status: string;
  pipeline: { name: string; steps: Array<{ agentId: string; enabled: boolean }> };
  duration?: number;
  startedAt: string;
}

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ agentId: string; enabled: boolean }>;
}

interface TriggerItem {
  id: string;
  name: string;
  type: 'cron' | 'webhook' | 'poll' | 'watch';
  enabled: boolean;
  task: string;
  workflowId?: string;
  cron?: string;
}

const TYPE_ICONS: Record<string, string> = {
  cron: '⏰',
  webhook: '🌐',
  poll: '📡',
  watch: '👁',
};

export default function OverviewPage() {
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats>({
    activeSessions: 0,
    totalSessions: 0,
    registeredWorkers: 0,
    savedWorkflows: 0,
    activeTriggers: 0,
    totalTriggers: 0,
  });
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [workflowNames, setWorkflowNames] = useState<Record<string, string>>({});
  const [triggerActivity, setTriggerActivity] = useState<Array<{ id: string; type: string; message: string; timestamp: string }>>([]);
  const [triggersRunning, setTriggersRunning] = useState(false);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    fetch('/api/sessions?limit=5')
      .then((r) => r.json())
      .then((data) => setRecent(data.sessions ?? []))
      .catch(() => {});

    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data) => {
        const list: WorkflowItem[] = data.workflows ?? [];
        setWorkflows(list.slice(-5).reverse());
        const names: Record<string, string> = {};
        list.forEach((w) => { names[w.id] = w.name; });
        setWorkflowNames(names);
      })
      .catch(() => {});

    fetch('/api/triggers')
      .then((r) => r.json())
      .then((data) => setTriggers((data.triggers ?? []).slice(-5).reverse()))
      .catch(() => {});

    fetch('/api/workers')
      .then((r) => r.json())
      .then((data) => {
        const names: Record<string, string> = {};
        (data.workers ?? []).forEach((w: { id: string; name: string }) => {
          names[w.id] = w.name;
        });
        setAgentNames(names);
      })
      .catch(() => {});

    fetch('/api/triggers/status')
      .then((r) => r.json())
      .then((data) => {
        setTriggersRunning(data.running ?? false);
        setTriggerActivity(data.recentActivity ?? []);
      })
      .catch(() => {});
  }, []);

  async function toggleTrigger(trigger: TriggerItem) {
    const updated = { ...trigger, enabled: !trigger.enabled };
    try {
      await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setTriggers((prev) => prev.map((t) => (t.id === trigger.id ? updated : t)));
      toast({
        title: `${trigger.name} ${updated.enabled ? 'enabled' : 'disabled'}`,
        status: updated.enabled ? 'success' : 'info',
        duration: 1500,
      });
    } catch {
      toast({ title: 'Failed to update trigger', status: 'error', duration: 2000 });
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Overview"
        subtitle="Monitor your worker workflows"
        actions={
          <Link href="/sessions">
            <Button size="sm" leftIcon={<Play size={14} />}>
              New Session
            </Button>
          </Link>
        }
      />

      <SimpleGrid columns={{ base: 2, md: 3, lg: 6 }} spacing={3} mb={8}>
        <StatCard icon={<Play size={16} />} label="Active Sessions" value={stats.activeSessions} />
        <StatCard icon={<Clock size={16} />} label="Total Sessions" value={stats.totalSessions} />
        <StatCard icon={<Bot size={16} />} label="Workers" value={stats.registeredWorkers} />
        <StatCard icon={<GitBranch size={16} />} label="Workflows" value={stats.savedWorkflows} />
        <StatCard icon={<Zap size={16} />} label="Active Triggers" value={stats.activeTriggers} />
        <StatCard icon={<Zap size={16} />} label="Total Triggers" value={stats.totalTriggers} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4} mb={6}>
        <Box>
          <Flex justify="space-between" align="center" mb={3}>
            <Text fontSize="sm" fontWeight="600" color="text.secondary">
              Recent Workflows
            </Text>
            <Link href="/workflows">
              <Button size="xs" variant="ghost" rightIcon={<ChevronRight size={12} />}>
                All
              </Button>
            </Link>
          </Flex>

          {workflows.length === 0 ? (
            <Card>
              <Flex justify="center" py={6}>
                <Box textAlign="center">
                  <Text fontSize="xs" color="text.subtle" mb={2}>No custom workflows yet</Text>
                  <Link href="/workflows">
                    <Button size="xs" variant="ghost">Create one</Button>
                  </Link>
                </Box>
              </Flex>
            </Card>
          ) : (
            <Flex direction="column" gap={2}>
              {workflows.map((wf) => (
                <Card key={wf.id} py={3} px={4} _hover={{ borderColor: 'border.default' }}>
                  <Flex justify="space-between" align="center">
                    <Box flex={1} minW={0}>
                      <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                        {wf.name}
                      </Text>
                      {wf.description && (
                        <Text fontSize="2xs" color="text.subtle" noOfLines={1} mt={0.5}>
                          {wf.description}
                        </Text>
                      )}
                      <Box mt={2}>
                        <WorkflowVisual steps={wf.steps} agentNames={agentNames} />
                      </Box>
                    </Box>
                    <Link href={`/sessions?workflow=${wf.id}`}>
                      <Button size="xs" variant="ghost" leftIcon={<Play size={12} />}>
                        Run
                      </Button>
                    </Link>
                  </Flex>
                </Card>
              ))}
            </Flex>
          )}
        </Box>

        <Box>
          <Flex justify="space-between" align="center" mb={3}>
            <Text fontSize="sm" fontWeight="600" color="text.secondary">
              Recent Triggers
            </Text>
            <Link href="/triggers">
              <Button size="xs" variant="ghost" rightIcon={<ChevronRight size={12} />}>
                All
              </Button>
            </Link>
          </Flex>

          {triggers.length === 0 ? (
            <Card>
              <Flex justify="center" py={6}>
                <Box textAlign="center">
                  <Text fontSize="xs" color="text.subtle" mb={2}>No triggers configured</Text>
                  <Link href="/triggers">
                    <Button size="xs" variant="ghost">Create one</Button>
                  </Link>
                </Box>
              </Flex>
            </Card>
          ) : (
            <Flex direction="column" gap={2}>
              {triggers.map((trigger) => (
                <Card key={trigger.id} py={3} px={4} _hover={{ borderColor: 'border.default' }}>
                  <Flex justify="space-between" align="center">
                    <Box flex={1} minW={0}>
                      <Flex align="center" gap={2}>
                        <Text fontSize="sm">{TYPE_ICONS[trigger.type] ?? '⚡'}</Text>
                        <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                          {trigger.name}
                        </Text>
                      </Flex>
                      <Flex gap={3} mt={1} align="center">
                        <Text fontSize="2xs" color="text.subtle" textTransform="uppercase" fontWeight="600">
                          {trigger.type}
                        </Text>
                        {trigger.cron && (
                          <Text fontSize="2xs" color="text.subtle">
                            {describeCronHuman(trigger.cron)}
                          </Text>
                        )}
                        {trigger.workflowId && workflowNames[trigger.workflowId] && (
                          <Text fontSize="2xs" color="text.subtle">
                            {workflowNames[trigger.workflowId]}
                          </Text>
                        )}
                      </Flex>
                    </Box>
                    <Switch
                      size="sm"
                      isChecked={trigger.enabled}
                      onChange={() => toggleTrigger(trigger)}
                      colorScheme="green"
                    />
                  </Flex>
                </Card>
              ))}
            </Flex>
          )}
        </Box>
      </SimpleGrid>

      {triggerActivity.length > 0 && (
        <Box mb={6}>
          <Flex justify="space-between" align="center" mb={3}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm" fontWeight="600" color="text.secondary">
                Trigger Activity
              </Text>
              <Box
                w="6px"
                h="6px"
                borderRadius="full"
                bg={triggersRunning ? 'green.400' : 'text.subtle'}
              />
            </Flex>
            <Link href="/triggers">
              <Button size="xs" variant="ghost" rightIcon={<ChevronRight size={12} />}>
                Triggers
              </Button>
            </Link>
          </Flex>
          <Card>
            <Flex direction="column" gap={0} maxH="200px" overflowY="auto">
              {triggerActivity.map((act) => (
                <Flex
                  key={act.id}
                  justify="space-between"
                  align="center"
                  py={2}
                  px={3}
                  borderBottom="1px solid"
                  borderColor="border.subtle"
                  _last={{ borderBottom: 'none' }}
                >
                  <Flex align="center" gap={2} flex={1} minW={0}>
                    <Text fontSize="2xs" color={
                      act.type === 'trigger_fired' ? 'orange.400' :
                      act.type === 'trigger_session_completed' ? 'green.400' :
                      act.type === 'trigger_session_failed' || act.type === 'trigger_error' ? 'red.400' :
                      'text.subtle'
                    } fontWeight="600">
                      {act.type === 'trigger_fired' ? 'FIRED' :
                       act.type === 'trigger_session_completed' ? 'DONE' :
                       act.type === 'trigger_session_failed' ? 'FAILED' :
                       act.type === 'trigger_error' ? 'ERROR' : act.type}
                    </Text>
                    <Text fontSize="xs" color="text.secondary" noOfLines={1}>
                      {act.message}
                    </Text>
                  </Flex>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono" flexShrink={0}>
                    {new Date(act.timestamp).toLocaleTimeString()}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Card>
        </Box>
      )}

      <Box>
        <Flex justify="space-between" align="center" mb={3}>
          <Text fontSize="sm" fontWeight="600" color="text.secondary">
            Recent Sessions
          </Text>
          <Link href="/sessions/history">
            <Button size="xs" variant="ghost" rightIcon={<ChevronRight size={12} />}>
              History
            </Button>
          </Link>
        </Flex>

        {recent.length === 0 ? (
          <Card>
            <Flex justify="center" py={8}>
              <Box textAlign="center">
                <Text fontSize="sm" color="text.subtle" mb={2}>No sessions yet</Text>
                <Link href="/sessions">
                  <Button size="xs" variant="ghost">Run your first workflow</Button>
                </Link>
              </Box>
            </Flex>
          </Card>
        ) : (
          <Flex direction="column" gap={2}>
            {recent.map((session) => (
              <Card key={session.id} py={3} px={4}>
                <Flex justify="space-between" align="center">
                  <Flex direction="column" gap={1} flex={1} minW={0}>
                    <Flex align="center" gap={3}>
                      <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                        {session.task}
                      </Text>
                      <StatusBadge status={session.status} />
                    </Flex>
                    <Flex gap={3} align="center">
                      <Text fontSize="2xs" color="text.subtle">
                        {session.pipeline.name}
                      </Text>
                      {session.duration && (
                        <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                          {Math.round(session.duration / 1000)}s
                        </Text>
                      )}
                    </Flex>
                  </Flex>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                    {new Date(session.startedAt).toLocaleString()}
                  </Text>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Box>
    </Shell>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <Flex direction="column" gap={3}>
        <Box color="text.subtle">
          {icon}
        </Box>
        <Box>
          <Text fontSize="xl" fontWeight="600" color="text.primary" lineHeight={1}>
            {value}
          </Text>
          <Text fontSize="2xs" color="text.muted" mt={1}>
            {label}
          </Text>
        </Box>
      </Flex>
    </Card>
  );
}

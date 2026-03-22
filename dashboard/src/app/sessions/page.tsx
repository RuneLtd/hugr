'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Box, Flex, Text, Button, Input, Textarea, Select, VStack, useToast,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader, StatusBadge, ActivityFeed, WorkflowVisual, type ActivityItem } from '@/components';
import { Play, Square, FolderOpen } from 'lucide-react';
import { WORKFLOW_TEMPLATES } from '@/lib/templates';

interface Workflow {
  id: string;
  name: string;
  steps: Array<{ agentId: string; enabled: boolean; iterations?: number; skipGitTracking?: boolean }>;
}

interface ActiveSession {
  id: string;
  status: string;
  currentPhase: string;
  currentIteration: number;
  task: string;
  pipeline: Workflow;
}

export default function SessionRunnerPage() {
  const toast = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [task, setTask] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);

  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data) => {
        const saved: Workflow[] = data.workflows ?? [];
        const savedIds = new Set(saved.map((w) => w.id));
        const templates: Workflow[] = WORKFLOW_TEMPLATES
          .filter((t) => !savedIds.has(t.id))
          .map((t) => ({ id: t.id, name: t.name, steps: t.steps }));
        const list = [...saved, ...templates];
        setWorkflows(list);
        if (list.length > 0) setSelectedWorkflow(list[0].id);
      })
      .catch(() => {
        const list = WORKFLOW_TEMPLATES.map((t) => ({ id: t.id, name: t.name, steps: t.steps }));
        setWorkflows(list);
        if (list.length > 0) setSelectedWorkflow(list[0].id);
      });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleFolderSelect() {
    setPickingFolder(true);
    try {
      const res = await fetch('/api/folder-picker', { method: 'POST' });
      const data = await res.json();
      if (data.path) setProjectPath(data.path);
    } catch {}
    setPickingFolder(false);
  }

  function startPolling(sessionId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        setActiveSession(data.session);
        setActivities(data.activities ?? []);
        if (data.session?.status === 'completed' || data.session?.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 1000);
  }

  async function startSession() {
    if (!task.trim() || !projectPath.trim()) {
      toast({ title: 'Task and project path are required', status: 'warning', duration: 2000 });
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          projectPath,
          pipelineId: selectedWorkflow,
        }),
      });
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        setActivities([]);
        setAnsweredIds(new Set());
        startPolling(data.session.id);
      }
    } catch {
      toast({ title: 'Failed to start session', status: 'error', duration: 2000 });
    }
  }

  async function stopSession() {
    if (!activeSession) return;
    try {
      await fetch(`/api/sessions/${activeSession.id}/stop`, { method: 'POST' });
      toast({ title: 'Session stopped', status: 'info', duration: 2000 });
    } catch {}
  }

  async function handleRespond(
    activityId: string,
    answers: Array<{ question: string; answer: string; skipped: boolean }>
  ) {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (res.ok) {
        setAnsweredIds((prev) => new Set(prev).add(activityId));
      }
    } catch {}
  }

  const workflow = workflows.find((p) => p.id === selectedWorkflow);

  return (
    <Shell>
      <PageHeader title="Session Runner" subtitle="Configure and run worker workflows" />

      <VStack spacing={4} align="stretch">
        <Card>
          <VStack spacing={4} align="stretch">
              <Box>
                <Text fontSize="xs" color="text.muted" mb={1}>
                  Workflow
                </Text>
                <Select
                  value={selectedWorkflow}
                  onChange={(e) => setSelectedWorkflow(e.target.value)}
                  bg="bg.tertiary"
                  borderColor="border.subtle"
                  size="sm"
                >
                  {workflows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {workflow && (
                  <Box mt={3}>
                    <WorkflowVisual steps={workflow.steps} />
                  </Box>
                )}
              </Box>

              <Box>
                <Text fontSize="xs" color="text.muted" mb={1}>
                  Project Path
                </Text>
                <Flex gap={2}>
                  <Input
                    flex={1}
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="/path/to/your/project"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    px={2}
                    onClick={handleFolderSelect}
                    isLoading={pickingFolder}
                  >
                    <FolderOpen size={16} />
                  </Button>
                </Flex>
              </Box>

              <Box>
                <Text fontSize="xs" color="text.muted" mb={1}>
                  Task
                </Text>
                <Textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="Describe what you want the workers to do..."
                  rows={4}
                  resize="vertical"
                />
              </Box>

              <Flex justify="flex-end" gap={2}>
                {activeSession?.status === 'running' ? (
                  <Button
                    size="sm"
                    colorScheme="red"
                    variant="ghost"
                    leftIcon={<Square size={14} />}
                    onClick={stopSession}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    leftIcon={<Play size={14} />}
                    onClick={startSession}
                    isDisabled={!task.trim() || !projectPath.trim()}
                  >
                    Run Workflow
                  </Button>
                )}
              </Flex>
            </VStack>
        </Card>

        <Card>
            <Flex justify="space-between" align="center" mb={4}>
              <Text fontSize="sm" fontWeight="500" color="text.secondary">
                Live Activity
              </Text>
              {activeSession && (
                <Flex align="center" gap={3}>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                    {activeSession.currentPhase}
                  </Text>
                  <StatusBadge status={activeSession.status} />
                </Flex>
              )}
            </Flex>

            <ActivityFeed items={activities} answeredIds={answeredIds} onRespond={handleRespond} />
          </Card>
      </VStack>
    </Shell>
  );
}

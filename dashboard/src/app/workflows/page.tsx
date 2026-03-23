'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Box, Flex, Text, Button, Input, VStack, HStack,
  Switch, Select, IconButton, useToast,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader, WorkflowVisual } from '@/components';
import { Plus, Trash2, GripVertical, Save, Copy } from 'lucide-react';
import { agentColors } from '@/lib/colors';
import { WORKFLOW_TEMPLATES } from '@/lib/templates';

const BUILT_IN_WORKERS = [
  'architect', 'coder', 'raven', 'reviewer',
  'planner', 'executor', 'validator', 'router', 'aggregator',
];

interface CustomWorker {
  id: string;
  name: string;
}

interface WorkflowStep {
  agentId: string;
  enabled: boolean;
  mode?: string;
  iterations?: number;
  maxIterations?: number;
  loopUntilDone?: boolean;
  skipGitTracking?: boolean;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export default function WorkflowsPage() {
  const toast = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [customWorkers, setCustomWorkers] = useState<CustomWorker[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const agentNames: Record<string, string> = {};
  customWorkers.forEach((w) => { agentNames[w.id] = w.name; });

  function reorderSteps(from: number, to: number) {
    if (!editing || from === to) return;
    const steps = [...editing.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    setEditing({ ...editing, steps });
  }

  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data) => setWorkflows(data.workflows ?? []))
      .catch(() => {});
    fetch('/api/workers')
      .then((r) => r.json())
      .then((data) => setCustomWorkers((data.workers ?? []).map((w: any) => ({ id: w.id, name: w.name }))))
      .catch(() => {});
  }, []);

  function createNew() {
    setEditing({
      id: `workflow-${Date.now()}`,
      name: '',
      steps: [{ agentId: 'coder', enabled: true }],
    });
  }

  function addStep() {
    if (!editing) return;
    setEditing({
      ...editing,
      steps: [...editing.steps, { agentId: 'coder', enabled: true }],
    });
  }

  function removeStep(index: number) {
    if (!editing) return;
    setEditing({
      ...editing,
      steps: editing.steps.filter((_, i) => i !== index),
    });
  }

  function updateStep(index: number, updates: Partial<WorkflowStep>) {
    if (!editing) return;
    const steps = [...editing.steps];
    steps[index] = { ...steps[index], ...updates };
    setEditing({ ...editing, steps });
  }

  async function saveWorkflow() {
    if (!editing || !editing.name.trim()) {
      toast({ title: 'Workflow name is required', status: 'warning', duration: 2000 });
      return;
    }
    try {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      setWorkflows((prev) => {
        const idx = prev.findIndex((p) => p.id === editing.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = editing;
          return next;
        }
        return [...prev, editing];
      });
      setEditing(null);
      toast({ title: 'Workflow saved', status: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Failed to save', status: 'error', duration: 2000 });
    }
  }

  function getStepLabel(agentId: string): string {
    return agentNames[agentId] ?? agentId;
  }

  return (
    <Shell>
      <PageHeader
        title="Workflows"
        subtitle="Build and manage worker workflows"
        actions={
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={createNew}>
            New Workflow
          </Button>
        }
      />

      {editing ? (
        <Card>
          <VStack spacing={5} align="stretch">
            <Flex gap={4}>
              <Box flex={1}>
                <Text fontSize="xs" color="text.muted" mb={1}>
                  Name
                </Text>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="My Workflow"
                />
              </Box>
              <Box flex={2}>
                <Text fontSize="xs" color="text.muted" mb={1}>
                  Description
                </Text>
                <Input
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="What this workflow does..."
                />
              </Box>
            </Flex>

            <Box>
              <Text fontSize="xs" color="text.muted" mb={3}>
                Preview
              </Text>
              <WorkflowVisual steps={editing.steps} agentNames={agentNames} />
            </Box>

            <Box>
              <Flex justify="space-between" align="center" mb={3}>
                <Text fontSize="xs" color="text.muted">
                  Steps
                </Text>
                <Button size="xs" variant="ghost" leftIcon={<Plus size={12} />} onClick={addStep}>
                  Add Step
                </Button>
              </Flex>

              <VStack spacing={2} align="stretch">
                {editing.steps.map((step, i) => {
                  const color = agentColors[step.agentId] ?? '#8a8a8a';
                  return (
                    <Flex
                      key={`${step.agentId}-${i}-${editing.steps.length}`}
                      align="center"
                      gap={3}
                      p={3}
                      bg="bg.tertiary"
                      border="1px solid"
                      borderColor={dragOverIdx === i ? 'text.subtle' : 'border.subtle'}
                      borderRadius="lg"
                      opacity={dragIdx.current === i ? 0.4 : 1}
                      transition="border-color 0.15s, opacity 0.15s"
                      draggable
                      onDragStart={() => { dragIdx.current = i; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                      onDragLeave={() => { if (dragOverIdx === i) setDragOverIdx(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIdx.current !== null) reorderSteps(dragIdx.current, i);
                        dragIdx.current = null;
                        setDragOverIdx(null);
                      }}
                      onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
                    >
                      <Box color="text.subtle" cursor="grab">
                        <GripVertical size={14} />
                      </Box>
                      <Box w="6px" h="6px" borderRadius="full" bg={color} />
                      <Select
                        size="xs"
                        w="180px"
                        value={step.agentId}
                        onChange={(e) => updateStep(i, { agentId: e.target.value })}
                        bg="bg.secondary"
                        borderColor="border.subtle"
                      >
                        <optgroup label="Built-in">
                          {BUILT_IN_WORKERS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </optgroup>
                        {customWorkers.length > 0 && (
                          <optgroup label="Custom Workers">
                            {customWorkers.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>

                      <HStack spacing={2}>
                        <Text fontSize="2xs" color="text.subtle">
                          Iterations:
                        </Text>
                        <Input
                          size="xs"
                          w="50px"
                          type="number"
                          min={1}
                          max={20}
                          value={step.iterations ?? 1}
                          onChange={(e) => updateStep(i, { iterations: parseInt(e.target.value) || 1 })}
                          bg="bg.secondary"
                        />
                      </HStack>

                      {step.agentId === 'coder' && (
                        <HStack spacing={2}>
                          <Text fontSize="2xs" color="text.subtle" whiteSpace="nowrap">
                            Git Tracking
                          </Text>
                          <Switch
                            size="sm"
                            isChecked={!(step.skipGitTracking ?? true)}
                            onChange={(e) => updateStep(i, { skipGitTracking: !e.target.checked })}
                          />
                        </HStack>
                      )}

                      <Flex align="center" gap={2} ml="auto">
                        <Text fontSize="2xs" color="text.subtle">
                          Enabled
                        </Text>
                        <Switch
                          size="sm"
                          isChecked={step.enabled}
                          onChange={(e) => updateStep(i, { enabled: e.target.checked })}
                        />
                        <IconButton
                          aria-label="Remove step"
                          icon={<Trash2 size={14} />}
                          size="xs"
                          variant="ghost"
                          color="text.subtle"
                          _hover={{ color: 'red.400' }}
                          onClick={() => removeStep(i)}
                        />
                      </Flex>
                    </Flex>
                  );
                })}
              </VStack>
            </Box>

            <Flex justify="flex-end" gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" leftIcon={<Save size={14} />} onClick={saveWorkflow}>
                Save Workflow
              </Button>
            </Flex>
          </VStack>
        </Card>
      ) : (
        <>
          {workflows.length > 0 && (
            <Box mb={6}>
              <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={3}>
                Your Workflows
              </Text>
              <VStack spacing={2} align="stretch">
                {workflows.map((workflow) => (
                  <Card
                    key={workflow.id}
                    py={3}
                    px={4}
                    cursor="pointer"
                    _hover={{ borderColor: 'border.default' }}
                    onClick={() => setEditing(workflow)}
                  >
                    <Flex justify="space-between" align="center">
                      <Box>
                        <Text fontSize="sm" fontWeight="500" color="text.primary">
                          {workflow.name}
                        </Text>
                        {workflow.description && (
                          <Text fontSize="xs" color="text.muted" mt={0.5}>
                            {workflow.description}
                          </Text>
                        )}
                      </Box>
                      <WorkflowVisual steps={workflow.steps} agentNames={agentNames} />
                    </Flex>
                  </Card>
                ))}
              </VStack>
            </Box>
          )}

          <Box>
            <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={1}>
              Templates
            </Text>
            <Text fontSize="xs" color="text.subtle" mb={4}>
              Start from a template or create a blank workflow
            </Text>
            {Array.from(new Set(WORKFLOW_TEMPLATES.map((t) => t.category))).map((category) => (
              <Box key={category} mb={5}>
                <Text fontSize="2xs" fontWeight="600" color="text.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={2}>
                  {category}
                </Text>
                <VStack spacing={2} align="stretch">
                  {WORKFLOW_TEMPLATES.filter((t) => t.category === category).map((tpl) => (
                    <Card
                      key={tpl.id}
                      py={3}
                      px={4}
                      cursor="pointer"
                      _hover={{ borderColor: 'border.default' }}
                      onClick={() => setEditing({
                        id: `workflow-${Date.now()}`,
                        name: tpl.name,
                        description: tpl.description,
                        steps: tpl.steps.map((s) => ({ ...s })),
                      })}
                    >
                      <Flex justify="space-between" align="center">
                        <Flex align="center" gap={3} flex={1} minW={0}>
                          <Box color="text.subtle">
                            <Copy size={14} />
                          </Box>
                          <Box flex={1} minW={0}>
                            <Text fontSize="sm" fontWeight="500" color="text.primary">
                              {tpl.name}
                            </Text>
                            <Text fontSize="xs" color="text.muted" mt={0.5} noOfLines={1}>
                              {tpl.description}
                            </Text>
                          </Box>
                        </Flex>
                        <WorkflowVisual steps={tpl.steps} agentNames={agentNames} />
                      </Flex>
                    </Card>
                  ))}
                </VStack>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Shell>
  );
}

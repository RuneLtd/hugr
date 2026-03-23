'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Flex, Text, SimpleGrid, Badge, Button, Input, Textarea, VStack,
  IconButton, Switch, useToast,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader } from '@/components';
import { agentColors } from '@/lib/colors';
import { Plus, Save, Trash2, X, Pencil, ChevronDown, Check, FolderOpen } from 'lucide-react';
import type { ToolDefinition } from '@/lib/providerTools';

interface WorkerInfo {
  id: string;
  name: string;
  type: 'library' | 'preset' | 'custom';
  description: string;
  systemPrompt?: string;
  tools?: string[];
  skills?: string[];
}

const BUILT_IN_WORKERS: WorkerInfo[] = [
  {
    id: 'architect',
    name: 'Architect',
    type: 'library',
    description: 'Analyzes tasks, asks clarifying questions, and produces structured plans for other workers to execute.',
  },
  {
    id: 'coder',
    name: 'Coder',
    type: 'library',
    description: 'Executes implementation tasks using the runtime. Supports self-review and state persistence.',
  },
  {
    id: 'raven',
    name: 'Raven',
    type: 'library',
    description: 'Iterative refinement worker. Reviews output, identifies improvements, loops until quality threshold is met.',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    type: 'library',
    description: 'Final review worker with read-only access. Produces a summary and quality assessment.',
  },
  {
    id: 'planner',
    name: 'Planner',
    type: 'preset',
    description: 'Decomposes objectives into structured step-by-step action plans with effort estimates.',
  },
  {
    id: 'executor',
    name: 'Executor',
    type: 'preset',
    description: 'General-purpose task executor. Runs actions against configured tools and services.',
  },
  {
    id: 'validator',
    name: 'Validator',
    type: 'preset',
    description: 'Validates output against configurable rules and criteria. Can generate fix suggestions on failure.',
  },
  {
    id: 'router',
    name: 'Router',
    type: 'preset',
    description: 'Routes tasks to the right worker via static rules, functions, or LLM-based judgment.',
  },
  {
    id: 'aggregator',
    name: 'Aggregator',
    type: 'preset',
    description: 'Collects results from parallel workers. Supports collect, merge, vote, and summarize strategies.',
  },
];

interface EditingWorker {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  selfReview?: boolean;
  skipGitTracking?: boolean;
}

const EMPTY_WORKER: EditingWorker = {
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  tools: [],
  skills: [],
};

export default function WorkersPage() {
  const toast = useToast();
  const [customWorkers, setCustomWorkers] = useState<WorkerInfo[]>([]);
  const [editing, setEditing] = useState<EditingWorker | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([]);

  useEffect(() => {
    fetch('/api/workers')
      .then((r) => r.json())
      .then((data) => setCustomWorkers(data.workers ?? []))
      .catch(() => {});

    fetch('/api/tools')
      .then((r) => r.json())
      .then((data) => setAvailableTools(data.tools ?? []))
      .catch(() => {});
  }, []);

  function startCreate() {
    setEditing({ ...EMPTY_WORKER, id: `worker-${Date.now()}`, tools: [], skills: [] });
    setIsNew(true);
  }

  function startEdit(worker: WorkerInfo) {
    setEditing({
      id: worker.id,
      name: worker.name,
      description: worker.description,
      systemPrompt: worker.systemPrompt ?? '',
      tools: worker.tools ?? [],
      skills: worker.skills ?? [],
      selfReview: (worker as any).selfReview,
      skipGitTracking: (worker as any).skipGitTracking,
    });
    setIsNew(false);
  }

  function getWorkerType(id: string): WorkerInfo['type'] {
    const builtIn = BUILT_IN_WORKERS.find((w) => w.id === id);
    if (builtIn) return builtIn.type;
    return 'custom';
  }

  async function saveWorker() {
    if (!editing || !editing.name.trim()) {
      toast({ title: 'Worker name is required', status: 'warning', duration: 2000 });
      return;
    }

    const record: WorkerInfo & { selfReview?: boolean; skipGitTracking?: boolean } = {
      id: editing.id,
      name: editing.name.trim(),
      type: getWorkerType(editing.id),
      description: editing.description.trim(),
      systemPrompt: editing.systemPrompt.trim() || undefined,
      tools: editing.tools,
      skills: editing.skills.length > 0 ? editing.skills : undefined,
    };
    if (editing.id === 'coder') {
      record.selfReview = editing.selfReview ?? false;
      record.skipGitTracking = editing.skipGitTracking ?? true;
    }

    try {
      await fetch('/api/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record, createdAt: new Date().toISOString() }),
      });

      setCustomWorkers((prev) => {
        const idx = prev.findIndex((w) => w.id === record.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = record;
          return next;
        }
        return [...prev, record];
      });

      setEditing(null);
      toast({ title: `Worker ${isNew ? 'created' : 'updated'}`, status: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Failed to save', status: 'error', duration: 2000 });
    }
  }

  async function deleteWorker(id: string) {
    try {
      await fetch('/api/workers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setCustomWorkers((prev) => prev.filter((w) => w.id !== id));
      toast({ title: 'Worker deleted', status: 'info', duration: 2000 });
    } catch {
      toast({ title: 'Failed to delete', status: 'error', duration: 2000 });
    }
  }

  const overrideMap = new Map(customWorkers.map((w) => [w.id, w]));
  const mergedBuiltIn = BUILT_IN_WORKERS.map((w) => {
    const override = overrideMap.get(w.id);
    return override ? { ...w, ...override, type: w.type } : w;
  });
  const custom = customWorkers.filter((w) => !BUILT_IN_WORKERS.some((b) => b.id === w.id));
  const libraryWorkers = mergedBuiltIn.filter((a) => a.type === 'library');
  const presetWorkers = mergedBuiltIn.filter((a) => a.type === 'preset');

  return (
    <Shell>
      <PageHeader
        title="Workers"
        subtitle="Available workers for workflow composition"
        actions={
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={startCreate}>
            New Worker
          </Button>
        }
      />

      {editing && (
        <Card mb={6}>
          <Flex justify="space-between" align="center" mb={4}>
            <Text fontSize="sm" fontWeight="600" color="text.secondary">
              {isNew ? 'Create Worker' : 'Edit Worker'}
            </Text>
            <IconButton
              aria-label="Close"
              icon={<X size={14} />}
              size="xs"
              variant="ghost"
              onClick={() => setEditing(null)}
            />
          </Flex>

          <VStack spacing={4} align="stretch">
            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>
                Name
              </Text>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Content Writer, Data Processor, Email Handler"
              />
            </Box>

            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>
                Description
              </Text>
              <Input
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="What does this worker do?"
              />
            </Box>

            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>
                System Prompt
              </Text>
              <Textarea
                value={editing.systemPrompt}
                onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                placeholder="Instructions that define this worker's behaviour, role, and constraints..."
                rows={5}
                resize="vertical"
              />
            </Box>

            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>
                Tools
              </Text>
              <ToolMultiSelect
                available={availableTools}
                selected={editing.tools}
                onChange={(tools) => setEditing({ ...editing, tools })}
              />
            </Box>

            <Box>
              <Text fontSize="xs" color="text.muted" mb={1}>
                Skills
              </Text>
              <SkillFilePicker
                skills={editing.skills}
                onChange={(skills) => setEditing({ ...editing, skills })}
              />
            </Box>

            {editing.id === 'coder' && (
              <Box>
                <Text fontSize="xs" color="text.muted" mb={2}>
                  Coder Settings
                </Text>
                <Flex p={3} bg="bg.tertiary" borderRadius="lg" border="1px solid" borderColor="border.subtle" justify="space-between" align="center">
                  <Box flex={1}>
                    <Text fontSize="xs" color="text.primary">Self Review</Text>
                    <Text fontSize="2xs" color="text.subtle">Run a second pass to review written code</Text>
                  </Box>
                  <Switch
                    size="md"
                    flexShrink={0}
                    sx={{ '& .chakra-switch__track': { bg: 'gray.300', _dark: { bg: 'whiteAlpha.300' } }, '& .chakra-switch__track[data-checked]': { bg: 'green.500', _dark: { bg: 'green.500' } } }}
                    isChecked={editing.selfReview ?? false}
                    onChange={(e) => setEditing({ ...editing, selfReview: e.target.checked })}
                  />
                </Flex>
              </Box>
            )}

            <Flex justify="flex-end" gap={2}>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" leftIcon={<Save size={14} />} onClick={saveWorker}>
                {isNew ? 'Create Worker' : 'Save Changes'}
              </Button>
            </Flex>
          </VStack>
        </Card>
      )}

      {custom.length > 0 && (
        <WorkerSection
          title="Custom Workers"
          workers={custom}
          subtitle="Your custom-defined workers"
          onEdit={startEdit}
          onDelete={deleteWorker}
        />
      )}

      <WorkerSection title="Library Workers" workers={libraryWorkers} subtitle="Full-featured workers with built-in logic" onEdit={startEdit} />
      <WorkerSection title="Preset Workers" workers={presetWorkers} subtitle="Reusable building blocks for workflows" onEdit={startEdit} />
    </Shell>
  );
}

function WorkerSection({
  title,
  subtitle,
  workers,
  onEdit,
  onDelete,
}: {
  title: string;
  subtitle: string;
  workers: WorkerInfo[];
  onEdit?: (worker: WorkerInfo) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <Box mb={8}>
      <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={1}>
        {title}
      </Text>
      <Text fontSize="xs" color="text.subtle" mb={4}>
        {subtitle}
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={3}>
        {workers.map((worker) => {
          const color = agentColors[worker.id] ?? '#8a8a8a';
          return (
            <Card key={worker.id} py={4}>
              <Flex align="center" gap={3} mb={3}>
                <Box w="8px" h="8px" borderRadius="full" bg={color} />
                <Text fontSize="sm" fontWeight="600" color="text.primary">
                  {worker.name}
                </Text>
                <Flex ml="auto" gap={1} align="center">
                  {onEdit && (
                    <IconButton
                      aria-label="Edit worker"
                      icon={<Pencil size={12} />}
                      size="xs"
                      variant="ghost"
                      color="text.subtle"
                      _hover={{ color: 'text.primary' }}
                      onClick={() => onEdit(worker)}
                    />
                  )}
                  {onDelete && (
                    <IconButton
                      aria-label="Delete worker"
                      icon={<Trash2 size={12} />}
                      size="xs"
                      variant="ghost"
                      color="text.subtle"
                      _hover={{ color: 'red.400' }}
                      onClick={() => onDelete(worker.id)}
                    />
                  )}
                  <Badge
                    px={2}
                    py={0.5}
                    borderRadius="md"
                    bg="overlay.soft"
                    color="text.subtle"
                    fontSize="10px"
                  >
                    {worker.type}
                  </Badge>
                </Flex>
              </Flex>
              <Text fontSize="xs" color="text.secondary">
                {worker.description}
              </Text>
            </Card>
          );
        })}
      </SimpleGrid>
    </Box>
  );
}

function ToolMultiSelect({
  available,
  selected,
  onChange,
}: {
  available: ToolDefinition[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolDefinition[]>();
    for (const tool of available) {
      const list = map.get(tool.provider) ?? [];
      list.push(tool);
      map.set(tool.provider, list);
    }
    return map;
  }, [available]);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((t) => t !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const selectedTools = available.filter((t) => selected.includes(t.id));

  return (
    <Box position="relative" ref={ref}>
      <Box
        border="1px solid"
        borderColor="border.subtle"
        borderRadius="md"
        px={3}
        py={2}
        cursor="pointer"
        onClick={() => setOpen(!open)}
        bg="bg.secondary"
        _hover={{ borderColor: 'border.default' }}
        minH="38px"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
      >
        {selectedTools.length === 0 ? (
          <Text fontSize="sm" color="text.subtle">
            Select tools...
          </Text>
        ) : (
          <Flex gap={1.5} flexWrap="wrap" flex={1}>
            {selectedTools.map((tool) => (
              <Badge
                key={tool.id}
                px={2}
                py={0.5}
                borderRadius="md"
                bg="bg.tertiary"
                color="text.muted"
                fontSize="10px"
                fontWeight="500"
                textTransform="none"
                display="flex"
                alignItems="center"
                gap={1}
              >
                {tool.name}
                <Box
                  as="span"
                  cursor="pointer"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    toggle(tool.id);
                  }}
                  _hover={{ color: 'text.primary' }}
                >
                  <X size={10} />
                </Box>
              </Badge>
            ))}
          </Flex>
        )}
        <Box ml={2} flexShrink={0}>
          <ChevronDown size={14} color="var(--chakra-colors-text-subtle)" />
        </Box>
      </Box>

      {open && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={1}
          bg="bg.secondary"
          border="1px solid"
          borderColor="border.subtle"
          borderRadius="md"
          maxH="280px"
          overflowY="auto"
          zIndex={20}
          py={1}
          sx={{
            '&::-webkit-scrollbar': { width: '6px' },
            '&::-webkit-scrollbar-track': { bg: 'transparent' },
            '&::-webkit-scrollbar-thumb': { bg: 'scrollbar.thumb', borderRadius: '3px' },
          }}
        >
          {Array.from(grouped.entries()).map(([provider, tools]) => (
            <Box key={provider}>
              <Text
                fontSize="10px"
                fontWeight="600"
                color="text.subtle"
                textTransform="uppercase"
                letterSpacing="0.05em"
                px={3}
                pt={2}
                pb={1}
              >
                {provider}
              </Text>
              {tools.map((tool) => {
                const isSelected = selected.includes(tool.id);
                return (
                  <Flex
                    key={tool.id}
                    align="center"
                    gap={2}
                    px={3}
                    py={1.5}
                    cursor="pointer"
                    _hover={{ bg: 'overlay.hover' }}
                    onClick={() => toggle(tool.id)}
                  >
                    <Box w="16px" h="16px" display="flex" alignItems="center" justifyContent="center">
                      {isSelected && <Check size={12} color="var(--chakra-colors-text-primary)" />}
                    </Box>
                    <Box flex={1}>
                      <Text fontSize="xs" color="text.primary">
                        {tool.name}
                      </Text>
                      <Text fontSize="10px" color="text.subtle">
                        {tool.description}
                      </Text>
                    </Box>
                  </Flex>
                );
              })}
            </Box>
          ))}
          {available.length === 0 && (
            <Text fontSize="xs" color="text.subtle" px={3} py={2}>
              No tools available. Configure a provider in Settings.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function SkillFilePicker({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (skills: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);

  async function openFilePicker() {
    if (picking) return;
    setPicking(true);
    try {
      const res = await fetch('/api/file-picker', { method: 'POST' });
      const data = await res.json();
      if (!data.cancelled && data.paths?.length > 0) {
        const unique = new Set(skills);
        for (const p of data.paths) {
          unique.add(p);
        }
        onChange(Array.from(unique));
      }
    } catch {} finally {
      setPicking(false);
    }
  }

  function removeSkill(path: string) {
    onChange(skills.filter((s) => s !== path));
  }

  function fileName(path: string) {
    return path.split('/').pop() ?? path;
  }

  return (
    <Box>
      {skills.length > 0 && (
        <VStack spacing={1.5} align="stretch" mb={2}>
          {skills.map((skill) => (
            <Flex
              key={skill}
              align="center"
              gap={2}
              px={3}
              py={1.5}
              bg="bg.tertiary"
              borderRadius="md"
              border="1px solid"
              borderColor="border.subtle"
            >
              <Text fontSize="xs" fontWeight="500" color="text.primary" isTruncated>
                {fileName(skill)}
              </Text>
              <Text fontSize="10px" color="text.subtle" flex={1} isTruncated>
                {skill}
              </Text>
              <Box
                as="span"
                cursor="pointer"
                flexShrink={0}
                color="text.subtle"
                onClick={() => removeSkill(skill)}
                _hover={{ color: 'text.primary' }}
              >
                <X size={12} />
              </Box>
            </Flex>
          ))}
        </VStack>
      )}
      <Button
        size="sm"
        variant="ghost"
        leftIcon={<FolderOpen size={14} />}
        onClick={openFilePicker}
        isLoading={picking}
        loadingText="Selecting..."
      >
        Browse for skill files
      </Button>
    </Box>
  );
}

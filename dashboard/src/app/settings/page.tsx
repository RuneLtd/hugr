'use client';

import { useState, useEffect } from 'react';
import {
  Box, Flex, Text, Input, VStack, Button, Badge, useToast, useColorMode,
} from '@chakra-ui/react';
import { Shell, Card, PageHeader } from '@/components';
import { Save, CheckCircle, XCircle, Sun, Moon, Monitor, FolderOpen } from 'lucide-react';

interface RuntimeStatus {
  claudeCode: { available: boolean; version?: string };
}

interface ProviderConfig {
  id: string;
  name: string;
  keyField: string;
  placeholder: string;
  enabled: boolean;
  hasKey: boolean;
}

const PROVIDERS: Omit<ProviderConfig, 'enabled' | 'hasKey'>[] = [
  { id: 'openai', name: 'OpenAI', keyField: 'OPENAI_API_KEY', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', keyField: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  { id: 'gemini', name: 'Google Gemini', keyField: 'GEMINI_API_KEY', placeholder: 'AIza...' },
  { id: 'mistral', name: 'Mistral', keyField: 'MISTRAL_API_KEY', placeholder: '' },
  { id: 'xai', name: 'xAI (Grok)', keyField: 'XAI_API_KEY', placeholder: 'xai-...' },
  { id: 'groq', name: 'Groq', keyField: 'GROQ_API_KEY', placeholder: 'gsk_...' },
  { id: 'bedrock', name: 'AWS Bedrock', keyField: 'AWS_ACCESS_KEY_ID', placeholder: 'AKIA...' },
];

const THEME_MODES = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
] as const;

export default function SettingsPage() {
  const toast = useToast();
  const { colorMode, setColorMode } = useColorMode();
  const [runtime, setRuntime] = useState<RuntimeStatus>({ claudeCode: { available: false } });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [providerState, setProviderState] = useState<Record<string, { enabled: boolean; hasKey: boolean }>>({});
  const [activeThemeMode, setActiveThemeMode] = useState<string>('system');
  const [dataPath, setDataPath] = useState('');
  const [pickingDataPath, setPickingDataPath] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chakra-ui-color-mode');
      if (saved === 'light' || saved === 'dark') {
        setActiveThemeMode(saved);
      } else {
        setActiveThemeMode('system');
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/settings/runtime')
      .then((r) => r.json())
      .then(setRuntime)
      .catch(() => {});

    fetch('/api/settings/providers')
      .then((r) => r.json())
      .then((data) => setProviderState(data.providers ?? {}))
      .catch(() => {});

    fetch('/api/settings/data-path')
      .then((r) => r.json())
      .then((data) => {
        setDataPath(data.hugrHome ?? '');
      })
      .catch(() => {});
  }, []);

  function handleThemeMode(mode: string) {
    setActiveThemeMode(mode);
    if (mode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setColorMode(prefersDark ? 'dark' : 'light');
      try { localStorage.removeItem('chakra-ui-color-mode'); } catch {}
    } else {
      setColorMode(mode as 'light' | 'dark');
    }
  }

  async function changeDataPath() {
    setPickingDataPath(true);
    try {
      const pickerRes = await fetch('/api/folder-picker', { method: 'POST' });
      const pickerData = await pickerRes.json();
      if (!pickerData.path) {
        setPickingDataPath(false);
        return;
      }
      const res = await fetch('/api/settings/data-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hugrHome: pickerData.path }),
      });
      const data = await res.json();
      if (data.success) {
        setDataPath(data.paths.hugrHome);
        toast({ title: 'Data path updated', status: 'success', duration: 2000 });
      } else {
        toast({ title: data.error || 'Invalid path', status: 'error', duration: 2000 });
      }
    } catch {
      toast({ title: 'Failed to update path', status: 'error', duration: 2000 });
    }
    setPickingDataPath(false);
  }

  async function saveKey(providerId: string) {
    const key = keys[providerId];
    if (!key?.trim()) return;

    try {
      await fetch('/api/settings/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey: key }),
      });
      setProviderState((prev) => ({
        ...prev,
        [providerId]: { enabled: true, hasKey: true },
      }));
      setKeys((prev) => ({ ...prev, [providerId]: '' }));
      toast({ title: `${providerId} key saved`, status: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Failed to save', status: 'error', duration: 2000 });
    }
  }

  return (
    <Shell>
      <PageHeader title="Settings" subtitle="Theme, runtime and API keys" />

      <Card mb={6}>
        <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={4}>
          Appearance
        </Text>

        <Text fontSize="xs" color="text.muted" mb={3}>
          Theme
        </Text>
        <Flex gap={2} mb={5}>
          {THEME_MODES.map(({ id, label, icon: Icon }) => (
            <Flex
              key={id}
              as="button"
              align="center"
              gap={2}
              px={4}
              py={2}
              borderRadius="lg"
              border="1px solid"
              borderColor={activeThemeMode === id ? 'border.strong' : 'border.subtle'}
              bg={activeThemeMode === id ? 'overlay.strong' : 'transparent'}
              color={activeThemeMode === id ? 'text.primary' : 'text.muted'}
              transition="all 0.15s"
              _hover={{ bg: 'overlay.hover', color: 'text.primary' }}
              onClick={() => handleThemeMode(id)}
            >
              <Icon size={14} />
              <Text fontSize="xs" fontWeight="500">
                {label}
              </Text>
            </Flex>
          ))}
        </Flex>

      </Card>

      <Card mb={6}>
        <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={4}>
          Data Storage
        </Text>
        <Text fontSize="xs" color="text.subtle" mb={4}>
          Location where hugr stores sessions, pipelines, and dashboard state.
        </Text>

        <Flex
          align="center"
          gap={3}
          p={4}
          bg="bg.tertiary"
          borderRadius="lg"
          border="1px solid"
          borderColor="border.subtle"
        >
          <Flex
            w="40px"
            h="40px"
            borderRadius="lg"
            bg="rgba(99, 102, 241, 0.08)"
            align="center"
            justify="center"
            flexShrink={0}
          >
            <FolderOpen size={20} color="#6366f1" />
          </Flex>

          <Flex flex={1} align="center" justify="space-between">
            <Box>
              <Text fontSize="sm" fontWeight="500" color="text.primary">
                hugr home
              </Text>
              <Text fontSize="xs" color="text.muted" fontFamily="mono">
                {dataPath || '~/.hugr'}
              </Text>
            </Box>
            <Button
              size="xs"
              variant="ghost"
              onClick={changeDataPath}
              isLoading={pickingDataPath}
            >
              Change
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Card mb={6}>
        <Flex justify="space-between" align="center" mb={4}>
          <Text fontSize="sm" fontWeight="600" color="text.secondary">
            Default Runtime
          </Text>
          <Badge
            px={2}
            py={0.5}
            borderRadius="md"
            color={runtime.claudeCode.available ? '#22c55e' : '#ef4444'}
            bg={runtime.claudeCode.available ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)'}
            fontSize="11px"
          >
            {runtime.claudeCode.available ? 'Connected' : 'Not Found'}
          </Badge>
        </Flex>

        <Flex
          align="center"
          gap={3}
          p={4}
          bg="bg.tertiary"
          borderRadius="lg"
          border="1px solid"
          borderColor="border.subtle"
        >
          <Flex
            w="40px"
            h="40px"
            borderRadius="lg"
            bg={runtime.claudeCode.available ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.08)'}
            align="center"
            justify="center"
          >
            {runtime.claudeCode.available ? (
              <CheckCircle size={20} color="#22c55e" />
            ) : (
              <XCircle size={20} color="#ef4444" />
            )}
          </Flex>
          <Box>
            <Text fontSize="sm" fontWeight="500" color="text.primary">
              Claude Code
            </Text>
            <Text fontSize="xs" color="text.muted">
              {runtime.claudeCode.available
                ? `Detected${runtime.claudeCode.version ? ` (v${runtime.claudeCode.version})` : ''}`
                : 'Install Claude Code CLI to use as default runtime'}
            </Text>
          </Box>
        </Flex>
      </Card>

      <Card>
        <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={4}>
          Provider API Keys
        </Text>
        <Text fontSize="xs" color="text.subtle" mb={5}>
          Add API keys for providers you want to use with custom runtimes. Keys are stored locally.
        </Text>

        <VStack spacing={3} align="stretch">
          {PROVIDERS.map((provider) => {
            const state = providerState[provider.id] ?? { enabled: false, hasKey: false };
            return (
              <Flex
                key={provider.id}
                align="center"
                gap={4}
                p={4}
                bg="bg.tertiary"
                borderRadius="lg"
                border="1px solid"
                borderColor="border.subtle"
              >
                <Box flex={1}>
                  <Flex align="center" gap={2} mb={1}>
                    <Text fontSize="sm" fontWeight="500" color="text.primary">
                      {provider.name}
                    </Text>
                    {state.hasKey && (
                      <Badge
                        px={1.5}
                        py={0}
                        borderRadius="sm"
                        bg="rgba(34, 197, 94, 0.12)"
                        color="#22c55e"
                        fontSize="10px"
                      >
                        configured
                      </Badge>
                    )}
                  </Flex>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                    {provider.keyField}
                  </Text>
                </Box>

                <Flex align="center" gap={2} minW="300px">
                  <Input
                    size="xs"
                    type="password"
                    value={keys[provider.id] ?? ''}
                    onChange={(e) => setKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                    placeholder={state.hasKey ? '••••••••' : provider.placeholder}
                    flex={1}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => saveKey(provider.id)}
                    isDisabled={!keys[provider.id]?.trim()}
                  >
                    <Save size={14} />
                  </Button>
                </Flex>
              </Flex>
            );
          })}
        </VStack>
      </Card>
    </Shell>
  );
}

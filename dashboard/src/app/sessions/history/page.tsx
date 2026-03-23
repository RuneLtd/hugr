'use client';

import { useState, useEffect } from 'react';
import { Box, Flex, Text, VStack } from '@chakra-ui/react';
import { Shell, Card, PageHeader, StatusBadge, WorkerBadge, WorkflowVisual } from '@/components';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SessionRecord {
  id: string;
  task: string;
  status: string;
  pipeline: {
    name: string;
    steps: Array<{ agentId: string; enabled: boolean; iterations?: number }>;
  };
  duration?: number;
  startedAt: string;
  completedAt?: string;
  iterations?: number;
  stepResults?: Array<{ agentName: string; summary: string }>;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/sessions?limit=50')
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
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
  }, []);

  return (
    <Shell>
      <PageHeader title="Session History" subtitle="Past session runs and results" />

      {sessions.length === 0 ? (
        <Card>
          <Flex justify="center" py={10}>
            <Text fontSize="sm" color="text.subtle">
              No session history
            </Text>
          </Flex>
        </Card>
      ) : (
        <VStack spacing={2} align="stretch">
          {sessions.map((session) => {
            const isExpanded = expanded === session.id;
            return (
              <Card
                key={session.id}
                py={3}
                px={4}
                cursor="pointer"
                _hover={{ borderColor: 'border.default' }}
                onClick={() => setExpanded(isExpanded ? null : session.id)}
              >
                <Flex justify="space-between" align="center">
                  <Flex align="center" gap={3} flex={1} minW={0}>
                    <Box color="text.subtle">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </Box>
                    <Box flex={1} minW={0}>
                      <Flex align="center" gap={3}>
                        <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1}>
                          {session.task}
                        </Text>
                        <StatusBadge status={session.status} />
                      </Flex>
                      <Flex gap={3} mt={1} align="center">
                        <Text fontSize="2xs" color="text.subtle">
                          {session.pipeline.name}
                        </Text>
                        {session.duration && (
                          <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                            {Math.round(session.duration / 1000)}s
                          </Text>
                        )}
                        {session.iterations && session.iterations > 0 && (
                          <Text fontSize="2xs" color="text.subtle">
                            {session.iterations} iterations
                          </Text>
                        )}
                      </Flex>
                    </Box>
                  </Flex>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono" flexShrink={0}>
                    {new Date(session.startedAt).toLocaleString()}
                  </Text>
                </Flex>

                {isExpanded && (
                  <Box mt={4} pt={4} borderTop="1px solid" borderColor="border.subtle">
                    <Box mb={4}>
                      <Text fontSize="xs" color="text.muted" mb={2}>
                        Workflow
                      </Text>
                      <WorkflowVisual steps={session.pipeline.steps} agentNames={agentNames} />
                    </Box>

                    {session.stepResults && session.stepResults.length > 0 && (
                      <Box>
                        <Text fontSize="xs" color="text.muted" mb={2}>
                          Worker Results
                        </Text>
                        <VStack spacing={2} align="stretch">
                          {session.stepResults.map((result, i) => (
                            <Box
                              key={`${result.agentName}-${i}`}
                              p={3}
                              bg="bg.tertiary"
                              borderRadius="lg"
                              border="1px solid"
                              borderColor="border.subtle"
                            >
                              <WorkerBadge name={result.agentName} />
                              <Text fontSize="xs" color="text.secondary" mt={2}>
                                {result.summary}
                              </Text>
                            </Box>
                          ))}
                        </VStack>
                      </Box>
                    )}

                    <Flex justify="flex-end" mt={4}>
                      <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                        {session.id}
                      </Text>
                    </Flex>
                  </Box>
                )}
              </Card>
            );
          })}
        </VStack>
      )}
    </Shell>
  );
}

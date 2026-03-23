'use client';

import { Box, Flex, Text, SimpleGrid, Button } from '@chakra-ui/react';
import { Shell, Card, PageHeader, StatusBadge } from '@/components';
import { Play, GitBranch, Bot, Clock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  registeredWorkers: number;
  savedWorkflows: number;
}

interface RecentSession {
  id: string;
  task: string;
  status: string;
  pipeline: { name: string; steps: Array<{ agentId: string; enabled: boolean }> };
  duration?: number;
  startedAt: string;
}

export default function OverviewPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeSessions: 0,
    totalSessions: 0,
    registeredWorkers: 0,
    savedWorkflows: 0,
  });
  const [recent, setRecent] = useState<RecentSession[]>([]);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch((err) => console.warn('Failed to fetch stats:', err));

    fetch('/api/sessions?limit=5')
      .then((r) => r.json())
      .then((data) => setRecent(data.sessions ?? []))
      .catch((err) => console.warn('Failed to fetch sessions:', err));
  }, []);

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

      <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4} mb={8}>
        <StatCard
          icon={<Play size={16} />}
          label="Active Sessions"
          value={stats.activeSessions}
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Total Sessions"
          value={stats.totalSessions}
        />
        <StatCard
          icon={<Bot size={16} />}
          label="Registered Workers"
          value={stats.registeredWorkers}
        />
        <StatCard
          icon={<GitBranch size={16} />}
          label="Saved Workflows"
          value={stats.savedWorkflows}
        />
      </SimpleGrid>

      <Text fontSize="sm" fontWeight="600" color="text.secondary" mb={4}>
        Recent Sessions
      </Text>

      {recent.length === 0 ? (
        <Card>
          <Flex justify="center" py={10}>
            <Box textAlign="center">
              <Text fontSize="sm" color="text.subtle" mb={2}>
                No sessions yet
              </Text>
              <Link href="/sessions">
                <Button size="xs" variant="ghost">
                  Run your first workflow
                </Button>
              </Link>
            </Box>
          </Flex>
        </Card>
      ) : (
        <Flex direction="column" gap={2}>
          {recent.map((session) => (
            <Card key={session.id} py={3} px={4}>
              <Flex justify="space-between" align="center">
                <Flex direction="column" gap={1}>
                  <Flex align="center" gap={3}>
                    <Text fontSize="sm" fontWeight="500" color="text.primary" noOfLines={1} maxW="400px">
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

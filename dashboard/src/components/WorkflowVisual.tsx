'use client';

import { Flex, Box, Text } from '@chakra-ui/react';
import { ChevronRight } from 'lucide-react';
import { agentColors } from '@/lib/colors';

interface WorkflowStep {
  agentId: string;
  enabled: boolean;
  mode?: string;
  iterations?: number;
}

interface WorkflowVisualProps {
  steps: WorkflowStep[];
  agentNames?: Record<string, string>;
}

export function WorkflowVisual({ steps, agentNames }: WorkflowVisualProps) {
  const enabledSteps = steps.filter((s) => s.enabled !== false);

  return (
    <Flex align="center" gap={0} flexWrap="wrap">
      {enabledSteps.map((step, i) => {
        const color = agentColors[step.agentId] ?? agentColors.coder;
        const displayName = agentNames?.[step.agentId] ?? step.agentId;

        return (
          <Flex key={step.agentId + i} align="center" gap={0}>
            <Flex
              align="center"
              gap={2}
              px={3}
              py={1.5}
              bg="bg.tertiary"
              border="1px solid"
              borderColor="border.subtle"
              borderRadius="lg"
            >
              <Box w="6px" h="6px" borderRadius="full" bg={color} />
              <Text fontSize="xs" fontWeight="500" color="text.secondary">
                {displayName}
              </Text>
              {step.iterations && step.iterations > 1 && (
                <Text fontSize="2xs" color="text.subtle">
                  ×{step.iterations}
                </Text>
              )}
            </Flex>
            {i < enabledSteps.length - 1 && (
              <Box px={1} color="text.subtle">
                <ChevronRight size={14} />
              </Box>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
}

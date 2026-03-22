'use client';

import { Flex, Text, Box } from '@chakra-ui/react';
import { agentColors } from '@/lib/colors';

export function WorkerBadge({ name }: { name: string }) {
  const color = agentColors[name.toLowerCase()] ?? agentColors.coder;

  return (
    <Flex align="center" gap={2}>
      <Box w="6px" h="6px" borderRadius="full" bg={color} />
      <Text fontSize="xs" fontWeight="500" color="text.secondary">
        {name}
      </Text>
    </Flex>
  );
}

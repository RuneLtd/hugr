'use client';

import { Flex, Box } from '@chakra-ui/react';
import { Sidebar } from './Sidebar';
import { HelperChat } from './HelperChat';

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Flex h="100vh" overflow="hidden">
      <Sidebar />
      <Box
        flex={1}
        overflow="auto"
        bg="bg.primary"
        px={8}
        py={6}
      >
        <Box maxW="1200px" mx="auto">
          {children}
        </Box>
      </Box>
      <HelperChat />
    </Flex>
  );
}

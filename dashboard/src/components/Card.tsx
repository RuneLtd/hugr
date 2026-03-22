'use client';

import { Box, type BoxProps } from '@chakra-ui/react';

export function Card({ children, ...props }: BoxProps) {
  return (
    <Box
      bg="bg.cards"
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="xl"
      p={5}
      {...props}
    >
      {children}
    </Box>
  );
}

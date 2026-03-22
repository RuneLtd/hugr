'use client';

import { Box, Flex, Text } from '@chakra-ui/react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Flex justify="space-between" align="center" mb={6} pt={2}>
      <Box>
        <Text fontSize="xl" fontWeight="600" color="text.primary" lineHeight={1.2}>
          {title}
        </Text>
        {subtitle && (
          <Text fontSize="xs" color="text.muted" mt={1.5}>
            {subtitle}
          </Text>
        )}
      </Box>
      {actions && <Flex gap={2}>{actions}</Flex>}
    </Flex>
  );
}

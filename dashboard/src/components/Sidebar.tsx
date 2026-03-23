'use client';

import { useEffect } from 'react';
import { Box, Flex, Text, VStack, useColorModeValue, Image } from '@chakra-ui/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  GitBranch,
  Play,
  History,
  Bot,
  Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/sessions', label: 'Sessions', icon: Play },
  { href: '/sessions/history', label: 'History', icon: History },
  { href: '/workers', label: 'Workers', icon: Bot },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const logoFilter = useColorModeValue('none', 'invert(1)');

  useEffect(() => {
    NAV_ITEMS.forEach(({ href }) => {
      router.prefetch(href);
    });
  }, [router]);

  return (
    <Flex
      as="nav"
      direction="column"
      w="220px"
      minW="220px"
      h="100vh"
      bg="bg.secondary"
      borderRight="1px solid"
      borderColor="border.subtle"
      py={6}
      px={3}
    >
      <Flex px={2} mb={8} align="center" gap={2}>
        <Image
          src="/hugr.svg"
          alt="hugr"
          h="22px"
          w="auto"
          filter={logoFilter}
        />
        <Text fontSize="xs" color="text.subtle" fontWeight="400">
          dashboard
        </Text>
      </Flex>

      <VStack spacing={0.5} align="stretch">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/' ? pathname === '/' : pathname === href;

          return (
            <Link key={href} href={href} prefetch={true}>
              <Flex
                align="center"
                gap={3}
                px={3}
                py={2}
                borderRadius="xl"
                bg={isActive ? 'overlay.soft' : 'transparent'}
                color={isActive ? 'text.primary' : 'text.muted'}
                transition="all 0.15s"
                _hover={{ bg: 'overlay.hover', color: 'text.primary' }}
              >
                <Icon size={16} />
                <Text fontSize="sm" fontWeight={isActive ? '500' : '400'}>
                  {label}
                </Text>
              </Flex>
            </Link>
          );
        })}
      </VStack>

      <Box mt="auto" px={2}>
        <Text fontSize="2xs" color="text.subtle">
          v0.1.0
        </Text>
      </Box>
    </Flex>
  );
}

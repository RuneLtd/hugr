'use client';

import { Badge } from '@chakra-ui/react';

const STATUS_MAP: Record<string, { color: string; bg: string }> = {
  running: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)' },
  completed: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)' },
  failed: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  paused: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  idle: { color: '#6b6b6b', bg: 'rgba(107, 107, 107, 0.12)' },
  session_limited: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_MAP[status] ?? STATUS_MAP.idle;

  return (
    <Badge
      px={2}
      py={0.5}
      borderRadius="md"
      color={style.color}
      bg={style.bg}
      fontSize="11px"
    >
      {status}
    </Badge>
  );
}

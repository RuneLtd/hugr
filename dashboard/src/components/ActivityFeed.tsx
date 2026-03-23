'use client';

import { useState } from 'react';
import { Box, Flex, Text, VStack, Button, Input, Wrap, WrapItem } from '@chakra-ui/react';
import { Send, MessageCircleQuestion, Check } from 'lucide-react';

export interface ActivityItem {
  id: string;
  type: string;
  message: string;
  agentId: string;
  timestamp: string;
  details?: string;
}

interface ClarificationQuestion {
  question: string;
  reason?: string;
  options?: string[];
  defaultAnswer?: string;
}

function ClarificationInline({
  questions,
  onSubmit,
  answered,
}: {
  questions: ClarificationQuestion[];
  onSubmit: (answers: Array<{ question: string; answer: string; skipped: boolean }>) => void;
  answered: boolean;
}) {
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = questions.every(
    (_, i) => selections[i] || customInputs[i]?.trim()
  );

  function selectOption(qIdx: number, option: string) {
    setSelections((prev) => ({ ...prev, [qIdx]: option }));
    setShowCustom((prev) => ({ ...prev, [qIdx]: false }));
    setCustomInputs((prev) => ({ ...prev, [qIdx]: '' }));
  }

  function toggleCustom(qIdx: number) {
    setShowCustom((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }));
    setSelections((prev) => {
      const next = { ...prev };
      delete next[qIdx];
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    const answers = questions.map((q, i) => ({
      question: q.question,
      answer: selections[i] || customInputs[i]?.trim() || q.defaultAnswer || '',
      skipped: !selections[i] && !customInputs[i]?.trim(),
    }));
    onSubmit(answers);
  }

  if (answered) {
    return (
      <Flex align="center" gap={2} py={1}>
        <Check size={12} />
        <Text fontSize="xs" color="text.subtle">
          Questions answered
        </Text>
      </Flex>
    );
  }

  return (
    <VStack spacing={3} align="stretch" mt={2}>
      {questions.map((q, qIdx) => (
        <Box key={qIdx}>
          <Text fontSize="xs" fontWeight="500" color="text.primary" mb={1}>
            {q.question}
          </Text>
          {q.reason && (
            <Text fontSize="2xs" color="text.subtle" mb={2}>
              {q.reason}
            </Text>
          )}
          <Wrap spacing={1.5}>
            {(q.options ?? []).map((opt) => (
              <WrapItem key={opt}>
                <Button
                  size="xs"
                  variant={selections[qIdx] === opt ? 'solid' : 'outline'}
                  colorScheme={selections[qIdx] === opt ? 'purple' : undefined}
                  borderColor="border.subtle"
                  fontWeight="400"
                  fontSize="2xs"
                  h="26px"
                  onClick={() => selectOption(qIdx, opt)}
                  isDisabled={submitting}
                >
                  {opt}
                </Button>
              </WrapItem>
            ))}
            <WrapItem>
              <Button
                size="xs"
                variant={showCustom[qIdx] ? 'solid' : 'ghost'}
                colorScheme={showCustom[qIdx] ? 'purple' : undefined}
                fontWeight="400"
                fontSize="2xs"
                h="26px"
                onClick={() => toggleCustom(qIdx)}
                isDisabled={submitting}
              >
                Custom
              </Button>
            </WrapItem>
          </Wrap>
          {showCustom[qIdx] && (
            <Input
              mt={2}
              size="xs"
              placeholder="Type your answer..."
              value={customInputs[qIdx] ?? ''}
              onChange={(e) =>
                setCustomInputs((prev) => ({ ...prev, [qIdx]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && allAnswered) handleSubmit();
              }}
              isDisabled={submitting}
            />
          )}
        </Box>
      ))}
      <Flex justify="flex-end">
        <Button
          size="xs"
          leftIcon={<Send size={12} />}
          onClick={handleSubmit}
          isDisabled={!allAnswered || submitting}
          isLoading={submitting}
        >
          Send
        </Button>
      </Flex>
    </VStack>
  );
}

export function ActivityFeed({
  items,
  answeredIds,
  onRespond,
  agentNames,
}: {
  items: ActivityItem[];
  answeredIds?: Set<string>;
  onRespond?: (
    activityId: string,
    answers: Array<{ question: string; answer: string; skipped: boolean }>
  ) => void;
  agentNames?: Record<string, string>;
}) {
  if (items.length === 0) {
    return (
      <Flex justify="center" py={8}>
        <Text fontSize="sm" color="text.subtle">
          No activity yet
        </Text>
      </Flex>
    );
  }

  return (
    <VStack spacing={0} align="stretch" maxH="500px" overflow="auto">
      {items.map((item) => {
        const isClarification = item.type === 'clarification_request';
        let questions: ClarificationQuestion[] = [];
        if (isClarification && item.details) {
          try {
            questions = JSON.parse(item.details);
          } catch {}
        }

        return (
          <Box
            key={item.id}
            py={2}
            px={3}
            borderBottom="1px solid"
            borderColor={isClarification && !answeredIds?.has(item.id) ? 'purple.800' : 'border.subtle'}
            bg={isClarification && !answeredIds?.has(item.id) ? 'rgba(139, 92, 246, 0.04)' : undefined}
            _hover={{ bg: isClarification && !answeredIds?.has(item.id) ? 'rgba(139, 92, 246, 0.06)' : 'overlay.subtle' }}
          >
            <Flex gap={3}>
              <Box flex={1} minW={0}>
                <Flex justify="space-between" align="center" mb={0.5}>
                  <Flex gap={2} align="center">
                    {isClarification && (
                      <MessageCircleQuestion size={12} color="#8b5cf6" />
                    )}
                    <Text fontSize="2xs" fontWeight="600" color={isClarification ? 'purple.400' : 'text.muted'}>
                      {isClarification ? 'question' : item.type}
                    </Text>
                    <Text fontSize="2xs" color="text.subtle">
                      {agentNames?.[item.agentId] ?? item.agentId}
                    </Text>
                  </Flex>
                  <Text fontSize="2xs" color="text.subtle" fontFamily="mono">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </Text>
                </Flex>
                <Text fontSize="xs" color="text.secondary" noOfLines={isClarification ? undefined : 2}>
                  {item.message}
                </Text>

                {isClarification && questions.length > 0 && onRespond && (
                  <ClarificationInline
                    questions={questions}
                    answered={answeredIds?.has(item.id) ?? false}
                    onSubmit={(answers) => onRespond(item.id, answers)}
                  />
                )}
              </Box>
            </Flex>
          </Box>
        );
      })}
    </VStack>
  );
}

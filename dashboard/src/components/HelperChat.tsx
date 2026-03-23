'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Flex, Text, Input, IconButton, VStack, Spinner,
} from '@chakra-ui/react';
import { MessageCircle, X, Send, RotateCcw } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export function HelperChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      fetch('/api/helper')
        .then(r => r.json())
        .then(data => {
          if (data.messages?.length > 0) {
            setMessages(data.messages);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, messages.length]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Something went wrong: ${data.error}`,
          timestamp: new Date().toISOString(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Failed to reach the helper agent. Make sure the Claude CLI is available.',
        timestamp: new Date().toISOString(),
      }]);
    }

    setLoading(false);
  }

  async function resetSession() {
    try {
      await fetch('/api/helper', { method: 'DELETE' });
    } catch {}
    setMessages([]);
  }

  function formatMessage(content: string): string {
    return content
      .replace(/```[\s\S]*?```/g, (match) => match)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (!isOpen) {
    return (
      <Box position="fixed" bottom="24px" right="24px" zIndex={1000}>
        <IconButton
          aria-label="Open helper"
          icon={<MessageCircle size={20} />}
          onClick={() => setIsOpen(true)}
          w="48px"
          h="48px"
          borderRadius="full"
          bg="bg.elevated"
          color="text.primary"
          border="1px solid"
          borderColor="border.subtle"
          _hover={{ bg: 'bg.hover', borderColor: 'border.default' }}
          shadow="lg"
        />
      </Box>
    );
  }

  return (
    <Box
      position="fixed"
      bottom="24px"
      right="24px"
      w="420px"
      h="560px"
      bg="bg.surface"
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="xl"
      shadow="lg"
      zIndex={1000}
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      <Flex
        align="center"
        justify="space-between"
        px={4}
        py={3}
        borderBottom="1px solid"
        borderColor="border.subtle"
        bg="bg.cards"
        flexShrink={0}
      >
        <Flex align="center" gap={2}>
          <Box w="8px" h="8px" borderRadius="full" bg={loading ? 'orange.400' : 'green.400'} />
          <Text fontSize="sm" fontWeight="500" color="text.primary">
            Hugr Helper
          </Text>
        </Flex>
        <Flex gap={1}>
          <IconButton
            aria-label="Reset"
            icon={<RotateCcw size={14} />}
            size="xs"
            variant="ghost"
            color="text.subtle"
            _hover={{ color: 'text.primary' }}
            onClick={resetSession}
          />
          <IconButton
            aria-label="Close"
            icon={<X size={16} />}
            size="xs"
            variant="ghost"
            color="text.subtle"
            _hover={{ color: 'text.primary' }}
            onClick={() => setIsOpen(false)}
          />
        </Flex>
      </Flex>

      <Box
        flex={1}
        overflowY="auto"
        px={4}
        py={3}
        sx={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-thumb': { bg: 'bg.hover', borderRadius: 'full' },
          '&::-webkit-scrollbar-track': { bg: 'transparent' },
        }}
      >
        {messages.length === 0 && !loading && (
          <VStack spacing={3} py={8} px={2}>
            <Text fontSize="sm" color="text.muted" textAlign="center">
              I can help you create workflows, triggers, and custom workers. Just describe what you want.
            </Text>
            <VStack spacing={1} w="100%">
              {[
                'Create a trigger that runs tests every night at 2am',
                'Make a workflow with architect, coder, and reviewer',
                'Set up a file watcher for my notes folder',
              ].map((suggestion) => (
                <Box
                  key={suggestion}
                  w="100%"
                  px={3}
                  py={2}
                  bg="bg.tertiary"
                  border="1px solid"
                  borderColor="border.subtle"
                  borderRadius="lg"
                  cursor="pointer"
                  _hover={{ borderColor: 'border.default', bg: 'bg.elevated' }}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                >
                  <Text fontSize="xs" color="text.subtle">{suggestion}</Text>
                </Box>
              ))}
            </VStack>
          </VStack>
        )}

        <VStack spacing={3} align="stretch">
          {messages.map((msg, i) => (
            <Flex
              key={i}
              justify={msg.role === 'user' ? 'flex-end' : 'flex-start'}
            >
              <Box
                maxW="85%"
                px={3}
                py={2}
                borderRadius="lg"
                bg={msg.role === 'user' ? 'bg.elevated' : 'transparent'}
                border={msg.role === 'assistant' ? '1px solid' : 'none'}
                borderColor="border.subtle"
              >
                <Text
                  fontSize="xs"
                  color={msg.role === 'user' ? 'text.primary' : 'text.secondary'}
                  whiteSpace="pre-wrap"
                  lineHeight="1.6"
                  sx={{
                    '& code': {
                      bg: 'bg.tertiary',
                      px: 1,
                      py: 0.5,
                      borderRadius: 'sm',
                      fontSize: '2xs',
                      fontFamily: 'mono',
                    },
                  }}
                >
                  {formatMessage(msg.content)}
                </Text>
              </Box>
            </Flex>
          ))}

          {loading && (
            <Flex align="center" gap={2} py={1}>
              <Spinner size="xs" color="text.subtle" speed="0.8s" />
              <Text fontSize="xs" color="text.subtle">thinking...</Text>
            </Flex>
          )}
        </VStack>

        <div ref={messagesEndRef} />
      </Box>

      <Box
        px={3}
        py={3}
        borderTop="1px solid"
        borderColor="border.subtle"
        bg="bg.cards"
        flexShrink={0}
      >
        <Flex gap={2}>
          <Input
            ref={inputRef}
            size="sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask me to create something..."
            bg="bg.secondary"
            border="1px solid"
            borderColor="border.subtle"
            borderRadius="lg"
            color="text.primary"
            _placeholder={{ color: 'text.subtle' }}
            _focus={{ borderColor: 'border.default', boxShadow: 'none' }}
            fontSize="xs"
            disabled={loading}
          />
          <IconButton
            aria-label="Send"
            icon={<Send size={14} />}
            size="sm"
            onClick={sendMessage}
            isDisabled={loading || !input.trim()}
            bg="bg.elevated"
            color="text.primary"
            borderRadius="lg"
            _hover={{ bg: 'bg.hover' }}
            _disabled={{ opacity: 0.3, cursor: 'not-allowed' }}
          />
        </Flex>
      </Box>
    </Box>
  );
}

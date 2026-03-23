let cached: Record<string, any> | null = null;

export async function loadHugr(): Promise<Record<string, any>> {
  if (cached) return cached;

  try {
    const mod = await import('@runeltd/hugr');
    cached = (mod as any).default ?? mod;
    return cached!;
  } catch {}

  return {};
}

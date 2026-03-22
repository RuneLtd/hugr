import { NextRequest, NextResponse } from 'next/server';
import { getDataPaths, setHugrHome } from '@/lib/state';
import { existsSync, mkdirSync } from 'fs';

export async function GET() {
  const paths = getDataPaths();
  return NextResponse.json(paths);
}

export async function POST(req: NextRequest) {
  const { hugrHome } = await req.json();

  if (!hugrHome || typeof hugrHome !== 'string') {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    mkdirSync(hugrHome, { recursive: true });
  } catch {
    return NextResponse.json({ error: 'Cannot create directory at that path' }, { status: 400 });
  }

  if (!existsSync(hugrHome)) {
    return NextResponse.json({ error: 'Path does not exist after creation' }, { status: 400 });
  }

  setHugrHome(hugrHome);

  return NextResponse.json({ success: true, paths: getDataPaths() });
}

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { platform } from 'os';

export async function POST() {
  const os = platform();

  try {
    let cmd: string;

    if (os === 'darwin') {
      cmd = `osascript -e 'set theFiles to POSIX path of (choose file with prompt "Select skill files (.md)" of type {"md", "public.plain-text"} with multiple selections allowed)' -e 'return theFiles'`;
    } else if (os === 'win32') {
      cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = 'Select skill files'; $f.Filter = 'Markdown files (*.md)|*.md|All files (*.*)|*.*'; $f.Multiselect = $true; if ($f.ShowDialog() -eq 'OK') { $f.FileNames -join '\\n' } else { '' }"`;
    } else {
      cmd = `zenity --file-selection --multiple --separator="\\n" --file-filter="Markdown files | *.md" --file-filter="All files | *" --title="Select skill files" 2>/dev/null || kdialog --getopenfilename ~ "*.md" 2>/dev/null || echo ""`;
    }

    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 }).trim();

    if (!result) {
      return NextResponse.json({ paths: [], cancelled: true });
    }

    const paths = result
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean);

    return NextResponse.json({ paths, cancelled: false });
  } catch {
    return NextResponse.json({ paths: [], cancelled: true });
  }
}

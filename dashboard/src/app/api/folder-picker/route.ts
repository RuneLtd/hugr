import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { platform } from 'os';

export async function POST() {
  const os = platform();

  try {
    let cmd: string;

    if (os === 'darwin') {
      cmd = `osascript -e 'set theFolder to POSIX path of (choose folder with prompt "Select project folder")' -e 'return theFolder'`;
    } else if (os === 'win32') {
      cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select project folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }"`;
    } else {
      cmd = `zenity --file-selection --directory --title="Select project folder" 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null || echo ""`;
    }

    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 }).trim();

    if (!result) {
      return NextResponse.json({ path: null, cancelled: true });
    }

    const cleaned = result.endsWith('/') ? result.slice(0, -1) : result;
    return NextResponse.json({ path: cleaned, cancelled: false });
  } catch {
    return NextResponse.json({ path: null, cancelled: true });
  }
}

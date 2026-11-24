# Adds an "Orchestra" shortcut with its icon to your Desktop and Start menu.
# Run it once:   powershell -ExecutionPolicy Bypass -File install.ps1
# Run it again if you move the Orchestra folder. To remove, delete the two shortcuts.
$dir = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
foreach ($place in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $lnk = $shell.CreateShortcut((Join-Path $place 'Orchestra.lnk'))
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = '"' + (Join-Path $dir 'Orchestra.vbs') + '"'
  $lnk.WorkingDirectory = $dir
  $lnk.IconLocation = (Join-Path $dir 'orchestra.ico') + ',0'
  $lnk.Description = 'Orchestra: a team of AI agents that build together'
  $lnk.Save()
  "Added $($lnk.FullName)"
}
"Open Orchestra from the Desktop or the Start menu. To pin it, right-click the shortcut > Pin to taskbar."

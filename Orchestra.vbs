' Starts Orchestra as an app: no console window, opens in its own window, and quits by itself
' after its windows are closed (never while a build or chat reply is running).
' Double-click this file, or use the Orchestra shortcut that install.ps1 makes.
' The server's output goes to orchestra.log next to this file.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
port = sh.ExpandEnvironmentStrings("%ORCHESTRA_PORT%")
If port = "%ORCHESTRA_PORT%" Then port = "4545"
url = "http://127.0.0.1:" & port

' Already running: just open another window onto it.
running = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP")
http.setTimeouts 1000, 1000, 1000, 1000
http.open "GET", url & "/api/config", False
http.send
If Err.Number = 0 Then
  If http.status = 200 Then running = True
End If
On Error GoTo 0
If running Then
  sh.Run "cmd /c start """" msedge --app=" & url & " --window-size=1400,900", 0, False
  WScript.Quit 0
End If

If sh.Run("cmd /c where node", 0, True) <> 0 Then
  MsgBox "Orchestra needs Node.js. Install it from https://nodejs.org, then open Orchestra again.", vbExclamation, "Orchestra"
  WScript.Quit 1
End If

args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
sh.CurrentDirectory = dir
sh.Run "cmd /c node server.mjs --app" & args & " > orchestra.log 2>&1", 0, False

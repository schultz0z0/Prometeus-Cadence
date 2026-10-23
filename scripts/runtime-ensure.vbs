Option Explicit
If WScript.Arguments.Count <> 2 Then WScript.Quit 2

Dim shell, nodePath, workspace, command, quote
nodePath = WScript.Arguments(0)
workspace = WScript.Arguments(1)
quote = Chr(34)
If InStr(nodePath, quote) > 0 Or InStr(workspace, quote) > 0 Then WScript.Quit 2

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = workspace
command = quote & nodePath & quote & " " & quote & workspace & "\scripts\runtime-control.mjs" & quote & " ensure"
' wscript is a GUI host: unlike powershell.exe it never allocates a startup
' console. Run Node with window style 0 and wait only for this finite check.
WScript.Quit shell.Run(command, 0, True)

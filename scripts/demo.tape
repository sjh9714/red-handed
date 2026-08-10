# Demo GIF for the README.
#
#   npm run build && vhs scripts/demo.tape
#
# Records the real published command, not a mock. It shows the default action:
# counting how many of your agent's test runs left no readable result. One
# command, one screen of numbers, no findings to scroll past — the viewer
# should get the whole idea from the final frame alone.

Output docs/demo.gif

Set Shell zsh
Set FontSize 15
Set Width 1080
Set Height 480
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 24

# Warm the npx cache off-screen so the recording shows the scan, not the download.
Hide
Type "cd /tmp && npx @jinhyuk9714/red-handed@latest >/dev/null 2>&1; clear" Enter
Sleep 12s
Show

Sleep 800ms
Type "npx @jinhyuk9714/red-handed@latest"
Sleep 600ms
Enter

# ~5.4s scan (measured), then hold on the numbers long enough to read them.
Sleep 9s
Screenshot docs/demo-frame.png
Sleep 6s

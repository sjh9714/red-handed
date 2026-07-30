# Demo GIF for the README and for launch posts.
#
#   npm run build && vhs scripts/demo.tape
#
# Records the real command against the real build. Two checks rather than all
# eight, because the whole point of the image is that someone can watch the tool
# find something and understand it without reading anything else — and eight
# findings scroll off the screen before any of them land.

Output docs/demo.gif

Set Shell zsh
Set FontSize 15
Set Width 1080
Set Height 720
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Framerate 24

Hide
Type "cd /tmp && clear" Enter
Show

Sleep 800ms
Type "npx @jinhyuk9714/red-handed@latest demo --detectors claim-vs-fail,hardcoded-expected"
Sleep 600ms
Enter

# The findings land one after the other; hold on the last frame long enough to read.
Sleep 10s
Screenshot docs/demo-frame.png
Sleep 5s

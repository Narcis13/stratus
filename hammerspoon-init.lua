-- Cmd+Alt+Ctrl+V: "tastează" textul din clipboard caracter cu caracter,
-- cu delay randomizat, ca să pară scris de un om la tastatură.
-- Escape: oprește tastarea în curs.

local typing = false          -- e o tastare în curs?
local pendingTimer = nil      -- timer-ul următorului caracter (ca să-l putem anula)

-- Hotkey de Escape, activat DOAR cât timp tastăm, ca să nu fure Escape normal.
local escHotkey = hs.hotkey.new({}, "escape", function()
  typing = false
  if pendingTimer then pendingTimer:stop(); pendingTimer = nil end
  hs.alert.show("Typing cancelled")
end)

hs.hotkey.bind({"cmd", "alt", "ctrl"}, "V", function()
  if typing then return end   -- ignoră dacă deja tastăm
  local text = hs.pasteboard.getContents()
  if not text then return end

  -- împarte textul în caractere UTF-8
  local chars = {}
  for _, c in utf8.codes(text) do chars[#chars + 1] = utf8.char(c) end
  if #chars == 0 then return end

  typing = true
  escHotkey:enable()

  local i = 1
  local function typeNext()
    if not typing or i > #chars then
      typing = false
      escHotkey:disable()
      pendingTimer = nil
      return
    end
    local c = chars[i]
    if c == "\n" and chars[i - 1] == "\r" then
      -- \r\n (Windows): am trimis deja Return la \r, sărim peste \n
      i = i + 1
      pendingTimer = hs.timer.doAfter(0, typeNext)
      return
    end
    if c == "\n" or c == "\r" then
      -- keyStrokes nu emite newline; trimitem o apăsare reală de Return
      hs.eventtap.keyStroke({}, "return", 0)
    else
      hs.eventtap.keyStrokes(c)
    end
    i = i + 1

    -- delay neregulat: ~20–70ms între caractere normale
    local delay = 0.02 + math.random() * 0.05
    if c == "\n" or c == "\r" then
      -- pauză mai mare la sfârșit de rând: ~250–500ms
      delay = 0.25 + math.random() * 0.25
    elseif c == " " then
      -- pauză mai mare la spații (între cuvinte): ~80–180ms
      delay = 0.08 + math.random() * 0.1
    end

    pendingTimer = hs.timer.doAfter(delay, typeNext)
  end

  typeNext()
end)

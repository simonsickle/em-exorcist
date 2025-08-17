# Em-Dash Exorcist

Removes em and en dashes and stray space-hyphen-space in ChatGPT messages, then fixes capitalization so you do not get run-ons.

## What it changes
- `—` and `–` become either `. `, `, `, or ` – `, based on your setting.
- ` - ` (space hyphen space) also becomes your chosen separator.
- If you choose `. `, the next letter is capitalized across node boundaries.

It never edits inside code, pre blocks, inputs, or editable areas.

## Before and After

**Before:**
![Before](https://raw.githubusercontent.com/simonsickle/em-exorcist/refs/heads/main/assets/before.png)

**After:**
![After](https://raw.githubusercontent.com/simonsickle/em-exorcist/refs/heads/main/assets/after.png)

## Install

**Firefox:** [Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/em-dash-exorcist/)

**Chrome (manual install):**
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked and select the `emdash-exorcist` folder

**Firefox (manual install):**
1. Open `about:debugging#/runtime/this-firefox`
2. Load Temporary Add-on
3. Pick any file in the `emdash-exorcist` folder

## Options
Right click the extension icon, open Options. Choose the replacement style. Changes apply immediately.

## Notes
- You might see a dash for a blink during token streaming. The script replaces it almost immediately.
- Performance stays smooth by batching mutations, prechecking nodes, and caching processed text.

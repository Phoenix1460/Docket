# Docket

Docket is a Chrome extension dashboard for organizing student assignments. It connects to a logged-in Canvas session, groups assignments by status, and supports linked homework platforms for completion checks.

## Features

- Displays assignments due within the next two weeks, missing work, and submitted work in separate sections.
- Syncs assignment information from Canvas without storing Canvas passwords or API tokens.
- Supports linked homework websites and optional automatic completion checks.
- Keeps platform-completed assignments in the due-work section with a completion indicator.
- Includes a startup loading screen with rotating fun facts.
- Provides a fixed sidebar and dashboard settings.

## How to Use

### Install in Chrome

1. Download or clone this repository.
2. Extract the project if it was downloaded as a ZIP file.
3. Open Chrome and visit `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the `docket-extension` folder containing `manifest.json`.
7. Click the Docket toolbar icon to open the dashboard.

### Connect Canvas

1. Sign in to your school's Canvas website in Chrome.
2. Open the Docket dashboard.
3. Use the Canvas connection option and allow the extension to sync your assignments.
4. Reload the extension from `chrome://extensions` after making source-code changes.

### Link Homework Websites

Open **Settings** or the linked homework sites area, then follow the instructions for the homework platform. Automatic completion checking can be enabled or disabled from the settings panel.

## Development

The extension is a plain Chrome Manifest V3 extension. The primary files are:

- `docket-extension/manifest.json` — extension permissions and configuration
- `docket-extension/dashboard.html` — dashboard layout and styles
- `docket-extension/dashboard.js` — dashboard behavior and assignment organization
- `docket-extension/content-script.js` — Canvas and homework-site page detection
- `docket-extension/background.js` — extension background behavior

After editing files, return to `chrome://extensions` and click the reload icon on the Docket extension card.

## Privacy

Docket is designed to use the current browser session for Canvas and linked homework-site checks. Do not share your browser profile or extension files with anyone you do not trust.

## Credits

Made by **Phoenix1460** in collaboration with **elliotcoop429-cloud**.

## License

No license has been specified yet.

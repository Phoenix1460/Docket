Docket Extension
Docket is a Chrome extension that helps students organize homework and track assignments in one dashboard. After connecting Canvas, assignments are grouped into upcoming work, missing work, and submitted work. Linked homework platforms can also be checked for completion status.

Features
Organizes Canvas assignments into three sections:
Due in the next 2 weeks
Missing work
Submitted work
Supports linked homework websites.
Automatically checks linked platforms for completed assignments.
Shows a “Read as completed” label when a homework platform reports completion.
Includes a searchable assignment dashboard.
Includes a loading screen with rotating fun facts.
Provides settings for enabling or disabling automatic homework checks.
How to Use
Download or clone this repository.
Open Chrome and go to chrome://extensions.
Turn on Developer mode.
Select Load unpacked.
Choose the extension folder.
Open the Docket dashboard.
Connect Canvas and follow the prompts.
Link any supported homework websites you use.
Use the Settings menu to enable or disable automatic completion checks.
Assignments will appear after Canvas has been synced. Linked-site completion checks only work when the homework website is connected and available in an authenticated browser session.

Development
The extension is built with standard HTML, CSS, and JavaScript. The main dashboard files are located in the extension directory:

dashboard.html — dashboard layout and styles
dashboard.js — dashboard behavior and assignment organization
content-script.js — reads assignment information from supported websites
background.js — handles extension background tasks
manifest.json — Chrome extension configuration
Credits
Made by Phoenix1460 in collaboration with elliotcoop429-cloud.
